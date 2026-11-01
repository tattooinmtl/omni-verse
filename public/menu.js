// The screens before the world: the animated backdrop, the loading splash,
// the mode select and Settings. Providers are read from Omni (never edited
// here); Settings saves which ones take part, their model, the simulation
// and economy tuning (server) and the display options (this browser).

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k !== null && k !== undefined && k !== false && k !== "") n.append(k);
  return n;
};

// ── backdrop: a neon skyline over a running grid ───────────────────────────
export function buildBackdrop() {
  const city = document.querySelector("#backdrop .bd-city");
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 44; i++) {
    const mid = 1 - Math.abs(i - 21.5) / 22;
    const b = el("i", { className: r() < 0.18 ? "p" : r() < 0.12 ? "a" : "" });
    b.style.width = `${1.1 + r() * 2.4}vw`;
    b.style.height = `${12 + mid * 60 + r() * 30}%`;
    city.append(b);
  }
}

export function showBackdrop(on, dim = false) {
  $("backdrop").hidden = !on;
  $("backdrop").classList.toggle("dim", dim);
}

// ── splash ─────────────────────────────────────────────────────────────────
// steps: [{ label, run: async () => detail }]. Failures are shown and skipped.
export async function runSplash(steps, { quick = false } = {}) {
  $("splash").hidden = false;
  const log = $("spLog");
  let done = 0;
  const progress = (label) => {
    const pct = Math.round((done / steps.length) * 100);
    $("spFill").style.width = `${pct}%`;
    $("spPct").textContent = `${pct}%`;
    $("spStep").textContent = label;
  };
  for (const s of steps) {
    progress(`${s.label}…`);
    const li = el("li", { textContent: s.label });
    log.append(li);
    try {
      const detail = await s.run();
      li.className = "ok";
      if (detail) li.textContent = `${s.label} · ${detail}`;
    } catch (e) {
      li.className = "bad";
      li.textContent = `${s.label} · ${e.message}`;
    }
    done++;
  }
  progress("Ready");
  if (quick) { $("splash").hidden = true; return; }
  $("spGo").hidden = false;
  await new Promise((resolve) => {
    const go = (e) => {
      if (e.type === "keydown" && ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      removeEventListener("keydown", go);
      $("splash").removeEventListener("pointerdown", go);
      resolve();
    };
    addEventListener("keydown", go);
    $("splash").addEventListener("pointerdown", go);
  });
  $("splash").hidden = true;
}

// ── mode select ────────────────────────────────────────────────────────────
// modes: [{ id, title, sub, color, info, stats: [[label, value]], disabled, run }]
let modeKeys = null;
export function showModes(modes, status) {
  $("modes").hidden = false;
  $("mdStatus").textContent = status;
  const list = $("modeList");
  let on = Math.max(0, modes.findIndex((m) => !m.disabled));
  const buttons = modes.map((m, i) => {
    const b = el("button", { className: "mode", disabled: Boolean(m.disabled), onclick: () => pick(i), onmouseenter: () => focus(i) },
      el("span", { className: "num", textContent: String(i + 1).padStart(2, "0") }),
      el("span", {}, el("span", { className: "ttl", textContent: m.title }), el("span", { className: "sub", textContent: m.sub })),
      el("span", { className: "go", textContent: "▶" }));
    b.style.setProperty("--c", m.color);
    return b;
  });
  list.replaceChildren(...buttons);
  function focus(i) {
    if (modes[i].disabled) return;
    on = i;
    buttons.forEach((b, j) => b.classList.toggle("on", j === i));
    const m = modes[i];
    const info = $("modeInfo");
    info.style.setProperty("--c", m.color);
    info.replaceChildren(el("h3", { textContent: m.title }), el("p", { textContent: m.info }),
      el("dl", {}, ...(m.stats || []).flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v })])));
  }
  function pick(i) {
    if (modes[i].disabled) return;
    hideModes();
    modes[i].run();
  }
  if (modeKeys) removeEventListener("keydown", modeKeys);
  modeKeys = (e) => {
    if ($("modes").hidden || !$("neural").hidden || e.target.matches?.("input, textarea, select")) return;
    const step = (d) => { let i = on; do i = (i + d + modes.length) % modes.length; while (modes[i].disabled && i !== on); focus(i); };
    if (e.key === "ArrowDown" || e.code === "KeyS") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowUp" || e.code === "KeyW") { e.preventDefault(); step(-1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(on); }
    else if (/^[1-9]$/.test(e.key) && +e.key <= modes.length) pick(+e.key - 1);
  };
  addEventListener("keydown", modeKeys);
  focus(on);
}
export function hideModes() { $("modes").hidden = true; }

