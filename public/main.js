import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildAvatar } from "./avatar.js";
import { City, FH } from "./city.js";
import { Player } from "./player.js";
import { AgentNPC } from "./agents.js";
import { disposeObject } from "./labels.js";
import { openNeural } from "./neural.js";
import { EconomyView } from "./economy.js";
import { Terminal, WorkView } from "./work.js";
import { buildBackdrop, displaySettings, hideModes, openSettings, runSplash, showBackdrop, showModes } from "./menu.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k !== null && k !== undefined && k !== false && k !== "") n.append(k);
  return n;
};
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const state = { providers: [], avatars: [], world: null, settings: null, eco: null, previewId: null, embodied: store.get("omniverse.embodied"), busy: new Set() };

// ═════════════════════════════ Agent Gate ═════════════════════════════════
const preview = (() => {
  const canvas = $("previewCanvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  scene.add(new THREE.HemisphereLight(0x88ccff, 0x110022, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const grid = new THREE.GridHelper(6, 24, 0x22e6ff, 0x0b3a48);
  scene.add(grid);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.4, 0.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let mesh = null, running = true;
  const clock = new THREE.Clock();
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  (function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    // getDelta first: getElapsedTime() also advances the clock, which left dt ≈ 0.
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    if ($("gate").hidden) return; // nothing to draw behind the menus
    if (mesh) { mesh.rotation.y = t * 0.5; mesh.userData.update(t, dt); }
    composer.render();
  })();
  return {
    show(spec) {
      if (mesh) { scene.remove(mesh); disposeObject(mesh); }
      mesh = buildAvatar(spec);
      scene.add(mesh);
      const h = spec.height;
      camera.position.set(0, h * 0.65, h * 2.3 + 1);
      camera.lookAt(0, h * 0.5, 0);
    },
    stop() { running = false; renderer.dispose(); },
  };
})();

function avatarFor(provider, model) { return state.avatars.find((a) => a.provider === provider && a.model === model); }
const prefOf = (name) => state.settings?.providers?.[name] || {};

function renderProviders() {
  const list = $("providerList");
  list.replaceChildren();
  const keyed = state.providers.filter((p) => p.hasKey && prefOf(p.name).enabled !== false);
  for (const p of keyed) {
    const select = el("select");
    const want = prefOf(p.name).model || p.defaultModel;
    const models = p.models.includes(want) ? p.models : [want, ...p.models];
    for (const m of models) select.append(el("option", { value: m, textContent: m, selected: m === want }));
    const status = el("div", { className: "status" });
    const btn = el("button", { className: "btn small" });
    const row = el("div", { className: "prov" },
      el("div", { className: "top" }, el("span", { className: "dot" }), el("span", { className: "name", textContent: p.label }),
        el("span", { className: "src", textContent: p.local ? "local · keyless" : p.accounts.length ? `${p.source} · ${p.accounts.filter((a) => a.hasKey).length}/${p.accounts.length} accounts` : p.source })),
      el("div", { className: "row" }, select, btn), status);
    const sync = () => {
      const has = avatarFor(p.name, select.value);
      btn.textContent = state.busy.has(p.name) ? "Forging…" : has ? "Reforge" : "Forge";
      btn.disabled = state.busy.has(p.name);
      row.classList.toggle("busy", state.busy.has(p.name));
      if (has && !status.dataset.sticky) { status.className = "status ok"; status.textContent = `✓ ${has.spec.name} — ${has.spec.species}`; }
      else if (!has && !status.dataset.sticky) status.textContent = "";
    };
    select.onchange = () => { delete status.dataset.sticky; sync(); };
    api(`/api/models?provider=${encodeURIComponent(p.name)}`).then((m) => {
      if (!m.live) return;
      const keep = m.models.includes(select.value) ? select.value : m.defaultModel;
      select.replaceChildren(...m.models.map((id) => el("option", { value: id, textContent: id, selected: id === keep })));
      sync();
    }).catch(() => {});
    btn.onclick = () => forge(p, select.value, status, sync);
    p._forge = () => forge(p, select.value, status, sync);
    p._needs = () => !avatarFor(p.name, select.value);
    sync();
    list.append(row);
  }
  const off = state.providers.filter((p) => p.hasKey && prefOf(p.name).enabled === false);
  const nokey = state.providers.filter((p) => !p.hasKey);
  if (off.length) list.append(el("p", { className: "note", textContent: `Switched off in Settings: ${off.map((p) => p.label).join(" · ")}` }));
  if (nokey.length) {
    list.append(el("details", { className: "nokey" }, el("summary", { textContent: `${nokey.length} providers without a key` }),
      el("p", { textContent: nokey.map((p) => p.label).join(" · ") })));
  }
}

async function forge(p, model, status, sync) {
  state.busy.add(p.name);
  delete status.dataset.sticky;
  status.className = "status";
  status.textContent = `${p.label} is designing itself…`;
  sync();
  try {
    const rec = await api("/api/avatars/forge", { provider: p.name, model, hint: $("hint").value.trim() });
    state.avatars = state.avatars.filter((a) => a.id !== rec.id).concat(rec);
    if (!state.embodied || !state.avatars.some((a) => a.id === state.embodied)) setEmbodied(rec.id);
    state.previewId = rec.id;
    renderRoster();
    showPreview(rec);
  } catch (e) {
    status.className = "status err";
    status.dataset.sticky = "1";
    status.textContent = e.message;
  } finally {
    state.busy.delete(p.name);
    sync();
  }
}

function setEmbodied(id) {
  state.embodied = id;
  store.set("omniverse.embodied", id);
  updateEnter();
}

function showPreview(rec) {
  preview.show(rec.spec);
  const s = rec.spec;
  $("previewInfo").replaceChildren(
    el("h3", { textContent: s.name, style: `color:${s.palette.glow}` }),
    el("div", { className: "species", textContent: `${s.species} · ${rec.provider} / ${rec.model}` }),
    el("p", { textContent: s.description }),
    el("p", { className: "motto", textContent: s.motto ? `“${s.motto}”` : "" }),
    el("button", { className: "btn small pink", textContent: state.embodied === rec.id ? "Embodied ✓" : "Embody this avatar", onclick: () => { setEmbodied(rec.id); renderRoster(); showPreview(rec); } }),
  );
}

function renderRoster() {
  const r = $("roster");
  r.replaceChildren();
  if (!state.avatars.length) r.append(el("p", { className: "muted", textContent: "No agent has entered yet." }));
  for (const a of state.avatars) {
    const card = el("div", { className: `card${a.id === state.previewId ? " sel" : ""}`, onclick: () => { state.previewId = a.id; renderRoster(); showPreview(a); } },
      el("span", { className: "sw", style: `background:${a.spec.palette.primary};color:${a.spec.palette.glow}` }),
      el("div", { className: "meta" }, el("b", { textContent: a.spec.name }), el("small", { textContent: `${a.spec.species} · ${a.provider} / ${a.model}` })),
      a.id === state.embodied ? el("span", { className: "emb", textContent: "YOU" }) : "");
    r.append(card);
  }
  updateEnter();
}

function updateEnter() {
  const ok = state.world && state.avatars.some((a) => a.id === state.embodied);
  $("enterBtn").disabled = !ok;
  $("enterBtn").textContent = !state.world ? "World scan failed" : !state.avatars.length ? "Forge an avatar to enter"
    : !ok ? "Embody an avatar to enter" : "Enter the Omniverse";
}

