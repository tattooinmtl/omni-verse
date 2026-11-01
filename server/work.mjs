// Work: every project building is a workplace. You post jobs (code, websites,
// VPS or site management, anything); agents clock in at a computer block in
// the building's lobby before they do anything else each day, take a job and
// run it as a real headless Omni session in the project folder, with all of
// Omni's coding tools. When they have no job for `idleClockOutMin` they clock
// out and go back to their own life (houses, gathering, trading).
//
// Agents pass scripts to each other as code blocks; a code block runs only in
// the sandbox behind the recipient's own terminal (server/sandbox.mjs). They
// ask each other for help in the work chat, which can hire a second agent.
// State: data/work.json (jobs, shifts, blocks, chat).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT, HOME, expandHome } from "./config.mjs";
import { knownSecrets, loadRegistry, locateOmni } from "./providers.mjs";
import { listAvatars, text } from "./avatars.mjs";
import { lifeConfig, providerEnabled, workConfig } from "./settings.mjs";
import { redact } from "./security.mjs";
import { getWorld } from "./world.mjs";
import { runScript } from "./sandbox.mjs";
import * as eco from "./economy.mjs";

const FILE = path.join(APP_ROOT, "data", "work.json");
export const KINDS = ["code", "website", "vps", "site-ops", "review", "other"];
export const MODES = ["plan", "accept-edits", "auto"];
const LOG_MAX = 400, CHAT_MAX = 300, JOBS_KEPT = 200;

// ── persistence (atomic: tmp file then rename) ─────────────────────────────
let st = load();
let dirty = false;
function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { jobs: s.jobs || [], shifts: s.shifts || {}, blocks: s.blocks || [], chat: s.chat || [], seq: s.seq || 0 };
  } catch { return { jobs: [], shifts: {}, blocks: [], chat: [], seq: 0 }; }
}
export function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(st));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) { dirty = true; console.error("work: save failed:", e.message); }
}
const touch = () => { dirty = true; };
setInterval(flush, 2000).unref();
process.once("beforeExit", flush); // Ctrl+C and the tray's Exit go through shutdown() in server.mjs