// ── display options (this browser only) ────────────────────────────────────
const DISPLAY = {
  bloom: { label: "Bloom", hint: "how much the neon glows", d: 0.55, min: 0, max: 1.5, step: 0.05 },
  renderScale: { label: "Render scale", hint: "max pixel ratio; lower is faster", d: 1.5, min: 0.5, max: 2, step: 0.25 },
  sens: { label: "Mouse sensitivity", hint: "", d: 1, min: 0.3, max: 3, step: 0.1 },
  fov: { label: "Field of view", hint: "degrees", d: 72, min: 55, max: 100, step: 1 },
};
export function displaySettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("omniverse.display") || "{}"); } catch { /* defaults */ }
  return Object.fromEntries(Object.entries(DISPLAY).map(([k, f]) => [k, Number.isFinite(saved[k]) ? saved[k] : f.d]));
}
function saveDisplay(d) { try { localStorage.setItem("omniverse.display", JSON.stringify(d)); } catch { /* private mode */ } }

// ── settings ───────────────────────────────────────────────────────────────
const LIFE_FIELDS = {
  enabled: ["Agent life", "agents build, meet and visit while a world view is open"],
  callsPerHour: ["LLM calls per hour", "budget shared by every agent and your chats with them, retries included"],
  buildEveryMin: ["Minutes between builds", "per agent, when it has the scrap"],
  meetCooldownMin: ["Talk cooldown (min)", "before the same two agents talk again"],
  partsPerBuild: ["Parts per build", "upper limit for one build step"],
  maxHouseParts: ["Parts per house", "memory guard for the browser"],
  fallback: ["Substitute provider", "when an agent's own provider fails, it thinks with this one (same key)"],
  maxSubstitutes: ["Max substituted agents", "at once; calls to the substitute run this + 1 in parallel"],
  retryOriginalMin: ["Retry own provider (min)", "how often a substituted agent tries its own provider again"],
  journalKeep: ["Live journal events", "older events move to journal-archive.jsonl; relationships keep counting them"],
  recordVisitorChat: ["Remember your chats", "keep what you say to agents in the journal (keys and passwords are always scrubbed)"],
  diaries: ["Diaries", "agents write about their days; read them from an agent's panel"],
  diaryEveryMin: ["Minutes between diary entries", "per agent; each entry is one LLM call"],
  hobbies: ["Hobby games", "off duty, agents make browser games and hire each other to improve them"],
  hobbyEveryMin: ["Minutes between hobby sessions", "per agent, sooner when playful or bored; a game is one long LLM reply"],
};
const ECO_FIELDS = {
  enabled: ["Economy", "resources, crafting, kiosks and credits"],
  spawnEverySec: ["Spawn timer (s)", "a new neon block appears this often"],
  maxNodes: ["Blocks on the map", "maximum at once"],
  nodeLifeMin: ["Block lifetime (min)", "rare blocks vanish sooner"],
  streetShare: ["Share on the street", "the rest spawns outside the city blocks", "%"],
  zoneShare: ["Share in resource zones", "the remainder goes to the outskirts belt", "%"],
  gatherSeconds: ["Gather time (s)", "the circular bar after pressing E"],
  startingCredits: ["Starting credits", "for agents who join the economy"],
  minBuildScrap: ["Scrap needed to build", "below this an agent must go gathering"],
  craftEveryMin: ["Minutes between crafts", "per agent; each craft is one LLM call"],
};
const TABS = [["projects", "PROJECTS"], ["account", "ACCOUNT"], ["providers", "PROVIDERS"], ["life", "SIMULATION"], ["economy", "ECONOMY"], ["display", "DISPLAY"], ["controls", "CONTROLS"]];

