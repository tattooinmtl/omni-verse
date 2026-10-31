import * as THREE from "three";
import { disposeObject, makeLabel } from "./labels.js";
import { DESK_D, DESK_H, DESK_W, deskSpot, deskXs, deskZ } from "./layout.js";

// Work: computer blocks in every lobby (server/work.mjs). Each building has
// up to DESKS standing consoles along its front wall, both sides of the door.
// A console's CRT shows the live Omni session of the agent clocked in there;
// pressing E on it moves the camera to eye level with the screen and powers
// on a full terminal (class Terminal below).
const SCREEN_W = 0.5, SCREEN_H = 0.38;
// A PC in three blocks: a base with the keyboard on its front panel, a neck,
// and the monitor block whose front face is the screen.
const BASE_H = 0.12, NECK_H = 0.14, MON_W = 0.66, MON_H = 0.5, MON_D = 0.14, MON_Z = 0.1;
const SCREEN_Y = DESK_H + BASE_H + NECK_H + MON_H / 2;
const SCREEN_Z = MON_Z - MON_D / 2 - 0.002; // just in front of the monitor's face
const TEX_W = 384, TEX_H = 288;
const shared = (o) => { o.userData.shared = true; return o; };

// Desk positions (deskXs, deskZ, deskSpot) come from layout.js, shared with the server.

export class WorkView {
  constructor(scene, city) {
    this.scene = scene;
    this.city = city;
    this.state = null;
    this.desks = new Map(); // building → { group, units: [{ i, screen, ctx, tex, hit, label, labelKey }] }
    this.blockMeshes = new Map();
    this.drawTimer = 0;
    this.kit = this.makeKit();
    // Desks are solid for the player.
    for (const b of city.buildings) {
      const z = deskZ(b);
      for (const x of deskXs(b)) b.colliders.push(city.box(b, x - DESK_W / 2, 0, z - DESK_D / 2, x + DESK_W / 2, DESK_H + 0.6, z + DESK_D / 2));
    }
  }

