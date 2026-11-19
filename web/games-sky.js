// ✈ Sky Patrol (games.js is the shell): a vertical shoot-'em-up over the sea, on your own.
//
// Fly with the arrows / WASD or the mouse; the guns fire by themselves. Space (or B) drops a bomb (two
// per life): it clears the enemies' bullets and hurts everything on screen. Enemies come in waves, each a
// little harder: scouts dive straight down, fighters weave, bombers take a beating and shoot back, and
// scouts fly in V formations. Every fifth wave a gunship comes for you. Shot-down planes may drop
// P (more guns), S (a shield for a hit or eight seconds) or, rarely, 1UP. Three lives; the flight's
// score goes to the leaderboard.
"use strict";

const SKY = {
  SPEED: 140, FIRE: 0.14, BULLET: 300, SCROLL: 30, MAX_ENEMIES: 40, MAX_SHOTS: 80, MAX_EBULLETS: 60,
  KINDS: {               // w, h, hp, points, speed
    scout: [10, 8, 1, 100, 75], fighter: [12, 9, 2, 150, 55], bomber: [22, 14, 7, 500, 26], gunship: [60, 26, 0, 5000, 18],
  },
};
const SP = { phase: "idle", t: 0, score: 0, wave: 0, lives: 3, bombs: 2, power: 1, shield: 0, invuln: 0, x: 160, y: 170,
  fireIn: 0, shots: [], enemies: [], ebullets: [], drops: [], booms: [], spawns: [], banner: 0, flash: 0, mouse: null, kills: 0, scroll: 0 };

function skyStart() {
  Object.assign(SP, { phase: "play", t: 0, score: 0, wave: 0, lives: 3, bombs: 2, power: 1, shield: 0, invuln: 1.5, x: GW / 2, y: 170,
    fireIn: 0, shots: [], enemies: [], ebullets: [], drops: [], booms: [], spawns: [], banner: 0, flash: 0, mouse: null, kills: 0 });
  nextWave();
  gshow("sky");
}
/// Wave n's spawns, as [time, kind, x, extra]: more and tougher planes as the waves go on; every fifth
/// wave is a gunship with a few escorts.
function nextWave() {
  const S = SP, n = ++S.wave, out = [];
  if (n % 5 === 0) {
    out.push([0.5, "gunship", GW / 2]);
    for (let i = 0; i < 4 + n / 5; i++) out.push([3 + i * 2.5, "scout", 30 + Math.random() * (GW - 60)]);
  } else {
    const count = 6 + n * 2;
    for (let i = 0, at = 0.5; i < count; i++, at += Math.max(0.35, 1.1 - n * 0.06) * (0.6 + Math.random() * 0.8)) {
      const r = Math.random(), kind = n >= 3 && r < 0.12 + n * 0.015 ? "bomber" : n >= 2 && r < 0.45 ? "fighter" : "scout";
      out.push([at, kind, 16 + Math.random() * (GW - 32)]);
      if (n >= 2 && i % 7 === 6) { const cx = 50 + Math.random() * (GW - 100); for (let k = -2; k <= 2; k++) out.push([at + 0.6, "scout", cx + k * 14, Math.abs(k) * 10]); }
    }
  }
  S.spawns = out.sort((a, b) => a[0] - b[0]); S.waveT = 0; S.banner = 1.6;
}
function spawn(kind, x, lag) {
  const S = SP; if (S.enemies.length >= SKY.MAX_ENEMIES) return;
  const [w, h, hp, pts, speed] = SKY.KINDS[kind];
  const e = { kind, x, x0: x, y: -h - (lag || 0), w, h, hp: kind === "gunship" ? 60 + S.wave * 10 : hp, max: 0, pts, speed, t: Math.random() * 6, fireIn: 1 + Math.random() * 1.5, hit: 0 };
  e.max = e.hp; S.enemies.push(e);
}
const overlap = (a, b) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
function eshoot(x, y, angle, speed) { if (SP.ebullets.length < SKY.MAX_EBULLETS) SP.ebullets.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, w: 3, h: 3 }); }
function boom(x, y, size) { SP.booms.push({ x, y, size, life: 0.5 }); }

