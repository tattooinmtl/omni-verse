import * as THREE from "three";
import { disposeObject, makeLabel } from "./labels.js";

// The economy in the world (server/economy.mjs, docs/ECONOMY.md): glowing
// resource blocks that spawn around the city, the resource zones out in the
// outskirts, the Omni Exchange at the city gate and the agents' kiosks.

const SIZE = { scrap: 0.6, circuit: 0.7, lumen: 0.75, crystal: 0.95, plasma: 1.1 };
const glow = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const shared = (o) => { o.userData.shared = true; return o; };

export class EconomyView {
  constructor(scene, city, info) {
    this.city = city;
    this.info = info;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.nodes = new Map();   // id → { data, group, core, shell, hit, phase }
    this.kiosks = new Map();  // agentId → { group, hit, count }
    this.kit = this.makeKit(info.resources);
    this.buildZones();
    this.buildExchange();
  }

  // Geometry and materials shared by every block of a kind.
  makeKit(resources) {
    const box = shared(new THREE.BoxGeometry(1, 1, 1));
    const ring = shared(new THREE.RingGeometry(0.75, 0.95, 40));
    const beam = shared(new THREE.CylinderGeometry(0.07, 0.07, 1, 6, 1, true));
    const hitGeo = shared(new THREE.BoxGeometry(1.8, 2.6, 1.8));
    const hitMat = shared(new THREE.MeshBasicMaterial({ visible: false }));
    const kit = { box, ring, beam, hitGeo, hitMat, kinds: {} };
    for (const [k, r] of Object.entries(resources)) {
      kit.kinds[k] = {
        core: shared(new THREE.MeshBasicMaterial({ color: glow(r.color, 2.4) })),
        shell: shared(new THREE.MeshBasicMaterial({ color: glow(r.color, 1.3), wireframe: true, transparent: true, opacity: 0.6 })),
        ring: shared(additive(glow(r.color, 1.4), 0.55)),
        beam: shared(additive(glow(r.color, 1.2), r.rare ? 0.4 : 0.16)),
        beamH: r.rare ? 46 : 7,
      };
    }
    return kit;
  }

