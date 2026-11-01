// An agent's inner life, as panels: its state of mind (every emotion, stress,
// energy, how its mood moved today and why), its diary, its hobby games and
// who it hired, and your messages to it. Also the inbox: every thread with
// every agent, and the notifications when a busy agent answers later.
// main.js passes in what it owns (api, the panel, toasts, the agent list).

const el = (tag, { dataset, ...props } = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(n.dataset, dataset);
  for (const k of kids) if (k !== null && k !== undefined && k !== false && k !== "") n.append(k);
  return n;
};
const ago = (t) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
};
const pct = (v) => `${Math.round(v * 100)} %`;

let D = null; // { api, openPanel, isOpen, toast, agents(), life(), onUnread(n) }
export function initInner(deps) { D = deps; }

const agentOf = (id) => D.agents().find((a) => a.id === id);
const TABS = [["mind", "🧠 Mind"], ["diary", "📖 Diary"], ["games", "🎮 Games"], ["message", "✉ Message"]];

// ── the agent panel ───────────────────────────────────────────────────────
export function openAgent(id, tab = "mind") {
  const rec = agentOf(id);
  if (!rec) return;
  const s = rec.spec;
  const body = el("div", { className: "inner" });
  const tabs = el("div", { className: "inner-tabs" });
  const pane = el("div", { className: "inner-pane" });
  let current = tab, alive = true;
  const show = (t) => {
    current = t;
    for (const b of tabs.children) b.classList.toggle("on", b.dataset.tab === t);
    pane.replaceChildren(el("p", { className: "note", textContent: "Loading…" }));
    ({ mind: mindPane, diary: diaryPane, games: gamesPane, message: messagePane })[t](rec, pane, () => alive && current === t);
  };
  for (const [k, label] of TABS) tabs.append(el("button", { className: "btn small", textContent: label, onclick: () => show(k), dataset: { tab: k } }));
  body.append(el("div", { className: "species", style: `color:${s.palette.glow};font-weight:600`, textContent: `${s.species} · ${rec.provider} / ${rec.model}` }), tabs, pane);
  D.openPanel(`${s.name} · inner life`, body, { onClose: () => { alive = false; } });
  show(current);
}

