import * as THREE from "three";
import { buildAvatar } from "./avatar.js";
import { disposeObject, makeLabel } from "./labels.js";
import { progressRing } from "./economy.js";

// An agent as this page draws it. Where it is and what it does are decided by
// the server's loop (server/sim.mjs); the page receives about five snapshots a
// second and plays them back a quarter of a second behind, interpolating
// between them, so movement stays smooth over network jitter (AI Town plays
// its server history back the same way). Bubbles and the gathering ring
// follow what the server says the agent is doing.
const DELAY = 250; // ms behind the newest snapshot

export class AgentNPC {
  // Set by main.js: resource kind → colour, for the gathering ring.
  static colorOf = null;

  constructor(record, scene) {
    this.record = record;
    this.mesh = buildAvatar(record.spec);
    const h = record.spec.height;
    this.height = h;
    this.sub = null;
    this.mood = null;
    this.setNameplate(null);
    this.hitbox = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.9, h * 0.5), h, Math.max(0.9, h * 0.5)), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = h / 2;
    this.hitbox.userData.interact = { type: "agent", npc: this };
    this.mesh.add(this.hitbox);
    scene.add(this.mesh);
    this.mesh.visible = false; // until the first snapshot places it
    this.pos = new THREE.Vector3();
    this.samples = [];   // [{ t, x, y, z, yaw }] newest last
    this.where = "on the street";
    this.mode = "idle";
    this.talkingTo = null; // a visitor's chat panel is open on it
    this.bubble = null;
    this.sayId = 0;
    this.ring = null;
    this.seed = Math.random() * 10;
  }

  // Name + provider · model, and its mood (server/mind.mjs); a substitute
  // brain (server/life.mjs) shows as "⇄ minimax.io · …".
  setNameplate(sub, mood = this.mood) {
    if (this.nameplate) { this.mesh.remove(this.nameplate); disposeObject(this.nameplate); }
    this.sub = sub;
    this.mood = mood;
    const r = this.record;
    const line = sub ? `⇄ ${sub.provider} · ${sub.model.split("/").pop()} (for ${r.provider})` : `${r.provider} · ${r.model.split("/").pop()}`;
    this.nameplate = makeLabel([r.spec.name, line, mood ? `${mood.emoji} ${mood.mood}` : ""], { color: sub ? "#ffe14d" : r.spec.palette.glow, px: 40, height: 0.26 });
    this.nameplate.position.y = this.height + 0.45;
    this.mesh.add(this.nameplate);
  }

  get whereabouts() { return this.where; }

  // One agent's entry from a server snapshot taken at server time t.
  apply(s, t) {
    const prev = this.samples.at(-1);
    // A jump of more than 8 m (entering a tower, arriving at a lot) is a cut, not a walk.
    if (prev && Math.hypot(prev.x - s.x, prev.z - s.z) > 8) this.samples = [];
    this.samples.push({ t, x: s.x, y: s.y, z: s.z, yaw: s.yaw });
    if (this.samples.length > 30) this.samples.splice(0, this.samples.length - 30);
    this.where = s.where;
    this.mode = s.mode;
    if (!s.say && this.sayId) { this.sayId = 0; this.clearBubble(); }
    if (s.say && s.say.id !== this.sayId) { this.sayId = s.say.id; this.say(s.say.text); }
    if (s.channel && !this.ring) {
      this.ring = progressRing(AgentNPC.colorOf?.(s.channel.kind) || "#22e6ff");
      this.ring.position.y = this.height + 0.9;
      this.mesh.add(this.ring);
    } else if (!s.channel && this.ring) { this.mesh.remove(this.ring); disposeObject(this.ring); this.ring = null; }
    if (this.ring && s.channel) this.ring.userData.set(s.channel.p);
    this.mesh.visible = true;
  }

  say(textLine, color) {
    this.clearBubble();
    if (!textLine) return;
    const words = textLine.split(/\s+/), rows = [];
    let row = "";
    for (const w of words) {
      if ((row + " " + w).length > 38 && row) { rows.push(row); row = w; } else row = row ? `${row} ${w}` : w;
    }
    if (row) rows.push(row);
    this.bubble = makeLabel([this.record.spec.name, ...rows.slice(0, 5)], { color: color || this.record.spec.palette.glow, px: 44, height: 0.3 });
    this.bubble.position.y = this.height + 1.3;
    this.mesh.add(this.bubble);
  }

  // A short line from this page (a build or craft event) that clears itself.
  flash(textLine, color, ms = 2600) {
    this.say(textLine, color);
    const b = this.bubble;
    setTimeout(() => { if (this.bubble === b) this.clearBubble(); }, ms);
  }

  clearBubble() {
    if (!this.bubble) return;
    this.mesh.remove(this.bubble);
    disposeObject(this.bubble);
    this.bubble = null;
  }

  // serverNow: the server clock as best this page knows it.
  update(t, dt, playerPos, serverNow) {
    this.mesh.userData.update(t, dt);
    const sm = this.samples;
    if (sm.length) {
      const at = serverNow - DELAY;
      let a = sm[0], b = sm[0];
      for (let i = sm.length - 1; i >= 0; i--) { if (sm[i].t <= at) { a = sm[i]; b = sm[i + 1] || sm[i]; break; } }
      const k = b.t > a.t ? Math.min(1, Math.max(0, (at - a.t) / (b.t - a.t))) : 1;
      this.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      let dy = b.yaw - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.mesh.rotation.y = a.yaw + dy * k;
    }
    if (this.talkingTo) this.mesh.rotation.y = Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    this.mesh.position.copy(this.pos);
    this.mesh.position.y += 0.06 + Math.sin(t * 3 + this.seed) * 0.05;
  }
}
