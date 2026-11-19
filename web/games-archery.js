// 🏹 Archery (games.js is the shell): five ends of three arrows at a target that moves further away,
// on your own.
//
// Aim with the mouse (or ↑↓ / W S), hold Space or the mouse button to draw the bow and let go to
// shoot. Arrows fall, and the wind (it changes every end, shown by the flag) pushes them on or holds
// them back. The rings count by how far from the centre the arrow lands: 10, 8, 6, 4, 2, or nothing
// off the target. Held at full draw too long, the aim starts to shake. In the last end the target
// rides up and down. A round's total (at most 150) goes to the leaderboard.
"use strict";

const ARC = {
  GROUND: 170, BOW_X: 36, BOW_Y: 140, G: 300, ENDS: 5, PER_END: 3,
  DIST: [140, 175, 210, 250, 290],            // where the target stands in each end
  RINGS: [[2, 10, "#f0c040"], [5, 8, "#e06c6c"], [8, 6, "#5b8def"], [11, 4, "#2a2326"], [14, 2, "#f1ebe2"]],
};
const ARCH = { phase: "idle", end: 0, arrow: 0, ends: [], aim: 0.35, power: 0, held: 0, drawing: false, mouseAim: false,
  shot: null, stuck: [], wind: 0, tx: 140, tyBase: 130, pause: 0, pops: [], total: 0 };

function archStart() {
  Object.assign(ARCH, { phase: "aim", end: 0, arrow: 0, ends: [], total: 0, power: 0, held: 0, drawing: false, shot: null, stuck: [], pops: [] });
  newEnd();
  gshow("archery");
}
function newEnd() {
  const A = ARCH;
  A.tx = ARC.DIST[A.end]; A.tyBase = 118 + Math.random() * 22; A.stuck = []; A.arrow = 0; A.ends[A.end] = [];
  A.wind = Math.round((Math.random() * 2 - 1) * (10 + A.end * 5));          // px/s², + blows toward the target
}
/// Where the target's centre is now (it rides up and down in the last end).
function targetY(t) { return ARCH.end === ARC.ENDS - 1 ? ARCH.tyBase + Math.sin(t * 1.3) * 14 : ARCH.tyBase; }
function ringOf(dy) { const r = ARC.RINGS.find(([d]) => Math.abs(dy) <= d); return r ? r[1] : 0; }

function shoot() {
  const A = ARCH;
  if (A.power < 0.15) { A.power = 0; A.held = 0; return; }       // a tap: no shot
  const speed = 90 + A.power * 260, a = A.aim + sway();
  A.shot = { x: ARC.BOW_X + 6, y: ARC.BOW_Y - 2, vx: Math.cos(a) * speed, vy: -Math.sin(a) * speed };
  A.phase = "fly"; A.power = 0; A.held = 0; A.drawing = false;
}
/// Held at full draw for more than half a second, the aim shakes more and more.
function sway() { const over = Math.max(0, ARCH.held - 0.6); return over ? Math.sin(performance.now() / 140) * Math.min(0.12, over * 0.05) : 0; }

