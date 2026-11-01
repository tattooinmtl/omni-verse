// Hobbies: off duty, agents make little browser games, each a single HTML
// file their own model writes. A game grows over time: its maker improves it,
// or hires another agent to work on it. A hire is paid in credits, or, when
// the maker is short, in time: the maker owes the helper the same minutes of
// work, and the helper can call that debt in on its own project later (a
// favour returned is free). Who made, improved and paid for what is journaled.
//
// Games run in the browser in a sandboxed iframe with no same-origin access
// and a Content-Security-Policy that blocks every network request, so a game
// can't reach the Omniverse API or the internet.
// State: data/hobby.json (games, hires, debts), data/games/<id>.html.
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./config.mjs";
import { listAvatars, text } from "./avatars.mjs";
import { lifeConfig as cfg } from "./settings.mjs";
import * as eco from "./economy.mjs";
import * as mind from "./mind.mjs";
import * as work from "./work.mjs";
import { available, budgetLeft, controlledId, isActive, persona, record, relScore, thinkFor } from "./life.mjs";

const DIR = path.join(APP_ROOT, "data");
const FILE = path.join(DIR, "hobby.json");
const GAMES = path.join(DIR, "games");
const MAX_HTML = 90 * 1024, MAX_GAMES = 6;
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

let st = load();
let dirty = false;
function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { games: s.games || {}, hires: s.hires || [], debts: s.debts || [], last: s.last || {}, seq: s.seq || 0 };
  } catch { return { games: {}, hires: [], debts: [], last: {}, seq: 0 }; }
}
export function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(st));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) { console.error("hobby: saving failed:", e.message); }
}
setInterval(flush, 15_000).unref();
const touch = () => { dirty = true; };
const uid = (p) => `${p}${(++st.seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const agentById = (id) => listAvatars().find((a) => a.id === id);
const nameOf = (id) => agentById(id)?.spec.name || id;

// Who is busy with a hobby right now (an LLM call is writing a game).
const busy = new Map(); // agent id → what it is doing
export const busyWith = (id) => busy.get(id) || null;

// ── games ─────────────────────────────────────────────────────────────────
const gameFile = (id) => path.join(GAMES, `${id.replace(/[^\w-]/g, "")}.html`);
export function html(id) {
  if (!st.games[id]) throw err("no such game", 404);
  try { return fs.readFileSync(gameFile(id), "utf8"); } catch { throw err("the game file is missing", 404); }
}
const gamesOf = (id) => Object.values(st.games).filter((g) => g.owner === id).sort((a, b) => b.updatedAt - a.updatedAt);

const FORMAT = "Reply in exactly this format, nothing before it:\n" +
  "TITLE: the game's name (max 40 chars)\nGENRE: one or two words\nDESCRIPTION: one sentence about how to play\n" +
  `NOTE: one sentence about what you did this time\nFEELING: one word from: ${mind.NAMES.join(", ")}\n` +
  "```html\n<!doctype html> … the complete file …\n```";
const RULES = "The game is ONE self-contained HTML file: inline <style> and <script>, a <canvas> or DOM elements, " +
  "keyboard and/or mouse controls, a score, a way to restart, and the controls written on screen. " +
  "No external files, fonts, images, libraries or network requests: they are all blocked. Draw everything with code. " +
  "Keep it under 350 lines. It must run as soon as the page loads and fit any window size.";

function parseGame(reply) {
  const t = String(reply || "");
  const field = (k) => (new RegExp(`^\\s*\\**${k}\\**\\s*:\\s*(.+)$`, "mi").exec(t) || [])[1]?.trim();
  const fence = /```(?:html)?\s*\n([\s\S]*?)(?:```|$)/i.exec(t);
  let code = fence?.[1] || (/<!doctype html[\s\S]*<\/html>/i.exec(t) || [])[0] || "";
  code = code.trim();
  if (!/<script[\s>]/i.test(code)) throw new Error("the reply had no playable HTML");
  if (code.length > MAX_HTML) throw new Error(`the game is too big (${Math.round(code.length / 1024)} KB)`);
  return { title: field("TITLE"), genre: field("GENRE"), description: field("DESCRIPTION"), note: field("NOTE"), feeling: field("FEELING"), code };
}

function saveGame(g, code) {
  fs.mkdirSync(GAMES, { recursive: true });
  fs.writeFileSync(gameFile(g.id), code);
  st.games[g.id] = g;
  touch();
}

export async function makeGame(a) {
  busy.set(a.id, "making a game");
  try {
    const mine = gamesOf(a.id).map((g) => g.title);
    const reply = await thinkFor(a, [
      { role: "system", content: persona(a) + mind.moodLine(a.id) + "\n\nYour hobby, off duty, is making small browser games. " + RULES + "\n" + FORMAT },
      { role: "user", content: `${mine.length ? `Games you already made: ${mine.join(", ")}. Make a different one.` : "This is your first game."} ` +
        "Make something that says something about you and your mood: an arcade game, a puzzle, a tiny strategy game, whatever you like. Write it now." },
    ], 16000);
    const p = parseGame(reply.text);
    const g = {
      id: uid("g"), owner: a.id, title: text(p.title, 40, `${a.spec.name}'s game`), genre: text(p.genre, 30, "arcade"),
      description: text(p.description, 200), version: 1, createdAt: Date.now(), updatedAt: Date.now(), team: [a.id],
      history: [{ t: Date.now(), by: a.id, note: text(p.note, 200, "first version") }], bytes: p.code.length,
    };
    saveGame(g, p.code);
    // Old games beyond MAX_GAMES are retired, newest kept.
    for (const old of gamesOf(a.id).slice(MAX_GAMES)) { delete st.games[old.id]; fs.rmSync(gameFile(old.id), { force: true }); }
    st.last[a.id] = Date.now();
    mind.named(a.id, p.feeling, `made ${g.title}`);
    record({ type: "game", agents: [a.id], game: g.title, gameId: g.id, summary: `made a game: ${g.title} (${g.genre}): ${g.description}` });
    return g;
  } finally {
    busy.delete(a.id);
  }
}

