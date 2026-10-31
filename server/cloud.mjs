// The link to the user's Omni account on omniverse.globalwarningnetworks.com.
//
// Optional: nothing in the Omniverse needs it to run. It works like OmniOne's
// connection: the app asks the site for a short code, the user approves it in
// their browser (where they sign in with their Omni account), and the app
// receives a token. The app never sees the password. The token lives in
// data/cloud.json (git-ignored, owner-only) and never reaches the browser:
// the page only ever gets the profile.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { APP_ROOT } from "./config.mjs";

const FILE = path.join(APP_ROOT, "data", "cloud.json");
export const DEFAULT_SITE = "https://omniverse.globalwarningnetworks.com";

let state = load();
let pending = null; // { deviceCode, userCode, verifyUrl, expiresAt, interval }
let pollTimer = null;
let lastError = "";

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}
function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) { console.error("cloud: saving failed:", e.message); }
}

// Only https, or this PC for testing a local copy of the site.
export function siteUrl() {
  const s = String(process.env.OMNIVERSE_SITE || "").replace(/\/+$/, "");
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(s)) return s;
  return DEFAULT_SITE;
}

function device() {
  if (!state.deviceUid) { state.deviceUid = "omv-" + crypto.randomBytes(12).toString("hex"); save(); }
  let version = "";
  try { version = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8")).version || ""; } catch { /* unknown */ }
  return { uid: state.deviceUid, name: os.hostname().slice(0, 100), os: `${os.type()} ${os.release()}`.slice(0, 100), app_version: version };
}

async function api(method, route, { body, token } = {}) {
  let res;
  try {
    res = await fetch(`${siteUrl()}/api/${route}`, {
      method,
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw Object.assign(new Error(`Can't reach ${siteUrl().replace(/^https?:\/\//, "")}. Check your internet connection.`), { status: 502 });
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) {
    // The site says the token is no good any more: forget it.
    if (res.status === 401 && token) signOutLocally();
    throw Object.assign(new Error(j.message || `The site answered ${res.status}.`), { status: res.status === 401 ? 401 : 502 });
  }
  return j;
}

function signOutLocally() {
  delete state.token;
  delete state.user;
  delete state.connectedAt;
  save();
}

// What the page may know: never the token.
export function status() {
  if (pending && Date.now() > pending.expiresAt) { pending = null; lastError = "The code expired. Start again."; }
  return {
    connected: Boolean(state.token),
    site: siteUrl(),
    user: state.token ? state.user || null : null,
    connectedAt: state.token ? state.connectedAt || null : null,
    pending: pending ? { userCode: pending.userCode, verifyUrl: pending.verifyUrl, expiresAt: pending.expiresAt } : null,
    error: lastError,
  };
}

// Step 1: get a code for the person to approve, then poll in the background.
export async function connect() {
  cancel();
  lastError = "";
  const r = await api("POST", "auth/device/start", { body: { device: device() } });
  pending = { deviceCode: r.device_code, userCode: r.user_code, verifyUrl: r.verify_url, expiresAt: Date.now() + (Number(r.expires_in) || 600) * 1000, interval: Math.max(2, Number(r.interval) || 3) };
  schedule();
  return status();
}

function schedule() {
  clearTimeout(pollTimer);
  if (!pending) return;
  pollTimer = setTimeout(poll, pending.interval * 1000);
  pollTimer.unref?.();
}

async function poll() {
  if (!pending) return;
  if (Date.now() > pending.expiresAt) { pending = null; lastError = "The code expired. Start again."; return; }
  try {
    const r = await api("POST", "auth/device/poll", { body: { device_code: pending.deviceCode } });
    if (r.status === "approved" && r.token) {
      state.token = r.token;
      state.user = r.user || null;
      state.connectedAt = new Date().toISOString();
      save();
      pending = null;
      return;
    }
    if (r.status === "denied") { pending = null; lastError = "The connection was declined on the website."; return; }
    if (r.status === "expired") { pending = null; lastError = "The code expired. Start again."; return; }
    if (r.status === "slow_down") pending.interval += 2;
  } catch { /* offline for a moment: keep trying until the code expires */ }
  schedule();
}

export function cancel() {
  clearTimeout(pollTimer);
  pending = null;
  return status();
}

// Re-read the profile (name, avatar, tier may change on the website).
export async function refresh() {
  if (!state.token) return status();
  try {
    const r = await api("GET", "me", { token: state.token });
    state.user = r.user || state.user;
    save();
  } catch (e) { if (e.status !== 401) lastError = e.message; }
  return status();
}

export async function signOut() {
  const t = state.token;
  signOutLocally();
  if (t) { try { await api("POST", "auth/logout", { token: t }); } catch { /* signing out here is what matters */ } }
  return status();
}
