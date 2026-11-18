// Agent Office — the lounge's mini-games: a top-down race on five tracks and fishing, alone or with
// the room. Loaded by office.html after its own script, so it uses its globals (room, bridge, esc,
// snap, SHIRTS, hash, roomMates, openSession, peopleKey).
//
// A game opens over the whole office. With a room, game messages go through the room's host
// ({game: …} to the app, gameIn(…) back; Room.swift relays them as they are): who opened a race
// and when it starts, each car's position ten times a second, finish times, fish caught, a fishing
// round. Scores go to the room's leaderboard, which the host keeps on its own Mac; without a room,
// your own bests are kept in this page's storage. While a game is open, an agent that starts
// waiting for you shows in the game, and the app sends a notification.
"use strict";

const GW = 320, GH = 200;                         // the games' own pixels
const BOARD_NAMES = {
  "race-1": "Race · Oval", "race-2": "Race · Hairpin", "race-3": "Race · Snake", "race-4": "Race · Chicane", "race-5": "Race · Grand Loop",
  "fish-big": "Fishing · biggest fish", "fish-haul": "Fishing · 2-minute catch",
};
const LOW_WINS = b => b.startsWith("race-");
const gameEl = document.createElement("div");
gameEl.id = "game";
gameEl.innerHTML = `<div class="gbar"><b class="gtitle"></b><span class="ginfo"></span><button class="gclose" title="Close (Esc)">✕</button></div>
  <div class="gmain"><canvas class="gcv"></canvas><div class="gside"></div></div><div class="gtoast"></div>`;
document.body.appendChild(gameEl);
const gcv = gameEl.querySelector(".gcv"), gx = gcv.getContext("2d"), gside = gameEl.querySelector(".gside");
const gtoast = gameEl.querySelector(".gtoast"), gtitle = gameEl.querySelector(".gtitle"), ginfo = gameEl.querySelector(".ginfo");
const gstyle = document.createElement("style");
gstyle.textContent = `
  #game { position: fixed; inset: 0; z-index: 15; display: none; flex-direction: column; background: #120f16; font: 12px Menlo, monospace; color: var(--text); }
  #game .gbar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 2px solid var(--line); }
  #game .gtitle { color: var(--accent); }
  #game .ginfo { color: var(--muted); flex: 1; }
  #game button { font: 12px Menlo, monospace; color: var(--text); background: #2d2630; border: 1px solid #4a3d36; border-radius: 5px; padding: 5px 10px; cursor: pointer; }
  #game button.go { background: var(--accent); color: #1b1820; border-color: var(--accent); }
  #game button:disabled { opacity: .45; cursor: default; }
  #game .gmain { flex: 1; display: flex; min-height: 0; }
  #game .gcv { flex: 1; min-width: 0; image-rendering: pixelated; }
  #game .gside { width: 230px; border-left: 2px solid var(--line); padding: 10px; overflow-y: auto; }
  #game .gside h3 { font-size: 11px; color: var(--muted); font-weight: normal; letter-spacing: .06em; margin: 12px 0 6px; }
  #game .gside h3:first-child { margin-top: 0; }
  #game .row { display: flex; gap: 6px; align-items: center; margin: 3px 0; }
  #game .row .n { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #game .row .v { color: var(--muted); }
  #game .tracks { display: grid; grid-template-columns: 1fr; gap: 5px; }
  #game .feed div { color: var(--muted); margin: 3px 0; }
  #game .gtoast { position: fixed; top: 46px; left: 50%; transform: translateX(-50%); background: #3a2a14; border: 2px solid #ffb347;
    color: #ffe7a8; padding: 8px 14px; border-radius: 6px; display: none; cursor: pointer; max-width: 80%; }
  #game .hint { color: var(--muted); font-size: 11px; line-height: 1.5; }
  @media (max-width: 640px) { #game .gside { display: none; } }
  #people .tabs { display: flex; border-bottom: 1px solid #3a302c; }
  #people .tabs button { flex: 1; font: 11px Menlo, monospace; background: none; border: 0; color: var(--muted); padding: 5px 0; cursor: pointer; }
  #people .tabs button.on { color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  #people .g { display: flex; align-items: center; gap: 6px; padding: 4px; }
  #people .g .gn { flex: 1; }
  #people .g button { font: 11px Menlo, monospace; color: #1b1820; background: #8fd6b4; border: 0; border-radius: 4px; padding: 3px 7px; cursor: pointer; }
  #people .g button.alt { background: #2c252b; color: var(--text); border: 1px solid #4a3d36; }
  #people .sc { padding: 2px 6px; }
  #people .sc b { display: block; color: #ffe7a8; font-weight: normal; margin: 6px 0 2px; font-size: 11px; }
  #people .sc div { display: flex; gap: 6px; font-size: 11px; }
  #people .sc div span:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #people .sc div span:last-child { color: var(--muted); }`;
document.head.appendChild(gstyle);

