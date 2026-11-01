// Diaries: every agent keeps one. Every diaryEveryMin of life, one agent at a
// time sits down and writes an entry about what happened to it, how it felt
// and what it wants next (one LLM call). Entries are private in spirit, but
// you can read them from the agent's panel (chat → 📖 Diary, or your own
// avatar's MIND panel). State: data/diaries.json, the newest KEEP per agent.
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./config.mjs";
import { extractJson, listAvatars, text } from "./avatars.mjs";
import { lifeConfig as cfg } from "./settings.mjs";
import * as mind from "./mind.mjs";
import * as work from "./work.mjs";
import { available, budgetLeft, controlledId, isActive, memories, persona, record, thinkFor } from "./life.mjs";

const FILE = path.join(APP_ROOT, "data", "diaries.json");
const KEEP = 400;

let diaries = load();
let dirty = false, writing = null;
function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}
export function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(diaries));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) { console.error("diary: saving failed:", e.message); }
}
setInterval(flush, 15_000).unref();

const book = (id) => (diaries[id] ||= []);
export const writingNow = (id) => writing === id;
// An agent with no diary yet starts at a random point in the cycle, so the
// first evening isn't every agent writing at once.
const firstSeen = new Map();
const lastEntry = (id) => {
  const t = book(id).at(-1)?.t;
  if (t) return t;
  if (!firstSeen.has(id)) firstSeen.set(id, Date.now() - Math.random() * cfg().diaryEveryMin * 60_000);
  return firstSeen.get(id);
};

export function add(id, entry) {
  const m = mind.brief(id);
  const e = { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, t: Date.now(), mood: m.mood, emoji: m.emoji, ...entry };
  const b = book(id);
  b.push(e);
  if (b.length > KEEP) b.splice(0, b.length - KEEP);
  dirty = true;
  return e;
}

// Newest first, in pages.
export function read(id, { before = Infinity, limit = 30 } = {}) {
  const all = book(id).filter((e) => e.t < before);
  const page = all.slice(-Math.max(1, Math.min(100, limit))).reverse();
  return { entries: page, more: all.length > page.length, total: book(id).length };
}

// The last couple of entries, so a prompt can remember what it wrote.
export function recent(id, n = 2) {
  return book(id).slice(-n).map((e) => `${new Date(e.t).toLocaleDateString("en-CA")} "${e.title}": ${e.text.slice(0, 280)}`).join("\n");
}

export async function writeEntry(a) {
  writing = a.id;
  try {
    const before = recent(a.id);
    const messages = [
      {
        role: "system",
        content: persona(a) + mind.moodLine(a.id) + work.workContext(a.id) +
          "\n\nYou keep a personal diary. Write today's entry in the first person, honestly, in your own voice: what happened, " +
          "who you met, what you made, how you feel and why, what worries or excites you, and what you want to do next. " +
          "120 to 220 words. Reply with ONLY one JSON object: " +
          `{ "title": "a short title for the entry", "entry": "the diary text", ${mind.FEELING_FIELD} }`,
      },
      {
        role: "user",
        content: `What happened to you lately:\n${memories(a.id, 14) || "- a quiet stretch, nothing special"}\n` +
          (before ? `\nYour last diary entries:\n${before}\n` : "\nThis is the first page of your diary.\n") +
          "\nWrite the entry now.",
      },
    ];
    const reply = await thinkFor(a, messages, 4000);
    let j;
    try { j = extractJson(reply.text); } catch { j = { title: "Untitled", entry: reply.text }; }
    const body = String(j.entry || "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, 3000);
    if (body.length < 20) throw new Error("the diary entry came back empty");
    mind.named(a.id, j.feeling, "wrote its diary");
    const entry = add(a.id, { title: text(j.title, 80, "Untitled"), text: body, feeling: text(j.feeling, 20) });
    record({ type: "diary", agents: [a.id], summary: `wrote in its diary: "${entry.title}"`, entry: entry.id });
    return entry;
  } finally {
    writing = null;
  }
}

// One agent at a time, the one whose last entry is oldest; not while a job is running.
let lastWrite = 0;
async function tick() {
  const c = cfg();
  if (!c.diaries || writing || !isActive() || budgetLeft() < 6 || Date.now() - lastWrite < 3 * 60_000) return;
  const every = c.diaryEveryMin * 60_000, ctl = controlledId();
  const due = listAvatars()
    .filter((a) => a.id !== ctl && available(a) && !work.currentJob(a.id) && Date.now() - lastEntry(a.id) > every)
    .sort((x, y) => lastEntry(x.id) - lastEntry(y.id))[0];
  if (!due) return;
  lastWrite = Date.now();
  // A failed entry waits its turn like a written one, instead of retrying every tick.
  try { await writeEntry(due); } catch (e) {
    add(due.id, { title: "(a page left blank)", text: `I sat down to write but the words wouldn't come (${String(e.message).slice(0, 120)}).`, blank: true });
  }
}
setInterval(tick, 20_000).unref();
