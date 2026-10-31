import { RESIDENTS } from "./residents.js";
import { createCity } from "./city.js";
import { createForge } from "./forge.js";
import { createNeural } from "./neural.js";

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const lite = matchMedia("(max-width: 700px)").matches || (navigator.hardwareConcurrency || 8) <= 4;
const $ = (s) => document.querySelector(s);

// ── scroll → where the camera is ───────────────────────────────────────
// x is a fractional section index: 0 while the hero fills the screen, 1 when
// the skyline section is centred, and so on.
const scenes = [...document.querySelectorAll(".scene")];
function scrollIndex() {
  const mid = window.scrollY + window.innerHeight / 2;
  const centres = scenes.map((s) => s.offsetTop + s.offsetHeight / 2);
  centres[0] = Math.min(centres[0], window.innerHeight / 2); // the top of the page is the hero
  if (mid <= centres[0]) return 0;
  for (let i = 0; i < centres.length - 1; i++) {
    if (mid <= centres[i + 1]) return i + (mid - centres[i]) / (centres[i + 1] - centres[i]);
  }
  return centres.length - 1;
}
// How far through a section's own height the viewport centre is (0..1).
function within(el) {
  const r = el.getBoundingClientRect();
  return Math.min(1, Math.max(0, (window.innerHeight / 2 - r.top) / r.height));
}

// ── rail, HUD, nav ─────────────────────────────────────────────────────
const ticks = $(".rail-ticks"), fill = $(".rail-fill");
scenes.forEach((s, i) => {
  const li = document.createElement("li");
  li.style.top = `${(i / (scenes.length - 1)) * 100}%`;
  ticks.append(li);
});
const hudSector = $(".hud-sector"), hudAlt = $(".hud-alt"), hudLabel = $(".hud-label");
const navLinks = [...document.querySelectorAll(".top nav a")];
let lastSector = -1;
function hud(x, alt) {
  const sector = Math.round(x);
  fill.style.height = `${(x / (scenes.length - 1)) * 100}%`;
  hudAlt.textContent = `ALT ${String(Math.max(0, Math.round(alt))).padStart(3, "0")} m`;
  if (sector === lastSector) return;
  lastSector = sector;
  [...ticks.children].forEach((li, i) => li.classList.toggle("on", i <= sector));
  hudSector.textContent = `SECTOR ${String(sector + 1).padStart(2, "0")}`;
  hudLabel.textContent = scenes[sector].dataset.label;
  const id = scenes[sector].id;
  navLinks.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === `#${id}`));
}

// Panels slide in once they come into view.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}, { threshold: 0.15 });
document.querySelectorAll(".panel").forEach((p) => io.observe(p));

// ── the three views ────────────────────────────────────────────────────
let city = null;
try {
  city = createCity($("#city"), RESIDENTS, { lite, still });
} catch (err) {
  // No WebGL: the page still reads fine over the dark background.
  console.warn("Omniverse: 3D city unavailable:", err);
  $("#city").remove();
}

const forge = createForge($("#forge"), RESIDENTS, {
  count: $(".forge-count"), name: $(".forge-name"), species: $(".forge-species"), motto: $(".forge-motto"),
  desc: $(".forge-desc"), model: $(".forge-model"), spec: $("#spec"),
}, { onSelect: (i) => city?.showAtGate(i), still });
$(".forge-nav.next").addEventListener("click", () => forge.next());
$(".forge-nav.prev").addEventListener("click", () => forge.prev());
const specBtn = $("#spec-toggle");
specBtn.addEventListener("click", () => {
  const open = $("#spec").hidden;
  $("#spec").hidden = !open;
  specBtn.setAttribute("aria-expanded", String(open));
  specBtn.textContent = open ? "Hide the JSON" : "View the JSON it wrote";
});

const neural = createNeural($("#neuralmap"), $(".neural-tip"), RESIDENTS.map((r) => r.spec.name), { still });

// Small views only draw while they're on screen.
const onScreen = new Map();
const vis = new IntersectionObserver((entries) => { for (const e of entries) onScreen.set(e.target, e.isIntersecting); });
vis.observe($("#forge")); vis.observe($("#neuralmap"));

// ── visit counter and account link (need the site's PHP API; quietly absent on `npm run site`) ──
const pad = (n, w) => String(n).padStart(w, "0");
function rollTo(el, n, w) {
  if (still) { el.textContent = pad(n, w); return; }
  const t0 = performance.now(), from = Math.max(0, n - 120);
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 1400);
    el.textContent = pad(Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3))), w);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
fetch("/api/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: location.pathname, ref: document.referrer }) })
  .then((r) => (r.ok ? r.json() : null))
  .then((s) => {
    if (!s?.ok) return;
    $("#counter").hidden = false;
    rollTo($("#c-visits"), s.visits, 6);
    rollTo($("#c-visitors"), s.visitors, 6);
    rollTo($("#c-today"), s.today, 3);
  })
  .catch(() => {});
fetch("/api/session").then((r) => (r.ok ? r.json() : null)).then((s) => {
  if (!s?.user) return;
  const a = $("#nav-account");
  a.textContent = s.user.name;
  a.href = "/account.php";
}).catch(() => {});

// ── loop ───────────────────────────────────────────────────────────────
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
if (!still) window.addEventListener("pointermove", (e) => { pointer.tx = (e.clientX / innerWidth) * 2 - 1; pointer.ty = (e.clientY / innerHeight) * 2 - 1; });
let x = scrollIndex(), lastT = performance.now();
function loop(now) {
  // Easing by elapsed time, not per frame, so a slow device doesn't trail the scroll.
  const dt = Math.min(0.5, (now - lastT) / 1000);
  lastT = now;
  const target = scrollIndex();
  x += still ? target - x : (target - x) * (1 - Math.exp(-dt * 5));
  pointer.x += (pointer.tx - pointer.x) * (1 - Math.exp(-dt * 3));
  pointer.y += (pointer.ty - pointer.y) * (1 - Math.exp(-dt * 3));
  const alt = city ? city.frame({ x, build: within($("#towers")) * 1.25, life: within($("#life")) * 1.3, px: pointer.x, py: -pointer.y }) : 0;
  hud(x, alt);
  if (onScreen.get($("#forge"))) forge.frame();
  if (onScreen.get($("#neuralmap"))) neural.frame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
