import * as THREE from "three";

// First-person controller: WASD + mouse look, F toggles flying, V toggles a
// third-person view of your avatar. Collision is axis-separated AABB against
// the city's walls and floor slabs, so walking and flying both respect walls.

const R = 0.35, HEIGHT = 1.75, EYE = 1.6;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Player {
  constructor(camera, canvas, city) {
    this.camera = camera;
    this.canvas = canvas;
    this.city = city;
    this.pos = new THREE.Vector3(-30, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = -Math.PI / 2;
    this.pitch = 0;
    this.fly = false;
    this.third = false;
    this.onGround = false;
    this.keys = new Set();
    this.avatar = null;
    this.dragLook = false;
    this.sens = 1;
    document.addEventListener("mousemove", (e) => {
      const pointer = document.pointerLockElement === this.canvas;
      if (!pointer && !(this.dragLook && e.buttons)) return;
      this.yaw -= e.movementX * 0.0022 * this.sens;
      this.pitch = clamp(this.pitch - e.movementY * 0.0022 * this.sens, -1.55, 1.55);
    });
    // A key held while the window loses focus never gets its keyup.
    addEventListener("blur", () => this.keys.clear());
  }

  get locked() { return document.pointerLockElement === this.canvas || this.dragLook; }

  setAvatar(mesh, scene) {
    this.avatar = mesh;
    mesh.visible = this.third;
    scene.add(mesh);
  }

  toggleFly() { this.fly = !this.fly; this.vel.y = 0; }
  toggleView() {
    if (!this.avatar) return; // spectators have no body to look at
    this.third = !this.third;
    this.avatar.visible = this.third;
  }

  teleport(p, yaw) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    if (yaw !== undefined) { this.yaw = yaw; this.pitch = 0; }
  }

  update(dt, t) {
    const k = this.keys;
    if (this.locked) {
      const f = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
      const r = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
      const boost = k.has("ShiftLeft") || k.has("ShiftRight");
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const right = new THREE.Vector3(cos, 0, -sin);
      if (this.fly) {
        const cp = Math.cos(this.pitch);
        const dir = new THREE.Vector3(-sin * cp, Math.sin(this.pitch), -cos * cp).multiplyScalar(f).addScaledVector(right, r);
        dir.y += (k.has("Space") ? 1 : 0) - (k.has("KeyC") ? 1 : 0);
        if (dir.lengthSq() > 1) dir.normalize();
        this.vel.lerp(dir.multiplyScalar(boost ? 45 : 16), 1 - Math.exp(-8 * dt));
      } else {
        const wish = new THREE.Vector3(-sin, 0, -cos).multiplyScalar(f).addScaledVector(right, r);
        if (wish.lengthSq() > 1) wish.normalize();
        wish.multiplyScalar(boost ? 11 : 6);
        const a = 1 - Math.exp(-(this.onGround ? 14 : 3) * dt);
        this.vel.x += (wish.x - this.vel.x) * a;
        this.vel.z += (wish.z - this.vel.z) * a;
        if (k.has("Space") && this.onGround) { this.vel.y = 8; this.onGround = false; }
      }
    } else if (this.fly) {
      this.vel.multiplyScalar(Math.exp(-8 * dt));
    } else {
      this.vel.x *= Math.exp(-14 * dt);
      this.vel.z *= Math.exp(-14 * dt);
    }
    if (!this.fly) this.vel.y = Math.max(this.vel.y - 24 * dt, -60);
    this.move(dt);
    this.placeCamera(t);
  }

  move(dt) {
    const d = this.vel.clone().multiplyScalar(dt);
    const steps = Math.max(1, Math.ceil(d.length() / 0.3));
    d.divideScalar(steps);
    const boxes = this.city.collidersNear(this.pos);
    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      this.axis("x", 0, d.x, boxes);
      this.axis("z", 2, d.z, boxes);
      this.axis("y", 1, d.y, boxes);
    }
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    }
  }

  axis(ax, i, delta, boxes) {
    if (!delta) return;
    const p = this.pos;
    p[ax] += delta;
    for (const b of boxes) {
      if (p.x + R <= b.min[0] || p.x - R >= b.max[0] || p.y + HEIGHT <= b.min[1] || p.y >= b.max[1] || p.z + R <= b.min[2] || p.z - R >= b.max[2]) continue;
      if (ax === "y") {
        if (delta > 0) p.y = b.min[1] - HEIGHT - 1e-4;
        else { p.y = b.max[1]; this.onGround = true; }
        this.vel.y = 0;
      } else if (!this.fly && b.max[1] - p.y <= 0.45) {
        p.y = b.max[1]; // step up a low ledge
      } else {
        p[ax] = delta > 0 ? b.min[i] - R - 1e-4 : b.max[i] + R + 1e-4;
        this.vel[ax] = 0;
      }
    }
  }

  placeCamera(t) {
    const cam = this.camera;
    cam.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    cam.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    if (this.third) {
      const back = new THREE.Vector3(0, 0, 1).applyEuler(cam.rotation).multiplyScalar(4.5);
      cam.position.add(back).add(new THREE.Vector3(0, 0.6, 0));
    }
    if (this.avatar) {
      this.avatar.position.copy(this.pos);
      if (this.fly) this.avatar.position.y += Math.sin(t * 2) * 0.08;
      this.avatar.rotation.y = this.yaw + Math.PI;
    }
  }
}
