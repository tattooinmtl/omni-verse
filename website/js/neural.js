// The memory map illustration: residents are orange hubs, journal events are
// small synapses wired to the agents they involve, and bonds between agents
// are violet links. Signals run along the links. Drawn on a 2D canvas.

const KINDS = [
  { type: "build", color: "#22e6ff", say: (a) => `${a[0]} added a floor to their home` },
  { type: "meet", color: "#9b6bff", say: (a) => `${a[0]} and ${a[1]} talked on the street` },
  { type: "visit", color: "#ff3df2", say: (a) => `${a[0]} visited ${a[1]}'s house` },
  { type: "trade", color: "#39ff88", say: (a) => `${a[1]} bought scrap at ${a[0]}'s kiosk` },
  { type: "craft", color: "#ffe14d", say: (a) => `${a[0]} crafted a decoration` },
];

export function createNeural(canvas, tip, names, { still = false } = {}) {
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  const nodes = [], links = [];
  const hubs = names.map((name, i) => {
    const n = { kind: "hub", name, x: Math.cos((i / names.length) * 6.283) * 0.3, y: Math.sin((i / names.length) * 6.283) * 0.3, r: 9, color: "#ff9f1c", deg: 0 };
    nodes.push(n);
    return n;
  });
  for (let k = 0; k < 150; k++) {
    const kind = KINDS[Math.floor(rand() * KINDS.length)];
    const a = hubs[Math.floor(rand() * hubs.length)];
    let b = hubs[Math.floor(rand() * hubs.length)];
    if (b === a) b = hubs[(hubs.indexOf(a) + 1) % hubs.length];
    const pair = kind.type === "build" || kind.type === "craft" ? [a] : [a, b];
    const n = { kind: "event", name: kind.say(pair.map((h) => h.name)), type: kind.type, x: a.x + (rand() - 0.5) * 0.3, y: a.y + (rand() - 0.5) * 0.3, r: 2 + rand() * 1.6, color: kind.color };
    nodes.push(n);
    for (const h of pair) { links.push({ a: n, b: h, color: kind.color, w: 0.7 }); h.deg++; }
  }
  // Bonds between agents.
  for (let i = 0; i < hubs.length; i++) for (let j = i + 1; j < hubs.length; j++) {
    if (rand() < 0.55) links.push({ a: hubs[i], b: hubs[j], color: "#9b6bff", w: 1.6 + rand() * 2.4, bond: true });
  }
  for (const h of hubs) h.r = 8 + Math.sqrt(h.deg) * 1.6;

  // A short force layout, computed once.
  for (let it = 0; it < 260; it++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const p = nodes[i], q = nodes[j];
      const dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy + 1e-4;
      const f = (p.kind === "hub" && q.kind === "hub" ? 0.004 : 0.00012) / d2;
      p.x += dx * f; p.y += dy * f; q.x -= dx * f; q.y -= dy * f;
    }
    for (const l of links) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.hypot(dx, dy) || 1e-3;
      const rest = l.bond ? 0.42 : 0.1, k = (d - rest) * (l.bond ? 0.01 : 0.05);
      const mx = (dx / d) * k, my = (dy / d) * k;
      if (l.a.kind !== "hub" || l.bond) { l.a.x += mx; l.a.y += my; }
      if (l.bond) { l.b.x -= mx; l.b.y -= my; }
    }
    for (const n of nodes) { n.x *= 0.995; n.y *= 0.995; }
  }
  // Fit the layout to -1..1 on each axis so it fills the frame.
  const ex = nodes.reduce((m, n) => Math.max(m, Math.abs(n.x)), 0.01), ey = nodes.reduce((m, n) => Math.max(m, Math.abs(n.y)), 0.01);
  for (const n of nodes) { n.x /= ex; n.y /= ey; n.ph = rand() * 6.28; }

  const signals = Array.from({ length: 50 }, () => ({ l: links[Math.floor(rand() * links.length)], t: rand(), v: 0.15 + rand() * 0.35 }));
  let hover = null, mouse = null;

  function resize() {
    dpr = Math.min(window.devicePixelRatio, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.max(1, W * dpr); canvas.height = Math.max(1, H * dpr);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const P = (n, t) => {
    const wob = still ? 0 : 0.008;
    return [W / 2 + (n.x + Math.sin(t * 0.6 + n.ph) * wob) * (W / 2 - 40), H / 2 + (n.y + Math.cos(t * 0.5 + n.ph) * wob) * (H / 2 - 30)];
  };

  canvas.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); mouse = [e.clientX - r.left, e.clientY - r.top]; });
  canvas.addEventListener("pointerleave", () => { mouse = null; });

  let t = 0, last = performance.now();
  return {
    frame() {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!still) t += dt;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      const pos = new Map(nodes.map((n) => [n, P(n, t)]));
      // Hover: the nearest node under the pointer.
      hover = null;
      if (mouse) {
        let best = 14;
        for (const n of nodes) { const [x, y] = pos.get(n), d = Math.hypot(x - mouse[0], y - mouse[1]) - n.r; if (d < best) { best = d; hover = n; } }
      }
      const lit = hover ? new Set(links.filter((l) => l.a === hover || l.b === hover).flatMap((l) => [l.a, l.b])) : null;
      for (const l of links) {
        const [x1, y1] = pos.get(l.a), [x2, y2] = pos.get(l.b);
        const on = !lit || (lit.has(l.a) && lit.has(l.b) && (l.a === hover || l.b === hover));
        ctx.strokeStyle = l.color;
        ctx.globalAlpha = on ? (l.bond ? 0.55 : 0.28) : 0.05;
        ctx.lineWidth = l.w;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      for (const s of signals) {
        s.t += s.v * dt;
        if (s.t > 1) { s.t = 0; s.l = links[Math.floor(Math.random() * links.length)]; }
        const [x1, y1] = pos.get(s.l.a), [x2, y2] = pos.get(s.l.b);
        const x = x1 + (x2 - x1) * s.t, y = y1 + (y2 - y1) * s.t;
        ctx.globalAlpha = lit ? 0.2 : 0.9;
        ctx.fillStyle = "#e8fbff";
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 6.283); ctx.fill();
      }
      for (const n of nodes) {
        const [x, y] = pos.get(n);
        const on = !lit || lit.has(n);
        const g = ctx.createRadialGradient(x, y, 0, x, y, n.r * 3);
        g.addColorStop(0, n.color); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = on ? (n.kind === "hub" ? 0.55 : 0.35) : 0.06;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, n.r * 3, 0, 6.283); ctx.fill();
        ctx.globalAlpha = on ? 1 : 0.15;
        ctx.fillStyle = n.kind === "hub" ? "#ffd29a" : n.color;
        ctx.beginPath(); ctx.arc(x, y, n.r * (n === hover ? 1.4 : 1), 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.font = "15px VT323, monospace";
      ctx.textAlign = "center";
      for (const h of hubs) {
        const [x, y] = pos.get(h);
        ctx.fillStyle = !lit || lit.has(h) ? "#ffd29a" : "rgba(255,210,154,0.2)";
        ctx.fillText(h.name.toUpperCase(), x, y - h.r - 6);
      }
      const text = hover ? (hover.kind === "hub" ? `${hover.name} · ${hover.deg} memories` : hover.name) : "Hover a node";
      if (tip.textContent !== text) tip.textContent = text;
    },
  };
}
