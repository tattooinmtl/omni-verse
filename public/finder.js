// The location finder: you write where you want to go in a few words ("find a
// job", "resources", "buy circuit", "sell", "home", "Beam", a project's name),
// it works out the nearest place that fits and what to do there, and main.js
// walks (or flies) you to it. Everything is decided here from what the page
// already knows (desks, blocks, kiosks, the Exchange, zones, lots, agents), so
// it costs no LLM call. English and French words both work.
import * as THREE from "three";
import { deskXs } from "./layout.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();

// Words for each intent; the first that matches wins, so order matters.
const INTENTS = [
  ["sell", /\b(sell|sale|vend(re|s)?|ecoul)/],
  ["buy", /\b(buy|purchase|shop|acheter|achete|achat|magasin|boutique)\b/],
  ["job", /\b(jobs?|work|travail|travailler|emploi|job|boulot|desk|bureau|computer|terminal|ordi(nateur)?|pc|clock ?in|post a job)\b/],
  ["home", /\b(home|house|maison|chez moi|my lot|mon lot)\b/],
  ["exchange", /\b(exchange|market|bourse|marche|echange|preset)s?\b/],
  ["kiosk", /\b(kiosks?|stands?|kiosque)\b/],
  ["gather", /\b(resources?|ressources?|gather|collect|mine|ramasser|recolter|blocks?|blocs?|materials?|materiaux|loot)\b/],
  ["agent", /\b(talk|speak|parler|meet|rencontrer|agent|friend|ami)\b/],
  ["street", /\b(street|rue|downtown|centre|center|city gate)\b/],
];

const RES_WORDS = {
  scrap: /\bscraps?|ferraille|debris\b/, circuit: /\bcircuits?\b/, lumen: /\blumens?\b/,
  crystal: /\bcrystals?|cristal|cristaux\b/, plasma: /\bplasmas?\b/,
};
const PRESET_WORDS = {
  drone: /\bdrone\b/, refinery: /\brefiner(y|ie)\b/, still: /\bstill|alambic\b/, printer: /\bprinter|imprimante|fab\b/,
  runners: /\brunners?|shoes|souliers|chaussures\b/, devkit: /\bdev ?kit\b/, rack: /\b(server )?rack\b/,
};
const ZONE_WORDS = { scrapyard: /\bscrapyard|casse\b/, grove: /\bgrove\b/, garden: /\bgarden|jardin\b/, rift: /\brift\b/, vent: /\bvents?\b/ };

// What the finder can see. main.js passes it in each time, so it's always current.
// ctx: { pos, city, eco, work, avatars, npcs, self, workView }
export function resolve(query, ctx) {
  const q = norm(query);
  if (!q) return null;
  const intent = INTENTS.find(([, re]) => re.test(q))?.[0] || null;
  const res = Object.keys(RES_WORDS).find((k) => RES_WORDS[k].test(q));
  const preset = Object.keys(PRESET_WORDS).find((k) => PRESET_WORDS[k].test(q));
  const zone = Object.keys(ZONE_WORDS).find((k) => ZONE_WORDS[k].test(q));

  // A name in the request beats the generic words: "Beam", "Beam's house", "omni-verse".
  const named = byName(q, ctx, !intent && !res && !preset);
  if (named && (!intent || named.strong || intent === "agent" || intent === "home")) {
    if (named.kind === "agent" && intent === "home") return lotOf(named.rec.id, ctx, `${named.rec.spec.name}'s house`);
    return named.go;
  }
  if (zone) return zoneTarget(zone, ctx);
  switch (intent) {
    case "sell": return exchange(ctx, "sell your materials");
    case "buy": return buy(q, res, preset, ctx);
    case "job": return job(ctx);
    case "home": return ctx.self ? lotOf(ctx.self.id, ctx, "your house") : { error: "Spectators don't have a house. Try an agent's name, like \"Beam's house\"." };
    case "exchange": return exchange(ctx);
    case "kiosk": return nearestKiosk(ctx, null);
    case "gather": return gather(res, ctx);
    case "street": return { label: "the street", where: "downtown", to: V(ctx.pos.x, 0, 0) };
    case "agent": return named?.go || { error: "Who? Write the agent's name, like \"talk to Beam\"." };
  }
  if (res) return gather(res, ctx);
  if (preset) return exchange(ctx, `buy a ${ctx.eco?.presets?.[preset]?.label || preset}`);
  if (named) return named.go;
  return { error: `I don't know where "${query}" is. Try: find a job, resources, buy circuit, sell, home, exchange, an agent's or a project's name.` };
}

