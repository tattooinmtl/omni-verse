// Omniverse local server: static client + JSON API. Binds to 127.0.0.1 only;
// provider keys stay in this process and never reach the browser.
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { APP_ROOT, localEnv } from "./config.mjs";
import { checkProviders, knownSecrets, liveModels, publicRegistry, saveLocalKey } from "./providers.mjs";
import { deleteAvatar, forgeAvatar, listAvatars, personaPrompt } from "./avatars.mjs";
import { MAX_PROJECTS, buildingRoot, findProjects, getWorld, inspectFolder } from "./world.mjs";
import { budgetLeft, callAgent, chatReply, controlledId, craftItem, graph, house, isPaused, lifeContext, placeItem, record, setPaused, state as lifeState } from "./life.mjs";
import * as work from "./work.mjs";
import * as sim from "./sim.mjs";
import { isSecretPath, redact, scrubSecrets } from "./security.mjs";
import { getSettings, lifeConfig, saveProjects, saveSettings } from "./settings.mjs";
import * as eco from "./economy.mjs";
import * as cloud from "./cloud.mjs";

const PORT = Number(process.env.OMNIVERSE_PORT || localEnv().OMNIVERSE_PORT || 4777);
const PUBLIC = path.join(APP_ROOT, "public");
const MAX_FILE = 256 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return body && typeof body === "object" ? body : {};
  } catch {
    throw Object.assign(new Error("the request body is not JSON"), { status: 400 });
  }
}

