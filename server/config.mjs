// Paths and small file helpers shared by the server modules.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HOME = os.homedir();
export const expandHome = (p) => String(p).replace(/^~(?=$|[\\/])/, HOME);

// Omni's .env format: KEY=value, # comments, optional matching quotes.
export function parseEnvFile(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return {}; }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (v.length >= 2 && v[0] === v.at(-1) && `"'`.includes(v[0])) v = v.slice(1, -1);
    if (k) out[k] = v;
  }
  return out;
}

// Omni's settings.json allows whole-line // comments.
export function readJsonLoose(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, ""));
}

// Read on every tick by the life, economy and work loops: parse only when the
// file changed.
let appCfg = { mtime: -1, value: {} };
export function loadAppConfig() {
  const file = path.join(APP_ROOT, "omniverse.config.json");
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return {}; }
  if (mtime !== appCfg.mtime) {
    try { appCfg = { mtime, value: readJsonLoose(file) }; } catch { return appCfg.value; }
  }
  return appCfg.value;
}

export const localEnv = () => parseEnvFile(path.join(APP_ROOT, ".env"));