// ---------- shared ----------
const GAME = { open: false, view: "home", keys: new Set(), last: 0, raf: 0 };
const myName = () => (snap && snap.manager && snap.manager.name) || "You";
const inRoom = () => room.status === "joined";
const myColor = () => SHIRTS[hash(room.you || "me") % SHIRTS.length];
const fmtTime = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const fmtScore = (b, v) => LOW_WINS(b) ? fmtTime(v) : v.toFixed(2) + " kg";
function send(d) { if (bridge && inRoom()) bridge.postMessage({ game: JSON.stringify(d) }); }
function scoreBoard(board, value) {
  // your own best on this Mac, and the room's board (the host keeps the best per name)
  let bests = {};
  try { bests = JSON.parse(localStorage.getItem("agentOffice.bests") || "{}"); } catch (e) {}
  const old = bests[board], better = old === undefined || (LOW_WINS(board) ? value < old : value > old);
  if (better) { bests[board] = value; try { localStorage.setItem("agentOffice.bests", JSON.stringify(bests)); } catch (e) {} }
  if (bridge && inRoom()) bridge.postMessage({ score: `${board}|${value}` });
  peopleKey = "";
  return better;
}
function boardsNow() {
  // the room's when joined, else your own bests as one-line boards
  if (inRoom() && room.scores && Object.keys(room.scores).length) return { room: true, boards: room.scores };
  let bests = {};
  try { bests = JSON.parse(localStorage.getItem("agentOffice.bests") || "{}"); } catch (e) {}
  const boards = {};
  for (const [b, v] of Object.entries(bests)) boards[b] = [{ name: myName(), value: v }];
  return { room: false, boards };
}
function boardsHTML(compact) {
  const { room: isRoom, boards } = boardsNow();
  const names = Object.keys(BOARD_NAMES).filter(b => boards[b] && boards[b].length);
  if (!names.length) return `<div class="empty">No scores yet. Play a race or go fishing.</div>`;
  return (isRoom ? "" : `<div class="empty">Your bests on this Mac (join a room for the room's leaderboard).</div>`) +
    names.map(b => `<div class="sc"><b>${esc(BOARD_NAMES[b])}</b>` + boards[b].slice(0, compact ? 3 : 10).map((e, i) =>
      `<div><span>${i + 1}. ${esc(e.name)}</span><span>${fmtScore(b, e.value)}</span></div>`).join("") + `</div>`).join("");
}
function toast(html, onClick, ms) {
  gtoast.innerHTML = html; gtoast.style.display = "block"; gtoast.onclick = () => { gtoast.style.display = "none"; if (onClick) onClick(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => { gtoast.style.display = "none"; }, ms || 6000);
}
function fitCanvas() {
  const r = gcv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  gcv.width = Math.max(1, Math.floor(r.width * dpr)); gcv.height = Math.max(1, Math.floor(r.height * dpr));
  const k = Math.min(gcv.width / GW, gcv.height / GH);
  gx.setTransform(k, 0, 0, k, (gcv.width - GW * k) / 2, (gcv.height - GH * k) / 2);
  gx.imageSmoothingEnabled = false;
  GAME.k = k; GAME.ox = (gcv.width - GW * k) / 2; GAME.oy = (gcv.height - GH * k) / 2;
}
window.addEventListener("resize", () => { if (GAME.open) fitCanvas(); });
function gpx(x, y, w, h, c) { gx.fillStyle = c; gx.fillRect(x, y, w, h); }
function gtext(t, x, y, c, size, align) {
  gx.font = `${size || 8}px Menlo, monospace`; gx.fillStyle = c || "#f1ebe2"; gx.textAlign = align || "left"; gx.textBaseline = "top"; gx.fillText(t, x, y);
}

function openGames(view) {
  GAME.open = true; gameEl.style.display = "flex"; GAME.keys.clear();
  gshow(view || "home");
  fitCanvas();
  if (!GAME.raf) GAME.raf = requestAnimationFrame(gtick);
}
function closeGames() {
  if (GAME.view === "race" && RACE.mp && RACE.phase !== "done") send({ g: "race", k: "quit", id: RACE.id });
  GAME.open = false; gameEl.style.display = "none"; cancelAnimationFrame(GAME.raf); GAME.raf = 0; peopleKey = "";
}
window.openGames = openGames;
window.gameOpen = () => GAME.open;
gameEl.querySelector(".gclose").addEventListener("click", closeGames);
function gshow(view) {
  GAME.view = view;
  if (view === "home") { gtitle.textContent = "🎮 Mini-games"; ginfo.textContent = inRoom() ? `with ${room.name}` : "on your own (join a room to play together)"; homeSide(); }
  if (view === "race") raceSide();
  if (view === "fish") fishSide();
}
function gtick(ts) {
  GAME.raf = requestAnimationFrame(gtick);
  const dt = Math.min(0.05, (ts - (GAME.last || ts)) / 1000); GAME.last = ts;
  gx.save(); gx.setTransform(1, 0, 0, 1, 0, 0); gx.fillStyle = "#0d0b10"; gx.fillRect(0, 0, gcv.width, gcv.height); gx.restore();
  if (GAME.view === "home") drawHome(ts / 1000);
  if (GAME.view === "race") { raceStep(dt); drawRace(); }
  if (GAME.view === "fish") { fishStep(dt); drawFish(ts / 1000); }
}
window.addEventListener("keydown", ev => {
  if (!GAME.open) return;
  if (ev.key === "Escape") { ev.preventDefault(); return GAME.view === "home" ? closeGames() : leaveTo("home"); }
  GAME.keys.add(ev.key.toLowerCase());
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(ev.key.toLowerCase())) ev.preventDefault();
  if (GAME.view === "fish") fishKey(ev.key.toLowerCase(), true);
}, true);
window.addEventListener("keyup", ev => {
  if (!GAME.open) return;
  GAME.keys.delete(ev.key.toLowerCase());
  if (GAME.view === "fish") fishKey(ev.key.toLowerCase(), false);
}, true);
function leaveTo(view) {
  if (GAME.view === "race" && RACE.mp && RACE.phase !== "done") send({ g: "race", k: "quit", id: RACE.id });
  gshow(view);
}