function archStep(dt) {
  const A = ARCH, k = GAME.keys, t = performance.now() / 1000;
  if (A.phase === "aim") {
    if (k.has("arrowup") || k.has("w")) { A.aim += dt * 0.7; A.mouseAim = false; }
    if (k.has("arrowdown") || k.has("s")) { A.aim -= dt * 0.7; A.mouseAim = false; }
    A.aim = Math.max(-0.2, Math.min(1.1, A.aim));
    if (A.drawing) { A.power = Math.min(1, A.power + dt * 0.85); if (A.power >= 1) A.held += dt; }
  }
  if (A.phase === "fly") {
    const s = A.shot, px = s.x, py = s.y;
    s.vx += A.wind * dt; s.vy += ARC.G * dt; s.x += s.vx * dt; s.y += s.vy * dt;
    // through the target's face this frame?
    if (px < A.tx && s.x >= A.tx) {
      const y = py + (s.y - py) * (A.tx - px) / (s.x - px), dy = y - targetY(t), pts = Math.abs(dy) <= 14 ? ringOf(dy) : -1;
      if (pts >= 0) return land(pts, A.tx, y, Math.atan2(s.vy, s.vx));
    }
    if (s.y >= ARC.GROUND) return land(0, s.x, ARC.GROUND, Math.atan2(s.vy, s.vx));
    if (s.x > GW + 20 || s.x < -20) return land(0, null);
  }
  if (A.phase === "pause" || A.phase === "endsum") {
    A.pause -= dt;
    if (A.pause <= 0) {
      if (A.phase === "pause") {
        if (A.arrow < ARC.PER_END) A.phase = "aim";
        else { A.phase = "endsum"; A.pause = 1.8; }
      } else if (A.end + 1 < ARC.ENDS) { A.end++; newEnd(); A.phase = "aim"; side(); }
      else finishRound();
    }
  }
  A.pops = A.pops.filter(p => (p.life -= dt) > 0);
  const windTxt = A.wind ? `wind ${A.wind > 0 ? "→" : "←"} ${Math.abs(A.wind)}` : "no wind";
  ginfo.textContent = A.phase === "over" ? `round over · ${A.total} points` :
    `end ${A.end + 1}/${ARC.ENDS} · arrow ${Math.min(ARC.PER_END, A.arrow + (A.phase === "aim" || A.phase === "fly" ? 1 : 0))}/${ARC.PER_END} · ${A.total} pts · ${windTxt}`;
}
/// An arrow came down: in the target (pts ≥ 0 and x = the target), in the ground, or off the range.
function land(pts, x, y, angle) {
  const A = ARCH, onTarget = x === A.tx;
  A.ends[A.end].push(pts); A.total += pts; A.arrow++;
  if (x !== null) A.stuck.push({ x, y, angle, onTarget, dy: onTarget ? y - targetY(performance.now() / 1000) : 0 });
  A.pops.push({ x: x === null ? GW - 30 : x, y: (y || 100) - 10, text: onTarget ? (pts === 10 ? "10 ✕" : String(pts)) : "miss", life: 1.2, c: pts >= 8 ? "#ffe7a8" : "#f1ebe2" });
  if (pts === 10) achieve("bullseye");
  if (A.arrow === ARC.PER_END && A.ends[A.end].every(p => p === 10)) achieve("hat-trick");
  A.shot = null; A.phase = "pause"; A.pause = 0.9;
  side();
}
function finishRound() {
  const A = ARCH;
  A.phase = "over";
  achieve("archer");
  if (A.total >= 120) achieve("sharpshooter");
  const pb = A.total > 0 && scoreBoard("archery", A.total);
  toast(`🏹 ${A.total} points${pb ? " · your best round!" : ""}`, null, 5000);
  side();
}

function archSide() {
  const A = ARCH, best = store("bests", {}).archery;
  const rows = A.ends.map((e, i) => `<div class="row"><span class="n">end ${i + 1}${i === A.end && A.phase !== "over" ? " ◂" : ""}</span><span class="v">${e.join(" · ") || "–"}  = ${e.reduce((s, p) => s + p, 0)}</span></div>`).join("");
  gside.innerHTML = `<h3>HOW</h3><div class="hint">Aim with the mouse or ↑ ↓. Hold Space (or the mouse button) to draw, let go to shoot. Mind the wind; don't hold a full draw too long.</div>
    <h3>THIS ROUND</h3>${rows}<div class="row"><span class="n"><b>total</b></span><span class="v"><b>${A.total}</b> / 150</span></div>
    <h3>YOUR BEST</h3><div class="hint">${best ? best + " points" : "no round yet"}</div>
    <h3>&nbsp;</h3>${A.phase === "over" ? `<button class="go" data-again="1">Play again</button> ` : ""}<button data-home="1">Games</button>`;
}

