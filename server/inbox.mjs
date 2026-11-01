// Messages from you to the agents, tied to your Omni account (Settings →
// Account). A free agent answers straight away. A busy one (at a running job,
// in a conversation, making a game…) gets the message queued and answers as
// soon as it is free; the answer lands in your inbox. The page that is open
// shows it as a notification, and the tray shows a balloon for any answer no
// page picked up. Answers keep coming while the city is closed, as long as
// the simulation isn't paused and the hourly budget allows.
// State: data/inbox.json, one box per signed-in account.
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./config.mjs";
import { listAvatars, personaPrompt } from "./avatars.mjs";
import { knownSecrets } from "./providers.mjs";
import { scrubSecrets } from "./security.mjs";
import * as cloud from "./cloud.mjs";
import * as work from "./work.mjs";
import * as sim from "./sim.mjs";
import * as hobby from "./hobby.mjs";
import * as diary from "./diary.mjs";
import { available, budgetLeft, callAgent, doingNow, isPaused, lifeContext, record } from "./life.mjs";

const FILE = path.join(APP_ROOT, "data", "inbox.json");
const THREAD_KEEP = 200;
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

let boxes = load();
let dirty = false;
function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}
export function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(boxes), { mode: 0o600 });
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) { console.error("inbox: saving failed:", e.message); }
}
setInterval(flush, 5_000).unref();

// The signed-in Omni account, or an error asking to sign in.
function account() {
  const s = cloud.status();
  if (!s.connected) throw err("Sign in with your Omni account (Settings → Account) to message the agents.", 401);
  const u = s.user || {};
  return { key: String(u.id ?? u.uid ?? u.email ?? u.username ?? u.name ?? "me").slice(0, 120), name: String(u.name || u.display_name || u.username || "Spectator").slice(0, 60) };
}
const boxOf = (key) => (boxes[key] ||= { threads: {}, seq: 0 });
const uid = (box) => `x${(++box.seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const agentById = (id) => listAvatars().find((a) => a.id === id);

// Why an agent can't answer right now, or null when it can.
export function busyReason(id) {
  const a = agentById(id);
  if (!a) return "gone";
  if (isPaused()) return "the simulation is paused";
  const job = work.currentJob(id);
  if (job?.status === "running") return `working on "${job.title}"`;
  const doing = doingNow(id) || hobby.busyWith(id) || (diary.writingNow(id) ? "writing in their diary" : null) || sim.busyIn(id);
  if (doing) return doing;
  if (pendingFor(id)) return "answering someone";
  if (!available(a)) return "resting (their provider is unavailable)";
  return null;
}
export function busyMap() {
  return Object.fromEntries(listAvatars().map((a) => [a.id, busyReason(a.id)]));
}
const answering = new Set();
const pendingFor = (id) => answering.has(id);

function push(box, agentId, msg) {
  const t = (box.threads[agentId] ||= []);
  t.push(msg);
  if (t.length > THREAD_KEEP) t.splice(0, t.length - THREAD_KEEP);
  dirty = true;
  return msg;
}

// One answer: the agent reads the whole recent thread, queued messages included.
async function answer(acct, a, { late = "" } = {}) {
  const box = boxOf(acct.key), thread = box.threads[a.id] || [];
  answering.add(a.id);
  try {
    const history = thread.slice(-14).filter((m) => m.dir === "out" || m.dir === "in")
      .map((m) => ({ role: m.dir === "out" ? "user" : "assistant", content: m.text }));
    const system = personaPrompt(a, "") + lifeContext(a.id) + hobby.hobbyContext(a.id) +
      `\n\n${acct.name}, a spectator watching the Omniverse, is writing to you through your inbox (they are not standing next to you).` +
      (late ? ` They wrote while you were busy ${late}; you are only answering now, so you may say so briefly.` : "");
    const reply = await callAgent(a, { messages: [{ role: "system", content: system }, ...history], maxTokens: 700, temperature: 0.8, retries: [1000, 10_000] });
    const said = scrubSecrets(String(reply.text || "").trim(), knownSecrets()).slice(0, 2000) || "…";
    for (const m of thread) if (m.dir === "out" && m.status === "queued") { m.status = "answered"; m.answeredAt = Date.now(); }
    const msg = push(box, a.id, { id: uid(box), t: Date.now(), dir: "in", text: said, read: false, notified: false, late: Boolean(late) });
    record({ type: "message", agents: [a.id], late: Boolean(late), summary: `answered a message from ${acct.name}${late ? " (it was busy)" : ""}`, lines: [{ who: a.id, name: a.spec.name, say: said.slice(0, 300) }] });
    return msg;
  } finally {
    answering.delete(a.id);
  }
}

export async function send(agentId, textIn) {
  const acct = account();
  const a = agentById(agentId);
  if (!a) throw err("unknown agent", 404);
  const body = String(textIn || "").trim().slice(0, 2000);
  if (!body) throw err("write something first");
  const box = boxOf(acct.key);
  const busy = busyReason(a.id);
  const out = push(box, a.id, { id: uid(box), t: Date.now(), dir: "out", text: body, status: busy ? "queued" : "sent", busy });
  if (busy || budgetLeft() <= 0) {
    out.status = "queued";
    out.busy = busy || "out of thinking budget for this hour";
    return { queued: true, busy: out.busy, message: out };
  }
  try {
    const reply = await answer(acct, a);
    reply.read = true; reply.notified = true; // you're looking at it
    out.status = "answered";
    return { queued: false, message: out, reply };
  } catch (e) {
    // It couldn't think just now: it will answer from the queue.
    out.status = "queued";
    out.busy = `couldn't answer right away (${String(e.message).slice(0, 80)})`;
    return { queued: true, busy: out.busy, message: out };
  }
}

