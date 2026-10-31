import * as THREE from "three";

// Glowing text sprite. `lines[0]` is the title, the rest are smaller sub-lines.
export function makeLabel(lines, { color = "#22e6ff", px = 48, height = 1, bg = "rgba(2,8,14,0.72)" } = {}) {
  lines = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).map(String);
  const sizes = lines.map((_, i) => (i === 0 ? px : Math.round(px * 0.58)));
  const font = (i) => `${i === 0 ? 700 : 500} ${sizes[i]}px Orbitron, Rajdhani, "Segoe UI", sans-serif`;
  const pad = Math.round(px * 0.45);
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  let w = 0;
  lines.forEach((l, i) => { ctx.font = font(i); w = Math.max(w, ctx.measureText(l).width); });
  const lineH = sizes.map((s) => s * 1.25);
  c.width = Math.ceil(w + pad * 2);
  c.height = Math.ceil(lineH.reduce((a, b) => a + b, 0) + pad * 1.4);
  ctx.fillStyle = bg;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, px / 16);
  ctx.beginPath();
  ctx.roundRect(2, 2, c.width - 4, c.height - 4, px * 0.25);
  ctx.fill();
  ctx.stroke();
  let y = pad * 0.7;
  lines.forEach((l, i) => {
    ctx.font = font(i);
    ctx.textBaseline = "top";
    ctx.fillStyle = i === 0 ? color : "rgba(210,240,255,0.85)";
    ctx.shadowColor = color;
    ctx.shadowBlur = i === 0 ? px * 0.3 : 0;
    ctx.fillText(l, pad, y);
    y += lineH[i];
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const h = height * (c.height / (px * 1.6));
  sprite.scale.set(h * (c.width / c.height), h, 1);
  return sprite;
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    // Shared materials (houses, kiosks, desks) outlive any one object.
    for (const m of mats) { if (m.userData?.shared) continue; m.map?.dispose(); m.dispose(); }
  });
}