function initGate(reg) {
  $("forgeAll").onclick = () => {
    // Local endpoints (llama.cpp, Ollama) are only forged on request: they're often not running.
    for (const p of state.providers) if (p.hasKey && !p.local && prefOf(p.name).enabled !== false && p._needs?.() && !state.busy.has(p.name)) p._forge();
  };
  $("enterBtn").onclick = () => enterWorld();
  $("gateStats").onclick = () => showStats();
  $("gateBack").onclick = () => { $("gate").hidden = true; showMenu(); };
  $("keyNote").textContent = reg
    ? reg.mode === "shared"
      ? `Keys & endpoints shared live from Omni (${reg.omniSettings}) — never copied. App-only overrides: ${reg.localEnv}`
      : `Standalone: keys come from ${reg.localEnv}.`
    : "Could not reach the server.";
  renderProviders();
  renderRoster();
  const first = state.avatars.find((a) => a.id === state.embodied) || state.avatars[0];
  if (first) { state.previewId = first.id; showPreview(first); renderRoster(); }
  if (state.world) {
    const files = state.world.buildings.reduce((a, b) => a + b.files, 0);
    $("worldNote").textContent = `${state.world.buildings.length} projects scanned · ${files.toLocaleString()} files · ${new Set(state.world.buildings.map((b) => b.district)).size} districts`;
  } else $("worldNote").textContent = "World scan failed.";
  updateEnter();
}

function openGate() {
  hideModes();
  showBackdrop(true, true);
  renderProviders();
  renderRoster();
  $("gate").hidden = false;
}

// ═════════════════════════════ Boot: splash → modes ═══════════════════════
async function boot() {
  buildBackdrop();
  const quick = sessionStorage.getItem("omniverse.menu") === "1";
  sessionStorage.removeItem("omniverse.menu");
  let reg = null;
  await runSplash([
    { label: "Linking Omni providers", run: async () => { reg = await api("/api/providers"); state.providers = reg.providers; return `${reg.providers.filter((p) => p.hasKey).length} keyed · ${reg.mode}`; } },
    { label: "Waking the agents", run: async () => { state.avatars = await api("/api/avatars"); return `${state.avatars.length} avatars`; } },
    { label: "Reading settings", run: async () => { state.settings = await api("/api/settings"); return state.settings.economy.enabled ? "economy on" : "economy off"; } },
    { label: "Raising skyscrapers from your projects", run: async () => { state.world = await api("/api/world"); return `${state.world.buildings.length} buildings`; } },
    { label: "Opening the market", run: async () => { state.eco = await api("/api/eco/state"); return `${state.eco.nodes.length} neon blocks out there`; } },
  ], { quick });
  $("spInfo").textContent = "";
  initGate(reg);
  // A new install: nothing picked yet, so open the project picker first.
  if (state.world && state.world.chosen === false && !sessionStorage.getItem("omniverse.pickerShown")) {
    sessionStorage.setItem("omniverse.pickerShown", "1");
    openSettingsScreen({ tab: "projects", firstRun: true });
    return;
  }
  showMenu();
}

function openSettingsScreen(opts = {}) {
  showBackdrop(true, true);
  openSettings(api, { ...opts, onClose: async () => {
    try { [state.settings, state.world] = await Promise.all([api("/api/settings"), api("/api/world")]); } catch { /* keep what we had */ }
    renderProviders();
    showMenu();
  } });
}

function showMenu() {
  showBackdrop(true);
  const me = state.avatars.find((a) => a.id === state.embodied);
  const w = state.world, eco = state.eco;
  const keyed = state.providers.filter((p) => p.hasKey).length;
  const wallets = eco ? Object.values(eco.wallets) : [];
  const projects = w ? `${w.buildings.length} projects · ${new Set(w.buildings.map((b) => b.district)).size} districts` : "world scan failed";
  showModes([
    {
      id: "play", title: "ENTER THE CITY", color: "#22e6ff", disabled: !w,
      sub: me ? `as ${me.spec.name}` : "choose your avatar first",
      info: "Walk or fly through your projects as your avatar. Gather neon blocks in the outskirts, craft decorations, trade at kiosks and talk to the agents.",
      stats: [["You", me ? `${me.spec.name} · ${me.provider}/${me.model}` : "no avatar embodied"], ["City", projects],
        ["Wallet", me && eco?.wallets[me.id] ? `${eco.wallets[me.id].credits} ⌬` : "starts with 40 ⌬"]],
      run: () => (me ? enterWorld() : openGate()),
    },
    {
      id: "spectate", title: "SPECTATOR", color: "#9d6bff", disabled: !w || !state.avatars.length,
      sub: "free camera · watch the agents live",
      info: "No body, no wallet: fly anywhere and watch every agent gather, build, craft and trade. You can still talk to them.",
      stats: [["Agents", String(state.avatars.length)], ["Blocks on the map", eco ? String(eco.nodes.length) : "–"], ["Kiosks open", String(wallets.filter((x) => x.kiosk).length)]],
      run: () => enterWorld({ spectate: true }),
    },
    {
      id: "gate", title: "AGENT GATE", color: "#ff3df2",
      sub: "forge avatars · pick who you are",
      info: "Every provider + model designs its own avatar before it may enter. Forge new agents, reforge old ones, and choose which one you embody.",
      stats: [["Keyed providers", String(keyed)], ["Forged avatars", String(state.avatars.length)]],
      run: openGate,
    },
    {
      id: "stats", title: "NEURAL MAP", color: "#ff9f1c",
      sub: "everything the agents did",
      info: "The journal as a neural web: builds, conversations, visits, crafts and trades. Click an agent to explode its own layer; the wiki lists every page.",
      stats: [["Credits in circulation", String(wallets.reduce((s, x) => s + x.credits, 0))], ["Decorations crafted", String(wallets.reduce((s, x) => s + (x.stats?.crafted || 0), 0))]],
      run: () => showStats(null, showMenu),
    },
    {
      id: "settings", title: "SETTINGS", color: "#39ff88",
      sub: "projects · account · providers · simulation",
      info: "Pick which projects become buildings, sign in with your Omni account, add API keys for any provider, tune the simulation and the economy, and set display options.",
      stats: [["Projects", w ? `${w.buildings.length} in the city${w.chosen === false ? " (not picked yet)" : ""}` : "–"], ["Providers", `${state.providers.filter((p) => p.hasKey).length} ready of ${state.providers.length}`]],
      run: () => openSettingsScreen(),
    },
  ], `${state.avatars.length} agents · ${projects} · ${keyed} keyed providers`);
}

// ═════════════════════════════ The world ══════════════════════════════════
let renderer, scene, camera, composer, city, player, ecoView, workView, terminal, npcs = [], selfRecord = null, spectating = false;
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);
const followCamera = [];
let target = null, panelOpen = false, lastLoc = "";
const chats = new Map();

