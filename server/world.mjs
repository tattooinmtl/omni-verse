// Turns projects on disk into city data: project → building, top-level folder
// → floor (root files are the lobby), file → room. Secret files never appear.
//
// Which projects: the ones the user picked in Settings → Projects
// (`world.projects` in omniverse.config.json). Until they pick, the city is
// built from their most recently changed projects, so it is never empty, and
// the picker opens on first run. Projects agents were hired to start
// (work.newProjectsDir) always get a tower too.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { HOME, expandHome, loadAppConfig } from "./config.mjs";
import { SECRET_DIR, isSecretFile, isSecretPath } from "./security.mjs";
import { workConfig } from "./settings.mjs";

const IGNORE = new Set([
  "node_modules", ".git", ".venv", "venv", "dist", "build", "target", "__pycache__", ".pytest_cache", ".next",
  ".cache", "image-cache", "logs", "sessions", "checkpoints", "backups", ".idea", ".vs", "obj", "coverage",
  ".turbo", ".parcel-cache", "worktrees", ".playwright-mcp", "rag",
]);
const MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "requirements.txt", "CMakeLists.txt",
  "pom.xml", "build.gradle", "composer.json", "Gemfile", "setup.py", "project.godot", "Makefile", "README.md"];
const HOME_SKIP = /^(AppData|Application Data|Local Settings|OneDrive|Pictures|Music|Videos|Movies|Documents|Mes documents|Downloads|Desktop|Contacts|Cookies|Favorites|Links|Recent|Saved Games|Searches|SendTo|Modèles|Menu Démarrer|Voisinage.*|node_modules|MySQL|go|bin|logs|Claude)$/i;

// Where projects usually live; folders that don't exist are skipped. Each is
// searched two levels deep, so ~/projects/my-app and ~/clients/acme/site count.
const SCAN_DIRS = ["~", "~/dev", "~/source", "~/src", "~/code", "~/projects", "~/Projects", "~/repos", "~/git", "~/workspace",
  "~/Documents/GitHub", "~/Documents/Projects", "~/Documents/Code", "~/Documents/dev", "~/OneDrive/Documents/GitHub", "~/Desktop"];
export const MAX_PROJECTS = 300; // buildings in one city

