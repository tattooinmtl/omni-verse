// The economy (docs/ECONOMY.md): neon resource blocks spawn on a timer around
// the city, agents gather them, pay for house parts with them, craft
// decorations, run kiosks and trade for credits. This module owns wallets,
// blocks and kiosks (data/economy.json) and decides each agent's goal; the
// LLM side (crafting designs, builds) lives in life.mjs.
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./config.mjs";
import { economyConfig } from "./settings.mjs";

const FILE = path.join(APP_ROOT, "data", "economy.json");

export const RESOURCES = {
  scrap: { label: "Scrap", color: "#22e6ff", base: 2, yield: [3, 4], amount: [6, 10] },
  circuit: { label: "Circuit", color: "#39ff88", base: 5, yield: [2, 2], amount: [4, 6] },
  lumen: { label: "Lumen", color: "#ff3df2", base: 8, yield: [1, 2], amount: [3, 5] },
  crystal: { label: "Crystal", color: "#9d6bff", base: 20, yield: [1, 1], amount: [2, 3], rare: true },
  plasma: { label: "Plasma", color: "#ffe14d", base: 45, yield: [1, 1], amount: [1, 2], rare: true },
};
export const KINDS = Object.keys(RESOURCES);

export const ZONES = {
  scrapyard: { label: "Scrapyard", color: "#22e6ff", table: { scrap: 70, circuit: 30 } },
  grove: { label: "Circuit Grove", color: "#39ff88", table: { circuit: 60, scrap: 25, lumen: 15 } },
  garden: { label: "Lumen Garden", color: "#ff3df2", table: { lumen: 60, circuit: 25, crystal: 15 } },
  rift: { label: "Crystal Rift", color: "#9d6bff", table: { crystal: 45, lumen: 35, plasma: 20 } },
  vent: { label: "Plasma Vent", color: "#ffe14d", table: { plasma: 35, crystal: 35, lumen: 30 } },
};
const STREET_TABLE = { scrap: 88, circuit: 12 };
const BELT_NEAR = { scrap: 60, circuit: 28, lumen: 12 };
const BELT_FAR = { scrap: 30, circuit: 28, lumen: 22, crystal: 15, plasma: 5 };

const valueOf = (cost) => Object.entries(cost).reduce((s, [k, q]) => s + (RESOURCES[k]?.base || 0) * q, 0);
export const TIERS = [
  { id: "trinket", label: "Trinket", cost: { scrap: 4, circuit: 1 }, parts: 6, size: 2 },
  { id: "sculpture", label: "Neon Sculpture", cost: { scrap: 6, circuit: 2, lumen: 2 }, parts: 10, size: 3.5 },
  { id: "relic", label: "Relic", cost: { scrap: 4, lumen: 2, crystal: 1 }, parts: 14, size: 5 },
  { id: "monument", label: "Plasma Monument", cost: { scrap: 8, crystal: 2, plasma: 1 }, parts: 18, size: 8 },
].map((t) => ({ ...t, value: Math.round(valueOf(t.cost) * 1.6) }));

export const KIOSK_COST = { credits: 20, scrap: 6 };

// Presets: equipment the Exchange sells and agents trade at kiosks. Each one
// runs an activity or a production for its owner while it is not listed.
export const PRESETS = {
  drone: { label: "Gather Drone", cost: { credits: 60, circuit: 4 }, effect: "+1 to every gather" },
  refinery: { label: "Scrap Refinery", cost: { credits: 80, scrap: 10 }, effect: "turns 4 scrap into 1 circuit every 5 min", every: 5, takes: { scrap: 4 }, makes: { circuit: 1 } },
  still: { label: "Lumen Still", cost: { credits: 110, circuit: 6 }, effect: "turns 2 circuit into 1 lumen every 8 min", every: 8, takes: { circuit: 2 }, makes: { lumen: 1 } },
  printer: { label: "Fab Printer", cost: { credits: 90, scrap: 8, circuit: 2 }, effect: "crafting costs 1 scrap less" },
  runners: { label: "Grid Runners", cost: { credits: 50, lumen: 1 }, effect: "walks 40 % faster" },
  devkit: { label: "Dev Kit", cost: { credits: 120, circuit: 3 }, effect: "+15 % pay on finished jobs" },
  rack: { label: "Server Rack", cost: { credits: 150, crystal: 2 }, effect: "sandbox runs get 30 s and 256 MB instead of 10 s and 128 MB" },
};
const presetValue = (id) => Math.round((PRESETS[id].cost.credits || 0) + valueOf(Object.fromEntries(Object.entries(PRESETS[id].cost).filter(([k]) => k !== "credits"))));
const EXCHANGE_RATE = 0.6;      // the Exchange buys at 60 % of base
const EXCHANGE_SCRAP = 4;       // and sells scrap at 2× base
const MAX_ITEMS = 24, MAX_LISTINGS = 12;
export const BUILD_RULES = "Every part costs 1 scrap; an animated part costs +1 circuit; emissive above 1.5 costs +1 lumen; " +
  "any dimension above 25 m costs +1 crystal. Parts you can't pay for are downgraded (no animation, glow 1.5, size 25) or dropped.";