// An agent started waiting for you (office.html's tracker calls this): in the game, and as a
// notification from the app.
window.gameAlert = s => {
  if (!GAME.open) return;
  const what = s.title || s.cwd || "A session";
  toast(`⚠ <b>${esc(what)}</b> needs you · click to go to it`, () => { closeGames(); openSession(s); }, 15000);
  if (bridge) bridge.postMessage({ gameNotice: what });
};

// ---------- home: pick a game ----------
function homeSide() {
  const lobbies = Object.values(RACE.lobbies).filter(l => l.startAt > Date.now() / 1000);
  gside.innerHTML = `<h3>RACE</h3><div class="tracks">${TRACKS.map((t, i) =>
      `<button data-race="${i}">${i + 1}. ${esc(t.name)}</button>`).join("")}</div>
    ${inRoom() ? `<div class="hint" style="margin-top:6px">Opens the race to the room: everyone who joins in the next 10 s races with you.</div>` : ""}
    ${lobbies.length ? `<h3>OPEN RACES</h3>` + lobbies.map(l => `<div class="row"><span class="n">${esc(l.name)} · ${esc(TRACKS[l.track].name)}</span><button class="go" data-joinrace="${esc(l.id)}">Join</button></div>`).join("") : ""}
    <h3>FISHING</h3><button data-fish="1" class="go">🎣 Go fishing</button>
    <h3>LEADERBOARD</h3>${boardsHTML(true)}`;
}
gside.addEventListener("click", ev => {
  const b = ev.target.closest("button"); if (!b) return;
  if (b.dataset.race) startRace(+b.dataset.race, true);
  if (b.dataset.joinrace) joinRace(b.dataset.joinrace);
  if (b.dataset.fish) startFish();
  if (b.dataset.home) leaveTo("home");
  if (b.dataset.again) startRace(RACE.track, true);
  if (b.dataset.cup) startCup(true);
});
function drawHome(t) {
  // a little title card: a car circling and a fish jumping
  gpx(0, 0, GW, GH, "#1b1820");
  gtext("MINI-GAMES", GW / 2, 34, "#8fd6b4", 16, "center");
  gtext("pick one on the right", GW / 2, 56, "#a79d93", 8, "center");
  const a = t * 1.4, cx = 110 + Math.cos(a) * 46, cy = 120 + Math.sin(a) * 26;
  gx.strokeStyle = "#3d332e"; gx.lineWidth = 10; gx.beginPath(); gx.ellipse(110, 120, 46, 26, 0, 0, Math.PI * 2); gx.stroke();
  drawCar(cx, cy, a + Math.PI / 2, "#e06c6c");
  gpx(190, 128, 90, 30, "#2a5a8a"); gpx(190, 128, 90, 2, "#4f8fc9");
  const j = (t % 2.4) / 2.4, fy = 128 - Math.sin(j * Math.PI) * 26;
  if (j < 1) drawFishSprite(230 + j * 20, fy, "#f0a35e", 1, j < 0.5 ? -0.4 : 0.4);
}

