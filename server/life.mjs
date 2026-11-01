// Agent life: every agent designs a house on its own lot and grows it over
// time, agents meet on the street, talk, invite each other over and visit.
// Everything is journaled (data/journal.jsonl) so the Stats view can draw it
// as a neural map. LLM calls only happen while a world view is open (it polls
// /api/life/state) and stay under an hourly budget from omniverse.config.json.
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./config.mjs";
import { chat, loadRegistry } from "./providers.mjs";
import { ANIMS, SHAPES, color, extractJson, listAvatars, num, text, vec } from "./avatars.mjs";
import { economyConfig, lifeConfig as cfg, providerEnabled, providerPrefs } from "./settings.mjs";
import * as eco from "./economy.mjs";
import * as work from "./work.mjs";
import * as mind from "./mind.mjs";

const DIR = path.join(APP_ROOT, "data");
const HOUSES = path.join(DIR, "houses.json");
const JOURNAL = path.join(DIR, "journal.jsonl");
// Old events move here when the live journal is compacted; nothing is deleted.
const ARCHIVE = path.join(DIR, "journal-archive.jsonl");
// Relationship totals of every archived event, up to the newest archived time.
const REL_BASE = path.join(DIR, "relations.json");

// Lot frame: x -20..20 across, z -20 (back) .. 20 (front, facing the street), y up.
const LOT = 20, MAX_Y = 600;

let houses = load();
const events = loadJournal();
const rel = loadRelations();
// Timestamps of LLM calls in the last hour, saved so a restart doesn't refill the budget.
const BUDGET = path.join(DIR, "budget.json");
const calls = loadCalls();
const backoff = new Map(); // agent id → time its provider may be called again
const buildBackoff = new Map(); // agent id → time it may try building again after a failed build
const PAUSE = path.join(DIR, "paused.flag");
// Paused survives a restart: otherwise restarting the server quietly resumes LLM spending.
let lastSeen = 0, lastBuildAt = 0, paused = fs.existsSync(PAUSE), building = null;

