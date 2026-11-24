// 🏁 Desk Karts, the world: the tracks, the karts' stats and looks, and the 3D scene. games-kart.js is
// the race itself (driving, items, bots, the room). three.js (web/vendor/three) loads the first time
// the game opens; the scene is drawn at the games' own 320×200 pixels into an off-screen canvas that
// is copied into the shell's canvas every frame, so the 3D is as crisp as the other games.
"use strict";

const KT = {
  STEP: 2, MARGIN: 5, WALL_H: 1.2, R: 0.9, MAX: 8, LAPS_MAX: 5, ITEMS_MAX: 48, RES: 2,   // RES: the 3D's pixels per game pixel
  START_IN: 5, LOBBY_PING: 20, LOBBY_GONE: 60, SEND: 0.125,
  G: 34, GRIP: 40, GRIP_DRIFT: 60, BRAKE: 34, COAST: 6, REV: 8, BUMP: 1.9,
  // drift charge: so much a second steering into the drift, less steering straight, least steering
  // out; a blue turbo past MT, an orange one (three times as long) past SMT
  CHARGE_IN: 300, CHARGE: 160, CHARGE_OUT: 100, MT: 270, SMT: 570,
};
const KCLASSES = [{ name: "Chill", top: 25, acc: 15 }, { name: "Fast", top: 29, acc: 17 }, { name: "Turbo", top: 33, acc: 19 }];
// The karts, in three weights. Each stat multiplies a balanced kart's: speed (top speed), acc, hand
// (how tight it can turn), weight (who pushes whom), drift (how tight a drift goes), off (speed off
// the road) and mt (how long drift turbos last).
const KCARS = [
  { id: "chair", name: "Swivel Chair", icon: "🪑", cls: "light", speed: 0.955, acc: 1.25, hand: 1.2, weight: 0.7, drift: 1.12, off: 1.3, mt: 1.3 },
  { id: "trolley", name: "Mail Trolley", icon: "📮", cls: "light", speed: 0.975, acc: 1.14, hand: 1.08, weight: 0.82, drift: 1.05, off: 1.15, mt: 1.18 },
  { id: "kart", name: "Desk Kart", icon: "🏎", cls: "medium", speed: 1, acc: 1, hand: 1, weight: 1, drift: 1, off: 1, mt: 1 },
  { id: "coffee", name: "Coffee Cart", icon: "☕", cls: "medium", speed: 0.99, acc: 0.97, hand: 1.1, weight: 1.05, drift: 1.18, off: 0.92, mt: 1.12 },
  { id: "copier", name: "Photocopier", icon: "🖨", cls: "heavy", speed: 1.04, acc: 0.75, hand: 0.84, weight: 1.45, drift: 0.9, off: 0.8, mt: 0.82 },
  { id: "forklift", name: "Forklift", icon: "🚜", cls: "heavy", speed: 1.035, acc: 0.85, hand: 0.88, weight: 1.6, drift: 0.86, off: 1.15, mt: 0.86 },
];
const kCar = id => KCARS.find(c => c.id === id) || KCARS[2];
// Control points [x, z] of each track's centre line (smoothed, then cut into samples KT.STEP apart),
// and where along a lap (0…1) its hills, kicker ramps (with the gap after one), boxes, boost pads,
// keyboard and fan are; puddles [from, to, left edge, right edge (×width), colour] where karts slide,
// and hazards that roll back and forth across the road (where, what, seconds per crossing, phase).
const KTRACKS = [
  { name: "Desk Circuit", theme: "desk", w: 7,
    pts: [[0, 0], [70, 0], [115, -8], [140, -35], [140, -75], [115, -100], [80, -100], [60, -80], [40, -60], [10, -62], [-20, -85], [-55, -110], [-100, -105], [-125, -75], [-120, -35], [-90, -8], [-50, 0]],
    bumps: [[0.505, 0.55, 2.4]], ramps: [[0.06, 0.078, 1.8]], keys: [0.87, 0.95], boxRows: [0.16, 0.36, 0.62, 0.8], pads: [0.035, 0.56],
    puddles: [[0.3, 0.335, -0.9, 0.2, "#6b4226"]], hazards: [{ f: 0.7, kind: "tape", period: 3.2, phase: 0 }, { f: 0.24, kind: "tape", period: 2.6, phase: 1.5 }] },
  { name: "Server Room", theme: "server", w: 6.5,
    pts: [[0, 0], [60, 0], [90, 10], [100, 40], [80, 65], [50, 60], [30, 80], [40, 110], [80, 120], [110, 150], [90, 180], [40, 185], [-10, 170], [-30, 140], [-60, 130], [-90, 110], [-95, 70], [-70, 40], [-60, 10], [-35, 0]],
    ramps: [[0.03, 0.046, 1.6], [0.548, 0.562, 1.3]], fan: [0.5, 0.585, -1], boxRows: [0.12, 0.3, 0.44, 0.76, 0.9], pads: [0.95, 0.34, 0.53],
    puddles: [[0.7, 0.735, -0.3, 0.9, "#3f8fb0"]], hazards: [{ f: 0.2, kind: "vacuum", period: 3.6, phase: 0 }, { f: 0.84, kind: "vacuum", period: 3, phase: 2 }] },
  { name: "Rooftop Run", theme: "roof", w: 7,
    pts: [[0, 0], [90, 0], [150, -10], [185, -45], [180, -95], [150, -125], [60, -128], [-30, -125], [-80, -115], [-110, -85], [-95, -50], [-115, -20], [-90, 5], [-45, 5]],
    bumps: [[0.13, 0.3, 4], [0.86, 0.97, 2.5]], ramps: [[0.43, 0.465, 3.2, 0.474]], boxRows: [0.1, 0.36, 0.56, 0.78], pads: [0.415, 0.06],
    puddles: [[0.33, 0.36, -0.8, 0.8, "#5a6a8a"]], hazards: [{ f: 0.62, kind: "barrel", period: 3.4, phase: 0 }, { f: 0.7, kind: "barrel", period: 2.8, phase: 1 }] },
  { name: "Break Room", theme: "kitchen", w: 7,
    pts: [[0, 0], [80, 0], [130, 15], [150, 55], [130, 95], [90, 100], [70, 80], [40, 90], [20, 130], [-30, 150], [-90, 140], [-120, 100], [-110, 50], [-70, 30], [-40, 8]],
    bumps: [[0.66, 0.72, 2.2]], ramps: [[0.535, 0.565, 2.6, 0.575]], boxRows: [0.12, 0.36, 0.62, 0.9], pads: [0.52, 0.03, 0.8],
    puddles: [[0.85, 0.89, -0.9, 0.9, "#7fb6d8"], [0.27, 0.3, 0, 0.9, "#6b4226"]], hazards: [{ f: 0.77, kind: "donut", period: 3, phase: 0 }, { f: 0.45, kind: "donut", period: 2.5, phase: 1 }] },
];
const KTHEMES = {
  desk: { sky: "#d9ccb6", fog: [70, 230], ground: "#8a5a3c", base: -0.05, asphalt: ["#5d5b66", "#57555f"], kerb: ["#e06c6c", "#f1ebe2"],
    shoulder: "#ddd3bd", wall: ["#e3c74f", "#d6b73d"], cap: "#d77fae", hemi: ["#fff6e6", "#6b4a33", 2.4], sun: ["#fff1d6", 2.2] },
  server: { sky: "#0b0e17", fog: [40, 170], ground: "#161a25", base: -0.05, asphalt: ["#30354a", "#2b2f42"], kerb: ["#4fc1c9", "#20242f"],
    shoulder: "#252a39", wall: ["#4a5368", "#434b5e"], cap: "#4fc1c9", hemi: ["#9fc2ff", "#1a1f2c", 2.8], sun: ["#b4d2ff", 2.2] },
  roof: { sky: null, fogc: "#b8708a", fog: [80, 320], ground: "#231a28", base: -40, asphalt: ["#4b4655", "#46414f"], kerb: ["#f0a35e", "#f1ebe2"],
    shoulder: "#7d7174", wall: ["#3d3344", "#372e3e"], cap: "#a8999c", hemi: ["#ffd2b0", "#2a1e30", 2.2], sun: ["#ffb27a", 2.6] },
  // the break room: the road runs along the counters, eight above the tiled floor
  kitchen: { sky: "#e9e3d7", fog: [90, 260], ground: "#d8d2c4", base: -8, asphalt: ["#53575f", "#4d5159"], kerb: ["#5fbf7f", "#f1ebe2"],
    shoulder: "#cfc6b4", wall: ["#8fbcd6", "#7fb0cc"], cap: "#f1ebe2", hemi: ["#fffaf0", "#8a7d6a", 2.5], sun: ["#fff4e0", 2.2] },
};
// What the item boxes give (games-kart.js decides which, and what each does)
const KITEMS = {
  espresso: { icon: "☕", name: "Espresso" }, espresso3: { icon: "☕", name: "Triple espresso" }, pot: { icon: "🫖", name: "Coffee pot" },
  note: { icon: "📝", name: "Sticky note" }, duck: { icon: "🦆", name: "Rubber duck" }, duck3: { icon: "🦆", name: "Three rubber ducks" },
  plane: { icon: "✈", name: "Paper plane" }, wrap: { icon: "🛡", name: "Bubble wrap" },
  rush: { icon: "🌟", name: "Caffeine rush" }, mail: { icon: "📧", name: "Reply-all" }, zap: { icon: "🔌", name: "Power cut" },
  overtime: { icon: "🚀", name: "Overtime" },
};