// Guards against other sites (and DNS rebinding) spending provider keys.
function trusted(req) {
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return false;
  // An <img>, <script> or link on another site sends no Origin on a GET, but
  // browsers do mark it cross-site. Tools like curl send neither header.
  const site = req.headers["sec-fetch-site"];
  if (site && !["same-origin", "none"].includes(site)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// ── who may act for which agent ─────────────────────────────────────────
// Each browser gets a session cookie and says which avatar it plays. A request
// that names that avatar is the player acting. Any other agent is an NPC, and
// the server only lets the page carry out what the server itself decided for
// it (its current goal); everything else is refused. So a page, or a console,
// can no longer make an agent spend its credits on something it never chose.
const sessions = new Map(); // id → { avatar, at }
const SESSION_TTL = 24 * 3600_000;

function sessionOf(req, res) {
  const m = /(?:^|;\s*)ov_session=([a-f0-9]{32})/.exec(req.headers.cookie || "");
  let id = m?.[1];
  if (!id || !sessions.has(id)) {
    id = id && /^[a-f0-9]{32}$/.test(id) ? id : crypto.randomBytes(16).toString("hex");
    sessions.set(id, { avatar: null, at: Date.now() });
    res.setHeader("set-cookie", `ov_session=${id}; Path=/; HttpOnly; SameSite=Strict`);
  }
  const s = sessions.get(id);
  s.at = Date.now();
  if (sessions.size > 200) for (const [k, v] of sessions) if (Date.now() - v.at > SESSION_TTL) sessions.delete(k);
  return s;
}

const forbid = (msg) => Object.assign(new Error(msg), { status: 403 });
// Played by some other open session: nobody else may steer it.
const playedElsewhere = (agentId, me) => [...sessions.values()].some((s) => s !== me && s.avatar === agentId && Date.now() - s.at < 60_000);

// mine: the session's own avatar → anything; otherwise the action must match
// the goal the server set for that agent.
async function authorize(session, agentId, check) {
  if (session.avatar === agentId) return "player";
  if (playedElsewhere(agentId, session)) throw forbid("someone else is playing that agent");
  if (!check) throw forbid("only the player of that agent can do that");
  const goals = { ...eco.publicGoals(), ...(await work.workGoals(controlledId())) };
  if (!check(goals[agentId] || {})) throw forbid("that is not what the agent decided to do");
  return "npc";
}

async function readProjectFile(id, rel) {
  const root = buildingRoot(id);
  if (!root) throw Object.assign(new Error("unknown building"), { status: 404 });
  if (!rel || isSecretPath(rel)) throw Object.assign(new Error("this room is sealed"), { status: 403 });
  const realRoot = fs.realpathSync(root);
  let real;
  try { real = fs.realpathSync(path.resolve(realRoot, rel)); } catch {
    throw Object.assign(new Error("this room is empty now (the file was moved or deleted)"), { status: 404 });
  }
  const inside = path.relative(realRoot, real);
  if (inside.startsWith("..") || path.isAbsolute(inside) || isSecretPath(inside)) {
    throw Object.assign(new Error("this room is sealed"), { status: 403 });
  }
  const st = await fsp.stat(real);
  const fh = await fsp.open(real, "r");
  try {
    const buf = Buffer.alloc(Math.min(st.size, MAX_FILE));
    await fh.read(buf, 0, buf.length, 0);
    if (buf.subarray(0, 8192).includes(0)) return { path: rel, size: st.size, modified: st.mtimeMs, binary: true };
    return {
      path: rel, size: st.size, modified: st.mtimeMs, truncated: st.size > MAX_FILE,
      content: redact(buf.toString("utf8"), knownSecrets()),
    };
  } finally {
    await fh.close();
  }
}

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const session = sessionOf(req, res);
  switch (route) {
    case "POST /api/session/embody": {
      const { avatar } = await readBody(req);
      if (avatar && !listAvatars().some((a) => a.id === avatar)) return send(res, 404, { error: "unknown avatar" });
      if (avatar && playedElsewhere(avatar, session)) return send(res, 409, { error: "that agent is being played in another tab" });
      session.avatar = avatar || null;
      return send(res, 200, { avatar: session.avatar });
    }
    case "GET /api/providers":
      return send(res, 200, publicRegistry());
    // The Omni account link (see cloud.mjs). The token never leaves the server.
    case "GET /api/cloud":
      return send(res, 200, cloud.status());
    case "POST /api/cloud/connect":
      return send(res, 200, await cloud.connect());
    case "POST /api/cloud/cancel":
      return send(res, 200, cloud.cancel());
    case "POST /api/cloud/refresh":
      return send(res, 200, await cloud.refresh());
    case "POST /api/cloud/logout":
      return send(res, 200, await cloud.signOut());
    case "POST /api/providers/key": {
      const { provider, key } = await readBody(req);
      return send(res, 200, saveLocalKey(String(provider || ""), key));
    }
    case "GET /api/providers/check":
      return send(res, 200, { results: await checkProviders() });
    case "GET /api/models":
      return send(res, 200, await liveModels(String(url.searchParams.get("provider") || "")));
    // Settings → Projects: every project on this PC, which ones are in the city.
    case "GET /api/projects": {
      const [found, world] = await Promise.all([findProjects(), getWorld()]);
      const inCity = new Set(world.buildings.map((b) => String(b.root).toLowerCase()));
      return send(res, 200, {
        chosen: world.chosen, max: MAX_PROJECTS,
        projects: found.map((p) => ({ ...p, selected: inCity.has(p.root.toLowerCase()) })),
        // Picked folders that discovery doesn't reach (added by path) still show up.
        extra: world.buildings.filter((b) => !found.some((p) => p.root.toLowerCase() === String(b.root).toLowerCase()))
          .map((b) => ({ root: b.root, name: b.name, district: b.district, kind: "folder", last: b.last, selected: true })),
      });
    }
    case "POST /api/projects/folder":
      return send(res, 200, await inspectFolder((await readBody(req)).path));
    case "POST /api/projects": {
      const { projects, scanDirs } = await readBody(req);
      if (!Array.isArray(projects) || projects.length > MAX_PROJECTS || projects.some((p) => typeof p !== "string" || p.length > 400)) {
        return send(res, 400, { error: `Pick between 1 and ${MAX_PROJECTS} projects.` });
      }
      saveProjects(projects, Array.isArray(scanDirs) ? scanDirs.filter((d) => typeof d === "string" && d.length <= 400) : undefined);
      const w = await getWorld(true);
      return send(res, 200, { buildings: w.buildings.length, districts: new Set(w.buildings.map((b) => b.district)).size, chosen: w.chosen });
    }
    case "GET /api/world":
      return send(res, 200, await getWorld(url.searchParams.get("refresh") === "1"));
    case "GET /api/file":
      return send(res, 200, await readProjectFile(url.searchParams.get("b"), url.searchParams.get("p")));
    case "GET /api/avatars":
      return send(res, 200, listAvatars());
    case "POST /api/avatars/forge": {
      const { provider, model, hint } = await readBody(req);
      return send(res, 200, await forgeAvatar({ provider: String(provider || ""), model: String(model || ""), hint }));
    }
    case "POST /api/avatars/delete": {
      deleteAvatar(String((await readBody(req)).id || ""));
      return send(res, 200, { ok: true });
    }
    case "POST /api/chat": {
      const { avatarId, messages, location } = await readBody(req);
      const avatar = listAvatars().find((a) => a.id === avatarId);
      if (!avatar) return send(res, 404, { error: "that agent has no avatar" });
      // Chats spend the same hourly budget as the simulation and stop when it's paused.
      if (isPaused()) return send(res, 423, { error: "The simulation is paused, so agents can't talk right now. Resume it from the mode select." });
      if (budgetLeft() <= 0) return send(res, 429, { error: "The hourly LLM budget is used up. Raise it in Settings → Simulation or try again later." });
      const history = (Array.isArray(messages) ? messages : []).slice(-20)
        .filter((m) => m && ["user", "assistant"].includes(m.role))
        .map((m) => {
          const out = { role: m.role, content: String(m.content || "").slice(0, 2000) };
          if (m.role === "assistant" && typeof m.reasoning === "string") out.reasoning_content = m.reasoning.slice(0, 20000);
          return out;
        });
      const reply = await callAgent(avatar, {
        messages: [{ role: "system", content: personaPrompt(avatar, String(location || "").slice(0, 200)) + lifeContext(avatar.id) }, ...history],
        maxTokens: 700,
        temperature: 0.8,
        retries: [1000], // someone is waiting on the reply
      });
      // Keys, tokens and passwords never reach the journal; with
      // recordVisitorChat off only the agent's side is kept.
      const said = lifeConfig().recordVisitorChat ? scrubSecrets(history.findLast((m) => m.role === "user")?.content || "", knownSecrets()).slice(0, 300) : "…";
      record({ type: "talk", agents: [avatar.id], lines: [{ who: "visitor", name: "Visitor", say: said }, { who: avatar.id, name: avatar.spec.name, say: scrubSecrets(reply.text, knownSecrets()).slice(0, 300) }] });
      return send(res, 200, { text: reply.text, reasoning: reply.reasoning });
    }
    case "GET /api/life/state":
      return send(res, 200, lifeState(Number(url.searchParams.get("since")) || 0, session.avatar || ""));
    case "GET /api/life/house":
      return send(res, 200, house(String(url.searchParams.get("id") || "")) || { parts: [] });
    case "GET /api/life/graph":
      return send(res, 200, graph({
        before: Number(url.searchParams.get("before")) || Infinity,
        limit: Number(url.searchParams.get("limit")) || 4000,
        agent: String(url.searchParams.get("agent") || ""),
      }));
    // Agents meet and visit each other in the server's own loop (sim.mjs).
    case "GET /api/sim":
      return send(res, 200, sim.snapshot());
    case "GET /api/sim/stream": {
      // Five snapshots a second as server-sent events, for as long as the view is open.
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      const push = () => res.write(`data: ${JSON.stringify(sim.snapshot())}

`);
      push();
      const timer = setInterval(push, 200), unwatch = sim.watch();
      req.on("close", () => { clearInterval(timer); unwatch(); });
      return;
    }
    case "POST /api/sim/hold": {
      const b = await readBody(req);
      return send(res, 200, sim.hold(agentOf(String(b.agent || "")).id, Boolean(b.on)));
    }
    case "POST /api/life/pause":
      return send(res, 200, setPaused((await readBody(req)).paused));
    case "GET /api/settings":
      return send(res, 200, getSettings());
    case "POST /api/settings":
      return send(res, 200, saveSettings(await readBody(req)));
    default:
      if (url.pathname.startsWith("/api/eco/")) return ecoApi(req, res, route, session);
      if (url.pathname.startsWith("/api/work/")) return workApi(req, res, route, url, session);
      return send(res, 404, { error: "not found" });
  }
}

const agentOf = (id) => {
  const a = listAvatars().find((x) => x.id === id);
  if (!a) throw Object.assign(new Error("unknown agent"), { status: 404 });
  return a;
};

async function ecoApi(req, res, route, session) {
  if (route === "GET /api/eco/state") {
    // Work comes first: an agent heading to its desk or sitting at it follows
    // that goal instead of its economic one.
    const out = eco.publicState();
    Object.assign(out.goals, await work.workGoals(controlledId()));
    return send(res, 200, out);
  }
  const b = await readBody(req);
  switch (route) {
    case "POST /api/eco/gather": {
      const id = agentOf(String(b.agent || "")).id, node = eco.nodeOf(String(b.node || ""));
      await authorize(session, id, (g) => g.kind === "gather" && node && (!g.want?.length || g.want.includes(node.kind)));
      return send(res, 200, eco.gather(id, String(b.node || ""), b.pos));
    }
    case "POST /api/eco/sell": {
      const id = agentOf(String(b.agent || "")).id;
      // An NPC sells its surplus when its goal says so; picking what and how much is the player's.
      const as = await authorize(session, id, (g) => g.kind === "sell" && !b.kind);
      return send(res, 200, eco.sellToExchange(id, as === "player" && b.kind ? String(b.kind) : null, as === "player" ? b.qty : undefined));
    }
    case "POST /api/eco/exchange-buy": {
      const id = agentOf(String(b.agent || "")).id;
      await authorize(session, id, null);
      return send(res, 200, eco.buyFromExchange(id, b.qty));
    }
    case "POST /api/eco/kiosk": {
      const id = agentOf(String(b.agent || "")).id;
      await authorize(session, id, null);
      if (b.action === "open") return send(res, 200, eco.openKiosk(id));
      if (b.action === "list") return send(res, 200, eco.listOnKiosk(id, { res: b.res, qty: b.qty, item: b.item, price: b.price }));
      if (b.action === "unlist") return send(res, 200, eco.unlist(id, String(b.listing || "")));
      return send(res, 400, { error: "unknown kiosk action" });
    }
    case "POST /api/eco/buy": {
      const buyer = agentOf(String(b.buyer || "")), seller = agentOf(String(b.seller || ""));
      await authorize(session, buyer.id, (g) => g.kind === "buy" && g.seller === seller.id && g.listing === String(b.listing || ""));
      const out = eco.buy(buyer.id, seller.id, String(b.listing || ""));
      const what = out.item ? out.item.name : `${out.listing.qty} ${out.listing.res}`;
      // NPCs put a bought decoration in their yard straight away.
      if (out.item && b.auto) try { placeItem(buyer.id, out.item.id); } catch { /* it stays in the inventory */ }
      out.event = record({ type: "trade", agents: [seller.id, buyer.id], what, price: out.listing.price, summary: `${buyer.spec.name} bought ${what} from ${seller.spec.name} for ${out.listing.price} ⌬` });
      return send(res, 200, out);
    }
    case "POST /api/eco/order": {
      const id = agentOf(String(b.agent || "")).id;
      await authorize(session, id, null); // agents trade orders on the server; the page only for its player
      if (b.action === "post") return send(res, 200, eco.postOrder(id, String(b.res || ""), b.qty, b.price));
      if (b.action === "cancel") return send(res, 200, eco.cancelOrder(id, String(b.order || "")));
      if (b.action === "fill") {
        const r = eco.fillOrder(id, String(b.order || ""), b.qty);
        const buyer = listAvatars().find((a) => a.id === r.buyer);
        record({ type: "trade", agents: [id, r.buyer], what: `${r.qty} ${r.res}`, price: r.earned, summary: `${agentOf(id).spec.name} filled ${buyer?.spec.name || "someone"}'s order: ${r.qty} ${r.res} for ${r.earned} ⌬` });
        return send(res, 200, r);
      }
      return send(res, 400, { error: "unknown order action" });
    }
    case "POST /api/eco/preset": {
      const a = agentOf(String(b.agent || ""));
      await authorize(session, a.id, (g) => g.kind === "preset" && g.preset === String(b.preset || ""));
      const item = eco.buyPreset(a.id, String(b.preset || ""));
      record({ type: "preset", agents: [a.id], what: item.name, summary: `${a.spec.name} bought a ${item.name} at the Exchange` });
      return send(res, 200, { item });
    }
    case "POST /api/eco/craft": {
      const a = agentOf(String(b.agent || ""));
      await authorize(session, a.id, null);
      return send(res, 200, await craftItem(a));
    }
    case "POST /api/eco/place": {
      const id = agentOf(String(b.agent || "")).id;
      await authorize(session, id, null);
      return send(res, 200, placeItem(id, String(b.item || "")));
    }
    default:
      return send(res, 404, { error: "not found" });
  }
}

async function workApi(req, res, route, url, session) {
  if (route === "GET /api/work/state") return send(res, 200, work.state(Number(url.searchParams.get("v")) || 0));
  if (route === "GET /api/work/job") return send(res, 200, work.jobDetail(String(url.searchParams.get("id") || "")));
  if (route === "GET /api/work/block") return send(res, 200, work.blockDetail(String(url.searchParams.get("id") || "")));
  const b = await readBody(req, 128 * 1024);
  // "you" is the person at the keyboard; an agent's name only for the avatar this session plays.
  const who = (v) => {
    if (v === "you" || !v) return "you";
    const id = agentOf(String(v)).id;
    if (session.avatar !== id) throw forbid("you can only act as yourself or the avatar you play");
    return id;
  };
  switch (route) {
    case "POST /api/work/job":
      return send(res, 200, await work.postJob(who(b.from || "you"), b));
    case "POST /api/work/cancel":
      return send(res, 200, work.cancelJob(String(b.id || "")));
    case "POST /api/work/clockin": {
      const id = agentOf(String(b.agent || "")).id;
      await authorize(session, id, (g) => (g.kind === "work" || g.kind === "desk") && String(g.root || "").toLowerCase() === String(b.root || "").toLowerCase());
      return send(res, 200, work.clockIn(id, String(b.root || "")));
    }
    case "POST /api/work/block":
      return send(res, 200, work.makeBlock(who(b.from), agentOf(String(b.to || "")).id, b));
    case "POST /api/work/pickup":
      return send(res, 200, work.pickUp(String(b.id || ""), who(b.by)));
    case "POST /api/work/run":
      return send(res, 200, await work.runBlock(String(b.id || ""), agentOf(String(b.agent || "")).id));
    case "POST /api/work/chat": {
      const m = work.post("you", String(b.text || ""));
      // "@Name" asks that agent for an answer (one LLM call, within budget).
      const at = /@([\w .-]{2,40})/.exec(m.text);
      const target = at && listAvatars().find((a) => m.text.toLowerCase().includes("@" + a.spec.name.toLowerCase()));
      if (target) {
        chatReply(target, "You", m.text, work.state().chat.slice(-12))
          .then((say) => work.post(target.id, say))
          .catch((e) => work.post(target.id, `(no answer: ${String(e.message).slice(0, 120)})`, { kind: "sys" }));
      }
      return send(res, 200, m);
    }
    default:
      return send(res, 404, { error: "not found" });
  }
}

async function serveStatic(res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname); } catch { return send(res, 400, { error: "bad path" }); }
  const file = path.resolve(PUBLIC, `.${rel}`);
  if (path.relative(PUBLIC, file).startsWith("..")) return send(res, 403, { error: "forbidden" });
  try {
    const body = await fsp.readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(body);
  } catch {
    send(res, 404, { error: "not found" });
  }
}