let version = 1; // bumped on every change the client should redraw
const bump = () => { version++; touch(); };
const uid = (p) => `${p}${(++st.seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
// Windows paths compare case-insensitively and with either slash.
const sameRoot = (x, y) => path.resolve(String(x)).toLowerCase() === path.resolve(String(y)).toLowerCase();
const today = () => new Date().toLocaleDateString("en-CA");
const agents = () => listAvatars();
const agentById = (id) => agents().find((a) => a.id === id);
const nameOf = (id) => (id === "you" ? "You" : agentById(id)?.spec.name || id);

// ── chat ──────────────────────────────────────────────────────────────────
export function post(from, msg, extra = {}) {
  const m = { id: uid("m"), t: Date.now(), from, name: nameOf(from), text: text(msg, 600), ...extra };
  st.chat.push(m);
  if (st.chat.length > CHAT_MAX) st.chat.splice(0, st.chat.length - CHAT_MAX);
  bump();
  return m;
}

// ── shifts ────────────────────────────────────────────────────────────────
// state: off (not clocked in today), commute (walking to the desk),
// in (at the desk), out (clocked out for the day after going idle).
export function shift(id) {
  let s = st.shifts[id];
  if (!s || s.day !== today()) {
    s = st.shifts[id] = { state: "off", day: today(), root: null, desk: null, clockIn: 0, lastWorkAt: 0, jobs: 0 };
    touch();
  }
  return s;
}

const busyJob = (id) => st.jobs.find((j) => j.agent === id && (j.status === "assigned" || j.status === "running"));
export const currentJob = busyJob;
// Called with (agent id, ok, title) when a job ends; life.mjs turns it into feelings.
export const onJobEnd = new Set();
const openJobs = () => st.jobs.filter((j) => j.status === "open");

// Desks per building: the client builds the same number of computer blocks.
export const DESKS = 4;
// How many desks a building's lobby really has (narrow towers have fewer);
// the server's map (sim.mjs) tells us once it has laid the city out.
let desksIn = () => DESKS;
export const setDeskCount = (fn) => { desksIn = fn; };
function freeDesk(root, id) {
  const used = new Set(Object.entries(st.shifts).filter(([aid, s]) => aid !== id && s.root === root && (s.state === "in" || s.state === "commute")).map(([, s]) => s.desk));
  for (let d = 0; d < Math.min(DESKS, desksIn(root)); d++) if (!used.has(d)) return d;
  return null;
}

// Where an agent should report. A job decides it; otherwise the building
// with the most open jobs; otherwise the Omniverse's own tower.
async function workplace(id) {
  const job = busyJob(id);
  if (job) return job.root;
  const open = openJobs().filter((j) => !j.want || j.want === id);
  if (open.length) {
    const count = new Map();
    for (const j of open) count.set(j.root, (count.get(j.root) || 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1])[0][0];
  }
  const w = await getWorld();
  return (w.buildings.find((b) => b.root === APP_ROOT) || w.buildings[0])?.root || null;
}

// The goal the client follows before any economic goal: walk to the desk.
// `controlled` is the avatar a player is walking around in: it never works by itself.
export async function workGoals(controlled = null) {
  const c = workConfig(), out = {};
  if (!c.enabled) return out;
  for (const a of agents()) {
    if (a.id === controlled || !providerEnabled(a.provider)) continue;
    const s = shift(a.id), job = busyJob(a.id);
    const wantsBack = s.state === "out" && openJobs().some((j) => !j.want || j.want === a.id);
    if (s.state === "off" || wantsBack || (job && s.root !== job.root)) {
      let root = await workplace(a.id);
      if (!root) continue;
      let desk = freeDesk(root, a.id);
      // Every desk taken and no job tying it here: report to the next tower.
      if (desk === null && !job) {
        for (const bld of (await getWorld()).buildings) {
          const d = freeDesk(bld.root, a.id);
          if (d !== null) { root = bld.root; desk = d; break; }
        }
      }
      if (desk === null) continue;
      if (s.state !== "commute" || s.root !== root) { s.state = "commute"; s.root = root; s.desk = desk; bump(); }
    }
    if (s.state === "commute") out[a.id] = { kind: "work", root: s.root, desk: s.desk, why: job ? `heading to work on "${job.title}"` : "clocking in at work" };
    else if (s.state === "in") out[a.id] = { kind: "desk", root: s.root, desk: s.desk, why: job ? `working on "${job.title}"` : "at the desk, waiting for a job" };
  }
  return out;
}

export function clockIn(id, root) {
  const a = agentById(id);
  if (!a) throw err("unknown agent", 404);
  const s = shift(id);
  if (s.state === "in" && s.root === root) return { shift: s };
  if (s.root && root && !sameRoot(s.root, root)) throw err(`that agent works in ${path.basename(s.root)} today`, 409);
  s.state = "in";
  s.clockIn = s.clockIn || Date.now();
  s.lastWorkAt = Date.now();
  s.inSince = Date.now();
  post(id, `clocked in at ${path.basename(s.root)} (desk ${s.desk + 1})`, { kind: "clock" });
  bump();
  return { shift: s };
}

function clockOut(id, why) {
  const s = shift(id);
  s.state = "out";
  post(id, `clocked out: ${why}`, { kind: "clock" });
  bump();
}

// ── jobs ──────────────────────────────────────────────────────────────────
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";

export async function postJob(from, body = {}) {
  const c = workConfig();
  const title = text(body.title, 120);
  if (!title) throw err("a job needs a title");
  const brief = String(body.brief || "").slice(0, 8000);
  let root = null;
  if (body.newProject) {
    // A website or tool from scratch: a new folder that becomes a new tower.
    const base = expandHome(c.newProjectsDir);
    root = path.join(base, slug(body.newProject === true ? title : body.newProject));
    fs.mkdirSync(root, { recursive: true });
    // A README makes the folder a project, so it rises as a tower right away.
    const readme = path.join(root, "README.md");
    if (!fs.existsSync(readme)) fs.writeFileSync(readme, `# ${title}

