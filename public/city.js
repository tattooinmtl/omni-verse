import * as THREE from "three";
import { disposeObject, makeLabel } from "./labels.js";
import { buildHouse } from "./house.js";
import * as layoutMath from "./layout.js";
import { DOOR_H, DOOR_W, FH, LOT, ROOM, STREET, WALL, computeLayout } from "./layout.js";

// The street runs along +x at z=0. Buildings stand on both sides with their
// door facing the street. Each building has a local frame (door on local +z);
// south-side buildings are rotated 180°, so local→world is (cx + s·x, cz + s·z).

// The numbers (where every building, lot, alley and zone goes) live in
// layout.js, shared with the server's simulation; this file draws them.
export { DOOR_H, DOOR_W, FH, ROOM, WALL };
const V = (p) => new THREE.Vector3(p.x, p.y || 0, p.z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function activity(ms) {
  const age = (Date.now() - ms) / 86400000;
  return age < 1 ? 1 : age < 7 ? 0.65 : age < 30 ? 0.4 : age < 180 ? 0.22 : 0.12;
}

const glow = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

export class City {
  constructor(scene, world, agents = []) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildings = [];
    this.districts = [];
    this.extraColliders = [];
    this.doorHits = [];
    this.blinkers = [];
    this.cycles = [];
    this.lots = [];
    this.layout(world, agents);
    this.buildGround();
    this.buildBuildings();
    this.buildDistrictGates();
    this.buildCycles();
    this.buildLots();
  }

  // ── layout ──────────────────────────────────────────────────────────────
  layout(world, agents) {
    const L = computeLayout(world, agents);
    this.L = L;
    for (const b of L.buildings) b.interior = null;
    for (const lot of L.lots) Object.assign(lot, { house: null, version: -1, colliders: [] });
    Object.assign(this, { buildings: L.buildings, districts: L.districts, lots: L.lots, length: L.length, outer: L.outer, alleys: L.alleys, zones: L.zones, exchange: L.exchange });
  }

  isOutside(p) { return layoutMath.isOutside(p); }
  route(from, to) { return layoutMath.route(this.L, from, to).map(V); }

  exchangeSpot() { return V(layoutMath.exchangeSpot(this.L)); }
  kioskLocal() { return layoutMath.kioskLocal(); }
  kioskFront(lot) { return V(layoutMath.kioskFront(lot)); }

  toWorld(b, x, y, z, out = new THREE.Vector3()) { return out.set(b.cx + b.s * x, y, b.cz + b.s * z); }
  toLocal(b, p) { return { x: (p.x - b.cx) * b.s, y: p.y, z: (p.z - b.cz) * b.s }; }
  box(b, x0, y0, z0, x1, y1, z1) {
    const a = this.toWorld(b, x0, y0, z0), c = this.toWorld(b, x1, y1, z1);
    return { min: [Math.min(a.x, c.x), y0, Math.min(a.z, c.z)], max: [Math.max(a.x, c.x), y1, Math.max(a.z, c.z)] };
  }
  roomLocal(b, fi, ri) { return layoutMath.roomLocal(b, fi, ri); }
  elevatorLocal(b, fi) { return { x: b.W / 2 - 2, y: fi * FH, z: b.D / 2 - WALL - 0.15 }; }

  // ── ground, sky-level props ─────────────────────────────────────────────
  buildGround() {
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLen: { value: this.length } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        uniform float uTime; uniform float uLen; varying vec3 vW;
        float grid(vec2 p, float s, float w){ vec2 q=p/s; vec2 g=abs(fract(q-0.5)-0.5)/fwidth(q); return 1.0-min(min(g.x,g.y)/w,1.0); }
        void main(){
          float d = length(cameraPosition.xz - vW.xz);
          vec3 cyan = vec3(0.08,0.75,0.95);
          vec3 col = vec3(0.003,0.01,0.018) + cyan*(grid(vW.xz,4.0,1.0)*0.22 + grid(vW.xz,20.0,1.4)*0.55);
          float z = abs(vW.z);
          float onStreet = step(vW.x, uLen+40.0) * step(-60.0, vW.x);
          col = mix(col, col*0.35, step(z,14.0)*onStreet);
          col += vec3(1.0,0.24,0.95)*(1.0-smoothstep(0.0,0.22,abs(z-14.0)))*1.6*onStreet;
          col += vec3(0.1,0.9,1.0)*(1.0-smoothstep(0.0,0.15,abs(z-18.0)))*0.9*onStreet;
          float dash = step(0.5, fract(vW.x/10.0));
          col += vec3(1.0,0.7,0.25)*(1.0-smoothstep(0.0,0.12,z))*dash*onStreet;
          float pulse = (1.0-smoothstep(0.0,3.0,abs(mod(vW.x - uTime*30.0, 160.0)-80.0)))*step(z,14.0)*onStreet;
          col += cyan*pulse*0.25;
          float fog = smoothstep(60.0, 650.0, d);
          gl_FragColor = vec4(mix(col, vec3(0.004,0.012,0.022), fog), 1.0);
        }`,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);
  }

  buildBuildings() {
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0x02101a, emissive: 0x011018, metalness: 0.85, roughness: 0.3,
      transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
    });
    let windowCount = 0, slabCount = 0;
    for (const b of this.buildings) { windowCount += b.n * 4; slabCount += b.n; }
    const windows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }), windowCount);
    const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x041722, emissive: 0x020c12, metalness: 0.6, roughness: 0.5 }), slabCount);
    const dummy = new THREE.Object3D();
    let wi = 0, si = 0;
    const doorGeo = new THREE.BoxGeometry(DOOR_W, DOOR_H, 1.6);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });

    for (const b of this.buildings) {
      const hw = b.W / 2, hd = b.D / 2;
      const g = new THREE.Group();
      g.position.set(b.cx, 0, b.cz);
      g.rotation.y = b.s === 1 ? 0 : Math.PI;
      this.group.add(g);
      b.group = g;

      const shell = new THREE.Mesh(new THREE.BoxGeometry(b.W, b.H, b.D), shellMat);
      shell.position.y = b.H / 2;
      shell.renderOrder = 2;
      g.add(shell);

      // Neon edges: corners, a ring per floor, the door frame.
      const v = [];
      const seg = (x0, y0, z0, x1, y1, z1) => v.push(x0, y0, z0, x1, y1, z1);
      for (const [x, z] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) seg(x, 0, z, x, b.H, z);
      for (let i = 0; i <= b.n; i++) {
        const y = i * FH;
        seg(-hw, y, -hd, hw, y, -hd); seg(hw, y, -hd, hw, y, hd); seg(hw, y, hd, -hw, y, hd); seg(-hw, y, hd, -hw, y, -hd);
      }
      const dz = hd + 0.02;
      seg(-DOOR_W / 2, 0, dz, -DOOR_W / 2, DOOR_H, dz); seg(DOOR_W / 2, 0, dz, DOOR_W / 2, DOOR_H, dz); seg(-DOOR_W / 2, DOOR_H, dz, DOOR_W / 2, DOOR_H, dz);
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      g.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: glow(b.color, 2.2) })));

      // Door portal + its interaction hitbox (works from both sides).
      const portal = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, DOOR_H),
        new THREE.MeshBasicMaterial({ color: glow(b.color, 1.2), transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      portal.position.set(0, DOOR_H / 2, hd + 0.03);
      g.add(portal);
      const hit = new THREE.Mesh(doorGeo, hitMat);
      hit.position.set(0, DOOR_H / 2, hd);
      hit.userData.interact = { type: "door", b };
      g.add(hit);
      b.doorHit = hit;

      // Facade window bands: brightness = how recently that floor changed.
      const faces = [[0, hd + 0.04, 0, b.W - 2], [0, -hd - 0.04, Math.PI, b.W - 2], [-hw - 0.04, 0, -Math.PI / 2, b.D - 2], [hw + 0.04, 0, Math.PI / 2, b.D - 2]];
      b.data.floors.forEach((f, fi) => {
        const col = glow(b.color, 0.12 + activity(f.last) * 1.1);
        for (const [x, z, rot, width] of faces) {
          const y = fi * FH + FH * 0.55;
          const isDoor = fi === 0 && rot === 0;
          const p = this.toWorld(b, x, y + (isDoor ? 0.9 : 0), z);
          dummy.position.copy(p);
          dummy.rotation.set(0, rot + (b.s === 1 ? 0 : Math.PI), 0);
          dummy.scale.set(isDoor ? 0.001 : width, 1.1, 1);
          dummy.updateMatrix();
          windows.setMatrixAt(wi, dummy.matrix);
          windows.setColorAt(wi++, col);
        }
      });

      // Floor slabs (floor 1..n; n is the roof).
      for (let i = 1; i <= b.n; i++) {
        const roof = i === b.n;
        dummy.position.copy(this.toWorld(b, 0, i * FH - 0.125, 0));
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(roof ? b.W : b.W - WALL * 2, 0.25, roof ? b.D : b.D - WALL * 2);
        dummy.updateMatrix();
        slabs.setMatrixAt(si++, dummy.matrix);
      }

      // Antenna beacon: taller for bigger knowledge bases.
      const antH = 3 + Math.log10(b.data.files + 1) * 3;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, antH, 6), new THREE.MeshBasicMaterial({ color: glow(b.color, 1.4) }));
      ant.position.set(hw * 0.5, b.H + antH / 2, -hd * 0.4);
      g.add(ant);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), new THREE.MeshBasicMaterial({ color: glow(b.color, 3) }));
      beacon.position.set(hw * 0.5, b.H + antH, -hd * 0.4);
      g.add(beacon);
      this.blinkers.push({ mesh: beacon, phase: Math.random() * 6, rate: 0.6 + activity(b.data.last) * 2 });

      const label = makeLabel([b.data.name, `${b.data.files}${b.data.truncated ? "+" : ""} files · ${b.n} floors · ${b.data.langs.join(" ")}`], { color: b.color, px: 64, height: 3.2 });
      label.position.set(0, b.H + 4, 0);
      g.add(label);

      const t = WALL;
      b.colliders = [
        this.box(b, -hw, 0, -hd, hw, b.H, -hd + t),
        this.box(b, -hw, 0, -hd, -hw + t, b.H, hd),
        this.box(b, hw - t, 0, -hd, hw, b.H, hd),
        this.box(b, -hw, 0, hd - t, -DOOR_W / 2, b.H, hd),
        this.box(b, DOOR_W / 2, 0, hd - t, hw, b.H, hd),
        this.box(b, -DOOR_W / 2, DOOR_H, hd - t, DOOR_W / 2, b.H, hd),
      ];
      for (let i = 1; i <= b.n; i++) {
        b.colliders.push(i === b.n
          ? this.box(b, -hw, i * FH - 0.25, -hd, hw, i * FH, hd)
          : this.box(b, -hw + t, i * FH - 0.25, -hd + t, hw - t, i * FH, hd - t));
      }
      b.bounds = this.box(b, -hw, 0, -hd, hw, b.H + 1, hd);
    }
    windows.instanceMatrix.needsUpdate = true;
    if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
    slabs.instanceMatrix.needsUpdate = true;
    this.group.add(windows, slabs);
  }

  buildDistrictGates() {
    for (const d of this.districts) {
      const mat = new THREE.MeshBasicMaterial({ color: glow(d.color, 1.3) });
      const h = 14;
      for (const z of [-STREET - 1, STREET + 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), mat);
        pillar.position.set(d.x, h / 2, z);
        this.group.add(pillar);
        this.extraColliders.push({ min: [d.x - 0.4, 0, z - 0.4], max: [d.x + 0.4, h, z + 0.4] });
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, STREET * 2 + 2.8), mat);
      beam.position.set(d.x, h, 0);
      this.group.add(beam);
      const label = makeLabel(d.name.toUpperCase(), { color: d.color, px: 72, height: 2.6 });
      label.position.set(d.x, h + 2.2, 0);
      this.group.add(label);
    }
  }

  buildCycles() {
    const colors = ["#22e6ff", "#ff9f1c", "#ff3df2", "#39ff88", "#22e6ff", "#ffe14d"];
    const lanes = [-11, -7, -3, 3, 7, 11];
    lanes.forEach((z, i) => {
      const dir = z < 0 ? 1 : -1;
      const c = glow(colors[i], 2.5);
      const g = new THREE.Group();
      const bike = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 0.7), new THREE.MeshBasicMaterial({ color: c }));
      bike.position.y = 0.5;
      const trail = new THREE.Mesh(new THREE.BoxGeometry(40, 1.1, 0.06),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      trail.position.set(-21, 0.55, 0);
      g.add(bike, trail);
      g.position.set(Math.random() * this.length, 0, z);
      this.group.add(g);
      this.cycles.push({ g, dir, speed: 25 + Math.random() * 25 });
    });
  }

  // ── Agent Row lots and the houses agents build on them ────────────────────
  buildLots() {
    for (const lot of this.lots) {
      const g = new THREE.Group();
      g.position.set(lot.cx, 0, lot.cz);
      g.rotation.y = lot.s === 1 ? 0 : Math.PI;
      this.group.add(g);
      lot.group = g;
      const h = LOT / 2;
      const v = [-h, 0.05, -h, h, 0.05, -h, h, 0.05, -h, h, 0.05, h, h, 0.05, h, -h, 0.05, h, -h, 0.05, h, -h, 0.05, -h];
      const edge = new THREE.BufferGeometry();
      edge.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      g.add(new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ color: glow(lot.color, 2) })));
      // Plaque at the front edge: [E] shows the house's story.
      const plaque = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.25), new THREE.MeshBasicMaterial({ color: glow(lot.color, 1.6) }));
      plaque.position.set(h - 4, 1.2, h + 1);
      plaque.userData.interact = { type: "lot", lot };
      g.add(plaque);
      lot.plaque = plaque;
      lot.bounds = this.box(lot, -h, 0, -h, h, 1000, h + 2);
      this.setLotLabel(lot, null);
    }
  }

  setLotLabel(lot, meta) {
    if (lot.label) { disposeObject(lot.label); lot.group.remove(lot.label); }
    const s = lot.agent.spec;
    lot.label = makeLabel([meta?.name || `${s.name}'s lot`, meta ? `${s.name} · ${meta.parts} parts · ${meta.builds} builds` : `${s.name} · nothing built yet`], { color: lot.color, px: 56, height: 2.2 });
    lot.label.position.set(LOT / 2 - 4, 4.2, LOT / 2 + 1);
    lot.group.add(lot.label);
  }

  lotFor(agentId) { return this.lots.find((l) => l.agent.id === agentId); }

  setHouse(lot, data, meta) {
    if (lot.house) { disposeObject(lot.house); lot.group.remove(lot.house); }
    lot.house = buildHouse(data.parts || [], lot.agent.spec.palette);
    lot.group.add(lot.house);
    lot.group.updateMatrixWorld(true);
    lot.colliders = lot.house.userData.colliders(lot.group.matrixWorld);
    lot.version = meta.version;
    this.setLotLabel(lot, meta);
  }

  lotFront(lot) { return V(layoutMath.lotFront(lot)); }
  randomLotSpot(lot) { return V(layoutMath.randomLotSpot(lot)); }
  yawIntoLot(lot) { return layoutMath.yawIntoLot(lot); }

  // ── interiors (built only near the player) ───────────────────────────────
  near(b, p, pad) {
    return p.x > b.bounds.min[0] - pad && p.x < b.bounds.max[0] + pad && p.z > b.bounds.min[2] - pad && p.z < b.bounds.max[2] + pad;
  }

  updateInteriors(p) {
    for (const b of this.buildings) {
      const near = this.near(b, p, 30);
      if (near && !b.interior) this.buildInterior(b);
      else if (!near && b.interior) { disposeObject(b.interior.group); b.group.remove(b.interior.group); b.interior = null; }
    }
  }

  buildInterior(b) {
    const group = new THREE.Group();
    const roomList = [];
    b.data.floors.forEach((f, fi) => f.rooms.forEach((room, ri) => roomList.push({ fi, ri, room, ...this.roomLocal(b, fi, ri) })));

    const v = [], c = [];
    const half = ROOM / 2 - 0.6;
    for (const r of roomList) {
      const col = glow(b.color, 0.3 + activity(r.room.m) * 1.4);
      const y = r.y + 0.03;
      const pts = [[-half, -half], [half, -half], [half, half], [-half, half]];
      for (let k = 0; k < 4; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % 4];
        v.push(r.x + ax, y, r.z + az, r.x + bx, y, r.z + bz);
        c.push(col.r, col.g, col.b, col.r, col.g, col.b);
      }
    }
    if (v.length) {
      const tg = new THREE.BufferGeometry();
      tg.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      tg.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
      group.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true })));
    }

    const dummy = new THREE.Object3D();
    const terminals = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 1.5, 0.3), new THREE.MeshBasicMaterial(), Math.max(1, roomList.length));
    terminals.count = roomList.length;
    roomList.forEach((r, i) => {
      dummy.position.set(r.x, r.y + 0.9, r.z - ROOM * 0.22);
      dummy.updateMatrix();
      terminals.setMatrixAt(i, dummy.matrix);
      terminals.setColorAt(i, glow(b.color, 0.35 + activity(r.room.m) * 1.6));
    });
    terminals.userData.interact = { type: "room", b };
    terminals.userData.rooms = roomList;
    group.add(terminals);

    const elevators = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 3.2, 0.2), new THREE.MeshBasicMaterial({ color: glow("#e8fbff", 1.4) }), b.n);
    for (let fi = 0; fi < b.n; fi++) {
      const e = this.elevatorLocal(b, fi);
      dummy.position.set(e.x, e.y + 1.7, e.z - 0.15);
      dummy.updateMatrix();
      elevators.setMatrixAt(fi, dummy.matrix);
    }
    elevators.userData.interact = { type: "elevator", b };
    group.add(elevators);

    b.group.add(group);
    group.updateMatrixWorld(true);
    b.interior = { group, terminals, elevators, labels: null, labelFloor: -1 };
  }

  // Room/floor name sprites for one floor at a time (canvas text is costly).
  showFloorLabels(b, fi) {
    const it = b.interior;
    if (!it || it.labelFloor === fi) return;
    if (it.labels) { disposeObject(it.labels); it.group.remove(it.labels); }
    const labels = new THREE.Group();
    const f = b.data.floors[fi];
    f.rooms.forEach((room, ri) => {
      const r = this.roomLocal(b, fi, ri);
      const s = makeLabel(room.n.length > 28 ? room.n.slice(0, 27) + "…" : room.n, { color: b.color, px: 40, height: 0.42 });
      s.position.set(r.x, r.y + 2.1, r.z - ROOM * 0.22);
      labels.add(s);
    });
    const e = this.elevatorLocal(b, fi);
    const sign = makeLabel([`${fi === 0 ? "LOBBY" : `FLOOR ${fi}`} · ${f.name}`, `${f.total} files${f.total > f.rooms.length ? ` (${f.rooms.length} shown)` : ""} · [E] elevator`], { color: "#e8fbff", px: 44, height: 0.7 });
    sign.position.set(e.x, e.y + 3.9, e.z - 0.4);
    labels.add(sign);
    if (fi === 0) {
      const lobby = makeLabel([b.data.name, b.data.root], { color: b.color, px: 60, height: 1.6 });
      lobby.position.set(0, 3.6, -b.D / 2 + 1);
      labels.add(lobby);
    }
    it.group.add(labels);
    it.labels = labels;
    it.labelFloor = fi;
  }

  // ── queries used by the player and the agents ───────────────────────────
  collidersNear(p) {
    const out = [...this.extraColliders];
    for (const b of this.buildings) if (this.near(b, p, 3)) out.push(...b.colliders);
    for (const l of this.lots) if (l.colliders.length && this.near(l, p, 3)) out.push(...l.colliders);
    return out;
  }

  interactablesNear(p) {
    const out = [];
    for (const b of this.buildings) {
      if (!this.near(b, p, 12)) continue;
      out.push(b.doorHit);
      if (b.interior) out.push(b.interior.terminals, b.interior.elevators);
    }
    for (const l of this.lots) if (this.near(l, p, 12)) out.push(l.plaque);
    return out;
  }

  locate(p) {
    for (const b of this.buildings) {
      const l = this.toLocal(b, p);
      if (Math.abs(l.x) < b.W / 2 && Math.abs(l.z) < b.D / 2 && p.y < b.H - 0.1) {
        return { b, floor: clamp(Math.floor((p.y + 0.3) / FH), 0, b.n - 1) };
      }
    }
    return null;
  }

  isInside(b, p) {
    const l = this.toLocal(b, p);
    return l.z < b.D / 2 - WALL && Math.abs(l.x) < b.W / 2;
  }

  // yaw that faces into the building (local -z) / out to the street (local +z)
  yawInto(b) { return layoutMath.yawInto(b); }
  yawOut(b) { return layoutMath.yawOut(b); }

  lobbySpot(b) { return V(layoutMath.lobbySpot(b)); }
  doorSpot(b) { return V(layoutMath.doorSpot(b)); }
  elevatorSpot(b, fi) { const e = this.elevatorLocal(b, fi); return this.toWorld(b, e.x, e.y + 0.02, e.z - 2.4); }
  randomRoomSpot(b) { const r = layoutMath.randomRoomSpot(b); return { pos: V(r.pos), floor: r.floor }; }
  randomStreetPoint() { return V(layoutMath.randomStreetPoint(this.L)); }
  get streetHalf() { return STREET; }

  update(t, dt) {
    this.groundMat.uniforms.uTime.value = t;
    for (const l of this.lots) l.house?.userData.update(t, dt);
    for (const bl of this.blinkers) bl.mesh.visible = Math.sin(t * bl.rate * 3 + bl.phase) > -0.3;
    for (const c of this.cycles) {
      c.g.position.x += c.dir * c.speed * dt;
      if (c.g.position.x > this.length + 120) c.g.position.x = -120;
      if (c.g.position.x < -120) c.g.position.x = this.length + 120;
      c.g.rotation.y = c.dir > 0 ? 0 : Math.PI;
    }
  }
}