// Other drives (D:, E:…) on Windows: their top-level folders, two levels deep
// like the rest. System folders are skipped.
const DRIVE_SKIP = /^(\$.*|Windows|Program Files.*|ProgramData|Users|Recovery|PerfLogs|System Volume Information|Intel|AMD|NVIDIA|MSOCache|OneDriveTemp|Config\.Msi|XboxGames|Drivers|inetpub|SteamLibrary|Games?)$/i;
function driveRoots() {
  if (process.platform !== "win32") return [];
  return "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`).filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}
// A whole drive or the home folder is never one building.
const tooBroad = (dir) => path.parse(dir).root === path.resolve(dir) || path.resolve(dir).toLowerCase() === path.resolve(HOME).toLowerCase();
const DEFAULTS = {
  coreProjects: [],     // always in the city when nothing is picked yet (shown as "Omni Core")
  scanDirs: [],         // extra places to look, on top of SCAN_DIRS
  exclude: ["backup"],
  maxBuildings: 40,     // how many recent projects to show before the user picks
  maxFilesPerProject: 2500,
  maxFloors: 20,
  maxRoomsPerFloor: 30,
};
const worldConfig = () => ({ ...DEFAULTS, ...loadAppConfig().world, workDir: workConfig().newProjectsDir });

// The project's kind (its first marker), or null if the folder isn't a project.
async function projectKind(dir) {
  for (const m of MARKERS) if (fs.existsSync(path.join(dir, m))) return m;
  try { return (await fsp.readdir(dir)).some((n) => n.endsWith(".sln")) ? ".sln" : null; } catch { return null; }
}
const KIND_LABEL = { ".git": "git", "package.json": "node", "pyproject.toml": "python", "requirements.txt": "python", "setup.py": "python",
  "Cargo.toml": "rust", "go.mod": "go", "CMakeLists.txt": "c/c++", "pom.xml": "java", "build.gradle": "java", "composer.json": "php",
  "Gemfile": "ruby", "project.godot": "godot", "Makefile": "make", "README.md": "docs", ".sln": ".net" };

// When a project last changed: the folder itself, or git's index (touched on
// every commit and stage), whichever is newer. Cheap: two stats.
function lastChange(dir) {
  let t = 0;
  for (const f of [dir, path.join(dir, ".git", "index"), path.join(dir, "package.json")]) {
    try { t = Math.max(t, fs.statSync(f).mtimeMs); } catch { /* not there */ }
  }
  return Math.round(t);
}
const realKey = (dir) => { try { const r = fs.realpathSync(dir); return { real: r, key: r.toLowerCase() }; } catch { return null; } };
const districtFor = (dir, cfg) => {
  const parent = path.dirname(dir);
  if (cfg.coreProjects.some((p) => realKey(expandHome(p))?.key === dir.toLowerCase())) return "Omni Core";
  if (cfg.workDir && path.resolve(parent) === path.resolve(expandHome(cfg.workDir))) return "Work District";
  if (path.resolve(parent) === path.resolve(HOME)) return "Home Sector";
  if (path.parse(parent).root === parent) return `${parent.replace(/[\\/]+$/, "")} Drive`; // D:\my-app → "D: Drive"
  return `${path.basename(parent)} District`;
};

// Every project on this computer the picker can offer, newest first.
export async function findProjects() {
  const cfg = worldConfig();
  const seen = new Set(), found = [];
  const excluded = (name) => cfg.exclude.some((x) => x && name.toLowerCase().includes(String(x).toLowerCase()));
  const add = async (dir, kind) => {
    const r = realKey(dir);
    if (!r || seen.has(r.key) || isSecretPath(r.real) || tooBroad(r.real)) return;
    seen.add(r.key);
    found.push({ root: r.real, name: path.basename(r.real), district: districtFor(r.real, cfg), kind: KIND_LABEL[kind] || "project", last: lastChange(r.real) });
  };
  for (const p of cfg.coreProjects) {
    const dir = expandHome(p), kind = fs.existsSync(dir) && (await projectKind(dir));
    if (kind) await add(dir, kind);
  }
  const drives = new Set(driveRoots().map((d) => path.resolve(d)));
  const roots = [...new Set([...(cfg.workDir ? [cfg.workDir] : []), ...SCAN_DIRS, ...cfg.scanDirs, ...drives].map((d) => path.resolve(expandHome(d))))];
  for (const base of roots) {
    let entries;
    try { entries = await fsp.readdir(base, { withFileTypes: true }); } catch { continue; }
    const atHome = base === path.resolve(HOME), atDrive = drives.has(base);
    for (const e of entries) {
      if (found.length >= 2000) break;
      if (!e.isDirectory() || e.name.startsWith(".") || IGNORE.has(e.name) || excluded(e.name) || (atHome && HOME_SKIP.test(e.name)) || (atDrive && DRIVE_SKIP.test(e.name))) continue;
      const full = path.join(base, e.name);
      const kind = await projectKind(full);
      if (kind) { await add(full, kind); continue; }
      // Not a project itself: a folder of projects? Look one level down.
      let inner;
      try { inner = await fsp.readdir(full, { withFileTypes: true }); } catch { continue; }
      for (const f of inner) {
        if (!f.isDirectory() || f.name.startsWith(".") || IGNORE.has(f.name) || excluded(f.name)) continue;
        const sub = path.join(full, f.name), k = await projectKind(sub);
        if (k) await add(sub, k);
      }
    }
  }
  return found.sort((a, b) => b.last - a.last);
}

// A folder the user typed in the picker: the project itself, or the projects inside it.
export async function inspectFolder(p) {
  const dir = path.resolve(expandHome(String(p || "").trim()));
  let st;
  try { st = fs.statSync(dir); } catch { throw Object.assign(new Error("That folder doesn't exist."), { status: 404 }); }
  if (!st.isDirectory()) throw Object.assign(new Error("That's a file, not a folder."), { status: 400 });
  if (isSecretPath(dir)) throw Object.assign(new Error("That folder holds secrets and can't become a building."), { status: 400 });
  const cfg = worldConfig();
  const kind = await projectKind(dir);
  const entry = (d, k) => ({ root: d, name: path.basename(d), district: districtFor(d, cfg), kind: KIND_LABEL[k] || "project", last: lastChange(d) });
  if (kind) return { folder: dir, projects: [entry(dir, kind)] };
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".") || IGNORE.has(e.name)) continue;
    const k = await projectKind(path.join(dir, e.name));
    if (k) out.push(entry(path.join(dir, e.name), k));
  }
  // No project markers anywhere: let the folder itself be the building,
  // unless it's a whole drive or the home folder.
  if (!out.length && tooBroad(dir)) throw Object.assign(new Error("No projects found in there, and a whole drive or home folder can't be one building."), { status: 400 });
  return { folder: dir, projects: out.length ? out : [entry(dir, null)] };
}