// ── persistence ───────────────────────────────────────────────────────────
let st = load();
let dirty = false;
function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { wallets: s.wallets || {}, nodes: Array.isArray(s.nodes) ? s.nodes : [], layout: s.layout || null, seq: s.seq || 0, orders: Array.isArray(s.orders) ? s.orders : [] };
  } catch { return { wallets: {}, nodes: [], layout: null, seq: 0, orders: [] }; }
}
// Written to a tmp file then renamed, so a crash mid-write can't leave a torn
// economy.json; a locked file (antivirus, OneDrive) is retried, not fatal.
export function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(st));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) { dirty = true; console.error("economy: save failed:", e.message); }
}
const touch = () => { dirty = true; };
export const touchWallets = touch;
setInterval(flush, 3000).unref();
process.once("beforeExit", flush); // Ctrl+C and the tray's Exit go through shutdown() in server.mjs

const uid = (p) => `${p}${(++st.seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = ([a, b]) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
function pick(table) {
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(table)) if ((r -= w) <= 0) return k;
  return Object.keys(table)[0];
}
const has = (w, cost) => Object.entries(cost).every(([k, q]) => (w.inv[k] || 0) >= q);
const pay = (w, cost) => { for (const [k, q] of Object.entries(cost)) w.inv[k] -= q; };
export const invText = (inv) => KINDS.filter((k) => inv[k]).map((k) => `${inv[k]} ${k}`).join(", ") || "no materials";

export function wallet(id) {
  let w = st.wallets[id];
  if (!w) {
    w = st.wallets[id] = {
      credits: economyConfig().startingCredits, inv: { scrap: 12, circuit: 2 }, items: [], kiosk: null,
      stats: { gathered: 0, crafted: 0, sold: 0, bought: 0, earned: 0 },
    };
    touch();
  }
  for (const k of KINDS) w.inv[k] ||= 0;
  return w;
}

// What an agent keeps for its own builds and crafts; the rest is for sale.
function surplus(w) {
  const keep = { scrap: economyConfig().minBuildScrap + 8, circuit: 3, lumen: 3, crystal: 2, plasma: 1 };
  return Object.fromEntries(KINDS.map((k) => [k, Math.max(0, w.inv[k] - keep[k])]));
}

// ── world layout & spawning ───────────────────────────────────────────────
export function setLayout(l = {}) {
  const n = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
  const street = { x0: n(l.street?.x0, -40), x1: n(l.street?.x1, 100), z: Math.abs(n(l.street?.z, 12)) };
  const zMin = Math.abs(n(l.belt?.zMin, 80));
  const belt = { x0: n(l.belt?.x0, -120), x1: n(l.belt?.x1, 220), zMin, zMax: Math.max(zMin + 10, Math.abs(n(l.belt?.zMax, 170))) };
  belt.zFar = (belt.zMin + belt.zMax) / 2;
  const zones = (Array.isArray(l.zones) ? l.zones : []).slice(0, 24).filter((z) => ZONES[z?.kind])
    .map((z) => ({ id: String(z.id).slice(0, 24), kind: z.kind, x: n(z.x), z: n(z.z), r: clamp(n(z.r, 20), 6, 40) }));
  st.layout = { street, belt, zones };
  st.nodes = st.nodes.filter(inLayout);
  touch();
  return { ok: true, nodes: st.nodes.length };
}

function inLayout(node) {
  const L = st.layout;
  if (!L) return false;
  if (node.where === "zone") return L.zones.some((z) => z.id === node.zone && Math.hypot(node.x - z.x, node.z - z.z) <= z.r);
  if (node.where === "street") return node.x >= L.street.x0 && node.x <= L.street.x1 && Math.abs(node.z) <= L.street.z;
  return node.x >= L.belt.x0 && node.x <= L.belt.x1 && Math.abs(node.z) >= L.belt.zMin && Math.abs(node.z) <= L.belt.zMax;
}

function spawnOne() {
  const L = st.layout, c = economyConfig();
  const r = Math.random();
  let x, z, table, where, zone = null;
  if (r < c.streetShare) {
    where = "street";
    x = rand(L.street.x0, L.street.x1);
    z = rand(-L.street.z, L.street.z);
    table = STREET_TABLE;
  } else if (L.zones.length && r < c.streetShare + c.zoneShare) {
    where = "zone";
    zone = L.zones[Math.floor(Math.random() * L.zones.length)];
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * zone.r * 0.85;
    x = zone.x + Math.cos(a) * d;
    z = zone.z + Math.sin(a) * d;
    table = ZONES[zone.kind].table;
  } else {
    where = "belt";
    const dz = rand(L.belt.zMin, L.belt.zMax);
    x = rand(L.belt.x0, L.belt.x1);
    z = (Math.random() < 0.5 ? -1 : 1) * dz;
    table = dz > L.belt.zFar ? BELT_FAR : BELT_NEAR;
  }
  const kind = pick(table);
  st.nodes.push({ id: uid("n"), kind, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, amount: randInt(RESOURCES[kind].amount), where, zone: zone?.id || null, t: Date.now() });
}

let lastSpawn = 0;
export function spawnTick() {
  const c = economyConfig();
  if (!c.enabled || !st.layout) return;
  const now = Date.now(), life = c.nodeLifeMin * 60_000, before = st.nodes.length;
  st.nodes = st.nodes.filter((n) => now - n.t < life * (RESOURCES[n.kind]?.rare ? 0.6 : 1));
  if (st.nodes.length !== before) touch();
  if (now - lastSpawn < c.spawnEverySec * 1000) return;
  lastSpawn = now;
  // A burst while the map is nearly empty, so a fresh world isn't barren.
  const n = st.nodes.length < c.maxNodes * 0.3 ? Math.max(4, Math.ceil(c.maxNodes * 0.1)) : 1;
  for (let i = 0; i < n && st.nodes.length < c.maxNodes; i++) spawnOne();
  touch();
}

// ── actions ───────────────────────────────────────────────────────────────
export function gather(agentId, nodeId, pos) {
  const c = economyConfig();
  if (!c.enabled) throw err("the economy is switched off", 409);
  const node = st.nodes.find((n) => n.id === nodeId);
  if (!node) throw err("that block is gone", 404);
  if (!Array.isArray(pos) || !(Math.hypot(Number(pos[0]) - node.x, Number(pos[1]) - node.z) <= 4.5)) throw err("too far from the block", 409);
  const w = wallet(agentId), now = Date.now();
  if (now - (w.gatherAt || 0) < (c.gatherSeconds - 0.3) * 1000) throw err("still gathering", 429);
  w.gatherAt = now;
  const got = Math.min(node.amount, randInt(RESOURCES[node.kind].yield) + (ownsPreset(agentId, "drone") ? 1 : 0));
  node.amount -= got;
  if (node.amount <= 0) st.nodes = st.nodes.filter((n) => n !== node);
  w.inv[node.kind] += got;
  w.stats.gathered += got;
  touch();
  return { kind: node.kind, got, left: node.amount, inv: w.inv };
}

// Sell one resource, or (no kind) everything above the agent's reserve.
export function sellToExchange(agentId, kind, qty) {
  const w = wallet(agentId);
  let plan;
  if (kind) {
    if (!RESOURCES[kind]) throw err("unknown resource");
    plan = { [kind]: clamp(Math.floor(Number(qty ?? w.inv[kind]) || 0), 0, w.inv[kind]) };
  } else plan = surplus(w);
  let earned = 0;
  const sold = {};
  for (const [k, n] of Object.entries(plan)) {
    if (n <= 0) continue;
    w.inv[k] -= n;
    sold[k] = n;
    earned += Math.max(1, Math.round(RESOURCES[k].base * EXCHANGE_RATE * n));
  }
  if (!earned) throw err("nothing to sell");
  w.credits += earned;
  w.stats.earned += earned;
  touch();
  return { sold, earned, credits: w.credits, inv: w.inv };
}

export function buyFromExchange(agentId, qty) {
  const w = wallet(agentId);
  const n = clamp(Math.floor(Number(qty) || 0), 1, 50), price = n * EXCHANGE_SCRAP;
  if (w.credits < price) throw err(`not enough credits (${price} ⌬)`, 402);
  w.credits -= price;
  w.inv.scrap += n;
  touch();
  return { bought: n, price, credits: w.credits, inv: w.inv };
}

export function openKiosk(agentId) {
  const w = wallet(agentId);
  if (w.kiosk) return w.kiosk;
  if (w.credits < KIOSK_COST.credits || w.inv.scrap < KIOSK_COST.scrap) {
    throw err(`a kiosk costs ${KIOSK_COST.credits} ⌬ and ${KIOSK_COST.scrap} scrap`, 402);
  }
  w.credits -= KIOSK_COST.credits;
  w.inv.scrap -= KIOSK_COST.scrap;
  w.kiosk = { openedAt: Date.now(), listings: [] };
  touch();
  return w.kiosk;
}

const priceOr = (p, value) => {
  const n = Math.round(Number(p));
  return Number.isFinite(n) && n > 0 ? Math.min(100_000, n) : Math.max(1, Math.round(value));
};

// Listed goods leave the inventory (escrow) until sold or unlisted.
export function listOnKiosk(agentId, { res, qty, item, price } = {}) {
  const w = wallet(agentId);
  if (!w.kiosk) throw err("open a kiosk first", 409);
  if (w.kiosk.listings.length >= MAX_LISTINGS) throw err("the kiosk is full", 409);
  let l;
  if (item) {
    const it = w.items.find((i) => i.id === item);
    if (!it) throw err("you don't own that item", 404);
    if (it.listed) throw err("already for sale", 409);
    l = { id: uid("l"), item: it.id, name: it.name, tier: it.tier, price: priceOr(price, it.value * 1.3), t: Date.now() };
    it.listed = l.id;
  } else {
    if (!RESOURCES[res]) throw err("unknown resource");
    const n = clamp(Math.floor(Number(qty) || 0), 0, w.inv[res]);
    if (n < 1) throw err(`no ${res} to list`, 409);
    w.inv[res] -= n;
    l = { id: uid("l"), res, qty: n, price: priceOr(price, RESOURCES[res].base * n * 1.3), t: Date.now() };
  }
  w.kiosk.listings.push(l);
  touch();
  return l;
}

export function unlist(agentId, listingId) {
  const w = wallet(agentId);
  const l = w.kiosk?.listings.find((x) => x.id === listingId);
  if (!l) throw err("no such listing", 404);
  w.kiosk.listings = w.kiosk.listings.filter((x) => x !== l);
  if (l.item) { const it = w.items.find((i) => i.id === l.item); if (it) delete it.listed; } else w.inv[l.res] += l.qty;
  touch();
  return { ok: true };
}

export function buy(buyerId, sellerId, listingId) {
  if (buyerId === sellerId) throw err("that's your own kiosk", 409);
  const s = wallet(sellerId), b = wallet(buyerId);
  const l = s.kiosk?.listings.find((x) => x.id === listingId);
  if (!l) throw err("already sold", 404);
  if (b.credits < l.price) throw err(`not enough credits (${l.price} ⌬)`, 402);
  let item = null;
  if (l.item) {
    const i = s.items.findIndex((x) => x.id === l.item);
    if (i < 0) throw err("already sold", 404);
    if (b.items.length >= MAX_ITEMS) throw err("your inventory is full", 409);
    item = s.items.splice(i, 1)[0];
    delete item.listed;
    item.bought = true;
    b.items.push(item);
  } else b.inv[l.res] += l.qty;
  s.kiosk.listings = s.kiosk.listings.filter((x) => x !== l);
  b.credits -= l.price;
  s.credits += l.price;
  s.stats.sold++;
  s.stats.earned += l.price;
  b.stats.bought++;
  touch();
  return { listing: l, item, credits: b.credits };
}

// ── crafting & building costs ─────────────────────────────────────────────
export function craftTier(agentId) {
  const w = wallet(agentId);
  if (w.items.length >= MAX_ITEMS) return null;
  return [...TIERS].reverse().find((t) => has(w, t.cost)) || null;
}

export function finishCraft(agentId, tier, design) {
  const w = wallet(agentId);
  if (!has(w, tier.cost)) throw err("the materials ran out", 409);
  pay(w, tier.cost);
  if (ownsPreset(agentId, "printer") && tier.cost.scrap) w.inv.scrap++;
  const item = { id: uid("i"), tier: tier.id, value: tier.value, maker: agentId, madeAt: Date.now(), ...design };
  w.items.push(item);
  w.stats.crafted++;
  w.lastCraft = Date.now();
  touch();
  return item;
}

export function takeItem(agentId, itemId) {
  const w = wallet(agentId);
  const it = w.items.find((i) => i.id === itemId);
  if (!it) throw err("you don't own that item", 404);
  if (it.preset) throw err("a preset is equipment: keep it, or list it at your kiosk", 409);
  if (it.listed) throw err("take it off your kiosk first", 409);
  w.items = w.items.filter((i) => i !== it);
  touch();
  return it;
}

export const canBuild = (id) => {
  const c = economyConfig();
  return !c.enabled || wallet(id).inv.scrap >= Math.max(1, c.minBuildScrap);
};
export const affordableParts = (id) => (economyConfig().enabled ? wallet(id).inv.scrap : Infinity);

// Charges a build and downgrades the parts the agent can't pay for.
export function chargeBuild(agentId, parts) {
  if (!economyConfig().enabled) return parts;
  const w = wallet(agentId), out = [];
  for (const p0 of parts) {
    if (w.inv.scrap < 1) break;
    const p = { ...p0, size: [...p0.size] };
    w.inv.scrap--;
    if (p.anim !== "none") { if (w.inv.circuit > 0) w.inv.circuit--; else p.anim = "none"; }
    if (p.emissive > 1.5) { if (w.inv.lumen > 0) w.inv.lumen--; else p.emissive = 1.5; }
    if (Math.max(...p.size) > 25) { if (w.inv.crystal > 0) w.inv.crystal--; else p.size = p.size.map((v) => Math.min(25, v)); }
    out.push(p);
  }
  touch();
  return out;
}

// ── goals & autonomous trading ────────────────────────────────────────────
const goals = new Map();

let liveIds = null; // set by manage(): kiosks of deleted agents are not offered
function listings(exceptId) {
  const out = [];
  for (const [id, w] of Object.entries(st.wallets)) {
    if (id === exceptId || !w.kiosk || (liveIds && !liveIds.has(id))) continue;
    for (const l of w.kiosk.listings) out.push({ seller: id, l });
  }
  return out;
}

function decide(id, w, score, c) {
  if (w.inv.scrap < c.minBuildScrap) return { kind: "gather", want: ["scrap"], why: `needs ${c.minBuildScrap - w.inv.scrap} more scrap to keep building` };
  if (w.credits < 12 && valueOf(surplus(w)) >= 6) return { kind: "sell", why: "low on credits: selling surplus at the Exchange" };
  const best = TIERS.indexOf(craftTier(id));
  const target = TIERS[Math.min(TIERS.length - 1, best + 1)];
  const missing = Object.keys(target.cost).filter((k) => w.inv[k] < target.cost[k]);
  const market = listings(id);
  for (const k of missing.filter((m) => !RESOURCES[m].rare)) {
    const offer = market.filter((o) => o.l.res === k && o.l.price <= w.credits - 5).sort((a, b) => a.l.price / a.l.qty - b.l.price / b.l.qty)[0];
    if (offer) return { kind: "buy", seller: offer.seller, listing: offer.l.id, why: `buying ${k} for a ${target.label}` };
  }
  const rare = missing.filter((m) => RESOURCES[m].rare);
  if (rare.length) return { kind: "gather", want: rare, far: true, why: `heading to the outskirts for ${rare.join(" and ")} (${target.label})` };
  if (missing.length) return { kind: "gather", want: missing, why: `gathering ${missing.join(" and ")} for a ${target.label}` };
  const spare = { ...w, credits: w.credits - 25 };
  const want = Object.keys(PRESETS).find((p) => !ownsPreset(id, p) && canAfford(spare, PRESETS[p].cost));
  if (want && w.items.length < MAX_ITEMS) return { kind: "preset", preset: want, why: `buying a ${PRESETS[want].label} at the Exchange (${PRESETS[want].effect})` };
  if (w.credits >= 70 && w.items.length < MAX_ITEMS) {
    const items = market.filter((o) => o.l.item && o.l.price <= w.credits - 20 && score(id, o.seller) >= 0);
    const o = items[Math.floor(Math.random() * items.length)];
    if (o) return { kind: "buy", seller: o.seller, listing: o.l.id, why: `wants ${o.l.name} for the house` };
  }
  return { kind: "gather", want: ["plasma", "crystal", "lumen", "circuit", "scrap"], far: Math.random() < 0.5, why: "exploring for anything valuable" };
}

function stillValid(g, w, c) {
  if (Date.now() - g.at > 45_000) return false;
  if (g.kind === "preset") return !w.items.some((i) => i.preset === g.preset && !i.listed);
  if (g.kind === "buy") return Boolean(st.wallets[g.seller]?.kiosk?.listings.some((l) => l.id === g.listing));
  if (g.kind === "gather" && g.want.length === 1 && g.want[0] === "scrap") return w.inv.scrap < c.minBuildScrap;
  return true;
}

// Every few seconds: open kiosks, list goods, drop stale prices, set goals.
// Returns journal-worthy events for life.mjs to record.
// `manual(id)` is true for the avatar a player controls: it still gets a goal
// (shown as the player's objective) but its kiosk is left to the player.
export function manage(agents, score, manual = () => false) {
  const c = economyConfig();
  if (!c.enabled) { goals.clear(); return []; }
  liveIds = new Set(agents.map((a) => a.id));
  const events = [];
  for (const a of agents) produce(a, events);
  tradeOrders(agents, events, manual);
  for (const a of agents) {
    try { manageOne(a, score, c, events, manual(a.id)); } catch { /* a refused listing just waits for the next pass */ }
  }
  return events;
}

function manageOne(a, score, c, events, manual) {
  const w = wallet(a.id);
  const forSale = w.items.filter((i) => !i.listed && !i.bought);
  const sur = surplus(w);
  if (manual) {
    const g = goals.get(a.id);
    if (!g || !stillValid(g, w, c)) goals.set(a.id, { ...decide(a.id, w, score, c), at: Date.now() });
    return;
  }
  if (!w.kiosk && (forSale.length || valueOf(sur) > 30) && w.credits >= KIOSK_COST.credits + 10 && w.inv.scrap >= KIOSK_COST.scrap + c.minBuildScrap) {
    openKiosk(a.id);
    events.push({ type: "kiosk", agents: [a.id], summary: `${a.spec.name} opened a kiosk on Agent Row` });
  }
  if (w.kiosk && w.kiosk.listings.length < 8) {
    // One new listing per pass, so a kiosk fills up gradually.
    if (forSale.length) listOnKiosk(a.id, { item: forSale[0].id, price: forSale[0].value * rand(1.15, 1.5) });
    else {
      const k = KINDS.find((r) => sur[r] >= 3);
      if (k) { const n = Math.min(sur[k], 6); listOnKiosk(a.id, { res: k, qty: n, price: RESOURCES[k].base * n * rand(1.2, 1.5) }); }
    }
  }
  for (const l of w.kiosk?.listings || []) {
    // Price cuts stop just above what the Exchange pays, so buying a listing
    // and selling it straight back to the Exchange is never free money.
    const floor = l.res ? Math.max(1, Math.round(RESOURCES[l.res].base * EXCHANGE_RATE * l.qty) + 1) : 1;
    if (Date.now() - l.t > 15 * 60_000 && Date.now() - (l.cut || 0) > 5 * 60_000 && l.price > floor) { l.price = Math.max(floor, Math.round(l.price * 0.85)); l.cut = Date.now(); touch(); }
  }
  const g = goals.get(a.id);
  if (!g || !stillValid(g, w, c)) goals.set(a.id, { ...decide(a.id, w, score, c), at: Date.now() });
}

// ── buy orders ────────────────────────────────────────────────────────────
// The demand side of the market, on the Exchange's order board: "WANT 4
// circuit at 6 ⌬ each". The credits are held in escrow; anyone with the goods
// fills an order (all or part of it); unfilled orders refund after 30 minutes.
const ORDER_LIFE = 30 * 60_000, MAX_ORDERS = 40, ORDERS_EACH = 3;

export function postOrder(buyerId, res, qty, each) {
  if (!RESOURCES[res]) throw err("unknown resource");
  const w = wallet(buyerId);
  const n = clamp(Math.floor(Number(qty) || 0), 1, 30);
  // An order never pays less than the Exchange, so nobody sells into it at a loss.
  const price = clamp(Math.round(Number(each) || RESOURCES[res].base), Math.ceil(RESOURCES[res].base * EXCHANGE_RATE) + 1, RESOURCES[res].base * 4);
  if (st.orders.filter((o) => o.buyer === buyerId).length >= ORDERS_EACH) throw err(`at most ${ORDERS_EACH} open orders each`, 409);
  if (st.orders.length >= MAX_ORDERS) throw err("the order board is full", 409);
  if (w.credits < n * price) throw err(`not enough credits to escrow ${n * price} ⌬`, 402);
  w.credits -= n * price;
  const o = { id: uid("o"), buyer: buyerId, res, qty: n, price, t: Date.now() };
  st.orders.push(o);
  touch();
  return o;
}

export function fillOrder(sellerId, orderId, qty) {
  const o = st.orders.find((x) => x.id === orderId);
  if (!o) throw err("that order is gone", 404);
  if (o.buyer === sellerId) throw err("that's your own order", 409);
  const s = wallet(sellerId), b = wallet(o.buyer);
  const n = clamp(Math.floor(Number(qty ?? o.qty) || 0), 1, Math.min(o.qty, s.inv[o.res]));
  if (!n || s.inv[o.res] < 1) throw err(`you have no ${o.res}`, 409);
  s.inv[o.res] -= n;
  b.inv[o.res] += n;
  s.credits += n * o.price;
  s.stats.earned += n * o.price;
  s.stats.sold++;
  b.stats.bought++;
  o.qty -= n;
  if (o.qty <= 0) st.orders = st.orders.filter((x) => x !== o);
  touch();
  return { order: o, qty: n, earned: n * o.price, buyer: o.buyer, res: o.res };
}

export function cancelOrder(buyerId, orderId) {
  const o = st.orders.find((x) => x.id === orderId && x.buyer === buyerId);
  if (!o) throw err("no such order", 404);
  wallet(buyerId).credits += o.qty * o.price;
  st.orders = st.orders.filter((x) => x !== o);
  touch();
  return { ok: true };
}

// Expire old orders, let agents post what they lack and fill what others want.
function tradeOrders(agents, events, manual) {
  const now = Date.now();
  for (const o of [...st.orders]) {
    if (now - o.t > ORDER_LIFE || (liveIds && !liveIds.has(o.buyer))) {
      if (st.wallets[o.buyer]) st.wallets[o.buyer].credits += o.qty * o.price;
      st.orders = st.orders.filter((x) => x !== o);
      touch();
    }
  }
  for (const a of agents) {
    if (manual(a.id)) continue;
    const w = wallet(a.id), sur = surplus(w);
    for (const o of st.orders) {
      if (o.buyer === a.id || sur[o.res] < 1) continue;
      try {
        const r = fillOrder(a.id, o.id, Math.min(sur[o.res], o.qty));
        const buyer = agents.find((x) => x.id === r.buyer);
        events.push({ type: "trade", agents: [a.id, r.buyer], what: `${r.qty} ${r.res}`, price: r.earned, summary: `${a.spec.name} filled ${buyer?.spec.name || "someone"}'s order: ${r.qty} ${r.res} for ${r.earned} ⌬` });
        break;
      } catch { /* filled meanwhile */ }
    }
    // Want something common for the next craft and nobody lists it: order it.
    const target = TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(craftTier(a.id)) + 1)];
    const need = Object.keys(target.cost).find((k) => !RESOURCES[k].rare && w.inv[k] < target.cost[k]);
    if (need && !st.orders.some((o) => o.buyer === a.id && o.res === need) && !listings(a.id).some((x) => x.l.res === need)) {
      const qty = target.cost[need] - w.inv[need];
      const each = Math.round(RESOURCES[need].base * 1.15);
      if (w.credits - qty * each >= 15) try { postOrder(a.id, need, qty, each); } catch { /* board full */ }
    }
  }
}

