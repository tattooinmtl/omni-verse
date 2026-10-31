import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildAvatar } from "./avatar.js";

// The background city: a grid of towers whose windows are drawn by a shader,
// light cycles leaving light walls on the streets, the Agent Gate and Agent
// Row with the residents' homes. The camera flies a path keyed to the page's
// sections; main.js feeds it the scroll position.

const BLOCK = 30;                    // block pitch; streets run on the odd half-blocks
const STREET = (k) => k * BLOCK + BLOCK / 2;
const ROW_Z = 60, ROW_X = [90, 120, 150, 180, 210, 240, 270];
const GATE = new THREE.Vector3(-90, 0, 0);
const HERO_H = 175;

// Seeded random, so the skyline is the same on every visit.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const FOG = /* glsl */ `
  uniform float uFog;
  float fogAmount(vec3 w) { float d = length(w.xz - cameraPosition.xz); return 1.0 - exp(-pow(d * uFog, 2.0)); }
  const vec3 FOGC = vec3(0.006, 0.028, 0.042);
`;

// Camera keyframes: `at` is a fractional section index (0 = hero … 5 = street).
// Low stops sit on streets or cleared blocks; high waypoints between them keep
// the flight above the rooftops.
const KEYS = [
  { at: 0.0, pos: [0, 190, 330], look: [0, 40, 0] },
  { at: 0.65, pos: [75, 26, 75], look: [0, 40, 0] },
  { at: 1.35, pos: [45, 150, 45], look: [0, 150, 0] },
  { at: 1.7, pos: [-30, 150, 140], look: [-90, 20, 0] },
  { at: 2.0, pos: [-90, 10, 52], look: [-74, 13, 0] },
  { at: 2.3, pos: [-10, 90, 160], look: [120, 10, 60] },
  { at: 2.6, pos: [75, 16, 105], look: [140, 8, 60] },
  { at: 3.35, pos: [255, 14, 105], look: [196, 8, 60] },
  { at: 4.0, pos: [0, 470, 60], look: [0, 0, 0] },
  { at: 4.6, pos: [15, 40, 300], look: [15, 10, -100] },
  { at: 5.0, pos: [15, 2.6, 230], look: [15, 7, -300] },
];
const crKeys = (pick) => KEYS.map((k) => new THREE.Vector3(...k[pick]));
function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t;
  return out.set(0, 0, 0)
    .addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t)
    .addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1)
    .addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t)
    .addScaledVector(p3, 0.5 * t3 - 0.5 * t2);
}

export function createCity(canvas, residents, { lite = false, still = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lite ? 1 : 1.5));
  renderer.setClearColor(0x01050a);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);
  scene.add(new THREE.AmbientLight(0x6688aa, 1.2));
  const sun = new THREE.DirectionalLight(0x99e6ff, 1.4);
  sun.position.set(80, 200, 120);
  scene.add(sun);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), lite ? 0.6 : 0.75, 0.5, 0.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const fogU = { value: 0.0032 };
  const updaters = [];

  // ── sky and stars ──────────────────────────────────────────────────────
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; void main(){
      float h = vP.y;
      vec3 c = mix(vec3(0.006, 0.028, 0.042), vec3(0.002,0.006,0.012), smoothstep(0.0, 0.3, h));
      c += vec3(0.6,0.15,0.55) * 0.05 * exp(-abs(h - 0.02) * 30.0);
      gl_FragColor = vec4(c, 1.0); }`,
  })));
  {
    const r = rng(7), n = lite ? 600 : 1400, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = r() * Math.PI * 2, ph = Math.acos(r() * 0.9), R = 1600;
      p.set([R * Math.sin(ph) * Math.cos(th), R * Math.cos(ph) + 40, R * Math.sin(ph) * Math.sin(th)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fdfff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.7 })));
  }

  // ── ground grid ────────────────────────────────────────────────────────
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.ShaderMaterial({
    uniforms: { uFog: fogU, uTime: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: FOG + `
      varying vec3 vW; uniform float uTime;
      float line(float c, float pitch, float w){ float d = abs(mod(c + pitch * 0.5, pitch) - pitch * 0.5); return 1.0 - smoothstep(0.0, w * fwidth(c) * 1.5 + w, d); }
      void main(){
        // Streets sit on the half-blocks: x = 15 + 30k.
        float sx = line(vW.x - 15.0, 30.0, 0.12), sz = line(vW.z - 15.0, 30.0, 0.12);
        float street = max(sx, sz);
        float fine = max(line(vW.x, 6.0, 0.02), line(vW.z, 6.0, 0.02)) * 0.25;
        // A pulse runs down the avenues.
        float pulse = 0.5 + 0.5 * sin((vW.x + vW.z) * 0.05 - uTime * 2.0);
        vec3 c = vec3(0.005, 0.02, 0.03) + vec3(0.13, 0.9, 1.0) * (street * (0.55 + 0.45 * pulse) + fine * 0.7);
        float f = fogAmount(vW);
        gl_FragColor = vec4(mix(c, FOGC, f), 1.0);
      }`,
  }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  updaters.push((t) => { ground.material.uniforms.uTime.value = t; });

  // ── towers ─────────────────────────────────────────────────────────────
  const palette = ["#22e6ff", "#22e6ff", "#ff3df2", "#ff9f1c", "#39ff88", "#9b6bff", "#22e6ff"].map((c) => new THREE.Color(c));
  const towers = [];
  const R = lite ? 7 : 10, rr = rng(42);
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
    const x = i * BLOCK, z = j * BLOCK, d = Math.hypot(i, j);
    if (d > R + 0.5) continue;
    if ((j === 2 || j === 3) && i >= 2 && i <= 9) continue; // Agent Row and the open ground in front of it
    if (i >= -4 && i <= -2 && j >= -1 && j <= 2) continue;  // the Agent Gate plaza
    if (i === 0 && j === 0) { towers.push({ x, z, w: 18, d: 18, h: HERO_H, hero: 1, c: new THREE.Color("#22e6ff") }); continue; }
    if (rr() < 0.08) continue;                            // a few empty plazas
    const n = rr() < 0.3 ? 2 : 1;                         // some blocks hold two towers
    for (let k = 0; k < n; k++) {
      const fall = Math.max(0.15, 1 - d / (R + 1));
      const h = 12 + Math.pow(rr(), 1.6) * 120 * fall + rr() * 10;
      const w = n === 2 ? 8 + rr() * 3 : 10 + rr() * 9, dd = n === 2 ? 16 + rr() * 4 : 10 + rr() * 9;
      const ox = n === 2 ? (k ? 5.5 : -5.5) : (rr() - 0.5) * 3;
      towers.push({ x: x + ox, z: z + (rr() - 0.5) * 3, w, d: dd, h, hero: 0, c: palette[Math.floor(rr() * palette.length)] });
    }
  }
  const tGeo = new THREE.BoxGeometry(1, 1, 1);
  tGeo.translate(0, 0.5, 0);
  const tMat = new THREE.ShaderMaterial({
    uniforms: { uFog: fogU, uTime: { value: 0 }, uBuild: { value: 0 } },
    vertexShader: `
      attribute float aHero; attribute float aSeed; attribute float aH;
      varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vHero; varying float vSeed; varying float vH;
      void main(){
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normal; vC = instanceColor; vHero = aHero; vSeed = aSeed; vH = aH;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: FOG + `
      varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vHero; varying float vSeed; varying float vH;
      uniform float uTime; uniform float uBuild;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec3 base = vec3(0.006, 0.022, 0.034);
        vec3 col = base;
        if (vN.y < 0.5) {
          vec2 fp = abs(vN.x) > 0.5 ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y);
          vec2 cell = vec2(fp.x / 2.4, fp.y / 3.4);
          vec2 id = floor(cell), f = fract(cell);
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.78);
          float r = hash(id + vSeed * 13.7 + vN.xz * 5.3);
          float lit;
          if (vHero > 0.5) {
            // The hero tower lights up floor by floor as the page climbs it.
            float top = uBuild * vH;
            lit = step(vW.y, top) * step(0.25, r);
            float edge = 1.0 - smoothstep(0.0, 6.0, abs(vW.y - top));
            col += vec3(1.0, 0.25, 0.95) * edge * 0.35 * step(0.01, uBuild) * step(uBuild, 0.995);
          } else {
            lit = step(0.58, r);
          }
          float tw = 0.75 + 0.25 * sin(uTime * (0.5 + r * 2.0) + r * 40.0);
          col += vC * win * lit * (0.35 + 0.9 * hash(id * 1.7 + vSeed)) * tw * (vHero > 0.5 ? 1.8 : 1.0);
          // A thin band every 8 floors and a glowing crown.
          float band = 1.0 - smoothstep(0.0, 0.25, abs(mod(vW.y, 27.2) - 0.2));
          col += vC * band * 0.25;
          col += vC * smoothstep(vH - 2.5, vH, vW.y) * 0.9;
        } else {
          col += vC * 0.05;
        }
        gl_FragColor = vec4(mix(col, FOGC, fogAmount(vW)), 1.0);
      }`,
  });
  const tMesh = new THREE.InstancedMesh(tGeo, tMat, towers.length);
  const m4 = new THREE.Matrix4(), hero = new Float32Array(towers.length), seed = new Float32Array(towers.length), hh = new Float32Array(towers.length);
  towers.forEach((t, i) => {
    m4.makeScale(t.w, t.h, t.d).setPosition(t.x, 0, t.z);
    tMesh.setMatrixAt(i, m4);
    tMesh.setColorAt(i, t.c);
    hero[i] = t.hero; seed[i] = rr() * 100; hh[i] = t.h;
  });
  tGeo.setAttribute("aHero", new THREE.InstancedBufferAttribute(hero, 1));
  tGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
  tGeo.setAttribute("aH", new THREE.InstancedBufferAttribute(hh, 1));
  tMesh.frustumCulled = false;
  scene.add(tMesh);
  updaters.push((t) => { tMat.uniforms.uTime.value = t; });

  // Glowing edges for every tower, one draw call.
  {
    const pos = [], col = [];
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    for (const t of towers) {
      const k = t.hero ? 1.6 : 0.55;
      const c = t.c.clone().multiplyScalar(k);
      const P = corners.map(([a, b]) => [t.x + a * t.w, t.z + b * t.d]);
      for (let e = 0; e < 4; e++) {
        const [x1, z1] = P[e], [x2, z2] = P[(e + 1) % 4];
        pos.push(x1, t.h, z1, x2, t.h, z2, x1, 0, z1, x1, t.h, z1);
        for (let q = 0; q < 4; q++) col.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    scene.add(new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: { uFog: fogU },
      vertexShader: `attribute vec3 color; varying vec3 vC; varying vec3 vW; void main(){ vC = color; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: FOG + `varying vec3 vC; varying vec3 vW; void main(){ gl_FragColor = vec4(mix(vC, FOGC, fogAmount(vW)), 1.0); }`,
    })));
  }

  // Antenna beacons on the tallest towers, blinking out of step.
  {
    const tall = [...towers].sort((a, b) => b.h - a.h).slice(0, 30);
    const g = new THREE.SphereGeometry(0.9, 10, 8);
    const beacons = tall.map((t, i) => {
      const ant = t.hero ? 30 : 4 + t.h * 0.08;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, ant, 6), new THREE.MeshBasicMaterial({ color: t.c.clone().multiplyScalar(0.8) }));
      mast.position.set(t.x, t.h + ant / 2, t.z);
      scene.add(mast);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(i % 3 ? "#ff3df2" : "#ff9f1c").multiplyScalar(3) }));
      m.position.set(t.x, t.h + ant, t.z);
      if (t.hero) m.scale.setScalar(2);
      scene.add(m);
      return { m, ph: i * 1.7 };
    });
    updaters.push((t) => { for (const b of beacons) b.m.visible = Math.sin(t * 2 + b.ph) > -0.3; });
  }

  // ── light cycles ───────────────────────────────────────────────────────
  if (!still) {
    const TRAIL = 46, colors = ["#22e6ff", "#ff9f1c", "#ff3df2", "#39ff88", "#22e6ff", "#ffe14d", "#9b6bff", "#ff3df2", "#22e6ff", "#39ff88"];
    const wallMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aA; varying float vA; varying float vY; void main(){ vA = aA; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uC; varying float vA; varying float vY; void main(){ float top = smoothstep(1.2, 1.6, vY) * 0.8; gl_FragColor = vec4(uC * (vA * (0.55 + top)), 1.0); }`,
    });
    const r = rng(99);
    const bikes = colors.slice(0, lite ? 6 : 10).map((hex, i) => {
      const c = new THREE.Color(hex);
      const alongX = i % 2 === 0, lane = STREET(Math.floor(r() * 12) - 6);
      const pos = alongX ? new THREE.Vector3((r() - 0.5) * 400, 0, lane) : new THREE.Vector3(lane, 0, (r() - 0.5) * 400);
      const dir = alongX ? new THREE.Vector3(r() < 0.5 ? 1 : -1, 0, 0) : new THREE.Vector3(0, 0, r() < 0.5 ? 1 : -1);
      const bike = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 0.9), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(3) }));
      bike.position.y = 0.7;
      scene.add(bike);
      const hist = Array.from({ length: TRAIL }, () => pos.clone());
      const p = new Float32Array(TRAIL * 2 * 3), a = new Float32Array(TRAIL * 2), idx = [];
      for (let k = 0; k < TRAIL; k++) { a[k * 2] = a[k * 2 + 1] = 1 - k / (TRAIL - 1); }
      for (let k = 0; k < TRAIL - 1; k++) { const o = k * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(p, 3));
      g.setAttribute("aA", new THREE.BufferAttribute(a, 1));
      g.setIndex(idx);
      const mat = wallMat.clone();
      mat.uniforms = { uC: { value: c } };
      const wall = new THREE.Mesh(g, mat);
      wall.frustumCulled = false;
      scene.add(wall);
      return { pos, dir, bike, hist, p, g, speed: 42 + r() * 26, next: null, acc: 0 };
    });
    const nextCross = (b) => {
      const ax = b.dir.x !== 0 ? "x" : "z", s = Math.sign(b.dir[ax]);
      const k = s > 0 ? Math.floor((b.pos[ax] - 15) / BLOCK) + 1 : Math.ceil((b.pos[ax] - 15) / BLOCK) - 1;
      b.next = STREET(k);
    };
    bikes.forEach(nextCross);
    updaters.push((t, dt) => {
      for (const b of bikes) {
        const ax = b.dir.x !== 0 ? "x" : "z", s = Math.sign(b.dir[ax]);
        b.pos.addScaledVector(b.dir, b.speed * dt);
        if ((b.pos[ax] - b.next) * s >= 0) {
          b.pos[ax] = b.next;
          const far = Math.abs(b.pos.x) > 280 || Math.abs(b.pos.z) > 280;
          if (far || r() < 0.3) {
            // Turn 90°; near the edge, turn toward the centre.
            const left = new THREE.Vector3(-b.dir.z, 0, b.dir.x);
            const toward = far ? (left.dot(b.pos) < 0 ? 1 : -1) : (r() < 0.5 ? 1 : -1);
            b.dir.copy(left.multiplyScalar(toward));
            if (far && b.dir.dot(b.pos) > 0) b.dir.negate();
          }
          nextCross(b);
        }
        b.bike.position.set(b.pos.x, 0.7, b.pos.z);
        b.bike.rotation.y = b.dir.x !== 0 ? 0 : Math.PI / 2;
        b.acc += b.speed * dt;
        if (b.acc > 1.4) { b.acc = 0; b.hist.pop(); b.hist.unshift(b.pos.clone()); } else b.hist[0].copy(b.pos);
        for (let k = 0; k < b.hist.length; k++) {
          const h = b.hist[k], o = k * 6;
          b.p[o] = h.x; b.p[o + 1] = 0.1; b.p[o + 2] = h.z;
          b.p[o + 3] = h.x; b.p[o + 4] = 1.6; b.p[o + 5] = h.z;
        }
        b.g.attributes.position.needsUpdate = true;
      }
    });
  }

  // ── the Agent Gate ─────────────────────────────────────────────────────
  const gateHolo = new THREE.Group();
  {
    const g = new THREE.Group();
    g.position.copy(GATE);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(15, 0.7, 12, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color("#22e6ff").multiplyScalar(2.6) }));
    ring.position.y = 17;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(17.5, 0.25, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff3df2").multiplyScalar(2.2) }));
    ring2.position.y = 17;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(14.3, 64), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vU; void main(){ vU = uv - 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vU; uniform float uTime; void main(){
        float r = length(vU) * 2.0, a = atan(vU.y, vU.x);
        float swirl = 0.5 + 0.5 * sin(a * 6.0 + r * 14.0 - uTime * 2.5);
        float v = (0.06 + 0.16 * swirl) * smoothstep(1.0, 0.2, r) + 0.25 * exp(-pow((r - 0.96) * 18.0, 2.0));
        gl_FragColor = vec4(vec3(0.13, 0.9, 1.0) * v, 1.0); }`,
    }));
    disc.position.y = 17;
    disc.position.z = -2;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(10, 12, 1.2, 48), new THREE.MeshStandardMaterial({ color: 0x041722, emissive: 0x0a3a48, metalness: 0.7, roughness: 0.3 }));
    base.position.set(0, 0.6, 8);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(11.6, 0.18, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color("#22e6ff").multiplyScalar(2) }));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 1.25, 8);
    gateHolo.position.set(0, 1.3, 8);
    g.add(ring, ring2, disc, base, rim, gateHolo);
    scene.add(g);
    updaters.push((t) => { disc.material.uniforms.uTime.value = t; ring2.rotation.z = t * 0.2; gateHolo.rotation.y = t * 0.5; });
  }
  const holoCache = new Map();
  let holoNow = null;
  const showAtGate = (i) => {
    const res = residents[i];
    if (!res) return;
    if (!holoCache.has(i)) { const a = buildAvatar(res.spec); a.scale.setScalar(9 / res.spec.height); holoCache.set(i, a); }
    if (holoNow) gateHolo.remove(holoNow);
    holoNow = holoCache.get(i);
    gateHolo.add(holoNow);
  };
  updaters.push((t, dt) => holoNow?.userData.update(t, dt));

  // ── Agent Row: one lot and one home per resident ───────────────────────
  const homes = [];
  residents.slice(0, ROW_X.length).forEach((res, i) => {
    const r = rng(1000 + i * 31), x = ROW_X[i], pal = res.spec.palette;
    const glowC = new THREE.Color(pal.glow || pal.primary), prim = new THREE.Color(pal.primary);
    const lot = new THREE.Group();
    lot.position.set(x, 0, ROW_Z);
    // Lot outline and plaque.
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(24, 0.2, 24)), new THREE.LineBasicMaterial({ color: glowC.clone().multiplyScalar(1.6) }));
    outline.position.y = 0.1;
    lot.add(outline);
    const parts = [];
    let y = 0;
    const n = 9 + Math.floor(r() * 6);
    for (let k = 0; k < n; k++) {
      const kind = k === 0 ? "slab" : r() < 0.6 ? "box" : r() < 0.7 ? "cyl" : "spire";
      const w = k === 0 ? 18 : Math.max(3, (16 - k * 0.9) * (0.5 + r() * 0.6));
      const h = k === 0 ? 1 : kind === "spire" ? 5 + r() * 6 : 2 + r() * 5;
      const geo = kind === "cyl" ? new THREE.CylinderGeometry(w / 2, w / 2, h, 20) : kind === "spire" ? new THREE.ConeGeometry(w / 3, h, 6) : new THREE.BoxGeometry(w, h, w * (0.6 + r() * 0.5));
      const c = (k % 3 === 2 ? glowC : prim).clone();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x03121c, emissive: c.clone().multiplyScalar(0.12), metalness: 0.6, roughness: 0.35 }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: c.clone().multiplyScalar(2.2) }));
      const part = new THREE.Group();
      part.add(mesh, edges);
      part.position.set(k === 0 ? 0 : (r() - 0.5) * 5, y + h / 2, k === 0 ? 0 : (r() - 0.5) * 4 - 2);
      if (kind !== "spire") y += h * (k === 0 ? 1 : 0.85);
      part.visible = false;
      lot.add(part);
      parts.push(part);
    }
    scene.add(lot);
    const av = buildAvatar(res.spec);
    av.scale.setScalar(4 / res.spec.height);
    av.position.set(x, 0, ROW_Z + 15);
    scene.add(av);
    homes.push({ parts, av, x, ph: r() * 6, speed: 0.25 + r() * 0.2 });
  });
  let lifeP = -1;
  updaters.push((t, dt) => {
    for (const h of homes) {
      // Residents stroll along their own frontage, turning at each end.
      const s = Math.sin(t * h.speed + h.ph);
      h.av.position.x = h.x + s * 9;
      h.av.rotation.y = Math.cos(t * h.speed + h.ph) > 0 ? Math.PI / 2 : -Math.PI / 2;
      h.av.userData.update(t, dt);
    }
  });
  const setLife = (p) => {
    if (Math.abs(p - lifeP) < 0.005) return;
    lifeP = p;
    homes.forEach((h, i) => {
      // Homes nearer the start of the row are further along.
      const q = THREE.MathUtils.clamp(p * 1.4 - i * 0.06, 0, 1);
      h.parts.forEach((part, k) => { part.visible = k < 1 + q * (h.parts.length - 1); });
    });
  };

  // ── camera ─────────────────────────────────────────────────────────────
  const P = crKeys("pos"), L = crKeys("look");
  const tmpP = new THREE.Vector3(), tmpL = new THREE.Vector3();
  const along = (pts, x, out) => {
    let k = 0;
    while (k < KEYS.length - 2 && x > KEYS[k + 1].at) k++;
    const a = KEYS[k].at, b = KEYS[k + 1].at;
    const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
    const s = t * t * (3 - 2 * t);
    return catmull(pts[Math.max(0, k - 1)], pts[k], pts[k + 1], pts[Math.min(pts.length - 1, k + 2)], s, out);
  };

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w / 2, h / 2); // a soft glow doesn't need full resolution, and it's the costliest pass
    camera.aspect = w / h;
    // Narrow screens see less sideways; pull the lens wider so the subject still fits.
    camera.fov = w / h < 0.8 ? 72 : 55;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  const clock = new THREE.Clock();
  let t = 0;
  return {
    showAtGate,
    // view: { x: fractional section index, build: 0..1, life: 0..1, px, py: pointer -1..1 }
    frame(view) {
      const dt = Math.min(clock.getDelta(), 0.05);
      t += still ? 0 : dt;
      along(P, view.x, tmpP);
      along(L, view.x, tmpL);
      // A slow drift over the skyline while the hero section is up.
      const orbit = Math.max(0, 1 - view.x / 0.6);
      if (orbit > 0 && !still) tmpP.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(t * 0.07) * 0.35 * orbit);
      camera.position.copy(tmpP);
      camera.position.x += view.px * 4;
      camera.position.y += view.py * 2;
      camera.lookAt(tmpL);
      tMat.uniforms.uBuild.value = view.build;
      setLife(view.life);
      for (const u of updaters) u(t, still ? 0 : dt);
      composer.render();
      return camera.position.y;
    },
  };
}