// ---------- race ----------
// Five tracks: a closed loop through control points, smoothed (Catmull-Rom), drawn as asphalt of
// half-width W. Off the asphalt the car's top speed drops to a third; back on, it picks up again.
const TRACKS = [
  { name: "Oval", w: 15, pts: [[60, 100], [80, 50], [160, 36], [240, 50], [262, 100], [240, 150], [160, 164], [80, 150]] },
  { name: "Hairpin", w: 14, pts: [[40, 160], [40, 50], [90, 30], [130, 60], [120, 112], [150, 136], [190, 60], [240, 30], [285, 60], [285, 160], [200, 178], [110, 178]] },
  { name: "Snake", w: 12, pts: [[40, 160], [42, 62], [70, 36], [100, 62], [102, 104], [130, 126], [160, 104], [160, 62], [190, 36], [220, 62], [222, 104], [250, 126], [276, 104], [282, 58], [300, 92], [294, 158], [250, 178], [150, 180], [62, 178]] },
  { name: "Chicane", w: 14, pts: [[40, 40], [150, 40], [165, 60], [180, 40], [285, 40], [285, 100], [265, 115], [285, 130], [285, 165], [170, 165], [155, 145], [140, 165], [40, 165], [40, 115], [60, 100], [40, 85]] },
  { name: "Grand Loop", w: 12, pts: [[30, 100], [40, 35], [110, 25], [150, 70], [190, 25], [280, 30], [295, 90], [250, 110], [290, 140], [270, 178], [180, 170], [140, 130], [100, 175], [40, 170]] },
];
for (const t of TRACKS) {
  // the smoothed centre line, and how far along it each point is
  const P = t.pts, out = [];
  for (let i = 0; i < P.length; i++) {
    const p0 = P[(i - 1 + P.length) % P.length], p1 = P[i], p2 = P[(i + 1) % P.length], p3 = P[(i + 2) % P.length];
    for (let k = 0; k < 16; k++) {
      const s = k / 16, s2 = s * s, s3 = s2 * s;
      out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3),
                0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3)]);
    }
  }
  t.line = out;
}
const LAPS = 3, RACE_WAIT = 10;
const RACE = { lobbies: {}, others: {}, results: [] };
function nearest(t, x, y) {
  let best = 1e9, bi = 0;
  for (let i = 0; i < t.line.length; i++) { const dx = t.line[i][0] - x, dy = t.line[i][1] - y, d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; } }
  return { i: bi, d: Math.sqrt(best) };
}
function startRace(track, open) {
  const t = TRACKS[track], p0 = t.line[0], p1 = t.line[2];
  Object.assign(RACE, { track, id: (room.you || "me") + "-" + Date.now(), mp: inRoom(), phase: "wait", others: {}, results: [],
    x: p0[0], y: p0[1], a: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), v: 0, lap: 1, cp: 0, lapStart: 0, best: 0, t: 0, sent: 0,
    startAt: Date.now() / 1000 + (inRoom() && open ? RACE_WAIT : 3), opener: myName() });
  if (RACE.mp && open) send({ g: "race", k: "open", id: RACE.id, track, in: RACE_WAIT });
  gshow("race");
}
function joinRace(id) {
  const l = RACE.lobbies[id]; if (!l) return;
  startRace(l.track, false);
  Object.assign(RACE, { id: l.id, startAt: l.startAt, opener: l.name });
  send({ g: "race", k: "join", id: l.id });
  gshow("race");
}
function raceSide() {
  const t = TRACKS[RACE.track];
  gtitle.textContent = `🏎 ${t.name}`;
  const rows = [[myName() + " (you)", RACE.phase === "done" ? fmtTime(RACE.total) : `lap ${Math.min(RACE.lap, LAPS)}/${LAPS}`, myColor()]]
    .concat(Object.values(RACE.others).map(o => [o.name, o.done ? fmtTime(o.done) : o.quit ? "left" : `lap ${Math.min(o.lap || 1, LAPS)}/${LAPS}`, o.color]));
  const best = boardsNow().boards["race-" + (RACE.track + 1)];
  gside.innerHTML = `<h3>DRIVERS</h3>${rows.map(r => `<div class="row"><span class="dot" style="background:${r[2]}"></span><span class="n">${esc(r[0])}</span><span class="v">${r[1]}</span></div>`).join("")}
    <h3>HOW</h3><div class="hint">↑ / W go · ↓ / S brake · ← → / A D steer. Three laps. Off the track you slow right down.</div>
    ${RACE.phase === "done" ? `<h3>&nbsp;</h3><button class="go" data-again="1">Race again</button> <button data-home="1">Games</button>` : ""}
    <h3>BEST ON THIS TRACK</h3>${best && best.length ? best.slice(0, 5).map((e, i) => `<div class="row"><span class="n">${i + 1}. ${esc(e.name)}</span><span class="v">${fmtTime(e.value)}</span></div>`).join("") : `<div class="hint">no time yet</div>`}`;
}
function raceStep(dt) {
  const now = Date.now() / 1000, t = TRACKS[RACE.track];
  if (RACE.phase === "wait") {
    ginfo.textContent = RACE.mp ? `starts in ${Math.ceil(RACE.startAt - now)} s · ${Object.keys(RACE.others).length + 1} driver(s)` : "get ready";
    if (now >= RACE.startAt) { RACE.phase = "go"; RACE.t = 0; RACE.lapStart = 0; raceSide(); }
    return;
  }
  if (RACE.phase !== "go") return;
  // the race's own clock: frames while the window is hidden do not run, and neither does the time
  RACE.t += dt;
  const k = GAME.keys, up = k.has("arrowup") || k.has("w"), down = k.has("arrowdown") || k.has("s");
  const left = k.has("arrowleft") || k.has("a"), right = k.has("arrowright") || k.has("d");
  const n = nearest(t, RACE.x, RACE.y), on = n.d <= t.w;
  const top = on ? 95 : 32;
  if (up) RACE.v += (on ? 110 : 60) * dt; else if (down) RACE.v -= 160 * dt; else RACE.v -= 40 * dt * Math.sign(RACE.v);
  if (!on && RACE.v > top) RACE.v -= 180 * dt;                    // grass drags you down to its top speed
  RACE.v = Math.max(-25, Math.min(RACE.v, on ? top : Math.max(top, RACE.v)));
  const steer = (left ? -1 : 0) + (right ? 1 : 0);
  RACE.a += steer * dt * 2.9 * Math.min(1, Math.abs(RACE.v) / 40) * Math.sign(RACE.v || 1);
  RACE.x = Math.max(4, Math.min(GW - 4, RACE.x + Math.cos(RACE.a) * RACE.v * dt));
  RACE.y = Math.max(4, Math.min(GH - 4, RACE.y + Math.sin(RACE.a) * RACE.v * dt));
  // laps: pass a third, two thirds, then the line
  const N = t.line.length, f = n.i / N;
  if (RACE.cp === 0 && f > 0.3 && f < 0.45) RACE.cp = 1;
  if (RACE.cp === 1 && f > 0.63 && f < 0.78) RACE.cp = 2;
  if (RACE.cp === 2 && f < 0.08) {
    const lapT = RACE.t - RACE.lapStart; RACE.best = RACE.best ? Math.min(RACE.best, lapT) : lapT; RACE.lapStart = RACE.t; RACE.cp = 0;
    if (RACE.lap >= LAPS) {
      RACE.phase = "done"; RACE.total = RACE.t;
      const pb = scoreBoard("race-" + (RACE.track + 1), +RACE.total.toFixed(3));
      send({ g: "race", k: "done", id: RACE.id, time: +RACE.total.toFixed(3) });
      toast(`🏁 ${fmtTime(RACE.total)}${pb ? " · your best on this track!" : ""}`, null, 5000);
    } else RACE.lap++;
    raceSide();
  }
  ginfo.textContent = `lap ${Math.min(RACE.lap, LAPS)}/${LAPS} · ${fmtTime(RACE.t)}${RACE.best ? " · best lap " + fmtTime(RACE.best) : ""}${on ? "" : " · off the track!"}`;
  if (RACE.mp && now - RACE.sent > 0.1) {
    RACE.sent = now;
    send({ g: "race", k: "pos", id: RACE.id, x: Math.round(RACE.x * 10) / 10, y: Math.round(RACE.y * 10) / 10, a: Math.round(RACE.a * 100) / 100, lap: RACE.lap });
  }
}
function drawCar(x, y, a, color, name) {
  gx.save(); gx.translate(x, y); gx.rotate(a);
  gx.fillStyle = "#00000055"; gx.fillRect(-4, -2, 9, 6);
  gx.fillStyle = color; gx.fillRect(-5, -3, 10, 6);
  gx.fillStyle = "#1b1820"; gx.fillRect(-4, -4, 3, 1); gx.fillRect(2, -4, 3, 1); gx.fillRect(-4, 3, 3, 1); gx.fillRect(2, 3, 3, 1);
  gx.fillStyle = "#cfe8ff"; gx.fillRect(1, -2, 2, 4);
  gx.restore();
  if (name) gtext(name, x, y - 12, "#f1ebe2", 6, "center");
}
function drawTrack(t) {
  gpx(0, 0, GW, GH, "#3f7d3a");
  for (let i = 0; i < 90; i++) gpx((hash("g" + i) % GW), (hash("h" + i) % GH), 2, 1, "#4a8b44");
  const path = () => { gx.beginPath(); t.line.forEach((p, i) => i ? gx.lineTo(p[0], p[1]) : gx.moveTo(p[0], p[1])); gx.closePath(); };
  gx.lineJoin = "round";
  gx.setLineDash([4, 4]); gx.strokeStyle = "#e06c6c"; gx.lineWidth = t.w * 2 + 4; path(); gx.stroke();
  gx.setLineDash([]); gx.strokeStyle = "#f1ebe2"; gx.lineWidth = t.w * 2 + 4; gx.globalAlpha = 0.35; path(); gx.stroke(); gx.globalAlpha = 1;
  gx.strokeStyle = "#55535a"; gx.lineWidth = t.w * 2; path(); gx.stroke();
  gx.setLineDash([3, 5]); gx.strokeStyle = "#8a8890"; gx.lineWidth = 1; path(); gx.stroke(); gx.setLineDash([]);
  // the start line, checkered, across the track
  const p0 = t.line[0], p1 = t.line[1], ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  gx.save(); gx.translate(p0[0], p0[1]); gx.rotate(ang);
  for (let j = -t.w; j < t.w; j += 2) for (let i = 0; i < 4; i += 2) gpx(i + ((j / 2) % 2 ? 2 : 0) - 2, j, 2, 2, "#f1ebe2");
  gx.restore();
}
function drawRace() {
  const t = TRACKS[RACE.track], now = Date.now() / 1000;
  drawTrack(t);
  for (const o of Object.values(RACE.others)) if (!o.quit && o.x !== undefined) {
    o.dx = o.dx === undefined ? o.x : o.dx + (o.x - o.dx) * 0.3; o.dy = o.dy === undefined ? o.y : o.dy + (o.y - o.dy) * 0.3;
    drawCar(o.dx, o.dy, o.a || 0, o.color, o.name);
  }
  drawCar(RACE.x, RACE.y, RACE.a, myColor(), "you");
  if (RACE.phase === "wait") {
    const left = Math.ceil(RACE.startAt - now);
    gpx(GW / 2 - 40, GH / 2 - 20, 80, 40, "#0d0b10cc");
    gtext(left > 3 ? `${left}` : left > 0 ? ["", "1", "2", "3"][left] : "GO!", GW / 2, GH / 2 - 12, left > 3 ? "#a79d93" : "#ffe7a8", 20, "center");
  }
  if (RACE.phase === "go" && RACE.t < 1) gtext("GO!", GW / 2, GH / 2 - 12, "#8fd6b4", 20, "center");
  if (RACE.phase === "done") {
    gpx(GW / 2 - 70, GH / 2 - 24, 140, 48, "#0d0b10dd");
    gtext("FINISHED", GW / 2, GH / 2 - 18, "#8fd6b4", 10, "center");
    gtext(fmtTime(RACE.total), GW / 2, GH / 2 - 2, "#ffe7a8", 14, "center");
  }
}