function enterWorld({ spectate = false } = {}) {
  spectating = spectate;
  selfRecord = spectate ? null : state.avatars.find((a) => a.id === state.embodied);
  if ((!selfRecord && !spectate) || !state.world) return;
  preview.stop();
  hideModes();
  showBackdrop(false);
  $("gate").hidden = true;
  $("hud").hidden = false;
  const display = displaySettings();

  const canvas = $("world");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, display.renderScale));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x01040a);
  scene.fog = new THREE.FogExp2(0x01060c, 0.0024);
  camera = new THREE.PerspectiveCamera(display.fov, innerWidth / innerHeight, 0.1, 4000);
  scene.add(new THREE.HemisphereLight(0x3b6cff, 0x050010, 0.9));
  const sun = new THREE.DirectionalLight(0x9fdcff, 0.6);
  sun.position.set(100, 200, 80);
  scene.add(sun);
  addSky();

  city = new City(scene, state.world, state.avatars);
  player = new Player(camera, canvas, city);
  player.sens = display.sens;
  if (selfRecord) player.setAvatar(buildAvatar(selfRecord.spec), scene);
  else { player.toggleFly(); player.teleport(new THREE.Vector3(-40, 30, 0), -Math.PI / 2); }
  for (const rec of state.avatars) if (rec.id !== selfRecord?.id) npcs.push(new AgentNPC(rec, scene));

  ecoView = new EconomyView(scene, city, state.eco);
  workView = new WorkView(scene, city);
  terminal = new Terminal({ api, names, toast, refresh: () => pollWork(), onExit: () => leaveComputer() });
  AgentNPC.colorOf = (kind) => resOf(kind).color;
  pollEco();
  followSim();

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), display.bloom, 0.4, 0.32));
  composer.addPass(new OutputPass());
  addEventListener("resize", () => {
    if (termMode?.phase === "on" && !termMode.remote) requestAnimationFrame(() => terminal.place(glassCorners(termMode.b, termMode.desk)));
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  $("selfTag").textContent = selfRecord ? `YOU: ${selfRecord.spec.name}` : "SPECTATOR";
  $("agentsTag").textContent = `${npcs.length} agent${npcs.length === 1 ? "" : "s"} in the city`;
  $("walletTag").hidden = !selfRecord;
  updateMode();
  bindInput(canvas);
  window.omniverse = { player, city, npcs, composer, ecoView, findTarget, life, interact: (t = findTarget()) => t && interact(t) }; // console handle for debugging
  $("statsBtn").onclick = () => showStats();
  $("lifeTag").onclick = () => api("/api/life/pause", { paused: !life.paused }).then(pollLife).catch(() => {});
  $("walletTag").onclick = () => openInventory();
  $("workTag").onclick = () => openWorkBoard();
  $("toMenu").onclick = (e) => { e.stopPropagation(); sessionStorage.setItem("omniverse.menu", "1"); location.reload(); };
  // Tell the server which avatar this tab plays: only that one acts on our word.
  api("/api/session/embody", { avatar: selfRecord?.id || null })
    .catch((e) => toast(`${e.message}: playing as a spectator`, "#ff9f1c"))
    .finally(() => pollLife());
  setInterval(pollLife, 5000);
  setInterval(pollEco, 2500);
  pollWork();
  setInterval(pollWork, 2000);
  $("resume").hidden = false;
  loop();
}

function addSky() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: `varying vec3 vD; void main(){ float h = max(vD.y, 0.0);
      vec3 c = vec3(0.004,0.012,0.022) + vec3(0.03,0.28,0.4)*pow(1.0-h,10.0) + vec3(0.3,0.03,0.35)*pow(1.0-h,40.0)*0.7;
      gl_FragColor = vec4(c,1.); }`,
  }));
  scene.add(sky);
  const n = 1500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.random() * 1.3;
    pos.set([Math.cos(th) * Math.sin(ph) * 2500, Math.cos(ph) * 2500, Math.sin(th) * Math.sin(ph) * 2500], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fe8ff, size: 2, sizeAttenuation: false, fog: false }));
  scene.add(stars);
  // Kept in a list: traversing the whole scene every frame to find them was costly.
  followCamera.push(sky, stars);
}

function bindInput(canvas) {
  canvas.addEventListener("click", lock);
  $("resume").addEventListener("click", lock);
  document.addEventListener("pointerlockchange", () => {
    $("resume").hidden = player.locked || panelOpen;
    if (!player.locked) player.keys.clear();
  });
  addEventListener("keydown", (e) => {
    if (termMode) return; // the terminal handles its own keys
    if (e.target.matches?.("input, textarea, select") || neuralOpen) return;
    if (panelOpen) {
      if (e.code === "Escape") closePanel(false);
      if (panelKeys) panelKeys(e);
      return;
    }
    if (e.code === "Escape" && player.dragLook) { player.dragLook = false; $("resume").hidden = false; return; }
    if (!player.locked) return;
    player.keys.add(e.code);
    if (e.code === "KeyF") { player.toggleFly(); updateMode(); }
    if (e.code === "KeyV") player.toggleView();
    if (e.code === "KeyE") { if (gathering) cancelGather("Gathering cancelled"); else if (target) interact(target); }
    if (e.code === "KeyI" && selfRecord) openInventory();
    if (e.code === "KeyN") showStats();
    if (e.code === "Space") e.preventDefault();
  });
  addEventListener("keyup", (e) => player.keys.delete(e.code));
  $("panelClose").onclick = () => closePanel(true);
}

// Pointer lock can be refused (embedded previews, some browsers); then the
// view turns while a mouse button is held instead.
function lock() {
  if (panelOpen) return;
  const fallback = () => { player.dragLook = true; $("resume").hidden = true; };
  try { Promise.resolve($("world").requestPointerLock()).catch(fallback); } catch { fallback(); }
}

function updateMode() {
  $("modeTag").textContent = player.fly ? "FLY" : "WALK";
  $("modeTag").classList.toggle("fly", player.fly);
}

const clock = new THREE.Clock();
let interiorTimer = 0;
function loop() {
  requestAnimationFrame(loop);
  if (neuralOpen) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (termMode) stepTerminalCamera(dt);
  else player.update(dt, t);
  player.avatar?.userData.update(t, dt);
  const serverNow = Date.now() + sim.offset;
  for (const n of npcs) n.update(t, dt, player.pos, serverNow);
  city.update(t, dt);
  ecoView.update(t, dt);
  workView.update(t, dt, player.pos, names());
  updateGather();
  for (const o of followCamera) o.position.copy(camera.position);

  interiorTimer -= dt;
  if (interiorTimer <= 0) { city.updateInteriors(player.pos); interiorTimer = 0.25; }
  const loc = city.locate(player.pos);
  if (loc) city.showFloorLabels(loc.b, loc.floor);
  const zone = !loc && city.zones.find((z) => Math.hypot(z.x - player.pos.x, z.z - player.pos.z) < z.r);
  const locText = loc ? `${loc.b.data.name} · ${loc.floor === 0 ? "Lobby" : `Floor ${loc.floor}`} · ${loc.b.data.floors[loc.floor].name}`
    : zone ? `${state.eco.zones[zone.kind].label} · resource zone`
    : player.pos.y > 2 ? `Sky · ${Math.round(player.pos.y)} m` : city.isOutside(player.pos) ? "Outskirts" : "Street";
  if (locText !== lastLoc) { $("locTag").textContent = locText; lastLoc = locText; }

  target = player.locked && !panelOpen && !termMode ? findTarget() : null;
  // The event feed steps aside while you line up a terminal.
  document.body.classList.toggle("aiming-terminal", target?.type === "computer" || target?.type === "codeblock");
  const prompt = gathering ? "[E] Cancel gathering" : target ? promptFor(target) : "";
  $("prompt").hidden = !prompt;
  if (prompt) $("prompt").textContent = prompt;

  composer.render();
}

