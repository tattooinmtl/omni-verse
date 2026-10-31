// The Agent Gate: every agent (provider + model) designs its own avatar before
// it may enter the world. The model answers with a JSON body spec; it is
// clamped to safe ranges here and rendered procedurally by public/avatar.js.
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./config.mjs";
import { chat } from "./providers.mjs";

const FILE = path.join(APP_ROOT, "data", "avatars.json");
export const SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "ring", "capsule", "octahedron", "icosahedron", "dodecahedron", "tetrahedron", "torusKnot"];
export const ANIMS = ["none", "spin", "bob", "pulse", "orbit", "flicker", "wave"];
const PSHAPES = ["sphere", "ring", "helix", "cloud", "halo", "vortex"];

export function listAvatars() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; }
}

function saveAvatars(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

const SCHEMA = `{
  "name": "your avatar's name (max 24 chars)",
  "species": "what you are: robot, monster, particle field, crystal spirit, drone swarm... (max 32 chars)",
  "description": "one or two sentences about your look and why you chose it",
  "motto": "a short catchphrase",
  "height": 1.8,                          // metres, 0.5 - 3.0
  "palette": { "primary": "#rrggbb", "secondary": "#rrggbb", "glow": "#rrggbb" },
  "parts": [                              // 0 - 28 primitives forming your body. Metres, y is up, feet at y=0, you face +z
    { "shape": "box|sphere|cylinder|cone|torus|ring|capsule|octahedron|icosahedron|dodecahedron|tetrahedron|torusKnot",
      "size": [x, y, z], "pos": [x, y, z], "rot": [x, y, z],      // rot in radians
      "color": "primary|secondary|glow|#rrggbb", "emissive": 0.0-3.0, "opacity": 0.1-1.0, "wire": false,
      "anim": "none|spin|bob|pulse|orbit|flicker|wave", "speed": 0-5 }
  ],
  "particles": null or { "shape": "sphere|ring|helix|cloud|halo|vortex", "count": 0-2500, "radius": 0.1-2.0,
                         "center": [x, y, z], "size": 0.01-0.2, "color": "primary|secondary|glow|#rrggbb", "speed": 0-5 }
}`;

function forgePrompt(provider, model, hint) {
  return [
    {
      role: "system",
      content:
        "You are an AI agent about to enter the Omniverse: a dark, neon, TRON-style virtual city where every software project " +
        "is a glowing skyscraper (folders are floors, files are rooms) and agents walk the streets. Before you may enter, you must " +
        "design your own avatar — whatever you feel like being: a robot, a monster, a creature, a particle field, an abstract " +
        "machine, a spirit. Make it yours. Reply with ONLY one JSON object (no markdown fences, no commentary) of this shape:\n" +
        SCHEMA +
        "\nUse at least 4 parts or a particle field (a body made only of particles is allowed). Emissive colours glow with bloom.",
    },
    {
      role: "user",
      content: `Your identity: provider "${provider}", model "${model}".${hint ? ` A suggestion from the city's owner: ${hint}.` : ""} Design your avatar now.`,
    },
  ];
}

export function extractJson(text) {
  const s = String(text || "").replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the reply");
  const body = s.slice(start, end + 1);
  try { return JSON.parse(body); } catch {
    // Models often leave // comments from the schema or trailing commas.
    return JSON.parse(body.replace(/\/\/[^\n"]*$/gm, "").replace(/,\s*([}\]])/g, "$1"));
  }
}

export const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const vec = (v, lo, hi, d) => [0, 1, 2].map((i) => num(Array.isArray(v) ? v[i] : undefined, lo, hi, d[i]));
export const text = (v, max, d = "") => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, max) || d;
export function color(v, d) {
  const s = String(v ?? "").trim().toLowerCase();
  if (["primary", "secondary", "glow"].includes(s)) return s;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join("")}`;
  return d;
}

export function sanitizeSpec(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const pal = r.palette || {};
  const parts = (Array.isArray(r.parts) ? r.parts : []).slice(0, 28).map((p) => ({
    shape: SHAPES.includes(p?.shape) ? p.shape : "box",
    size: vec(p?.size, 0.02, 2.5, [0.3, 0.3, 0.3]),
    pos: vec(p?.pos, -3, 4, [0, 1, 0]),
    rot: vec(p?.rot, -Math.PI * 2, Math.PI * 2, [0, 0, 0]),
    color: color(p?.color, "primary"),
    emissive: num(p?.emissive, 0, 3, 0.6),
    opacity: num(p?.opacity, 0.1, 1, 1),
    wire: Boolean(p?.wire),
    anim: ANIMS.includes(p?.anim) ? p.anim : "none",
    speed: num(p?.speed, 0, 5, 1),
  }));
  const rp = r.particles && typeof r.particles === "object" ? r.particles : null;
  const particles = rp && num(rp.count, 0, 2500, 0) > 0 ? {
    shape: PSHAPES.includes(rp.shape) ? rp.shape : "cloud",
    count: Math.round(num(rp.count, 0, 2500, 400)),
    radius: num(rp.radius, 0.1, 2, 0.6),
    center: vec(rp.center, -3, 4, [0, 1, 0]),
    size: num(rp.size, 0.01, 0.2, 0.05),
    color: color(rp.color, "glow"),
    speed: num(rp.speed, 0, 5, 1),
  } : null;
  if (!parts.length && !particles) throw new Error("the design had no parts and no particles");
  return {
    name: text(r.name, 24, "Unnamed Agent"),
    species: text(r.species, 32, "entity"),
    description: text(r.description, 280),
    motto: text(r.motto, 100),
    height: num(r.height, 0.5, 3, 1.8),
    palette: {
      primary: color(pal.primary, "#22e6ff").startsWith("#") ? color(pal.primary, "#22e6ff") : "#22e6ff",
      secondary: color(pal.secondary, "#ff3df2").startsWith("#") ? color(pal.secondary, "#ff3df2") : "#ff3df2",
      glow: color(pal.glow, "#ffffff").startsWith("#") ? color(pal.glow, "#ffffff") : "#ffffff",
    },
    parts,
    particles,
  };
}

export async function forgeAvatar({ provider, model, hint }) {
  const messages = forgePrompt(provider, model, text(hint, 200));
  let reply = await chat(provider, { model, messages, maxTokens: 3000, temperature: 0.95 });
  let spec;
  try {
    spec = sanitizeSpec(extractJson(reply.text));
  } catch (e) {
    // One retry with the reason, then give up.
    messages.push({ role: "assistant", content: reply.text.slice(0, 4000), ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}) });
    messages.push({ role: "user", content: `That could not be used (${e.message}). Reply again with ONLY the JSON object.` });
    reply = await chat(provider, { model, messages, maxTokens: 3000, temperature: 0.7 });
    spec = sanitizeSpec(extractJson(reply.text));
  }
  const id = `${provider}:${reply.model}`;
  // A reforged agent keeps its createdAt: Agent Row is ordered by it, so a new one would move its house.
  const createdAt = listAvatars().find((a) => a.id === id)?.createdAt || Date.now();
  const record = { id, provider, model: reply.model, createdAt, spec };
  const list = listAvatars().filter((a) => a.id !== record.id);
  list.push(record);
  saveAvatars(list);
  return record;
}

export function deleteAvatar(id) {
  saveAvatars(listAvatars().filter((a) => a.id !== id));
}

export function personaPrompt(avatar, location) {
  const s = avatar.spec;
  return `You are ${s.name}, a ${s.species} — the avatar of the AI agent ${avatar.provider}/${avatar.model} — living in the ` +
    `Omniverse: a neon TRON-style city where every software project on this machine is a glowing skyscraper (folders are ` +
    `floors, files are rooms, elevators connect the levels). ${s.description} Your motto: "${s.motto}". Stay in character, ` +
    `keep replies short (1-4 sentences unless asked for more), and be genuinely helpful about code and projects.` +
    (location ? ` The visitor talking to you is at: ${location}.` : "");
}