// "3 days ago", for when a project last changed.
function ago(ms) {
  if (!ms) return "";
  const s = (Date.now() - ms) / 1000;
  for (const [n, u] of [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]]) {
    if (s >= n) { const k = Math.floor(s / n); return `${k} ${u}${k > 1 ? "s" : ""} ago`; }
  }
  return "just now";
}

// tab: which tab opens first; firstRun: the welcome for a new install.
export async function openSettings(api, { onClose, tab: firstTab = "providers", firstRun = false }) {
  $("settings").hidden = false;
  $("stPane").replaceChildren(el("p", { className: "lead", textContent: "Loading…" }));
  let s, reg;
  try {
    [s, reg] = await Promise.all([api("/api/settings"), api("/api/providers")]);
  } catch (e) {
    $("stPane").replaceChildren(el("p", { className: "lead", textContent: `Could not load settings: ${e.message}` }));
    $("stBack").onclick = () => { $("settings").hidden = true; onClose(); };
    return;
  }
  const draft = { life: { ...s.life }, economy: { ...s.economy }, providers: JSON.parse(JSON.stringify(s.providers || {})), display: displaySettings() };
  let tab = firstTab, dirty = false;
  const mark = () => { dirty = true; $("stSaved").textContent = "● unsaved changes"; $("stSaved").style.color = "var(--amber)"; };

  const tabs = TABS.map(([id, label]) => el("button", { textContent: label, onclick: () => { tab = id; render(); } }));
  $("stTabs").replaceChildren(...tabs);

  function numberField(key, [label, hint, unit], value, lim, onChange) {
    const pct = unit === "%";
    const [, lo, hi] = lim;
    const step = pct ? 0.01 : hi - lo <= 20 && !Number.isInteger(value) ? 0.1 : 1;
    const range = el("input", { type: "range", min: lo, max: hi, step, value });
    const box = el("input", { type: "number", min: pct ? lo * 100 : lo, max: pct ? hi * 100 : hi, step: pct ? 1 : step, value: pct ? Math.round(value * 100) : value });
    const set = (v) => { const n = Math.min(hi, Math.max(lo, v)); range.value = n; box.value = pct ? Math.round(n * 100) : n; onChange(n); mark(); };
    range.oninput = () => set(Number(range.value));
    box.onchange = () => set(pct ? Number(box.value) / 100 : Number(box.value));
    return el("div", { className: "field" }, el("label", { textContent: label }, el("small", { textContent: hint })), range, box);
  }
  function toggleField([label, hint], value, onChange) {
    const state = el("span", { textContent: value ? "on" : "off" });
    const input = el("input", { type: "checkbox", checked: value, onchange: () => { onChange(input.checked); state.textContent = input.checked ? "on" : "off"; mark(); } });
    return el("div", { className: "field" }, el("label", { textContent: label }, el("small", { textContent: hint })), el("label", { className: "switch" }, input, state));
  }
  function providerField([label, hint], value, onChange) {
    const keyed = reg.providers.filter((p) => p.hasKey);
    const select = el("select", { onchange: () => { onChange(select.value); mark(); } },
      el("option", { value: "", textContent: "(off: a failing agent just waits)", selected: !value }),
      ...keyed.map((p) => el("option", { value: p.name, textContent: `${p.label} (${p.name})`, selected: p.name === value })));
    return el("div", { className: "field" }, el("label", { textContent: label }, el("small", { textContent: hint })), select);
  }
  function section(key, fields) {
    return Object.entries(fields).map(([k, meta]) => {
      const set = (v) => { draft[key][k] = v; };
      const v = draft[key][k];
      if (typeof v === "boolean") return toggleField(meta, v, set);
      if (typeof v === "string") return providerField(meta, v, set);
      return numberField(k, meta, v, s.limits[key][k], set);
    });
  }

  // Endpoint checks survive re-renders (a saved key re-renders the pane).
  const checks = new Map();
  async function checkAll(btn) {
    btn.disabled = true;
    btn.textContent = "Checking every endpoint…";
    try {
      for (const r of (await api("/api/providers/check")).results) checks.set(r.name, r);
    } catch (e) { btn.textContent = `✕ ${e.message}`; return; }
    finally { btn.disabled = false; }
    render();
  }
  const checkLine = (r) => !r ? null
    : !r.up ? ["✕ endpoint not answering", "#ff8a9a"]
    : r.auth === "ok" ? [`✓ key works${r.models ? ` · ${r.models} models` : ""} · ${r.ms} ms`, "var(--green)"]
    : r.auth === "open" ? [`✓ up, no key needed${r.models ? ` · ${r.models} models` : ""} · ${r.ms} ms`, "var(--green)"]
    : r.auth === "rejected" ? [`✕ key rejected (${r.status}): replace it`, "#ff8a9a"]
    : r.auth === "missing" ? [`● up · add a key to use it · ${r.ms} ms`, "var(--amber)"]
    : [`● up, answered ${r.status} · ${r.ms} ms`, "var(--amber)"];

  async function saveKey(p, input, note) {
    note.textContent = "Saving…";
    try {
      await api("/api/providers/key", { provider: p.name, key: input.value });
      reg = await api("/api/providers");
      checks.delete(p.name);
      render();
    } catch (e) { note.textContent = `✕ ${e.message}`; note.style.color = "#ff8a9a"; }
  }

  function providersPane() {
    const lead = el("p", { className: "lead" },
      reg.mode === "shared"
        ? el("span", {}, "Providers are read live from Omni (", el("code", { textContent: reg.omniSettings }), "); keys set there stay there. Every other known provider is listed too: paste an API key on its card and it's saved to ", el("code", { textContent: reg.localEnv }), ", this app only. Choose which providers take part in the simulation and the model each one uses.")
        : el("span", {}, "Every known provider is listed. Paste an API key on a card and it's saved to ", el("code", { textContent: reg.localEnv }), " (never shown again). Choose which providers take part and their model."));
    const errs = (reg.errors || []).map((e) => el("p", { className: "err-line", textContent: e }));
    const checkBtn = el("button", { className: "btn small", textContent: checks.size ? "Check all endpoints again" : "Check all endpoints", onclick: () => checkAll(checkBtn) });
    const cards = reg.providers.map((p) => {
      const pref = (draft.providers[p.name] ||= {});
      const on = pref.enabled !== false;
      const select = el("select", {});
      const fill = (models, pickId) => select.replaceChildren(...models.map((m) => el("option", { value: m, textContent: m, selected: m === pickId })));
      fill(p.models, pref.model || p.defaultModel);
      const live = el("span", { className: "live", textContent: "Omni's model list" });
      select.onchange = () => { pref.model = select.value; mark(); };
      const sw = el("input", { type: "checkbox", checked: on, disabled: !p.hasKey });
      const card = el("div", { className: `pv${on && p.hasKey ? "" : " off"}` },
        el("div", { className: "pv-top" },
          el("span", { className: `dot${p.local ? " local" : p.hasKey ? " ok" : ""}` }),
          el("b", { textContent: p.label }),
          el("span", { className: "badge", textContent: p.name }),
          el("label", { className: "switch", title: "Take part in the simulation" }, sw, "in sim")),
        el("div", { className: "url", textContent: p.baseUrl || "(no URL)", title: p.baseUrl }),
        el("div", { className: "accts" },
          el("span", { className: "badge", textContent: p.local ? "local · keyless" : p.hasKey ? `key: ${p.source}` : "no key" }),
          ...p.accounts.map((a) => el("span", { className: `badge${a.active ? " on" : ""}`, textContent: `${a.name}${a.hasKey ? "" : " (empty)"}${a.active ? " · active" : ""}` }))),
        el("div", { className: "row" }, select, el("button", { className: "btn small", textContent: "Test", disabled: !p.hasKey, onclick: () => test() })),
        keyRow(),
        live);
      const c = checkLine(checks.get(p.name));
      if (c) { live.textContent = c[0]; live.style.color = c[1]; }
      // Keys from Omni are managed there; any other provider takes a key here.
      function keyRow() {
        if (p.local) return el("div", { className: "keyrow" }, el("span", { className: "muted", textContent: "Runs on this PC: start it, then Test." }), p.keyUrl && el("a", { href: p.keyUrl, target: "_blank", rel: "noopener", textContent: "Get it ↗" }));
        if (p.hasKey && p.source !== "omni-verse .env") return el("div", { className: "keyrow" }, el("span", { className: "muted", textContent: `Key managed in Omni (${p.source}).` }));
        const input = el("input", { type: "password", autocomplete: "off", spellcheck: false, placeholder: p.hasKey ? "key saved · paste to replace" : "paste API key" });
        const note = el("span", { className: "muted" });
        input.onkeydown = (e) => { if (e.key === "Enter") saveKey(p, input, note); };
        return el("div", { className: "keyrow" }, input,
          el("button", { className: "btn small", textContent: "Save key", onclick: () => saveKey(p, input, note) }),
          p.hasKey && el("button", { className: "btn small", textContent: "Remove", onclick: () => { input.value = ""; saveKey(p, input, note); } }),
          p.keyUrl && el("a", { href: p.keyUrl, target: "_blank", rel: "noopener", textContent: "Get a key ↗" }), note);
      }
      sw.onchange = () => { pref.enabled = sw.checked; card.classList.toggle("off", !sw.checked); mark(); };
      async function test() {
        live.textContent = "Asking the provider for its models…";
        try {
          const m = await api(`/api/models?provider=${encodeURIComponent(p.name)}`);
          const keep = m.models.includes(select.value) ? select.value : m.defaultModel;
          fill(m.models, keep);
          live.textContent = m.live ? `✓ reachable · live list of ${m.models.length} models` : "✕ no live list (offline, or no /models): Omni's list is shown";
          live.style.color = m.live ? "var(--green)" : "#ff8a9a";
        } catch (e) { live.textContent = `✕ ${e.message}`; live.style.color = "#ff8a9a"; }
      }
      return card;
    });
    const n = reg.providers.length, keyed = reg.providers.filter((p) => p.hasKey).length;
    return [el("h3", { textContent: "Providers" }), lead, ...errs,
      el("div", { className: "pv-bar" }, el("span", { className: "muted", textContent: `${n} providers · ${keyed} ready` }), checkBtn),
      el("div", { className: "pv-grid" }, ...cards)];
  }

  // ── Projects: which projects stand in the city ─────────────────────────
  // Each picked project is one skyscraper: a floor per top-level folder, a
  // room per file, computers in the lobby where agents work on it.
  const proj = { list: null, picked: new Set(), scanDirs: [], filter: "", note: "", saving: false };
  async function loadProjects() {
    try {
      const r = await api("/api/projects");
      proj.max = r.max;
      proj.chosen = r.chosen;
      proj.list = [...r.projects, ...r.extra];
      proj.picked = new Set(proj.list.filter((p) => p.selected).map((p) => p.root));
      proj.scanDirs = [...(s.world?.scanDirs || [])];
    } catch (e) { proj.list = []; proj.note = `✕ ${e.message}`; }
    if (tab === "projects") render();
  }
  async function addFolder(input) {
    proj.note = "Looking in that folder…";
    render();
    try {
      const r = await api("/api/projects/folder", { path: input.value });
      for (const p of r.projects) {
        if (!proj.list.some((x) => x.root.toLowerCase() === p.root.toLowerCase())) proj.list.unshift(p);
        proj.picked.add(p.root);
      }
      // A folder of projects is remembered, so the picker keeps showing what's in it.
      if (r.projects.length > 1 || r.projects[0]?.root !== r.folder) proj.scanDirs.push(r.folder);
      proj.note = `✓ added ${r.projects.length} project${r.projects.length > 1 ? "s" : ""}`;
    } catch (e) { proj.note = `✕ ${e.message}`; }
    render();
  }
  async function buildCity() {
    proj.saving = true;
    proj.note = `Building the city from ${proj.picked.size} projects… (big projects take a few seconds each)`;
    render();
    try {
      const r = await api("/api/projects", { projects: [...proj.picked], scanDirs: proj.scanDirs });
      proj.chosen = true;
      proj.note = `✓ City rebuilt: ${r.buildings} buildings in ${r.districts} districts.`;
    } catch (e) { proj.note = `✕ ${e.message}`; }
    proj.saving = false;
    render();
  }
  function projectsPane() {
    const head = [el("h3", { textContent: firstRun && !proj.chosen ? "Welcome: build your city" : "Projects" }),
      el("p", { className: "lead", textContent: (firstRun && !proj.chosen ? "Pick the projects that become your city. " : "Pick which projects stand in your city. ") +
        "Each one becomes a skyscraper: a floor for every top-level folder, a room with a glowing terminal for each file, and computers in the lobby where agents clock in to work on it. Secret files (.env, keys, passwords) never become rooms." })];
    if (!proj.list) { loadProjects(); return [...head, el("p", { className: "lead", textContent: "Looking for projects on this computer…" })]; }
    const max = proj.max || 300;
    const set = (roots, on) => { for (const r of roots) on ? proj.picked.add(r) : proj.picked.delete(r); render(); };
    const search = el("input", { type: "search", placeholder: `Search ${proj.list.length} projects…`, value: proj.filter, oninput: () => { proj.filter = search.value; renderList(); } });
    const folder = el("input", { type: "text", placeholder: "Add a folder: C:\\work\\my-app or ~/projects", spellcheck: false });
    folder.onkeydown = (e) => { if (e.key === "Enter" && folder.value.trim()) addFolder(folder); };
    const count = el("span", { className: "pj-count" });
    const listBox = el("div", { className: "pj-list" });
    const go = el("button", { className: "btn primary", onclick: buildCity });
    function renderList() {
      const q2 = proj.filter.toLowerCase();
      const rows = proj.list.filter((p) => !q2 || p.name.toLowerCase().includes(q2) || p.root.toLowerCase().includes(q2) || p.district.toLowerCase().includes(q2));
      const groups = new Map();
      for (const p of rows) { if (!groups.has(p.district)) groups.set(p.district, []); groups.get(p.district).push(p); }
      listBox.replaceChildren(...(rows.length ? [...groups].map(([d, list]) => el("div", { className: "pj-group" },
        el("div", { className: "pj-ghead" }, el("b", { textContent: d }), el("span", { className: "muted", textContent: `${list.filter((p) => proj.picked.has(p.root)).length}/${list.length}` }),
          el("button", { className: "btn small", textContent: "All", onclick: () => set(list.map((p) => p.root), true) }),
          el("button", { className: "btn small", textContent: "None", onclick: () => set(list.map((p) => p.root), false) })),
        ...list.map((p) => {
          const cb = el("input", { type: "checkbox", checked: proj.picked.has(p.root) });
          cb.onchange = () => { cb.checked ? proj.picked.add(p.root) : proj.picked.delete(p.root); update(); };
          return el("label", { className: "pj-row" }, cb,
            el("span", { className: "pj-name", textContent: p.name }),
            el("span", { className: "badge", textContent: p.kind }),
            el("span", { className: "muted pj-when", textContent: ago(p.last) }),
            el("span", { className: "pj-path", textContent: p.root, title: p.root }));
        })))
        : [el("p", { className: "lead", textContent: "No project matches that search." })]));
      update();
    }
    function update() {
      const n = proj.picked.size, over = n > max;
      count.textContent = `${n} picked${over ? ` · the limit is ${max}` : ""}`;
      count.style.color = over ? "#ff8a9a" : "";
      go.disabled = proj.saving || !n || over;
      go.textContent = proj.saving ? "Building…" : `Build the city with ${n} project${n === 1 ? "" : "s"}`;
    }
    const recent = [...proj.list].sort((a, b) => b.last - a.last);
    renderList();
    return [...head,
      el("div", { className: "pj-bar" }, search,
        el("button", { className: "btn small", textContent: "Most recent 20", onclick: () => { proj.picked = new Set(recent.slice(0, 20).map((p) => p.root)); render(); } }),
        el("button", { className: "btn small", textContent: `All ${Math.min(proj.list.length, max)}`, onclick: () => { proj.picked = new Set(recent.slice(0, max).map((p) => p.root)); render(); } }),
        el("button", { className: "btn small", textContent: "None", onclick: () => { proj.picked.clear(); render(); } }),
        count),
      el("div", { className: "pj-bar" }, folder, el("button", { className: "btn small", textContent: "Add folder", onclick: () => folder.value.trim() && addFolder(folder) })),
      listBox,
      el("div", { className: "pj-foot" }, go, proj.note && el("span", { className: "pj-note", textContent: proj.note, style: proj.note.startsWith("✕") ? "color:#ff8a9a" : proj.note.startsWith("✓") ? "color:var(--green)" : "" }))];
  }

  // ── Omni account: the device-code sign-in, as in OmniOne ────────────────
  let account = null, accountTimer = null;
  async function loadAccount(route = "/api/cloud", body) {
    try { account = await api(route, body); } catch (e) { account = { ...(account || {}), error: e.message }; }
    clearTimeout(accountTimer);
    // While a code waits for approval, look again every 2 s.
    if (account?.pending && tab === "account" && !$("settings").hidden) accountTimer = setTimeout(() => loadAccount(), 2000);
    if (tab === "account") render();
  }
  function accountPane() {
    const head = [el("h3", { textContent: "Omni account" }),
      el("p", { className: "lead", textContent: "Sign in with the account you use for OmniOne and the other Omni products. Your password is only ever typed on the website; this app gets a token it keeps on this PC." })];
    if (!account) { loadAccount(); return [...head, el("p", { className: "lead", textContent: "Checking…" })]; }
    const site = el("a", { href: account.site, target: "_blank", rel: "noopener", textContent: (account.site || "").replace(/^https?:\/\//, "") });
    const err = account.error ? el("p", { className: "err-line", textContent: account.error }) : null;
    if (account.connected) {
      const u = account.user || {};
      return [...head, err, el("div", { className: "acct-card" },
        u.avatar ? el("img", { src: u.avatar, alt: "", width: 56, height: 56 }) : el("span", { className: "acct-initial", textContent: (u.name || u.email || "?").slice(0, 1).toUpperCase() }),
        el("div", {},
          el("b", { textContent: u.name || "Signed in" }),
          el("span", { className: "muted", textContent: `${u.email || ""}${u.tier ? ` · ${u.tier}` : ""}` }),
          el("span", { className: "muted", textContent: `Connected ${account.connectedAt ? new Date(account.connectedAt).toLocaleString() : ""} · `, }, site))),
        el("div", { className: "row" },
          el("button", { className: "btn small", textContent: "Refresh profile", onclick: () => loadAccount("/api/cloud/refresh", {}) }),
          el("button", { className: "btn small", textContent: "Sign out", onclick: () => loadAccount("/api/cloud/logout", {}) }))];
    }
    if (account.pending) {
      const p = account.pending;
      return [...head, err,
        el("p", { className: "lead", textContent: "Approve this code on the website. It opened in your browser; if not, use the button." }),
        el("div", { className: "acct-code", textContent: p.userCode }),
        el("div", { className: "row" },
          el("button", { className: "btn", textContent: "Open the sign-in page", onclick: () => window.open(p.verifyUrl, "_blank", "noopener") }),
          el("button", { className: "btn small", textContent: "Cancel", onclick: () => loadAccount("/api/cloud/cancel", {}) })),
        el("p", { className: "lead", textContent: `Waiting for approval… the code works for ${Math.max(0, Math.round((p.expiresAt - Date.now()) / 60000))} more min.` })];
    }
    return [...head, err,
      el("div", { className: "row" }, el("button", { className: "btn primary", textContent: "Sign in with your Omni account", onclick: async () => {
        // Open the tab now, inside the click, or the browser blocks it as a
        // pop-up; point it at the approval page once the code arrives.
        const w = window.open("", "_blank");
        if (w) w.opener = null;
        await loadAccount("/api/cloud/connect", {});
        if (account?.pending && w) w.location.href = account.pending.verifyUrl;
        else w?.close();
      } })),
      el("p", { className: "lead" }, "No account yet? Create one on ", el("a", { href: "https://omnione.globalwarningnetworks.com/register.php", target: "_blank", rel: "noopener", textContent: "omnione.globalwarningnetworks.com" }), ": it works on every Omni site, including ", site, ".")];
  }

  function displayPane() {
    return [el("h3", { textContent: "Display" }), el("p", { className: "lead", textContent: "Saved in this browser; applied the next time you enter the city." }),
      ...Object.entries(DISPLAY).map(([k, f]) => numberField(k, [f.label, f.hint], draft.display[k], [f.d, f.min, f.max], (v) => { draft.display[k] = v; }))];
  }

  function controlsPane() {
    const rows = [["WASD", "move"], ["Mouse", "look"], ["F", "fly"], ["Space / C", "jump · up / down"], ["Shift", "run · boost"],
      ["E", "interact · gather a neon block (2.3 s ring) · browse a kiosk · the Exchange"], ["I", "inventory: craft, place, sell, run your kiosk"],
      ["V", "third person"], ["N", "neural map"], ["Esc", "release the cursor · close a panel"]];
    return [el("h3", { textContent: "Controls" }), el("div", {}, ...rows.map(([k, v]) => el("div", { className: "field" }, el("label", { textContent: k }), el("span", { textContent: v }))))];
  }

  function render() {
    tabs.forEach((b, i) => b.classList.toggle("on", TABS[i][0] === tab));
    $("stReset").disabled = tab === "providers" || tab === "controls" || tab === "account" || tab === "projects";
    const pane = tab === "projects" ? projectsPane()
      : tab === "account" ? accountPane()
      : tab === "providers" ? providersPane()
      : tab === "life" ? [el("h3", { textContent: "Simulation" }), el("p", { className: "lead", textContent: "How the agents live. Changes apply to the running server as soon as you save." }), ...section("life", LIFE_FIELDS)]
      : tab === "economy" ? [el("h3", { textContent: "Economy" }), el("p", { className: "lead", textContent: "Resources, the spawn timer, crafting and trade (docs/ECONOMY.md)." }), ...section("economy", ECO_FIELDS)]
      : tab === "display" ? displayPane() : controlsPane();
    $("stPane").replaceChildren(...pane.filter(Boolean));
  }

  $("stReset").onclick = () => {
    if (tab === "life" || tab === "economy") draft[tab] = { ...s.defaults[tab] };
    else if (tab === "display") draft.display = Object.fromEntries(Object.entries(DISPLAY).map(([k, f]) => [k, f.d]));
    mark();
    render();
  };
  $("stSave").onclick = async () => {
    $("stSave").disabled = true;
    try {
      s = { ...s, ...(await api("/api/settings", { life: draft.life, economy: draft.economy, providers: draft.providers })) };
      saveDisplay(draft.display);
      dirty = false;
      $("stSaved").textContent = "✓ saved";
      $("stSaved").style.color = "var(--green)";
    } catch (e) {
      $("stSaved").textContent = `✕ ${e.message}`;
      $("stSaved").style.color = "#ff8a9a";
    } finally {
      $("stSave").disabled = false;
    }
  };
  $("stBack").onclick = () => {
    if (dirty && $("stBack").dataset.confirm !== "1") {
      $("stBack").dataset.confirm = "1";
      $("stBack").textContent = "◀ Discard changes?";
      return;
    }
    delete $("stBack").dataset.confirm;
    $("stBack").textContent = "◀ Back";
    $("stSaved").textContent = "";
    $("settings").hidden = true;
    onClose();
  };
  $("stSaved").textContent = "";
  render();
}