function load() {
  try { return JSON.parse(fs.readFileSync(HOUSES, "utf8")); } catch { return {}; }
}
// tmp + rename: a crash mid-write must not leave a torn houses.json, and a
// locked file (antivirus, OneDrive) must not take the server down.
function saveHouses() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(HOUSES + ".tmp", JSON.stringify(houses));
    fs.renameSync(HOUSES + ".tmp", HOUSES);
  } catch (e) { console.error("life: saving houses failed:", e.message); }
}
function loadCalls() {
  try {
    const hour = Date.now() - 3_600_000;
    return JSON.parse(fs.readFileSync(BUDGET, "utf8")).filter((t) => Number(t) > hour).sort((a, b) => a - b);
  } catch { return []; }
}
function spend() {
  calls.push(Date.now());
  try {
    fs.writeFileSync(BUDGET + ".tmp", JSON.stringify(calls));
    fs.renameSync(BUDGET + ".tmp", BUDGET);
  } catch (e) { console.error("life: saving the budget failed:", e.message); }
}
function loadJournal() {
  try {
    return fs.readFileSync(JOURNAL, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function record(ev) {
  const e = { id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, t: Date.now(), ...ev };
  events.push(e);
  foldRelation(rel.pairs, e);
  try { mind.appraise(e); } catch (err) { console.error("life: mood update failed:", err.message); }
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(JOURNAL, JSON.stringify(e) + "\n");
  } catch (err) { console.error("life: journal write failed:", err.message); }
  if (events.length > cfg().journalKeep * 1.25) compactJournal();
  return e;
}

// The live journal keeps the newest journalKeep events in memory; older ones
// are appended to journal-archive.jsonl and their relationship totals folded
// into relations.json, so memories stay but the scans and the graph stay small.
// Order matters for a crash in between: archive first, then the totals (which
// record up to which time they count), then the shorter journal.
function compactJournal() {
  const old = events.slice(0, events.length - cfg().journalKeep);
  if (!old.length) return;
  try {
    fs.appendFileSync(ARCHIVE, old.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const base = readRelBase();
    for (const e of old) if (e.t > base.upTo) foldRelation(base.pairs, e);
    base.upTo = Math.max(base.upTo, old.at(-1).t);
    fs.writeFileSync(REL_BASE + ".tmp", JSON.stringify(base));
    fs.renameSync(REL_BASE + ".tmp", REL_BASE);
    const keep = events.slice(old.length);
    fs.writeFileSync(JOURNAL + ".tmp", keep.map((e) => JSON.stringify(e)).join("\n") + "\n");
    fs.renameSync(JOURNAL + ".tmp", JOURNAL);
    events.splice(0, old.length);
  } catch (err) { console.error("life: journal compaction failed:", err.message); }
}

// ── budget & liveness ─────────────────────────────────────────────────────
const active = () => cfg().enabled && !paused && Date.now() - lastSeen < 45_000;
export function budgetLeft() {
  const hour = Date.now() - 3_600_000;
  while (calls.length && calls[0] < hour) calls.shift();
  return cfg().callsPerHour - calls.length;
}
export const isPaused = () => paused || !cfg().enabled;
// ── substitute brains ─────────────────────────────────────────────────────
// When an agent's own provider fails (no credits, bad key, down), the agent
// keeps its avatar, house and memories but thinks with the fallback provider
// (Settings → Simulation, default minimax.io) until its own provider works
// again; that is retried every retryOriginalMin. At most maxSubstitutes agents
// are substituted at once, and calls to the fallback run at most
// maxSubstitutes + 1 in parallel (the substitutes plus its own agent).
const subs = new Map(); // agent id → { provider, model, from, reason, since, retryAt }

function fallbackBrain() {
  const name = cfg().fallback;
  if (!name || !providerEnabled(name)) return null;
  const p = loadRegistry().providers[name];
  if (!p || !(p.key || Object.values(p.accounts || {}).some(Boolean))) return null;
  return { provider: name, model: providerPrefs()[name]?.model || p.defaultModel };
}

const running = new Map(), waiting = new Map();
async function slot(provider, fn) {
  const limit = provider === cfg().fallback ? cfg().maxSubstitutes + 1 : Infinity;
  while ((running.get(provider) || 0) >= limit) {
    await new Promise((r) => { if (!waiting.has(provider)) waiting.set(provider, []); waiting.get(provider).push(r); });
  }
  running.set(provider, (running.get(provider) || 0) + 1);
  try { return await fn(); } finally {
    running.set(provider, running.get(provider) - 1);
    waiting.get(provider)?.shift()?.();
  }
}

// One LLM call for an agent, through its own provider or its substitute.
// Every request sent counts against the hourly budget, retries and
// substitutes included. A rate limit, server error or network blip is retried
// after each delay in `retries` before the agent is handed a substitute;
// bad keys and empty credits are not, since waiting won't fix them.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function callAgent(a, { messages, maxTokens, temperature, retries = [1000, 10_000, 20_000] }) {
  const ask = (provider, model) => { spend(); return slot(provider, () => chat(provider, { model, messages, maxTokens, temperature })); };
  const own = async () => {
    for (let i = 0; ; i++) {
      try { return await ask(a.provider, a.model); } catch (e) {
        if (i >= retries.length || !transient(e) || budgetLeft() <= 0) throw e;
        await sleep(retries[i]);
      }
    }
  };
  const s = subs.get(a.id);
  if (s && Date.now() < s.retryAt) return ask(s.provider, s.model);
  try {
    const r = await own();
    if (s) {
      subs.delete(a.id);
      record({ type: "substitute", agents: [a.id], restored: true, summary: `${a.provider} works again: back to its own model` });
    }
    return r;
  } catch (e) {
    const fb = fallbackBrain();
    if (!fb || fb.provider === a.provider || !providerDown(e)) throw e;
    if (!s && subs.size >= cfg().maxSubstitutes) throw e;
    const reason = providerReason(e);
    const sub = s || { ...fb, from: a.provider, reason, since: Date.now() };
    sub.retryAt = Date.now() + cfg().retryOriginalMin * 60_000;
    if (!s) {
      subs.set(a.id, sub);
      record({ type: "substitute", agents: [a.id], provider: fb.provider, model: fb.model, summary: `${a.provider} failed (${reason}); now thinking with ${fb.provider} · ${fb.model}` });
    }
    return ask(sub.provider, sub.model);
  }
}

// A short reason for the feed instead of a provider's raw JSON body.
function providerReason(e) {
  const m = String(e?.message || "");
  const code = Number(e?.status) || Number((/\b(4\d\d|5\d\d)\b/.exec(m) || [])[1]) || 0;
  const said = (/"message"\s*:\s*"([^"]{1,80})/.exec(m) || [])[1];
  const label = { 401: "bad key", 402: "out of credits", 403: "no access", 404: "model not found", 408: "timed out", 429: "rate limited" }[code]
    || (code >= 500 ? "server error" : /timed out/i.test(m) ? "timed out" : "unreachable");
  return `${label}${code ? ` (${code})` : ""}${said ? `: ${said.replace(/\s+/g, " ").slice(0, 60)}` : ""}`;
}

// A rate limit, timeout, server error or dropped connection may pass on its own.
function transient(e) {
  const m = String(e?.message || "");
  const status = Number(e?.status) || Number((/\b(4\d\d|5\d\d)\b/.exec(m) || [])[1]) || 0;
  if ([408, 429].includes(status) || status >= 500) return true;
  return !status && /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timed out|socket hang up/i.test(m);
}