// ── destinations ───────────────────────────────────────────────────────────
function nearest(list, pos, at = (x) => x.at) {
  let best = null, bd = Infinity;
  for (const x of list) { const d = flat(at(x), pos); if (d < bd) { bd = d; best = x; } }
  return best;
}

// The closest free computer, in a tower with open jobs if there is one.
function job(ctx) {
  const { city, workView, work, pos } = ctx;
  const openRoots = new Set((work?.jobs || []).filter((j) => j.status === "open").map((j) => String(j.root).toLowerCase()));
  const desks = [];
  for (const b of city.buildings) {
    const n = deskXs(b).length;
    for (let i = 0; i < n; i++) {
      if (workView.occupant(b, i)) continue;
      desks.push({ b, i, at: city.doorSpot(b), jobs: openRoots.has(String(b.data.root).toLowerCase()) });
    }
  }
  if (!desks.length) return { error: "Every computer in the city is taken right now." };
  const pick = nearest(desks.filter((d) => d.jobs), pos) || nearest(desks, pos);
  const spot = workView.deskSpot(pick.b, pick.i);
  return {
    label: `terminal ${pick.i + 1} in ${pick.b.data.name}`, where: pick.jobs ? "open jobs waiting there" : "the nearest free computer",
    building: pick.b, to: spot.pos, yaw: spot.yaw + Math.PI, then: { type: "computer", b: pick.b, desk: pick.i },
  };
}

function gather(res, ctx) {
  const nodes = (ctx.eco?.nodes || []).filter((n) => !res || n.kind === res);
  const n = nearest(nodes, ctx.pos, (x) => V(x.x, 0, x.z));
  if (!n) {
    // None of that kind on the map right now: the zone where it grows.
    const zoneKind = res && Object.entries(ctx.eco?.zones || {}).sort((a, b) => (b[1].table[res] || 0) - (a[1].table[res] || 0))[0];
    if (zoneKind && zoneKind[1].table[res]) return { ...zoneTarget(zoneKind[0], ctx), where: `no ${res} block is up right now; it spawns here` };
    return { error: `No ${res || "resource"} blocks on the map right now. They spawn every few seconds.` };
  }
  const label = ctx.eco.resources[n.kind]?.label || n.kind;
  const at = V(n.x, 0, n.z);
  return { label: `a ${label} block`, where: `${n.amount} left`, to: stopShort(ctx.pos, at, 1.6), face: at, then: { type: "node", id: n.id } };
}

function zoneTarget(kind, ctx) {
  const z = nearest(ctx.city.zones.filter((x) => x.kind === kind), ctx.pos, (x) => V(x.x, 0, x.z));
  if (!z) return { error: "That zone isn't on the map." };
  return { label: ctx.eco?.zones?.[kind]?.label || kind, where: "resource zone", to: V(z.x, 0, z.z) };
}

function exchange(ctx, why = "") {
  const at = ctx.city.exchangeSpot();
  return { label: "the Omni Exchange", where: why || "sells scrap and presets, buys any resource", to: at, face: V(ctx.city.exchange.x, 0, ctx.city.exchange.z), then: { type: "exchange" } };
}

// Buying: a preset or scrap at the Exchange; anything else at the nearest kiosk that lists it.
function buy(q, res, preset, ctx) {
  if (preset) return exchange(ctx, `buy a ${ctx.eco?.presets?.[preset]?.label || preset}`);
  const thing = q.replace(/\b(i want to|i need|je veux|find|trouver|where (can i|to)|ou|buy|purchase|acheter|achete|some|des|du|de la|a|an|un|une|the|le|la|les)\b/g, " ").trim();
  const k = nearestKiosk(ctx, (l) => (res ? l.res === res : thing && l.name && norm(l.name).includes(thing)));
  // The Exchange always sells scrap: go there unless a kiosk is closer.
  if (res === "scrap" && (k.error || flat(k.to, ctx.pos) > flat(ctx.city.exchangeSpot(), ctx.pos))) return exchange(ctx, "the Exchange always sells scrap");
  if (!k.error) return k;
  if (!res || res === "scrap") return exchange(ctx, res ? "the Exchange always sells scrap" : "");
  return { error: `Nobody lists ${res} right now. Kiosks restock as agents gather; try the Exchange board to post a buy order.`, fallback: exchange(ctx, "post a buy order") };
}

