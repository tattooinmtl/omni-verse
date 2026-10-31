// City layout as plain numbers, shared by the browser (city.js draws it) and
// the server (sim.mjs walks the agents through it). Both compute it from the
// same /api/world and the same avatar list, so they agree on every door,
// desk, lot and alley. No three.js here: points are { x, y, z } objects.

export const FH = 5;           // floor height
export const ROOM = 6;         // room cell size
export const WALL = 0.4;
export const DOOR_W = 3.2, DOOR_H = 3.4;
export const CORRIDOR = 5, MARGIN = 1.5, STREET = 14, SIDEWALK = 4;
export const LOT = 44; // agent lots on Agent Row; houses use x,z in -20..20 of it
export const DISTRICT_COLORS = ["#22e6ff", "#ff3df2", "#ff9f1c", "#39ff88", "#9d6bff", "#ffe14d"];

// Computers in a lobby: up to DESKS desks along the front wall.
export const DESKS = 4;
export const DESK_W = 1.3, DESK_PITCH = 1.5, DESK_D = 0.72, DESK_H = 0.95;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const P = (x, y, z) => ({ x, y, z });

export function computeLayout(world, agents = []) {
  const L = { buildings: [], districts: [], lots: [], length: 80 };
  const byDistrict = new Map();
  for (const b of world.buildings) {
    if (!byDistrict.has(b.district)) byDistrict.set(b.district, []);
    byDistrict.get(b.district).push(b);
  }
  let cursor = 0, di = 0;
  for (const [name, list] of byDistrict) {
    const color = DISTRICT_COLORS[di++ % DISTRICT_COLORS.length];
    L.districts.push({ name, color, x: cursor + 6 });
    cursor += 18;
    let xN = cursor, xS = cursor;
    for (const data of list) {
      const maxRooms = Math.max(1, ...data.floors.map((f) => f.rooms.length));
      const cols = clamp(Math.ceil(Math.sqrt(maxRooms * 1.3)), 2, 7);
      const rows = Math.max(2, Math.ceil(maxRooms / cols));
      const W = Math.max(16, cols * ROOM + MARGIN * 2);
      const D = Math.max(16, rows * ROOM + CORRIDOR + MARGIN * 2);
      const n = data.floors.length;
      const north = xN <= xS;
      const s = north ? 1 : -1;
      const x0 = north ? xN : xS;
      L.buildings.push({ data, color, district: name, cols, rows, W, D, n, H: n * FH, s, cx: x0 + W / 2, cz: -s * (STREET + SIDEWALK + D / 2) });
      if (north) xN += W + 8; else xS += W + 8;
    }
    cursor = Math.max(xN, xS) + 12;
  }
  // Agent Row: one lot per agent, in the order they entered the city.
  if (agents.length) {
    L.districts.push({ name: "Agent Row", color: "#ff9f1c", x: cursor + 6 });
    cursor += 18;
    [...agents].sort((a, b) => a.createdAt - b.createdAt).forEach((agent, i) => {
      const s = i % 2 === 0 ? 1 : -1;
      const x0 = cursor + Math.floor(i / 2) * (LOT + 10);
      L.lots.push({ agent, color: agent.spec.palette.glow, s, cx: x0 + LOT / 2, cz: -s * (STREET + SIDEWALK + LOT / 2), W: LOT, D: LOT });
    });
    cursor += Math.ceil(agents.length / 2) * (LOT + 10) + 12;
  }
  L.length = Math.max(cursor, 80);

  // Outskirts: beyond `outer` is open ground; alleys between blocks lead there.
  const blocks = [...L.buildings, ...L.lots];
  const deepest = Math.max(40, ...blocks.map((o) => Math.abs(o.cz) + o.D / 2));
  L.outer = deepest + 4;
  L.alleys = {};
  for (const side of [-1, 1]) {
    const spans = blocks.filter((o) => Math.sign(o.cz) === side).map((o) => [o.cx - o.W / 2 - 2, o.cx + o.W / 2 + 2]).sort((a, b) => a[0] - b[0]);
    const xs = [-50];
    let start = -40;
    for (const [a, b] of spans) {
      if (a - start >= 3) xs.push((start + a) / 2);
      start = Math.max(start, b);
    }
    xs.push(Math.max(start + 6, L.length + 25));
    L.alleys[side] = xs;
  }
  // Zones: smaller than downtown, alternating sides; the rare kinds sit farther out.
  const kinds = ["scrapyard", "grove", "garden", "rift", "vent"];
  const count = clamp(Math.round(L.length / 110) + 3, 4, 12);
  L.zones = [];
  for (let i = 0; i < count; i++) {
    const kind = kinds[i % kinds.length];
    const rare = kind === "rift" || kind === "vent";
    const dz = L.outer + 28 + ((i * 13) % 30) + (rare ? 30 : 0);
    L.zones.push({ id: `z${i}`, kind, x: -60 + (i + 0.5) * ((L.length + 120) / count), z: (i % 2 ? 1 : -1) * dz, r: 18 + ((i * 7) % 7) });
  }
  L.exchange = { x: -22, z: -21 };
  return L;
}