  buildZones() {
    for (const z of this.city.zones) {
      const meta = this.info.zones[z.kind];
      const g = new THREE.Group();
      g.position.set(z.x, 0, z.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.5, z.r, 96), additive(glow(meta.color, 1.8), 0.9));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(z.r, 64), additive(glow(meta.color, 0.5), 0.09));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.03;
      g.add(ring, disc);
      const pylon = new THREE.MeshBasicMaterial({ color: glow(meta.color, 1.6) });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 0.5), pylon);
        p.position.set(Math.cos(a) * z.r, 2, Math.sin(a) * z.r);
        g.add(p);
      }
      const rare = Object.keys(meta.table).filter((k) => this.info.resources[k]?.rare);
      const label = makeLabel([meta.label.toUpperCase(), rare.length ? `rare: ${rare.join(" · ")}` : Object.keys(meta.table).join(" · ")], { color: meta.color, px: 72, height: 3 });
      label.position.y = 9;
      g.add(label);
      g.userData.ring = ring;
      this.group.add(g);
      z.view = g;
    }
  }

  // A booth: counter, posts, glowing awning, a label and an [E] hitbox.
  booth(color, lines, interact, width = 5) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x041722, emissive: 0x02121c, metalness: 0.6, roughness: 0.4 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(width, 1.1, 1.4), dark);
    counter.position.y = 0.55;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(width + 0.05, 0.08, 1.45), new THREE.MeshBasicMaterial({ color: glow(color, 2.2) }));
    edge.position.y = 1.12;
    const awning = new THREE.Mesh(new THREE.BoxGeometry(width + 1, 0.18, 2.6), new THREE.MeshBasicMaterial({ color: glow(color, 1.5) }));
    awning.position.set(0, 3.3, 0.4);
    g.add(counter, edge, awning);
    for (const x of [-width / 2, width / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.3, 0.16), dark);
      post.position.set(x, 1.65, -0.5);
      g.add(post);
    }
    const hit = new THREE.Mesh(new THREE.BoxGeometry(width + 1, 3.4, 3), this.kit.hitMat);
    hit.position.set(0, 1.7, 0.6);
    hit.userData.interact = interact;
    g.add(hit);
    const label = makeLabel(lines, { color, px: 56, height: 1.6 });
    label.position.y = 4.8;
    g.add(label);
    return { group: g, hit, label };
  }

  buildExchange() {
    const ex = this.city.exchange;
    const b = this.booth("#ff9f1c", ["OMNI EXCHANGE", "sell materials · buy scrap"], { type: "exchange" }, 7);
    b.group.position.set(ex.x, 0, ex.z);
    this.group.add(b.group);
    this.exchange = b;
  }

  // ── sync with /api/eco/state ──────────────────────────────────────────────
  sync(state, names) {
    this.state = state;
    const live = new Set();
    for (const n of state.nodes) {
      live.add(n.id);
      const have = this.nodes.get(n.id);
      if (have) { have.data = n; continue; }
      this.addNode(n);
    }
    for (const [id, n] of this.nodes) if (!live.has(id)) { this.group.remove(n.group); this.nodes.delete(id); }

    const open = new Set();
    for (const [id, w] of Object.entries(state.wallets)) {
      if (!w.kiosk) continue;
      const lot = this.city.lotFor(id);
      if (!lot) continue;
      open.add(id);
      const count = w.kiosk.listings.length;
      const k = this.kiosks.get(id);
      if (k && k.count === count) continue;
      if (k) { lot.group.remove(k.group); disposeObject(k.group); }
      const spec = lot.agent.spec;
      const b = this.booth(spec.palette.glow, [`${names.get(id) || spec.name}'s Kiosk`, count ? `${count} for sale · [E] browse` : "sold out"], { type: "kiosk", agentId: id });
      const at = this.city.kioskLocal();
      b.group.position.set(at.x, 0, at.z);
      lot.group.add(b.group);
      this.kiosks.set(id, { group: b.group, hit: b.hit, count, lot });
    }
    for (const [id, k] of this.kiosks) if (!open.has(id)) { k.lot.group.remove(k.group); disposeObject(k.group); this.kiosks.delete(id); }
  }

  addNode(n) {
    const k = this.kit.kinds[n.kind];
    if (!k) return;
    const s = SIZE[n.kind] || 0.7;
    const g = new THREE.Group();
    g.position.set(n.x, 0, n.z);
    const core = new THREE.Mesh(this.kit.box, k.core);
    core.scale.setScalar(s);
    const shell = new THREE.Mesh(this.kit.box, k.shell);
    shell.scale.setScalar(s * 1.55);
    const ring = new THREE.Mesh(this.kit.ring, k.ring);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    const beam = new THREE.Mesh(this.kit.beam, k.beam);
    beam.scale.y = k.beamH;
    beam.position.y = k.beamH / 2;
    const hit = new THREE.Mesh(this.kit.hitGeo, this.kit.hitMat);
    hit.position.y = 1.2;
    hit.userData.interact = { type: "node", id: n.id };
    g.add(core, shell, ring, beam, hit);
    this.group.add(g);
    this.nodes.set(n.id, { data: n, group: g, core, shell, hit, phase: Math.random() * 6.28 });
  }

  // ── queries ───────────────────────────────────────────────────────────────
  node(id) { return this.nodes.get(id)?.data || null; }

  hitsNear(p) {
    const out = [];
    for (const n of this.nodes.values()) if (Math.abs(n.data.x - p.x) < 10 && Math.abs(n.data.z - p.z) < 10) out.push(n.hit);
    for (const k of this.kiosks.values()) out.push(k.hit);
    out.push(this.exchange.hit);
    return out;
  }

  // The closest block of the wanted kinds (earlier kinds win ties within 40 m);
  // any other block counts as 150 m farther, so nobody idles while the wanted
  // kind isn't on the map. `far` prefers blocks out in the outskirts.
  nearestNode(pos, want = [], far = false, skip = new Set()) {
    let best = null, bestScore = Infinity;
    for (const { data: n } of this.nodes.values()) {
      if (skip.has(n.id)) continue;
      const rank = want.indexOf(n.kind);
      const d = Math.hypot(n.x - pos.x, n.z - pos.z);
      const score = d + (rank < 0 ? 150 + want.length * 40 : rank * 40) - (far && this.city.isOutside(n) ? 60 : 0);
      if (score < bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  update(t, dt) {
    for (const n of this.nodes.values()) {
      n.core.rotation.y += dt * 1.1;
      n.core.rotation.x += dt * 0.6;
      n.shell.rotation.y -= dt * 0.5;
      const y = 1.1 + Math.sin(t * 2 + n.phase) * 0.15;
      n.core.position.y = y;
      n.shell.position.y = y;
    }
    for (const z of this.city.zones) z.view.userData.ring.material.opacity = 0.65 + Math.sin(t * 1.5 + z.x) * 0.25;
  }
}

// A circular progress ring that floats over an agent while it gathers.
export function progressRing(color) {
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const ctx = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(0.8, 0.8, 1);
  sprite.userData.set = (f) => {
    ctx.clearRect(0, 0, 96, 96);
    ctx.lineWidth = 9;
    ctx.strokeStyle = "rgba(2,8,14,0.75)";
    ctx.beginPath(); ctx.arc(48, 48, 36, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(48, 48, 36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, f)); ctx.stroke();
    ctx.shadowBlur = 0;
    tex.needsUpdate = true;
  };
  sprite.userData.set(0);
  return sprite;
}
