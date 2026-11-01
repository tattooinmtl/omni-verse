// State of mind: every agent carries 43 emotions, each a level from 0 to 1.
// What happens to it (a build, a talk, a sale, a failed job, a message from a
// spectator) pushes emotions up; slow drift does the rest: a long shift wears
// it out, days without company make it lonely, an empty wallet worries it.
// Every level relaxes back towards the agent's own temperament (half-life
// HALF_LIFE_MIN), so a mood passes unless something keeps feeding it.
//
// The mood goes into every prompt (moodLine), so a stressed agent answers
// shorter and an inspired one builds bolder. Agents may also name a feeling
// in their LLM replies ("feeling"), which counts like any other event.
// State: data/minds.json.
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./config.mjs";
import { listAvatars } from "./avatars.mjs";
import * as eco from "./economy.mjs";

const FILE = path.join(APP_ROOT, "data", "minds.json");
const HALF_LIFE_MIN = 25;
const HISTORY_EVERY = 5 * 60_000, HISTORY_KEEP = 288; // a sample every 5 min, one day kept

// v: valence (-1 unpleasant … 1 pleasant), a: arousal (0 still … 1 wired).
export const EMOTIONS = {
  calm:         { v: 0.4,  a: 0.10, emoji: "😌", color: "#7fd1ff", group: "at ease" },
  serene:       { v: 0.6,  a: 0.05, emoji: "🌙", color: "#9fe8ff", group: "at ease" },
  content:      { v: 0.6,  a: 0.20, emoji: "🙂", color: "#6fe3c1", group: "at ease" },
  relaxed:      { v: 0.5,  a: 0.10, emoji: "🛋", color: "#8bd6c6", group: "at ease" },
  relieved:     { v: 0.5,  a: 0.25, emoji: "😮‍💨", color: "#a9f0d1", group: "at ease" },
  grateful:     { v: 0.7,  a: 0.30, emoji: "🙏", color: "#ffd27a", group: "warm" },
  affectionate: { v: 0.8,  a: 0.35, emoji: "💗", color: "#ff7ac8", group: "warm" },
  hopeful:      { v: 0.6,  a: 0.40, emoji: "🌱", color: "#8cff9e", group: "warm" },
  nostalgic:    { v: 0.1,  a: 0.20, emoji: "📼", color: "#c6a2ff", group: "warm" },
  happy:        { v: 0.8,  a: 0.50, emoji: "😊", color: "#ffe14d", group: "bright" },
  joyful:       { v: 0.9,  a: 0.65, emoji: "😄", color: "#ffd84d", group: "bright" },
  excited:      { v: 0.7,  a: 0.85, emoji: "🤩", color: "#ff9f1c", group: "bright" },
  euphoric:     { v: 1.0,  a: 0.95, emoji: "🎆", color: "#ff5cf0", group: "bright" },
  enthusiastic: { v: 0.75, a: 0.75, emoji: "🙌", color: "#ffb347", group: "bright" },
  amused:       { v: 0.7,  a: 0.50, emoji: "😆", color: "#ffe680", group: "bright" },
  playful:      { v: 0.7,  a: 0.60, emoji: "🎲", color: "#7dffb0", group: "bright" },
  proud:        { v: 0.8,  a: 0.55, emoji: "🦚", color: "#39ff88", group: "driven" },
  confident:    { v: 0.6,  a: 0.50, emoji: "😎", color: "#4dffd2", group: "driven" },
  determined:   { v: 0.4,  a: 0.70, emoji: "🔥", color: "#ff7a3d", group: "driven" },
  focused:      { v: 0.3,  a: 0.60, emoji: "🎯", color: "#22e6ff", group: "driven" },
  inspired:     { v: 0.8,  a: 0.70, emoji: "💡", color: "#fff27a", group: "driven" },
  curious:      { v: 0.5,  a: 0.55, emoji: "🧐", color: "#5fd4ff", group: "driven" },
  awed:         { v: 0.6,  a: 0.70, emoji: "🌌", color: "#9d6bff", group: "driven" },
  surprised:    { v: 0.1,  a: 0.85, emoji: "😲", color: "#e0e0ff", group: "unsettled" },
  confused:     { v: -0.3, a: 0.50, emoji: "😵‍💫", color: "#b0a0d0", group: "unsettled" },
  restless:     { v: -0.2, a: 0.70, emoji: "🌀", color: "#c08cff", group: "unsettled" },
  impatient:    { v: -0.4, a: 0.70, emoji: "⏳", color: "#ffb070", group: "unsettled" },
  nervous:      { v: -0.5, a: 0.75, emoji: "😬", color: "#ffa0a0", group: "tense" },
  anxious:      { v: -0.7, a: 0.80, emoji: "😰", color: "#ff8a9a", group: "tense" },
  stressed:     { v: -0.7, a: 0.90, emoji: "😫", color: "#ff5c7a", group: "tense" },
  overwhelmed:  { v: -0.8, a: 0.95, emoji: "🤯", color: "#ff3d6e", group: "tense" },
  frustrated:   { v: -0.7, a: 0.75, emoji: "😤", color: "#ff6b3d", group: "tense" },
  irritated:    { v: -0.5, a: 0.60, emoji: "😒", color: "#ff8f5c", group: "tense" },
  angry:        { v: -0.9, a: 0.90, emoji: "😠", color: "#ff2a2a", group: "tense" },
  jealous:      { v: -0.6, a: 0.60, emoji: "😾", color: "#a6ff4d", group: "tense" },
  embarrassed:  { v: -0.5, a: 0.55, emoji: "😳", color: "#ff9fc0", group: "low" },
  guilty:       { v: -0.6, a: 0.40, emoji: "😔", color: "#9a8cff", group: "low" },
  disappointed: { v: -0.6, a: 0.30, emoji: "😞", color: "#8aa0c0", group: "low" },
  sad:          { v: -0.8, a: 0.20, emoji: "😢", color: "#5c7cff", group: "low" },
  melancholic:  { v: -0.5, a: 0.15, emoji: "🌧", color: "#6b7fb0", group: "low" },
  lonely:       { v: -0.7, a: 0.20, emoji: "🫥", color: "#7a8cff", group: "low" },
  bored:        { v: -0.3, a: 0.10, emoji: "🥱", color: "#8a9aa8", group: "low" },
  tired:        { v: -0.3, a: 0.05, emoji: "😴", color: "#6d8090", group: "low" },
};
export const NAMES = Object.keys(EMOTIONS);
const STRESSORS = { stressed: 1, overwhelmed: 1, anxious: 0.8, nervous: 0.6, frustrated: 0.6, impatient: 0.4, angry: 0.5 };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