// ---------- tracks ----------
/// A track's samples, built once: each {x, z, y, fx, fz (the way forward), slope, gap, fan, trick,
/// off (the racing line's offset from the centre), k (how sharply the racing line bends)}, KT.STEP
/// apart along the smoothed centre line; sample 0 is the start line.
function kTrack(ti) {
  const t = KTRACKS[ti]; if (t.S) return t;
  const P = t.pts, dense = [];
  for (let i = 0; i < P.length; i++) {
    const p0 = P[(i - 1 + P.length) % P.length], p1 = P[i], p2 = P[(i + 1) % P.length], p3 = P[(i + 2) % P.length];
    for (let k = 0; k < 24; k++) {
      const s = k / 24, s2 = s * s, s3 = s2 * s;
      const cr = j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * s + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * s2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * s3);
      dense.push([cr(0), cr(1)]);
    }
  }
  let L = 0; const cum = [0];
  for (let i = 1; i <= dense.length; i++) { const a = dense[i - 1], b = dense[i % dense.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); cum.push(L); }
  const N = Math.round(L / KT.STEP), out = []; let j = 0;
  for (let i = 0; i < N; i++) {
    const d = i * L / N; while (cum[j + 1] < d) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length], u = (d - cum[j]) / (cum[j + 1] - cum[j]);
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  const inR = (f, r) => r && f >= r[0] && f < r[1];
  t.N = N; t.L = L; t.ds = L / N; t.S = [];
  for (let i = 0; i < N; i++) {
    const p = out[i], q = out[(i + 1) % N], o = out[(i - 1 + N) % N], f = i / N;
    let fx = q[0] - o[0], fz = q[1] - o[1]; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    let y = 0, trick = false, gap = false;
    for (const [f0, f1, h] of t.bumps || []) if (f >= f0 && f <= f1) { y += h * Math.sin(Math.PI * (f - f0) / (f1 - f0)) ** 2; if (f > (f0 + f1) / 2 - 0.01) trick = true; }
    for (const r of t.ramps || []) {
      if (f >= r[0] && f < r[1]) { y += r[2] * (f - r[0]) / (r[1] - r[0]); trick = true; }
      if (r[3] && f >= r[1] && f < r[3]) gap = true;
    }
    const wet = (t.puddles || []).find(q => f >= q[0] && f < q[1]);
    t.S.push({ x: p[0], z: p[1], y, fx, fz, gap, trick, fan: inR(f, t.fan) ? t.fan[2] : 0, keys: inR(f, t.keys), wet: wet ? [wet[2] * t.w, wet[3] * t.w, wet[4]] : null });
  }
  for (let i = 0; i < N; i++) {
    const s = t.S[i], a = t.S[(i - 1 + N) % N], b = t.S[(i + 1) % N];
    s.slope = b.gap || b.y < s.y - 0.5 ? (s.y - a.y) / t.ds : a.gap ? (b.y - s.y) / t.ds : (b.y - a.y) / (2 * t.ds);
  }
  // the racing line: an offset from the centre for each sample, pulled straight like a rubber band
  // so it cuts to the inside of every bend; then how sharply it bends at each sample
  const off = new Float64Array(N), lim = t.w * 0.55;
  const lx = i => t.S[i].x - t.S[i].fz * off[i], lz = i => t.S[i].z + t.S[i].fx * off[i];
  for (let it = 0; it < 400; it++) for (let i = 0; i < N; i++) {
    const a = (i - 3 + N) % N, b = (i + 3) % N, s = t.S[i];
    const mx = (lx(a) + lx(b)) / 2, mz = (lz(a) + lz(b)) / 2, want = (mx - s.x) * -s.fz + (mz - s.z) * s.fx;
    off[i] += (Math.max(-lim, Math.min(lim, want)) - off[i]) * 0.6;
  }
  for (let i = 0; i < N; i++) {
    const a = (i - 4 + N) % N, b = (i + 4) % N, s = t.S[i];
    const h1 = Math.atan2(lz(i) - lz(a), lx(i) - lx(a)), h2 = Math.atan2(lz(b) - lz(i), lx(b) - lx(i));
    s.off = off[i]; s.k = Math.abs(kWrap(h2 - h1)) / (8 * t.ds); s.turn = Math.sign(kWrap(h2 - h1));
  }
  const at = (i, lat) => { const s = t.S[i]; return { x: s.x - s.fz * lat, z: s.z + s.fx * lat, y: s.y + 1, i }; };
  t.boxes = []; for (const f of t.boxRows) for (const l of [-0.55, -0.18, 0.18, 0.55]) t.boxes.push(at(Math.floor(f * N), l * t.w));
  t.padAt = (t.pads || []).map(f => Math.floor(f * N));
  t.hz = (t.hazards || []).map(h => ({ ...h, i: Math.floor(h.f * N) }));
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const s of t.S) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
  t.bb = { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
  return t;
}
/// The nearest sample to a point, looking only near the last one (so a track that comes close to
/// itself never confuses it), and the point's offset from it: lat to the right, along forward.
function kNear(t, x, z, si) {
  const N = t.N; let best = 1e18, bi = si;
  for (let d = -40; d <= 40; d++) {
    const i = (si + d + N) % N, s = t.S[i], dx = x - s.x, dz = z - s.z, q = dx * dx + dz * dz;
    if (q < best) { best = q; bi = i; }
  }
  const s = t.S[bi];
  return { i: bi, lat: (x - s.x) * -s.fz + (z - s.z) * s.fx, along: (x - s.x) * s.fx + (z - s.z) * s.fz };
}
function kNearAll(t, x, z) {
  let best = 1e18, bi = 0;
  for (let i = 0; i < t.N; i++) { const s = t.S[i], q = (x - s.x) ** 2 + (z - s.z) ** 2; if (q < best) { best = q; bi = i; } }
  return bi;
}
const kGround = (t, n) => { const s = t.S[n.i]; return s.gap ? -1e3 : s.y + s.slope * Math.max(-t.ds, Math.min(t.ds, n.along)); };
const kWrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const kTan = s => Math.atan2(s.fz, s.fx);
/// A kart's spot on the starting grid: two abreast, staggered, rows 5 apart behind the line.
function kGrid(t, slot) {
  const row = Math.floor(slot / 2), side = slot % 2 ? 1 : -1, back = 5 + row * 5 + (slot % 2) * 2;
  const i = (t.N - Math.round(back / t.ds)) % t.N, s = t.S[i], lat = side * t.w * 0.42;
  return { x: s.x - s.fz * lat, z: s.z + s.fx * lat, y: s.y, a: kTan(s), si: i };
}