  makeKit() {
    return {
      deskGeo: shared(new THREE.BoxGeometry(DESK_W, 0.06, DESK_D)),
      legGeo: shared(new THREE.BoxGeometry(DESK_W * 0.9, DESK_H - 0.06, 0.08)),
      pcBase: shared(new THREE.BoxGeometry(0.62, BASE_H, 0.44)),
      pcNeck: shared(new THREE.BoxGeometry(0.08, NECK_H, 0.08)),
      pcMonitor: shared(new THREE.BoxGeometry(MON_W, MON_H, MON_D)),
      kbPlane: shared(new THREE.PlaneGeometry(0.54, 0.17)),
      screenFlat: shared(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H)),
      hitGeo: shared(new THREE.BoxGeometry(0.8, 0.8, 0.8)),
      blockGeo: shared(new THREE.BoxGeometry(0.22, 0.22, 0.22)),
      blockEdges: shared(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.24, 0.24, 0.24))),
      // Gunmetal light enough to read under the lobby light.
      body: shared(new THREE.MeshStandardMaterial({ color: 0x2b3d48, metalness: 0.55, roughness: 0.42, emissive: 0x050e13 })),
      keyboard: shared(new THREE.MeshStandardMaterial({ map: keyboardTexture(), metalness: 0.3, roughness: 0.7, emissive: 0xffffff, emissiveMap: keyboardTexture(), emissiveIntensity: 0.7 })),
      hit: shared(new THREE.MeshBasicMaterial({ visible: false })),
      blockCore: shared(new THREE.MeshBasicMaterial({ color: new THREE.Color("#39ff88").multiplyScalar(1.8), transparent: true, opacity: 0.85 })),
      blockLine: shared(new THREE.LineBasicMaterial({ color: new THREE.Color("#b6ffd6").multiplyScalar(2) })),
    };
  }

  // Where an agent stands to work at desk i (world space), and which way it faces.
  deskSpot(b, i) {
    const d = deskSpot(b, i);
    return { pos: new THREE.Vector3(d.pos.x, d.pos.y, d.pos.z), yaw: d.yaw };
  }

  // The screen's centre and outward normal in world space, for the camera.
  screenPose(b, i) {
    const xs = deskXs(b), x = xs[i] ?? 0;
    const center = this.city.toWorld(b, x, SCREEN_Y, deskZ(b) + SCREEN_Z);
    const normal = new THREE.Vector3(0, 0, -b.s);
    return { center, normal };
  }

  // The four corners of the glass in world space (top-left, top-right,
  // bottom-right, bottom-left as seen by someone using the terminal).
  screenCorners(b, i) {
    const xs = deskXs(b), x = xs[i] ?? 0, z = deskZ(b) + SCREEN_Z;
    const hw = SCREEN_W / 2, hh = SCREEN_H / 2;
    return [[hw, hh], [-hw, hh], [-hw, -hh], [hw, -hh]].map(([dx, dy]) => this.city.toWorld(b, x + dx, SCREEN_Y + dy, z));
  }

  buildingByRoot(root) {
    const r = String(root || "").toLowerCase();
    return this.city.buildings.find((b) => String(b.data.root).toLowerCase() === r) || null;
  }

  buildDesks(b) {
    const k = this.kit, group = new THREE.Group(), units = [];
    const trim = new THREE.LineBasicMaterial({ color: new THREE.Color(b.color).multiplyScalar(1.4) });
    const z = deskZ(b);
    deskXs(b).forEach((x, i) => {
      const u = new THREE.Group();
      u.position.set(x, 0, z);
      const top = new THREE.Mesh(k.deskGeo, k.body); top.position.y = DESK_H; u.add(top);
      const leg = new THREE.Mesh(k.legGeo, k.body); leg.position.set(0, (DESK_H - 0.06) / 2, DESK_D / 2 - 0.08); u.add(leg);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(k.deskGeo), trim); edge.position.y = DESK_H; u.add(edge);
      // The PC: base (keyboard on its front panel), neck, monitor.
      const base = new THREE.Mesh(k.pcBase, k.body); base.position.set(0, DESK_H + BASE_H / 2, -0.02); u.add(base);
      const keys = new THREE.Mesh(k.kbPlane, k.keyboard); keys.rotation.x = -Math.PI / 2; keys.position.set(0, DESK_H + BASE_H + 0.001, -0.13); u.add(keys);
      const neck = new THREE.Mesh(k.pcNeck, k.body); neck.position.set(0, DESK_H + BASE_H + NECK_H / 2, MON_Z); u.add(neck);
      const monitor = new THREE.Mesh(k.pcMonitor, k.body); monitor.position.set(0, SCREEN_Y, MON_Z); u.add(monitor);
      for (const [geo, mesh] of [[k.pcBase, base], [k.pcMonitor, monitor]]) {
        const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo), trim); line.position.copy(mesh.position); u.add(line);
      }
      // The screen faces into the building (local -z).
      const c = document.createElement("canvas");
      c.width = TEX_W; c.height = TEX_H;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(k.screenFlat, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      screen.position.set(0, SCREEN_Y, SCREEN_Z);
      screen.rotation.y = Math.PI;
      u.add(screen);
      const hit = new THREE.Mesh(k.hitGeo, k.hit);
      hit.position.set(0, SCREEN_Y - 0.1, 0);
      hit.userData.interact = { type: "computer", b, desk: i };
      u.add(hit);
      group.add(u);
      units.push({ i, u, screen, ctx: c.getContext("2d"), tex, hit, label: null, labelKey: "" });
    });
    b.group.add(group);
    group.updateMatrixWorld(true);
    const d = { group, units, trim };
    this.desks.set(b, d);
    return d;
  }

  dropDesks(b) {
    const d = this.desks.get(b);
    if (!d) return;
    b.group.remove(d.group);
    disposeObject(d.group);
    d.trim.dispose();
    this.desks.delete(b);
  }

  sync(s, names) { this.state = s; this.names = names || this.names; this.syncBlocks(); }

  // Who is at desk i of building b, and what they are doing.
  occupant(b, i) {
    const s = this.state;
    if (!s) return null;
    const root = String(b.data.root).toLowerCase();
    for (const [id, sh] of Object.entries(s.shifts || {})) {
      if (sh.desk === i && String(sh.root || "").toLowerCase() === root && (sh.state === "in" || sh.state === "commute")) {
        const job = s.jobs.find((j) => j.agent === id && (j.status === "running" || j.status === "assigned"));
        return { id, shift: sh, job };
      }
    }
    return null;
  }

  // Code blocks sit on the sender's desk while placed, then on the recipient's.
  syncBlocks() {
    const live = new Set();
    for (const blk of this.state?.blocks || []) {
      if (blk.state === "ran" && Date.now() - (blk.lastRun?.t || blk.createdAt) > 10 * 60_000) continue;
      const holder = blk.state === "placed" ? { root: blk.root, desk: blk.desk } : this.state.shifts?.[blk.to];
      const b = holder && this.buildingByRoot(holder.root);
      if (!b || holder.desk == null) continue;
      live.add(blk.id);
      let m = this.blockMeshes.get(blk.id);
      const where = `${b.data.root}|${holder.desk}|${blk.state}`;
      if (m && m.userData.where !== where) { this.scene.remove(m); disposeObject(m); m = null; }
      if (!m) {
        m = new THREE.Group();
        const core = new THREE.Mesh(this.kit.blockGeo, this.kit.blockCore);
        const lines = new THREE.LineSegments(this.kit.blockEdges, this.kit.blockLine);
        m.add(core, lines);
        const label = makeLabel([`</> ${blk.name}`, `${blk.state} · for ${this.names?.get(blk.to) || "?"}`], { color: "#39ff88", px: 36, height: 0.14 });
        label.position.y = 0.32;
        m.add(label);
        const hit = new THREE.Mesh(this.kit.hitGeo, this.kit.hit);
        hit.scale.setScalar(0.5);
        hit.userData.interact = { type: "codeblock", id: blk.id };
        m.add(hit);
        m.userData = { where, hit, base: null };
        const xs = deskXs(b), x = xs[holder.desk] ?? 0;
        const off = blk.state === "placed" ? 0.45 : -0.45;
        m.position.copy(this.city.toWorld(b, x + off * b.s, DESK_H + 0.2, deskZ(b) - 0.05));
        m.userData.base = m.position.y;
        this.scene.add(m);
        this.blockMeshes.set(blk.id, m);
      }
    }
    for (const [id, m] of this.blockMeshes) if (!live.has(id)) { this.scene.remove(m); disposeObject(m); this.blockMeshes.delete(id); }
  }

  hitsNear(p) {
    const out = [];
    for (const [b, d] of this.desks) if (this.city.near(b, p, 4)) for (const u of d.units) out.push(u.hit);
    for (const m of this.blockMeshes.values()) if (m.position.distanceToSquared(p) < 64) out.push(m.userData.hit);
    return out;
  }

  update(t, dt, p, names) {
    for (const b of this.city.buildings) {
      const near = this.city.near(b, p, 30);
      if (near && !this.desks.has(b)) this.buildDesks(b);
      else if (!near && this.desks.has(b)) this.dropDesks(b);
    }
    for (const m of this.blockMeshes.values()) { m.rotation.y += dt * 0.8; m.position.y = m.userData.base + Math.sin(t * 2 + m.id) * 0.03; }
    this.drawTimer -= dt;
    if (this.drawTimer > 0) return;
    this.drawTimer = 0.33;
    for (const [b, d] of this.desks) {
      for (const u of d.units) {
        const close = u.u.getWorldPosition(TMP).distanceTo(p) < 22;
        const occ = this.occupant(b, u.i);
        if (!close && u.drawn) continue;
        if (this.inUse && this.inUse.b === b && this.inUse.desk === u.i) drawBlank(u.ctx);
        else drawScreen(u.ctx, b, u.i, occ, names, t);
        u.tex.needsUpdate = true;
        u.drawn = true;
        const key = occ ? `${occ.id}|${occ.shift.state}` : "vacant";
        if (key !== u.labelKey) {
          if (u.label) { u.u.remove(u.label); disposeObject(u.label); u.label = null; }
          u.labelKey = key;
          if (!occ) continue;
          const who = occ ? names.get(occ.id) || occ.id : "VACANT";
          u.label = makeLabel([`DESK ${u.i + 1} · ${occ ? who : "VACANT"}`], { color: occ ? b.color : "#6f97a6", px: 34, height: 0.07 });
          u.label.position.set(0, DESK_H - 0.16, -DESK_D / 2 - 0.06);
          u.u.add(u.label);
          u.labelKey = key;
        }
      }
    }
  }
}
const TMP = new THREE.Vector3();

