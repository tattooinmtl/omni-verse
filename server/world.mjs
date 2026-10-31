// Turns projects on disk into city data: project → building, top-level folder
// → floor (root files are the lobby), file → room. Secret files never appear.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { HOME, expandHome, loadAppConfig } from "./config.mjs";
import { SECRET_DIR, SECRET_FILE } from "./security.mjs";
import { workConfig } from "./settings.mjs";

const IGNORE = new Set([
  "node_modules", ".git", ".venv", "venv", "dist", "build", "target", "__pycache__", ".pytest_cache", ".next",
  ".cache", "image-cache", "logs", "sessions", "checkpoints", "backups", ".idea", ".vs", "obj", "coverage",
  ".turbo", ".parcel-cache", "worktrees", ".playwright-mcp", "rag",
]);
const MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "requirements.txt", "CMakeLists.txt",
  "pom.xml", "build.gradle", "composer.json", "Gemfile", "setup.py", "project.godot", "Makefile", "README.md"];
const HOME_SKIP = /^(AppData|Application Data|Local Settings|OneDrive|Pictures|Music|Videos|Movies|Documents|Mes documents|Downloads|Desktop|Contacts|Cookies|Favorites|Links|Recent|Saved Games|Searches|SendTo|Modèles|Menu Démarrer|Voisinage.*|node_modules|MySQL|go|bin|logs|Claude)$/i;

const DEFAULTS = {
  coreProjects: ["~/.omni", "~/.omnibots", "~/.omnicode", "~/.omnione", "~/.omni-mini", "~/.omni-harness", "~/.omni-verse"],
  scanDirs: ["~", "~/dev", "~/source", "~/AIWorkspace"],
  exclude: ["backup", "~"],
  maxBuildings: 40,
  maxFilesPerProject: 2500,
  maxFloors: 20,
  maxRoomsPerFloor: 30,
};

async function isProject(dir) {
  for (const m of MARKERS) if (fs.existsSync(path.join(dir, m))) return true;
  try { return (await fsp.readdir(dir)).some((n) => n.endsWith(".sln")); } catch { return false; }
}

async function discover(cfg) {
  const seen = new Set();
  const found = [];
  const excluded = (name) => cfg.exclude.some((x) => x && name.toLowerCase().includes(x.toLowerCase()));
  const add = (dir, district) => {
    let real;
    try { real = fs.realpathSync(dir); } catch { return; }
    const key = real.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ root: real, name: path.basename(real), district });
  };
  for (const p of cfg.coreProjects) {
    const dir = expandHome(p);
    if (fs.existsSync(dir)) add(dir, "Omni Core");
  }
  // Projects the agents were hired to start from scratch come right after the
  // core, so maxBuildings never pushes a fresh job's tower out of the city.
  for (const d of [...(cfg.workDir ? [cfg.workDir] : []), ...cfg.scanDirs]) {
    const dir = expandHome(d);
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    const district = d === cfg.workDir ? "Work District" : path.resolve(dir) === path.resolve(HOME) ? "Home Sector" : `${path.basename(dir)} District`;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || HOME_SKIP.test(e.name) || excluded(e.name)) continue;
      const full = path.join(dir, e.name);
      if (await isProject(full)) add(full, district);
    }
  }
  return found.slice(0, cfg.maxBuildings);
}

async function scanProject(root, cfg) {
  const rootFiles = [];
  const dirs = new Map();
  const exts = {};
  let count = 0;
  let last = 0;
  const queue = [{ dir: root, rel: "", top: null, depth: 0 }];
  // Breadth-first so one huge folder can't eat the whole file budget.
  while (queue.length && count < cfg.maxFilesPerProject) {
    const { dir, rel, top, depth } = queue.shift();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (count >= cfg.maxFilesPerProject) break;
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (IGNORE.has(e.name) || SECRET_DIR.has(e.name) || depth >= 7) continue;
        const t = top ?? e.name;
        if (!dirs.has(t)) dirs.set(t, []);
        queue.push({ dir: path.join(dir, e.name), rel: r, top: t, depth: depth + 1 });
      } else if (e.isFile() && !SECRET_FILE.test(e.name)) {
        let st;
        try { st = await fsp.stat(path.join(dir, e.name)); } catch { continue; }
        count++;
        last = Math.max(last, st.mtimeMs);
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (ext) exts[ext] = (exts[ext] || 0) + 1;
        (top ? dirs.get(top) : rootFiles).push({ p: r, n: e.name, s: st.size, m: Math.round(st.mtimeMs) });
      }
    }
  }
  const floor = (name, files) => {
    files.sort((a, b) => b.m - a.m);
    return { name, total: files.length, last: files[0]?.m || 0, rooms: files.slice(0, cfg.maxRoomsPerFloor) };
  };
  const dirFloors = [...dirs]
    .filter(([, f]) => f.length)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, cfg.maxFloors - 1)
    .map(([n, f]) => floor(`${n}/`, f));
  return {
    files: count,
    truncated: count >= cfg.maxFilesPerProject,
    last: Math.round(last),
    langs: Object.entries(exts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e]) => e),
    floors: [floor("lobby", rootFiles), ...dirFloors],
  };
}

let cache = null;
let pending = null;

export async function getWorld(refresh = false) {
  if (cache && !refresh) return cache;
  if (pending) return pending;
  pending = (async () => {
    const cfg = { ...DEFAULTS, ...loadAppConfig().world, workDir: workConfig().newProjectsDir };
    const projects = await discover(cfg);
    const buildings = [];
    for (const [i, p] of projects.entries()) {
      const scan = await scanProject(p.root, cfg);
      if (!scan.files) continue;
      buildings.push({ id: `b${i}`, name: p.name, district: p.district, root: p.root, ...scan });
    }
    // Core district first, then each district from most recently active down.
    buildings.sort((a, b) => (a.district === "Omni Core" ? 0 : 1) - (b.district === "Omni Core" ? 0 : 1)
      || a.district.localeCompare(b.district) || b.last - a.last);
    cache = { scannedAt: Date.now(), buildings };
    return cache;
  })();
  try { return await pending; } finally { pending = null; }
}

export function buildingRoot(id) {
  return cache?.buildings.find((b) => b.id === id)?.root || null;
}