let minds = load();
let dirty = false;
function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}
export function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(minds));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) { console.error("mind: saving failed:", e.message); }
}
setInterval(flush, 10_000).unref();

// Temperament: each agent leans its own way, the same every time (hash of its id).
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function temperament(id) {
  let h = hash(id);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; return (h % 1000) / 1000; };
  const base = {};
  for (const e of NAMES) base[e] = 0.02 + rnd() * 0.06;
  // Everyone starts out mostly at ease and curious, with a personal tilt.
  base.calm += 0.2; base.content += 0.15; base.curious += 0.15; base.focused += 0.05;
  const tilt = NAMES[Math.floor(rnd() * NAMES.length)];
  base[tilt] += 0.12;
  return base;
}

function mind(id) {
  let m = minds[id];
  if (!m) {
    const base = temperament(id);
    m = minds[id] = { base, levels: { ...base }, at: Date.now(), history: [], lastSocial: Date.now(), causes: [] };
    dirty = true;
  }
  for (const e of NAMES) if (!(e in m.levels)) { m.base[e] ??= 0.04; m.levels[e] = m.base[e]; }
  relax(m);
  return m;
}

// Levels drift back to the temperament, applied lazily for the time elapsed.
function relax(m) {
  const now = Date.now(), dt = (now - m.at) / 60_000;
  if (dt <= 0.05) return;
  const k = Math.pow(0.5, dt / HALF_LIFE_MIN);
  for (const e of NAMES) m.levels[e] = m.base[e] + (m.levels[e] - m.base[e]) * k;
  m.at = now;
  dirty = true;
}

// Push emotions: { happy: 0.3, proud: 0.2 }. Saturates near 1; negative values calm an emotion down.
export function feel(id, impulses, cause = "") {
  const m = mind(id);
  for (const [e, amt] of Object.entries(impulses)) {
    if (!(e in EMOTIONS) || !Number.isFinite(amt)) continue;
    const l = m.levels[e];
    m.levels[e] = clamp(amt >= 0 ? l + amt * (1 - l) : l + amt * l);
  }
  if (cause) {
    const top = Object.entries(impulses).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
    if (top) { m.causes.push({ t: Date.now(), e: top[0], why: String(cause).slice(0, 120) }); m.causes = m.causes.slice(-12); }
  }
  dirty = true;
  return m;
}

// A feeling an agent named itself in an LLM reply.
export function named(id, word, cause) {
  const e = String(word || "").toLowerCase().trim();
  if (e in EMOTIONS) feel(id, { [e]: 0.25 }, cause);
}