// ---------- fishing ----------
// Hold Space (or the mouse) to charge a cast and let go to throw. Wait for a bite: when the bobber
// dives and "!" shows, press Space within a second to hook it. Then reel: holding Space pulls the
// fish in and raises the line's tension; the fish pulls back. Above the red the line snaps; with
// no tension for two seconds the fish gets away.
const FISH = [
  // name, colour, kg range, how often (weight), fight (how hard it pulls)
  ["Bluegill", "#6fa8dc", 0.1, 0.6, 30, 0.6], ["Perch", "#c9b458", 0.2, 1.2, 24, 0.8], ["Trout", "#b98be0", 0.5, 4, 16, 1.1],
  ["Bass", "#5fbf7f", 0.8, 5, 14, 1.2], ["Carp", "#c27460", 2, 15, 8, 1.4], ["Pike", "#7f9a7a", 2, 12, 5, 1.7],
  ["Catfish", "#8a7f74", 3, 25, 3, 1.9], ["Golden Koi", "#f0c040", 1, 6, 1, 1.5],
];
const FISHING = { phase: "idle", power: 0, dist: 0, wait: 0, bite: 0, fish: null, reel: 0, tension: 0, slack: 0, caught: [], feed: [], cup: null };
function startFish() {
  Object.assign(FISHING, { phase: "idle", power: 0, fish: null, tension: 0 });
  gtitle.textContent = "🎣 Fishing";
  gshow("fish");
  send({ g: "fish", k: "here" });
}
function fishSide() {
  const mine = FISHING.caught.slice(-6).reverse();
  const cup = FISHING.cup, now = Date.now() / 1000;
  const standing = cup ? Object.entries(cup.totals).sort((a, b) => b[1] - a[1]) : [];
  gside.innerHTML = `<h3>HOW</h3><div class="hint">Hold Space to charge a cast, let go to throw. When the bobber dives and ! shows, press Space. Then hold Space to reel; keep the line out of the red.</div>
    <h3>2-MINUTE CATCH</h3>${cup && cup.end > now
      ? `<div class="hint">${Math.ceil(cup.end - now)} s left</div>` + standing.map(([n, kg]) => `<div class="row"><span class="n">${esc(n)}</span><span class="v">${kg.toFixed(2)} kg</span></div>`).join("")
      : `<button class="go" data-cup="1">${inRoom() ? "Start a round with the room" : "Start a round"}</button>`}
    <h3>YOUR CATCH</h3>${mine.length ? mine.map(f => `<div class="row"><span class="n">${esc(f.name)}</span><span class="v">${f.kg.toFixed(2)} kg</span></div>`).join("") : `<div class="hint">nothing yet</div>`}
    ${FISHING.feed.length ? `<h3>THE ROOM</h3><div class="feed">${FISHING.feed.slice(-6).reverse().map(x => `<div>${esc(x)}</div>`).join("")}</div>` : ""}
    <h3>&nbsp;</h3><button data-home="1">Games</button>`;
}
function startCup(announce) {
  const now = Date.now() / 1000;
  FISHING.cup = { end: now + 120 + (announce && inRoom() ? 5 : 0), start: now + (announce && inRoom() ? 5 : 0), totals: { [myName()]: 0 } };
  if (announce) send({ g: "fish", k: "cup", in: 5, len: 120 });
  toast(announce && inRoom() ? "🎣 A 2-minute round starts in 5 s" : "🎣 2 minutes: catch as much as you can", null, 4000);
  fishSide();
}
function pickFish() {
  const total = FISH.reduce((s, f) => s + f[4], 0); let r = Math.random() * total;
  for (const f of FISH) { r -= f[4]; if (r <= 0) return f; }
  return FISH[0];
}
function fishKey(k, down) {
  if (k !== " ") return;
  const F = FISHING;
  if (down && F.phase === "idle") { F.phase = "charge"; F.power = 0; }
  else if (!down && F.phase === "charge") { F.phase = "wait"; F.dist = 30 + F.power * 150; F.wait = 2 + Math.random() * 5; }
  else if (down && F.phase === "bite") {
    const f = pickFish(), kg = +(f[2] + Math.pow(Math.random(), 2.2) * (f[3] - f[2])).toFixed(2);
    Object.assign(F, { phase: "reel", fish: { name: f[0], color: f[1], kg, fight: f[5] }, reel: F.dist, tension: 0.3, slack: 0, pull: 0, surge: 0, target: 0 });
  }
}
gcv.addEventListener("mousedown", () => { if (GAME.view === "fish") fishKey(" ", true); });
gcv.addEventListener("mouseup", () => { if (GAME.view === "fish") fishKey(" ", false); });
function fishStep(dt) {
  const F = FISHING, holding = GAME.keys.has(" "), now = Date.now() / 1000;
  if (F.cup && now > F.cup.end && !F.cup.over) {
    F.cup.over = true;
    const mine = F.cup.totals[myName()] || 0;
    if (mine > 0) { const pb = scoreBoard("fish-haul", +mine.toFixed(2)); toast(`🏆 Round over: ${mine.toFixed(2)} kg${pb ? " · your best round!" : ""}`, null, 6000); }
    else toast("Round over", null, 3000);
    fishSide();
  }
  if (F.phase === "charge") F.power = Math.min(1, F.power + dt * 0.9);
  if (F.phase === "wait") { F.wait -= dt; if (F.wait <= 0) { F.phase = "bite"; F.bite = 1.0; } }
  if (F.phase === "bite") { F.bite -= dt; if (F.bite <= 0) { F.phase = "wait"; F.wait = 1.5 + Math.random() * 4; } }
  if (F.phase === "reel") {
    const f = F.fish;
    // the fish surges and rests: a new pull every second or so, up to its fight. Letting go always
    // lowers the tension (it can at most slow that down), but the fish swims off a little meanwhile.
    F.surge = (F.surge || 0) - dt;
    if (F.surge <= 0) { F.surge = 0.6 + Math.random() * 0.9; F.target = Math.random() < 0.35 ? f.fight * (0.5 + Math.random() * 0.5) : Math.random() * 0.3; }
    F.pull += ((F.target || 0) - F.pull) * Math.min(1, dt * 4);
    F.tension += (holding ? 0.6 : -1.2) * dt + F.pull * dt * 0.45;
    if (holding) F.reel -= dt * (30 - f.fight * 6) * (1.25 - F.tension * 0.5);
    else F.reel = Math.min(F.dist + 40, F.reel + F.pull * dt * 6);
    F.tension = Math.max(0, F.tension);
    F.slack = F.tension < 0.06 ? F.slack + dt : 0;
    if (F.tension >= 1) { F.phase = "idle"; F.fish = null; toast("💥 The line snapped", null, 2500); }
    else if (F.slack > 2) { F.phase = "idle"; F.fish = null; toast("The fish got away", null, 2500); }
    else if (F.reel <= 0) {
      F.phase = "idle"; F.caught.push(f);
      const pb = scoreBoard("fish-big", f.kg);
      if (F.cup && now >= F.cup.start && now <= F.cup.end) F.cup.totals[myName()] = (F.cup.totals[myName()] || 0) + f.kg;
      send({ g: "fish", k: "catch", name: f.name, kg: f.kg });
      toast(`🐟 ${f.name}, ${f.kg.toFixed(2)} kg${pb ? " · your biggest yet!" : ""}`, null, 4000);
      F.fish = null; fishSide();
    }
  }
  const cup = F.cup && !F.cup.over ? ` · round: ${Math.max(0, Math.ceil(F.cup.end - now))} s` : "";
  ginfo.textContent = ({ idle: "hold Space to cast", charge: "let go to cast", wait: "waiting for a bite…", bite: "!! press Space !!", reel: "hold Space to reel" })[F.phase] + cup;
}
function drawFishSprite(x, y, c, s, tilt) {
  gx.save(); gx.translate(x, y); gx.rotate(tilt || 0); gx.scale(s, s);
  gx.fillStyle = c; gx.fillRect(-6, -2, 10, 4); gx.fillRect(-4, -3, 6, 6); gx.fillRect(4, -3, 3, 2); gx.fillRect(4, 1, 3, 2);
  gx.fillStyle = "#1b1820"; gx.fillRect(-5, -1, 1, 1);
  gx.restore();
}
function drawFish(t) {
  const F = FISHING, wy = 90;
  // sky, hills, water, the dock
  gpx(0, 0, GW, wy, "#8fc4e8"); gpx(0, wy - 18, GW, 18, "#6a9a5f");
  for (let i = 0; i < GW; i += 24) gpx(i, wy - 22 - (hash("hill" + i) % 8), 24, 8, "#5f8d55");
  gpx(0, wy, GW, GH - wy, "#2a5a8a");
  for (let i = 0; i < 40; i++) { const xx = (hash("w" + i) % GW + t * 6) % GW; gpx(xx, wy + 6 + (hash("v" + i) % (GH - wy - 10)), 5, 1, "#3d72a6"); }
  gpx(0, wy - 6, 70, 6, "#8a6a45"); gpx(0, wy - 6, 70, 1, "#a8845a"); for (let i = 6; i < 70; i += 16) gpx(i, wy, 3, 22, "#6d5233");
  // the others fishing with you, along the dock
  const others = Object.values(FISHING.people || {}).filter(p => Date.now() / 1000 - p.at < 20).slice(0, 3);
  others.forEach((p, i) => { const ox = 14 + i * 14; gpx(ox, wy - 18, 6, 12, p.color); gpx(ox + 1, wy - 23, 4, 5, "#f1c9a5"); gtext(p.name.slice(0, 6), ox + 3, wy - 32, "#1b1820", 5, "center"); });
  // you, with a rod
  const px0 = 56, py0 = wy - 6;
  gpx(px0, py0 - 14, 7, 14, myColor()); gpx(px0 + 1, py0 - 20, 5, 6, "#f1c9a5");
  const bend = F.phase === "reel" ? 6 + F.tension * 8 : 0, tipX = px0 + 26, tipY = py0 - 26 + bend;
  gx.strokeStyle = "#6d5233"; gx.lineWidth = 1.5; gx.beginPath(); gx.moveTo(px0 + 5, py0 - 10); gx.quadraticCurveTo(px0 + 16, py0 - 26, tipX, tipY); gx.stroke();
  if (F.phase === "charge") { gpx(px0 - 2, py0 - 40, 34, 5, "#1b1820"); gpx(px0 - 1, py0 - 39, 32 * F.power, 3, F.power > 0.85 ? "#e06c6c" : "#8fd6b4"); }
  if (["wait", "bite", "reel"].includes(F.phase)) {
    const bx = tipX + (F.phase === "reel" ? F.reel : F.dist), dip = F.phase === "bite" ? 3 + Math.sin(t * 30) * 1.5 : Math.sin(t * 3) * 0.8;
    gx.strokeStyle = "#f1ebe2aa"; gx.lineWidth = 0.6; gx.beginPath(); gx.moveTo(tipX, tipY); gx.quadraticCurveTo((tipX + bx) / 2, wy - (F.phase === "reel" ? 10 * F.tension : -4), bx, wy + dip); gx.stroke();
    gpx(bx - 1.5, wy - 2 + dip, 3, 3, "#e06c6c"); gpx(bx - 1.5, wy - 2 + dip, 3, 1, "#f1ebe2");
    if (F.phase === "bite") gtext("!", bx, wy - 22, "#ffe7a8", 14, "center");
    if (F.phase === "reel") drawFishSprite(bx + 4, wy + 10 + Math.sin(t * 8) * 2, F.fish.color, 1.4, Math.sin(t * 6) * 0.3);
  }
  if (F.phase === "reel") {
    // the tension meter: green is safe, red snaps
    gpx(GW - 22, 20, 10, 120, "#1b1820"); gpx(GW - 21, 21, 8, 30, "#5a1e1e"); gpx(GW - 21, 51, 8, 89, "#1e3a2a");
    const h = Math.min(1, F.tension) * 118; gpx(GW - 21, 139 - h, 8, 2, F.tension > 0.75 ? "#e06c6c" : "#8fd6b4");
    gtext("line", GW - 17, 142, "#a79d93", 6, "center");
  }
  if (F.cup && !F.cup.over && Date.now() / 1000 < F.cup.start) gtext(`round starts in ${Math.ceil(F.cup.start - Date.now() / 1000)}`, GW / 2, 10, "#1b1820", 9, "center");
}