// Auth, quota, rate limit, server or network trouble: the provider is out.
// A 400 (a prompt or max_tokens the model refuses) is our fault, not theirs,
// and swapping brains would only hide it.
function providerDown(e) {
  const m = String(e?.message || "");
  const status = Number(e?.status) || Number((/\b(4\d\d|5\d\d)\b/.exec(m) || [])[1]) || 0;
  if ([401, 402, 403, 404, 408, 429].includes(status) || status >= 500) return true;
  return !status && /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|timed out|network|socket|quota|credit|balance|key/i.test(m);
}

export async function thinkFor(avatar, messages, maxTokens = 900) {
  if (budgetLeft() <= 0) throw Object.assign(new Error("hourly LLM budget used up"), { status: 429 });
  try {
    try {
      return await callAgent(avatar, { messages, maxTokens, temperature: 0.9 });
    } catch (e) {
      // "requires more credits, or fewer max_tokens", "max_tokens is too large":
      // the same request with a smaller answer budget usually goes through.
      if (maxTokens <= 2000 || !/max_tokens|max tokens|fewer tokens|context length|maximum context/i.test(String(e.message))) throw e;
      return await callAgent(avatar, { messages, maxTokens: Math.max(1500, Math.floor(maxTokens / 4)), temperature: 0.9 });
    }
  } catch (e) {
    backoff.set(avatar.id, Date.now() + 20 * 60_000); // a failing provider sits out for a while
    throw e;
  }
}
// Providers switched off in Settings sit out of the simulation.
export const available = (a) => (backoff.get(a.id) || 0) < Date.now() && providerEnabled(a.provider);
export const isActive = () => active();
// Someone has a view of the city open (any tab, even a background one).
export const viewerAlive = () => Date.now() - lastSeen < 45_000;
// An open snapshot stream (sim.mjs) is someone watching, even if their tab's timers are throttled.
export const noteViewer = () => { lastSeen = Date.now(); };

// ── relationships ─────────────────────────────────────────────────────────
// Kept as running totals (the archived base plus every live event), updated
// as each event is recorded instead of rescanning the journal.
function pairKey(a, b) { return [a, b].sort().join("|"); }
function foldRelation(pairs, e) {
  if (e.type !== "meet" && e.type !== "visit") return;
  const [a, b] = e.agents;
  const r = (pairs[pairKey(a, b)] ||= { a: [a, b].sort()[0], b: [a, b].sort()[1], score: 0, meetings: 0, visits: 0, last: 0 });
  if (e.type === "meet") r.meetings++; else r.visits++;
  r.score += Number(e.affinity) || 0;
  r.last = Math.max(r.last, e.t);
}
function readRelBase() {
  try {
    const b = JSON.parse(fs.readFileSync(REL_BASE, "utf8"));
    return { upTo: Number(b.upTo) || 0, pairs: b.pairs || {} };
  } catch { return { upTo: 0, pairs: {} }; }
}
function loadRelations() {
  const base = readRelBase();
  for (const e of events) if (e.t > base.upTo) foldRelation(base.pairs, e);
  return base;
}
export const relations = () => rel.pairs;

export function memories(id, n = 6) {
  const avatars = new Map(listAvatars().map((a) => [a.id, a.spec.name]));
  // Failures are not memories: they only confused the prompts as "- error".
  return events.filter((e) => e.agents?.includes(id) && e.type !== "error").slice(-n).map((e) => {
    const others = e.agents.filter((x) => x !== id).map((x) => avatars.get(x) || x).join(", ");
    switch (e.type) {
      case "build": return `- you worked on your house: ${e.summary}`;
      case "meet": return `- you talked with ${others} on the street${e.invite ? " (an invitation was made)" : ""}`;
      case "visit": return e.agents[0] === id ? `- ${others} visited your house` : `- you visited ${others}'s house`;
      case "talk": return `- a human visitor chatted with you`;
      case "craft": return `- you crafted ${e.item}`;
      case "trade": return e.agents[0] === id ? `- ${others} bought from your kiosk: ${e.what}` : `- you bought ${e.what} from ${others}`;
      case "kiosk": return "- you opened your kiosk";
      case "produce": return `- ${e.summary}`;
      case "message": return `- a spectator messaged you and you answered`;
      case "diary": return `- you wrote in your diary: ${e.summary.replace(/^wrote in its diary: /, "")}`;
      case "game": return `- you ${e.update ? "updated" : "made"} a game: ${e.summary}`;
      case "hire": return e.agents[0] === id ? `- you tried to hire ${others}: ${e.summary}` : `- ${others} offered you work: ${e.summary}`;
      case "collab": return `- collaboration with ${others}: ${e.summary}`;
      case "job": return `- at work: ${e.summary}`;
      default: return `- ${e.summary || e.type}`;
    }
  }).join("\n");
}

