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

// The first ten use the same URLs as Omni's src/core/config.mjs. The rest is a
// catalog of every major OpenAI-compatible provider, each endpoint checked
// live (2026-10-31), so a new user only has to paste an API key. `model` is
// a starting pick; the provider's own /models list replaces it once a key is
// in. `keyUrl` is where to get a key; `noModels` marks providers without a
// /models list; local servers need no key.
export const BUILTIN_PROVIDERS = {
  nvidia: { label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3-ultra-550b-a55b", keyUrl: "https://build.nvidia.com/" },
  agnes: { label: "Agnes AI", baseUrl: "https://apihub.agnes-ai.com/v1", model: "agnes-2.5-flash" },
  xkiro: { label: "xKiro", baseUrl: "https://api.xkiro.com/v1", model: "mistralai/mistral-medium-3.5" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", keyUrl: "https://console.groq.com/keys" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", keyUrl: "https://openrouter.ai/keys" },
  atria: { label: "Atria ASI", baseUrl: "https://api.atria-asi.ai/v1", model: "Atria-Dawn" },
  reflection: { label: "Reflection AI", baseUrl: "https://api.reflection.ai/openai/v1", model: "Beam-1.0-501B-A23B" },
  "minimax.io": { label: "MiniMax", baseUrl: "https://api.minimax.io/v1", model: "MiniMax-M3.1-Flash", keyUrl: "https://www.minimax.io/platform" },
  kimi: { label: "Kimi (Moonshot, China)", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-32k", keyUrl: "https://platform.moonshot.cn/" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", keyUrl: "https://platform.openai.com/api-keys" },

  anthropic: { label: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5", keyUrl: "https://console.anthropic.com/settings/keys" },
  google: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", keyUrl: "https://aistudio.google.com/apikey" },
  xai: { label: "xAI Grok", baseUrl: "https://api.x.ai/v1", model: "grok-3-mini", keyUrl: "https://console.x.ai/" },
  mistral: { label: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", keyUrl: "https://console.mistral.ai/api-keys" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", keyUrl: "https://platform.deepseek.com/api_keys" },
  moonshot: { label: "Kimi (Moonshot, global)", baseUrl: "https://api.moonshot.ai/v1", model: "kimi-k2-0905-preview", keyUrl: "https://platform.moonshot.ai/" },
  qwen: { label: "Qwen (Alibaba DashScope)", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", keyUrl: "https://modelstudio.console.alibabacloud.com/" },
  zai: { label: "Z.ai GLM (global)", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.5", keyUrl: "https://z.ai/manage-apikey/apikey-list" },
  zhipu: { label: "Zhipu GLM (China)", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", keyUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
  cohere: { label: "Cohere", baseUrl: "https://api.cohere.ai/compatibility/v1", model: "command-a-03-2025", keyUrl: "https://dashboard.cohere.com/api-keys" },
  perplexity: { label: "Perplexity", baseUrl: "https://api.perplexity.ai", model: "sonar", noModels: true, keyUrl: "https://www.perplexity.ai/account/api/keys" },
  ai21: { label: "AI21 Labs", baseUrl: "https://api.ai21.com/studio/v1", model: "jamba-large", keyUrl: "https://studio.ai21.com/account/api-key" },
  upstage: { label: "Upstage Solar", baseUrl: "https://api.upstage.ai/v1", model: "solar-pro2", keyUrl: "https://console.upstage.ai/api-keys" },
  inception: { label: "Inception Mercury", baseUrl: "https://api.inceptionlabs.ai/v1", model: "mercury", keyUrl: "https://platform.inceptionlabs.ai/" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", keyUrl: "https://api.together.ai/settings/api-keys" },
  fireworks: { label: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", model: "accounts/fireworks/models/llama-v3p3-70b-instruct", keyUrl: "https://fireworks.ai/account/api-keys" },
  cerebras: { label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", model: "llama-3.3-70b", keyUrl: "https://cloud.cerebras.ai/" },
  sambanova: { label: "SambaNova", baseUrl: "https://api.sambanova.ai/v1", model: "Meta-Llama-3.3-70B-Instruct", keyUrl: "https://cloud.sambanova.ai/apis" },
  deepinfra: { label: "DeepInfra", baseUrl: "https://api.deepinfra.com/v1/openai", model: "meta-llama/Llama-3.3-70B-Instruct", keyUrl: "https://deepinfra.com/dash/api_keys" },
  hyperbolic: { label: "Hyperbolic", baseUrl: "https://api.hyperbolic.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct", keyUrl: "https://app.hyperbolic.xyz/settings" },
  nebius: { label: "Nebius AI Studio", baseUrl: "https://api.studio.nebius.com/v1", model: "meta-llama/Llama-3.3-70B-Instruct", keyUrl: "https://studio.nebius.com/settings/api-keys" },
  novita: { label: "Novita AI", baseUrl: "https://api.novita.ai/v3/openai", model: "meta-llama/llama-3.3-70b-instruct", keyUrl: "https://novita.ai/settings/key-management" },
  siliconflow: { label: "SiliconFlow", baseUrl: "https://api.siliconflow.com/v1", model: "deepseek-ai/DeepSeek-V3", keyUrl: "https://cloud.siliconflow.com/account/ak" },
  chutes: { label: "Chutes", baseUrl: "https://llm.chutes.ai/v1", model: "deepseek-ai/DeepSeek-V3-0324", keyUrl: "https://chutes.ai/app/api" },
  featherless: { label: "Featherless", baseUrl: "https://api.featherless.ai/v1", model: "meta-llama/Meta-Llama-3.1-8B-Instruct", keyUrl: "https://featherless.ai/account/api-keys" },
  venice: { label: "Venice AI", baseUrl: "https://api.venice.ai/api/v1", model: "llama-3.3-70b", keyUrl: "https://venice.ai/settings/api" },
  baseten: { label: "Baseten", baseUrl: "https://inference.baseten.co/v1", model: "deepseek-ai/DeepSeek-V3-0324", keyUrl: "https://app.baseten.co/settings/api_keys" },
  huggingface: { label: "Hugging Face Router", baseUrl: "https://router.huggingface.co/v1", model: "meta-llama/Llama-3.3-70B-Instruct", keyUrl: "https://huggingface.co/settings/tokens" },
  github: { label: "GitHub Models", baseUrl: "https://models.github.ai/inference", model: "openai/gpt-4.1-mini", keyUrl: "https://github.com/settings/personal-access-tokens" },

  ollama: { label: "Ollama (this PC)", baseUrl: "http://localhost:11434/v1", model: "llama3.2", apiKey: "not-needed", keyUrl: "https://ollama.com/download" },
  lmstudio: { label: "LM Studio (this PC)", baseUrl: "http://localhost:1234/v1", model: "local-model", apiKey: "not-needed", keyUrl: "https://lmstudio.ai/" },
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
    keyUrl: p.keyUrl || "",
    noModels: Boolean(p.noModels),
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
  // Your featured providers first, then any other with a key, then the catalog A–Z.
  const rank = (p) => (FEATURED.includes(p.name) ? FEATURED.indexOf(p.name) : hasKey(p) && p.key !== "not-needed" ? 50 : 100);
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
      keyUrl: p.keyUrl,
      rank: rank(p),
    }))
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
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

// Save (or, with "", remove) a provider's key as OMNIVERSE_<NAME>_KEY in this
// app's own .env, the documented per-app override. Omni's files are never
// touched. The key is never sent back to the browser.
export function saveLocalKey(name, key) {
  const p = loadRegistry().providers[name];
  if (!p) throw Object.assign(new Error(`unknown provider "${name}"`), { status: 404 });
  const value = String(key ?? "").trim();
  if (value.length > 500 || /[\s"'`]/.test(value)) throw Object.assign(new Error("That doesn't look like an API key."), { status: 400 });
  const file = path.join(APP_ROOT, ".env"), v = overrideVar(name, "KEY");
  let lines = [];
  try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); } catch { /* first key */ }
  const at = lines.findIndex((l) => l.trim().startsWith(`${v}=`));
  if (value) {
    if (at >= 0) lines[at] = `${v}=${value}`;
    else { while (lines.length && !lines.at(-1).trim()) lines.pop(); lines.push(`${v}=${value}`, ""); }
  } else if (at >= 0) lines.splice(at, 1);
  fs.writeFileSync(file + ".tmp", lines.join("\n"), { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
  liveCache.delete(name);
  return { provider: name, hasKey: Boolean(value) };
}

// Is the endpoint up, and is the key good? Asks for /models (or, for
// providers without one, sends an empty chat request) and reads the status:
// 200 = ok, 401/403 = key missing or rejected, anything else = up but unhappy,
// no answer = down. Every provider is checked at once.
export async function checkProviders() {
  const reg = loadRegistry();
  const one = async (p) => {
    const key = p.key || Object.values(p.accounts || {}).find(Boolean) || "";
    const headers = key && key !== "not-needed" ? { authorization: `Bearer ${key}` } : {};
    const base = p.baseUrl.replace(/\/+$/, "");
    const t0 = Date.now();
    try {
      const res = p.noModels
        ? await fetch(`${base}/chat/completions`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) })
        : await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(10_000) });
      let models = 0;
      if (res.ok && !p.noModels) { try { models = ((await res.json()).data || []).length; } catch { /* not a list */ } }
      const keyed = Boolean(key);
      const auth = res.status === 401 || res.status === 403 ? (keyed && key !== "not-needed" ? "rejected" : "missing")
        : res.ok || (p.noModels && res.status === 400) ? (keyed ? "ok" : "open")
        : !keyed && [400, 404].includes(res.status) ? "missing" : "unknown"; // Gemini answers 404 without a key
      return { name: p.name, up: true, status: res.status, ms: Date.now() - t0, auth, models };
    } catch {
      return { name: p.name, up: false, status: 0, ms: Date.now() - t0, auth: "unknown", models: 0 };
    }
  };
  return Promise.all(Object.values(reg.providers).filter((p) => p.baseUrl).map(one));
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
  if (!p.noModels) try {
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