${brief}
`);
    await getWorld(true);
  } else {
    const w = await getWorld();
    const b = w.buildings.find((x) => (body.root && sameRoot(x.root, body.root)) || x.id === body.building);
    if (!b) throw err("pick a building (project) for the job", 404);
    root = b.root;
  }
  const pay = Math.max(0, Math.min(5000, Math.round(Number(body.pay) || c.defaultPay)));
  if (from !== "you") {
    const w = eco.wallet(from);
    if (w.credits < pay) throw err(`not enough credits to pay ${pay} ⌬`, 402);
    w.credits -= pay; // escrow until the job is done
    eco.touchWallets();
  }
  const job = {
    id: uid("j"), title, brief, root, project: path.basename(root),
    kind: KINDS.includes(body.kind) ? body.kind : "code",
    mode: MODES.includes(body.mode) ? body.mode : "accept-edits",
    pay, from, want: body.want && agentById(body.want) ? body.want : null,
    parent: body.parent || null, status: "open", agent: null, createdAt: Date.now(), log: [],
  };
  st.jobs.push(job);
  trimJobs();
  post(from, `posted a job in ${job.project}: "${title}" · ${pay} ⌬${job.want ? ` · for ${nameOf(job.want)}` : ""}`, { kind: "job", job: job.id });
  bump();
  return publicJob(job);
}

function trimJobs() {
  const done = st.jobs.filter((j) => ["done", "failed", "cancelled"].includes(j.status));
  if (done.length > JOBS_KEPT) {
    const drop = new Set(done.slice(0, done.length - JOBS_KEPT).map((j) => j.id));
    st.jobs = st.jobs.filter((j) => !drop.has(j.id));
  }
}

export function cancelJob(id) {
  const j = st.jobs.find((x) => x.id === id);
  if (!j) throw err("no such job", 404);
  if (["done", "failed", "cancelled"].includes(j.status)) return publicJob(j);
  runners.get(j.id)?.kill();
  j.status = "cancelled";
  j.endedAt = Date.now();
  refund(j);
  log(j, "sys", "cancelled");
  bump();
  return publicJob(j);
}

function refund(j) {
  if (j.from !== "you" && j.pay && !j.refunded) {
    eco.wallet(j.from).credits += j.pay;
    j.refunded = true;
    eco.touchWallets();
  }
}

function log(j, kind, line) {
  j.log.push({ t: Date.now(), kind, text: redact(String(line), knownSecrets()).slice(0, 2000) });
  if (j.log.length > LOG_MAX) j.log.splice(0, j.log.length - LOG_MAX);
  version++;
}

// Hand open jobs to agents sitting at desks in the same building; an agent
// from another provider is preferred for help requests.
function assign() {
  for (const j of openJobs()) {
    const free = agents().filter((a) => {
      const s = shift(a.id);
      return s.state === "in" && s.root === j.root && !busyJob(a.id) && (!j.want || j.want === a.id) && a.id !== j.from;
    });
    if (!free.length) continue;
    const parent = j.parent && st.jobs.find((x) => x.id === j.parent);
    const parentProvider = parent ? agentById(parent.agent)?.provider : null;
    free.sort((x, y) => (x.provider === parentProvider) - (y.provider === parentProvider) || shift(x.id).jobs - shift(y.id).jobs);
    j.agent = free[0].id;
    j.status = "assigned";
    post(j.agent, `took the job "${j.title}"`, { kind: "job", job: j.id });
    bump();
  }
}

// ── running a job as a headless Omni session ──────────────────────────────
const runners = new Map(); // job id → child process

function omniSettings() {
  const o = locateOmni();
  if (!o) return null;
  try { return { ...o, json: JSON.parse(fs.readFileSync(o.settings, "utf8")) }; } catch { return null; }
}

// Omni addresses models by its own keys ("nvidia/glm-5.2"). Use the agent's
// exact model when Omni knows it, else another model of the same provider,
// else the substitute provider (Settings → Simulation).
export function omniModelFor(a) {
  const o = omniSettings();
  if (!o) return null;
  const models = Object.entries(o.json.models || {});
  const exact = models.find(([, m]) => m.provider === a.provider && m.id === a.model);
  if (exact) return { key: exact[0], note: null };
  const reg = loadRegistry().providers;
  const keyed = (p) => reg[p] && (reg[p].key || Object.values(reg[p].accounts || {}).some(Boolean));
  const same = keyed(a.provider) && models.find(([, m]) => m.provider === a.provider);
  if (same) return { key: same[0], note: `Omni has no ${a.model}; using ${same[0]}` };
  const fb = lifeConfig().fallback;
  const sub = fb && keyed(fb) && models.find(([, m]) => m.provider === fb);
  if (sub) return { key: sub[0], note: `${a.provider} has no Omni model; thinking with ${sub[0]}` };
  return null;
}

function jobPrompt(j, a) {
  const kids = st.jobs.filter((x) => x.parent === j.id);
  const others = agents().filter((x) => x.id !== a.id).map((x) => `${x.spec.name} (${x.provider})`).join(", ");
  return [
    `You are ${a.spec.name}, an agent from the Omniverse, clocked in at work. You were hired to do a real job in this project folder (${j.root}).`,
    `Job (${j.kind}): ${j.title}`,
    j.brief ? `Brief from ${nameOf(j.from)}:\n${j.brief}` : "",
    j.parent ? `This is a help request from a colleague on the job "${st.jobs.find((x) => x.id === j.parent)?.title || "?"}".` : "",
    kids.length ? `Colleagues who helped: ${kids.map((k) => `${nameOf(k.agent)}: ${(k.result || k.status).slice(0, 400)}`).join("\n")}` : "",
    "Do the work with your tools, verify it, and end with a short report of what you changed and how you checked it.",
    `Colleagues you can reach: ${others || "none"}.`,
    "Only if you are blocked and need a colleague, put one line in your final report: HELP: <what you need>. Someone from another provider will take it. If you don't need help, write no HELP line at all.",
    "To hand a script to a colleague, put it in your final report as a fenced block whose info string is: handoff to=\"<their name>\" name=\"<file>.mjs\". " +
      "It arrives as a code block they can only run in the sandbox behind their own terminal (Node, no network, no files outside its folder).",
  ].filter(Boolean).join("\n\n");
}

function summarizeTool(tc) {
  const name = tc.name || tc.function?.name || "tool";
  let args = tc.args ?? tc.arguments ?? tc.function?.arguments ?? "";
  if (typeof args !== "string") args = JSON.stringify(args);
  return `${name} ${args.replace(/\s+/g, " ").slice(0, 160)}`;
}

function onEvent(j, ev) {
  switch (ev.type) {
    case "init": log(j, "sys", `omni session ${ev.session || ""} · ${ev.model || ""} · mode ${ev.mode || j.mode}`); break;
    case "assistant":
      if (ev.text) log(j, "say", ev.text);
      for (const tc of ev.toolCalls || []) log(j, "tool", summarizeTool(tc));
      break;
    case "tool_result": log(j, "out", typeof ev.result === "string" ? ev.result.slice(0, 600) : JSON.stringify(ev.result ?? ev.content ?? "").slice(0, 600)); break;
    case "error": log(j, "err", ev.error || ev.message || "error"); break;
    case "result":
      j.final = ev;
      break;
    default: break;
  }
}

async function start(j) {
  const a = agentById(j.agent);
  const s = shift(j.agent);
  if (!a || s.state !== "in" || s.root !== j.root) return; // not at the desk yet
  const o = locateOmni();
  const model = omniModelFor(a);
  if (!o || !model) {
    j.status = "failed"; j.endedAt = Date.now();
    j.result = !o ? "Omni is not installed (~/.omni), so there is no coding harness to run." : `No Omni model is keyed for ${a.provider} or the substitute provider.`;
    log(j, "err", j.result); refund(j); bump();
    return;
  }
  const c = workConfig();
  j.status = "running"; j.startedAt = Date.now(); j.model = model.key;
  if (model.note) log(j, "sys", model.note);
  log(j, "sys", `${a.spec.name} sits down at desk ${s.desk + 1} and starts Omni in ${j.root}`);
  bump();
  const bin = path.join(o.install, "bin", "omni.mjs");
  const args = [bin, "-p", jobPrompt(j, a), "--output", "stream-json", "--model", model.key, "--mode", j.mode, "--max-turns", String(c.maxTurns)];
  const p = spawn(process.execPath, args, { cwd: j.root, env: { ...process.env, OMNI_NO_UPDATE_CHECK: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  runners.set(j.id, p);
  let buf = "", errTail = "";
  p.stdout.on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const lineText = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!lineText) continue;
      try { onEvent(j, JSON.parse(lineText)); } catch { log(j, "out", lineText.slice(0, 400)); }
    }
  });
  p.stderr.on("data", (d) => { errTail = (errTail + d.toString("utf8")).slice(-2000); });
  const timer = setTimeout(() => { log(j, "err", `stopped after ${c.jobTimeoutMin} min`); p.kill(); }, c.jobTimeoutMin * 60_000);
  p.on("close", (code) => {
    clearTimeout(timer);
    runners.delete(j.id);
    if (j.status === "cancelled") return;
    const fin = j.final || {};
    j.endedAt = Date.now();
    j.session = fin.session || null;
    j.turns = fin.turns; j.toolCalls = fin.toolCalls;
    j.result = redact(String(fin.result || fin.error || errTail.trim().split("\n").slice(-3).join(" ") || `omni exited with code ${code}`), knownSecrets()).slice(0, 6000);
    j.status = code === 0 && fin.ok !== false ? "done" : "failed";
    log(j, j.status === "done" ? "sys" : "err", `${j.status} · ${j.turns ?? "?"} turns · ${j.toolCalls ?? "?"} tool calls · exit ${code}`);
    finish(j, a);
  });
  p.on("error", (e) => { log(j, "err", `could not start omni: ${e.message}`); });
}

function finish(j, a) {
  getWorld(true).catch(() => {}); // the job may have added floors and rooms
  const s = shift(a.id);
  s.lastWorkAt = Date.now();
  if (j.status === "done") {
    s.jobs++;
    const bonus = eco.ownsPreset(a.id, "devkit") ? Math.round(j.pay * 0.15) : 0;
    eco.payWages(a.id, j.pay + bonus, j.title);
    post(a.id, `finished "${j.title}" and earned ${j.pay + bonus} ⌬`, { kind: "job", job: j.id });
    afterReport(j, a);
  } else {
    refund(j);
    post(a.id, `could not finish "${j.title}": ${String(j.result).slice(0, 160)}`, { kind: "job", job: j.id });
  }
  for (const f of onJobEnd) { try { f(a.id, j.status === "done", j.title); } catch (e) { console.error("work: job hook failed:", e.message); } }
  bump();
}

// HELP lines become help jobs; handoff fences become code blocks.
function afterReport(j, a) {
  const report = String(j.final?.result || "");
  const help = /^\s*\**HELP\**:\s*(.+)$/m.exec(report);
  // "HELP: none needed" is a model being polite, not a request.
  const declined = help && /^(none|no\b|n\/?a|nothing|not (needed|required)|-)/i.test(help[1].replace(/[*_`]/g, "").trim());
  if (help && !declined && !j.parent) {
    const pay = Math.round(j.pay * 0.25);
    postJob(a.id, { title: text(help[1], 120), brief: `Help ${a.spec.name} with "${j.title}". Their request: ${help[1]}\nTheir report so far:\n${report.slice(0, 3000)}`, root: j.root, kind: j.kind, mode: j.mode, pay: Math.min(pay, eco.wallet(a.id).credits), parent: j.id })
      .catch((e) => post(a.id, `wanted help but could not post it: ${e.message}`));
  }
  const fence = /```handoff([^\n]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(report))) {
    const to = /to="([^"]+)"/.exec(m[1])?.[1], name = /name="([^"]+)"/.exec(m[1])?.[1] || "script.mjs";
    const target = agents().find((x) => x.spec.name.toLowerCase() === String(to).toLowerCase() || x.id === to);
    if (target && target.id !== a.id) makeBlock(a.id, target.id, { name, code: m[2], note: `from the job "${j.title}"` });
  }
}

// ── code blocks ───────────────────────────────────────────────────────────
// A block sits on the sender's desk until the recipient (or you) picks it up.
// From "you" (written at a terminal) the block sits on that terminal's desk.
export function makeBlock(from, to, { name, code, note, root, desk } = {}) {
  if (!agentById(to)) throw err("unknown recipient", 404);
  const body = String(code || "");
  if (!body.trim()) throw err("the block is empty");
  if (body.length > 32 * 1024) throw err("a code block holds at most 32 KB");
  const at = from === "you" ? { root: root ? String(root) : null, desk: Math.max(0, Math.min(DESKS - 1, Number(desk) || 0)) } : shift(from);
  const b = {
    id: uid("k"), from, to, name: text(name, 60, "script.mjs"), note: text(note, 200), code: body,
    root: at.root, desk: at.desk, state: "placed", createdAt: Date.now(), runs: [],
  };
  st.blocks.push(b);
  if (st.blocks.length > 120) st.blocks.splice(0, st.blocks.length - 120);
  post(from, `placed a code block "${b.name}" for ${nameOf(to)}`, { kind: "block", block: b.id });
  bump();
  return b;
}

export function pickUp(blockId, by) {
  const b = st.blocks.find((x) => x.id === blockId);
  if (!b) throw err("no such block", 404);
  if (by !== b.to && by !== "you") throw err(`this block is addressed to ${nameOf(b.to)}`, 403);
  if (b.state === "placed") { b.state = "held"; b.heldAt = Date.now(); bump(); }
  return b;
}

// Runs only through the recipient's own terminal: they must be clocked in at
// their desk, and the script runs in their sandbox folder.
const running = new Set();
export async function runBlock(blockId, agentId) {
  const b = st.blocks.find((x) => x.id === blockId);
  if (!b) throw err("no such block", 404);
  if (agentId !== b.to) throw err(`only ${nameOf(b.to)} can run this block, at their own terminal`, 403);
  const s = shift(agentId);
  if (s.state !== "in") throw err(`${nameOf(agentId)} has to be clocked in at a desk to use a terminal`, 409);
  if (running.has(agentId)) throw err("that terminal is already running a script", 429);
  if (b.state === "placed") b.state = "held";
  running.add(agentId);
  try {
    const rack = eco.ownsPreset(agentId, "rack");
    const r = await runScript(agentId, b.name, b.code, rack ? { seconds: 30, memoryMb: 256 } : {});
    b.runs.push({ t: Date.now(), ...r });
    if (b.runs.length > 10) b.runs.shift();
    b.state = "ran";
    post(agentId, `ran "${b.name}" from ${nameOf(b.from)} in the sandbox: ${r.ok ? "ok" : "failed"} (${r.ms} ms)`, { kind: "block", block: b.id });
    bump();
    return r;
  } finally { running.delete(agentId); }
}

// ── the work tick ─────────────────────────────────────────────────────────
function tick() {
  const c = workConfig();
  if (!c.enabled) return;
  assign();
  const live = [...runners.keys()];
  for (const j of st.jobs.filter((x) => x.status === "assigned")) {
    if (live.length >= c.maxParallel) break;
    start(j).catch((e) => { j.status = "failed"; j.result = e.message; refund(j); bump(); });
    live.push(j.id);
  }
  // Idle at the desk too long: clock out and go live a little.
  for (const a of agents()) {
    const s = shift(a.id);
    if (s.state === "in" && !busyJob(a.id) && !openJobs().some((j) => j.root === s.root && (!j.want || j.want === a.id))
      && Date.now() - s.lastWorkAt > c.idleClockOutMin * 60_000) clockOut(a.id, `no work for ${c.idleClockOutMin} min, back to my own life`);
  }
  // A recipient at its desk picks up blocks addressed to it and runs them in
  // its own sandbox (one at a time per terminal).
  for (const b of st.blocks.filter((x) => x.state !== "ran" && !x.autoRan)) {
    const s = st.shifts[b.to];
    if (!s || s.day !== today() || s.state !== "in" || running.has(b.to)) continue;
    b.autoRan = true;
    runBlock(b.id, b.to).catch((e) => post(b.to, `could not run "${b.name}": ${e.message}`, { kind: "block" }));
  }
  // Jobs whose agent was deleted go back on the board.
  for (const j of st.jobs.filter((x) => (x.status === "assigned") && !agentById(x.agent))) { j.status = "open"; j.agent = null; bump(); }
}
setInterval(tick, 3000).unref();

// A server restart leaves running jobs orphaned: put them back on the board.
for (const j of st.jobs) if (j.status === "running" || j.status === "assigned") { j.status = "open"; j.agent = null; j.log.push({ t: Date.now(), kind: "sys", text: "the server restarted; back on the board" }); touch(); }

// ── views ─────────────────────────────────────────────────────────────────
// What a finished job did, read back from its log, so a terminal can show the
// gist without replaying hundreds of lines: files it changed, how much it
// read and ran, how long it took, and the first lines of its report.
const FINISHED = ["done", "failed", "cancelled"];
const CHANGES = { write_file: "wrote", create_file: "created", edit_file: "edited", multi_edit: "edited", apply_patch: "patched", delete_path: "deleted", move_path: "moved", rename_path: "moved" };
const READS = /^(read_file|read_media_file|list_dir|find_files|grep|search_files|project_inspect|glob)$/;
const RUNS = /^(run_shell|start_process|bash|shell|exec|run_command)$/;
function jobSummary(j) {
  const changed = new Map();
  let reads = 0, commands = 0, browser = 0, tools = 0;
  for (const l of j.log) {
    if (l.kind !== "tool") continue;
    tools++;
    const name = l.text.split(" ")[0];
    const m = /"(?:path|file_path|filePath|target)":"((?:[^"\\]|\\.)*)"/.exec(l.text);
    let file = null;
    if (m) { try { file = JSON.parse(`"${m[1]}"`); } catch { file = m[1]; } }
    if (CHANGES[name] && file) {
      const rel = path.isAbsolute(file) && j.root ? path.relative(j.root, file) || path.basename(file) : file;
      const key = rel.split(path.sep).join("/"), how = CHANGES[name], prev = changed.get(key);
      // "wrote, edited": every kind of change, in order, once each; a delete ends the story.
      changed.set(key, how === "deleted" || !prev ? how : prev.split(", ").includes(how) ? prev : `${prev}, ${how}`);
    } else if (READS.test(name)) reads++;
    else if (RUNS.test(name)) commands++;
    else if (name.startsWith("browser_")) browser++;
  }
  // The report's opening, minus markdown headings and emphasis, and minus a
  // bare "Report — <name>" title line.
  const lines = String(j.result || "").split(/\r?\n/).map((x) => x.replace(/^#+\s*|\*\*|__|`/g, "").trim()).filter(Boolean)
    .filter((x, i) => !(i === 0 && /^(report|summary|final report)\b/i.test(x) && x.length < 60));
  return {
    minutes: j.startedAt && j.endedAt ? Math.max(0.1, Math.round((j.endedAt - j.startedAt) / 6000) / 10) : null,
    turns: j.turns ?? null,
    toolCalls: j.toolCalls ?? tools,
    changed: [...changed].map(([file, how]) => ({ file, how })).slice(0, 40),
    reads, commands, browser,
    gist: lines.slice(0, 6),
  };
}