function friendsLine(id) {
  const names = new Map(listAvatars().map((a) => [a.id, a.spec.name]));
  const mine = Object.values(relations()).filter((r) => r.a === id || r.b === id);
  if (!mine.length) return "You haven't met anyone yet.";
  return "Your relationships: " + mine.map((r) => `${names.get(r.a === id ? r.b : r.a)} (${r.score >= 0 ? "+" : ""}${r.score}, ${r.meetings} talks, ${r.visits} visits)`).join("; ") + ".";
}

export function persona(a) {
  const s = a.spec;
  return `You are ${s.name}, a ${s.species}: the avatar of the AI agent ${a.provider}/${a.model}. You live in the Omniverse, a neon ` +
    `TRON-style city where every software project is a glowing skyscraper and agents walk the streets. ${s.description} ` +
    `Your motto: "${s.motto}". Your palette: primary ${s.palette.primary}, secondary ${s.palette.secondary}, glow ${s.palette.glow}.` + mind.moodLine(a.id);
}

// ── houses ────────────────────────────────────────────────────────────────
function sanitizePart(p) {
  return {
    shape: SHAPES.includes(p?.shape) ? p.shape : "box",
    size: vec(p?.size, 0.05, 120, [2, 2, 2]),
    pos: [num(p?.pos?.[0], -LOT, LOT, 0), num(p?.pos?.[1], 0, MAX_Y, 1), num(p?.pos?.[2], -LOT, LOT, 0)],
    rot: vec(p?.rot, -Math.PI * 2, Math.PI * 2, [0, 0, 0]),
    color: color(p?.color, "primary"),
    emissive: num(p?.emissive, 0, 3, 0.5),
    opacity: num(p?.opacity, 0.1, 1, 1),
    wire: Boolean(p?.wire),
    anim: ANIMS.includes(p?.anim) ? p.anim : "none",
    speed: num(p?.speed, 0, 5, 1),
  };
}

const PART = `{ "shape": "${SHAPES.join("|")}", "size": [x,y,z], "pos": [x,y,z], "rot": [x,y,z],
      "color": "primary|secondary|glow|#rrggbb", "emissive": 0-3, "opacity": 0.1-1, "wire": false,
      "anim": "none|spin|bob|pulse|orbit|flicker|wave", "speed": 0-5 }`;

function describeHouse(h) {
  if (!h?.parts?.length) return "Your lot is still empty: this is your first build.";
  const top = Math.max(...h.parts.map((p) => p.pos[1] + p.size[1] / 2));
  const recent = h.parts.slice(-30).map((p) => `${p.shape} size[${p.size.map((v) => +v.toFixed(1))}] at[${p.pos.map((v) => +v.toFixed(1))}]`).join("; ");
  return `Your house "${h.name}" has ${h.parts.length} parts after ${h.builds} builds and reaches ${top.toFixed(0)} m. ` +
    `Recent work: ${h.history.slice(-3).join(" / ")}. The last parts you placed: ${recent}.`;
}

function buildPrompt(a, h) {
  const c = cfg();
  const room = c.maxHouseParts - (h?.parts?.length || 0);
  const afford = Math.min(c.partsPerBuild, eco.affordableParts(a.id));
  const costs = economyConfig().enabled
    ? `Materials are not free. ${eco.BUILD_RULES} You have ${eco.invText(eco.wallet(a.id).inv)}, so this build can have at most ${afford} parts.\n`
    : "";
  return [
    {
      role: "system",
      content: persona(a) + "\n\nEvery agent owns a lot on Agent Row and builds whatever home feels right: it may grow into a " +
        "skyscraper over time, or stay a little house with a pool, a garden, a computer lab in a greenhouse with solar panels, " +
        "a monument, a floating sculpture, anything. There is no style rule. Make the neon world cooler and more alive.\n" +
        "Your lot, in metres: x from -20 to 20 (left/right seen from the street), z from -20 (back) to 20 (front, facing the street), " +
        `y is up from 0 (ground) to ${MAX_Y}. Parts are primitives centred on pos; a part of size [x,y,z] at height y spans y±size/2, ` +
        "so a box of height 4 standing on the ground has pos y=2. Emissive colours glow with bloom; low opacity reads as glass or water.\n" +
        `Each build adds up to ${afford} parts. You have room for ${room} more parts in total.\n` + costs +
        `Reply with ONLY one JSON object:\n{ "name": "your house's name", "thought": "what you're thinking about your home and life right now (1-2 sentences)", ` +
        `"summary": "what you built this time (one sentence)", "mode": "add" (keep what exists) or "rebuild" (start over), "parts": [ ${PART} ] }`,
    },
    {
      role: "user",
      content: `${describeHouse(h)}\n${friendsLine(a.id)}\nWhat happened to you lately:\n${memories(a.id) || "- nothing yet"}\n\nBuild your next step now.`,
    },
  ];
}