// ---------- from the room ----------
window.gameIn = msg => {
  const d = msg.d || {}, from = msg.from, name = msg.name || "Someone", now = Date.now() / 1000;
  if (from === room.you) return;                                   // our own, back from the host
  const color = SHIRTS[hash(from) % SHIRTS.length];
  if (d.g === "race") {
    if (d.k === "open" && TRACKS[d.track]) {
      RACE.lobbies[d.id] = { id: d.id, track: d.track, name, startAt: now + Math.min(30, Math.max(3, +d.in || RACE_WAIT)) };
      peopleKey = "";
      if (GAME.open && GAME.view === "home") homeSide();
      else if (GAME.open) toast(`🏎 ${esc(name)} opened a race on ${esc(TRACKS[d.track].name)} · click to join`, () => joinRace(d.id), 8000);
      else if (window.loungeNote) loungeNote(`🏎 ${name} opened a race on ${TRACKS[d.track].name}: Games tab → Join`);
    }
    if (RACE.id === d.id || (d.k === "join" && RACE.id === d.id)) {
      const o = RACE.others[from] || (RACE.others[from] = { name, color });
      if (d.k === "pos") Object.assign(o, { x: +d.x, y: +d.y, a: +d.a, lap: +d.lap });
      if (d.k === "done") { o.done = +d.time; toast(`🏁 ${esc(name)} finished: ${fmtTime(o.done)}`, null, 3000); }
      if (d.k === "quit") o.quit = true;
      if (GAME.view === "race" && d.k !== "pos") raceSide();
    }
  }
  if (d.g === "fish") {
    FISHING.people = FISHING.people || {};
    FISHING.people[from] = { name, color, at: now };
    if (d.k === "catch" && typeof d.kg === "number") {
      FISHING.feed.push(`${name}: ${d.name} ${d.kg.toFixed(2)} kg`);
      if (FISHING.cup && now >= FISHING.cup.start && now <= FISHING.cup.end) FISHING.cup.totals[name] = (FISHING.cup.totals[name] || 0) + d.kg;
      if (GAME.view === "fish") fishSide();
    }
    if (d.k === "cup") {
      const len = Math.min(300, Math.max(30, +d.len || 120)), wait = Math.min(30, Math.max(0, +d.in || 5));
      FISHING.cup = { start: now + wait, end: now + wait + len, totals: { [name]: 0, [myName()]: 0 } };
      if (GAME.open && GAME.view === "fish") { toast(`🎣 ${esc(name)} started a 2-minute round`, null, 4000); fishSide(); }
      else if (window.loungeNote) loungeNote(`🎣 ${name} started a 2-minute fishing round: Games tab → Go fishing`);
    }
  }
};

