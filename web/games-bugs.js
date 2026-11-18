// 🪲 Bug Whack (games.js is the shell): 45 seconds of bugs climbing out of the office's monitors.
// Click one before it gets away: a bug is 1 point, a golden bug 5, and every fifth hit in a row 1
// more. Leave the green ones alone: they are features, and whacking one costs 3. Bugs come faster
// and stay shorter as the round goes on. The round's points go to the leaderboard; in a room,
// everyone sees how you did.
//
// Room messages, {g: "bugs", k: "score", pts}.
"use strict";

const BUG_ROUND = 45, BUG_COLS = 4, BUG_ROWS = 3;
const BUGS = { phase: "idle", t: 0, pts: 0, streak: 0, hits: 0, list: [], next: 0, splats: [] };
const deskAt = i => ({ x: 40 + (i % BUG_COLS) * 80, y: 62 + Math.floor(i / BUG_COLS) * 50 });
function bugsStart(arg) {
  Object.assign(BUGS, { phase: arg === "demo" ? "play" : "ready", t: 0, pts: 0, streak: 0, hits: 0, list: [], next: 0.5, splats: [] });
  gshow("bugs");
}
function bugsSide() {
  gside.innerHTML = `<h3>HOW</h3><div class="hint">Click a bug before it gets away: 🪲 1 point, 🌟 golden 5, every fifth hit in a row +1. Leave the 🟩 green ones: they are features (−3).</div>
    ${BUGS.phase !== "play" ? `<h3>&nbsp;</h3><button class="go" data-go="1">${BUGS.phase === "over" ? "Play again" : "Start (45 s)"}</button>` : ""}
    ${BUGS.phase === "over" ? `<h3>THIS ROUND</h3><div class="row"><span class="n">${BUGS.hits} whacked</span><span class="v">${BUGS.pts} points</span></div>` : ""}
    <h3>BEST ROUNDS</h3>${(boardsNow().boards.bugs || []).slice(0, 5).map((e, i) => `<div class="row"><span class="n">${i + 1}. ${esc(e.name)}</span><span class="v">${Math.round(e.value)}</span></div>`).join("") || `<div class="hint">none yet</div>`}
    <h3>&nbsp;</h3><button data-home="1">Games</button>`;
}
function bugsStep(dt) {
  const B = BUGS;
  B.splats = B.splats.filter(s => (s.life -= dt) > 0);
  if (B.phase !== "play") { ginfo.textContent = B.phase === "over" ? `round over: ${B.pts} points` : "press Start"; return; }
  B.t += dt;
  const left = BUG_ROUND - B.t, pace = Math.min(1, B.t / BUG_ROUND);
  B.next -= dt;
  if (B.next <= 0 && B.list.length < 4) {
    B.next = 0.85 - pace * 0.5 + Math.random() * 0.3;
    const free = [...Array(BUG_COLS * BUG_ROWS).keys()].filter(i => !B.list.some(b => b.at === i));
    const at = free[Math.floor(Math.random() * free.length)], r = Math.random();
    B.list.push({ at, kind: r < 0.08 ? "gold" : r < 0.2 ? "feature" : "bug", life: 1.3 - pace * 0.6, age: 0 });
  }
  for (const b of B.list) b.age += dt;
  const gone = B.list.filter(b => b.age >= b.life);
  if (gone.some(b => b.kind !== "feature")) B.streak = 0;             // one got away
  B.list = B.list.filter(b => b.age < b.life);
  ginfo.textContent = `${Math.ceil(left)} s · ${B.pts} points${B.streak >= 3 ? ` · ${B.streak} in a row` : ""}`;
  if (left <= 0) {
    B.phase = "over"; B.list = [];
    if (B.pts > 0) {
      const pb = scoreBoard("bugs", B.pts);
      gsend({ g: "bugs", k: "score", pts: B.pts });
      toast(`🪲 ${B.pts} points${pb ? " · your best round!" : ""}`, null, 5000);
      if (B.pts >= 50) achieve("exterminator");
    }
    side();
  }
}
function bugsMouse(p, type) {
  const B = BUGS; if (type !== "mousedown" || B.phase !== "play") return;
  const hit = B.list.find(b => { const d = deskAt(b.at); return Math.abs(p.x - d.x) < 22 && p.y > d.y - 30 && p.y < d.y + 14; });
  if (!hit) return;
  B.list = B.list.filter(b => b !== hit);
  const d = deskAt(hit.at);
  if (hit.kind === "feature") { B.pts = Math.max(0, B.pts - 3); B.streak = 0; B.splats.push({ x: d.x, y: d.y - 14, life: 0.6, text: "−3", c: "#e06c6c" }); return; }
  B.streak++; B.hits++;
  const gain = (hit.kind === "gold" ? 5 : 1) + (B.streak % 5 === 0 ? 1 : 0);
  B.pts += gain;
  if (hit.kind === "gold") achieve("golden-bug");
  B.splats.push({ x: d.x, y: d.y - 14, life: 0.6, text: "+" + gain, c: hit.kind === "gold" ? "#ffe7a8" : "#8fd6b4" });
}
function drawBug(x, y, kind, s) {
  const c = kind === "gold" ? "#f0c040" : kind === "feature" ? "#5fbf7f" : "#3a2a2a";
  gx.save(); gx.translate(x, y); gx.scale(s, s);
  if (kind === "feature") { gx.fillStyle = c; gx.fillRect(-5, -5, 10, 10); gx.fillStyle = "#1b1820"; gx.fillRect(-2, -1, 1, 1); gx.fillRect(1, -1, 1, 1); gx.fillRect(-2, 2, 4, 1); }
  else {
    gx.fillStyle = "#1b1820"; for (const k of [-4, 0, 4]) { gx.fillRect(-8, k, 3, 1); gx.fillRect(5, k, 3, 1); }
    gx.fillStyle = c; gx.fillRect(-5, -4, 10, 9); gx.fillRect(-3, -7, 6, 3);
    gx.fillStyle = kind === "gold" ? "#fff3b0" : "#6a4a4a"; gx.fillRect(-1, -4, 1, 9);
    gx.fillStyle = "#f1ebe2"; gx.fillRect(-2, -6, 1, 1); gx.fillRect(1, -6, 1, 1);
  }
  gx.restore();
}
function drawBugs(t) {
  const B = BUGS;
  gpx(0, 0, GW, GH, "#3a3040"); for (let y = 0; y < GH; y += 8) gpx(0, y, GW, 1, "#33293a");
  gpx(0, 0, GW, 26, "#e2d3b5"); gpx(0, 24, GW, 2, "#b09372");
  for (let i = 0; i < BUG_COLS * BUG_ROWS; i++) {
    const d = deskAt(i);
    gpx(d.x - 20, d.y, 40, 6, "#8a6a45"); gpx(d.x - 18, d.y + 6, 2, 10, "#6d5233"); gpx(d.x + 16, d.y + 6, 2, 10, "#6d5233");
    gpx(d.x - 10, d.y - 16, 20, 14, "#222"); gpx(d.x - 8, d.y - 14, 16, 10, "#1d3b4a"); gpx(d.x - 2, d.y - 2, 4, 2, "#444");
  }
  for (const b of B.list) {
    const d = deskAt(b.at), rise = Math.min(1, b.age / 0.15, (b.life - b.age) / 0.15);
    drawBug(d.x, d.y - 10 - rise * 12, b.kind, 1 + (b.kind === "gold" ? Math.sin(t * 12) * 0.08 : 0));
  }
  for (const s of B.splats) gtext(s.text, s.x, s.y - (0.6 - s.life) * 20, s.c, 10, "center");
  gtext(`${B.pts}`, 8, 8, "#1b1820", 10);
  if (B.phase === "play") { gpx(GW - 108, 9, 100, 6, "#b09372"); gpx(GW - 108, 9, 100 * (1 - B.t / BUG_ROUND), 6, "#5fbf7f"); }
  if (B.phase !== "play") { gpx(GW / 2 - 80, GH / 2 - 16, 160, 32, "#0d0b10cc"); gtext(B.phase === "over" ? `${B.pts} points` : "press Start", GW / 2, GH / 2 - 6, "#ffe7a8", 12, "center"); }
}
registerGame("bugs", {
  title: "🪲 Bug Whack",
  start: bugsStart, step: bugsStep, draw: drawBugs, side: bugsSide, mouse: bugsMouse,
  click: b => { if (b.dataset.go) { Object.assign(BUGS, { phase: "play", t: 0, pts: 0, streak: 0, hits: 0, list: [], next: 0.5 }); side(); } },
  msg: (from, name, d) => {
    if (d.k !== "score" || !(+d.pts > 0)) return;
    const text = `🪲 ${name} whacked ${Math.round(+d.pts)} points of bugs`;
    if (GAME.open) toast(esc(text), null, 4000); else note(text);
  },
  drawIcon: t => { drawBug(215, 128 - Math.abs(Math.sin(t * 3)) * 8, "bug", 1.5); gtext("bug whack", 215, 150, "#a79d93", 8, "center"); },
});