// State of mind: the headline, three meters, the day's curve, every emotion.
async function mindPane(rec, pane, live) {
  let m;
  try { m = await D.api(`/api/mind?id=${encodeURIComponent(rec.id)}`); } catch (e) { pane.replaceChildren(el("p", { className: "err-line", textContent: e.message })); return; }
  if (!live()) return;
  const meter = (label, v, color, hint) => el("div", { className: "meter" },
    el("span", { textContent: label }), el("i", {}, el("b", { style: `width:${Math.round(v * 100)}%;background:${color};box-shadow:0 0 8px ${color}` })), el("em", { textContent: hint }));
  const head = el("div", { className: "mood-head", style: `--mc:${m.color}` },
    el("div", { className: "mood-emoji", textContent: m.emoji }),
    el("div", {}, el("h3", { textContent: m.mood.toUpperCase() }), el("p", { textContent: `Feeling ${m.label}.` }),
      el("p", { className: "note", textContent: m.busy ? `Right now: ${m.busy}.` : "Right now: free to talk." })));
  const meters = el("div", { className: "meters" },
    meter("Stress", m.stress, "#ff5c7a", pct(m.stress)),
    meter("Energy", m.energy, "#22e6ff", pct(m.energy)),
    meter("Mood", (m.valence + 1) / 2, m.valence >= 0 ? "#39ff88" : "#ff9f1c", m.valence >= 0.25 ? "good" : m.valence <= -0.25 ? "low" : "mixed"),
    meter("Company", Math.max(0, 1 - m.lonelyMin / 240), "#ff7ac8", m.lonelyMin < 2 ? "just now" : `${m.lonelyMin} min alone`));
  const chart = el("canvas", { className: "mood-chart", width: 640, height: 120 });
  const causes = el("div", { className: "causes" }, el("h4", { textContent: "What moved it lately" }),
    ...(m.causes.length ? m.causes.slice(0, 8).map((c) => el("div", {}, el("b", { textContent: `${m.emotions[c.e]?.emoji || "•"} ${c.e}` }), ` · ${c.why} `, el("small", { className: "muted", textContent: ago(c.t) })))
      : [el("p", { className: "note", textContent: "Nothing yet: it feels the way it usually does." })]));
  // Every emotion, by family; the tick marks its usual level.
  const groups = {};
  for (const [e, info] of Object.entries(m.emotions)) (groups[info.group] ||= []).push(e);
  const grid = el("div", { className: "emo-grid" }, ...Object.entries(groups).map(([g, list]) => el("div", { className: "emo-group" },
    el("h4", { textContent: g }),
    ...list.sort((a, b) => m.levels[b] - m.levels[a]).map((e) => {
      const info = m.emotions[e], l = m.levels[e];
      return el("div", { className: `emo${l > 0.4 ? " strong" : ""}`, title: `${e}: ${pct(l)} (usually ${pct(m.base[e])})` },
        el("span", { textContent: `${info.emoji} ${e}` }),
        el("i", {}, el("b", { style: `width:${Math.round(l * 100)}%;background:${info.color}` }), el("u", { style: `left:${Math.round(m.base[e] * 100)}%` })));
    }))));
  pane.replaceChildren(head, meters, el("h4", { textContent: "Today" }), chart,
    el("p", { className: "note legend", innerHTML: '<b style="color:#39ff88">━ mood</b> · <b style="color:#ff5c7a">━ stress</b> · <b style="color:#22e6ff">━ energy</b>' }),
    causes, el("h4", { textContent: `All ${Object.keys(m.emotions).length} emotions` }), grid);
  drawChart(chart, m.history);
}

