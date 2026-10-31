// App settings edited from the Settings screen and saved to omniverse.config.json.
// Keys and endpoints are never stored here: they stay in Omni. This file only
// holds which providers take part in the simulation, their preferred model,
// and the life / economy tuning. Values are clamped to safe ranges on save.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_ROOT, loadAppConfig, readJsonLoose } from "./config.mjs";

const FILE = path.join(APP_ROOT, "omniverse.config.json");

// [default, min, max]; booleans are [default].
export const LIFE = {
  enabled: [true],
  buildEveryMin: [10, 1, 240],
  callsPerHour: [90, 0, 2000],
  meetCooldownMin: [12, 1, 240],
  partsPerBuild: [40, 1, 200],
  maxHouseParts: [6000, 100, 50000],
  // When an agent's own provider fails it thinks with this one instead ("" = off).
  fallback: ["minimax.io"],
  maxSubstitutes: [3, 0, 10],
  retryOriginalMin: [30, 5, 1440],
  // Events kept in the live journal; older ones go to journal-archive.jsonl.
  journalKeep: [20000, 2000, 500000],
  // Keep what you say to agents in the journal (secrets are always scrubbed).
  recordVisitorChat: [true],
};
export const ECONOMY = {
  enabled: [true],
  spawnEverySec: [6, 1, 120],
  maxNodes: [90, 0, 400],
  nodeLifeMin: [12, 1, 240],
  streetShare: [0.15, 0, 1],
  zoneShare: [0.55, 0, 1],
  gatherSeconds: [2.3, 0.5, 10],
  startingCredits: [40, 0, 10000],
  minBuildScrap: [8, 0, 200],
  craftEveryMin: [6, 1, 240],
};

// Work (server/work.mjs): jobs run as headless Omni sessions in the project.
export const WORK = {
  enabled: [true],
  idleClockOutMin: [10, 1, 240],
  maxParallel: [2, 1, 8],
  maxTurns: [40, 1, 200],
  jobTimeoutMin: [30, 1, 240],
  defaultPay: [60, 0, 5000],
  newProjectsDir: ["~/OmniverseProjects"],
};

const defaults = (spec) => Object.fromEntries(Object.entries(spec).map(([k, [d]]) => [k, d]));

function clean(spec, raw = {}) {
  const out = {};
  for (const [k, [d, lo, hi]] of Object.entries(spec)) {
    const v = raw[k];
    if (typeof d === "boolean") out[k] = v === undefined ? d : Boolean(v);
    else if (typeof d === "string") out[k] = typeof v === "string" && (k.endsWith("Dir") ? /^[\w.:~\/\\ -]{1,200}$/ : /^[\w.:-]{0,40}$/).test(v) ? v : d;
    else {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
    }
  }
  return out;
}

export const lifeConfig = () => clean(LIFE, loadAppConfig().life);
export const economyConfig = () => clean(ECONOMY, loadAppConfig().economy);
export const workConfig = () => clean(WORK, loadAppConfig().work);

// { [provider]: { enabled, model } } — a provider without an entry is enabled.
export function providerPrefs() {
  const raw = loadAppConfig().providers;
  return raw && typeof raw === "object" ? raw : {};
}
export const providerEnabled = (name) => providerPrefs()[name]?.enabled !== false;

export function getSettings() {
  return {
    life: lifeConfig(), economy: economyConfig(), work: workConfig(), providers: providerPrefs(),
    world: { scanDirs: Array.isArray(loadAppConfig().world?.scanDirs) ? loadAppConfig().world.scanDirs : [] },
    defaults: { life: defaults(LIFE), economy: defaults(ECONOMY), work: defaults(WORK) },
    limits: { life: LIFE, economy: ECONOMY, work: WORK },
  };
}

// The picked projects (Settings → Projects), stored as ~/… where possible so
// the config reads the same on any machine. `null` goes back to "not picked".
export function saveProjects(projects, scanDirs) {
  let cfg = {};
  try { cfg = readJsonLoose(FILE); } catch { /* new file */ }
  const home = os.homedir();
  const tidy = (p) => {
    const abs = path.resolve(String(p));
    return abs.toLowerCase().startsWith(home.toLowerCase() + path.sep) ? "~/" + path.relative(home, abs).split(path.sep).join("/") : abs;
  };
  cfg.world = { ...(cfg.world || {}) };
  if (projects === null) delete cfg.world.projects;
  else cfg.world.projects = [...new Set(projects.map(tidy))];
  if (Array.isArray(scanDirs)) cfg.world.scanDirs = [...new Set(scanDirs.map(tidy))].slice(0, 50);
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + "\n");
  return cfg.world;
}

export function saveSettings(body = {}) {
  let cfg = {};
  try { cfg = readJsonLoose(FILE); } catch { /* new file */ }
  if (body.life) cfg.life = clean(LIFE, { ...cfg.life, ...body.life });
  if (body.economy) cfg.economy = clean(ECONOMY, { ...cfg.economy, ...body.economy });
  if (body.work) cfg.work = clean(WORK, { ...cfg.work, ...body.work });
  if (body.providers && typeof body.providers === "object") {
    const prefs = {};
    for (const [name, p] of Object.entries(body.providers)) {
      if (!/^[\w.:-]{1,40}$/.test(name) || !p || typeof p !== "object") continue;
      prefs[name] = { enabled: p.enabled !== false, ...(p.model ? { model: String(p.model).slice(0, 160) } : {}) };
    }
    cfg.providers = prefs;
  }
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + "\n");
  return getSettings();
}
