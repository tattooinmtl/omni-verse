// The agents' world loop, on the server (the way AI Town runs its engine):
// every agent's position, what it is doing and what it does next live here,
// on a fixed tick. Browsers only draw the snapshots (GET /api/sim/stream);
// a background tab, a second tab or no tab at all no longer changes what the
// agents do. Decisions follow the goals the economy and work modules set;
// actions call those modules directly. Two agents passing on the street may
// stop and talk (an LLM exchange from life.mjs), invite each other home and
// visit. Like AI Town's idle worlds, the loop pauses when nobody has looked
// at the city for a while, and simply resumes later.
import { listAvatars } from "./avatars.mjs";
import { economyConfig } from "./settings.mjs";
import { getWorld } from "./world.mjs";
import * as eco from "./economy.mjs";
import * as work from "./work.mjs";
import { canMeet, controlledId, isActive, meet, noteViewer, placeItem, record, viewerAlive, visit } from "./life.mjs";
import {
  DESKS, STREET, computeLayout, deskSpot, deskXs, doorSpot, ecoLayout, exchangeSpot, isOutside, kioskFront, lotFront,
  randomLotSpot, randomRoomSpot, randomStreetPoint, route, yawInto, yawIntoLot,
} from "../public/layout.js";

const TICK_MS = 200;
let L = null, layoutKey = "";
const bots = new Map(); // agent id → state
const holds = new Map(); // agent id → time a visitor's chat stops holding it
const meetCooldown = new Map();
let meetingNow = false, sayId = 0;
// Open snapshot streams: a background tab keeps its stream even when the
// browser throttles its timers, so it still counts as someone watching.
let watchers = 0;
export const watch = () => { watchers++; return () => { watchers--; }; };

// ── the shared map ────────────────────────────────────────────────────────
async function refreshLayout() {
  const world = await getWorld();
  const agents = listAvatars();
  const key = `${world.scannedAt}|${agents.map((a) => `${a.id}:${a.createdAt}`).join(",")}`;
  if (key === layoutKey) return;
  layoutKey = key;
  L = computeLayout(world, agents);
  eco.setLayout(ecoLayout(L)); // the server places blocks on its own map now
  work.setDeskCount((root) => { const bd = buildingByRoot(root); return bd ? deskXs(bd).length : DESKS; });
}
export const layout = () => L;
const buildingByRoot = (root) => L?.buildings.find((b) => String(b.data.root).toLowerCase() === String(root || "").toLowerCase()) || null;
const lotOf = (id) => L?.lots.find((l) => l.agent.id === id) || null;

// ── one agent ─────────────────────────────────────────────────────────────
function spawn(a) {
  const p = randomStreetPoint(L);
  return {
    id: a.id, name: a.spec.name, x: p.x, y: 0, z: p.z, yaw: 0,
    mode: "idle", timer: Math.random() * 3, speed: 2.5 + Math.random() * 2.5,
    path: [], target: null, task: null, goalRoot: null, inside: null, floor: 0, desk: null, lot: null,
    lotGoal: null, onArrive: null, channel: null, say: null, meeting: null,
  };
}

function say(b, text, ms = 2600) {
  b.say = text ? { id: ++sayId, text: String(text).slice(0, 300), until: Date.now() + ms } : null;
}

function walkTo(b, p) {
  b.path = route(L, b, p);
  b.target = b.path.shift();
  b.mode = "walk";
}

function leave(b) {
  if (b.inside) { const bd = buildingByRoot(b.inside); if (bd) Object.assign(b, doorSpot(bd)); }
  else if (b.lot) { const lot = lotOf(b.lot); if (lot) Object.assign(b, lotFront(lot)); }
  b.y = 0;
  b.inside = null; b.lot = null; b.desk = null; b.floor = 0;
}

function goToLot(b, lotAgentId, onArrive = null) {
  const lot = lotOf(lotAgentId);
  if (!lot) return false;
  if (b.inside || b.lot) leave(b);
  b.task = null; b.channel = null; b.goalRoot = null;
  b.lotGoal = lotAgentId;
  b.onArrive = onArrive;
  walkTo(b, lotFront(lot));
  return true;
}