// Where blocks may spawn (server/economy.mjs).
export function ecoLayout(L) {
  return {
    street: { x0: -40, x1: L.length + 10, z: STREET - 2 },
    belt: { x0: -140, x1: L.length + 140, zMin: L.outer + 6, zMax: L.outer + 110 },
    zones: L.zones.map(({ id, kind, x, z, r }) => ({ id, kind, x, z, r })),
  };
}

// ── frames: a building or lot has a local frame with its door on local +z ──
export const toWorld = (b, x, y, z) => P(b.cx + b.s * x, y, b.cz + b.s * z);
export const toLocal = (b, p) => ({ x: (p.x - b.cx) * b.s, y: p.y, z: (p.z - b.cz) * b.s });
export function roomLocal(b, fi, ri) {
  const c = ri % b.cols, r = Math.floor(ri / b.cols);
  return { x: -(b.cols * ROOM) / 2 + ROOM * (c + 0.5), y: fi * FH, z: b.D / 2 - CORRIDOR - ROOM * (r + 0.5) };
}
export const yawInto = (b) => (b.s === 1 ? 0 : Math.PI);
export const yawOut = (b) => (b.s === 1 ? Math.PI : 0);
export const yawIntoLot = (lot) => (lot.s === 1 ? Math.PI : 0);

export const isOutside = (p) => Math.abs(p.z) > STREET + SIDEWALK;
const alleyNear = (L, side, x) => L.alleys[side].reduce((best, a) => (Math.abs(a - x) < Math.abs(best - x) ? a : best));

// Waypoints from one point to another that keep out of the buildings.
export function route(L, from, to) {
  const out = [];
  const fromOut = isOutside(from), toOut = isOutside(to);
  const sf = Math.sign(from.z) || 1, stt = Math.sign(to.z) || 1;
  if (fromOut && toOut && sf === stt && Math.abs(from.z) >= L.outer - 1) return [P(to.x, 0, to.z)];
  if (fromOut) {
    const a = alleyNear(L, sf, from.x);
    if (Math.abs(from.z) >= L.outer - 1) out.push(P(a, 0, sf * L.outer));
    out.push(P(a, 0, sf * (STREET - 3)));
  }
  if (toOut) {
    const b = alleyNear(L, stt, to.x);
    out.push(P(b, 0, stt * (STREET - 3)), P(b, 0, stt * L.outer));
  }
  out.push(P(to.x, 0, to.z));
  return out;
}

// ── spots (rnd() is Math.random by default; the server passes its own) ──────
export const doorSpot = (b) => toWorld(b, 0, 0, b.D / 2 + 3);
export const lobbySpot = (b) => toWorld(b, 0, 0.02, b.D / 2 - WALL - 3);
export function randomRoomSpot(b, rnd = Math.random) {
  const fi = Math.floor(rnd() * b.n);
  const rooms = b.data.floors[fi].rooms;
  if (!rooms.length) return { pos: lobbySpot(b), floor: 0 };
  const r = roomLocal(b, fi, Math.floor(rnd() * rooms.length));
  return { pos: toWorld(b, r.x, r.y + 0.02, r.z + 1.2), floor: fi };
}
export const randomStreetPoint = (L, rnd = Math.random) => P(-20 + rnd() * (L.length + 20), 0, (rnd() * 2 - 1) * (STREET - 2));
export const lotFront = (lot, rnd = Math.random) => toWorld(lot, (rnd() - 0.5) * 10, 0, LOT / 2 + 3);
export const randomLotSpot = (lot, rnd = Math.random) => toWorld(lot, (rnd() - 0.5) * 30, 0, LOT / 2 - 4 - rnd() * 6);
export const kioskLocal = () => ({ x: -LOT / 2 + 6, z: LOT / 2 + 2.2 });
export function kioskFront(lot, rnd = Math.random) { const k = kioskLocal(); return toWorld(lot, k.x + (rnd() - 0.5) * 2, 0, k.z + 2.6); }
export const exchangeSpot = (L, rnd = Math.random) => P(L.exchange.x + (rnd() - 0.5) * 3, 0, L.exchange.z + 4.5);

// ── desks ──────────────────────────────────────────────────────────────────
// Local x of each desk, numbered left to right for someone standing in the
// lobby facing them (they face local +z, so their left is +x).
export function deskXs(b) {
  const left = [], right = [];
  for (let k = 0; k < DESKS; k++) {
    const x = DOOR_W / 2 + 0.6 + DESK_W / 2 + k * DESK_PITCH;
    if (x + DESK_W / 2 <= b.W / 2 - WALL - 0.3) left.push(-x);
    if (x + DESK_W / 2 <= b.W / 2 - 2 - 1.2 - 0.3) right.push(x);
  }
  const out = [];
  while (out.length < DESKS && (left.length || right.length)) {
    if (left.length) out.push(left.shift());
    if (out.length < DESKS && right.length && out.length % 2 === 1) out.push(right.shift());
  }
  return out.sort((p, q) => q - p);
}
export const deskZ = (b) => b.D / 2 - WALL - DESK_D / 2 - 0.05;
// Where an agent stands to work at desk i, and which way it faces.
export function deskSpot(b, i) {
  const xs = deskXs(b), x = xs[Math.min(i, xs.length - 1)] ?? 0;
  return { pos: toWorld(b, x, 0.02, deskZ(b) - DESK_D / 2 - 0.55), yaw: yawOut(b) };
}