function drawChart(c, hist) {
  const g = c.getContext("2d"), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = "rgba(34,230,255,0.15)";
  for (let y = 0; y <= 4; y++) { g.beginPath(); g.moveTo(0, (H * y) / 4); g.lineTo(W, (H * y) / 4); g.stroke(); }
  if (hist.length < 2) {
    g.fillStyle = "#6f97a6"; g.font = "14px Rajdhani, sans-serif";
    g.fillText("The curve fills in as the day goes on (a point every 5 minutes while the city is open).", 10, H / 2);
    return;
  }
  const t0 = hist[0].t, t1 = hist.at(-1).t || t0 + 1;
  const line = (key, color, map) => {
    g.strokeStyle = color; g.lineWidth = 2; g.shadowColor = color; g.shadowBlur = 6;
    g.beginPath();
    hist.forEach((h, i) => { const x = ((h.t - t0) / Math.max(1, t1 - t0)) * (W - 4) + 2, y = H - 4 - map(h[key]) * (H - 8); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke(); g.shadowBlur = 0;
  };
  line("v", "#39ff88", (v) => (v + 1) / 2);
  line("s", "#ff5c7a", (v) => v);
  line("e", "#22e6ff", (v) => v);
}

async function diaryPane(rec, pane, live, before = 0, list = null) {
  let d;
  try { d = await D.api(`/api/diary?id=${encodeURIComponent(rec.id)}${before ? `&before=${before}` : ""}`); } catch (e) { pane.replaceChildren(el("p", { className: "err-line", textContent: e.message })); return; }
  if (!live()) return;
  if (!list) {
    list = el("div", { className: "diary" });
    pane.replaceChildren(list);
    if (!d.entries.length) {
      list.append(el("p", { className: "note", textContent: `${rec.spec.name} hasn't written anything yet. Agents write in their diary about once an hour of city life (Settings → Simulation).` }));
      return;
    }
  }
  list.querySelector(".more")?.remove();
  for (const e of d.entries) {
    list.append(el("article", { className: `page${e.blank ? " blank" : ""}` },
      el("header", {}, el("b", { textContent: e.title }), el("span", { textContent: `${e.emoji || ""} ${e.mood || ""} · ${new Date(e.t).toLocaleString()}` })),
      el("p", { textContent: e.text })));
  }
  if (d.more) list.append(el("button", { className: "btn small more", textContent: "Older pages ▾", onclick: () => diaryPane(rec, pane, live, d.entries.at(-1).t, list) }));
}

async function gamesPane(rec, pane, live) {
  let h;
  try { h = await D.api(`/api/hobby?agent=${encodeURIComponent(rec.id)}`); } catch (e) { pane.replaceChildren(el("p", { className: "err-line", textContent: e.message })); return; }
  if (!live()) return;
  const play = (g) => {
    const frame = el("iframe", { className: "game-frame", src: `/api/hobby/play?id=${encodeURIComponent(g.id)}&v=${g.version}`, title: g.title });
    frame.setAttribute("sandbox", "allow-scripts");
    pane.replaceChildren(el("div", { className: "row" }, el("button", { className: "btn small", textContent: "◀ Back to the games", onclick: () => gamesPane(rec, pane, live) }),
      el("b", { textContent: `  ${g.title} v${g.version}`, style: "align-self:center" })), el("p", { className: "note", textContent: `${g.description} Click the game to give it the keyboard.` }), frame);
    setTimeout(() => frame.focus(), 300);
  };
  const cards = h.games.length ? h.games.map((g) => el("div", { className: "game-card" },
    el("div", { className: "row" }, el("b", { textContent: g.title }), el("span", { className: "badge", textContent: `${g.genre} · v${g.version}` }),
      el("button", { className: "btn small", textContent: "▶ Play", onclick: () => play(g) })),
    el("p", { textContent: g.description }),
    el("p", { className: "note", textContent: `By ${g.ownerName}${g.teamNames.length > 1 ? ` with ${g.teamNames.filter((n) => n !== g.ownerName).join(", ")}` : ""} · updated ${ago(g.updatedAt)}` }),
    el("details", {}, el("summary", { textContent: "History" }), ...g.history.slice().reverse().map((x) => el("div", { className: "note", textContent: `${new Date(x.t).toLocaleString()} · ${x.name}: ${x.note}` })))))
    : [el("p", { className: "note", textContent: `${rec.spec.name} hasn't made a game yet. Off duty, agents make little browser games as a hobby (Settings → Simulation).` })];
  const hires = (h.hires || []).map((x) => {
    const pay = x.terms.kind === "credits" ? `${x.paid ?? x.terms.credits} ⌬` : x.terms.kind === "time" ? `${x.terms.minutes} min owed` : `a ${x.terms.minutes}-min favour called in`;
    return el("div", { className: "note" }, `${ago(x.t)} · ${x.bossName} → ${x.helperName} on ${x.title}: “${x.request}” · ${pay} · `, el("b", { textContent: x.status }), x.why ? ` (${x.why})` : "");
  });
  const debts = (h.debts || []).map((d) => el("div", { className: "note", textContent: `${d.fromName} owes ${d.toName} ${d.minutes} min of work (${d.reason})` }));
  pane.replaceChildren(...cards,
    el("h4", { textContent: "Hires & collaborations" }), ...(hires.length ? hires : [el("p", { className: "note", textContent: "No hires yet." })]),
    ...(debts.length ? [el("h4", { textContent: "Time owed" }), ...debts] : []));
}

// Your thread with this agent, through the inbox.
async function messagePane(rec, pane, live) {
  let box;
  try { box = await D.api("/api/inbox"); } catch (e) { pane.replaceChildren(el("p", { className: "err-line", textContent: e.message })); return; }
  if (!live()) return;
  if (!box.signedIn) {
    pane.replaceChildren(el("p", { className: "err-line", textContent: box.error }),
      el("p", { className: "note", textContent: "Your messages and the agents' answers are kept in your inbox under your Omni account, so you get them even after you leave the city." }));
    return;
  }
  const thread = box.threads.find((t) => t.agent === rec.id);
  pane.replaceChildren(threadView(rec, thread, live));
  if (thread?.unread) D.api("/api/inbox/read", { agent: rec.id }).then(() => refreshBadge()).catch(() => {});
}

function threadView(rec, thread, live) {
  const s = rec.spec, busy = D.life().busy?.[rec.id];
  const log = el("div", { className: "chat-log" });
  const add = (m) => {
    const cls = m.dir === "out" ? "user" : "assistant";
    log.append(el("div", { className: `msg ${cls}` }, m.text,
      el("small", { className: "stamp", textContent: `${new Date(m.t).toLocaleTimeString()}${m.dir === "out" && m.status === "queued" ? ` · waiting: ${s.name} is ${m.busy}` : m.status === "failed" ? " · could not be answered" : m.late ? " · answered later" : ""}` })));
    log.scrollTop = log.scrollHeight;
  };
  for (const m of thread?.messages || []) add(m);
  const status = el("p", { className: "note", textContent: busy ? `${s.name} is busy (${busy}). Your message will wait, and the answer will land in your inbox.` : `${s.name} is free and will answer now.` });
  const input = el("input", { placeholder: `Message ${s.name}…`, maxLength: 2000 });
  const send = el("button", { className: "btn", textContent: "Send", type: "submit" });
  const form = el("form", { className: "chat-form" }, input, send);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    send.disabled = true;
    const wait = el("div", { className: "msg assistant", textContent: "…" });
    try {
      add({ dir: "out", text, t: Date.now(), status: "sent" });
      log.append(wait);
      const r = await D.api("/api/inbox/send", { agent: rec.id, text });
      wait.remove();
      if (!live()) return;
      if (r.queued) {
        log.lastChild.querySelector(".stamp").textContent = `${new Date().toLocaleTimeString()} · waiting: ${s.name} is ${r.busy}`;
        status.textContent = `${s.name} is busy (${r.busy}). You'll get a notification when the answer comes, here or in the tray.`;
      } else add(r.reply);
    } catch (err) {
      wait.remove();
      log.append(el("div", { className: "msg assistant err", textContent: err.message }));
    } finally { send.disabled = false; input.focus(); }
  };
  setTimeout(() => input.focus(), 50);
  return el("div", {}, status, log, form);
}

// ── the inbox ─────────────────────────────────────────────────────────────
export async function openInbox(agentId = null) {
  const body = el("div", { className: "inbox" }, el("p", { className: "note", textContent: "Loading…" }));
  let alive = true;
  D.openPanel("📨 Inbox", body, { onClose: () => { alive = false; } });
  let box;
  try { box = await D.api("/api/inbox"); } catch (e) { body.replaceChildren(el("p", { className: "err-line", textContent: e.message })); return; }
  if (!box.signedIn) {
    body.replaceChildren(el("p", { className: "err-line", textContent: box.error }),
      el("p", { className: "note", textContent: "From the main menu: Settings → Account → Sign in with your Omni account. Then message any agent from here, from the agents list (G) or by walking up to it." }));
    return;
  }
  const side = el("div", { className: "inbox-side" });
  const main = el("div", { className: "inbox-main" });
  const open = (id) => {
    const rec = agentOf(id);
    if (!rec) return;
    for (const b of side.children) b.classList.toggle("on", b.dataset.agent === id);
    const t = box.threads.find((x) => x.agent === id);
    main.replaceChildren(el("div", { className: "row" }, el("b", { textContent: rec.spec.name, style: `color:${rec.spec.palette.glow};align-self:center` }),
      el("button", { className: "btn small", textContent: "🧠 Mind", onclick: () => openAgent(id, "mind") }),
      el("button", { className: "btn small", textContent: "📖 Diary", onclick: () => openAgent(id, "diary") })), threadView(rec, t, () => alive));
    if (t?.unread) { t.unread = 0; side.querySelector(`[data-agent="${id}"] .badge`)?.remove(); D.api("/api/inbox/read", { agent: id }).then(() => refreshBadge()).catch(() => {}); }
  };
  const ids = [...box.threads.map((t) => t.agent), ...D.agents().map((a) => a.id).filter((id) => !box.threads.some((t) => t.agent === id))];
  for (const id of ids) {
    const rec = agentOf(id), t = box.threads.find((x) => x.agent === id), mood = D.life().minds?.[id];
    if (!rec) continue;
    side.append(el("button", { className: "inbox-row", dataset: { agent: id }, onclick: () => open(id) },
      el("i", { style: `background:${rec.spec.palette.glow}` }),
      el("span", {}, el("b", { textContent: rec.spec.name }), el("small", { textContent: t ? t.messages.at(-1)?.text.slice(0, 60) || "" : "no messages yet" })),
      mood ? el("em", { textContent: mood.emoji, title: mood.label }) : "",
      t?.unread ? el("span", { className: "badge on", textContent: String(t.unread) }) : t?.queued ? el("span", { className: "badge", textContent: "⏳" }) : ""));
  }
  body.replaceChildren(el("p", { className: "note", textContent: `Signed in as ${box.account}. A free agent answers at once; a busy one answers when it's free.` }), el("div", { className: "inbox-cols" }, side, main));
  open(agentId && agentOf(agentId) ? agentId : ids[0]);
}

// New answers → a toast each, and the unread count on the HUD.
let unread = 0;
export async function pollInbox() {
  let r;
  try { r = await D.api("/api/inbox/fresh"); } catch { return; }
  for (const it of r.items) D.toast(`📨 ${it.name} answered${it.late ? " (was busy)" : ""}: ${it.text.slice(0, 120)}`, "#ff7ac8", 9000);
  setUnread(r.unread);
}
async function refreshBadge() {
  try { setUnread((await D.api("/api/inbox")).unread || 0); } catch { /* next poll */ }
}
function setUnread(n) { unread = n; D.onUnread(n); }
export const unreadCount = () => unread;

// ── the agents list ───────────────────────────────────────────────────────
export function openAgents() {
  const life = D.life();
  const rows = D.agents().map((rec) => {
    const m = life.minds?.[rec.id], busy = life.busy?.[rec.id];
    const bar = (v, c) => el("i", { className: "mini" }, el("b", { style: `width:${Math.round((v || 0) * 100)}%;background:${c}` }));
    return el("div", { className: "agent-row" },
      el("i", { className: "dot", style: `background:${rec.spec.palette.glow};box-shadow:0 0 8px ${rec.spec.palette.glow}` }),
      el("div", { className: "who" }, el("b", { textContent: rec.spec.name }), el("small", { textContent: `${rec.provider} · ${rec.model.split("/").pop()}` })),
      el("div", { className: "mood", title: m?.label || "" }, el("span", { textContent: m ? `${m.emoji} ${m.mood}` : "…" }),
        el("div", { className: "minis" }, el("small", { textContent: "stress" }), bar(m?.stress, "#ff5c7a"), el("small", { textContent: "energy" }), bar(m?.energy, "#22e6ff"))),
      el("div", { className: `state${busy ? " busy" : ""}`, textContent: busy ? `busy · ${busy}` : "free" }),
      el("div", { className: "acts" },
        el("button", { className: "btn small", textContent: "✉", title: "Message", onclick: () => openAgent(rec.id, "message") }),
        el("button", { className: "btn small", textContent: "🧠", title: "State of mind", onclick: () => openAgent(rec.id, "mind") }),
        el("button", { className: "btn small", textContent: "📖", title: "Diary", onclick: () => openAgent(rec.id, "diary") }),
        el("button", { className: "btn small", textContent: "🎮", title: "Games", onclick: () => openAgent(rec.id, "games") })));
  });
  D.openPanel(`Agents · ${rows.length}`, el("div", { className: "agents-list" }, ...rows));
}