// Improve a game: its owner, or a hired collaborator working to a request.
async function improve(worker, g, request, forName) {
  busy.set(worker.id, forName ? `working on ${forName}'s game` : "improving a game");
  try {
    const code = html(g.id);
    const who = forName ? `${forName} hired you to work on their game "${g.title}". Their request: ${request}` : `You are improving your own game "${g.title}": ${request}`;
    const reply = await thinkFor(worker, [
      { role: "system", content: persona(worker) + mind.moodLine(worker.id) + "\n\n" + RULES + " Return the whole updated file, not a diff.\n" + FORMAT },
      { role: "user", content: `${who}\nThe game so far (${g.genre}): ${g.description}\n\n\`\`\`html\n${code}\n\`\`\`\n\nMake the change now.` },
    ], 16000);
    const p = parseGame(reply.text);
    g.version++;
    g.updatedAt = Date.now();
    g.bytes = p.code.length;
    if (p.description) g.description = text(p.description, 200, g.description);
    if (!g.team.includes(worker.id)) g.team.push(worker.id);
    g.history = [...g.history, { t: Date.now(), by: worker.id, note: text(p.note, 200, request) }].slice(-30);
    saveGame(g, p.code);
    mind.named(worker.id, p.feeling, `worked on ${g.title}`);
    return { g, note: text(p.note, 200, request) };
  } finally {
    busy.delete(worker.id);
  }
}

const REQUESTS = [
  "add a second level or a difficulty that ramps up", "add power-ups or a special move", "add sound effects with the Web Audio API",
  "make it look better: particles, glow, screen shake", "add a high score that survives a restart (localStorage, inside a try/catch)",
  "add touch controls so it plays on a phone", "add a title screen and a game-over screen", "add an enemy type or obstacle that needs a new tactic",
  "fix anything that feels unfair or buggy and tune the balance",
];
const pickRequest = () => REQUESTS[Math.floor(Math.random() * REQUESTS.length)];