function sitAt(b, g, bd) {
  const spot = deskSpot(bd, g.desk);
  Object.assign(b, spot.pos);
  b.yaw = spot.yaw;
  b.inside = bd.data.root; b.floor = 0; b.desk = g.desk; b.lot = null;
  b.mode = "idle"; b.timer = 4 + Math.random() * 3;
  if (g.kind === "work") try { work.clockIn(b.id, g.root); say(b, "⏱ clocked in", 3000); } catch { /* the goal moved on */ }
}

function startWork(b, g) {
  const bd = buildingByRoot(g.root);
  if (!bd) return false;
  if (b.desk === g.desk && b.inside && b.inside.toLowerCase() === String(g.root).toLowerCase()) {
    b.mode = "idle"; b.timer = 4 + Math.random() * 3;
    return true; // still at the desk: keep working
  }
  if (b.inside && b.inside.toLowerCase() === String(g.root).toLowerCase()) { sitAt(b, g, bd); return true; }
  if (b.inside || b.lot) leave(b);
  b.task = { kind: "work", g };
  walkTo(b, doorSpot(bd));
  return true;
}

// Blocks other agents are already heading for or gathering.
function claimed(me) {
  const out = new Set();
  for (const o of bots.values()) if (o !== me) { if (o.task?.node) out.add(o.task.node); if (o.channel?.node) out.add(o.channel.node); }
  return out;
}

function nearestNode(b, want = [], far = false) {
  const skip = claimed(b);
  let best = null, bestScore = Infinity;
  for (const n of eco.publicState().nodes) {
    if (skip.has(n.id) || (want.length && !want.includes(n.kind))) continue;
    const d = Math.hypot(n.x - b.x, n.z - b.z);
    const score = far ? d - Math.abs(n.z) * 0.5 : d;
    if (score < bestScore) { best = n; bestScore = score; }
  }
  return best;
}

function startTask(b, g) {
  if (!g) return false;
  if (g.kind === "gather") {
    const n = nearestNode(b, g.want, g.far);
    if (!n) return false;
    b.task = { kind: "gather", node: n.id };
    const d = Math.hypot(b.x - n.x, b.z - n.z) || 1;
    walkTo(b, { x: n.x + ((b.x - n.x) / d) * 1.3, y: 0, z: n.z + ((b.z - n.z) / d) * 1.3 });
    return true;
  }
  if (g.kind === "sell" || g.kind === "preset") {
    b.task = { kind: g.kind, preset: g.preset };
    walkTo(b, exchangeSpot(L));
    return true;
  }
  if (g.kind === "buy") {
    const lot = lotOf(g.seller);
    if (!lot) return false;
    b.task = { kind: "buy", seller: g.seller, listing: g.listing };
    walkTo(b, kioskFront(lot));
    return true;
  }
  return false;
}

function doTask(b) {
  const task = b.task;
  b.task = null;
  b.mode = "idle"; b.timer = 1 + Math.random() * 2;
  const agent = listAvatars().find((x) => x.id === b.id);
  try {
    if (task.kind === "work") {
      const bd = buildingByRoot(task.g.root);
      if (bd) sitAt(b, task.g, bd);
    } else if (task.kind === "gather") {
      const n = eco.nodeOf(task.node);
      if (!n) return; // someone got there first
      b.yaw = Math.atan2(n.x - b.x, n.z - b.z);
      b.mode = "channel";
      b.channel = { node: task.node, kind: n.kind, t: 0, dur: economyConfig().gatherSeconds };
    } else if (task.kind === "sell") {
      const r = eco.sellToExchange(b.id, null);
      say(b, `Sold for ${r.earned} ⌬`);
    } else if (task.kind === "preset") {
      const item = eco.buyPreset(b.id, task.preset);
      say(b, `Bought a ${item.name}`, 4000);
      record({ type: "preset", agents: [b.id], what: item.name, summary: `${agent?.spec.name} bought a ${item.name} at the Exchange` });
    } else if (task.kind === "buy") {
      const out = eco.buy(b.id, task.seller, task.listing);
      if (out.item) try { placeItem(b.id, out.item.id); } catch { /* it stays in the inventory */ }
      const what = out.item ? out.item.name : `${out.listing.qty} ${out.listing.res}`;
      const seller = listAvatars().find((x) => x.id === task.seller);
      say(b, `Bought ${what}!`, 4000);
      record({ type: "trade", agents: [task.seller, b.id], what, price: out.listing.price, summary: `${agent?.spec.name} bought ${what} from ${seller?.spec.name || "someone"} for ${out.listing.price} ⌬` });
    }
  } catch { /* sold out, too poor, gone: the next goal decides */ }
}