// The queue: every few seconds, the oldest waiting message whose agent is now free.
let working = false;
async function tick() {
  if (working || isPaused() || budgetLeft() <= 1) return;
  let acct;
  try { acct = account(); } catch { return; }
  const box = boxOf(acct.key);
  const waiting = Object.entries(box.threads)
    .map(([id, t]) => [id, t.find((m) => m.dir === "out" && m.status === "queued")])
    .filter(([id, m]) => m && agentById(id) && !busyReason(id))
    .sort((x, y) => x[1].t - y[1].t)[0];
  if (!waiting) return;
  const [id, m] = waiting;
  working = true;
  try { await answer(acct, agentById(id), { late: m.busy || "" }); } catch (e) {
    m.tries = (m.tries || 0) + 1;
    if (m.tries >= 4) { m.status = "failed"; m.error = String(e.message).slice(0, 160); dirty = true; }
  } finally { working = false; }
}
setInterval(tick, 4_000).unref();

// ── views ─────────────────────────────────────────────────────────────────
export function list() {
  let acct;
  try { acct = account(); } catch (e) { return { signedIn: false, error: e.message, threads: [], unread: 0 }; }
  const box = boxOf(acct.key);
  const threads = Object.entries(box.threads).filter(([id]) => agentById(id)).map(([id, t]) => {
    const a = agentById(id);
    return {
      agent: id, name: a.spec.name, glow: a.spec.palette.glow, last: t.at(-1)?.t || 0,
      unread: t.filter((m) => m.dir === "in" && !m.read).length, queued: t.filter((m) => m.status === "queued").length, messages: t.slice(-60),
    };
  }).sort((x, y) => y.last - x.last);
  return { signedIn: true, account: acct.name, threads, unread: threads.reduce((s, t) => s + t.unread, 0) };
}

export function markRead(agentId) {
  const box = boxOf(account().key);
  for (const m of box.threads[agentId] || []) if (m.dir === "in") { m.read = true; m.notified = true; }
  dirty = true;
  return { ok: true };
}

// Answers nobody has been told about yet. The page asks every few seconds;
// the tray waits `minAgeMs` so an open page gets to show it first.
export function fresh({ minAgeMs = 0 } = {}) {
  let acct;
  try { acct = account(); } catch { return { unread: 0, items: [] }; }
  const box = boxOf(acct.key), items = [];
  let unread = 0;
  for (const [id, t] of Object.entries(box.threads)) {
    for (const m of t) {
      if (m.dir !== "in" || m.read) continue;
      unread++;
      if (m.notified || Date.now() - m.t < minAgeMs) continue;
      m.notified = true;
      dirty = true;
      items.push({ agent: id, name: agentById(id)?.spec.name || id, text: m.text.slice(0, 240), t: m.t, late: m.late });
    }
  }
  return { unread, items };
}