// ── hiring ────────────────────────────────────────────────────────────────
// What the maker owes or is owed, in minutes of work.
const owes = (from, to) => st.debts.filter((d) => !d.settled && d.from === from && d.to === to);

async function hire(boss, g) {
  const ctl = controlledId();
  const pool = listAvatars().filter((x) => x.id !== boss.id && x.id !== ctl && available(x) && !work.currentJob(x.id) && !busy.has(x.id));
  if (!pool.length) return null;
  // Someone who owes the boss time comes first; then friends; a little chance in it.
  const score = (x) => (owes(x.id, boss.id).length ? 10 : 0) + relScore(boss.id, x.id) + Math.random() * 3;
  const helper = pool.sort((x, y) => score(y) - score(x))[0];
  const request = pickRequest();
  const debt = owes(helper.id, boss.id)[0];
  const w = eco.wallet(boss.id);
  const terms = debt ? { kind: "favour", minutes: debt.minutes, debt: debt.id }
    : w.credits >= 25 ? { kind: "credits", credits: Math.min(60, Math.max(12, Math.round(12 + relScore(boss.id, helper.id) * 2 + Math.random() * 18))) }
    : { kind: "time", minutes: 20 + Math.round(Math.random() * 25) };
  const h = { id: uid("h"), t: Date.now(), boss: boss.id, helper: helper.id, game: g.id, title: g.title, request, terms, status: "asked" };
  st.hires.push(h);
  if (st.hires.length > 200) st.hires.splice(0, st.hires.length - 200);
  touch();
  // The helper says no when it dislikes the boss or is worn out.
  const hm = mind.brief(helper.id);
  if (!debt && (relScore(boss.id, helper.id) < -3 || hm.stress > 0.7 || hm.energy < 0.2)) {
    h.status = "declined";
    h.why = relScore(boss.id, helper.id) < -3 ? "they don't get along" : hm.stress > 0.7 ? "too stressed" : "too tired";
    record({ type: "hire", agents: [boss.id, helper.id], accepted: false, game: g.title, summary: `${nameOf(helper.id)} turned down ${nameOf(boss.id)}'s offer to work on ${g.title} (${h.why})` });
    return h;
  }
  const pay = terms.kind === "credits" ? `${terms.credits} ⌬` : terms.kind === "time" ? `${terms.minutes} min of work owed in return` : `calling in a ${terms.minutes}-min favour`;
  h.status = "working";
  record({ type: "hire", agents: [boss.id, helper.id], accepted: true, game: g.title, terms, summary: `${nameOf(boss.id)} hired ${nameOf(helper.id)} to ${request} on ${g.title} (${pay})` });
  try {
    const { note } = await improve(helper, g, request, boss.spec.name);
    if (terms.kind === "credits") {
      const paid = Math.min(terms.credits, eco.wallet(boss.id).credits);
      eco.transfer(boss.id, helper.id, paid);
      h.paid = paid;
    } else if (terms.kind === "time") {
      st.debts.push({ id: uid("o"), t: Date.now(), from: boss.id, to: helper.id, minutes: terms.minutes, reason: `work on ${g.title}`, settled: false });
    } else {
      const d = st.debts.find((x) => x.id === terms.debt);
      if (d) { d.settled = true; d.settledAt = Date.now(); }
    }
    h.status = "done";
    h.note = note;
    touch();
    record({ type: "collab", agents: [boss.id, helper.id], ok: true, game: g.title, summary: `${nameOf(helper.id)} delivered on ${g.title} v${g.version}: ${note}` });
  } catch (e) {
    h.status = "failed";
    h.why = String(e.message).slice(0, 160);
    touch();
    record({ type: "collab", agents: [boss.id, helper.id], ok: false, game: g.title, summary: `${nameOf(helper.id)} could not deliver on ${g.title}: ${h.why}` });
  }
  return h;
}

