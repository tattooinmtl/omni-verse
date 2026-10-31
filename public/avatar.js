import * as THREE from "three";

// Renders an agent's self-designed avatar spec (see server/avatars.mjs).
// Parts use unit geometries scaled by `size`; the whole body is normalised so
// its feet sit at y=0 and it stands `spec.height` metres tall, facing +z.

const unitGeos = new Map();
export function geo(shape) {
  if (unitGeos.has(shape)) return unitGeos.get(shape);
  let g;
  switch (shape) {
    case "sphere": g = new THREE.SphereGeometry(0.5, 24, 16); break;
    case "cylinder": g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); break;
    case "cone": g = new THREE.ConeGeometry(0.5, 1, 24); break;
    case "torus": g = new THREE.TorusGeometry(0.4, 0.1, 12, 32); break;
    case "ring": g = new THREE.TorusGeometry(0.48, 0.02, 6, 48); break;
    case "capsule": g = new THREE.CapsuleGeometry(0.5, 1, 6, 16); g.scale(1, 0.5, 1); break;
    case "octahedron": g = new THREE.OctahedronGeometry(0.5); break;
    case "icosahedron": g = new THREE.IcosahedronGeometry(0.5, 0); break;
    case "dodecahedron": g = new THREE.DodecahedronGeometry(0.5); break;
    case "tetrahedron": g = new THREE.TetrahedronGeometry(0.5); break;
    case "torusKnot": g = new THREE.TorusKnotGeometry(0.32, 0.1, 96, 12); break;
    default: g = new THREE.BoxGeometry(1, 1, 1);
  }
  g.userData.shared = true;
  unitGeos.set(shape, g);
  return g;
}

let dot;
function dotTexture() {
  if (dot) return dot;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  dot = new THREE.CanvasTexture(c);
  return dot;
}

export const resolveColor = (c, palette) => (c && c.startsWith("#") ? c : palette[c] || palette.primary);

function makeParticles(p, palette) {
  const n = p.count;
  const pos = new Float32Array(n * 3);
  const seed = Float32Array.from({ length: n * 3 }, Math.random);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(resolveColor(p.color, palette)).multiplyScalar(1.6),
    size: p.size, map: dotTexture(), transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.position.set(...p.center);
  pts.frustumCulled = false;
  const r = p.radius, sp = p.speed, TAU = Math.PI * 2;
  const update = (t) => {
    for (let i = 0; i < n; i++) {
      const a = seed[i * 3], b = seed[i * 3 + 1], c = seed[i * 3 + 2];
      let x, y, z;
      switch (p.shape) {
        case "sphere": {
          const th = a * TAU + t * sp * 0.5, ph = Math.acos(2 * b - 1), rr = r * (0.92 + 0.08 * Math.sin(t * 2 + c * 20));
          x = rr * Math.sin(ph) * Math.cos(th); y = rr * Math.cos(ph); z = rr * Math.sin(ph) * Math.sin(th); break;
        }
        case "ring": case "halo": {
          const th = a * TAU + t * sp * 0.6, rr = r * (0.9 + 0.2 * b);
          x = rr * Math.cos(th); z = rr * Math.sin(th); y = (c - 0.5) * (p.shape === "halo" ? 0.03 : 0.12) * r; break;
        }
        case "helix": {
          y = (a * 2 - 1) * r;
          const th = (y / r) * TAU + t * sp + (b < 0.5 ? 0 : Math.PI), rr = r * 0.45 + (c - 0.5) * 0.05;
          x = rr * Math.cos(th); z = rr * Math.sin(th); break;
        }
        case "vortex": {
          const th = b * TAU + t * sp * (1.6 - a), rr = r * (0.12 + a * 0.88);
          x = rr * Math.cos(th); z = rr * Math.sin(th); y = (a * 2 - 1) * r; break;
        }
        default: { // cloud
          const th = a * TAU, ph = Math.acos(2 * b - 1), rr = r * Math.cbrt(c);
          const j = 0.06 * r;
          x = rr * Math.sin(ph) * Math.cos(th) + j * Math.sin(t * sp + a * 40);
          y = rr * Math.cos(ph) + j * Math.sin(t * sp * 1.3 + b * 40);
          z = rr * Math.sin(ph) * Math.sin(th) + j * Math.cos(t * sp + c * 40);
        }
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
    g.attributes.position.needsUpdate = true;
  };
  update(0);
  g.computeBoundingBox();
  return { pts, update };
}

export function buildAvatar(spec) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const animated = [];
  for (const part of spec.parts) {
    const color = new THREE.Color(resolveColor(part.color, spec.palette));
    const transparent = part.opacity < 1;
    const mat = part.wire
      ? new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1 + part.emissive), wireframe: true, transparent, opacity: part.opacity })
      : new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: part.emissive, metalness: 0.45, roughness: 0.35,
          transparent, opacity: part.opacity, depthWrite: !transparent,
        });
    const mesh = new THREE.Mesh(geo(part.shape), mat);
    mesh.scale.set(...part.size);
    mesh.position.set(...part.pos);
    mesh.rotation.set(...part.rot);
    const pivot = new THREE.Group();
    pivot.add(mesh);
    body.add(pivot);
    if (part.anim !== "none" && part.speed > 0) {
      animated.push({ part, mesh, pivot, mat, base: mesh.position.clone(), baseScale: mesh.scale.clone(), baseRot: mesh.rotation.clone(), phase: Math.random() * 6.28 });
    }
  }
  let particles = null;
  if (spec.particles) {
    particles = makeParticles(spec.particles, spec.palette);
    body.add(particles.pts);
  }
  // Normalise: feet on the ground, centred, spec.height tall.
  body.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body);
  const h = Math.max(0.05, box.max.y - box.min.y);
  const s = spec.height / h;
  body.scale.setScalar(s);
  body.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);

  root.userData.height = spec.height;
  root.userData.update = (t, dt) => {
    for (const a of animated) {
      const k = a.part.speed;
      switch (a.part.anim) {
        case "spin": a.mesh.rotation.y += dt * k * 1.5; break;
        case "bob": a.mesh.position.y = a.base.y + Math.sin(t * k * 2 + a.phase) * 0.06; break;
        case "pulse": a.mesh.scale.copy(a.baseScale).multiplyScalar(1 + 0.12 * Math.sin(t * k * 2 + a.phase)); break;
        case "orbit": a.pivot.rotation.y = t * k * 0.8; break;
        case "wave": a.mesh.rotation.z = a.baseRot.z + Math.sin(t * k * 2 + a.phase) * 0.45; break;
        case "flicker": {
          const f = 0.65 + 0.35 * Math.sin(t * 13 * k + a.phase) * Math.sin(t * 7.3 + a.phase);
          if ("emissiveIntensity" in a.mat) a.mat.emissiveIntensity = a.part.emissive * f;
          else a.mat.opacity = a.part.opacity * f;
          break;
        }
      }
    }
    particles?.update(t);
  };
  return root;
}
