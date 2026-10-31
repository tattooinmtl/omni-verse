// Serves the website folder for local preview: `npm run site`.
// The site is plain static files, so any host (GitHub Pages, Netlify…) works too.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SITE_PORT || 4800);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(ROOT, rel.endsWith("/") ? rel + "index.html" : rel);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" }).end(buf);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`Omniverse website → http://localhost:${PORT}`));