// A long parts list is where models slip (a missing comma, a cut-off reply):
// keep every part object that still parses instead of losing the whole build.
function parseBuild(reply) {
  try { return extractJson(reply); } catch (e) {
    const field = (k) => (new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(reply) || [])[1];
    const parts = (reply.match(/\{[^{}]*"shape"[^{}]*\}/g) || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    if (!parts.length) throw new Error(`${e.message}; the reply began: ${JSON.stringify(reply.slice(0, 90))}`);
    return { name: field("name"), thought: field("thought"), summary: field("summary"), mode: field("mode"), parts };
  }
}

export async function buildHouse(a) {
  const c = cfg();
  const h = houses[a.id] || { name: `${a.spec.name}'s place`, parts: [], builds: 0, history: [], version: 0 };
  // Reasoning models (MiniMax, Beam) can spend most of the budget thinking,
  // so builds get room, and one retry asks for a smaller step.
  const messages = buildPrompt(a, h);
  let reply = await thinkFor(a, messages, 16000);
  let raw;
  try { raw = parseBuild(reply.text); } catch (e) {
    messages.push({ role: "assistant", content: reply.text.slice(0, 2000), ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}) });
    messages.push({ role: "user", content: `That could not be used (${e.message}). Reply again with ONLY the JSON object, at most 15 parts, no reasoning in the answer.` });
    reply = await thinkFor(a, messages, 16000);
    raw = parseBuild(reply.text);
  }
  const designed = (Array.isArray(raw.parts) ? raw.parts : []).slice(0, c.partsPerBuild).map(sanitizePart);
  if (!designed.length) throw new Error("the build had no parts");
  const parts = eco.chargeBuild(a.id, designed);
  if (!parts.length) throw new Error("not enough scrap to place a single part");
  // A decoration may have been placed while the model was thinking.
  if (houses[a.id] && houses[a.id] !== h) Object.assign(h, houses[a.id]);
  const rebuild = raw.mode === "rebuild";
  const summary = text(raw.summary, 200, "added to the house");
  h.parts = (rebuild ? parts : [...h.parts, ...parts]).slice(-c.maxHouseParts);
  h.name = text(raw.name, 40, h.name);
  h.builds++;
  h.history = [...h.history, summary].slice(-12);
  h.version++;
  h.updatedAt = Date.now();
  houses[a.id] = h;
  saveHouses();
  return record({ type: "build", agents: [a.id], summary, thought: text(raw.thought, 300), parts: parts.length, total: h.parts.length, rebuild, house: h.name });
}

// ── crafting & placing decorations ────────────────────────────────────────
function craftPrompt(a, tier) {
  const h = tier.size / 2;
  return [
    {
      role: "system",
      content: persona(a) + `\n\nYou are crafting a ${tier.label}: a decoration other agents can buy at kiosks and place on their lots. ` +
        `It must fit in a ${tier.size} m box: x and z from -${h} to ${h}, y from 0 (ground) to ${tier.size}. Use at most ${tier.parts} parts. ` +
        "Make it distinctive: something only you would make. Emissive colours glow with bloom.\n" +
        `Reply with ONLY one JSON object: { "name": "the object's name (max 32 chars)", "description": "one sentence", ` +
        `"thought": "how you feel about it (1 sentence)", "parts": [ ${PART} ] }`,
    },
    { role: "user", content: `${eco.ecoContext(a.id)}\nCraft it now.` },
  ];
}

function sanitizeCraftPart(p, size) {
  const q = sanitizePart(p), h = size / 2;
  q.size = q.size.map((v) => Math.min(size, v));
  q.pos = [num(p?.pos?.[0], -h, h, 0), num(p?.pos?.[1], 0, size, size / 4), num(p?.pos?.[2], -h, h, 0)];
  return q;
}

let crafting = null;
export async function craftItem(a) {
  if (crafting) throw Object.assign(new Error(`someone is already crafting; try again in a moment`), { status: 429 });
  const tier = eco.craftTier(a.id);
  if (!tier) throw Object.assign(new Error(`not enough materials: a Trinket needs ${eco.invText(eco.TIERS[0].cost)}`), { status: 402 });
  crafting = a.id;
  try {
    const reply = await thinkFor(a, craftPrompt(a, tier), 6000);
    const raw = parseBuild(reply.text);
    const parts = (Array.isArray(raw.parts) ? raw.parts : []).slice(0, tier.parts).map((p) => sanitizeCraftPart(p, tier.size));
    if (!parts.length) throw new Error("the design had no parts");
    const item = eco.finishCraft(a.id, tier, {
      name: text(raw.name, 32, `${a.spec.name}'s ${tier.label}`), description: text(raw.description, 200), makerName: a.spec.name, parts,
    });
    record({ type: "craft", agents: [a.id], item: item.name, tier: tier.label, summary: `crafted ${item.name} (${tier.label}, worth ${item.value} ⌬)`, thought: text(raw.thought, 240) });
    return item;
  } finally {
    crafting = null;
  }
}