function arrive(b) {
  if (b.task) return doTask(b);
  if (b.lotGoal) {
    const lot = lotOf(b.lotGoal);
    b.lot = b.lotGoal; b.lotGoal = null;
    if (lot) { Object.assign(b, randomLotSpot(lot)); b.yaw = yawIntoLot(lot); }
    b.mode = "idle"; b.timer = 25 + Math.random() * 25;
    const cb = b.onArrive; b.onArrive = null;
    cb?.();
    return;
  }
  if (b.goalRoot) {
    const bd = buildingByRoot(b.goalRoot);
    b.goalRoot = null;
    if (bd) {
      const spot = randomRoomSpot(bd);
      Object.assign(b, spot.pos);
      b.inside = bd.data.root; b.floor = spot.floor;
      b.yaw = yawInto(bd) + Math.PI; // face the room's terminal
      b.mode = "idle"; b.timer = 12 + Math.random() * 20;
      return;
    }
  }
  b.mode = "idle"; b.timer = 1 + Math.random() * 4;
}

function next(b, goals) {
  const g = goals[b.id];
  // Work comes before anything else: clock in, then stay at the desk.
  if ((g?.kind === "work" || g?.kind === "desk") && startWork(b, g)) return;
  if (b.inside || b.lot) { leave(b); walkTo(b, randomStreetPoint(L)); return; }
  b.task = null; b.goalRoot = null;
  if (Math.random() < 0.7 && startTask(b, g)) return;
  const r = Math.random();
  if (r < 0.2 && lotOf(b.id)) goToLot(b, b.id);
  else if (r < 0.6 && L.buildings.length) {
    const bd = L.buildings[Math.floor(Math.random() * L.buildings.length)];
    b.goalRoot = bd.data.root;
    walkTo(b, doorSpot(bd));
  } else walkTo(b, randomStreetPoint(L));
}

const fast = (id) => eco.ownsPreset(id, "runners");

function step(b, dt, goals) {
  if (b.meeting) return;
  if ((holds.get(b.id) || 0) > Date.now()) return; // a visitor is talking to it
  if (b.mode === "idle") {
    b.timer -= dt;
    if (b.timer <= 0) next(b, goals);
  } else if (b.mode === "channel") {
    const c = b.channel;
    c.t += dt;
    if (!eco.nodeOf(c.node)) { b.channel = null; b.mode = "idle"; b.timer = 0.5; return; }
    if (c.t >= c.dur) {
      b.channel = null; b.mode = "idle"; b.timer = 0.5 + Math.random();
      try { const r = eco.gather(b.id, c.node, [b.x, b.z]); say(b, `+${r.got} ${r.kind}`); } catch { /* gone */ }
    }
  } else if (b.mode === "walk") {
    const dx = b.target.x - b.x, dz = b.target.z - b.z, dist = Math.hypot(dx, dz);
    if (dist < 0.4) {
      if (b.path.length) b.target = b.path.shift();
      else arrive(b);
    } else {
      const s = Math.min(dist, b.speed * (fast(b.id) ? 1.4 : 1) * dt);
      b.x += (dx / dist) * s; b.z += (dz / dist) * s;
      b.yaw = Math.atan2(dx, dz);
    }
  }
  if (b.say && b.say.until < Date.now()) b.say = null;
}

// ── meetings: two agents passing on the street stop and talk ────────────────
const onStreet = (b) => !b.inside && !b.lot && !b.meeting && !b.lotGoal && b.mode !== "channel" && !isOutside(b) && Math.abs(b.z) < STREET;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Two agents within 8 m on the street stop, if they haven't met recently.
// life.canMeet uses the same cooldown as the meeting itself, so they never
// stop only to be turned away (the old 3 min here vs 12 min there did that).
function findMeetings() {
  if (meetingNow || !isActive()) return;
  const free = [...bots.values()].filter(onStreet);
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const a = free[i], b = free[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) > 8) continue;
      const key = [a.id, b.id].sort().join("|");
      if ((meetCooldown.get(key) || 0) > Date.now()) continue;
      meetCooldown.set(key, Date.now() + 20_000); // don't re-ask every second while they pass
      if (!canMeet(a.id, b.id).stop) continue;
      startMeeting(a, b);
      return;
    }
  }
}