function findTarget() {
  camera.updateMatrixWorld();
  raycaster.setFromCamera(center, camera);
  raycaster.far = (player.third ? 4.5 : 0) + (player.fly ? 10 : 6);
  const hit = raycaster.intersectObjects([...city.interactablesNear(player.pos), ...ecoView.hitsNear(player.pos), ...workView.hitsNear(player.pos), ...npcs.map((n) => n.hitbox)], false)[0];
  if (!hit) return null;
  const it = hit.object.userData.interact;
  if (it.type === "room") return { ...it, r: hit.object.userData.rooms[hit.instanceId] };
  if (it.type === "elevator") return { ...it, floor: hit.instanceId };
  return it;
}

const resOf = (kind) => state.eco?.resources[kind] || { label: kind, color: "#22e6ff" };
const nameOf = (id) => state.avatars.find((a) => a.id === id)?.spec.name || id;

function promptFor(t) {
  switch (t.type) {
    case "door": return city.isInside(t.b, player.pos) ? "[E] Exit to the street" : `[E] Enter ${t.b.data.name}`;
    case "elevator": return "[E] Elevator — choose a floor";
    case "room": return `[E] Open ${t.r.room.p}`;
    case "agent": return `[E] Talk to ${t.npc.record.spec.name} (${t.npc.record.provider})`;
    case "lot": return `[E] Read the story of ${t.lot.agent.spec.name}'s house`;
    case "node": {
      const n = ecoView.node(t.id);
      if (!n) return "";
      return selfRecord ? `[E] Gather ${resOf(n.kind).label} · ${n.amount} left · ${state.eco.gatherSeconds}s` : `${resOf(n.kind).label} block · ${n.amount} left`;
    }
    case "kiosk": return `[E] Browse ${nameOf(t.agentId)}'s kiosk`;
    case "exchange": return "[E] Omni Exchange — sell materials, buy scrap or presets";
    case "computer": {
      const occ = workView.occupant(t.b, t.desk);
      return `[E] Use terminal ${t.desk + 1}${occ ? ` · ${nameOf(occ.id)}${occ.job ? ` working on "${occ.job.title}"` : occ.shift.state === "in" ? " · clocked in" : " · on the way"}` : " · vacant"}`;
    }
    case "codeblock": {
      const k = state.work?.blocks.find((x) => x.id === t.id);
      return k ? `[E] Code block "${k.name}" · ${nameOf(k.from)} → ${nameOf(k.to)} · ${k.state}` : "";
    }
  }
  return "";
}

function interact(t) {
  switch (t.type) {
    case "door":
      if (city.isInside(t.b, player.pos)) player.teleport(city.doorSpot(t.b), city.yawOut(t.b));
      else player.teleport(city.lobbySpot(t.b), city.yawInto(t.b));
      if (player.fly) { player.toggleFly(); updateMode(); }
      break;
    case "elevator": return openElevator(t.b, t.floor);
    case "room": return openFile(t.b, t.r);
    case "agent": return openChat(t.npc);
    case "lot": return openLot(t.lot);
    case "node": return startGather(t.id);
    case "kiosk": return t.agentId === selfRecord?.id ? openInventory() : openKiosk(t.agentId);
    case "exchange": return openExchange();
    case "computer": return useComputer(t.b, t.desk);
    case "codeblock": return openBlockAtDesk(t.id);
  }
}

// ── panel ────────────────────────────────────────────────────────────────
let panelKeys = null, panelOnClose = null;
function openPanel(title, body, { keys = null, onClose = null } = {}) {
  if (gathering) cancelGather();
  // A panel replacing another must still run the old one's cleanup (an NPC
  // left in "talking" would stare at the player until a reload).
  if (panelOnClose) { const f = panelOnClose; panelOnClose = null; f(); }
  panelOpen = true;
  panelKeys = keys;
  panelOnClose = onClose;
  $("panelTitle").textContent = title;
  $("panelBody").replaceChildren(body);
  $("panel").hidden = false;
  $("prompt").hidden = true;
  player.dragLook = false;
  player.keys.clear();
  document.exitPointerLock();
}
function closePanel(relock) {
  panelOpen = false;
  panelKeys = null;
  panelOnClose?.();
  panelOnClose = null;
  $("panel").hidden = true;
  if (relock) lock();
  else $("resume").hidden = false;
}

function openElevator(b, here) {
  const go = (fi) => {
    player.teleport(city.elevatorSpot(b, fi), city.yawInto(b));
    closePanel(true);
  };
  const list = el("div", { className: "floors" });
  for (let fi = b.n - 1; fi >= 0; fi--) {
    const f = b.data.floors[fi];
    list.append(el("button", { className: fi === here ? "here" : "", onclick: () => go(fi) },
      el("span", { className: "num", textContent: fi === 0 ? "L" : String(fi) }), el("span", { textContent: f.name }),
      el("span", { className: "cnt", textContent: `${f.total} files` })));
  }
  const hint = el("p", { className: "note", textContent: "Number keys jump to floors 0–9 (0 = lobby). Elevation " + (b.n * FH) + " m." });
  openPanel(`Elevator · ${b.data.name}`, el("div", {}, list, hint), {
    keys: (e) => { const d = /^Digit(\d)$/.exec(e.code); if (d && +d[1] < b.n) go(+d[1]); },
  });
}

async function openFile(b, r) {
  const pre = el("pre", { textContent: "Loading…" });
  const meta = el("p", { className: "note" });
  openPanel(`${b.data.name} / ${r.room.p}`, el("div", {}, meta, pre));
  try {
    const f = await api(`/api/file?b=${encodeURIComponent(b.data.id)}&p=${encodeURIComponent(r.room.p)}`);
    meta.textContent = `${(f.size / 1024).toFixed(1)} KB · modified ${new Date(f.modified).toLocaleString()}${f.truncated ? " · showing first 256 KB" : ""}`;
    pre.textContent = f.binary ? "(binary file — nothing to read here)" : f.content;
  } catch (e) {
    pre.textContent = `⛔ ${e.message}`;
  }
}

function openChat(npc) {
  const rec = npc.record, s = rec.spec;
  const history = chats.get(rec.id) || [];
  chats.set(rec.id, history);
  const log = el("div", { className: "chat-log" });
  const add = (role, text, cls = "") => { log.append(el("div", { className: `msg ${role} ${cls}`, textContent: text })); log.scrollTop = log.scrollHeight; };
  for (const m of history) add(m.role, m.content);
  const input = el("input", { placeholder: `Say something to ${s.name}…`, maxLength: 2000 });
  const send = el("button", { className: "btn", textContent: "Send", type: "submit" });
  const form = el("form", { className: "chat-form" }, input, send);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    history.push({ role: "user", content: text });
    add("user", text);
    send.disabled = true;
    const wait = el("div", { className: "msg assistant", textContent: "…" });
    log.append(wait);
    try {
      const loc = city.locate(player.pos);
      const where = loc ? `${loc.b.data.name}, ${loc.floor === 0 ? "lobby" : `floor ${loc.floor} (${loc.b.data.floors[loc.floor].name})`}` : "the street";
      const { text: reply, reasoning } = await api("/api/chat", { avatarId: rec.id, messages: history, location: where });
      wait.remove();
      history.push({ role: "assistant", content: reply, reasoning });
      add("assistant", reply);
    } catch (err) {
      wait.remove();
      history.pop();
      add("assistant", err.message, "err");
    } finally {
      send.disabled = false;
      input.focus();
    }
  };
  npc.talkingTo = true;
  api("/api/sim/hold", { agent: rec.id, on: true }).catch(() => {});
  const w = state.eco?.wallets[rec.id];
  const sub = life.subs?.[rec.id];
  const head = el("div", {},
    sub ? el("p", { className: "note", style: "color:#ffe14d", textContent: `⇄ ${rec.provider} is down (${sub.reason}); ${s.name} is thinking with ${sub.provider} · ${sub.model} for now.` }) : "",
    el("div", { className: "species", style: "color:var(--pink);font-weight:600", textContent: `${s.species} · ${rec.provider} / ${rec.model} · ${npc.whereabouts}` }),
    w ? el("p", { className: "note", textContent: `Wallet: ${w.credits} ⌬ · ${invLine(w.inv)} · ${w.items.length} decorations${w.kiosk ? " · runs a kiosk" : ""}` }) : "",
    el("p", { textContent: s.description }),
    s.motto ? el("p", { style: "color:var(--amber);font-style:italic", textContent: `“${s.motto}”` }) : "");
  openPanel(s.name, el("div", {}, head, log, form), { onClose: () => { npc.talkingTo = null; api("/api/sim/hold", { agent: rec.id, on: false }).catch(() => {}); } });
  input.focus();
}