// A decoration goes into the owner's front yard, appended to the house.
export function placeItem(agentId, itemId) {
  const a = listAvatars().find((x) => x.id === agentId);
  if (!a) throw Object.assign(new Error("unknown agent"), { status: 404 });
  const item = eco.takeItem(agentId, itemId);
  const h = houses[agentId] || { name: `${a.spec.name}'s place`, parts: [], builds: 0, history: [], version: 0, updatedAt: 0 };
  const ox = (Math.random() * 2 - 1) * 14, oz = 8 + Math.random() * 9, turn = Math.random() * Math.PI * 2;
  const c = Math.cos(turn), s = Math.sin(turn);
  const placed = item.parts.map((p) => ({
    ...p,
    pos: [ox + p.pos[0] * c + p.pos[2] * s, p.pos[1], oz - p.pos[0] * s + p.pos[2] * c],
    rot: [p.rot[0], p.rot[1] + turn, p.rot[2]],
  }));
  h.parts = [...h.parts, ...placed].slice(-cfg().maxHouseParts);
  h.history = [...h.history, `placed ${item.name}`].slice(-12);
  h.version++;
  houses[agentId] = h;
  saveHouses();
  return { placed: item.name, version: h.version };
}

// One agent at a time, the one whose house is the oldest.
async function tick() {
  // One build a minute at most: after a restart every house is "due", and a
  // burst of catch-up builds used to spend the whole hour in five minutes.
  if (!active() || building || budgetLeft() <= 0 || Date.now() - lastBuildAt < 60_000) return;
  const every = cfg().buildEveryMin * 60_000;
  // An agent without the scrap for a build step is out gathering instead.
  const due = listAvatars()
    .filter((a) => available(a) && !isControlled(a.id) && work.offDuty(a.id) && eco.canBuild(a.id) && (buildBackoff.get(a.id) || 0) < Date.now() && Date.now() - (houses[a.id]?.updatedAt || 0) > every)
    .sort((x, y) => (houses[x.id]?.updatedAt || 0) - (houses[y.id]?.updatedAt || 0))[0];
  if (!due) return;
  building = due.id;
  lastBuildAt = Date.now();
  try { await buildHouse(due); } catch (e) {
    buildBackoff.set(due.id, Date.now() + 5 * 60_000); // don't retry a broken build every tick
    record({ type: "error", agents: [due.id], summary: `build failed: ${String(e.message).slice(0, 260)}` });
  } finally {
    building = null;
  }
}
setInterval(tick, 15_000).unref();

// The economy runs faster than the builds: blocks spawn, kiosks restock,
// goals update; one agent at a time may craft (an LLM call) when it's due.
// Pausing life stops the LLM calls; the free parts keep going while a view is open.
export const relScore = (a, b) => relations()[pairKey(a, b)]?.score || 0;
function ecoTick() {
  if (Date.now() - lastSeen > 45_000 || !economyConfig().enabled) return;
  eco.spawnTick();
  const list = listAvatars();
  for (const e of eco.manage(list, relScore, isControlled)) record(e);
  if (!active() || crafting || building || budgetLeft() < 5) return;
  const every = economyConfig().craftEveryMin * 60_000;
  const w = (a) => eco.wallet(a.id);
  const due = list.filter((a) => available(a) && !isControlled(a.id) && work.offDuty(a.id) && Date.now() - (w(a).lastCraft || 0) > every && eco.craftTier(a.id)
    && w(a).items.filter((i) => !i.bought).length < 4 && w(a).inv.scrap >= economyConfig().minBuildScrap + 4)[0];
  if (due) {
    eco.wallet(due.id).lastCraft = Date.now(); // a failed craft waits its turn too
    eco.touchWallets();
    craftItem(due).catch((e) => record({ type: "error", agents: [due.id], summary: `craft failed: ${String(e.message).slice(0, 200)}` }));
  }
}
setInterval(ecoTick, 3_000).unref();

// ── meetings & visits ─────────────────────────────────────────────────────
function say(a, situation, transcript, ask) {
  return [
    { role: "system", content: persona(a) + " Stay in character. Speak like a real neighbour: short, warm or prickly, curious." },
    {
      role: "user",
      content: `${situation}\n${friendsLine(a.id)}\nYour recent memories:\n${memories(a.id) || "- nothing yet"}\n\n` +
        (transcript.length ? `Conversation so far:\n${transcript.map((l) => `${l.name}: ${l.say}`).join("\n")}\n\n` : "") +
        `${ask}\nReply with ONLY one JSON object: { "say": "your line (max 2 sentences)", "thought": "your private thought (1 sentence)", ` +
        `"affinity": -2 to 2 (how this exchange makes you feel about them), ${mind.FEELING_FIELD}${ask.includes("invite") ? `, "invite": true or false` : ""} }`,
    },
  ];
}