// ── presets ───────────────────────────────────────────────────────────────
export const ownsPreset = (id, preset) => Boolean(st.wallets[id]?.items.some((i) => i.preset === preset && !i.listed));
const canAfford = (w, cost) => {
  const { credits = 0, ...res } = cost;
  return w.credits >= credits && has(w, res);
};

export function buyPreset(agentId, preset) {
  const P = PRESETS[preset];
  if (!P) throw err("unknown preset", 404);
  const w = wallet(agentId);
  if (w.items.length >= MAX_ITEMS) throw err("your inventory is full", 409);
  const { credits = 0, ...res } = P.cost;
  if (!canAfford(w, P.cost)) throw err(`a ${P.label} costs ${credits} ⌬ and ${invText(res)}`, 402);
  w.credits -= credits;
  pay(w, res);
  const item = { id: uid("i"), tier: "preset", preset, name: P.label, description: P.effect, value: presetValue(preset), maker: "exchange", madeAt: Date.now(), parts: [], lastRun: Date.now() };
  w.items.push(item);
  touch();
  return item;
}

// Productions: every refinery or still turns inputs into outputs on its timer.
function produce(a, events) {
  const w = st.wallets[a.id];
  if (!w) return;
  for (const it of w.items) {
    const P = it.preset && PRESETS[it.preset];
    if (!P?.every || it.listed || Date.now() - (it.lastRun || 0) < P.every * 60_000) continue;
    it.lastRun = Date.now();
    touch();
    if (!has(w, P.takes)) continue;
    pay(w, P.takes);
    for (const [k, q] of Object.entries(P.makes)) w.inv[k] += q;
    events.push({ type: "produce", agents: [a.id], summary: `${a.spec.name}'s ${P.label} made ${invText(P.makes)}` });
  }
}