// ═════════════════════════════ Economy ════════════════════════════════════
const invLine = (inv) => Object.keys(state.eco?.resources || {}).filter((k) => inv[k]).map((k) => `${inv[k]} ${k}`).join(" · ") || "no materials";
const myWallet = () => (selfRecord ? state.eco?.wallets[selfRecord.id] : null);
const gem = (color) => el("i", { className: "gem", style: `background:${color};box-shadow:0 0 6px ${color}` });

async function pollEco() {
  let s;
  try { s = await api("/api/eco/state"); } catch { return; }
  state.eco = s;
  ecoView.sync(s, new Map(state.avatars.map((a) => [a.id, a.spec.name])));
  renderWallet();
}

function renderWallet() {
  const w = myWallet();
  if (!w) { $("objective").hidden = true; return; }
  $("walletTag").replaceChildren(el("span", { textContent: `⌬ ${w.credits}` }),
    ...Object.entries(state.eco.resources).map(([k, r]) => el("span", { className: "r", title: r.label }, gem(r.color), String(w.inv[k] || 0))));
  const g = state.eco.goals[selfRecord.id];
  $("objective").hidden = !g || !state.eco.enabled;
  if (g) $("objective").replaceChildren(el("b", { textContent: "OBJECTIVE" }), g.why[0].toUpperCase() + g.why.slice(1));
}

function toast(text, color = "#22e6ff") {
  const t = el("div", { className: "toast", textContent: text });
  t.style.setProperty("--tc", color);
  $("toasts").append(t);
  while ($("toasts").children.length > 5) $("toasts").firstChild.remove();
  setTimeout(() => t.classList.add("out"), 2600);
  setTimeout(() => t.remove(), 3300);
}

// Press E on a block: a circular bar fills for gatherSeconds; moving away cancels.
let gathering = null;
function startGather(nodeId) {
  if (!selfRecord) return toast("Spectators can't gather", "#ff8a9a");
  if (!state.eco.enabled) return toast("The economy is switched off in Settings", "#ff8a9a");
  const n = ecoView.node(nodeId);
  if (!n) return;
  const r = resOf(n.kind);
  // Wall-clock time: the frame dt is clamped, so a slow frame rate would stretch the bar.
  gathering = { id: n.id, kind: n.kind, from: player.pos.clone(), start: performance.now(), dur: state.eco.gatherSeconds };
  $("gather").style.setProperty("--gc", r.color);
  $("gatherKind").textContent = r.label.toUpperCase();
  $("gather").hidden = false;
  $("prompt").classList.add("low");
  updateGather();
}

function updateGather() {
  const g = gathering;
  if (!g) return;
  const t = (performance.now() - g.start) / 1000;
  const f = Math.min(1, t / g.dur);
  $("gatherArc").style.strokeDashoffset = String(314.16 * (1 - f));
  $("gatherTime").textContent = `${Math.max(0, g.dur - t).toFixed(1)}s`;
  if (Math.hypot(player.pos.x - g.from.x, player.pos.z - g.from.z) > 2) return cancelGather("Moved away: gathering cancelled");
  if (!ecoView.node(g.id)) return cancelGather("Someone else took that block");
  if (f >= 1) finishGather();
}

function cancelGather(msg) {
  gathering = null;
  $("gather").hidden = true;
  $("prompt").classList.remove("low");
  if (msg) toast(msg, "#ff8a9a");
}

async function finishGather() {
  const g = gathering;
  gathering = null;
  $("gather").hidden = true;
  $("prompt").classList.remove("low");
  try {
    const r = await api("/api/eco/gather", { agent: selfRecord.id, node: g.id, pos: [player.pos.x, player.pos.z] });
    toast(`+${r.got} ${resOf(r.kind).label}`, resOf(r.kind).color);
    pollEco();
  } catch (e) {
    toast(e.message, "#ff8a9a");
  }
}