// ── the CRT picture on an in-world screen ──────────────────────────────────
const PHOS = "#2ef2ff";
const FINISHED = ["done", "failed", "cancelled"];
// "TODAY 14:32", "YESTERDAY 09:05" or "OCT 28 17:40", for finished jobs.
function when(ms) {
  if (!ms) return "";
  const d = new Date(ms), now = new Date();
  const hm = d.toTimeString().slice(0, 5);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  return diff === 0 ? `TODAY ${hm}` : diff === 1 ? `YESTERDAY ${hm}` : `${d.toLocaleString("en", { month: "short" }).toUpperCase()} ${d.getDate()} ${hm}`;
}

function drawScreen(ctx, b, i, occ, names, t) {
  const W = TEX_W, H = TEX_H;
  const g = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.7);
  g.addColorStop(0, "#04222b");
  g.addColorStop(1, "#000608");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.font = "27px 'VT323', 'Consolas', monospace";
  ctx.textBaseline = "top";
  ctx.shadowColor = PHOS;
  ctx.shadowBlur = 6;
  ctx.fillStyle = PHOS;
  const lines = [`GRIDLINK · TERMINAL ${i + 1}`, "".padEnd(26, "=")];
  if (!occ) {
    lines.push("", "NO OPERATOR", "", "> PRESS [E] TO LOG ON");
  } else {
    const who = (names.get(occ.id) || occ.id).toUpperCase();
    lines.push(`OPERATOR: ${who}`);
    if (occ.shift.state !== "in") lines.push("", "OPERATOR EN ROUTE...");
    else if (!occ.job) lines.push("STATUS: IDLE, WAITING FOR A JOB", "", "> JOB BOARD EMPTY");
    else {
      lines.push(`JOB: ${occ.job.title.toUpperCase().slice(0, 28)}`, `STATUS: ${occ.job.status.toUpperCase()}`, "");
      for (const l of occ.job.log || []) {
        const tag = { tool: "$ ", out: "  ", say: "> ", err: "! ", sys: "# " }[l.kind] || "  ";
        for (const row of wrap(tag + l.text, 27).slice(0, 2)) lines.push(row);
      }
    }
  }
  let y = 10;
  for (const l of lines.slice(-9)) { ctx.fillText(l, 16, y); y += 29; }
  if (Math.floor(t * 2) % 2 === 0) ctx.fillRect(16, y + 2, 13, 24);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  for (let s = 0; s < H; s += 3) ctx.fillRect(0, s, W, 1);
}

// Key caps with faint cyan legends, for the top of every keyboard.
let kbTex = null;
function keyboardTexture() {
  if (kbTex) return kbTex;
  const c = document.createElement("canvas");
  c.width = 512; c.height = 184;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#03090c";
  ctx.fillRect(0, 0, c.width, c.height);
  const rows = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  ctx.font = "16px 'VT323', Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  rows.forEach((r, ri) => {
    const off = 14 + ri * 14;
    [...r].forEach((ch, ci) => {
      const x = off + ci * 46, y = 10 + ri * 42;
      // Light caps with bright legends: the keyboard is what says "computer" from across the lobby.
      ctx.fillStyle = "#35525e"; ctx.fillRect(x, y, 40, 36);
      ctx.fillStyle = "#4d6f7c"; ctx.fillRect(x, y, 40, 4);
      ctx.fillStyle = "rgba(120,250,255,0.95)"; ctx.fillText(ch, x + 20, y + 18);
    });
  });
  kbTex = new THREE.CanvasTexture(c);
  kbTex.colorSpace = THREE.SRGBColorSpace;
  kbTex.center.set(0.5, 0.5);
  kbTex.rotation = Math.PI; // the box's top face is seen from its far side
  return kbTex;
}

// A script as terminal output: each source line wraps under itself.
function codeBlock(code) {
  const pre = document.createElement("div");
  pre.className = "t-code";
  for (const src of String(code).split("\n")) {
    const row = document.createElement("div");
    row.className = "t-src";
    const lead = /^\s*/.exec(src)[0].replace(/\t/g, "  ").length;
    row.style.paddingLeft = `${lead + 2}ch`;
    row.textContent = src.trimStart() || " ";
    pre.append(row);
  }
  return pre;
}