/// Where a rolling hazard is at a moment of the race: going back and forth across the road (the same
/// on every Mac, from the race's clock).
function kHazardAt(t, h, time) {
  const s = t.S[h.i], u = time / h.period * Math.PI * 2 + h.phase, lat = Math.sin(u) * (t.w - 1.4);
  return { x: s.x - s.fz * lat, y: s.y, z: s.z + s.fx * lat, lat, roll: Math.cos(u) };
}

// ---------- 3D ----------
/// three.js is big: it loads the first time the game opens, not with the office.
function kLoad() {
  if (KR.state === "ready" || KR.state === "loading") return;
  if (window.THREE) return kInitGL();
  KR.state = "loading";
  const s = document.createElement("script");
  s.src = "vendor/three/three.min.js";
  s.onload = () => kInitGL();
  s.onerror = () => { KR.state = "failed"; KR.err = "three.js did not load"; };
  document.head.appendChild(s);
}
/// The 3D has its own canvas, shown right under the games' canvas where the game is (which leaves a
/// hole there and draws the HUD on top): copying WebGL pixels into a 2D canvas every frame makes
/// WebKit read them back from the GPU, and the frames stutter.
function kInitGL() {
  try {
    const c = document.createElement("canvas"); c.width = GW * KT.RES; c.height = GH * KT.RES;
    c.addEventListener("webglcontextlost", e => { e.preventDefault(); KR.state = "lost"; });
    c.addEventListener("webglcontextrestored", () => { KR.state = "ready"; });
    Object.assign(c.style, { position: "absolute", pointerEvents: "none", imageRendering: "pixelated", display: "none", zIndex: "0" });
    gcv.parentNode.style.position = "relative"; gcv.style.position = "relative"; gcv.style.zIndex = "1";
    gcv.parentNode.insertBefore(c, gcv);
    KR.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: false, powerPreference: "high-performance" });
    KR.renderer.setPixelRatio(1); KR.renderer.setSize(GW * KT.RES, GH * KT.RES, false);
    KR.glc = c;
    KR.cam = new THREE.PerspectiveCamera(68, GW / GH, 0.3, 700);
    KR.camPos = new THREE.Vector3(); KR.camLook = new THREE.Vector3();
    KR.state = "ready";
  } catch (e) { KR.state = "failed"; KR.err = "3D is not available here"; }
}
const kCol = c => new THREE.Color(c);
function kMat(c, o) {
  const key = c + JSON.stringify(o || {});
  return KR.mats[key] || (KR.mats[key] = new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...o }));
}
function kBasic(c, o) {
  const key = "b" + c + JSON.stringify(o || {});
  return KR.mats[key] || (KR.mats[key] = new THREE.MeshBasicMaterial({ color: c, ...o }));
}
function kBoxG(w, h, d) { const key = `b${w},${h},${d}`; return KR.geos[key] || (KR.geos[key] = new THREE.BoxGeometry(w, h, d)); }
function kCylG(r1, r2, h, n) { const key = `c${r1},${r2},${h},${n}`; return KR.geos[key] || (KR.geos[key] = new THREE.CylinderGeometry(r1, r2, h, n)); }
function kAdd(parent, geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m; }
/// A small pixel texture drawn with the 2D canvas: nearest-neighbour, so it stays pixel art.
function kTex(w, h, paint, rx, ry) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); paint(x, w, h);
  const tx = new THREE.CanvasTexture(c);
  tx.magFilter = THREE.NearestFilter; tx.minFilter = THREE.NearestFilter; tx.generateMipmaps = false; tx.colorSpace = THREE.SRGBColorSpace;
  if (rx) { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(rx, ry || rx); tx.minFilter = THREE.LinearMipmapLinearFilter; tx.generateMipmaps = true; }
  return tx;
}
/// The road, its kerbs, the shoulders and the walls of a track, as one mesh coloured per vertex.
function kRoadGeo(t, th) {
  const pos = [], col = [], N = t.N, S = t.S, w = t.w, M = KT.MARGIN, cache = {};
  const C = c => cache[c] || (cache[c] = kCol(c));
  const P = (i, u, lat, dy) => {                     // a point between sample i and the next (u 0…1), lat to the right
    const a = S[i], b = S[(i + 1) % N], x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u, y = a.y + (b.y - a.y) * u;
    const fx = a.fx + (b.fx - a.fx) * u, fz = a.fz + (b.fz - a.fz) * u;
    return [x - fz * lat, dy === undefined ? y + 0.01 : dy === "base" ? th.base : y + dy, z + fx * lat];
  };
  const quad = (a, b, c, d, color) => { const k = C(color); pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let n = 0; n < 6; n++) col.push(k.r, k.g, k.b); };
  const strip = (i, l0, l1, color, u0, u1) => quad(P(i, u0 || 0, l0), P(i, u1 || 1, l0), P(i, u1 || 1, l1), P(i, u0 || 0, l1), color);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N; if (S[i].gap || S[j].gap) continue;
    const kerb = th.kerb[Math.floor(i / 2) % 2], asph = th.asphalt[Math.floor(i / 4) % 2], ramp = S[i].trick && S[j].y > S[i].y + 0.05;
    strip(i, -w - M, -w, th.shoulder); strip(i, w, w + M, th.shoulder);
    strip(i, -w, -w + 0.9, kerb); strip(i, w - 0.9, w, kerb);
    if (i === 0) {                                    // the start line: a checkerboard
      for (let c = 0; c < 10; c++) for (let r = 0; r < 2; r++) {
        const l0 = -w + 0.9 + c * (2 * w - 1.8) / 10, l1 = l0 + (2 * w - 1.8) / 10;
        strip(i, l0, l1, (c + r) % 2 ? "#1b1820" : "#f1ebe2", r / 2, (r + 1) / 2);
      }
    } else if (S[i].keys) {                           // the keyboard: rows of keys across the road
      for (let c = 0; c < 6; c++) { const l0 = -w + 0.9 + c * (2 * w - 1.8) / 6, l1 = l0 + (2 * w - 1.8) / 6; strip(i, l0, l1, (c + i) % 2 ? "#e8e4dc" : "#d2cdc3"); }
    } else if (ramp) {                                // a kicker: yellow and black stripes
      for (let c = 0; c < 8; c++) { const l0 = -w + 0.9 + c * (2 * w - 1.8) / 8, l1 = l0 + (2 * w - 1.8) / 8; strip(i, l0, l1, (c + i) % 2 ? "#e3c74f" : "#2b2630"); }
    } else strip(i, -w + 0.9, w - 0.9, asph);
    const wc = th.wall[Math.floor(i / 3) % 2];
    for (const sg of [-1, 1]) {
      const L = sg * (w + M), a = P(i, 0, L, "base"), b = P(i, 1, L, "base"), c = P(i, 1, L, KT.WALL_H), d = P(i, 0, L, KT.WALL_H);
      quad(a, b, c, d, wc);
      quad(P(i, 0, L, KT.WALL_H), P(i, 1, L, KT.WALL_H), P(i, 1, L + sg * 0.6, KT.WALL_H), P(i, 0, L + sg * 0.6, KT.WALL_H), th.cap);
      if (th.base < -1) quad(P(i, 0, L + sg * 0.6, KT.WALL_H), P(i, 1, L + sg * 0.6, KT.WALL_H), P(i, 1, L + sg * 0.6, "base"), P(i, 0, L + sg * 0.6, "base"), th.wall[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
/// A track's whole scene, built once: sky and light, the ground, the road, the props, boxes and pads.
function kScene(ti) {
  if (KR.scenes[ti]) return KR.scenes[ti];
  const T = THREE, t = kTrack(ti), th = KTHEMES[t.theme], sc = new T.Scene(), rnd = seeded(hash("kart" + t.name));
  sc.fog = new T.Fog(th.fogc || th.sky, th.fog[0], th.fog[1]);
  sc.background = th.sky ? kCol(th.sky) : kTex(1, 64, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#2b1f4a"); g.addColorStop(0.45, "#7d3f6e"); g.addColorStop(0.75, "#e0866a"); g.addColorStop(1, "#f4c07a");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
  sc.add(new T.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]));
  const sun = new T.DirectionalLight(th.sun[0], th.sun[1]); sun.position.set(60, 120, 40); sc.add(sun);
  const groundTex = t.theme === "desk" ? kTex(16, 16, (x) => { x.fillStyle = "#8a5a3c"; x.fillRect(0, 0, 16, 16); x.fillStyle = "#7d5134"; for (let i = 0; i < 16; i += 4) x.fillRect(0, i, 16, 1); x.fillStyle = "#94633f"; x.fillRect(3, 2, 6, 1); x.fillRect(9, 10, 5, 1); }, 120)
    : t.theme === "kitchen" ? kTex(16, 16, (x) => { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? "#e8e2d4" : "#b9c8d2"; x.fillRect(i * 8, j * 8, 8, 8); } x.fillStyle = "#a59f92"; x.fillRect(0, 0, 16, 1); x.fillRect(0, 0, 1, 16); }, 90)
    : t.theme === "server" ? kTex(16, 16, (x) => { x.fillStyle = "#161a25"; x.fillRect(0, 0, 16, 16); x.fillStyle = "#2a3146"; x.fillRect(0, 0, 16, 1); x.fillRect(0, 0, 1, 16); }, 120)
    : kTex(16, 16, (x) => { x.fillStyle = "#231a28"; x.fillRect(0, 0, 16, 16); x.fillStyle = "#3a2b30"; x.fillRect(0, 7, 16, 2); x.fillStyle = "#ffe7a8"; x.fillRect(4, 8, 1, 1); x.fillRect(12, 8, 1, 1); }, 60);
  // the ground: in many pieces (two huge triangles lose their depth precision and show through the
  // road), a little below it, and pushed back in the depth test
  const ground = new T.Mesh(new T.PlaneGeometry(1600, 1600, 64, 64), new T.MeshLambertMaterial({ map: groundTex, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(t.bb.cx, th.base - 0.12, t.bb.cz); sc.add(ground);
  sc.add(new T.Mesh(kRoadGeo(t, th), new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide })));
  // the start gantry
  const s0 = t.S[0], gan = new T.Group(); gan.position.set(s0.x, s0.y, s0.z); gan.rotation.y = -kTan(s0); sc.add(gan);
  const flag = kTex(16, 4, (x) => { for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? "#1b1820" : "#f1ebe2"; x.fillRect(i, j, 1, 1); } });
  for (const sg of [-1, 1]) kAdd(gan, kBoxG(0.6, 6.5, 0.6), kMat("#2b2630"), 0, 3.25, sg * (t.w + 1));
  kAdd(gan, kBoxG(0.4, 1.4, 2 * t.w + 2.6), new T.MeshLambertMaterial({ map: flag }), 0, 6.2, 0);
  // the start lights over the line: red, red, red, then green
  sc.userData.lights = [-1.6, 0, 1.6].map(z => kAdd(gan, kBoxG(0.5, 0.9, 0.9), kBasic("#3a1414").clone(), -0.3, 7.6, z));
  // boost pads
  const chev = kTex(8, 8, (x) => { x.fillStyle = "#f0a35e"; x.fillRect(0, 0, 8, 8); x.fillStyle = "#ffe7a8"; for (let i = 0; i < 4; i++) { x.fillRect(1 + i, i, 2, 1); x.fillRect(1 + i, 7 - i, 2, 1); } });
  for (const p of t.padAt) {
    const s = t.S[(p + 1) % t.N], pad = new T.Mesh(new T.PlaneGeometry(t.ds * 3, 4.6), new T.MeshBasicMaterial({ map: chev }));
    pad.rotation.order = "YXZ"; pad.rotation.y = -kTan(s); pad.rotation.x = -Math.PI / 2; pad.position.set(s.x, s.y + 0.06, s.z); sc.add(pad);
  }
  // item boxes: cardboard parcels with a star sticker
  const boxTex = kTex(8, 8, (x) => { x.fillStyle = "#c08a55"; x.fillRect(0, 0, 8, 8); x.fillStyle = "#a87445"; x.fillRect(0, 3, 8, 2); x.fillStyle = "#ffe066"; x.fillRect(3, 1, 2, 6); x.fillRect(1, 3, 6, 2); x.fillRect(2, 2, 4, 4); });
  const boxMat = new T.MeshLambertMaterial({ map: boxTex });
  sc.userData.boxes = t.boxes.map(b => kAdd(sc, kBoxG(1.3, 1.3, 1.3), boxMat, b.x, b.y, b.z));
  sc.userData.anim = [];
  // puddles: karts slide on them
  const wet = {};
  t.S.forEach((s, i) => { if (s.wet) (wet[s.wet[2]] = wet[s.wet[2]] || []).push(i); });
  for (const [color, idx] of Object.entries(wet)) {
    const pos = [];
    for (const i of idx) {
      const a = t.S[i], b = t.S[(i + 1) % t.N], l0 = a.wet[0], l1 = a.wet[1], wob = k => 0.6 * Math.sin(i * 1.7 + k);
      const P = (q, l) => [q.x - q.fz * l, q.y + 0.04, q.z + q.fx * l];
      pos.push(...P(a, l0 + wob(0)), ...P(b, l0 + wob(1)), ...P(b, l1 - wob(2)), ...P(a, l0 + wob(0)), ...P(b, l1 - wob(2)), ...P(a, l1 - wob(3)));
    }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    sc.add(new T.Mesh(g, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: T.DoubleSide, depthWrite: false })));
  }
  // the rolling hazards
  sc.userData.hz = t.hz.map(h => {
    const g = new T.Group(), spin = new T.Group(); g.add(spin); sc.add(g); g.rotation.y = -kTan(t.S[h.i]);
    if (h.kind === "tape") {                         // a roll of tape, rolling across on its edge
      const r = kAdd(spin, new T.TorusGeometry(1.3, 0.55, 6, 14), kMat("#c9d6e0")); r.rotation.y = Math.PI / 2;
      const c = kAdd(spin, new T.TorusGeometry(0.75, 0.2, 4, 12), kMat("#a87445")); c.rotation.y = Math.PI / 2;
      spin.position.y = 1.85;
    } else if (h.kind === "donut") {                 // a donut with pink icing and sprinkles
      const r = kAdd(spin, new T.TorusGeometry(1.25, 0.6, 6, 14), kMat("#c9874f")); r.rotation.y = Math.PI / 2;
      const ic = kAdd(spin, new T.TorusGeometry(1.25, 0.62, 6, 14, Math.PI), kMat("#e98fb8")); ic.rotation.y = Math.PI / 2;
      for (let i = 0; i < 6; i++) kAdd(spin, kBoxG(0.15, 0.15, 0.4), kBasic(SHIRTS[i]), 0.55, Math.cos(i) * 1.2, Math.sin(i) * 1.2);
      spin.position.y = 1.85;
    } else if (h.kind === "barrel") {                // a rooftop barrel, rolling on its side
      const b = kAdd(spin, kCylG(0.95, 0.95, 2.0, 10), kMat("#c0473d")); b.rotation.z = Math.PI / 2;
      for (const x of [-0.6, 0.6]) { const band = kAdd(spin, kCylG(1.0, 1.0, 0.15, 10), kMat("#3b3542")); band.rotation.z = Math.PI / 2; band.position.x = x; }
      spin.position.y = 1.0;
    } else {                                         // a robot vacuum, gliding about with a blinking light
      kAdd(spin, kCylG(1.5, 1.5, 0.5, 14), kMat("#d8dce4"), 0, 0.3, 0);
      kAdd(spin, kCylG(1.2, 1.2, 0.08, 14), kMat("#8f9bd9"), 0, 0.58, 0);
      kAdd(spin, kCylG(1.56, 1.56, 0.12, 14), kBasic("#4fc1c9"), 0, 0.1, 0);
      const led = kAdd(spin, kBoxG(0.3, 0.1, 0.3), kBasic("#5fe07f").clone(), 0.7, 0.62, 0);
      sc.userData.anim.push(ts => { led.visible = Math.floor(ts * 3) % 2 === 0; });
    }
    return { h, g, spin };
  });
  kProps(sc, t, th, rnd);
  const warm = new T.Group(); warm.position.set(t.S[0].x, -500, t.S[0].z); sc.add(warm);
  for (const kind of ["duck", "note", "plane", "mail"]) warm.add(kItemMesh(kind));
  warm.add(kKartMesh({ id: "warm", name: "", car: KCARS[0], color: "#888888", bot: true }));
  kAdd(warm, new T.SphereGeometry(1, 10, 8), kBasic("#ffb347", { transparent: true, opacity: 0.6, depthWrite: false }));
  try { KR.renderer.compile(sc, KR.cam); } catch (e) {}
  sc.remove(warm);
  KR.scenes[ti] = sc;
  return sc;
}
/// Somewhere off the track for a prop: at least `clear` beyond the walls.
function kSpot(t, rnd, clear, spread) {
  for (let n = 0; n < 40; n++) {
    const x = t.bb.x0 - spread + rnd() * (t.bb.x1 - t.bb.x0 + 2 * spread), z = t.bb.z0 - spread + rnd() * (t.bb.z1 - t.bb.z0 + 2 * spread);
    let ok = true;
    for (let i = 0; i < t.N && ok; i += 2) if ((t.S[i].x - x) ** 2 + (t.S[i].z - z) ** 2 < (t.w + KT.MARGIN + clear) ** 2) ok = false;
    if (ok) return [x, z];
  }
  return null;
}
function kProps(sc, t, th, rnd) {
  const T = THREE, anim = sc.userData.anim;
  if (t.theme === "desk") {
    for (let n = 0; n < 12; n++) {                    // pencils lying about
      const p = kSpot(t, rnd, 3, 40); if (!p) continue;
      const g = new T.Group(); g.position.set(p[0], 0.7, p[1]); g.rotation.y = rnd() * Math.PI; sc.add(g);
      const body = kAdd(g, kCylG(0.7, 0.7, 16, 6), kMat(["#e3c74f", "#5b8def", "#e06c6c"][n % 3])); body.rotation.z = Math.PI / 2;
      const tip = kAdd(g, kCylG(0, 0.7, 2.4, 6), kMat("#e8c89a"), -9.2, 0, 0); tip.rotation.z = -Math.PI / 2;
      const eraser = kAdd(g, kCylG(0.7, 0.7, 1.6, 6), kMat("#d77fae"), 8.8, 0, 0); eraser.rotation.z = Math.PI / 2;
    }
    for (let n = 0; n < 6; n++) {                     // giant coffee mugs
      const p = kSpot(t, rnd, 8, 30); if (!p) continue;
      const g = new T.Group(); g.position.set(p[0], 0, p[1]); sc.add(g);
      kAdd(g, kCylG(5, 4.6, 9, 12), kMat("#f1ebe2"), 0, 4.5, 0);
      kAdd(g, kCylG(5.08, 4.9, 2.2, 12), kMat(SHIRTS[(n * 3 + 1) % SHIRTS.length]), 0, 5.2, 0);
      kAdd(g, kCylG(4.5, 4.5, 0.2, 12), kMat("#4a2c1c"), 0, 8.6, 0);
      kAdd(g, new T.TorusGeometry(2.4, 0.7, 4, 8), kMat("#f1ebe2"), 5.4, 4.5, 0);
    }
    for (let n = 0; n < 16; n++) {                    // sticky notes and paper, flat on the desk (under the road's level)
      const big = n % 4 === 0, p = kSpot(t, rnd, big ? 14 : 5, 50); if (!p) continue;
      const m = kAdd(sc, kBoxG(big ? 16 : 6, 0.04, big ? 22 : 6), kMat(big ? "#f1ebe2" : ["#ffe066", "#d77fae", "#8fd6b4"][n % 3], { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), p[0], -0.06, p[1]);
      m.rotation.y = rnd() * Math.PI;
    }
    const mon = new T.Group(); mon.position.set(t.bb.cx, 0, t.bb.z0 - 70); sc.add(mon);   // a monitor at the desk's back
    kAdd(mon, kBoxG(110, 62, 4), kMat("#1b1820"), 0, 44, 0);
    kAdd(mon, kBoxG(102, 55, 0.5), kBasic("#2e5d8a"), 0, 44, 2.1);
    kAdd(mon, kBoxG(10, 14, 6), kMat("#2b2630"), 0, 7, -2); kAdd(mon, kBoxG(36, 1.5, 22), kMat("#2b2630"), 0, 0.7, -2);
    for (let i = 0; i < 6; i++) kAdd(mon, kBoxG(40 + (i * 37) % 50, 2.4, 0.2), kBasic(i % 2 ? "#8fd6b4" : "#ffe7a8"), -20 + (i * 13) % 24, 62 - i * 6, 2.4);
    for (let n = 0; n < 4; n++) {                     // stacks of books
      const p = kSpot(t, rnd, 6, 30); if (!p) continue;
      const g = new T.Group(); g.position.set(p[0], 0, p[1]); g.rotation.y = rnd() * Math.PI; sc.add(g);
      for (let b = 0; b < 3 + n % 3; b++) { const bk = kAdd(g, kBoxG(9 - b * 0.4, 1.6, 6.5), kMat(SHIRTS[(n * 4 + b) % SHIRTS.length]), 0, 0.8 + b * 1.6, 0); bk.rotation.y = (rnd() - 0.5) * 0.4; kAdd(g, kBoxG(8.6 - b * 0.4, 1.4, 0.1), kMat("#f1ebe2"), 0, 0.8 + b * 1.6, 3.27); }
    }
    { const p = kSpot(t, rnd, 10, 30); if (p) {        // a desk lamp, lit
      const g = new T.Group(); g.position.set(p[0], 0, p[1]); sc.add(g);
      kAdd(g, kCylG(4, 4.5, 1, 10), kMat("#2b2630"), 0, 0.5, 0);
      const arm1 = kAdd(g, kBoxG(0.7, 16, 0.7), kMat("#e06c6c"), 2, 8, 0); arm1.rotation.z = -0.3;
      const arm2 = kAdd(g, kBoxG(0.7, 12, 0.7), kMat("#e06c6c"), 7, 17, 0); arm2.rotation.z = 0.9;
      const head = kAdd(g, kCylG(1.5, 4, 4, 10), kMat("#e06c6c"), 12, 20, 0); head.rotation.z = 0.5;
      kAdd(g, kCylG(1.3, 1.3, 0.3, 10), kBasic("#fff6c8"), 12.6, 18.4, 0);
    } }
    for (let n = 0; n < 3; n++) {                     // potted plants
      const p = kSpot(t, rnd, 7, 30); if (!p) continue;
      const g = new T.Group(); g.position.set(p[0], 0, p[1]); sc.add(g);
      kAdd(g, kCylG(3, 2.4, 4.5, 8), kMat("#c0704a"), 0, 2.25, 0);
      for (let i = 0; i < 6; i++) kAdd(g, new T.SphereGeometry(2.2, 6, 5), kMat(i % 2 ? "#5fbf7f" : "#4a9a5e"), Math.cos(i) * 1.8, 6 + (i % 3) * 1.6, Math.sin(i) * 1.8);
    }
  } else if (t.theme === "server") {
    const leds = [kBasic("#5fbf7f"), kBasic("#4fc1c9"), kBasic("#f0a35e")].map(m => m.clone());
    for (let n = 0; n < 46; n++) {                    // racks with blinking lights
      const p = kSpot(t, rnd, 2, 30); if (!p) continue;
      const g = new T.Group(); g.position.set(p[0], 0, p[1]); g.rotation.y = Math.round(rnd() * 4) * Math.PI / 2; sc.add(g);
      kAdd(g, kBoxG(5, 14, 3.2), kMat("#363d4e"), 0, 7, 0);
      for (let r = 0; r < 7; r++) for (let c = 0; c < 3; c++) if (rnd() < 0.6) kAdd(g, kBoxG(0.5, 0.35, 0.1), leds[(r + c + n) % 3], -1.6 + c * 1.6, 2 + r * 1.7, 1.65);
    }
    for (let n = 0; n < 24; n++) {                    // cables along the floor
      const p = kSpot(t, rnd, 1, 40); if (!p) continue;
      const m = kAdd(sc, kBoxG(0.4, 0.2, 20 + rnd() * 40), kBasic(["#4fc1c9", "#d77fae", "#e3c74f", "#5b8def"][n % 4]), p[0], 0.1, p[1]); m.rotation.y = rnd() * Math.PI;
    }
    anim.push(ts => leds.forEach((m, i) => { m.visible = Math.floor(ts * (2 + i) + i) % 3 !== 0; }));
    for (let n = 0; n < 6; n++) {                     // cooling units with spinning fans
      const p = kSpot(t, rnd, 4, 30); if (!p) continue;
      const g = new T.Group(); g.position.set(p[0], 0, p[1]); g.rotation.y = rnd() * Math.PI; sc.add(g);
      kAdd(g, kBoxG(7, 6, 7), kMat("#4a5368"), 0, 3, 0);
      const fanB = new T.Group(); fanB.position.set(0, 6.1, 0); g.add(fanB);
      for (let b = 0; b < 3; b++) { const bl = kAdd(fanB, kBoxG(5, 0.1, 0.9), kMat("#cfd5e6")); bl.rotation.y = b * Math.PI / 3; }
      anim.push(ts => { fanB.rotation.y = ts * 6 + n; });
    }
    // the fan that blows karts across the road
    const fi = Math.floor((t.fan[0] + t.fan[1]) / 2 * t.N), s = t.S[fi], side = -t.fan[2] * (t.w + KT.MARGIN + 6);
    const fan = new T.Group(); fan.position.set(s.x - s.fz * side, 7, s.z + s.fx * side); fan.rotation.y = -kTan(s); sc.add(fan);
    const ring = kAdd(fan, new T.TorusGeometry(7, 0.9, 6, 16), kMat("#8f9bd9")); ring.rotation.y = Math.PI / 2;
    const blades = new T.Group(); fan.add(blades);
    for (let b = 0; b < 4; b++) { const bl = kAdd(blades, kBoxG(0.3, 12, 2), kMat("#cfd5e6")); bl.rotation.x = b * Math.PI / 4; }
    kAdd(fan, kBoxG(2, 2, 2), kMat("#2b2630"));
    anim.push(ts => { blades.rotation.x = ts * 9; });
    const streaks = [];
    for (let n = 0; n < 10; n++) { const m = kAdd(sc, kBoxG(0.15, 0.15, 3), kBasic("#cfe8ff", { transparent: true, opacity: 0.5 })); streaks.push(m); }
    anim.push(ts => streaks.forEach((m, n) => {
      const i = (Math.floor(t.fan[0] * t.N) + (n * 7) % Math.max(1, Math.floor((t.fan[1] - t.fan[0]) * t.N))) % t.N, ss = t.S[i];
      const u = ((ts * 0.6 + n * 0.37) % 1) * 2 - 1, lat = -t.fan[2] * -u * (t.w + KT.MARGIN);
      m.position.set(ss.x - ss.fz * lat, ss.y + 1 + (n % 3), ss.z + ss.fx * lat); m.rotation.y = -kTan(ss);
    }));
  } else if (t.theme === "kitchen") {
    const fl = th.base;
    { const p = kSpot(t, rnd, 16, 30); if (p) {       // the fridge
      const g = new T.Group(); g.position.set(p[0], fl, p[1]); g.rotation.y = rnd() * Math.PI; sc.add(g);
      kAdd(g, kBoxG(16, 44, 14), kMat("#eef0f2"), 0, 22, 0); kAdd(g, kBoxG(16.2, 0.4, 14.2), kMat("#a9a4ad"), 0, 30, 0);
      kAdd(g, kBoxG(0.8, 8, 1), kMat("#a9a4ad"), 6, 36, 7.2); kAdd(g, kBoxG(0.8, 10, 1), kMat("#a9a4ad"), 6, 22, 7.2);
      for (let i = 0; i < 4; i++) kAdd(g, kBoxG(2, 2, 0.2), kBasic(SHIRTS[i * 2]), -4 + i * 2.5, 38 - (i % 2) * 3, 7.1);
    } }
    { const p = kSpot(t, rnd, 12, 30); if (p) {       // the coffee machine, with its carafe and a red light
      const g = new T.Group(); g.position.set(p[0], fl, p[1]); g.rotation.y = rnd() * Math.PI; sc.add(g);
      kAdd(g, kBoxG(12, 26, 10), kMat("#2b2630"), 0, 13, 0); kAdd(g, kBoxG(12, 3, 14), kMat("#2b2630"), 0, 24.5, 2);
      kAdd(g, kCylG(3.2, 3.6, 7, 10), kMat("#9fd8ff", { transparent: true, opacity: 0.55 }), 0, 6, 5); kAdd(g, kCylG(3.0, 3.4, 3, 10), kMat("#4a2c1c"), 0, 4.2, 5);
      const led = kAdd(g, kBoxG(0.8, 0.8, 0.3), kBasic("#ff4040"), 4, 20, 5.1); anim.push(ts => { led.visible = Math.floor(ts * 1.2) % 2 === 0; });
    } }
    for (let n = 0; n < 5; n++) {                     // giant mugs and donuts on the floor
      const p = kSpot(t, rnd, 6, 50); if (!p) continue;
      if (n % 2) { const d = kAdd(sc, new T.TorusGeometry(4, 2, 6, 12), kMat("#c9874f"), p[0], fl + 2, p[1]); d.rotation.x = Math.PI / 2; const ic = kAdd(sc, new T.TorusGeometry(4, 2.05, 6, 12, Math.PI * 2), kMat(n % 4 === 1 ? "#e98fb8" : "#6b4226"), p[0], fl + 2.6, p[1]); ic.rotation.x = Math.PI / 2; ic.scale.set(1, 1, 0.6); }
      else { kAdd(sc, kCylG(5, 4.6, 10, 12), kMat("#f1ebe2"), p[0], fl + 5, p[1]); kAdd(sc, kCylG(5.08, 4.9, 2.2, 12), kMat(SHIRTS[n * 3 % SHIRTS.length]), p[0], fl + 6, p[1]); }
    }
    // the sink under the jump: fall short and you land in the water
    const gi = t.S.findIndex(s => s.gap);
    if (gi >= 0) {
      const gs = t.S[gi], g = new T.Group(); g.position.set(gs.x, fl, gs.z); g.rotation.y = -kTan(gs); sc.add(g);
      const W = 2 * (t.w + KT.MARGIN) + 2;
      kAdd(g, kBoxG(14, 5.5, W), kMat("#a9b2bc"), 2, 2.75, 0); kAdd(g, kBoxG(12, 0.2, W - 2), kBasic("#7fb6d8"), 2, 5.0, 0);
      kAdd(g, kBoxG(1, 9, 1), kMat("#c9d0d8"), 2, 9, W / 2 + 1); kAdd(g, kBoxG(1, 1, 4), kMat("#c9d0d8"), 2, 13, W / 2 - 1);
    }
  } else {
    const win = kTex(8, 16, (x) => { x.fillStyle = "#2c2234"; x.fillRect(0, 0, 8, 16); for (let r = 1; r < 16; r += 3) for (let c = 1; c < 8; c += 3) { x.fillStyle = (r * 7 + c * 3) % 5 < 2 ? "#ffd98a" : "#3e3048"; x.fillRect(c, r, 2, 2); } });
    for (let n = 0; n < 60; n++) {                    // the city around the roofs
      const p = kSpot(t, rnd, 6, 120); if (!p) continue;
      const hgt = 20 + rnd() * 60, wd = 12 + rnd() * 18, dp = 12 + rnd() * 18;
      const tex = win.clone(); tex.needsUpdate = true; tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(Math.max(1, Math.round(wd / 5)), Math.max(1, Math.round(hgt / 8)));
      const b = kAdd(sc, new T.BoxGeometry(wd, hgt, dp), new T.MeshLambertMaterial({ map: tex, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.35 }), p[0], th.base + hgt / 2, p[1]);
      b.rotation.y = rnd() * 0.3;
      if (rnd() < 0.3) { kAdd(sc, kCylG(2.2, 2.2, 4, 8), kMat("#8a6a50"), p[0], th.base + hgt + 3, p[1]); kAdd(sc, kBoxG(0.3, 2, 0.3), kMat("#5a4a40"), p[0], th.base + hgt + 1, p[1]); }
      if (rnd() < 0.2) { kAdd(sc, kBoxG(0.4, 14, 0.4), kMat("#9a909a"), p[0] + 3, th.base + hgt + 7, p[1]); const lamp = kAdd(sc, kBoxG(0.8, 0.8, 0.8), kBasic("#ff5a5a"), p[0] + 3, th.base + hgt + 14.4, p[1]); anim.push(ts => { lamp.visible = Math.floor(ts * 1.5 + n) % 2 === 0; }); }
    }
    { const p = kSpot(t, rnd, 14, 40); if (p) {      // a water tower on stilts
      const g = new T.Group(); g.position.set(p[0], 0, p[1]); sc.add(g);
      for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) kAdd(g, kBoxG(0.5, 14, 0.5), kMat("#5a4a40"), x, 4, z);
      kAdd(g, kCylG(5, 5, 8, 10), kMat("#8a6a50"), 0, 15, 0); kAdd(g, kCylG(0, 5.6, 3, 10), kMat("#5a4a40"), 0, 20.5, 0);
    } }
    const sunDisc = new T.Mesh(new T.CircleGeometry(40, 20), new T.MeshBasicMaterial({ color: "#ffcf8a", fog: false }));
    sunDisc.position.set(t.bb.cx - 420, 30, t.bb.cz - 300); sunDisc.lookAt(t.bb.cx, 0, t.bb.cz); sc.add(sunDisc);
    // the street far below the gap
    const gi = t.S.findIndex(s => s.gap), gs = t.S[Math.max(0, gi)];
    for (let n = 0; n < 8; n++) kAdd(sc, kBoxG(1.2, 1.2, 2.2), kBasic(n % 2 ? "#ffe7a8" : "#e06c6c"), gs.x + (n - 4) * 5, th.base + 0.8, gs.z + (n % 3) * 4);
  }
}