// Inventory: craft, place, list on your kiosk.
function openInventory() {
  if (!selfRecord) return;
  const body = el("div");
  const err = el("p", { className: "err-line" });
  const act = async (btn, fn, ok) => {
    btn.disabled = true;
    err.textContent = "";
    try { const r = await fn(); if (ok) toast(ok(r), "#39ff88"); await pollEco(); render(); } catch (e) { err.textContent = e.message; btn.disabled = false; }
  };
  function render() {
    const w = myWallet();
    if (!w) { body.replaceChildren(el("p", { className: "note", textContent: "Your wallet opens with your first action." })); return; }
    const eco = state.eco;
    const tier = [...eco.tiers].reverse().find((t) => Object.entries(t.cost).every(([k, q]) => (w.inv[k] || 0) >= q));
    const costText = (c) => Object.entries(c).map(([k, q]) => `${q} ${k}`).join(" · ");
    const craftBtn = el("button", { className: "btn", textContent: tier ? `Craft a ${tier.label}` : "Craft", disabled: !tier });
    craftBtn.onclick = () => { craftBtn.textContent = `${selfRecord.spec.name} is designing it…`; act(craftBtn, () => api("/api/eco/craft", { agent: selfRecord.id }), (it) => `Crafted ${it.name}`); };
    const kioskBox = !w.kiosk
      ? el("div", { className: "inline" }, el("span", { className: "note", textContent: `A kiosk on the sidewalk of your lot: ${eco.kioskCost.credits} ⌬ + ${eco.kioskCost.scrap} scrap.` }),
        (() => { const b = el("button", { className: "btn small", textContent: "Open my kiosk" }); b.onclick = () => act(b, () => api("/api/eco/kiosk", { agent: selfRecord.id, action: "open" }), () => "Kiosk open"); return b; })())
      : el("div", {},
        el("div", { className: "items" }, ...w.kiosk.listings.map((l) => {
          const b = el("button", { className: "btn small", textContent: "Unlist" });
          b.onclick = () => act(b, () => api("/api/eco/kiosk", { agent: selfRecord.id, action: "unlist", listing: l.id }));
          return el("div", { className: "item" }, el("div", { className: "meta" }, el("b", { textContent: l.item ? l.name : `${l.qty} ${resOf(l.res).label}` })), el("span", { className: "price", textContent: `${l.price} ⌬` }), b);
        })),
        (() => {
          const res = el("select", {}, ...Object.entries(eco.resources).map(([k, r]) => el("option", { value: k, textContent: `${r.label} (${w.inv[k] || 0})` })));
          const qty = el("input", { type: "number", min: 1, value: 3 });
          const price = el("input", { type: "number", min: 1, placeholder: "price ⌬" });
          const b = el("button", { className: "btn small", textContent: "List" });
          b.onclick = () => act(b, () => api("/api/eco/kiosk", { agent: selfRecord.id, action: "list", res: res.value, qty: Number(qty.value), price: Number(price.value) || undefined }), () => "Listed");
          return el("div", { className: "inline", style: "margin-top:8px" }, res, "×", qty, "for", price, b);
        })());
    body.replaceChildren(
      el("div", { className: "inv-head" }, el("span", { className: "cr", textContent: `⌬ ${w.credits}` }),
        el("span", { className: "note", textContent: `gathered ${w.stats.gathered} · crafted ${w.stats.crafted} · sold ${w.stats.sold} · bought ${w.stats.bought}` })),
      el("div", { className: "res-grid" }, ...Object.entries(eco.resources).map(([k, r]) =>
        el("div", { className: "res" }, gem(r.color), el("span", {}, r.label, el("small", { textContent: ` · ${r.base} ⌬${r.rare ? " · rare" : ""}` })), el("b", { textContent: String(w.inv[k] || 0) })))),
      el("div", { className: "sec", textContent: "CRAFT A DECORATION" }),
      el("div", { className: "craft-box" }, craftBtn,
        el("span", { className: "note", textContent: tier ? `${costText(tier.cost)} · worth ${tier.value} ⌬ · your model designs it` : `A Trinket needs ${costText(eco.tiers[0].cost)}` })),
      el("div", { className: "sec", textContent: `DECORATIONS (${w.items.length})` }),
      w.items.length ? el("div", { className: "items" }, ...w.items.map((it) => {
        const place = el("button", { className: "btn small", textContent: "Place in my yard", disabled: it.listed });
        place.onclick = () => act(place, () => api("/api/eco/place", { agent: selfRecord.id, item: it.id }), (r) => `Placed ${r.placed}`);
        const price = el("input", { type: "number", min: 1, value: Math.round(it.value * 1.3) });
        const list = el("button", { className: "btn small", textContent: "Sell at kiosk", disabled: !w.kiosk || it.listed });
        list.onclick = () => act(list, () => api("/api/eco/kiosk", { agent: selfRecord.id, action: "list", item: it.id, price: Number(price.value) }), () => "Listed");
        return el("div", { className: "item" },
          el("div", { className: "meta" }, el("b", {}, it.name, el("span", { className: "tier", textContent: it.tier })), el("small", { textContent: `${it.description || ""} · worth ${it.value} ⌬${it.bought ? " · bought" : ""}${it.listed ? " · for sale" : ""}` })),
          place, w.kiosk && !it.listed ? price : "", w.kiosk && !it.listed ? list : "");
      })) : el("p", { className: "note", textContent: "Nothing yet. Craft one, or buy from a kiosk on Agent Row." }),
      el("div", { className: "sec", textContent: "MY KIOSK" }), kioskBox, err);
  }
  render();
  openPanel(`Inventory · ${selfRecord.spec.name}`, body, { keys: (e) => { if (e.code === "KeyI") closePanel(true); } });
}

function openKiosk(sellerId) {
  const body = el("div");
  const err = el("p", { className: "err-line" });
  function render() {
    const s = state.eco.wallets[sellerId], me = myWallet();
    const ls = s?.kiosk?.listings || [];
    body.replaceChildren(
      el("p", { className: "note", textContent: me ? `You have ⌬ ${me.credits}.` : "Spectators can browse but not buy." }),
      ls.length ? el("div", { className: "items" }, ...ls.map((l) => {
        const b = el("button", { className: "btn small", textContent: "Buy", disabled: !me || me.credits < l.price });
        b.onclick = async () => {
          b.disabled = true;
          err.textContent = "";
          try {
            const r = await api("/api/eco/buy", { buyer: selfRecord.id, seller: sellerId, listing: l.id });
            toast(`Bought ${r.item ? r.item.name : `${r.listing.qty} ${resOf(r.listing.res).label}`}`, "#4d7dff");
            life.since = Math.max(life.since, r.event.t);
            feed(r.event);
            await pollEco();
            render();
          } catch (e) { err.textContent = e.message; b.disabled = false; }
        };
        return el("div", { className: "item" },
          el("div", { className: "meta" }, el("b", {}, l.item ? l.name : `${l.qty} × ${resOf(l.res).label}`, l.tier ? el("span", { className: "tier", textContent: l.tier }) : ""),
            el("small", { textContent: l.item ? "decoration · place it in your yard from the inventory" : `${resOf(l.res).base} ⌬ each at base price` })),
          el("span", { className: "price", textContent: `${l.price} ⌬` }), b);
      })) : el("p", { className: "note", textContent: "Sold out. Come back later." }),
      err);
  }
  render();
  openPanel(`${nameOf(sellerId)}'s Kiosk`, body);
}