function drawArcher(x, y, A, t) {
  // a figure facing right, the bow arm toward the aim
  const c = myColor(), a = A.phase === "aim" ? A.aim + sway() : A.aim, pull = A.phase === "aim" ? A.power : 0;
  gpx(x - 3, y - 2, 6, 12, c); gpx(x - 3, y - 2, 6, 1, "#ffffff40");
  gpx(x - 2, y - 9, 5, 6, "#f1c9a5"); gpx(x - 2, y - 10, 5, 2, "#3b2c27");
  gpx(x - 3, y + 10, 2, 8, "#3b4258"); gpx(x + 1, y + 10, 2, 8, "#3b4258");
  const bx = ARC.BOW_X, by = ARC.BOW_Y, ca = Math.cos(a), sa = Math.sin(a);
  gx.strokeStyle = "#f1c9a5"; gx.lineWidth = 1.5; gx.beginPath(); gx.moveTo(x + 1, y + 1); gx.lineTo(bx, by); gx.stroke();
  // the bow: an arc across the aim, its string pulled back with the draw
  const ux = -sa, uy = -ca, r = 9;                  // up the bow (perpendicular to the aim)
  const top = [bx + ux * r, by + uy * r], bot = [bx - ux * r, by - uy * r], back = [bx - ca * (2 + pull * 8), by + sa * (2 + pull * 8)];
  gx.strokeStyle = "#8c6446"; gx.lineWidth = 2; gx.beginPath(); gx.moveTo(top[0], top[1]); gx.quadraticCurveTo(bx + ca * 6, by - sa * 6, bot[0], bot[1]); gx.stroke();
  gx.strokeStyle = "#f1ebe2aa"; gx.lineWidth = 0.6; gx.beginPath(); gx.moveTo(top[0], top[1]); gx.lineTo(back[0], back[1]); gx.lineTo(bot[0], bot[1]); gx.stroke();
  if (A.phase === "aim") {
    drawArrow(back[0] + ca * 16, back[1] - sa * 16, -a, 16);          // nocked on the string, its tip forward
    // a short dotted guide: the direction only, not where it lands
    for (let i = 1; i <= 3 + Math.round(pull * 4); i++) gpx(bx + ca * (10 + i * 5), by - sa * (10 + i * 5), 1, 1, "#ffe7a8aa");
    if (A.drawing || pull > 0) { gpx(x - 10, y - 20, 24, 4, "#1b1820"); gpx(x - 9, y - 19, 22 * pull, 2, pull >= 1 ? (A.held > 0.6 ? "#e06c6c" : "#f0c040") : "#8fd6b4"); }
  }
}
/// An arrow whose tip is at (x, y), pointing along angle (radians, screen y down).
function drawArrow(x, y, angle, len) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  gx.strokeStyle = "#c49a6c"; gx.lineWidth = 1; gx.beginPath(); gx.moveTo(x - ca * len, y - sa * len); gx.lineTo(x, y); gx.stroke();
  gpx(x - 1, y - 1, 2, 2, "#c0c6ca");
  gpx(x - ca * len - 1.5, y - sa * len - 1.5, 3, 3, "#e06c6c");
}
function drawTarget(x, cy, ground) {
  const gy = ground ?? ARC.GROUND;
  gpx(x - 2, cy + 14, 2, gy - cy - 14, "#6d5233"); gpx(x + 3, cy + 10, 2, gy - cy - 10, "#5e4232");   // the stand
  for (let i = ARC.RINGS.length - 1; i >= 0; i--) { const [d, , c] = ARC.RINGS[i]; gpx(x - 1, cy - d, 4, d * 2, c); }
  gpx(x + 3, cy - 14, 1, 28, "#00000040");
}
function drawArchery(t) {
  const A = ARCH, cy = targetY(t);
  // sky, hills, the range
  gpx(0, 0, GW, 70, "#8fc4e8"); gpx(0, 70, GW, 50, "#a9d4ee");
  for (let i = 0; i < GW; i += 28) gpx(i, 108 - (hash("ahill" + i) % 14), 28, 30, "#6a9a5f");
  gpx(0, 118, GW, ARC.GROUND - 118, "#7fb069"); gpx(0, ARC.GROUND, GW, GH - ARC.GROUND, "#5a8a4a");
  for (const d of ARC.DIST) gpx(d, ARC.GROUND, 1, 4, "#f1ebe2aa");     // where the target stands in each end
  // the wind flag on a pole near the target
  const fx = Math.min(GW - 14, A.tx + 18), fl = Math.max(2, Math.min(14, Math.abs(A.wind) / 2.5)), dir = A.wind >= 0 ? 1 : -1, wave = Math.sin(t * 8) * 1;
  gpx(fx, 92, 1, ARC.GROUND - 92, "#c0c6ca");
  gx.fillStyle = "#e06c6c"; gx.beginPath(); gx.moveTo(fx, 93); gx.lineTo(fx + dir * fl, 95 + wave); gx.lineTo(fx, 98); gx.fill();
  drawTarget(A.tx, cy);
  for (const s of A.stuck) drawArrow(s.x + (s.onTarget ? 2 : 0), s.onTarget ? cy + s.dy : s.y, s.angle, 12);
  drawArcher(24, 140, A, t);
  if (A.shot) drawArrow(A.shot.x, A.shot.y, Math.atan2(A.shot.vy, A.shot.vx), 12);
  for (const p of A.pops) gtext(p.text, p.x, p.y - (1.2 - p.life) * 12, p.c, 9, "center");
  // the top: end, arrows left, wind
  gpx(0, 0, GW, 14, "#1b1820cc");
  gtext(`END ${A.end + 1}/${ARC.ENDS}`, 6, 3, "#8fd6b4", 8);
  for (let i = 0; i < ARC.PER_END; i++) gpx(70 + i * 6, 4, 3, 7, i < ARC.PER_END - A.arrow ? "#c49a6c" : "#3a302c");
  gtext(`${A.total} pts`, GW / 2, 3, "#ffe7a8", 8, "center");
  gtext(A.wind ? `wind ${A.wind > 0 ? "→" : "←"} ${Math.abs(A.wind)}` : "no wind", GW - 6, 3, "#f1ebe2", 8, "right");
  if (A.phase === "endsum" || A.phase === "over") {
    const e = A.ends[A.end] || [], sum = e.reduce((s, p) => s + p, 0);
    gpx(GW / 2 - 90, 60, 180, 40, "#0d0b10dd");
    gtext(A.phase === "over" ? `ROUND OVER · ${A.total} / 150` : `END ${A.end + 1}: ${e.join(" + ")} = ${sum}`, GW / 2, 68, "#ffe7a8", 9, "center");
    gtext(A.phase === "over" ? "Play again on the right" : "the target moves back…", GW / 2, 84, "#a79d93", 7, "center");
  }
}

