import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildAvatar } from "./avatar.js";
import { disposeObject, makeLabel } from "./labels.js";

// The Stats view: everything the agents did, drawn as a neural network you fly
// through (WASD + mouse, like fly mode in the city).
//   Global layer: the Omniverse core in the middle, every agent around it as
//   its avatar on an orange node, and every interaction between agents as a
//   small node wired to the agents involved.
//   Agent layer (click an agent): the agent's core explodes into dendrites,
//   one branch per kind of activity, every event a node, every private thought
//   a violet bud on its event; interactions link back (pink) to the other
//   agents, which sit as orange nodes on the rim.
// A wiki panel lists the same data as linked pages.

const TYPE = {
  build: { color: "#ff9f1c", label: "Builds" },
  meet: { color: "#22e6ff", label: "Conversations" },
  visit: { color: "#39ff88", label: "Visits" },
  talk: { color: "#ffe14d", label: "Visitor chats" },
  craft: { color: "#c6ff3d", label: "Crafts" },
  trade: { color: "#4d7dff", label: "Trades" },
  error: { color: "#ff4466", label: "Errors" },
};
const AGENT = "#ff8a1c", CORE = "#fff1c1", THOUGHT = "#b07bff", BACKLINK = "#ff3df2", FRIEND = "#ff5fd2", FOE = "#ff2a3a";
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k !== null && k !== undefined && k !== "") n.append(k);
  return n;
};
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

// Deterministic randomness per id, so a layout is stable between openings.
function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const randDir = (r) => {
  const th = r() * Math.PI * 2, z = r() * 2 - 1, s = Math.sqrt(1 - z * z);
  return new THREE.Vector3(Math.cos(th) * s, z, Math.sin(th) * s);
};

