// Preloaded into every sandboxed script (server/sandbox.mjs): Node's
// permission model already walls off the file system, child processes,
// workers and addons; this closes the network, which it leaves open.
import { registerHooks } from "node:module";
import Module from "node:module";

const DENY = /^(node:)?(net|tls|http|https|http2|dgram|dns|dns\/promises|undici|inspector|inspector\/promises|cluster|child_process|worker_threads|vm|v8|module|wasi|repl|diagnostics_channel)$/;
const refuse = (what) => { const e = new Error(`the sandbox has no network or process access (${what})`); e.code = "ERR_SANDBOX"; throw e; };

registerHooks({
  resolve(specifier, context, next) {
    if (DENY.test(specifier)) refuse(specifier);
    return next(specifier, context);
  },
});
const load = Module._load;
Module._load = function (request, ...rest) {
  if (DENY.test(request)) refuse(request);
  return load.call(this, request, ...rest);
};
for (const k of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest", "navigator"]) {
  try { Object.defineProperty(globalThis, k, { get: () => refuse(k), configurable: false }); } catch { /* not present */ }
}
for (const k of ["binding", "_linkedBinding", "dlopen"]) {
  try { Object.defineProperty(process, k, { get: () => refuse(`process.${k}`), configurable: false }); } catch { /* frozen */ }
}
Object.freeze(Module);