// ---------- the people panel's Games and Scores tabs ----------
window.gamesTabHTML = () => {
  const lobbies = Object.values(RACE.lobbies).filter(l => l.startAt > Date.now() / 1000);
  return `<div class="list">` +
    lobbies.map(l => `<div class="g"><span class="gn">🏎 ${esc(l.name)} · ${esc(TRACKS[l.track].name)}</span><button data-gjoin="${esc(l.id)}">Join</button></div>`).join("") +
    `<div class="g"><span class="gn">🏎 Race · 5 tracks</span><button data-gopen="home">Play</button></div>
     <div class="g"><span class="gn">🎣 Fishing</span><button data-gopen="fish">Play</button></div>
     <div class="empty">${inRoom() ? "Races and fishing rounds you start are open to everyone in the room." : "On your own for now: join a room to play together."}</div></div>`;
};
window.scoresTabHTML = () => `<div class="list">${boardsHTML(true)}</div>`;
window.gamesPanelClick = b => {
  if (b.dataset.gjoin) { openGames("home"); joinRace(b.dataset.gjoin); return true; }
  if (b.dataset.gopen) { if (b.dataset.gopen === "fish") { openGames("home"); startFish(); } else openGames("home"); return true; }
  return false;
};
window.gamesKey = () => Object.values(RACE.lobbies).filter(l => l.startAt > Date.now() / 1000).map(l => l.id).join(",") + "|" + JSON.stringify(boardsNow());

// the demo (office.html opened without the app): ?game=race2 or ?game=fish opens one, for trying
// and for screenshots
if (!bridge) {
  const want = new URLSearchParams(location.search).get("game") || "";
  if (want) setTimeout(() => {
    openGames("home");
    if (want.startsWith("race")) { startRace(Math.max(0, Math.min(4, (+want.slice(4) || 1) - 1)), false); RACE.startAt = Date.now() / 1000 - 0.1; }
    if (want === "fish") startFish();
  }, 300);
}