registerGame("archery", {
  title: "🏹 Archery",
  start: archStart, step: archStep, draw: drawArchery, side: archSide,
  key: (k, down) => {
    if (k !== " " || ARCH.phase !== "aim") return;
    if (down && !ARCH.drawing) { ARCH.drawing = true; ARCH.power = 0; ARCH.held = 0; }
    if (!down && ARCH.drawing) shoot();
  },
  mouse: (p, type) => {
    const A = ARCH;
    if (type === "mousemove" && A.phase === "aim") { A.aim = Math.max(-0.2, Math.min(1.1, Math.atan2(ARC.BOW_Y - p.y, Math.max(4, p.x - ARC.BOW_X)))); A.mouseAim = true; }
    if (type === "mousedown" && A.phase === "aim") { A.drawing = true; A.power = 0; A.held = 0; }
    if (type === "mouseup" && A.drawing) shoot();
  },
  cancel: () => { ARCH.drawing = false; ARCH.power = 0; ARCH.held = 0; },
  click: b => { if (b.dataset.again) archStart(); },
  leave: () => { ARCH.drawing = false; },
  iconCenter: [0, 4],
  drawIcon: t => {
    drawTarget(18, -2, 16);
    const j = (t % 1.6) / 1.6;
    if (j < 0.6) drawArrow(-24 + j / 0.6 * 40, -2 - Math.sin(j / 0.6 * Math.PI) * 6, Math.cos(j / 0.6 * Math.PI) * -0.4, 10);
    else drawArrow(18, -2, 0, 10);
    gtext("archery", 0, 22, "#a79d93", 8, "center");
  },
});