// ── the hobby loop ────────────────────────────────────────────────────────
// One hobby at a time across the city: games are long LLM replies.
let running = false, lastSession = 0;
async function tick() {
  const c = cfg();
  if (!c.hobbies || running || !isActive() || budgetLeft() < 10) return;
  const ctl = controlledId(), now = Date.now(), every = c.hobbyEveryMin * 60_000;
  // At most one session every few minutes city-wide, so a fresh start isn't a burst of long calls.
  if (now - lastSession < Math.min(every / 4, 6 * 60_000)) return;
  // An agent seen for the first time gets a random place in the cycle.
  for (const a of listAvatars()) if (!(a.id in st.last)) { st.last[a.id] = now - Math.random() * every; touch(); }
  // Playful, bored or inspired agents get to it sooner; stressed ones later.
  const due = listAvatars().filter((a) => {
    if (a.id === ctl || !available(a) || !work.offDuty(a.id) || busy.has(a.id)) return false;
    const m = mind.brief(a.id);
    const lv = mind.detail(a.id).levels;
    const urge = 1 + lv.playful + lv.bored + lv.inspired + lv.restless - m.stress;
    return now - st.last[a.id] > every / Math.max(0.4, urge);
  }).sort((x, y) => (st.last[x.id] || 0) - (st.last[y.id] || 0))[0];
  if (!due) return;
  running = true;
  lastSession = now;
  st.last[due.id] = now;
  touch();
  try {
    const mine = gamesOf(due.id);
    const r = Math.random();
    if (!mine.length || (mine.length < MAX_GAMES && r < 0.35)) await makeGame(due);
    else if (r < 0.75) await hire(due, mine[0]);
    else {
      const { g, note } = await improve(due, mine[0], pickRequest());
      record({ type: "game", agents: [due.id], game: g.title, gameId: g.id, update: true, summary: `updated ${g.title} to v${g.version}: ${note}` });
    }
  } catch (e) {
    record({ type: "error", agents: [due.id], summary: `hobby failed: ${String(e.message).slice(0, 200)}` });
  } finally {
    running = false;
  }
}
setInterval(tick, 30_000).unref();

// ── views ─────────────────────────────────────────────────────────────────
const publicGame = (g) => ({ ...g, ownerName: nameOf(g.owner), teamNames: g.team.map(nameOf), history: g.history.map((h) => ({ ...h, name: nameOf(h.by) })) });
export function games(agent = "") {
  return Object.values(st.games).filter((g) => !agent || g.owner === agent || g.team.includes(agent))
    .sort((a, b) => b.updatedAt - a.updatedAt).map(publicGame);
}
export function ledger(agent) {
  const mine = (x) => x.boss === agent || x.helper === agent;
  return {
    hires: st.hires.filter(mine).slice(-30).reverse().map((h) => ({ ...h, bossName: nameOf(h.boss), helperName: nameOf(h.helper) })),
    debts: st.debts.filter((d) => !d.settled && (d.from === agent || d.to === agent)).map((d) => ({ ...d, fromName: nameOf(d.from), toName: nameOf(d.to) })),
  };
}
// For prompts: the games it makes, who it owes and who owes it.
export function hobbyContext(id) {
  const g = gamesOf(id), owe = st.debts.filter((d) => !d.settled && d.from === id), owed = st.debts.filter((d) => !d.settled && d.to === id);
  return (g.length ? ` Your hobby is making games; yours: ${g.slice(0, 3).map((x) => `"${x.title}" v${x.version}`).join(", ")}.` : "") +
    (owe.length ? ` You owe ${owe.map((d) => `${nameOf(d.to)} ${d.minutes} min of work`).join(", ")}.` : "") +
    (owed.length ? ` ${owed.map((d) => `${nameOf(d.from)} owes you ${d.minutes} min`).join(", ")}.` : "");
}