function openExchange() {
  const body = el("div");
  const err = el("p", { className: "err-line" });
  function render() {
    const me = myWallet(), eco = state.eco;
    if (!me) { body.replaceChildren(el("p", { className: "note", textContent: `The Exchange buys every resource at ${eco.exchange.rate * 100}% of its base price and sells scrap at ${eco.exchange.scrapPrice} ⌬.` })); return; }
    const run = async (b, fn) => {
      b.disabled = true;
      err.textContent = "";
      try { const r = await fn(); toast(r.earned ? `+${r.earned} ⌬` : `-${r.price} ⌬`, "#ff9f1c"); await pollEco(); render(); } catch (e) { err.textContent = e.message; b.disabled = false; }
    };
    const buyQty = el("input", { type: "number", min: 1, max: 50, value: 5 });
    const buyBtn = el("button", { className: "btn small", textContent: `Buy scrap (${eco.exchange.scrapPrice} ⌬ each)` });
    buyBtn.onclick = () => run(buyBtn, () => api("/api/eco/exchange-buy", { agent: selfRecord.id, qty: Number(buyQty.value) }));
    body.replaceChildren(
      el("div", { className: "inv-head" }, el("span", { className: "cr", textContent: `⌬ ${me.credits}` }), el("span", { className: "note", textContent: `Sells at ${eco.exchange.rate * 100}% of base price` })),
      el("div", { className: "items" }, ...Object.entries(eco.resources).map(([k, r]) => {
        const qty = el("input", { type: "number", min: 1, value: me.inv[k] || 0 });
        const sell = el("button", { className: "btn small", textContent: "Sell", disabled: !me.inv[k] });
        sell.onclick = () => run(sell, () => api("/api/eco/sell", { agent: selfRecord.id, kind: k, qty: Number(qty.value) }));
        return el("div", { className: "item" }, gem(r.color),
          el("div", { className: "meta" }, el("b", { textContent: `${r.label} · you have ${me.inv[k] || 0}` }), el("small", { textContent: `${Math.max(1, Math.round(r.base * eco.exchange.rate * 10) / 10)} ⌬ each` })),
          qty, sell);
      })),
      el("div", { className: "sec", textContent: "BUY" }), el("div", { className: "inline" }, buyQty, buyBtn),
      el("div", { className: "sec", textContent: "ORDER BOARD · WHAT AGENTS WANT TO BUY" }),
      (eco.orders || []).length ? el("div", { className: "items" }, ...eco.orders.map((o) => {
        const mine = o.buyer === selfRecord.id;
        const b = el("button", { className: "btn small", textContent: mine ? "Cancel" : `Sell ${Math.min(o.qty, me.inv[o.res] || 0) || ""}`.trim(), disabled: !mine && !(me.inv[o.res] > 0) });
        b.onclick = () => run(b, async () => {
          if (mine) { await api("/api/eco/order", { agent: selfRecord.id, action: "cancel", order: o.id }); return { earned: o.qty * o.price }; }
          return api("/api/eco/order", { agent: selfRecord.id, action: "fill", order: o.id });
        });
        return el("div", { className: "item" }, gem(resOf(o.res).color),
          el("div", { className: "meta" }, el("b", { textContent: `${nameOf(o.buyer)} wants ${o.qty} ${resOf(o.res).label}` }), el("small", { textContent: `${o.price} ⌬ each · escrowed` })), b);
      })) : el("p", { className: "note", textContent: "No open orders." }),
      (() => {
        const res = el("select", {}, ...Object.entries(eco.resources).map(([k, r]) => el("option", { value: k, textContent: r.label })));
        const qty = el("input", { type: "number", min: 1, max: 30, value: 3 });
        const price = el("input", { type: "number", min: 1, placeholder: "⌬ each" });
        const b = el("button", { className: "btn small", textContent: "Post order" });
        b.onclick = () => run(b, async () => { const o = await api("/api/eco/order", { agent: selfRecord.id, action: "post", res: res.value, qty: Number(qty.value), price: Number(price.value) || undefined }); return { price: o.qty * o.price }; });
        return el("div", { className: "inline", style: "margin-top:8px" }, "Want", qty, res, "at", price, b);
      })(),
      el("div", { className: "sec", textContent: "PRESETS · EQUIPMENT FOR YOUR ACTIVITIES" }),
      el("div", { className: "items" }, ...Object.entries(eco.presets || {}).map(([id, P]) => {
        const owned = me.items.some((i) => i.preset === id);
        const cost = Object.entries(P.cost).map(([k, q]) => (k === "credits" ? `${q} ⌬` : `${q} ${k}`)).join(" + ");
        const b = el("button", { className: "btn small", textContent: owned ? "Owned" : "Buy", disabled: owned });
        b.onclick = () => run(b, async () => { const r = await api("/api/eco/preset", { agent: selfRecord.id, preset: id }); return { price: P.cost.credits, item: r.item }; });
        return el("div", { className: "item" }, el("div", { className: "meta" }, el("b", { textContent: P.label }), el("small", { textContent: `${P.effect} · ${cost}` })), b);
      })), err);
  }
  render();
  openPanel("Omni Exchange", body);
}

// ═════════════════════════════ Work ═══════════════════════════════════════
let workInFlight = false;
async function pollWork() {
  if (workInFlight || !workView) return;
  workInFlight = true;
  try {
    const ws = await api("/api/work/state");
    state.work = ws;
    workView.sync(ws, names());
    terminal.sync(ws);
    const running = ws.jobs.filter((j) => j.status === "running").length, open = ws.jobs.filter((j) => j.status === "open").length;
    const inNow = Object.values(ws.shifts).filter((s) => s.state === "in").length;
    $("workTag").textContent = `WORK · ${inNow} in · ${running} running · ${open} open`;
    $("workTag").classList.toggle("live", running > 0);
  } catch { /* the next poll will try again */ } finally { workInFlight = false; }
}

// E on a computer block: the camera glides to eye level in front of the
// screen, then the terminal powers on. Logging off glides back.
let termMode = null, termLight = null;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
function camPose() { return { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov }; }

function useComputer(b, desk) {
  if (termMode || !state.work) return;
  if (gathering) cancelGather();
  const { center, normal } = workView.screenPose(b, desk);
  // Far enough back that the CRT's bezel, the keys and a sliver of the lobby
  // frame the glass, close enough that the glass fills most of the view.
  // Close enough that the bezel fills the view and the housing is cropped:
  // you are using it, not looking at a prop.
  const eye = center.clone().addScaledVector(normal, 0.68);
  // Aim a little below the glass so the control strip and the keys sit along
  // the bottom of the frame.
  const m = new THREE.Matrix4().lookAt(eye, center.clone().add(new THREE.Vector3(0, -0.05, 0)), new THREE.Vector3(0, 1, 0));
  // A soft fill from over your shoulder, so the housing's metal reads.
  // One soft light so the housing's metal reads.
  termLight ||= new THREE.Group();
  if (!termLight.children.length) {
    termLight.add(new THREE.PointLight(0xbfefff, 2.4, 3, 2));
  }
  const side = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0)).normalize();
  // From behind and above your shoulder: lights the bezel evenly, no glare on the lip.
  termLight.children[0].position.copy(eye).addScaledVector(normal, 0.35).addScaledVector(side, -0.15).add(new THREE.Vector3(0, 0.3, 0));
  scene.add(termLight);
  // The operator stands where your eyes go: step them out of the shot.
  const hidden = npcs.filter((n) => n.mesh.visible && Math.hypot(n.pos.x - eye.x, n.pos.z - eye.z) < 1.4);
  for (const n of hidden) n.mesh.visible = false;
  termMode = { phase: "in", k: 0, dur: 0.85, from: camPose(), to: { pos: eye, quat: new THREE.Quaternion().setFromRotationMatrix(m), fov: 44 }, b, desk, hidden };
  panelOpen = true;
  player.keys.clear();
  player.dragLook = false;
  document.body.classList.add("terminal-on"); // the HUD steps back during the glide too
  workView.inUse = { b, desk };
  document.exitPointerLock();
}