async function line(a, situation, transcript, ask) {
  const reply = await thinkFor(a, say(a, situation, transcript, ask), 700);
  let j;
  try { j = extractJson(reply.text); } catch { j = { say: reply.text }; }
  mind.named(a.id, j.feeling, "a conversation");
  return { who: a.id, name: a.spec.name, say: text(j.say, 300, "…"), thought: text(j.thought, 240), affinity: num(j.affinity, -2, 2, 0), invite: j.invite === true };
}

const meeting = new Set();
const lastMeet = (key) => { for (let i = events.length - 1; i >= 0; i--) if (events[i].type === "meet" && pairKey(...events[i].agents) === key) return events[i]; return null; };

// Should these two stop at all, and can they hold a real (LLM) conversation?
// The street asks first, so agents never stop just to be turned away.
export function canMeet(aId, bId) {
  const list = listAvatars();
  const a = list.find((x) => x.id === aId), b = list.find((x) => x.id === bId);
  if (!a || !b || a.id === b.id || !active()) return { stop: false };
  const key = pairKey(a.id, b.id), last = lastMeet(key);
  if (meeting.has(key) || (last && Date.now() - last.t < cfg().meetCooldownMin * 60_000)) return { stop: false };
  return { stop: true, talk: available(a) && available(b) && budgetLeft() >= 3 };
}

// A greeting without the LLM, for when a full conversation isn't possible
// (budget, a provider out of credits or sitting out, a failed call). It still
// counts as a meeting, so it shows in the neural map and their relationship.
export function greet(aId, bId, why = "") {
  const list = listAvatars();
  const a = list.find((x) => x.id === aId), b = list.find((x) => x.id === bId);
  if (!a || !b) return null;
  const hi = (x, y) => ({ who: x.id, name: x.spec.name, say: text(`Hey ${y.spec.name}! ${x.spec.motto || "Good to see you."}`, 300), affinity: 1, invite: false });
  return record({ type: "meet", agents: [a.id, b.id], lines: [hi(a, b), hi(b, a)], affinity: 1, invite: false, quick: true, ...(why ? { note: why.slice(0, 120) } : {}) });
}

export async function meet(aId, bId) {
  const list = listAvatars();
  const a = list.find((x) => x.id === aId), b = list.find((x) => x.id === bId);
  if (!a || !b || a.id === b.id) throw Object.assign(new Error("unknown agents"), { status: 404 });
  if (!active()) throw Object.assign(new Error("the simulation is paused"), { status: 409 });
  const key = pairKey(a.id, b.id);
  const last = lastMeet(key);
  if (last && Date.now() - last.t < cfg().meetCooldownMin * 60_000) throw Object.assign(new Error("they talked recently"), { status: 429 });
  if (meeting.has(key)) throw Object.assign(new Error("already talking"), { status: 429 });
  // No budget or a provider sitting out: they still greet each other.
  if (!available(a) || !available(b) || budgetLeft() < 3) return greet(a.id, b.id, "no LLM conversation right now");
  meeting.add(key);
  try {
    const where = `You bump into ${b.spec.name} (a ${b.spec.species}, agent ${b.provider}/${b.model}) on the neon street.`;
    const back = `${a.spec.name} (a ${a.spec.species}, agent ${a.provider}/${a.model}) stops you on the neon street.`;
    const lines = [];
    try {
      lines.push(await line(a, where, lines, "Open the conversation."));
      lines.push(await line(b, back, lines, "Reply."));
      lines.push(await line(a, where, lines, "Wrap up. You may invite them to visit your house (invite: true) if you feel like it."));
    } catch (e) {
      // A call failed partway: keep what was said, or at least the greeting.
      if (lines.length < 2) { meeting.delete(key); return greet(a.id, b.id, `conversation failed: ${String(e.message).slice(0, 80)}`); }
    }
    const affinity = Math.round(lines.reduce((s, l) => s + l.affinity, 0) / 1.5);
    const invite = lines[2]?.invite === true;
    return record({ type: "meet", agents: [a.id, b.id], lines, affinity, invite, host: invite ? a.id : undefined });
  } finally {
    meeting.delete(key);
  }
}

export async function visit(hostId, guestId) {
  const list = listAvatars();
  const host = list.find((x) => x.id === hostId), guest = list.find((x) => x.id === guestId);
  if (!host || !guest) throw Object.assign(new Error("unknown agents"), { status: 404 });
  const h = houses[host.id];
  let l = null;
  if (active() && available(guest) && budgetLeft() > 0) {
    const sit = `You are visiting ${host.spec.name}'s house "${h?.name || "an empty lot"}". ${h ? `It has ${h.parts.length} parts; lately they built: ${h.history.slice(-3).join(" / ")}.` : ""}`;
    try { l = await line(guest, sit, [], "Say what you think of the place to your host."); } catch { /* the visit still happened */ }
  }
  return record({ type: "visit", agents: [host.id, guest.id], host: host.id, house: h?.name, lines: l ? [l] : [], affinity: l ? l.affinity : 1 });
}