async function startMeeting(a, b) {
  meetingNow = true;
  a.meeting = b.id; b.meeting = a.id;
  a.yaw = Math.atan2(b.x - a.x, b.z - a.z); b.yaw = Math.atan2(a.x - b.x, a.z - b.z);
  say(a, "…", 60_000); say(b, "…", 60_000);
  try {
    const e = await meet(a.id, b.id);
    for (const l of e.lines) {
      const sp = l.who === a.id ? a : b;
      const ms = Math.min(9000, 2500 + l.say.length * 45);
      say(sp === a ? b : a, null);
      say(sp, l.say, ms);
      await wait(ms);
    }
    if (e.invite) {
      say(a, "Come over!", 2000);
      await wait(1500);
      a.meeting = b.meeting = null;
      goToLot(a, a.id);
      goToLot(b, a.id, () => visit(a.id, b.id).then((v) => { if (v.lines[0]) say(b, v.lines[0].say, 9000); }).catch(() => {}));
    }
  } catch { /* they met moments ago (another view started it): they just walk on */ }
  finally {
    a.meeting = b.meeting = null;
    if (a.say?.text === "…") say(a, null);
    if (b.say?.text === "…") say(b, null);
    meetingNow = false;
  }
}

// ── the loop ──────────────────────────────────────────────────────────────
let last = Date.now(), meetTimer = 0, busy = false;
async function tick() {
  const now = Date.now(), dt = Math.min(1, (now - last) / 1000);
  last = now;
  if (watchers > 0) noteViewer();
  if (busy || !viewerAlive()) return; // nobody watching: the world waits
  busy = true;
  try {
    await refreshLayout();
    const ctl = controlledId(), list = listAvatars().filter((a) => a.id !== ctl);
    const live = new Set(list.map((a) => a.id));
    for (const id of bots.keys()) if (!live.has(id)) bots.delete(id); // deleted, or a player took it over
    for (const a of list) if (!bots.has(a.id)) bots.set(a.id, spawn(a));
    const goals = { ...eco.publicGoals(), ...(await work.workGoals(ctl)) };
    for (const b of bots.values()) step(b, dt, goals);
    meetTimer -= dt;
    if (meetTimer <= 0) { meetTimer = 1; findMeetings(); }
  } catch (e) { console.error("sim tick:", e.message); }
  finally { busy = false; }
}
setInterval(tick, TICK_MS).unref();

// A visitor chatting with an agent holds it still (at most a minute at a time).
export function hold(id, on) {
  if (on) holds.set(id, Date.now() + 60_000); else holds.delete(id);
  return { held: Boolean(on) };
}

// Busy in the world: talking on the street, or held by a visitor's chat.
export function busyIn(id) {
  const b = bots.get(id);
  if (b?.meeting) return "in a conversation on the street";
  if ((holds.get(id) || 0) > Date.now()) return "talking with a visitor";
  return null;
}

function where(b) {
  if (b.meeting) return "talking on the street";
  if (b.desk !== null && b.inside) return `at desk ${b.desk + 1} in ${buildingByRoot(b.inside)?.data.name || "a tower"}`;
  if (b.inside) return `inside ${buildingByRoot(b.inside)?.data.name || "a tower"}, floor ${b.floor}`;
  if (b.lot) return b.lot === b.id ? "at home" : `visiting ${lotOf(b.lot)?.agent.spec.name || "a neighbour"}'s house`;
  if (b.mode === "channel") return "gathering in the outskirts";
  return isOutside(b) ? "out in the outskirts" : "on the street";
}

// What browsers draw: positions, headings and what each agent is up to.
export function snapshot() {
  return {
    t: Date.now(),
    agents: [...bots.values()].map((b) => ({
      id: b.id, x: +b.x.toFixed(2), y: +(b.y || 0).toFixed(2), z: +b.z.toFixed(2), yaw: +b.yaw.toFixed(3),
      mode: b.mode, where: where(b), say: b.say ? { id: b.say.id, text: b.say.text } : null,
      channel: b.channel ? { kind: b.channel.kind, p: +(b.channel.t / b.channel.dur).toFixed(2) } : null,
    })),
  };
}