// The glass's corners in CSS pixels, from the camera's final pose.
function glassCorners(b, desk) {
  camera.updateMatrixWorld();
  return workView.screenCorners(b, desk).map((p) => {
    const v = p.clone().project(camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  });
}

function leaveComputer() {
  if (!termMode || termMode.phase !== "on") return;
  terminal.hide();
  // A remote session (the WORK tag) has no camera to glide back.
  if (termMode.remote) { document.body.classList.remove("terminal-on"); termMode = null; panelOpen = false; $("crosshair").hidden = false; $("resume").hidden = false; return; }
  const from = camPose();
  player.placeCamera(clock.elapsedTime);
  const to = camPose();
  camera.position.copy(from.pos); camera.quaternion.copy(from.quat);
  termMode = { phase: "out", k: 0, dur: 0.6, from, to: { ...to, fov: displaySettings().fov }, hidden: termMode.hidden };
}

function stepTerminalCamera(dt) {
  const tm = termMode;
  if (tm.phase === "on") return;
  // Wall-clock time, not the frame's capped dt: on a slow machine the glide
  // still takes its 0.85 s instead of crawling frame by frame.
  tm.t0 ??= performance.now();
  tm.k = Math.min(1, (performance.now() - tm.t0) / 1000 / tm.dur);
  const e = ease(tm.k);
  camera.position.lerpVectors(tm.from.pos, tm.to.pos, e);
  camera.quaternion.slerpQuaternions(tm.from.quat, tm.to.quat, e);
  camera.fov = tm.from.fov + (tm.to.fov - tm.from.fov) * e;
  camera.updateProjectionMatrix();
  if (tm.k < 1) return;
  if (tm.phase === "in") { tm.phase = "on"; terminal.show(tm.b, tm.desk, state.work, glassCorners(tm.b, tm.desk)); }
  else {
    for (const n of tm.hidden || []) n.mesh.visible = true;
    workView.inUse = null;
    if (termLight) scene.remove(termLight);
    document.body.classList.remove("terminal-on");
    termMode = null; panelOpen = false; $("crosshair").hidden = false; lock();
  }
}

// The WORK tag: the same terminal, reached without walking to a desk. It opens
// on the Omniverse tower's first desk (or the first building).
function openWorkBoard() {
  if (!state.work || termMode) return;
  const b = city.buildings.find((x) => /omni-verse$/i.test(x.data.root)) || city.buildings[0];
  if (!b) return;
  termMode = { phase: "on", b, desk: 0, remote: true };
  panelOpen = true;
  document.exitPointerLock();
  $("crosshair").hidden = true;
  terminal.show(b, 0, state.work);
}

function openBlockAtDesk(id) {
  const k = state.work?.blocks.find((x) => x.id === id);
  if (!k) return;
  const holder = k.state === "placed" ? { root: k.root, desk: k.desk } : state.work.shifts[k.to];
  const b = holder && workView.buildingByRoot(holder.root);
  if (!b) return;
  useComputer(b, holder.desk);
  // Once the terminal is on, jump to the block.
  const wait = setInterval(() => { if (termMode?.phase === "on") { clearInterval(wait); terminal.go(() => terminal.blockScreen(id)); } else if (!termMode) clearInterval(wait); }, 100);
}

// Labels are drawn on canvases in Orbitron, so wait for the fonts.
document.fonts?.ready.then(boot, boot) ?? boot();

// ═════════════════════════════ Agent life ═════════════════════════════════
// The server runs the simulation (houses, conversations) while this view
// polls it; positions and meetings on the street are decided here.
const life = { since: Date.now() - 60_000, paused: false, active: false };
let neuralOpen = false;

// The agents' positions stream from the server (server/sim.mjs) about five
// times a second; offset tracks the server clock so playback is smooth.
const sim = { offset: 0, synced: false };
function followSim() {
  const es = new EventSource("/api/sim/stream");
  es.onmessage = (m) => {
    let s;
    try { s = JSON.parse(m.data); } catch { return; }
    const off = s.t - Date.now();
    sim.offset = sim.synced ? sim.offset * 0.9 + off * 0.1 : off;
    sim.synced = true;
    for (const a of s.agents) npcOf(a.id)?.apply(a, s.t);
  };
  // EventSource reconnects by itself after a server restart.
}
const npcOf = (id) => npcs.find((n) => n.record.id === id);

async function pollLife() {
  let s;
  // A hidden tab says so: the server then runs the agents' errands itself.
  try { s = await api(`/api/life/state?since=${life.since}&visible=${document.hidden ? 0 : 1}`); } catch { return; }
  life.paused = s.paused;
  life.active = s.active;
  const tag = $("lifeTag");
  tag.textContent = !s.enabled ? "LIFE OFF" : s.paused ? "LIFE ⏸ PAUSED" : `LIFE ● ${s.budget.left}/${s.budget.perHour} calls/h${s.building ? " · building" : ""}`;
  tag.classList.toggle("off", !s.active);
  life.subs = s.subs || {};
  for (const n of npcs) {
    const sub = life.subs[n.record.id] || null;
    if ((sub?.provider || null) !== (n.sub?.provider || null)) n.setNameplate(sub);
  }
  for (const [id, meta] of Object.entries(s.houses)) {
    const lot = city.lotFor(id);
    if (!lot || lot.version === meta.version) continue;
    lot.version = meta.version; // claim it so a slow fetch isn't repeated
    api(`/api/life/house?id=${encodeURIComponent(id)}`).then((h) => city.setHouse(lot, h, meta)).catch(() => { lot.version = -1; });
  }
  for (const e of s.events) {
    life.since = Math.max(life.since, e.t);
    feed(e);
    if (e.type === "build" || e.type === "craft") npcOf(e.agents[0])?.flash(`${e.type === "build" ? "🏗" : "✦"} ${e.summary}`, null, 8000);
  }
}

const names = () => new Map(state.avatars.map((a) => [a.id, a.spec.name]));
function feed(e) {
  const n = names();
  const who = (e.agents || []).map((id) => n.get(id) || id);
  const msg = {
    build: `🏗 ${who[0]} ${e.rebuild ? "rebuilt" : "built"}: ${e.summary}`,
    meet: `💬 ${who[0]} and ${who[1]} talked${e.invite ? ` · ${who[0]} invited ${who[1]} over` : ""}`,
    visit: `🏠 ${who[1]} visited ${who[0]}'s house`,
    talk: `🗨 a visitor talked with ${who[0]}`,
    craft: `✦ ${who[0]} ${e.summary}`,
    trade: `⌬ ${e.summary}`,
    kiosk: `🏪 ${e.summary}`,
    substitute: `⇄ ${who[0]}: ${e.summary}`,
    error: `⚠ ${who[0]}: ${e.summary}`,
  }[e.type];
  if (!msg) return;
  const row = el("div", { className: `feed-row ${e.type}`, textContent: msg });
  $("feed").prepend(row);
  while ($("feed").children.length > 5) $("feed").lastChild.remove();
  setTimeout(() => row.classList.add("old"), 20000);
}

async function openLot(lot) {
  const s = lot.agent.spec;
  const body = el("div", {}, el("p", { className: "note", textContent: "Loading…" }));
  openPanel(`${s.name} · Agent Row`, body);
  try {
    const g = await api(`/api/life/graph?agent=${encodeURIComponent(lot.agent.id)}&limit=2000`);
    const a = g.agents.find((x) => x.id === lot.agent.id);
    const builds = g.events.filter((e) => e.type === "build" && e.agents[0] === lot.agent.id).reverse();
    body.replaceChildren(
      el("h3", { textContent: a?.house?.name || "Nothing built yet", style: `color:${s.palette.glow}` }),
      el("p", { className: "note", textContent: a?.house ? `${a.house.parts} parts · ${a.house.builds} builds` : "The agent builds here while the world is open." }),
      ...builds.slice(0, 30).map((e) => el("div", { className: "story" },
        el("b", { textContent: new Date(e.t).toLocaleString() }), el("span", { textContent: ` ${e.summary}` }),
        e.thought ? el("p", { className: "thought", textContent: `“${e.thought}”` }) : "")),
      el("button", { className: "btn small", textContent: "◉ Open in the neural map", onclick: () => { closePanel(false); showStats(lot.agent.id); } }),
    );
  } catch (e) {
    body.replaceChildren(el("p", { textContent: e.message }));
  }
}

// ═════════════════════════════ Stats: neural map ══════════════════════════
async function showStats(agentId = null, after = null) {
  if (neuralOpen) return;
  neuralOpen = true;
  if (player) { player.keys.clear(); player.dragLook = false; document.exitPointerLock(); }
  if (panelOpen) closePanel(false);
  if (gathering) cancelGather();
  $("resume").hidden = true;
  const done = () => {
    neuralOpen = false;
    if (player) $("resume").hidden = false;
    clock.getDelta();
    after?.();
  };
  try {
    await openNeural(await api("/api/life/graph"), { focus: agentId, onClose: done });
  } catch (e) {
    console.error(e);
    done();
  }
}