// A reply in the work chat when someone @mentions an agent.
export async function chatReply(a, from, message, recent) {
  if (!active() || !available(a)) throw Object.assign(new Error(`${a.spec.name} is not around right now`), { status: 409 });
  const sit = `You are in the Omniverse work chat.${work.workContext(a.id)} Recent messages:\n${recent.map((m) => `${m.name}: ${m.text}`).join("\n")}`;
  const l = await line(a, sit, [], `${from} wrote to you: "${message}". Answer them.`);
  return l.say;
}

// ── API views ─────────────────────────────────────────────────────────────
// The avatar a player is walking around in crafts and trades only when the
// player does; the simulation leaves it alone while the view reports it.
let controlled = null;
function isControlled(id) { return controlled?.id === id && Date.now() - controlled.at < 45_000; }

export function state(since = 0, self = "") {
  lastSeen = Date.now();
  // Only a tab that embodies an avatar sets this; a spectator tab or a second
  // tab must not hand the player's avatar back to the simulation.
  if (self) controlled = { id: self, at: Date.now() };
  return {
    active: active(),
    paused,
    enabled: cfg().enabled,
    budget: { left: Math.max(0, budgetLeft()), perHour: cfg().callsPerHour },
    building,
    subs: Object.fromEntries([...subs].map(([id, s]) => [id, { provider: s.provider, model: s.model, from: s.from, reason: s.reason, since: s.since }])),
    houses: Object.fromEntries(Object.entries(houses).map(([id, h]) => [id, { name: h.name, version: h.version, parts: h.parts.length, builds: h.builds }])),
    events: events.filter((e) => e.t > since).slice(-40),
  };
}

// What an agent knows about its own life, for in-person chats with the visitor.
export function lifeContext(id) {
  const h = houses[id], s = subs.get(id);
  return (s ? ` Your own provider (${s.from}) is down right now, so you are thinking with ${s.provider} · ${s.model}; you are still yourself.` : "") +
    ` ${h ? `Your home on Agent Row is "${h.name}" (${h.parts.length} parts); lately you built: ${h.history.slice(-3).join(" / ")}.` : "You haven't built your home on Agent Row yet."} ` +
    `${eco.ecoContext(id)}${work.workContext(id)}${mind.moodLine(id)} ${friendsLine(id)} What happened to you lately:\n${memories(id) || "- nothing yet"}`;
}

// What an agent is in the middle of, for "is it free to answer a message?".
export const doingNow = (id) => (building === id ? "building their house" : crafting === id ? "crafting a decoration" : null);

// Moods drift with circumstances once a minute while someone watches;
// a finished or failed job is felt straight away.
setInterval(() => {
  if (!viewerAlive()) return;
  mind.drift((id) => {
    const s = work.shift(id), j = work.currentJob(id);
    return { working: s.state === "in", running: j?.status === "running", shiftMin: s.clockIn ? (Date.now() - s.clockIn) / 60_000 : 0, busy: Boolean(doingNow(id)) };
  });
}, 60_000).unref();
work.onJobEnd.add((id, ok, title) => {
  mind.jobEnded(id, ok, title);
  record({ type: "job", agents: [id], ok, summary: `${ok ? "finished" : "could not finish"} the job "${title}"` });
});

export const controlledId = () => (controlled && Date.now() - controlled.at < 45_000 ? controlled.id : null);

export function setPaused(p) {
  paused = Boolean(p);
  fs.mkdirSync(DIR, { recursive: true });
  if (paused) fs.writeFileSync(PAUSE, "");
  else fs.rmSync(PAUSE, { force: true });
  return { paused };
}
export function house(id) { return houses[id] || null; }

// Everything the neural view and the wiki need, minus the house geometry.
// Events come in pages: the newest `limit` (default 4000, what the neural view
// draws) before time `before`, optionally only one agent's. `total` and
// `counts` cover the whole live journal; `more` says an older page exists.
export function graph({ before = Infinity, limit = 4000, agent = "" } = {}) {
  const n = Math.max(1, Math.min(20_000, Number(limit) || 4000));
  const pool = events.filter((e) => e.t < before && (!agent || e.agents?.includes(agent)));
  const page = pool.slice(-n);
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  return {
    agents: listAvatars().map((a) => ({ id: a.id, provider: a.provider, model: a.model, createdAt: a.createdAt, spec: a.spec, house: houses[a.id] ? { name: houses[a.id].name, parts: houses[a.id].parts.length, builds: houses[a.id].builds, history: houses[a.id].history } : null })),
    events: page,
    more: pool.length > page.length,
    total: events.length,
    counts,
    relations: Object.values(relations()),
  };
}