// Wages for finished jobs: new credits from whoever posted the work.
// Credits from one agent to another (a hire on a hobby project).
export function transfer(fromId, toId, amount) {
  const from = wallet(fromId), to = wallet(toId), n = Math.max(0, Math.min(from.credits, Math.round(amount)));
  from.credits -= n;
  to.credits += n;
  to.stats.earned += n;
  touch();
  return n;
}

export function payWages(agentId, amount) {
  const w = wallet(agentId), n = Math.max(0, Math.round(amount));
  w.credits += n;
  w.stats.earned += n;
  w.stats.jobs = (w.stats.jobs || 0) + 1;
  touch();
  return w.credits;
}

export const publicGoals = () => Object.fromEntries(goals);
export const nodeOf = (id) => st.nodes.find((n) => n.id === id) || null;

// For the headless loop: the nearest suitable block, by kind preference.
export function nearestNodeOf(want = [], far = false) {
  const pool = st.nodes.filter((n) => !want.length || want.includes(n.kind));
  if (!pool.length) return null;
  const score = (n) => (far ? -Math.abs(n.z) : Math.abs(n.z)) + Math.random() * 20;
  return pool.sort((x, y) => score(x) - score(y))[0];
}

export function ecoContext(id) {
  if (!economyConfig().enabled) return "";
  const w = wallet(id), g = goals.get(id);
  return ` You have ${w.credits} credits and ${invText(w.inv)}.` +
    (w.items.length ? ` You own ${w.items.length} crafted decorations (${w.items.slice(-4).map((i) => i.name).join(", ")}).` : "") +
    (w.kiosk ? ` You run a kiosk with ${w.kiosk.listings.length} things for sale.` : "") +
    (g ? ` Your current goal: ${g.why}.` : "");
}