function publicJob(j, withLog = false) {
  const { log: l, final, ...rest } = j;
  return {
    ...rest,
    agentName: j.agent ? nameOf(j.agent) : null, fromName: nameOf(j.from),
    logLines: l.length,
    log: withLog ? l : l.slice(-3),
    ...(FINISHED.includes(j.status) ? { summary: jobSummary(j) } : {}),
  };
}

export function state(sinceVersion = 0) {
  return {
    version,
    changed: sinceVersion !== version,
    config: workConfig(),
    jobs: st.jobs.slice(-60).map((j) => publicJob(j)),
    shifts: st.shifts,
    blocks: st.blocks.map(({ code, runs, ...b }) => ({ ...b, size: code.length, runs: runs.length, lastRun: runs.at(-1) || null })),
    chat: st.chat.slice(-60),
  };
}

export function jobDetail(id) {
  const j = st.jobs.find((x) => x.id === id);
  if (!j) throw err("no such job", 404);
  return publicJob(j, true);
}
export function blockDetail(id) {
  const b = st.blocks.find((x) => x.id === id);
  if (!b) throw err("no such block", 404);
  return b;
}

// What an agent knows about its work, for its prompts and chats.
export function workContext(id) {
  const s = st.shifts[id], j = busyJob(id);
  if (!s || s.day !== today()) return " You haven't clocked in at work today.";
  return ` Work today: ${s.state === "in" ? `clocked in at ${path.basename(s.root || "")}` : s.state === "out" ? "clocked out" : "on the way to work"}, ${s.jobs} jobs done.` +
    (j ? ` Current job: "${j.title}".` : "");
}

export const homeDir = HOME;

// Free for its own life: clocked out after the day's shift (or work is off).
export function offDuty(id) {
  return !workConfig().enabled || shift(id).state === "out";
}
