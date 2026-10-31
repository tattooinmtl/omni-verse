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
const TABS = [["providers", "PROVIDERS"], ["life", "SIMULATION"], ["economy", "ECONOMY"], ["display", "DISPLAY"], ["controls", "CONTROLS"]];

export async function openSettings(api, { onClose }) {
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
  let tab = "providers", dirty = false;
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

  function providersPane() {
    const lead = el("p", { className: "lead" },
      reg.mode === "shared"
        ? el("span", {}, "Providers are read live from Omni (", el("code", { textContent: reg.omniSettings }), "). Keys and URLs never leave Omni: edit them there. Here you choose which providers take part in the simulation and which model each one uses.")
        : el("span", {}, "Omni was not found, so keys come from ", el("code", { textContent: reg.localEnv }), ". Choose which providers take part and their model."));
    const errs = (reg.errors || []).map((e) => el("p", { className: "err-line", textContent: e }));
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
        live);
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
    return [el("h3", { textContent: "Providers" }), lead, ...errs, el("div", { className: "pv-grid" }, ...cards)];
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
    $("stReset").disabled = tab === "providers" || tab === "controls";
    const pane = tab === "providers" ? providersPane()
      : tab === "life" ? [el("h3", { textContent: "Simulation" }), el("p", { className: "lead", textContent: "How the agents live. Changes apply to the running server as soon as you save." }), ...section("life", LIFE_FIELDS)]
      : tab === "economy" ? [el("h3", { textContent: "Economy" }), el("p", { className: "lead", textContent: "Resources, the spawn timer, crafting and trade (docs/ECONOMY.md)." }), ...section("economy", ECO_FIELDS)]
      : tab === "display" ? displayPane() : controlsPane();
    $("stPane").replaceChildren(...pane);
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