export function publicState() {
  const c = economyConfig();
  return {
    enabled: c.enabled, gatherSeconds: c.gatherSeconds, minBuildScrap: c.minBuildScrap,
    resources: RESOURCES, tiers: TIERS, zones: ZONES, kioskCost: KIOSK_COST, presets: PRESETS,
    exchange: { rate: EXCHANGE_RATE, scrapPrice: EXCHANGE_SCRAP },
    nodes: st.nodes.map(({ id, kind, x, z, amount }) => ({ id, kind, x, z, amount })),
    wallets: Object.fromEntries(Object.entries(st.wallets).map(([id, w]) => [id, {
      credits: w.credits, inv: w.inv, stats: w.stats,
      items: w.items.map(({ id: iid, name, description, tier, value, listed, bought, maker, preset }) => ({ id: iid, name, description, tier, value, listed: Boolean(listed), bought: Boolean(bought), maker, preset })),
      kiosk: w.kiosk ? { listings: w.kiosk.listings.map(({ id: lid, res, qty, item, name, tier, price }) => ({ id: lid, res, qty, item, name, tier, price })) } : null,
    }])),
    goals: Object.fromEntries(goals),
    orders: st.orders.map(({ id, buyer, res, qty, price, t }) => ({ id, buyer, res, qty, price, t })),
  };
}