// ── GPU pieces: glowing points and pulsing links ───────────────────────────
const pointsMat = () => new THREE.ShaderMaterial({
  uniforms: { uScale: { value: innerHeight * 0.5 }, uFade: { value: 1 } },
  vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
    void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = clamp(size * uScale / -mv.z, 1.5, 220.0); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vC; uniform float uFade;
    void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard;
      float a = pow(1.0 - r * 2.0, 2.6) * 0.8 + smoothstep(0.14, 0.0, r);
      gl_FragColor = vec4(vC * a * uFade, a * uFade); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const linesMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
  vertexShader: `attribute vec3 color; attribute float aT; attribute float aPhase; attribute float aGain;
    varying vec3 vC; varying float vT; varying float vP; varying float vG;
    void main(){ vC = color; vT = aT; vP = aPhase; vG = aGain; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uTime; uniform float uFade; varying vec3 vC; varying float vT; varying float vP; varying float vG;
    void main(){ float p = fract(vT - uTime * 0.35 + vP); float pulse = exp(-pow((p - 0.5) * 9.0, 2.0));
      gl_FragColor = vec4(vC * (0.32 + pulse * 1.5) * vG * uFade, 1.0); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

// A set of nodes + links that can animate from collapsed to expanded.
class Net {
  constructor() { this.nodes = []; this.links = []; this.group = new THREE.Group(); }
  node(n) { n.i = this.nodes.length; n.cur = (n.from || new THREE.Vector3()).clone(); this.nodes.push(n); return n; }
  link(a, b, ca, cb = ca, gain = 1) { this.links.push({ a, b, ca: new THREE.Color(ca), cb: new THREE.Color(cb), gain, phase: Math.random() }); }
  build() {
    const N = this.nodes.length, L = this.links.length;
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3), size = new Float32Array(N);
    this.nodes.forEach((n, i) => { const c = new THREE.Color(n.color).multiplyScalar(n.bright ?? 1.3); col.set([c.r, c.g, c.b], i * 3); size[i] = n.size; });
    pg.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    pg.setAttribute("size", new THREE.BufferAttribute(size, 1));
    this.sizes = size;
    this.points = new THREE.Points(pg, pointsMat());
    this.points.frustumCulled = false;
    const lg = new THREE.BufferGeometry();
    this.lPos = new Float32Array(L * 6);
    const lc = new Float32Array(L * 6), t = new Float32Array(L * 2), ph = new Float32Array(L * 2), gain = new Float32Array(L * 2);
    this.links.forEach((l, i) => {
      lc.set([l.ca.r, l.ca.g, l.ca.b, l.cb.r, l.cb.g, l.cb.b], i * 6);
      t.set([0, 1], i * 2); ph.set([l.phase, l.phase], i * 2); gain.set([l.gain, l.gain], i * 2);
    });
    lg.setAttribute("position", new THREE.BufferAttribute(this.lPos, 3));
    lg.setAttribute("color", new THREE.BufferAttribute(lc, 3));
    lg.setAttribute("aT", new THREE.BufferAttribute(t, 1));
    lg.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
    lg.setAttribute("aGain", new THREE.BufferAttribute(gain, 1));
    this.lines = new THREE.LineSegments(lg, linesMat());
    this.lines.frustumCulled = false;
    this.group.add(this.lines, this.points);
    this.progress = 0;
    this.sync();
  }
  // Expansion: deeper nodes leave the core a little later.
  animate(dt) {
    if (this.progress >= 1.6) return;
    this.progress += dt * 0.7;
    for (const n of this.nodes) {
      const k = ease((this.progress - (n.delay || 0)) / 0.9);
      n.cur.lerpVectors(n.from || new THREE.Vector3(), n.pos, k);
      n.model?.position.copy(n.cur).add(n.modelOffset);
      n.label?.position.copy(n.cur).add(n.labelOffset);
    }
    this.sync();
  }
  sync() {
    for (const n of this.nodes) this.pPos.set([n.cur.x, n.cur.y, n.cur.z], n.i * 3);
    this.links.forEach((l, i) => {
      const a = l.a.cur, b = l.b.cur;
      this.lPos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    });
    this.points.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
  setSize(n, s) { this.sizes[n.i] = s; this.points.geometry.attributes.size.needsUpdate = true; }
  dispose() { disposeObject(this.group); }
}

// ── the view ──────────────────────────────────────────────────────────────
let V = null;

export async function openNeural(graph, { focus = null, onClose = () => {} } = {}) {
  if (!V) V = createView();
  V.open(graph, focus, onClose);
}

function createView() {
  const canvas = $("neuralCanvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(new THREE.HemisphereLight(0x99ccff, 0x110011, 1.1));
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 5000);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.45, 0.12);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const dust = makeDust();
  scene.add(dust);

  const st = {
    open: false, graph: null, net: null, layer: "global", agentId: null, hover: null, selected: null,
    yaw: 0, pitch: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), keys: new Set(), drag: false,
    mouse: new THREE.Vector2(-1, -1), onClose: null, history: [], models: [],
  };
  const clock = new THREE.Clock();

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (st.net) st.net.points.material.uniforms.uScale.value = h * 0.5;
  }
  addEventListener("resize", () => st.open && resize());

  const locked = () => document.pointerLockElement === canvas || st.drag;
  document.addEventListener("mousemove", (e) => {
    if (!st.open) return;
    st.mouse.set(e.clientX, e.clientY);
    if (document.pointerLockElement !== canvas && !(st.drag && e.buttons)) return;
    st.yaw -= e.movementX * 0.0022;
    st.pitch = Math.min(1.55, Math.max(-1.55, st.pitch - e.movementY * 0.0022));
  });
  document.addEventListener("pointerlockchange", () => { if (document.pointerLockElement !== canvas) st.keys.clear(); });
  canvas.addEventListener("click", () => {
    if (!st.open) return;
    if (st.hover) return select(st.hover);
    if (document.pointerLockElement === canvas) return;
    Promise.resolve(canvas.requestPointerLock()).catch(() => { st.drag = true; });
  });
  addEventListener("keydown", (e) => {
    if (!st.open || e.target.matches?.("input, textarea, select")) return;
    if (e.code === "Escape") {
      if (document.pointerLockElement === canvas) return;
      if (st.drag) { st.drag = false; return; }
      if (st.layer === "agent") showGlobal();
      return;
    }
    if (e.code === "KeyN" && document.pointerLockElement !== canvas) return close();
    st.keys.add(e.code);
    if (e.code === "Space") e.preventDefault();
  });
  addEventListener("keyup", (e) => st.keys.delete(e.code));
  $("nClose").onclick = close;
  $("nBack").onclick = () => showGlobal();
  $("nWikiBtn").onclick = () => { $("nWiki").hidden = !$("nWiki").hidden; if (!$("nWiki").hidden && !$("nWiki").childElementCount) wiki("home"); };

  function open(graph, focus, onClose) {
    st.graph = index(graph);
    st.onClose = onClose;
    st.open = true;
    $("neural").hidden = false;
    $("nInfo").hidden = true;
    resize();
    legend();
    if (focus && st.graph.agent.has(focus)) showAgent(focus); else showGlobal();
    if (!$("nWiki").hidden) wiki(focus ? `agent:${focus}` : "home");
    clock.getDelta();
    loop();
  }

  function close() {
    st.open = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    st.drag = false;
    clearLayer();
    $("neural").hidden = true;
    st.onClose?.();
  }

  // ── data indexing ───────────────────────────────────────────────────────
  function index(g) {
    const agent = new Map(g.agents.map((a) => [a.id, a]));
    const event = new Map(g.events.map((e) => [e.id, e]));
    const events = g.events.filter((e) => TYPE[e.type] && (e.agents || []).every((id) => agent.has(id))).slice(-4000);
    return { ...g, agent, event, events, name: (id) => agent.get(id)?.spec.name || (id === "visitor" ? "Visitor" : id) };
  }

  function clearLayer() {
    if (st.net) { scene.remove(st.net.group); st.net.dispose(); st.net = null; }
    for (const m of st.models) { scene.remove(m); disposeObject(m); }
    st.models = [];
    st.hover = null;
  }

  function addModel(n, a, scale) {
    const m = buildAvatar(a.spec);
    m.scale.setScalar(scale);
    n.model = m;
    n.modelOffset = new THREE.Vector3(0, -a.spec.height * scale * 0.55, 0);
    m.position.copy(n.cur).add(n.modelOffset);
    m.traverse((o) => { if (o.material && "emissiveIntensity" in o.material) { o.userData.baseEmis = o.material.emissiveIntensity; o.material.emissiveIntensity *= 0.45; } });
    scene.add(m);
    st.models.push(m);
    const label = makeLabel([a.spec.name, `${a.provider} · ${a.model.split("/").pop()}`], { color: a.spec.palette.glow, px: 48, height: 1.6 * scale / 3 });
    n.label = label;
    n.labelOffset = new THREE.Vector3(0, a.spec.height * scale * 0.6 + 1.5, 0);
    label.position.copy(n.cur).add(n.labelOffset);
    scene.add(label);
    st.models.push(label);
  }
  function hubLabel(n, text, color) {
    const label = makeLabel(text, { color, px: 44, height: 1.4 });
    n.label = label;
    n.labelOffset = new THREE.Vector3(0, 2.2, 0);
    label.position.copy(n.cur).add(n.labelOffset);
    scene.add(label);
    st.models.push(label);
  }

  // ── global layer ────────────────────────────────────────────────────────
  function agentRing() {
    const list = [...st.graph.agent.values()].sort((a, b) => a.createdAt - b.createdAt);
    const R = 70;
    return new Map(list.map((a, i) => {
      const th = (i / list.length) * Math.PI * 2;
      return [a.id, new THREE.Vector3(Math.cos(th) * R, Math.sin(i * 1.7) * 9, Math.sin(th) * R)];
    }));
  }

  function showGlobal() {
    clearLayer();
    st.layer = "global";
    st.agentId = null;
    $("nLayer").textContent = "GLOBAL LAYER · all agents";
    $("nBack").hidden = true;
    const g = st.graph, net = new Net();
    const ring = agentRing();
    const core = net.node({ kind: "core", pos: new THREE.Vector3(), color: CORE, size: 26, bright: 1.6, title: "OMNIVERSE", text: `${g.agent.size} agents · ${g.total ?? g.events.length} recorded events` });
    hubLabel(core, ["OMNIVERSE", "core"], CORE);
    const agentNodes = new Map();
    for (const [id, p] of ring) {
      const a = g.agent.get(id);
      const n = net.node({ kind: "agent", id, pos: p, color: AGENT, size: 16, bright: 1.8, delay: 0.1, title: a.spec.name, text: `${a.spec.species} · ${a.provider}/${a.model}` });
      agentNodes.set(id, n);
      net.link(core, n, CORE, AGENT, 1.6);
      addModel(n, a, 3);
    }
    // Relationships: a direct agent↔agent link, pink when warm, red when cold.
    for (const r of g.relations) {
      const a = agentNodes.get(r.a), b = agentNodes.get(r.b);
      if (a && b) net.link(a, b, r.score >= 0 ? FRIEND : FOE, r.score >= 0 ? FRIEND : FOE, Math.min(2.2, 0.4 + Math.abs(r.score) * 0.15 + r.meetings * 0.1));
    }
    // Interactions float between the agents involved; builds orbit their agent.
    const inter = [];
    for (const e of g.events) {
      const r = rng(e.id), t = TYPE[e.type];
      const ps = e.agents.map((id) => ring.get(id));
      let pos;
      if (ps.length > 1) pos = ps[0].clone().lerp(ps[1], 0.25 + r() * 0.5).add(randDir(r).multiplyScalar(6 + r() * 26));
      else pos = ps[0].clone().add(randDir(r).multiplyScalar(e.type === "build" ? 8 + r() * 18 : 12 + r() * 30)).lerp(new THREE.Vector3(), e.type === "talk" ? 0.25 : 0);
      const n = net.node({ kind: "event", id: e.id, pos, color: t.color, size: e.type === "build" ? 3.2 : 5, delay: 0.25 + r() * 0.4, title: eventTitle(e), text: eventLine(e) });
      for (const id of e.agents) net.link(n, agentNodes.get(id), t.color, AGENT, e.type === "build" ? 0.45 : 0.9);
      if (e.type !== "build") inter.push(n);
    }
    // The web: every interaction also wires to its two nearest neighbours.
    for (const n of inter.slice(-1500)) {
      const near = inter.filter((m) => m !== n).map((m) => [m, m.pos.distanceToSquared(n.pos)]).sort((x, y) => x[1] - y[1]).slice(0, 2);
      for (const [m] of near) if (n.i < m.i || near.length < 2) net.link(n, m, n.color, m.color, 0.35);
    }
    net.build();
    scene.add(net.group);
    st.net = net;
    st.pos.set(0, 45, 185);
    st.yaw = 0; st.pitch = -0.22;
  }

  // ── agent layer ─────────────────────────────────────────────────────────
  function showAgent(id) {
    clearLayer();
    st.layer = "agent";
    st.agentId = id;
    const g = st.graph, a = g.agent.get(id), net = new Net();
    $("nLayer").textContent = `AGENT LAYER · ${a.spec.name}`;
    $("nBack").hidden = false;
    const core = net.node({ kind: "agent", id, pos: new THREE.Vector3(), color: AGENT, size: 24, bright: 2, title: a.spec.name, text: `${a.spec.species} · ${a.provider}/${a.model}` });
    addModel(core, a, 3);
    const mine = g.events.filter((e) => e.agents.includes(id));
    const ring = agentRing(), me = ring.get(id);
    // Other agents on the rim, in the direction they sit in the global layer.
    const ghosts = new Map();
    for (const [oid, p] of ring) {
      if (oid === id) continue;
      const o = g.agent.get(oid);
      const dir = p.clone().sub(me).normalize();
      const n = net.node({ kind: "ghost", id: oid, pos: dir.multiplyScalar(105), color: AGENT, size: 13, bright: 1.6, delay: 0.5, title: o.spec.name, text: `open ${o.spec.name}'s layer` });
      hubLabel(n, [o.spec.name, o.spec.species], o.spec.palette.glow);
      ghosts.set(oid, n);
    }
    const kinds = Object.keys(TYPE).filter((k) => mine.some((e) => e.type === k));
    const hubDirs = new Map(kinds.map((k, i) => {
      const y = kinds.length === 1 ? 0 : 1 - (i / (kinds.length - 1)) * 2, r = Math.sqrt(1 - y * y) || 1, th = i * 2.4;
      return [k, new THREE.Vector3(Math.cos(th) * r, y * 0.7, Math.sin(th) * r).normalize()];
    }));
    let maxDepth = 1;
    const pending = [];
    for (const k of kinds) {
      const dir = hubDirs.get(k), t = TYPE[k];
      const list = mine.filter((e) => e.type === k);
      const hub = net.node({ kind: "hub", id: k, pos: dir.clone().multiplyScalar(20), color: t.color, size: 12, bright: 1.7, delay: 0.05, title: t.label, text: `${list.length} ${t.label.toLowerCase()}`, depth: 1 });
      hubLabel(hub, [t.label, `${list.length}`], t.color);
      net.link(core, hub, AGENT, t.color, 1.8);
      const chain = [];
      list.forEach((e, idx) => {
        const r = rng(e.id);
        const parent = idx === 0 ? hub : r() < 0.62 ? chain[idx - 1] : chain[Math.floor(r() * idx)];
        const dirJ = dir.clone().add(randDir(r).multiplyScalar(0.9)).normalize();
        const n = net.node({ kind: "event", id: e.id, pos: parent.pos.clone().add(dirJ.multiplyScalar(5 + r() * 6)), color: t.color, size: 5.5, depth: (parent.depth || 1) + 1, title: eventTitle(e), text: eventLine(e) });
        maxDepth = Math.max(maxDepth, n.depth);
        chain.push(n);
        net.link(parent, n, parent === hub ? t.color : parent.color, t.color, 1.1);
        // Private thoughts bud off the event that caused them.
        const thoughts = [e.thought, ...(e.lines || []).filter((l) => l.who === id).map((l) => l.thought)].filter(Boolean);
        thoughts.forEach((th, j) => {
          const tn = net.node({ kind: "thought", id: e.id, pos: n.pos.clone().add(randDir(r).multiplyScalar(2.5 + j)), color: THOUGHT, size: 3.6, depth: n.depth + 1, title: "Thought", text: th });
          net.link(n, tn, THOUGHT, THOUGHT, 0.9);
        });
        // Interactions link back to the other agents in their own colour.
        for (const oid of e.agents) if (oid !== id && ghosts.has(oid)) pending.push([n, ghosts.get(oid)]);
      });
    }
    for (const [n, gh] of pending) net.link(n, gh, BACKLINK, AGENT, 0.6);
    for (const n of net.nodes) if (n.depth) n.delay = 0.08 + (n.depth / (maxDepth + 1)) * 0.6;
    net.build();
    scene.add(net.group);
    st.net = net;
    st.pos.set(0, 22, 95);
    st.yaw = 0; st.pitch = -0.18;
    if (!$("nWiki").hidden) wiki(`agent:${id}`);
  }

  // ── text for nodes ──────────────────────────────────────────────────────
  function eventTitle(e) {
    const n = st.graph.name;
    switch (e.type) {
      case "build": return `${n(e.agents[0])} · ${e.rebuild ? "rebuild" : "build"}`;
      case "meet": return `${n(e.agents[0])} ↔ ${n(e.agents[1])}`;
      case "visit": return `${n(e.agents[1])} → ${n(e.agents[0])}'s house`;
      case "talk": return `Visitor ↔ ${n(e.agents[0])}`;
      case "craft": return `${n(e.agents[0])} · crafted ${e.item || ""}`;
      case "trade": return `${n(e.agents[1])} → ${n(e.agents[0])}'s kiosk`;
      default: return e.type;
    }
  }
  const eventLine = (e) => e.summary || e.lines?.[0]?.say || "";

  // ── picking ─────────────────────────────────────────────────────────────
  const v = new THREE.Vector3();
  function pick() {
    if (!st.net) return null;
    const cx = locked() && document.pointerLockElement === canvas ? innerWidth / 2 : st.mouse.x;
    const cy = locked() && document.pointerLockElement === canvas ? innerHeight / 2 : st.mouse.y;
    if (cx < 0) return null;
    let best = null, bestD = Infinity;
    for (const n of st.net.nodes) {
      v.copy(n.cur).project(camera);
      if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
      const dist = n.cur.distanceTo(camera.position);
      const r = Math.max(10, (n.size * innerHeight * 0.5) / dist * 0.35) + (n.model ? 30 : 0);
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < r && d - r < bestD) { best = n; bestD = d - r; }
    }
    return best;
  }

  function setHover(n) {
    if (st.hover === n) return;
    const prev = st.hover;
    if (prev) { st.net.setSize(prev, prev.baseSize ?? prev.size); glowModel(prev, 1); }
    st.hover = n;
    const tip = $("nTip");
    if (!n) { tip.hidden = true; return; }
    n.baseSize = n.baseSize ?? st.net.sizes[n.i];
    st.net.setSize(n, n.baseSize * 1.8);
    glowModel(n, 3);
    tip.replaceChildren(el("b", { textContent: n.title }), el("div", { textContent: (n.text || "").slice(0, 220) }));
    tip.style.borderColor = n.color;
    tip.hidden = false;
  }
  function glowModel(n, k) {
    n.model?.traverse((o) => { if (o.userData.baseEmis !== undefined) o.material.emissiveIntensity = k > 1 ? o.userData.baseEmis * 1.8 + 0.8 : o.userData.baseEmis * 0.45; });
  }

  function select(n) {
    if (n.kind === "agent" && st.layer === "global") return showAgent(n.id);
    if (n.kind === "ghost") return showAgent(n.id);
    if (n.kind === "agent") return info(agentPage(n.id));
    if (n.kind === "core") return info(homePage());
    if (n.kind === "hub") return info(hubPage(st.agentId, n.id));
    if (n.kind === "event" || n.kind === "thought") return info(eventPage(n.id));
  }

  // ── wiki / info pages (built as DOM, never from HTML strings) ────────────
  const link = (ref, textContent, color) => el("a", { href: "#", textContent, style: color ? `color:${color}` : "", onclick: (e) => { e.preventDefault(); go(ref); } });
  function go(ref) {
    const [kind, id] = ref.split(/:(.*)/s);
    if (kind === "agent" && st.graph.agent.has(id) && !(st.layer === "agent" && st.agentId === id)) showAgent(id);
    if (!$("nWiki").hidden) wiki(ref);
    else info(kind === "agent" ? agentPage(id) : kind === "event" ? eventPage(id) : homePage());
    if (kind === "event") flyTo(id);
  }
  function flyTo(eventId) {
    const n = st.net?.nodes.find((x) => x.id === eventId && x.kind === "event");
    if (!n) return;
    const dir = n.pos.clone().normalize();
    st.pos.copy(n.pos).add(dir.multiplyScalar(18)).add(new THREE.Vector3(0, 4, 0));
    const d = n.pos.clone().sub(st.pos);
    st.yaw = Math.atan2(-d.x, -d.z);
    st.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }
  function info(page) {
    const box = $("nInfo");
    box.replaceChildren(el("button", { className: "btn small x", textContent: "✕", onclick: () => { box.hidden = true; } }), page);
    box.hidden = false;
  }
  function wiki(ref) {
    const [kind, id] = ref.split(/:(.*)/s);
    const page = kind === "agent" ? agentPage(id) : kind === "event" ? eventPage(id) : kind === "relations" ? relationsPage() : kind === "timeline" ? timelinePage() : homePage();
    const nav = el("nav", {}, link("home", "Home"), link("relations", "Relationships"), link("timeline", "Timeline"));
    $("nWiki").replaceChildren(nav, page);
    $("nWiki").scrollTop = 0;
  }

  const fmt = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const agentLink = (id) => (st.graph.agent.has(id) ? link(`agent:${id}`, st.graph.name(id), st.graph.agent.get(id).spec.palette.glow) : el("span", { textContent: st.graph.name(id) }));
  const eventRow = (e) => el("li", {}, el("span", { className: "dot", style: `background:${TYPE[e.type].color}` }), el("small", { textContent: fmt(e.t) + " " }), link(`event:${e.id}`, eventTitle(e)), el("span", { className: "muted", textContent: ` ${eventLine(e).slice(0, 90)}` }));

  function homePage() {
    const g = st.graph;
    const count = (k) => g.counts?.[k] ?? g.events.filter((e) => e.type === k).length;
    return el("div", { className: "wiki-page" },
      el("h2", { textContent: "Omniverse" }),
      el("p", { className: "muted", textContent: `${g.agent.size} agents · ${count("build")} builds · ${count("meet")} conversations · ${count("visit")} visits · ${count("talk")} visitor chats` }),
      el("h4", { textContent: "Agents" }),
      el("ul", {}, ...[...g.agent.values()].map((a) => el("li", {}, agentLink(a.id), el("span", { className: "muted", textContent: ` · ${a.spec.species} · ${a.provider}/${a.model}${a.house ? ` · 🏠 ${a.house.name}` : ""}` })))),
      el("h4", { textContent: "Strongest bonds" }),
      relationsList(g.relations.slice().sort((x, y) => y.score - x.score).slice(0, 8)),
      el("h4", { textContent: "Latest" }),
      el("ul", { className: "events" }, ...g.events.slice(-12).reverse().map(eventRow)));
  }
  function relationsList(list) {
    if (!list.length) return el("p", { className: "muted", textContent: "No relationships yet: agents meet when they pass each other on the street." });
    return el("ul", {}, ...list.map((r) => el("li", {}, agentLink(r.a), el("span", { textContent: " ↔ " }), agentLink(r.b),
      el("span", { className: r.score >= 0 ? "pos" : "neg", textContent: ` ${r.score >= 0 ? "+" : ""}${r.score}` }),
      el("span", { className: "muted", textContent: ` · ${r.meetings} talks · ${r.visits} visits` }))));
  }
  function relationsPage() {
    return el("div", { className: "wiki-page" }, el("h2", { textContent: "Relationships" }), relationsList(st.graph.relations.slice().sort((x, y) => y.score - x.score)));
  }
  function timelinePage() {
    return el("div", { className: "wiki-page" }, el("h2", { textContent: "Timeline" }), el("ul", { className: "events" }, ...st.graph.events.slice(-300).reverse().map(eventRow)));
  }
  function agentPage(id) {
    const g = st.graph, a = g.agent.get(id);
    if (!a) return el("p", { textContent: "Unknown agent." });
    const mine = g.events.filter((e) => e.agents.includes(id));
    const thoughts = mine.flatMap((e) => [e.thought ? [e, e.thought] : null, ...(e.lines || []).filter((l) => l.who === id && l.thought).map((l) => [e, l.thought])]).filter(Boolean);
    return el("div", { className: "wiki-page" },
      el("h2", { textContent: a.spec.name, style: `color:${a.spec.palette.glow}` }),
      el("p", { className: "muted", textContent: `${a.spec.species} · ${a.provider} / ${a.model}` }),
      el("p", { textContent: a.spec.description }),
      a.spec.motto ? el("p", { className: "motto", textContent: `“${a.spec.motto}”` }) : "",
      el("h4", { textContent: "House" }),
      a.house ? el("div", {}, el("p", { textContent: `🏠 ${a.house.name} · ${a.house.parts} parts · ${a.house.builds} builds` }), el("ul", {}, ...a.house.history.slice().reverse().map((h) => el("li", { textContent: h }))))
        : el("p", { className: "muted", textContent: "Nothing built yet." }),
      el("h4", { textContent: "Relationships" }),
      relationsList(g.relations.filter((r) => r.a === id || r.b === id).sort((x, y) => y.score - x.score)),
      el("h4", { textContent: `Thoughts (${thoughts.length})` }),
      el("ul", { className: "thoughts" }, ...thoughts.slice(-20).reverse().map(([e, t]) => el("li", {}, el("i", { textContent: `“${t}” ` }), link(`event:${e.id}`, "↗")))),
      el("h4", { textContent: `Timeline (${mine.length})` }),
      el("ul", { className: "events" }, ...mine.slice(-150).reverse().map(eventRow)));
  }
  function hubPage(agentId, kind) {
    const list = st.graph.events.filter((e) => e.type === kind && e.agents.includes(agentId));
    return el("div", { className: "wiki-page" }, el("h2", { textContent: `${TYPE[kind].label} · ${st.graph.name(agentId)}` }), el("ul", { className: "events" }, ...list.slice().reverse().map(eventRow)));
  }
  function eventPage(eid) {
    const e = st.graph.event.get(eid);
    if (!e) return el("p", { textContent: "Unknown event." });
    return el("div", { className: "wiki-page" },
      el("h2", { textContent: eventTitle(e), style: `color:${TYPE[e.type]?.color || "#fff"}` }),
      el("p", { className: "muted", textContent: `${e.type} · ${new Date(e.t).toLocaleString()}` }),
      el("p", {}, ...e.agents.flatMap((id, i) => [i ? " · " : "", agentLink(id)])),
      e.summary ? el("p", { textContent: e.summary }) : "",
      e.house ? el("p", { className: "muted", textContent: `🏠 ${e.house}${e.parts ? ` · +${e.parts} parts (${e.total} total)` : ""}` }) : "",
      e.thought ? el("p", { className: "thought", textContent: `💭 “${e.thought}”` }) : "",
      ...(e.lines || []).map((l) => el("div", { className: "line" }, el("b", { textContent: `${l.name || st.graph.name(l.who)}: ` }), el("span", { textContent: l.say }),
        l.thought ? el("div", { className: "thought", textContent: `💭 ${l.thought}` }) : "")),
      e.invite ? el("p", { textContent: `✉ ${st.graph.name(e.host)} sent an invitation.` }) : "",
      typeof e.affinity === "number" ? el("p", { className: e.affinity >= 0 ? "pos" : "neg", textContent: `affinity ${e.affinity >= 0 ? "+" : ""}${e.affinity}` }) : "");
  }

  function legend() {
    $("nLegend").replaceChildren(...[["Agent", AGENT], ...Object.entries(TYPE).filter(([k]) => k !== "error").map(([, t]) => t).map((t) => [t.label, t.color]), ["Thought", THOUGHT], ["Link back to agent", BACKLINK], ["Bond", FRIEND]]
      .map(([l, c]) => el("span", {}, el("i", { style: `background:${c};box-shadow:0 0 8px ${c}` }), l)));
  }

  // ── loop ────────────────────────────────────────────────────────────────
  function loop() {
    if (!st.open) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    const k = st.keys;
    const f = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0), r = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    const sin = Math.sin(st.yaw), cos = Math.cos(st.yaw), cp = Math.cos(st.pitch);
    const dir = new THREE.Vector3(-sin * cp, Math.sin(st.pitch), -cos * cp).multiplyScalar(f).addScaledVector(new THREE.Vector3(cos, 0, -sin), r);
    dir.y += (k.has("Space") ? 1 : 0) - (k.has("KeyC") ? 1 : 0);
    if (dir.lengthSq() > 1) dir.normalize();
    st.vel.lerp(dir.multiplyScalar(k.has("ShiftLeft") || k.has("ShiftRight") ? 90 : 30), 1 - Math.exp(-6 * dt));
    st.pos.addScaledVector(st.vel, dt);
    camera.position.copy(st.pos);
    camera.rotation.set(st.pitch, st.yaw, 0, "YXZ");
    dust.position.copy(camera.position).multiplyScalar(0.6);
    if (st.net) {
      st.net.animate(dt);
      st.net.lines.material.uniforms.uTime.value = t;
    }
    for (const m of st.models) m.userData.update?.(t, dt);
    $("nCross").hidden = document.pointerLockElement !== canvas;
    setHover(pick());
    if (st.hover && !$("nTip").hidden) {
      const tip = $("nTip");
      const center = document.pointerLockElement === canvas;
      tip.style.left = `${(center ? innerWidth / 2 : st.mouse.x) + 18}px`;
      tip.style.top = `${(center ? innerHeight / 2 : st.mouse.y) + 18}px`;
    }
    composer.render();
  }

  window.omniverseNeural = { st, showAgent, showGlobal, select }; // console handle for debugging
  return { open };
}

// Faint background synapses so the void has depth.
function makeDust() {
  const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  const palette = ["#22e6ff", "#2a6bff", "#9d6bff", "#ff9f1c", "#39ffcc"].map((c) => new THREE.Color(c));
  const r = rng("dust");
  for (let i = 0; i < n; i++) {
    const d = randDir(r).multiplyScalar(140 + r() * 520);
    pos.set([d.x, d.y, d.z], i * 3);
    const c = palette[Math.floor(r() * palette.length)].clone().multiplyScalar(0.25 + r() * 0.35);
    col.set([c.r, c.g, c.b], i * 3);
    size[i] = 1.5 + r() * 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const p = new THREE.Points(g, pointsMat());
  p.frustumCulled = false;
  return p;
}
