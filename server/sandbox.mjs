// The sandbox behind every computer block: a script handed over in a code
// block runs only here, as a Node process locked into one folder per agent
// (data/sandboxes/<agent>). Node's permission model refuses file access
// outside that folder, child processes, workers, addons and the inspector;
// sandbox/guard.mjs closes the network on top. The environment is empty, so
// no provider key can leak in, and time, memory and output are capped.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_ROOT } from "./config.mjs";

const ROOT = path.join(APP_ROOT, "data", "sandboxes");
const GUARD = path.join(APP_ROOT, "server", "sandbox", "guard.mjs");
const MAX_OUT = 64 * 1024;
const MAX_DISK = 50 * 1024 * 1024; // a sandbox folder over this is emptied before the next run

// One folder per agent, always directly under data/sandboxes ("..", dots and
// separators can't climb out).
export function sandboxDir(agentId) {
  const dir = path.resolve(ROOT, String(agentId).replace(/[^\w-]+/g, "_").slice(0, 80) || "_");
  if (path.dirname(dir) !== path.resolve(ROOT)) throw new Error("bad sandbox name");
  return dir;
}

function diskUse(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) try { total += fs.statSync(path.join(e.parentPath || e.path, e.name)).size; } catch { /* gone */ }
  }
  return total;
}

// limits: { seconds, memoryMb } — a Server Rack preset raises them.
export function runScript(agentId, name, code, { seconds = 10, memoryMb = 128 } = {}) {
  const dir = sandboxDir(agentId);
  fs.mkdirSync(dir, { recursive: true });
  // Files persist between runs (an agent's own scratch folder), within a quota.
  let wiped = false;
  if (diskUse(dir) > MAX_DISK) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); wiped = true; }
  const file = path.join(dir, `${String(name).replace(/[^\w.-]+/g, "_").replace(/\.(m?js|cjs)$/i, "").slice(0, 60) || "script"}.mjs`);
  fs.writeFileSync(file, String(code));
  const args = [
    "--permission",
    `--allow-fs-read=${dir}${path.sep}*`, `--allow-fs-read=${GUARD}`,
    `--allow-fs-write=${dir}${path.sep}*`,
    `--max-old-space-size=${memoryMb}`,
    "--disable-proto=throw",
    "--import", pathToFileURL(GUARD).href,
    file,
  ];
  // No keys and no host paths: home and temp are the sandbox itself, so
  // os.homedir() and os.tmpdir() don't reveal the user's name.
  const env = { PATH: "", SYSTEMROOT: process.env.SYSTEMROOT || "C:\\Windows", NODE_OPTIONS: "", USERPROFILE: dir, HOME: dir, TEMP: dir, TMP: dir, USERNAME: "sandbox" };
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(process.execPath, args, { cwd: dir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", cut = false, killed = false;
    const take = (b) => {
      if (out.length >= MAX_OUT) {
        // Past the cap the script is only filling a pipe: stop it now.
        if (!cut) { cut = true; p.kill("SIGKILL"); }
        return;
      }
      out += b.toString("utf8").slice(0, MAX_OUT - out.length);
    };
    p.stdout.on("data", take);
    p.stderr.on("data", take);
    const timer = setTimeout(() => { killed = true; p.kill("SIGKILL"); }, seconds * 1000);
    p.on("close", (code) => {
      clearTimeout(timer);
      // Paths inside the sandbox read better than the host's absolute path.
      const shown = out.split(dir).join("~sandbox").split(GUARD).join("guard");
      resolve({
        ok: code === 0 && !killed, exitCode: code, ms: Date.now() - started,
        output: (wiped ? "(the sandbox folder was over 50 MB and was emptied first)\n" : "") + shown
          + (cut ? "\n… output cut at 64 KB; the script was stopped" : "") + (killed ? `\n… stopped after ${seconds} s` : ""),
      });
    });
    p.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, exitCode: null, ms: 0, output: `the sandbox could not start: ${e.message}` }); });
  });
}