function skyStep(dt) {
  const S = SP, k = GAME.keys;
  S.booms = S.booms.filter(b => (b.life -= dt) > 0);
  S.scroll += SKY.SCROLL * dt;
  if (S.phase !== "play") { ginfo.textContent = S.phase === "over" ? `shot down · ${S.score} points · wave ${S.wave}` : ""; return; }
  if (Math.floor(S.t + dt) !== Math.floor(S.t)) side();             // the side panel's numbers, once a second
  S.t += dt; S.waveT += dt; S.banner = Math.max(0, S.banner - dt); S.flash = Math.max(0, S.flash - dt);
  S.invuln = Math.max(0, S.invuln - dt); S.shield = Math.max(0, S.shield - dt);
  // you
  let mx = (k.has("arrowright") || k.has("d") ? 1 : 0) - (k.has("arrowleft") || k.has("a") ? 1 : 0);
  let my = (k.has("arrowdown") || k.has("s") ? 1 : 0) - (k.has("arrowup") || k.has("w") ? 1 : 0);
  if (mx || my) S.mouse = null;
  else if (S.mouse) { const dx = S.mouse.x - S.x, dy = S.mouse.y - S.y, d = Math.hypot(dx, dy); if (d > 2) { mx = dx / d * Math.min(1, d / 12); my = dy / d * Math.min(1, d / 12); } }
  S.x = Math.max(8, Math.min(GW - 8, S.x + mx * SKY.SPEED * dt)); S.y = Math.max(40, Math.min(GH - 10, S.y + my * SKY.SPEED * dt));
  S.fireIn -= dt;
  if (S.fireIn <= 0 && S.shots.length < SKY.MAX_SHOTS) {
    S.fireIn = SKY.FIRE;
    const guns = S.power >= 3 ? [[-5, -0.18], [0, 0], [5, 0.18]] : S.power === 2 ? [[-3, 0], [3, 0]] : [[0, 0]];
    for (const [ox, a] of guns) S.shots.push({ x: S.x + ox, y: S.y - 8, vx: Math.sin(a) * SKY.BULLET, vy: -Math.cos(a) * SKY.BULLET, w: 2, h: 5 });
  }
  // the wave: spawn what is due; when everything is out and gone, a bonus and the next wave
  while (S.spawns.length && S.spawns[0][0] <= S.waveT) { const [, kind, x, lag] = S.spawns.shift(); spawn(kind, x, lag); }
  if (!S.spawns.length && !S.enemies.length && S.waveT > 1) { const bonus = 200 * S.wave; S.score += bonus; toast(`✈ Wave ${S.wave} cleared · +${bonus}`, null, 1800); nextWave(); side(); }
  // planes
  for (const e of S.enemies) {
    e.t += dt; e.hit = Math.max(0, e.hit - dt);
    if (e.kind === "gunship") {
      e.y = Math.min(34, e.y + e.speed * dt); e.x = GW / 2 + Math.sin(e.t * 0.6) * (GW / 2 - 40);
      e.fireIn -= dt;
      if (e.fireIn <= 0 && e.y >= 30) {
        const enraged = e.hp < e.max / 2;
        if ((e.t | 0) % 2) for (let i = -2; i <= 2; i++) eshoot(e.x, e.y + 10, Math.PI / 2 + i * 0.28, 90);
        else { const a = Math.atan2(S.y - e.y, S.x - e.x); for (let i = 0; i < 3; i++) eshoot(e.x + (i - 1) * 16, e.y + 12, a, 120); }
        e.fireIn = enraged ? 0.8 : 1.4;
      }
      continue;
    }
    e.y += e.speed * dt;
    if (e.kind === "fighter") e.x = e.x0 + Math.sin(e.t * 2.6) * 34;
    if (e.kind === "bomber") { e.fireIn -= dt; if (e.fireIn <= 0 && e.y > 0 && e.y < S.y - 30) { e.fireIn = 1.6; eshoot(e.x, e.y + 7, Math.atan2(S.y - e.y, S.x - e.x), 100); } }
  }
  S.enemies = S.enemies.filter(e => e.y < GH + 30 && e.hp > 0);
  // your shots against the planes
  for (const s of S.shots) { s.x += s.vx * dt; s.y += s.vy * dt; }
  for (const s of S.shots) for (const e of S.enemies) if (!s.gone && e.hp > 0 && overlap(s, e)) { s.gone = true; damage(e, 1); }
  S.shots = S.shots.filter(s => !s.gone && s.y > -10 && s.x > -10 && s.x < GW + 10);
  for (const b of S.ebullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
  S.ebullets = S.ebullets.filter(b => b.y < GH + 6 && b.y > -6 && b.x > -6 && b.x < GW + 6);
  // what falls
  for (const d of S.drops) d.y += 40 * dt;
  const me = { x: S.x, y: S.y, w: 6, h: 6 }, reach = { x: S.x, y: S.y, w: 14, h: 12 };
  for (const d of S.drops) if (!d.gone && overlap(d, reach)) {
    d.gone = true;
    if (d.kind === "P") S.power = Math.min(3, S.power + 1);
    if (d.kind === "S") S.shield = 8;
    if (d.kind === "1UP") S.lives = Math.min(5, S.lives + 1);
    S.score += 50; side();
  }
  S.drops = S.drops.filter(d => !d.gone && d.y < GH + 8);
  // getting hit
  if (S.invuln <= 0) {
    const bullet = S.ebullets.find(b => overlap(b, me)), plane = S.enemies.find(e => e.hp > 0 && overlap(e, me));
    if (bullet || plane) {
      if (bullet) bullet.y = GH + 99;
      if (plane && plane.kind !== "gunship") damage(plane, 99);
      if (S.shield > 0) { S.shield = 0; S.invuln = 0.8; }
      else hitMe();
    }
  }
  ginfo.textContent = `wave ${S.wave} · ${S.score} points · ${"✈".repeat(Math.max(0, S.lives))} · bombs ${S.bombs}`;
}
function damage(e, n) {
  const S = SP;
  e.hp -= n; e.hit = 0.08;
  if (e.hp > 0) return;
  S.score += e.pts; S.kills++;
  boom(e.x, e.y, e.kind === "gunship" ? 3 : e.kind === "bomber" ? 2 : 1);
  if (e.kind === "gunship") { achieve("gunship"); S.flash = 0.4; for (let i = 0; i < 6; i++) boom(e.x + (Math.random() - 0.5) * 50, e.y + (Math.random() - 0.5) * 20, 2); }
  if (tally("planes") >= 100) achieve("ace");
  if (S.score >= 10000) achieve("sky-10k");
  const r = Math.random(), chance = e.kind === "gunship" ? 1 : e.kind === "bomber" ? 0.4 : 0.08;
  if (r < chance) { const p = Math.random(); S.drops.push({ x: e.x, y: e.y, w: 9, h: 9, kind: p < 0.1 ? "1UP" : p < 0.4 ? "S" : "P" }); }
}
function hitMe() {
  const S = SP;
  S.lives--; boom(S.x, S.y, 2);
  if (S.lives <= 0) return skyOver();
  S.invuln = 2; S.power = Math.max(1, S.power - 1); S.bombs = 2; S.ebullets = [];
  side();
}
function bomb() {
  const S = SP;
  if (S.phase !== "play" || S.bombs <= 0) return;
  S.bombs--; S.flash = 0.35; S.ebullets = [];
  for (const e of S.enemies) if (e.y > -e.h) damage(e, e.kind === "gunship" ? 12 : 10);
  side();
}
function skyOver() {
  const S = SP;
  S.phase = "over";
  const pb = S.score > 0 && scoreBoard("sky", S.score);
  toast(`✈ Shot down on wave ${S.wave} · ${S.score} points${pb ? " · your best flight!" : ""}`, null, 6000);
  side();
}

function skySide() {
  const S = SP, best = store("bests", {}).sky;
  gside.innerHTML = `<h3>HOW</h3><div class="hint">Fly with the arrows / WASD or the mouse; the guns fire by themselves. Space drops a bomb. Pick up P (more guns), S (shield) and 1UP.</div>
    <h3>THIS FLIGHT</h3><div class="row"><span class="n">wave</span><span class="v">${S.wave}</span></div>
    <div class="row"><span class="n">points</span><span class="v">${S.score}</span></div>
    <div class="row"><span class="n">lives · bombs</span><span class="v">${Math.max(0, S.lives)} · ${S.bombs}</span></div>
    <div class="row"><span class="n">guns</span><span class="v">${["", "single", "double", "triple"][S.power]}</span></div>
    <h3>YOUR BEST</h3><div class="hint">${best ? best + " points" : "no flight yet"}</div>
    <h3>&nbsp;</h3>${S.phase === "over" ? `<button class="go" data-again="1">Fly again</button> ` : ""}<button data-home="1">Games</button>`;
}

// ---------- drawing ----------
function drawPlane(x, y, c, dir, s) {        // dir 1: nose up (you), -1: nose down (them)
  gx.save(); gx.translate(x, y); gx.scale(s || 1, (s || 1) * dir);
  gx.fillStyle = c;
  gx.fillRect(-1.5, -6, 3, 12);              // body
  gx.fillRect(-6, -1, 12, 3);                // wings
  gx.fillRect(-3, 4, 6, 2);                  // tail
  gx.fillStyle = "#ffffff55"; gx.fillRect(-1.5, -6, 3, 1); gx.fillRect(-6, -1, 12, 1);
  gx.fillStyle = "#1b1820aa"; gx.fillRect(-0.5, -3, 1, 2);    // cockpit
  gx.restore();
}
function drawBomber(e) {
  const c = e.hit ? "#ffffff" : "#6d6a5c";
  gpx(e.x - 3, e.y - 7, 6, 14, c); gpx(e.x - 11, e.y - 2, 22, 5, c); gpx(e.x - 5, e.y - 7, 10, 2, c);
  gpx(e.x - 8, e.y, 2, 4, "#3a3830"); gpx(e.x + 6, e.y, 2, 4, "#3a3830"); gpx(e.x - 1, e.y + 4, 2, 2, "#e06c6c");
}
function drawGunship(e) {
  const c = e.hit ? "#ffffff" : "#4a5060";
  gpx(e.x - 30, e.y - 6, 60, 12, c); gpx(e.x - 12, e.y - 13, 24, 26, c); gpx(e.x - 30, e.y - 6, 60, 2, "#6a7080");
  for (const ox of [-22, -8, 8, 22]) gpx(e.x + ox - 2, e.y + 4, 4, 6, "#2a2d36");
  gpx(e.x - 4, e.y - 3, 8, 6, e.hp < e.max / 2 && Math.floor(SP.t * 8) % 2 ? "#e06c6c" : "#f0a35e");
  gpx(e.x - 30, e.y - 20, 60, 3, "#1b1820"); gpx(e.x - 30, e.y - 20, 60 * Math.max(0, e.hp) / e.max, 3, "#e06c6c");
}
function drawSky(t) {
  const S = SP;
  gx.save(); gx.beginPath(); gx.rect(0, 0, GW, GH); gx.clip();       // planes come in and leave off the edges
  gpx(0, 0, GW, GH, "#2a5a8a");
  for (let i = 0; i < 40; i++) { const y = (hash("sea" + i) % GH + S.scroll * 1.0) % GH; gpx(hash("sx" + i) % GW, y, 6, 1, "#3d72a6"); }
  // islands drift past, the same ones every flight
  for (let k = Math.floor(S.scroll / 110) - 2; k <= Math.floor(S.scroll / 110) + 1; k++) {
    const h = hash("isle" + k); if (h % 3 === 0) continue;
    const y = S.scroll - k * 110, x = h % (GW - 60) + 10, w = 26 + h % 26, hh = 22 + (h >>> 4) % 16;
    gpx(x + 4, y - 2, w - 8, hh + 4, "#e3c78f"); gpx(x - 2, y + 3, w + 4, hh - 6, "#e3c78f");          // a sandy shore
    gpx(x + 5, y, w - 10, hh, "#5f8d55"); gpx(x, y + 4, w, hh - 8, "#5f8d55"); gpx(x + 7, y + 4, w - 16, hh - 8, "#6fa35f");
    gpx(x + 8 + h % 9, y + 5, 3, 3, "#3c6e3a"); gpx(x + w - 12, y + hh - 9, 3, 3, "#3c6e3a");        // trees
  }
  for (const d of S.drops) {
    gpx(d.x - 5, d.y - 5, 10, 10, d.kind === "S" ? "#4fc1c9" : d.kind === "1UP" ? "#5fbf7f" : "#f0c040");
    gtext(d.kind === "1UP" ? "1" : d.kind, d.x, d.y - 4, "#1b1820", 7, "center");
  }
  for (const e of S.enemies) {
    if (e.kind === "bomber") drawBomber(e);
    else if (e.kind === "gunship") drawGunship(e);
    else drawPlane(e.x, e.y, e.hit ? "#ffffff" : e.kind === "fighter" ? "#c27460" : "#9aa5aa", -1, e.kind === "fighter" ? 1.1 : 1);
  }
  for (const s of S.shots) gpx(s.x - 1, s.y - 3, 2, 5, "#ffe7a8");
  for (const b of S.ebullets) { gpx(b.x - 1.5, b.y - 1.5, 3, 3, "#e06c6c"); gpx(b.x - 0.5, b.y - 0.5, 1, 1, "#ffe7a8"); }
  if (S.phase === "play" && (S.invuln <= 0 || Math.floor(t * 12) % 2)) {
    drawPlane(S.x, S.y, myColor(), 1, 1.2);
    if (Math.floor(t * 20) % 2 === 0) gpx(S.x - 1, S.y + 7, 2, 2, "#f0a35e");                 // the exhaust
    if (S.shield > 0) { gx.strokeStyle = `rgba(79,193,201,${S.shield < 2 && Math.floor(t * 8) % 2 ? 0.3 : 0.8})`; gx.lineWidth = 1; gx.beginPath(); gx.arc(S.x, S.y, 11, 0, Math.PI * 2); gx.stroke(); }
  }
  for (const b of S.booms) {
    const r = (1 - b.life / 0.5) * 6 * b.size;
    gx.fillStyle = `rgba(240,163,94,${b.life * 2})`; gx.beginPath(); gx.arc(b.x, b.y, r, 0, Math.PI * 2); gx.fill();
    gx.fillStyle = `rgba(255,231,168,${b.life * 2})`; gx.beginPath(); gx.arc(b.x, b.y, r * 0.5, 0, Math.PI * 2); gx.fill();
  }
  if (S.flash > 0) gpx(0, 0, GW, GH, `rgba(255,255,255,${S.flash})`);
  // the top bar
  gpx(0, 0, GW, 12, "#0d0b10aa");
  gtext(String(S.score).padStart(6, "0"), 6, 2, "#ffe7a8", 8);
  gtext(`WAVE ${S.wave}`, GW / 2, 2, "#8fd6b4", 8, "center");
  for (let i = 0; i < Math.max(0, S.lives); i++) drawPlane(GW - 10 - i * 12, 6, myColor(), 1, 0.6);
  for (let i = 0; i < S.bombs; i++) gpx(GW - 70 - i * 7, 3, 4, 6, "#e06c6c");
  if (S.banner > 0 && S.phase === "play") gtext(S.wave % 5 === 0 ? `WAVE ${S.wave} · GUNSHIP!` : `WAVE ${S.wave}`, GW / 2, 80, "#ffe7a8", 14, "center");
  if (S.phase === "over") {
    gpx(GW / 2 - 90, 70, 180, 44, "#0d0b10dd");
    gtext(`SHOT DOWN · ${S.score}`, GW / 2, 78, "#ffe7a8", 11, "center");
    gtext(`wave ${S.wave} · Fly again on the right`, GW / 2, 96, "#a79d93", 7, "center");
  }
  gx.restore();
}

registerGame("sky", {
  title: "✈ Sky Patrol",
  start: skyStart, step: skyStep, draw: drawSky, side: skySide,
  key: (k, down) => { if (down && (k === " " || k === "b")) bomb(); },
  mouse: (p, type) => { if (type === "mousemove") SP.mouse = { x: p.x, y: p.y }; },
  click: b => { if (b.dataset.again) skyStart(); },
  // leaving mid-flight keeps what was scored so far
  leave: () => { if (SP.phase === "play") { SP.phase = "idle"; if (SP.score > 0) scoreBoard("sky", SP.score); } },
  iconCenter: [0, 4],
  drawIcon: t => {
    gpx(-30, -18, 60, 36, "#2a5a8a");
    for (let i = 0; i < 4; i++) gpx(-26 + ((i * 17 + t * 10) % 50), -14 + ((i * 11 + t * 20) % 30), 5, 1, "#3d72a6");
    drawPlane(Math.sin(t * 2) * 14, 8, "#5fbf7f", 1, 1);
    drawPlane(Math.cos(t * 1.3) * 18, -10 + ((t * 18) % 10), "#9aa5aa", -1, 0.9);
    gpx(Math.sin(t * 2) * 14 - 1, 1 - ((t * 60) % 14), 2, 4, "#ffe7a8");
    gtext("sky patrol", 0, 22, "#a79d93", 8, "center");
  },
});
