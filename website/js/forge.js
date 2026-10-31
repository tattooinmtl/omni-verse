import * as THREE from "three";
import { buildAvatar } from "./avatar.js";

// The Residents viewer: one agent at a time on a lit pedestal, turned by drag,
// with the JSON it wrote shown on demand. onSelect tells the city which
// resident to project inside the Agent Gate.

export function createForge(canvas, residents, ui, { onSelect = () => {}, still = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 1.25, 5.4);
  camera.lookAt(0, 0.95, 0);
  scene.add(new THREE.AmbientLight(0x88aacc, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 4, 3);
  const rim = new THREE.DirectionalLight(0x22e6ff, 2);
  rim.position.set(-3, 2, -3);
  scene.add(key, rim);

  // Pedestal: a dark disc with a glowing ring that takes the resident's colour.
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.12, 48), new THREE.MeshStandardMaterial({ color: 0x041722, metalness: 0.7, roughness: 0.35 }));
  pedestal.position.y = -0.06;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x22e6ff });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.018, 8, 96), ringMat);
  ring.rotation.x = Math.PI / 2;
  scene.add(pedestal, ring);

  const holder = new THREE.Group();
  scene.add(holder);
  const cache = new Map();
  let i = 0, current = null, spin = 0, drag = null, vel = 0.4;

  function select(n) {
    i = (n + residents.length) % residents.length;
    const r = residents[i], s = r.spec, glow = s.palette.glow || s.palette.primary;
    if (!cache.has(i)) {
      const a = buildAvatar(s);
      a.scale.setScalar(1.9 / s.height); // every resident shown at the same size
      cache.set(i, a);
    }
    if (current) holder.remove(current);
    current = cache.get(i);
    holder.add(current);
    ringMat.color.set(glow).multiplyScalar(1.4);
    ui.count.textContent = `RESIDENT ${String(i + 1).padStart(2, "0")} / ${String(residents.length).padStart(2, "0")}`;
    ui.name.textContent = s.name;
    ui.name.style.color = glow;
    ui.name.style.textShadow = `0 0 16px ${glow}`;
    ui.species.textContent = s.species;
    ui.motto.textContent = `“${s.motto}”`;
    ui.motto.style.color = s.palette.primary;
    ui.desc.textContent = s.description;
    ui.model.textContent = `designed by ${r.provider} · ${r.model}`;
    ui.spec.innerHTML = highlight(JSON.stringify(s, null, 2));
    onSelect(i);
  }

  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    drag.x = e.clientX;
    spin += dx * 0.012;
    vel = dx * 0.012 * 30;
  });
  const end = () => { drag = null; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);

  const clock = new THREE.Clock();
  let t = 0;
  select(0);
  return {
    select, next: () => select(i + 1), prev: () => select(i - 1),
    frame() {
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!still) t += dt;
      if (!drag) { vel += (0.4 - vel) * Math.min(1, dt * 2); if (!still) spin += vel * dt; }
      holder.rotation.y = spin;
      current?.userData.update(t, still ? 0 : dt);
      renderer.render(scene, camera);
    },
  };
}

// Plain JSON colouring: keys, strings, numbers, booleans.
function highlight(json) {
  const esc = json.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return esc.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g, (m, str, colon, bool) => {
    if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
    if (bool) return `<span class="b">${bool}</span>`;
    return `<span class="n">${m}</span>`;
  });
}