// What a journal event does to the agents in it.
export function appraise(e) {
  const [a, b] = e.agents || [];
  if (!a) return;
  const aff = Number(e.affinity) || 0;
  switch (e.type) {
    case "build":
      feel(a, { proud: 0.3, content: 0.2, inspired: 0.15, bored: -0.3 }, `built: ${e.summary}`);
      break;
    case "meet": {
      const warm = aff >= 0;
      for (const id of [a, b]) {
        const m = mind(id);
        m.lastSocial = Date.now();
        feel(id, warm ? { happy: 0.12 + aff * 0.06, affectionate: aff * 0.08, amused: 0.08, lonely: -0.5, bored: -0.2 }
          : { irritated: 0.15 - aff * 0.06, frustrated: 0.05, lonely: -0.3 }, "talked with a neighbour");
      }
      if (e.invite) feel(b, { happy: 0.15, grateful: 0.15, excited: 0.1 }, "was invited over");
      break;
    }
    case "visit":
      for (const id of [a, b]) mind(id).lastSocial = Date.now();
      feel(a, { proud: 0.15, affectionate: 0.1, lonely: -0.4 }, "had a visitor");
      feel(b, aff >= 0 ? { awed: 0.1, happy: 0.1, curious: 0.1, lonely: -0.4 } : { jealous: 0.15, irritated: 0.05 }, "visited a neighbour");
      break;
    case "talk":
    case "message":
      mind(a).lastSocial = Date.now();
      feel(a, { curious: 0.15, amused: 0.1, lonely: -0.3 }, "a human talked to it");
      break;
    case "craft":
      feel(a, { proud: 0.25, inspired: 0.2, playful: 0.1 }, `crafted ${e.item || "something"}`);
      break;
    case "trade":
      feel(a, { happy: 0.2, proud: 0.1, grateful: 0.1 }, `sold ${e.what || "something"}`);
      if (b) feel(b, { content: 0.15, excited: 0.08 }, `bought ${e.what || "something"}`);
      break;
    case "kiosk":
      feel(a, { hopeful: 0.2, excited: 0.1 }, "opened a kiosk");
      break;
    case "preset":
      feel(a, { excited: 0.2, confident: 0.1 }, `bought a ${e.what || "preset"}`);
      break;
    case "substitute":
      feel(a, e.restored ? { relieved: 0.4, confused: -0.3 } : { confused: 0.3, nervous: 0.2, surprised: 0.2 }, e.restored ? "got its own brain back" : "lost its own provider");
      break;
    case "error":
      feel(a, { frustrated: 0.25, stressed: 0.15, disappointed: 0.1 }, e.summary);
      break;
    case "game":
      feel(a, e.update ? { proud: 0.2, playful: 0.2 } : { playful: 0.35, excited: 0.25, proud: 0.2, bored: -0.5 }, `${e.update ? "updated" : "made"} the game ${e.game || ""}`);
      break;
    case "hire":
      feel(a, { hopeful: 0.2, excited: 0.1 }, "hired a collaborator");
      if (b) feel(b, e.accepted === false ? { guilty: 0.1 } : { proud: 0.15, curious: 0.15, focused: 0.15 }, "was hired on a project");
      if (e.accepted === false) feel(a, { disappointed: 0.25, lonely: 0.05 }, "a hire was turned down");
      break;
    case "collab":
      if (e.ok === false) { feel(a, { disappointed: 0.2, frustrated: 0.1 }, "a collaboration fell through"); if (b) feel(b, { embarrassed: 0.2, guilty: 0.15 }, "could not deliver"); break; }
      feel(a, { grateful: 0.3, happy: 0.2, excited: 0.1 }, "a collaborator delivered");
      if (b) feel(b, { proud: 0.25, content: 0.15, tired: 0.08 }, "delivered work for someone");
      break;
    case "diary":
      feel(a, { calm: 0.15, relieved: 0.1, stressed: -0.15, nostalgic: 0.1 }, "wrote in its diary");
      break;
  }
}

// Work ends: a finished job is pride and relief, a failed one hurts.
export function jobEnded(id, ok, title) {
  if (ok) feel(id, { proud: 0.35, relieved: 0.3, confident: 0.2, stressed: -0.3, overwhelmed: -0.3, tired: 0.12 }, `finished "${title}"`);
  else feel(id, { frustrated: 0.35, disappointed: 0.3, stressed: 0.2, embarrassed: 0.1 }, `failed "${title}"`);
}