function nearestKiosk(ctx, match) {
  const list = [];
  for (const [id, w] of Object.entries(ctx.eco?.wallets || {})) {
    if (!w.kiosk || id === ctx.self?.id) continue;
    const listings = w.kiosk.listings.filter((l) => !match || match(l));
    if (!listings.length) continue;
    const lot = ctx.city.lotFor(id);
    if (!lot) continue;
    const k = ctx.city.kioskLocal();
    list.push({ id, lot, listings, at: ctx.city.toWorld(lot, k.x, 0, k.z + 2.6), booth: ctx.city.toWorld(lot, k.x, 0, k.z) });
  }
  const pick = nearest(list, ctx.pos);
  if (!pick) return { error: match ? "No kiosk sells that right now." : "No kiosk is open right now." };
  const l = pick.listings.slice().sort((a, b) => a.price - b.price)[0];
  const name = pick.lot.agent.spec.name;
  return { label: `${name}'s kiosk`, where: `${l.name || `${l.qty} ${l.res}`} for ${l.price} ⌬`, to: pick.at, face: pick.booth, then: { type: "kiosk", agentId: pick.id } };
}

function lotOf(id, ctx, label) {
  const lot = ctx.city.lotFor(id);
  if (!lot) return { error: "That house isn't on Agent Row yet." };
  return { label, where: "Agent Row", to: ctx.city.toWorld(lot, 0, 0, 20), then: { type: "lot", lot } };
}

// Agents, projects (towers), houses and zones by name: the longest name found wins.
// `loose` also accepts the start of a name ("lumi" → LUMINA-RX), only when
// nothing else in the request made sense; "crystal" must stay the resource.
const compact = (s) => s.replace(/[^a-z0-9]/g, "");
function byName(q, ctx, loose) {
  const cands = [];
  for (const a of ctx.avatars) {
    if (a.id === ctx.self?.id) continue;
    cands.push({ name: norm(a.spec.name), strong: true, kind: "agent", rec: a, go: () => agentTarget(a, ctx) });
  }
  for (const b of ctx.city.buildings) {
    cands.push({ name: norm(b.data.name), strong: true, kind: "building", go: () => ({ label: b.data.name, where: `${b.n} floors · ${b.data.district || "tower"}`, building: b, to: ctx.city.lobbySpot(b), yaw: ctx.city.yawInto(b) }) });
  }
  for (const [k, z] of Object.entries(ctx.eco?.zones || {})) cands.push({ name: norm(z.label), strong: true, kind: "zone", go: () => zoneTarget(k, ctx) });
  const cq = compact(q);
  const hit = cands.filter((c) => c.name.length >= 3 && (` ${q} `.includes(` ${c.name} `) || ` ${q} `.includes(` ${c.name}'s `)
      || (compact(c.name).length >= 4 && cq.includes(compact(c.name))) || (loose && cq.length >= 4 && compact(c.name).startsWith(cq))))
    .sort((a, b) => b.name.length - a.name.length)[0];
  return hit ? { ...hit, go: hit.go() } : null;
}

function agentTarget(a, ctx) {
  const npc = ctx.npcs.find((n) => n.record.id === a.id);
  if (!npc?.mesh.visible) return { error: `${a.spec.name} isn't out in the city right now.` };
  return { label: a.spec.name, where: npc.whereabouts, to: npc.pos.clone(), follow: npc, then: { type: "agent", npc } };
}

function stopShort(from, at, d) {
  const dx = from.x - at.x, dz = from.z - at.z, l = Math.hypot(dx, dz) || 1;
  return V(at.x + (dx / l) * d, 0, at.z + (dz / l) * d);
}

// Quick picks shown under the prompt.
export const SUGGESTIONS = ["find a job", "resources", "crystal", "buy circuit", "sell", "exchange", "home", "kiosk"];