// The projects that become buildings.
async function chooseProjects(cfg) {
  const picked = Array.isArray(cfg.projects) ? cfg.projects : null;
  const list = [];
  const seen = new Set();
  const add = (dir, district) => {
    const r = realKey(expandHome(dir));
    if (!r || seen.has(r.key) || tooBroad(r.real) || isSecretPath(r.real)) return;
    try { if (!fs.statSync(r.real).isDirectory()) return; } catch { return; }
    seen.add(r.key);
    list.push({ root: r.real, name: path.basename(r.real), district: district || districtFor(r.real, cfg) });
  };
  if (picked) for (const p of picked.slice(0, MAX_PROJECTS)) add(p);
  else {
    // Nothing picked yet: the core projects, then the most recently changed.
    const found = await findProjects();
    for (const p of found.filter((f) => f.district === "Omni Core")) add(p.root, "Omni Core");
    for (const p of found) { if (list.length >= cfg.maxBuildings) break; add(p.root, p.district); }
  }
  // Projects agents were hired to start always get a tower.
  const work = cfg.workDir && path.resolve(expandHome(cfg.workDir));
  if (work) {
    try {
      for (const e of await fsp.readdir(work, { withFileTypes: true })) if (e.isDirectory()) add(path.join(work, e.name), "Work District");
    } catch { /* no work folder yet */ }
  }
  return { list, picked: Boolean(picked) };
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
    const files = [];
    for (const e of entries) {
      if (count + files.length >= cfg.maxFilesPerProject) break;
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (IGNORE.has(e.name) || SECRET_DIR.has(e.name) || depth >= 7) continue;
        const t = top ?? e.name;
        if (!dirs.has(t)) dirs.set(t, []);
        queue.push({ dir: path.join(dir, e.name), rel: r, top: t, depth: depth + 1 });
      } else if (e.isFile() && !isSecretFile(e.name)) {
        files.push({ e, r });
      }
    }
    // One folder's files are stat'ed together, not one after another.
    const stats = await Promise.all(files.slice(0, cfg.maxFilesPerProject - count).map(({ e }) => fsp.stat(path.join(dir, e.name)).catch(() => null)));
    stats.forEach((st, i) => {
      if (!st) return;
      const { e, r } = files[i];
      count++;
      last = Math.max(last, st.mtimeMs);
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (ext) exts[ext] = (exts[ext] || 0) + 1;
      (top ? dirs.get(top) : rootFiles).push({ p: r, n: e.name, s: st.size, m: Math.round(st.mtimeMs) });
    });
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
    const cfg = worldConfig();
    const { list: projects, picked } = await chooseProjects(cfg);
    // Six projects at a time: a hundred towers scan in seconds, not minutes.
    const scans = new Array(projects.length);
    let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < projects.length) { const i = next++; scans[i] = await scanProject(projects[i].root, cfg).catch(() => null); }
    }));
    const buildings = [];
    for (const [i, p] of projects.entries()) {
      const scan = scans[i];
      if (!scan || (!scan.files && !picked)) continue; // an empty folder the user picked still gets a (lobby-only) tower
      buildings.push({ id: `b${i}`, name: p.name, district: p.district, root: p.root, ...scan });
    }
    // Core district first, then each district from most recently active down.
    buildings.sort((a, b) => (a.district === "Omni Core" ? 0 : 1) - (b.district === "Omni Core" ? 0 : 1)
      || a.district.localeCompare(b.district) || b.last - a.last);
    cache = { scannedAt: Date.now(), chosen: picked, buildings };
    return cache;
  })();
  try { return await pending; } finally { pending = null; }
}

export function buildingRoot(id) {
  return cache?.buildings.find((b) => b.id === id)?.root || null;
}