function drawBlank(ctx) {
  ctx.fillStyle = "#000304";
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  for (let i = 0; i < 900; i++) { // static while the tube warms up
    ctx.fillStyle = `rgba(150,240,255,${Math.random() * 0.22})`;
    ctx.fillRect(Math.random() * TEX_W, Math.random() * TEX_H, 1 + Math.random() * 2, 1);
  }
  // The tube warming up: a hot collapsed line with a bloom around it.
  const g = ctx.createLinearGradient(0, TEX_H / 2 - 18, 0, TEX_H / 2 + 18);
  g.addColorStop(0, "rgba(46,242,255,0)");
  g.addColorStop(0.5, "rgba(200,255,255,0.9)");
  g.addColorStop(1, "rgba(46,242,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(TEX_W * 0.08, TEX_H / 2 - 18, TEX_W * 0.84, 36);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(TEX_W * 0.12, TEX_H / 2 - 1, TEX_W * 0.76, 2);
}




function wrap(s, n) {
  const out = [];
  for (const para of String(s).replace(/\s+/g, " ").match(new RegExp(`.{1,${n}}`, "g")) || [""]) out.push(para);
  return out;
}

// ═════════════════════════════ Terminal ════════════════════════════════════
// A full-view CRT. Arrow keys / Enter pick menu entries, Tab or Esc goes back,
// Esc on the main menu logs off. Text types itself out like an old terminal.
export class Terminal {
  // hooks: { api, names(), selfId, onExit(), toast(text, color) }
  constructor(hooks) {
    this.h = hooks;
    this.root = document.getElementById("terminal");
    this.screen = this.root.querySelector(".t-screen");
    this.out = this.root.querySelector(".t-out");
    this.open = false;
    this.stack = [];
    this.sel = 0;
    this.items = [];
    this.timers = [];
    this.audio = null;
    this.onKey = (e) => this.key(e);
    this.out.addEventListener("scroll", () => this.markMore());
  }

  // b: building, desk: index, ws: work state, corners: the glass's corners in
  // screen pixels when the terminal sits on a real monitor (else a full view).
  show(b, desk, ws, corners = null) {
    this.b = b; this.desk = desk; this.ws = ws;
    this.open = true;
    this.stack = [];
    this.root.hidden = false;
    document.body.classList.add("terminal-on");
    this.root.classList.toggle("inworld", Boolean(corners));
    if (corners) this.place(corners);
    this.root.classList.remove("off");
    this.root.classList.add("boot");
    setTimeout(() => this.root.classList.remove("boot"), 900);
    addEventListener("keydown", this.onKey, true);
    this.go(() => this.bootScreen());
  }

  // Fit the screen to the projected glass; ~25 lines fill its height.
  place(c) {
    const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
    const s = this.root.style;
    s.setProperty("--gx", `${x}px`); s.setProperty("--gy", `${y}px`);
    s.setProperty("--gw", `${w}px`); s.setProperty("--gh", `${h}px`);
    s.setProperty("--fs", `${Math.max(14, h / 12.5 / 1.12)}px`);
  }

  // Power-on: a short self-test, as old terminals did, then the menu.
  bootScreen() {
    const op = this.operator, names = this.h.names();
    const rows = [
      "OMNI GRIDLINK (TM) BIOS 2.6",
      "MEMORY TEST ......... 65536K OK",
      `MOUNT ${this.b.data.name.toUpperCase()} ...... OK`,
      `SANDBOX /sandboxes/${op ? (names.get(op) || op).replace(/\s+/g, "_").toUpperCase() : "GUEST"} ... LOCKED`,
      "NETWORK ............. ISOLATED",
      "KEYS: UP/DOWN, ENTER. TAB BACK. ESC LOGS OFF.",
      "",
      `> LOGON ${op ? (names.get(op) || op).toUpperCase() : "GUEST"}`,
    ];
    rows.forEach((r) => this.line(r, r.startsWith(">") ? "" : "dim"));
    const t = setTimeout(() => { if (this.open && this.stack.length === 1) { this.stack = []; this.go(() => this.mainMenu()); } }, 1100);
    this.timers.push(t);
    this.items = [];
  }

  hide() {
    this.open = false;
    this.clearTimers();
    removeEventListener("keydown", this.onKey, true);
    this.root.classList.add("off");
    setTimeout(() => { if (!this.open) this.root.hidden = true; }, 260);
  }

  sync(ws) { this.ws = ws; if (this.open && this.live) this.live(); }
  clearTimers() { for (const t of this.timers) { clearInterval(t); clearTimeout(t); } this.timers = []; this.live = null; }

  get operator() {
    const root = String(this.b.data.root).toLowerCase();
    for (const [id, sh] of Object.entries(this.ws?.shifts || {})) {
      if (sh.desk === this.desk && String(sh.root || "").toLowerCase() === root && sh.state === "in") return id;
    }
    return null;
  }

  click(freq = 1800, dur = 0.018, vol = 0.03) {
    try {
      this.audio ||= new AudioContext();
      const a = this.audio, o = a.createOscillator(), g = a.createGain();
      o.type = "square"; o.frequency.value = freq * (0.9 + Math.random() * 0.2);
      g.gain.setValueAtTime(vol, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(g).connect(a.destination);
      o.start(); o.stop(a.currentTime + dur);
    } catch { /* no audio */ }
  }

  // Each screen is a function that fills this.out and sets this.items.
  go(fn) { this.stack.push(fn); this.sel = 0; this.render(); }
  back() {
    if (this.stack.length > 1) { this.stack.pop(); this.sel = 0; this.render(); this.click(900); }
    else this.h.onExit();
  }
  render() {
    this.clearTimers();
    this.items = [];
    this.out.replaceChildren();
    const done = this.stack.at(-1)();
    // Screens that load (a job, a block) add their prompt once their text is in.
    if (done?.then) { done.then(() => { if (this.open) { this.prompt(); this.paintSel(); } }); return; }
    this.prompt();
    this.paintSel();
  }

  prompt() {
    const cur = document.createElement("div");
    cur.className = "t-line t-promptline";
    cur.textContent = "> ";
    const block = document.createElement("span");
    block.className = "t-cursor";
    cur.append(block);
    if (!this.out.querySelector(".t-prompt")) this.out.append(cur);
  }

  header() {
    const names = this.h.names(), op = this.operator;
    this.line(`GRIDLINK T${this.desk + 1} · ${op ? (names.get(op) || op).toUpperCase() : "GUEST"}`, "hd");
    this.line("");
  }

  line(text, cls = "", type = true) {
    const d = document.createElement("div");
    d.className = `t-line ${cls}`;
    this.out.append(d);
    if (!type || !text) { d.textContent = text || " "; return d; }
    // Teletype: lines appear a few characters per frame.
    let n = 0;
    const step = () => {
      n = Math.min(text.length, n + 6);
      d.textContent = text.slice(0, n);
      // A timer, not requestAnimationFrame: rAF pauses when the page isn't
      // painting, which froze lines half-typed.
      if (n < text.length && this.open) setTimeout(step, 16);
      else if (n < text.length) d.textContent = text;
    };
    step();
    return d;
  }

  item(label, fn, cls = "") {
    const d = this.line(`[${label}]`, `t-item ${cls}`);
    const idx = this.items.length;
    this.items.push({ d, fn });
    // mousemove, not mouseenter: a cursor already resting over the glass must
    // not grab the selection when a screen opens under it.
    d.onmousemove = () => { if (this.sel !== idx) { this.sel = idx; this.paintSel(); } };
    d.onclick = () => { this.sel = idx; this.activate(); };
    return d;
  }

  // The view follows the selection only when the keys move it; a fresh
  // screen stays scrolled to its top.
  paintSel(follow = false) {
    this.items.forEach((it, i) => it.d.classList.toggle("sel", i === this.sel));
    if (follow) this.items[this.sel]?.d.scrollIntoView({ block: "nearest" });
    this.markMore();
  }

  // Fade the bottom edge only while there is more below it.
  markMore() {
    const o = this.out;
    const check = () => {
      if (this.root.classList.contains("inworld")) {
        o.style.height = ""; o.style.flex = "";
        const lh = parseFloat(getComputedStyle(o).lineHeight) || 20;
        o.style.height = `${Math.floor(o.clientHeight / lh) * lh}px`;
        o.style.flex = "none";
      }
      // A code box ends on a whole line wherever it sits on the glass.
      const bottom = o.getBoundingClientRect().bottom;
      for (const code of o.querySelectorAll(".t-code")) {
        code.style.maxHeight = ""; code.style.display = "";
        const lhc = parseFloat(getComputedStyle(code).lineHeight) || 20;
        const room = bottom - code.getBoundingClientRect().top;
        if (room < lhc) code.style.display = "none"; // nothing whole fits: show it after scrolling
        else if (room < code.scrollHeight) code.style.maxHeight = `${Math.floor(room / lhc) * lhc}px`;
      }
      // Any line the glass would cut in half waits for the scroll instead.
      for (const el of o.children) {
        if (el.classList.contains("t-code")) continue;
        const r = el.getBoundingClientRect();
        el.style.visibility = r.top < bottom - 1 && r.bottom > bottom + 1 ? "hidden" : "";
      }
      const more = o.scrollTop + o.clientHeight < o.scrollHeight - 2;
      o.classList.toggle("more", more);
      this.root.classList.toggle("has-more", more);
    };
    requestAnimationFrame(check);
    setTimeout(check, 400); // again once the teletype has laid the lines out
  }

  activate() { const it = this.items[this.sel]; if (it) { this.click(1200, 0.03, 0.04); it.fn(); } }

  key(e) {
    if (!this.open) return;
    const typing = e.target.matches?.("input, textarea, select");
    if (e.code === "Escape" || (e.code === "Tab" && !typing)) { e.preventDefault(); e.stopPropagation(); this.back(); return; }
    // Typing goes to the field (stopping it here, in the capture phase, would
    // keep it from ever reaching the input); the game ignores keys while termMode is on.
    if (typing) { if (e.key.length === 1) this.click(2200, 0.012, 0.015); return; }
    e.stopPropagation();
    if (e.code === "ArrowDown" || e.code === "KeyS") { e.preventDefault(); this.sel = (this.sel + 1) % Math.max(1, this.items.length); this.paintSel(true); this.click(); }
    else if (e.code === "ArrowUp" || e.code === "KeyW") { e.preventDefault(); this.sel = (this.sel - 1 + this.items.length) % Math.max(1, this.items.length); this.paintSel(true); this.click(); }
    else if (e.code === "Enter" || e.code === "KeyE" || e.code === "Space") { e.preventDefault(); this.activate(); }
  }

  // ── screens ────────────────────────────────────────────────────────────
  mainMenu() {
    this.header();
    const op = this.operator, ws = this.ws, names = this.h.names();
    const mine = op ? ws.jobs.find((j) => j.agent === op && ["running", "assigned"].includes(j.status)) : null;
    const open = ws.jobs.filter((j) => j.status === "open").length, running = ws.jobs.filter((j) => j.status === "running").length;
    const blocks = ws.blocks.filter((k) => op && (k.to === op || k.from === op)).length;
    this.line(`${this.b.data.name.toUpperCase()} · ${open} WAITING · ${running} RUNNING`, "dim");
    this.line("");
    if (mine) this.item(`Live session: ${mine.title}`, () => this.go(() => this.jobScreen(mine.id, true)));
    else if (op) this.line(`> ${(names.get(op) || op).toUpperCase()} IS WAITING FOR A JOB`, "dim");
    const here = this.finishedHere();
    if (here.length) {
      const last = here.at(-1);
      this.item(`Last finished here: ${last.title.slice(0, 34)}`, () => this.go(() => this.jobScreen(last.id, false)), `st-${last.status}`);
      if (here.length > 1) this.item(`Finished work here (${here.length})`, () => this.go(() => this.finishedList()));
    }
    this.item("Job board", () => this.go(() => this.board()));
    this.item("Post a job", () => this.go(() => this.postForm()));
    this.item(`Code blocks${blocks ? ` (${blocks})` : ""}`, () => this.go(() => this.blocksScreen()));
    this.item("Work chat", () => this.go(() => this.chatScreen()));
    this.item("Shift roster", () => this.go(() => this.roster()));
    this.item("Log off", () => this.h.onExit());
  }

  // Finished jobs (done or failed) in this computer's project, oldest first.
  finishedHere() {
    const root = String(this.b.data.root).toLowerCase();
    return this.ws.jobs.filter((j) => (j.status === "done" || j.status === "failed") && String(j.root).toLowerCase() === root);
  }

  board() {
    this.header();
    this.line("JOB BOARD", "hd2");
    const jobs = [...this.ws.jobs].reverse();
    if (!jobs.length) this.line("NO JOBS POSTED YET. [POST A JOB] FROM THE MAIN MENU.", "dim");
    // One line per job: state, title, who. The project and pay are on the job's own screen.
    const row = (j) => this.item(`${j.status} · ${j.title.slice(0, 30)}${j.agentName ? ` · ${j.agentName}` : ""}`.toUpperCase(),
      () => this.go(() => this.jobScreen(j.id, j.status === "running")), `st-${j.status}`);
    const active = jobs.filter((j) => !FINISHED.includes(j.status)), finished = jobs.filter((j) => FINISHED.includes(j.status));
    active.slice(0, 10).forEach(row);
    if (finished.length) { this.line(""); this.line("FINISHED", "dim"); finished.slice(0, 12).forEach(row); }
    this.item("Back", () => this.back());
  }

  finishedList() {
    this.header();
    this.line(`FINISHED WORK · ${this.b.data.name.toUpperCase()}`, "hd2");
    for (const j of [...this.finishedHere()].reverse()) {
      this.item(`${j.status} · ${when(j.endedAt)} · ${j.title.slice(0, 28)}${j.agentName ? ` · ${j.agentName}` : ""}`.toUpperCase(),
        () => this.go(() => this.jobScreen(j.id, false)), `st-${j.status}`);
    }
    this.item("Back", () => this.back());
  }

  // A finished job opens on what it did, not on its raw log: files changed,
  // what it read and ran, how long it took, and its report in its own words.
  summaryScreen(job) {
    const s = job.summary || {};
    this.line(job.title.toUpperCase(), "hd2");
    this.line(`${job.status.toUpperCase()} · ${(job.agentName || "UNASSIGNED").toUpperCase()} · ${job.project} · ${job.pay}C`, "dim");
    const took = [job.endedAt && `FINISHED ${when(job.endedAt)}`, s.minutes != null && `TOOK ${s.minutes} MIN`, s.turns != null && `${s.turns} TURNS`, `${s.toolCalls} TOOL CALLS`].filter(Boolean);
    this.line(took.join(" · "), "dim");
    this.line("");
    this.line("WHAT IT DID", "hd2");
    const changed = s.changed || [];
    if (changed.length) {
      for (const c of changed.slice(0, 8)) this.line(`  ${c.how.toUpperCase().padEnd(13)} ${c.file}`, "k-tool");
      if (changed.length > 8) this.line(`  ...AND ${changed.length - 8} MORE FILES`, "dim");
    } else this.line("  CHANGED NO FILES", "dim");
    const other = [s.reads && `READ ${s.reads} FILES/FOLDERS`, s.commands && `RAN ${s.commands} COMMANDS`, s.browser && `${s.browser} BROWSER STEPS`].filter(Boolean);
    if (other.length) this.line(`  ${other.join(" · ")}`, "dim");
    this.line("");
    this.line(job.status === "done" ? "IN ITS OWN WORDS" : "WHY IT STOPPED", "hd2");
    const gist = s.gist?.length ? s.gist : [job.result || "NO REPORT."];
    const words = document.createElement("div");
    words.className = "t-line t-result t-gist";
    words.textContent = gist.join("\n");
    this.out.append(words);
    this.line("");
    if (job.result && job.result.length > gist.join("\n").length + 40) this.item("Read the full report", () => this.go(() => this.reportScreen(job)));
    if (job.logLines) this.item(`Show the work log (${job.logLines} lines)`, () => this.go(() => this.logScreen(job.id)));
    this.item("Back", () => this.back());
  }

  reportScreen(job) {
    this.header();
    this.line(`REPORT · ${job.title.toUpperCase()}`, "hd2");
    const r = document.createElement("div");
    r.className = "t-line t-result t-gist";
    r.textContent = job.result || "NO REPORT.";
    this.out.append(r);
    this.item("Back", () => this.back());
  }

  async logScreen(id) {
    await this.jobScreen(id, false, true);
  }

  async jobScreen(id, follow, rawLog = false) {
    this.header();
    const head = this.line("LOADING JOB...", "dim");
    if (!rawLog) {
      let first;
      try { first = await this.h.api(`/api/work/job?id=${encodeURIComponent(id)}`); } catch (e) { head.textContent = `ERROR: ${e.message}`; this.item("Back", () => this.back()); return; }
      if (FINISHED.includes(first.status)) { head.remove(); this.summaryScreen(first); return; }
    }
    const body = document.createElement("div");
    body.className = "t-log";
    this.out.append(body);
    let seen = 0, job = null;
    const pull = async () => {
      try { job = await this.h.api(`/api/work/job?id=${encodeURIComponent(id)}`); } catch (e) { head.textContent = `ERROR: ${e.message}`; return; }
      head.textContent = `${job.title.toUpperCase()} · ${job.status.toUpperCase()} · ${job.project} · ${job.agentName || "UNASSIGNED"} · ${job.pay}c · ${job.mode}`;
      if (!seen && job.brief) { const p = document.createElement("div"); p.className = "t-line dim"; p.textContent = `BRIEF: ${job.brief}`; body.append(p); }
      for (const l of job.log.slice(seen ? job.log.length - (job.log.length - seen) : 0)) {
        const d = document.createElement("div");
        d.className = `t-line k-${l.kind}`;
        d.textContent = `${{ tool: "$", out: " ", say: ">", err: "!", sys: "#" }[l.kind] || " "} ${l.text}`;
        body.append(d);
      }
      seen = job.log.length;
      if (job.result && !body.querySelector(".t-result")) {
        const r = document.createElement("div"); r.className = "t-line t-result"; r.textContent = `REPORT:\n${job.result}`; body.append(r);
      }
      if (follow) body.scrollTop = body.scrollHeight;
      this.root.querySelector(".t-status").textContent = job.status === "running" ? "● LIVE" : "";
    };
    await pull();
    if (job && ["running", "assigned", "open"].includes(job.status)) this.timers.push(setInterval(pull, 1500));
    if (job && ["open", "assigned", "running"].includes(job.status)) this.item("Cancel this job", async () => { await this.h.api("/api/work/cancel", { id }); this.h.toast("Job cancelled", "#ff9f1c"); this.render(); });
    this.item("Back", () => this.back());
  }

  // Fields are asked one at a time at the prompt, like an old terminal:
  // typed answers on an inline line, choices as a menu, then a Y/N confirm.
  postForm() {
    const names = this.h.names();
    const ask = [
      { key: "title", label: "TITLE", text: true },
      { key: "brief", label: "BRIEF", text: true, hint: "WHAT DONE LOOKS LIKE. ENTER WHEN FINISHED." },
      { key: "kind", label: "KIND", choices: ["code", "website", "vps", "site-ops", "review", "other"].map((k) => [k, k.toUpperCase()]) },
      { key: "mode", label: "MODE", choices: [["accept-edits", "EDITS ALLOWED"], ["plan", "READ-ONLY (PLAN)"], ["auto", "AUTO (SHELL, FOR VPS)"]] },
      { key: "pay", label: "PAY", text: true, def: String(this.ws.config?.defaultPay ?? 60), numeric: true },
      { key: "want", label: "FOR", choices: [["", "ANY AGENT"], ...[...names].map(([id, n]) => [id, n.toUpperCase()])] },
      { key: "where", label: "WHERE", choices: [["here", `THIS BUILDING (${this.b.data.name.toUpperCase()})`], ["new", "A NEW PROJECT (NEW TOWER)"]] },
    ];
    const ans = {};
    const step = () => {
      this.clearTimers();
      this.items = [];
      this.sel = 0;
      this.out.replaceChildren();
      this.header();
      this.line("POST A JOB", "hd2");
      for (const q of ask) if (q.key in ans) this.line(`> ${q.label}: ${q.choices ? q.choices.find(([v]) => v === ans[q.key])[1] : (ans[q.key] || "-").toUpperCase()}`, "", false);
      const q = ask.find((x) => !(x.key in ans));
      if (!q) {
        this.line("");
        this.line("TRANSMIT THIS JOB?");
        this.item("Yes, transmit", async () => {
          const body = { from: "you", title: ans.title, brief: ans.brief, kind: ans.kind, mode: ans.mode, pay: Number(ans.pay), want: ans.want || undefined };
          if (ans.where === "new") body.newProject = true; else body.root = this.b.data.root;
          try {
            const j = await this.h.api("/api/work/job", body);
            this.h.toast(`Job posted: ${j.title}`, "#39ff88");
            this.click(600, 0.12, 0.05);
            this.stack.pop();
            this.go(() => this.jobScreen(j.id, true));
          } catch (err) { this.line(`ERROR: ${err.message}`, "warn"); }
        });
        this.item("No, start over", () => { for (const k of Object.keys(ans)) delete ans[k]; step(); });
        this.item("Back", () => this.back());
        this.paintSel();
        return;
      }
      if (q.hint) this.line(q.hint, "dim");
      if (q.choices) {
        this.line(`> ${q.label}:`);
        for (const [v, label] of q.choices) this.item(label, () => { ans[q.key] = v; step(); });
        this.paintSel();
        return;
      }
      const row = document.createElement("div");
      row.className = "t-line t-prompt";
      row.textContent = `> ${q.label}: `;
      const input = document.createElement("input");
      input.className = "t-inline";
      input.maxLength = q.key === "brief" ? 8000 : 120;
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = q.def || "";
      // The field is as wide as its text, so the block cursor after it sits
      // right behind the last letter, like a real terminal's.
      // Measured, not counted: upper case and letter-spacing make it wider than its characters.
      const ruler = document.createElement("span");
      ruler.className = "t-ruler";
      const fit = () => { ruler.textContent = input.value; input.style.width = `${ruler.offsetWidth + 2}px`; };
      input.addEventListener("input", fit);
      setTimeout(fit, 0);
      input.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const v = input.value.trim();
        if (q.key === "title" && !v) { this.click(300, 0.08); return; }
        if (q.numeric && !/^\d+$/.test(v)) { input.value = q.def; this.click(300, 0.08); return; }
        this.click(1200, 0.03, 0.04);
        ans[q.key] = v;
        step();
      };
      row.append(input, ruler);
      const cur = document.createElement("span");
      cur.className = "t-cursor";
      row.append(cur);
      this.out.append(row);
      setTimeout(() => input.focus(), 30);
    };
    step();
  }

  postFormOld() {
    this.header();
    this.line("POST A JOB", "hd2");
    this.line(`PAY COMES FROM YOU (THE CLIENT). THE JOB RUNS AS AN OMNI SESSION IN ${this.b.data.name.toUpperCase()}.`, "dim");
    const f = document.createElement("form");
    f.className = "t-form";
    const names = this.h.names();
    const agentOpts = [["", "ANY AGENT"], ...[...names].map(([id, n]) => [id, n.toUpperCase()])];
    f.innerHTML = `
      <label>&gt; TITLE: <input name="title" maxlength="120" required autocomplete="off"></label>
      <label>&gt; BRIEF: <textarea name="brief" rows="4" maxlength="8000" spellcheck="false"></textarea></label>
      <div class="t-col">
        <label>&gt; KIND: <select name="kind">${["code", "website", "vps", "site-ops", "review", "other"].map((k) => `<option value="${k}">${k.toUpperCase()}</option>`).join("")}</select></label>
        <label>&gt; MODE: <select name="mode"><option value="accept-edits">EDITS ALLOWED</option><option value="plan">READ-ONLY (PLAN)</option><option value="auto">AUTO (SHELL, FOR VPS)</option></select></label>
        <label>&gt; PAY: <input name="pay" type="number" min="0" max="5000" value="${this.ws.config?.defaultPay ?? 60}"></label>
      </div>
      <div class="t-col">
        <label>&gt; FOR: <select name="want">${agentOpts.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select></label>
        <label>&gt; WHERE: <select name="where"><option value="here">THIS BUILDING</option><option value="new">A NEW PROJECT (NEW TOWER)</option></select></label>
      </div>
      <button type="submit" class="t-btn">[TRANSMIT]</button>
      <div class="t-line warn t-err"></div>`;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const body = { from: "you", title: d.title, brief: d.brief, kind: d.kind, mode: d.mode, pay: Number(d.pay), want: d.want || undefined };
      if (d.where === "new") body.newProject = true; else body.root = this.b.data.root;
      try {
        const j = await this.h.api("/api/work/job", body);
        this.h.toast(`Job posted: ${j.title}`, "#39ff88");
        this.click(600, 0.12, 0.05);
        this.stack.pop();
        this.go(() => this.jobScreen(j.id, true));
      } catch (err) { f.querySelector(".t-err").textContent = `ERROR: ${err.message}`; }
    };
    this.out.append(f);
    setTimeout(() => f.querySelector("input")?.focus(), 50);
    this.item("Back", () => this.back());
  }

  blocksScreen() {
    this.header();
    this.line("CODE BLOCKS", "hd2");
    const op = this.operator, names = this.h.names();
    this.line("A CODE BLOCK RUNS ONLY IN THE SANDBOX BEHIND ITS RECIPIENT'S OWN TERMINAL: NODE, NO NETWORK, NO FILES OUTSIDE ITS FOLDER.", "dim");
    const list = [...this.ws.blocks].reverse();
    if (!list.length) this.line("NO BLOCKS IN TRANSIT.", "dim");
    for (const k of list.slice(0, 14)) {
      const tag = op && k.to === op ? "IN · " : op && k.from === op ? "OUT · " : "";
      this.item(`${tag}${k.name} · ${names.get(k.from) || k.from} → ${names.get(k.to) || k.to} · ${k.state}${k.lastRun ? (k.lastRun.ok ? " · OK" : " · FAILED") : ""}`.toUpperCase(), () => this.go(() => this.blockScreen(k.id)));
    }
    this.item("Write a block", () => this.go(() => this.blockForm()));
    this.item("Back", () => this.back());
  }

  async blockScreen(id) {
    this.header();
    let k;
    try { k = await this.h.api(`/api/work/block?id=${encodeURIComponent(id)}`); } catch (e) { this.line(`ERROR: ${e.message}`, "warn"); this.item("Back", () => this.back()); return; }
    const names = this.h.names(), op = this.operator;
    // Compact: the script is the content, so the header takes one line.
    this.line(`${k.name} → ${(names.get(k.to) || k.to).toUpperCase()} · ${k.state.toUpperCase()}`, "hd2");
    const pre = codeBlock(k.code);
    const outBox = document.createElement("pre"); outBox.className = "t-code t-run";
    const last = k.runs.at(-1);
    // The run result in a line or two; the full output is in the work chat.
    outBox.textContent = last ? `${last.ok ? "OK" : "FAILED"} · ${last.ms} MS · ${last.output.trim().split("\n").join(" / ")}`.slice(0, 110) : "NOT RUN YET.";
    // The result first: it is what you came to see; the script follows.
    const rule = document.createElement("div"); rule.className = "t-line t-rule"; rule.textContent = "-- SCRIPT --";
    this.out.append(outBox, rule, pre);
    if (op && op === k.to) {
      this.item(`Run in ${(names.get(op) || op).toUpperCase()}'S sandbox`, async () => {
        outBox.textContent = "RUNNING IN SANDBOX...";
        try { const r = await this.h.api("/api/work/run", { id, agent: op }); outBox.textContent = `${r.ok ? "OK" : "FAILED"} · ${r.ms} MS\n${r.output}`; }
        catch (e) { outBox.textContent = `REFUSED: ${e.message}`; }
      });
    } else this.line(`ONLY ${(names.get(k.to) || k.to).toUpperCase()} CAN RUN THIS, FROM THEIR OWN TERMINAL WHILE CLOCKED IN.`, "warn");
    if (k.state === "placed") this.item("Pick it up (deliver to the recipient)", async () => { await this.h.api("/api/work/pickup", { id, by: "you" }); this.render(); });
    this.item("Back", () => this.back());
  }

  blockForm() {
    this.header();
    this.line("WRITE A CODE BLOCK", "hd2");
    const names = this.h.names(), op = this.operator;
    const f = document.createElement("form");
    f.className = "t-form";
    f.innerHTML = `
      <div class="t-col">
        <label>&gt; TO: <select name="to">${[...names].filter(([id]) => id !== op).map(([id, n]) => `<option value="${id}">${n.toUpperCase()}</option>`).join("")}</select></label>
        <label>&gt; FILE: <input name="name" value="hello.mjs" maxlength="60" autocomplete="off"></label>
      </div>
      <label>&gt; NOTE: <input name="note" maxlength="200" autocomplete="off"></label>
      <label>&gt; CODE: <textarea name="code" rows="7" spellcheck="false">import { writeFileSync, readdirSync } from "node:fs";
writeFileSync("note.txt", "hello from the grid");
console.log("sandbox files:", readdirSync("."));</textarea></label>
      <button type="submit" class="t-btn">[PLACE THE BLOCK ON THIS DESK]</button>
      <div class="t-line warn t-err"></div>`;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      try {
        await this.h.api("/api/work/block", { from: "you", to: d.to, name: d.name, note: d.note, code: d.code, root: this.b.data.root, desk: this.desk });
        this.h.toast(`Code block placed for ${names.get(d.to)}`, "#39ff88");
        this.stack.pop(); this.render();
      } catch (err) { f.querySelector(".t-err").textContent = `ERROR: ${err.message}`; }
    };
    this.out.append(f);
    this.item("Back", () => this.back());
  }

  chatScreen() {
    this.header();
    this.line("WORK CHAT · @NAME ASKS THAT AGENT TO ANSWER", "hd2");
    const log = document.createElement("div");
    log.className = "t-log";
    this.out.append(log);
    let last = "";
    const paint = () => {
      const msgs = this.ws.chat.slice(-40);
      const key = msgs.at(-1)?.id || "";
      if (key === last) return;
      last = key;
      log.replaceChildren(...msgs.map((m) => {
        const d = document.createElement("div");
        d.className = `t-line ${m.from === "you" ? "me" : m.kind ? "dim" : ""}`;
        d.textContent = `${new Date(m.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${m.name.toUpperCase()}: ${m.text}`;
        return d;
      }));
      log.scrollTop = log.scrollHeight;
    };
    paint();
    this.live = paint;
    const f = document.createElement("form");
    f.className = "t-form t-chat";
    f.innerHTML = `<input name="text" maxlength="600" placeholder="> type, Enter sends" autocomplete="off">`;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const input = f.querySelector("input"), text = input.value.trim();
      if (!text) return;
      input.value = "";
      try { await this.h.api("/api/work/chat", { text }); await this.h.refresh(); } catch (err) { this.h.toast(err.message, "#ff3d6e"); }
    };
    this.out.append(f);
    setTimeout(() => f.querySelector("input")?.focus(), 50);
    this.item("Back", () => this.back());
  }

  roster() {
    this.header();
    this.line("SHIFT ROSTER · TODAY", "hd2");
    const names = this.h.names();
    for (const [id, n] of names) {
      const s = this.ws.shifts[id];
      const st = !s ? "not clocked in" : s.state === "in" ? `clocked in at ${s.root?.split(/[\\/]/).pop()} desk ${s.desk + 1}` : s.state === "commute" ? `on the way to ${s.root?.split(/[\\/]/).pop()}` : s.state === "out" ? "clocked out, living their life" : "not clocked in";
      this.line(`${n.toUpperCase().padEnd(18)} ${st}${s?.jobs ? ` · ${s.jobs} job${s.jobs === 1 ? "" : "s"} done` : ""}`);
    }
    this.item("Back", () => this.back());
  }
}

// The barrel map for #crt-barrel: each pixel says how far to pull the picture
// toward the centre, more at the edges, as a curved tube's glass does.
(function drawBarrelMap() {
  const img = document.getElementById("crtMap");
  if (!img) return;
  const n = 128, c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d"), d = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const nx = (x / (n - 1)) * 2 - 1, ny = (y / (n - 1)) * 2 - 1, r2 = nx * nx + ny * ny;
    const i = (y * n + x) * 4;
    d.data[i] = 128 + nx * r2 * 63;
    d.data[i + 1] = 128 + ny * r2 * 63;
    d.data[i + 2] = 128;
    d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  img.setAttribute("href", c.toDataURL());
})();
