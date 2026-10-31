// Provider registry, shared with Omni the same way OmniBots and OmniCode do it:
// keys and endpoints are read live from Omni's own files and never copied here.
//
//   <omni install>/agent/settings.json   providers, accounts, models (Omni's format)
//   .omni-verse/.env, <install>/.env, <home>/.env
//
// Omni's rules: a NON-EMPTY key in settings.json wins; OMNI_<NAME>_KEY only
// fills an empty slot; account providers (nvidia1/2, agnes1/2) resolve per
// account and the active account's key is used first. On top of that,
// OMNIVERSE_<NAME>_KEY / _BASE_URL / _MODEL in .omni-verse/.env override
// everything for this app only. Without Omni installed the built-in endpoint
// table below is used with keys from .omni-verse/.env (standalone mode).
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT, HOME, parseEnvFile, readJsonLoose } from "./config.mjs";
import { redact } from "./security.mjs";

// Same URLs as Omni's src/core/config.mjs; `model` is this app's default pick.
export const BUILTIN_PROVIDERS = {
  nvidia: { label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3-ultra-550b-a55b" },
  agnes: { label: "Agnes AI", baseUrl: "https://apihub.agnes-ai.com/v1", model: "agnes-2.5-flash" },
  xkiro: { label: "xKiro", baseUrl: "https://api.xkiro.com/v1", model: "mistralai/mistral-medium-3.5" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto" },
  atria: { label: "Atria ASI", baseUrl: "https://api.atria-asi.ai/v1", model: "Atria-Dawn" },
  reflection: { label: "Reflection AI", baseUrl: "https://api.reflection.ai/openai/v1", model: "Beam-1.0-501B-A23B" },
  "minimax.io": { label: "MiniMax", baseUrl: "https://api.minimax.io/v1", model: "MiniMax-M3.1-Flash" },
  kimi: { label: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-32k" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
};
export const FEATURED = ["nvidia", "agnes", "xkiro", "groq", "openrouter", "atria", "reflection", "minimax.io"];

// Vendor-documented env names Omni also accepts.
const ENV_ALIASES = { atria: ["ATRIA_API_KEY"], reflection: ["REFLECTION_API_KEY"] };
// Anthropic's native API isn't OpenAI-compatible; Omni routes it via OpenRouter.
const UNUSABLE = new Set(["claude", "cursor"]);

const envName = (name) => String(name).toUpperCase().replace(/[^A-Z0-9]/g, "_");
const omniKeyVar = (name) => `OMNI_${envName(name)}_KEY`;
const overrideVar = (name, what) => `OMNIVERSE_${envName(name)}_${what}`;

export function locateOmni() {
  const install = process.env.OMNI_INSTALL || path.join(HOME, ".omni");
  const home = process.env.OMNI_HOME || path.join(install, "agent");
  const settings = path.join(home, "settings.json");
  if (!fs.existsSync(settings)) return null;
  return { install, home, settings, envFiles: [path.join(install, ".env"), path.join(home, ".env")] };
}

// The environment the app sees: real env first, then .env files in order;
// a file never overrides a name that is already set.
function envView(omni) {
  const env = { ...process.env };
  for (const f of [path.join(APP_ROOT, ".env"), ...(omni ? omni.envFiles : [])]) {
    for (const [k, v] of Object.entries(parseEnvFile(f))) {
      if (k !== "OMNI_HOME" && !(k in env)) env[k] = v;
    }
  }
  if (!env.OMNI_AGNES2_KEY && env.OMNI_AGNES_KEY2) env.OMNI_AGNES2_KEY = env.OMNI_AGNES_KEY2;
  if (!env.OMNI_MINIMAX_IO_KEY && env.OMNI_MINIMAX_KEY) env.OMNI_MINIMAX_IO_KEY = env.OMNI_MINIMAX_KEY;
  return env;
}

const envKey = (env, name) =>
  [omniKeyVar(name), ...(ENV_ALIASES[name] || [])].map((v) => String(env[v] || "").trim()).find(Boolean) || "";

function resolveProvider(name, p, env) {
  const onDisk = String(p.apiKey || "").trim();
  const fromEnv = envKey(env, name);
  let key = onDisk || fromEnv;
  let source = onDisk ? "omni settings" : fromEnv ? "env" : "none";
  let accounts = null;
  if (p.accounts && typeof p.accounts === "object") {
    accounts = {};
    for (const [acct, v] of Object.entries(p.accounts)) {
      accounts[acct] = String(v || "").trim() || String(env[omniKeyVar(acct)] || "").trim();
    }
    const first = Object.keys(accounts)[0];
    if (first && !accounts[first] && key) accounts[first] = key;
    if (p.activeAccount && accounts[p.activeAccount]) {
      key = accounts[p.activeAccount];
      source = `account ${p.activeAccount}`;
    }
  }
  const override = String(env[overrideVar(name, "KEY")] || "").trim();
  if (override) { key = override; source = "omni-verse .env"; accounts = null; }
  return {
    name,
    label: p.label || name,
    baseUrl: String(env[overrideVar(name, "BASE_URL")] || p.baseUrl || "").trim(),
    key: key === "not-needed" ? "not-needed" : key,
    source,
    accounts,
    activeAccount: p.activeAccount || null,
    builtinModel: p.model,
  };
}

export function loadRegistry() {
  const omni = locateOmni();
  const env = envView(omni);
  const errors = [];
  let saved = {};
  if (omni) {
    try { saved = readJsonLoose(omni.settings); } catch (e) { errors.push(`Omni settings unreadable: ${e.message}`); }
  }
  const merged = {};
  for (const [n, p] of Object.entries(BUILTIN_PROVIDERS)) merged[n] = { ...p };
  for (const [n, p] of Object.entries(saved.providers || {})) {
    if (p && typeof p === "object" && !UNUSABLE.has(n)) merged[n] = { ...(merged[n] || {}), ...p };
  }
  const models = {};
  for (const [k, m] of Object.entries(saved.models || {})) {
    if (m && typeof m === "object" && m.provider) (models[m.provider] ||= []).push(m.id || k);
  }
  const providers = {};
  const secrets = [];
  for (const [n, p] of Object.entries(merged)) {
    const r = resolveProvider(n, p, env);
    const override = env[overrideVar(n, "MODEL")];
    r.models = [...new Set([override, r.builtinModel, ...(models[n] || [])].filter(Boolean))];
    r.defaultModel = override || r.builtinModel || r.models[0] || "";
    providers[n] = r;
    for (const k of [r.key, ...Object.values(r.accounts || {})]) if (k && k !== "not-needed") secrets.push(k);
  }
  return { omni, providers, secrets, errors };
}

const hasKey = (p) => Boolean(p.key) || Object.values(p.accounts || {}).some(Boolean);

// Safe for the browser: no keys, no masks — only whether one exists and where from.
export function publicRegistry() {
  const reg = loadRegistry();
  const rank = (n) => (FEATURED.includes(n) ? FEATURED.indexOf(n) : 100);
  const list = Object.values(reg.providers)
    .map((p) => ({
      name: p.name,
      label: p.label,
      baseUrl: p.baseUrl,
      hasKey: hasKey(p),
      local: p.key === "not-needed",
      source: p.source,
      accounts: p.accounts ? Object.entries(p.accounts).map(([a, k]) => ({ name: a, hasKey: Boolean(k), active: a === p.activeAccount })) : [],
      models: p.models,
      defaultModel: p.defaultModel,
      featured: FEATURED.includes(p.name),
    }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  return {
    mode: reg.omni ? "shared" : "standalone",
    omniSettings: reg.omni?.settings || null,
    localEnv: path.join(APP_ROOT, ".env"),
    providers: list,
    errors: reg.errors,
  };
}

export function knownSecrets() {
  return loadRegistry().secrets;
}

// The provider's own /models list, so dropdowns never offer retired model ids.
const NOT_CHAT = /embed|guard|safety|reward|parse|whisper|tts|speech|audio|image|video|vision-only|rerank|moderation|clip|ocr/i;
const liveCache = new Map();
export async function liveModels(name) {
  const hit = liveCache.get(name);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  const p = loadRegistry().providers[name];
  if (!p) throw new Error(`unknown provider "${name}"`);
  const key = p.key || Object.values(p.accounts || {}).find(Boolean);
  const headers = key && key !== "not-needed" ? { authorization: `Bearer ${key}` } : {};
  let ids = [];
  try {
    const res = await fetch(`${p.baseUrl.replace(/\/+$/, "")}/models`, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.ok) ids = ((await res.json()).data || []).map((m) => m.id).filter((id) => id && !NOT_CHAT.test(id));
  } catch { /* offline or no /models: fall back to Omni's list */ }
  const live = new Set(ids);
  const ordered = ids.length
    ? [...new Set([...p.models.filter((m) => live.has(m)), ...ids.sort()])]
    : p.models;
  const value = { live: ids.length > 0, models: ordered, defaultModel: ids.length && !live.has(p.defaultModel) ? ordered[0] : p.defaultModel };
  liveCache.set(name, { at: Date.now(), value });
  return value;
}

const stripThinking =(s) => String(s || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

// One OpenAI-compatible chat call. Account providers fail over to their other
// accounts on 401/403/429 or a network error, like Omni's rotation.
export async function chat(name, { model, messages, maxTokens = 1200, temperature = 0.8 }) {
  const reg = loadRegistry();
  const p = reg.providers[name];
  if (!p) throw new Error(`unknown provider "${name}"`);
  const attempts = [];
  if (p.key) attempts.push([p.source, p.key]);
  for (const [acct, k] of Object.entries(p.accounts || {})) if (k && k !== p.key) attempts.push([`account ${acct}`, k]);
  if (!attempts.length) {
    throw new Error(`${p.label} has no API key — add it in Omni, or set ${overrideVar(name, "KEY")} in .omni-verse/.env`);
  }
  const url = `${p.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let lastErr;
  for (const [via, key] of attempts) {
    const body = { model: model || p.defaultModel, messages, max_tokens: maxTokens, temperature };
    // Beam always reasons; keep it short so avatar forging doesn't take minutes.
    if (name === "reflection") body.reasoning_effort = "low";
    const headers = { "content-type": "application/json" };
    if (key !== "not-needed") headers.authorization = `Bearer ${key}`;
    let res;
    try {
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
    } catch (e) {
      lastErr = new Error(`${p.label}: ${e.name === "TimeoutError" ? "timed out" : e.message}`);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      // An empty account isn't a rate limit: say so instead of dumping the JSON.
      if (/insufficient_quota|quota exhausted|insufficient.?balance/i.test(text)) {
        lastErr = Object.assign(new Error(`${p.label}: the key is valid but the account has no token quota left (${res.status}). Top it up in the provider's dashboard.`), { status: 502, code: "quota" });
        continue;
      }
      lastErr = Object.assign(new Error(`${p.label} ${res.status}: ${redact(text.slice(0, 300), reg.secrets)}`), { status: 502 });
      if ([401, 403, 429].includes(res.status)) continue;
      throw lastErr;
    }
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`${p.label}: response was not JSON`); }
    const msg = data.choices?.[0]?.message || {};
    let content = msg.content;
    if (Array.isArray(content)) content = content.map((c) => c?.text || "").join("");
    content = stripThinking(content) || stripThinking(msg.reasoning_content);
    // Reasoning models (Beam) refuse a follow-up turn unless each earlier
    // assistant message carries back its own reasoning_content.
    const reasoning = typeof msg.reasoning_content === "string" ? redact(msg.reasoning_content, reg.secrets) : undefined;
    return { text: redact(content, reg.secrets), reasoning, provider: name, model: body.model, via };
  }
  throw lastErr;
}