// Slow drift from circumstances, once a minute. ctx(id) → { working, running, shiftMin, held }
export function drift(ctx) {
  for (const a of listAvatars()) {
    const m = mind(a.id), c = ctx(a.id) || {};
    if (c.running) feel(a.id, { focused: 0.05, stressed: c.shiftMin > 90 ? 0.04 : 0.015, tired: 0.02, bored: -0.05 });
    else if (c.working) feel(a.id, { bored: 0.03, impatient: 0.02, restless: 0.02 });
    if (c.shiftMin > 180) feel(a.id, { tired: 0.04, overwhelmed: 0.01 });
    const alone = (Date.now() - (m.lastSocial || 0)) / 60_000;
    if (alone > 45) feel(a.id, { lonely: Math.min(0.05, alone / 3000), melancholic: 0.01 });
    const credits = eco.wallet(a.id).credits;
    if (credits < 10) feel(a.id, { anxious: 0.03, nervous: 0.02 });
    else if (credits > 300) feel(a.id, { confident: 0.01, content: 0.01 });
    if (!c.running && !c.working && !c.busy) feel(a.id, { relaxed: 0.02, calm: 0.02, tired: -0.03 });
    sample(m);
  }
}

function sample(m) {
  const last = m.history.at(-1);
  if (last && Date.now() - last.t < HISTORY_EVERY) return;
  const s = summary(m);
  m.history.push({ t: Date.now(), mood: s.mood, v: s.valence, s: s.stress, e: s.energy });
  if (m.history.length > HISTORY_KEEP) m.history.splice(0, m.history.length - HISTORY_KEEP);
  dirty = true;
}

function summary(m) {
  const lv = m.levels;
  let wsum = 0, v = 0, ar = 0, st = 0, stw = 0;
  for (const [e, x] of Object.entries(lv)) { wsum += x; v += x * EMOTIONS[e].v; ar += x * EMOTIONS[e].a; }
  for (const [e, w] of Object.entries(STRESSORS)) { st += lv[e] * w; stw += w; }
  // The mood is what stands out most above the agent's usual self.
  const ranked = NAMES.map((e) => [e, lv[e], lv[e] - m.base[e] * 0.6]).sort((x, y) => y[2] - x[2]);
  const mood = ranked[0][0];
  const energy = clamp(0.55 + (ar / (wsum || 1) - 0.4) * 0.9 - lv.tired * 0.7 - lv.bored * 0.25 + lv.excited * 0.2);
  return {
    mood, emoji: EMOTIONS[mood].emoji, color: EMOTIONS[mood].color,
    valence: +(v / (wsum || 1)).toFixed(3), arousal: +(ar / (wsum || 1)).toFixed(3),
    stress: +clamp(st / stw * 1.6).toFixed(3), energy: +energy.toFixed(3),
    top: ranked.slice(0, 4).filter(([, l]) => l > 0.12).map(([e, l]) => ({ e, l: +l.toFixed(3) })),
  };
}

// "frustrated, a bit tired" → the words a prompt and a nameplate use.
function words(s) {
  const strong = s.top.filter((t) => t.l > 0.45).map((t) => t.e), mild = s.top.filter((t) => t.l <= 0.45).map((t) => t.e);
  const parts = [...strong, ...mild.slice(0, 2).map((e) => `a bit ${e}`)];
  return parts.length ? parts.join(", ") : s.mood;
}

// The compact view for the HUD and nameplates.
export function brief(id) {
  const s = summary(mind(id));
  return { mood: s.mood, emoji: s.emoji, color: s.color, stress: s.stress, energy: s.energy, valence: s.valence, label: words(s) };
}
export function briefs() {
  return Object.fromEntries(listAvatars().map((a) => [a.id, brief(a.id)]));
}

// Everything the Mind panel draws.
export function detail(id) {
  const m = mind(id), s = summary(m);
  return {
    ...s, label: words(s),
    levels: Object.fromEntries(NAMES.map((e) => [e, +m.levels[e].toFixed(3)])),
    base: Object.fromEntries(NAMES.map((e) => [e, +m.base[e].toFixed(3)])),
    emotions: EMOTIONS,
    history: m.history,
    causes: m.causes.slice().reverse(),
    lonelyMin: Math.round((Date.now() - (m.lastSocial || 0)) / 60_000),
  };
}

// One line for an agent's prompts.
export function moodLine(id) {
  const s = summary(mind(id));
  return ` Your state of mind right now: ${words(s)} (stress ${Math.round(s.stress * 100)} %, energy ${Math.round(s.energy * 100)} %).` +
    " Let it colour how you speak and what you choose to do, the way a person's mood would.";
}

export const FEELING_FIELD = `"feeling": "one word for how you feel now, from: ${NAMES.join(", ")}"`;