// Save everything, then stop. Ctrl+C, a kill signal and the tray's Exit all
// come here, so the economy and the work system both get to save.
function shutdown(why) {
  console.log(`shutting down (${why})`);
  for (const f of [eco.flush, work.flush]) { try { f(); } catch (e) { console.error("save on exit failed:", e.message); } }
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.once(sig, () => shutdown(sig));

// The tray launcher (tray/omniverse-tray.ps1) starts the server with a random
// OMNIVERSE_CONTROL_TOKEN; only a request carrying it may stop the server.
const CONTROL = String(process.env.OMNIVERSE_CONTROL_TOKEN || "");
function control(req, res, url) {
  const given = String(req.headers["x-omniverse-control"] || "");
  const ok = CONTROL.length >= 32 && given.length === CONTROL.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(CONTROL));
  if (!ok) return send(res, 403, { error: "forbidden" });
  if (req.method === "POST" && url.pathname === "/api/control/shutdown") {
    send(res, 200, { stopping: true });
    setTimeout(() => shutdown("tray"), 100);
    return;
  }
  return send(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (!trusted(req)) return send(res, 403, { error: "untrusted origin" });
    if (url.pathname.startsWith("/api/control/")) return control(req, res, url);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    return await serveStatic(res, url);
  } catch (e) {
    send(res, e.status || 500, { error: redact(e.message, knownSecrets()) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const reg = publicRegistry();
  const keyed = reg.providers.filter((p) => p.hasKey).map((p) => p.name);
  console.log(`Omniverse → http://localhost:${PORT}`);
  console.log(`providers (${reg.mode}${reg.omniSettings ? `: ${reg.omniSettings}` : ""}): ${keyed.join(", ") || "none keyed"}`);
  getWorld().then((w) => console.log(`world: ${w.buildings.length} buildings`)).catch((e) => console.error("world scan failed:", e.message));
});