// ---------- the karts' looks ----------
/// The driver's look: their lounge picture as a pixel sprite, else null (a blocky driver is drawn).
function kDriverSprite(k) {
  try {
    if (k.bot || typeof pixelSprite !== "function") return null;
    let cut = null;
    if (k.id === myId()) cut = typeof mgrCut !== "undefined" ? mgrCut : null;
    else if (typeof mateCuts !== "undefined") { const c = mateCuts.get(k.id); cut = c && c.cut; }
    if (!cut) return null;
    const sp = pixelSprite(cut, 24), tx = new THREE.CanvasTexture(sp);
    tx.magFilter = THREE.NearestFilter; tx.minFilter = THREE.NearestFilter; tx.generateMipmaps = false; tx.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, alphaTest: 0.5 }));
    const hgt = 1.9; s.scale.set(hgt * sp.width / sp.height, hgt, 1);
    return s;
  } catch (e) { return null; }
}
/// Each kart's own body, facing +x, in the driver's colour where it has paint; returns where the
/// driver sits.
function kBuildCar(body, id, color) {
  const c = kMat(color), dark = kMat("#1b1820"), grey = kMat("#2b2630"), wheel = (x, z, r) => kAdd(body, kBoxG(r || 0.58, r || 0.58, 0.34), dark, x, (r || 0.58) / 2, z);
  if (id === "chair") {                              // a swivel chair: five legs on casters, seat, backrest, arms
    for (let i = 0; i < 5; i++) { const leg = kAdd(body, kBoxG(1.0, 0.12, 0.18), grey, 0, 0.3, 0); leg.rotation.y = i * Math.PI * 2 / 5; leg.position.set(Math.cos(i * 1.2566) * 0.45, 0.3, -Math.sin(i * 1.2566) * 0.45); kAdd(body, kBoxG(0.26, 0.24, 0.26), dark, Math.cos(i * 1.2566) * 0.95, 0.12, -Math.sin(i * 1.2566) * 0.95); }
    kAdd(body, kCylG(0.12, 0.12, 0.55, 6), kMat("#8a8590"), 0, 0.62, 0);
    kAdd(body, kBoxG(1.25, 0.26, 1.2), c, 0, 0.98, 0);
    kAdd(body, kBoxG(0.22, 1.1, 1.1), c, -0.6, 1.6, 0);
    for (const z of [-0.62, 0.62]) { kAdd(body, kBoxG(0.7, 0.1, 0.14), dark, 0.05, 1.35, z); kAdd(body, kBoxG(0.1, 0.3, 0.1), dark, -0.15, 1.18, z); }
    return { x: -0.1, y: 1.1 };
  }
  if (id === "trolley") {                            // a mail trolley: a low deck, a sorting bin full of letters, a handle
    kAdd(body, kBoxG(2.5, 0.16, 1.3), grey, 0, 0.42, 0);
    for (const [x, z] of [[0.95, 0.6], [0.95, -0.6], [-0.95, 0.6], [-0.95, -0.6]]) wheel(x, z, 0.46);
    kAdd(body, kBoxG(1.1, 0.8, 1.2), c, 0.55, 0.9, 0);
    for (let i = 0; i < 4; i++) kAdd(body, kBoxG(0.08, 0.34, 0.5), kMat(i % 2 ? "#f1ebe2" : "#ffe7a8"), 0.25 + i * 0.2, 1.42, (i % 2 ? 0.2 : -0.2));
    for (const z of [-0.55, 0.55]) kAdd(body, kBoxG(0.1, 1.1, 0.1), dark, -1.2, 1.0, z);
    kAdd(body, kBoxG(0.1, 0.1, 1.2), dark, -1.2, 1.55, 0);
    return { x: -0.55, y: 0.5 };
  }
  if (id === "coffee") {                             // a coffee cart: a counter, an espresso machine, a striped awning
    kAdd(body, kBoxG(2.2, 0.75, 1.3), c, 0, 0.75, 0);
    kAdd(body, kBoxG(2.3, 0.1, 1.4), kMat("#f1ebe2"), 0, 1.16, 0);
    kAdd(body, kBoxG(0.55, 0.55, 0.45), kMat("#a9a4ad"), 0.6, 1.45, 0.25);
    kAdd(body, kBoxG(0.2, 0.2, 0.2), kMat("#4a2c1c"), 0.85, 1.32, 0.25);
    for (const [x, z] of [[0.75, 0.68], [0.75, -0.68], [-0.75, 0.68], [-0.75, -0.68]]) wheel(x, z, 0.5);
    for (const z of [-0.6, 0.6]) kAdd(body, kBoxG(0.08, 1.1, 0.08), grey, 0.9, 1.7, z);
    for (let i = 0; i < 4; i++) kAdd(body, kBoxG(0.42, 0.08, 1.5), kMat(i % 2 ? "#f1ebe2" : color), 0.25 + i * 0.42 - 0.4, 2.28, 0);
    return { x: -0.55, y: 1.2 };
  }
  if (id === "copier") {                             // a photocopier: a big box with a lid, a paper tray and a panel
    kAdd(body, kBoxG(2.4, 1.15, 1.5), kMat("#d8d4cc"), 0, 0.85, 0);
    kAdd(body, kBoxG(2.42, 0.22, 1.52), c, 0, 0.55, 0);
    kAdd(body, kBoxG(1.1, 0.14, 1.3), grey, 0.55, 1.5, 0);
    kAdd(body, kBoxG(0.6, 0.06, 1.0), kMat("#f1ebe2"), 1.45, 0.75, 0);
    for (let i = 0; i < 3; i++) kAdd(body, kBoxG(0.12, 0.08, 0.12), kBasic(["#5fbf7f", "#ffe7a8", "#e06c6c"][i]), 1.1, 1.47, -0.4 + i * 0.25);
    for (const [x, z] of [[0.9, 0.72], [0.9, -0.72], [-0.9, 0.72], [-0.9, -0.72]]) wheel(x, z, 0.5);
    return { x: -0.55, y: 1.45 };
  }
  if (id === "forklift") {                           // a forklift: a body with a counterweight, a mast with forks, a cage
    kAdd(body, kBoxG(1.8, 0.75, 1.3), c, -0.1, 0.75, 0);
    kAdd(body, kBoxG(0.5, 0.8, 1.3), grey, -1.05, 0.8, 0);
    for (const z of [-0.45, 0.45]) { kAdd(body, kBoxG(0.14, 2.6, 0.14), grey, 0.95, 1.4, z); kAdd(body, kBoxG(1.2, 0.08, 0.2), kMat("#a9a4ad"), 1.55, 0.22, z); }
    for (const [x, z] of [[0.6, 0.6], [0.6, -0.6], [-0.8, 0.6], [-0.8, -0.6]]) kAdd(body, kBoxG(0.12, 1.4, 0.12), dark, x, 1.8, z);
    kAdd(body, kBoxG(1.6, 0.1, 1.4), dark, -0.1, 2.5, 0);
    for (const [x, z] of [[0.6, 0.72], [0.6, -0.72], [-0.75, 0.72], [-0.75, -0.72]]) wheel(x, z, 0.7);
    return { x: -0.35, y: 1.1 };
  }
  // the desk kart: the plain kart
  kAdd(body, kBoxG(2.1, 0.32, 1.25), c, 0, 0.42, 0);
  kAdd(body, kBoxG(0.7, 0.22, 1.05), c, 1.15, 0.36, 0);
  kAdd(body, kBoxG(0.3, 0.18, 1.6), grey, 1.5, 0.3, 0);
  kAdd(body, kBoxG(0.22, 0.32, 0.95), grey, -0.8, 0.72, 0);
  kAdd(body, kBoxG(0.2, 0.34, 1.3), c, -1.05, 0.44, 0);
  kAdd(body, kBoxG(0.12, 0.35, 0.5), dark, 0.4, 0.85, 0);
  for (const [x, z] of [[0.75, 0.7], [0.75, -0.7], [-0.7, 0.72], [-0.7, -0.72]]) wheel(x, z);
  return { x: -0.4, y: 0.62 };
}
function kKartMesh(k) {
  const T = THREE, g = new T.Group(), body = new T.Group(), c = kMat(k.color);
  g.add(body); body.rotation.order = "YXZ";
  const seat = kBuildCar(body, k.car.id, k.color);
  const pic = kDriverSprite(k);
  if (pic) { pic.position.set(seat.x, seat.y + 0.85, 0); body.add(pic); }
  else {
    kAdd(body, kBoxG(0.5, 0.62, 0.62), c, seat.x, seat.y + 0.3, 0);
    kAdd(body, kBoxG(0.46, 0.46, 0.46), kMat("#f0c8a0"), seat.x, seat.y + 0.84, 0);
    kAdd(body, kBoxG(0.52, 0.2, 0.52), kMat("#f1ebe2"), seat.x, seat.y + 1.12, 0);
  }
  const shadow = kAdd(g, kCylG(1.4, 1.4, 0.02, 10), kBasic("#000000", { transparent: true, opacity: 0.3, depthWrite: false }), 0, 0.04, 0);
  const shield = kAdd(g, new T.SphereGeometry(1.8, 8, 6), kBasic("#9fd8ff", { transparent: true, opacity: 0.35, depthWrite: false }), 0, 0.9, 0);
  const aura = kAdd(g, kBoxG(3.2, 2.6, 2.2), kBasic("#ffe066", { transparent: true, opacity: 0.3, depthWrite: false }).clone(), 0, 1.0, 0);
  const flame = kAdd(body, kBoxG(0.6, 0.3, 0.5), kBasic("#ffb347"), -1.4, 0.45, 0);
  const sparkMats = [kBasic("#f1ebe2"), kBasic("#7fd0ff"), kBasic("#ffb347")];
  const sparks = [-0.72, 0.72].map(z => kAdd(body, kBoxG(0.3, 0.3, 0.3), sparkMats[0], -1.1, 0.2, z));
  // overtime: the kart rides inside a rocket
  const rocket = new T.Group(); g.add(rocket);
  const hull = kAdd(rocket, kCylG(1.15, 1.15, 3.2, 10), kMat("#3b3542")); hull.rotation.z = Math.PI / 2; hull.position.y = 1.1;
  const nose = kAdd(rocket, kCylG(0, 1.15, 1.4, 10), kMat("#e06c6c")); nose.rotation.z = -Math.PI / 2; nose.position.set(2.3, 1.1, 0);
  for (const z of [-1, 1]) kAdd(rocket, kBoxG(0.9, 0.12, 0.9), kMat("#e06c6c"), -1.3, 1.1, z * 1.1);
  const rflame = kAdd(rocket, kBoxG(1.0, 0.8, 0.8), kBasic("#ffb347"), -2.2, 1.1, 0);
  // power cut: a little storm cloud over the kart
  const cloud = new T.Group(); g.add(cloud);
  kAdd(cloud, kBoxG(1.6, 0.6, 1.0), kMat("#55535a"), 0, 3.4, 0); kAdd(cloud, kBoxG(0.15, 0.6, 0.15), kBasic("#ffe066"), 0.2, 2.9, 0);
  const smoke = [0, 1, 2].map(i => kAdd(g, kBoxG(0.5, 0.5, 0.5), kBasic("#a79d93", { transparent: true, opacity: 0.6, depthWrite: false }), -1.6 - i * 0.4, 0.6 + i * 0.4, 0));
  const drone = new T.Group(); g.add(drone);
  kAdd(drone, kBoxG(1.2, 0.3, 1.2), kMat("#f1ebe2"));
  for (const [x, z] of [[0.8, 0.8], [0.8, -0.8], [-0.8, 0.8], [-0.8, -0.8]]) kAdd(drone, kCylG(0.5, 0.5, 0.05, 8), kBasic("#a79d93"), x, 0.2, z);
  kAdd(drone, kBoxG(0.05, 1.2, 0.05), kMat("#1b1820"), 0, -0.6, 0);
  // held items: one dragged behind, up to three going round
  const trail = new T.Group(); trail.position.set(-2.2, 0, 0); g.add(trail);
  const orbit = new T.Group(); g.add(orbit);
  g.userData = { body, shadow, shield, aura, flame, sparks, sparkMats, rocket, rflame, cloud, smoke, drone, trail, orbit, trailKind: "", orbitKey: "" };
  return g;
}
function kItemMesh(kind) {
  const T = THREE, g = new T.Group();
  if (kind === "duck") {                           // big and bright, so it is seen coming
    const y = kBasic("#ffd84a");
    kAdd(g, kBoxG(1.6, 1.0, 1.25), y, 0, 0.6, 0); kAdd(g, kBoxG(0.4, 0.5, 0.9), y, -0.85, 0.95, 0);
    kAdd(g, kBoxG(0.85, 0.85, 0.85), y, 0.55, 1.45, 0);
    kAdd(g, kBoxG(0.5, 0.2, 0.55), kBasic("#f08a3a"), 1.1, 1.35, 0); kAdd(g, kBoxG(0.14, 0.18, 1.0), kBasic("#1b1820"), 0.8, 1.6, 0);
    kAdd(g, kCylG(1.0, 1.0, 0.02, 10), kBasic("#000000", { transparent: true, opacity: 0.3, depthWrite: false }), 0, 0.03, 0);
  } else if (kind === "note") {
    const m = kAdd(g, kBoxG(1.5, 0.06, 1.5), kMat("#ffe066"), 0, 0.05, 0); m.rotation.y = 0.3;
    kAdd(g, kBoxG(1.0, 0.07, 0.1), kMat("#8a7d4a"), 0, 0.06, 0.2);
  } else if (kind === "mail") {
    kAdd(g, kBoxG(1.6, 0.15, 1.1), kMat("#f1ebe2"), 0, 0, 0);
    kAdd(g, kBoxG(0.4, 0.17, 0.4), kBasic("#e06c6c"), 0, 0.01, 0);
    kAdd(g, kBoxG(1.3, 0.16, 0.08), kMat("#c9c2b8"), 0.1, 0.01, 0.3); kAdd(g, kBoxG(1.3, 0.16, 0.08), kMat("#c9c2b8"), 0.1, 0.01, -0.3);
  } else {
    const w = kAdd(g, new T.ConeGeometry(0.9, 2, 3), kMat("#f1ebe2", { side: T.DoubleSide })); w.rotation.z = -Math.PI / 2; w.scale.set(1, 1, 0.25);
  }
  return g;
}
