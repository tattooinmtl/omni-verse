import * as THREE from "three";
import { geo, resolveColor } from "./avatar.js";

// Renders a house an agent designed (server/life.mjs). Parts are in the lot's
// local frame (front = +z, facing the street). Static parts are batched into
// one InstancedMesh per shape / glow / opacity bucket, so a house can hold
// thousands of parts; animated and wireframe parts stay individual meshes.

// Each moving part is its own draw call, so a house gets at most this many;
// the rest stand still and join the batches.
const MAX_ANIMATED = 48;
const matCache = new Map();

// The instance colour drives both diffuse and emissive, so one material
// serves every colour in its glow bucket. The glow is a uniform, not a number
// written into the shader: every glow level then shares ONE compiled program,
// instead of each new level compiling its own and freezing the frame.
function instancedMaterial(emis, opacity) {
  const key = `${emis}|${opacity}`;
  if (matCache.has(key)) return matCache.get(key);
  const transparent = opacity < 1;
  const m = new THREE.MeshStandardMaterial({ metalness: 0.5, roughness: 0.38, transparent, opacity, depthWrite: !transparent });
  const uEmis = { value: emis };
  m.onBeforeCompile = (s) => {
    s.uniforms.uEmis = uEmis;
    s.fragmentShader = "uniform float uEmis;\n" + s.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance = vColor.rgb * uEmis;");
  };
  m.customProgramCacheKey = () => "house-emis";
  m.userData.shared = true;
  matCache.set(key, m);
  return m;
}

// Moving and wireframe parts with the same look share one material, except
// flickering ones, which change theirs every frame.
const partCache = new Map();
function partMaterial(p, color) {
  const glow = Math.round(p.emissive * Math.min(1, Math.max(0.12, 5 / Math.max(...p.size))) * 8) / 8;
  const key = `${p.wire ? "w" : "s"}|${color.getHexString()}|${p.wire ? p.emissive : glow}|${p.opacity}`;
  if (p.anim !== "flicker" && partCache.has(key)) return partCache.get(key);
  const mat = p.wire
    ? new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1 + p.emissive), wireframe: true, transparent: p.opacity < 1, opacity: p.opacity })
    : new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow, metalness: 0.5, roughness: 0.38, transparent: p.opacity < 1, opacity: p.opacity, depthWrite: p.opacity >= 1 });
  if (p.anim !== "flicker") { mat.userData.shared = true; partCache.set(key, mat); }
  return mat;
}

export function buildHouse(parts, palette) {
  const group = new THREE.Group();
  const animated = [];
  const buckets = new Map();
  const dummy = new THREE.Object3D();
  const solids = []; // [shape, matrix] of parts that block movement

  for (const p of parts) {
    const color = new THREE.Color(resolveColor(p.color, palette));
    const moving = p.anim !== "none" && p.speed > 0 && animated.length < MAX_ANIMATED;
    if (moving || p.wire) {
      const mat = partMaterial(p, color);
      const mesh = new THREE.Mesh(geo(p.shape), mat);
      mesh.scale.set(...p.size);
      mesh.position.set(...p.pos);
      mesh.rotation.set(...p.rot);
      group.add(mesh);
      if (moving) animated.push({ p, mesh, mat, emis: mat.emissiveIntensity ?? 0, base: mesh.position.clone(), baseScale: mesh.scale.clone(), baseRot: mesh.rotation.clone(), phase: Math.random() * 6.28 });
      continue;
    }
    // Big glowing slabs would bloom into a white blob: glow fades with size.
    const emis = Math.round(p.emissive * Math.min(1, Math.max(0.12, 5 / Math.max(...p.size))) * 4) / 4;
    const opacity = Math.round(p.opacity * 10) / 10;
    const key = `${p.shape}|${emis}|${opacity}`;
    if (!buckets.has(key)) buckets.set(key, { shape: p.shape, emis, opacity, items: [] });
    dummy.position.set(...p.pos);
    dummy.rotation.set(...p.rot);
    dummy.scale.set(...p.size);
    dummy.updateMatrix();
    buckets.get(key).items.push([dummy.matrix.clone(), color]);
    if (opacity >= 0.6) solids.push([p.shape, dummy.matrix.clone()]);
  }

  for (const b of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo(b.shape), instancedMaterial(b.emis, b.opacity), b.items.length);
    b.items.forEach(([m, c], i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, c); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (b.opacity < 1) mesh.renderOrder = 3;
    group.add(mesh);
  }

  group.userData.update = (t, dt) => {
    for (const a of animated) {
      const k = a.p.speed;
      switch (a.p.anim) {
        case "spin": a.mesh.rotation.y += dt * k * 1.2; break;
        case "bob": a.mesh.position.y = a.base.y + Math.sin(t * k * 1.5 + a.phase) * 0.4; break;
        case "pulse": a.mesh.scale.copy(a.baseScale).multiplyScalar(1 + 0.08 * Math.sin(t * k * 2 + a.phase)); break;
        case "orbit": a.mesh.position.set(a.base.x * Math.cos(t * k * 0.4) - a.base.z * Math.sin(t * k * 0.4), a.base.y, a.base.x * Math.sin(t * k * 0.4) + a.base.z * Math.cos(t * k * 0.4)); break;
        case "wave": a.mesh.rotation.z = a.baseRot.z + Math.sin(t * k * 2 + a.phase) * 0.3; break;
        case "flicker": {
          const f = 0.6 + 0.4 * Math.sin(t * 11 * k + a.phase) * Math.sin(t * 6.1 + a.phase);
          if ("emissiveIntensity" in a.mat) a.mat.emissiveIntensity = a.emis * f; else a.mat.opacity = a.p.opacity * f;
          break;
        }
      }
    }
  };

  // World-space AABBs of the solid parts, once the group is placed.
  group.userData.colliders = (parentMatrix) => {
    const box = new THREE.Box3(), m = new THREE.Matrix4();
    return solids.map(([shape, local]) => {
      const g = geo(shape);
      if (!g.boundingBox) g.computeBoundingBox();
      box.copy(g.boundingBox).applyMatrix4(m.multiplyMatrices(parentMatrix, local));
      return { min: box.min.toArray(), max: box.max.toArray() };
    });
  };
  return group;
}
