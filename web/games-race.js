// 🏎 Race: five top-down tracks, 1 to 10 laps, alone or with the room (games.js is the shell).
//
// Pick a track and the laps, then open the race: in a room it is a lobby the others see (their
// Games tab, a toast in their game, a line in the log) and join; whoever opened it presses Start
// when everyone is in, and every car starts the same countdown from its own spot on the grid. Off
// the asphalt the top speed drops to a third until you are back on; cars bump off each other. The
// leaderboard keeps the best lap on each track, so races of any length compare.
//
// Room messages, {g: "race", k, id, …}: open / lobby {track, laps, players, owner} (the owner sends
// it again when someone joins or leaves, and every 20 s while waiting), join, leave, close, start
// {players, track, laps, in}, pos {x, y, a, v, lap} ten times a second, done {time, best}, quit.
"use strict";

const TRACKS = [
  { name: "Oval", w: 15, pts: [[60, 100], [80, 50], [160, 36], [240, 50], [262, 100], [240, 150], [160, 164], [80, 150]] },
  { name: "Hairpin", w: 14, pts: [[40, 160], [40, 50], [90, 30], [130, 60], [120, 112], [150, 136], [190, 60], [240, 30], [285, 60], [285, 160], [200, 178], [110, 178]] },
  { name: "Snake", w: 12, pts: [[40, 160], [42, 62], [70, 36], [100, 62], [102, 104], [130, 126], [160, 104], [160, 62], [190, 36], [220, 62], [222, 104], [250, 126], [276, 104], [282, 58], [300, 92], [294, 158], [250, 178], [150, 180], [62, 178]] },
  { name: "Chicane", w: 14, pts: [[40, 40], [150, 40], [165, 60], [180, 40], [285, 40], [285, 100], [265, 115], [285, 130], [285, 165], [170, 165], [155, 145], [140, 165], [40, 165], [40, 115], [60, 100], [40, 85]] },
  { name: "Grand Loop", w: 12, pts: [[30, 100], [40, 35], [110, 25], [150, 70], [190, 25], [280, 30], [295, 90], [250, 110], [290, 140], [270, 178], [180, 170], [140, 130], [100, 175], [40, 170]] },
];
for (const t of TRACKS) {
  // the smoothed centre line (Catmull-Rom through the points, 16 steps between two)
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
const CAR_R = 3.5, START_IN = 4, LOBBY_PING = 20, LOBBY_GONE = 60;
const RACE = { phase: "none", track: 0, laps: 3, lobbies: {}, others: {}, players: [] };

function nearest(t, x, y) {
  let best = 1e9, bi = 0;
  for (let i = 0; i < t.line.length; i++) { const dx = t.line[i][0] - x, dy = t.line[i][1] - y, d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; } }
  return { i: bi, d: Math.sqrt(best) };
}
/// A car's place on the starting grid: two abreast, rows of 16 px behind the line.
function gridSpot(t, slot) {
  const N = t.line.length, row = Math.floor(slot / 2), side = slot % 2 ? 1 : -1;
  let i = 0, dist = 7 + row * 16;
  while (dist > 0) { const a = t.line[(i - 1 + N) % N], b = t.line[i]; dist -= Math.hypot(b[0] - a[0], b[1] - a[1]); i = (i - 1 + N) % N; }
  const p = t.line[i], q = t.line[(i + 1) % N], ang = Math.atan2(q[1] - p[1], q[0] - p[0]), off = side * t.w * 0.45;
  return { x: p[0] - Math.sin(ang) * off, y: p[1] + Math.cos(ang) * off, a: ang };
}
const amOwner = () => RACE.owner === myId();
function lobbyMsg(k) { return { g: "race", k, id: RACE.id, track: RACE.track, laps: RACE.laps, players: RACE.players, owner: RACE.owner, ownerName: RACE.ownerName }; }
function placeOnGrid() {
  const t = TRACKS[RACE.track], slot = Math.max(0, RACE.players.findIndex(p => p.id === myId())), g = gridSpot(t, slot);
  Object.assign(RACE, { x: g.x, y: g.y, a: g.a, v: 0, lap: 1, cp: 0, t: 0, lapStart: 0, best: 0, total: 0, sent: 0, bumpAt: 0 });
}

function raceStart(arg) {
  const d = daily();
  Object.assign(RACE, { phase: "pick", daily: arg === "daily", others: {}, id: "" });
  if (arg === "daily") { RACE.track = d.track; RACE.laps = 3; }
  if (arg === "demo") { RACE.track = 1; }
  gshow("race");
  if (arg === "demo") openRace();
}
function openRace() {
  Object.assign(RACE, { phase: "lobby", id: myId() + "-" + Date.now(), owner: myId(), ownerName: myName(),
    players: [{ id: myId(), name: myName() }], others: {}, pinged: Date.now() / 1000 });
  placeOnGrid();
  if (inRoom()) gsend(lobbyMsg("open"));
  else beginCountdown();                              // alone: nobody to wait for
  side();
}
function joinRace(id) {
  const l = RACE.lobbies[id]; if (!l) return;
  leaveCurrent();
  if (!GAME.open) openGames("home");
  Object.assign(RACE, { phase: "lobby", id: l.id, track: l.track, laps: l.laps, owner: l.owner, ownerName: l.ownerName, daily: false,
    players: l.players.filter(p => p.id !== myId()).concat([{ id: myId(), name: myName() }]), others: {} });
  placeOnGrid();
  gsend({ g: "race", k: "join", id });
  gshow("race");
}
function leaveRace() {
  if (!RACE.id) return;
  if (RACE.phase === "lobby") gsend({ g: "race", k: amOwner() ? "close" : "leave", id: RACE.id });
  if (RACE.phase === "count" || RACE.phase === "go") gsend({ g: "race", k: "quit", id: RACE.id });
  RACE.phase = "none"; RACE.id = "";
}
function beginCountdown() {
  RACE.phase = "count"; RACE.startAt = Date.now() / 1000 + (inRoom() ? START_IN : 3);
  RACE.others = {};                                   // everyone back on their grid spot
  placeOnGrid(); side();
}
function startNow() {
  if (!amOwner() || RACE.phase !== "lobby") return;
  gsend({ ...lobbyMsg("start"), in: START_IN });
  beginCountdown();
}

function raceSide() {
  const t = TRACKS[RACE.track], P = RACE.phase;
  ginfo.textContent = "";
  if (P === "pick" || P === "none") {
    gside.innerHTML = `<h3>TRACK</h3><div class="pick">${TRACKS.map((x, i) => `<button data-track="${i}" class="${i === RACE.track ? "on" : ""}">${i + 1}. ${esc(x.name)}</button>`).join("")}</div>
      <h3>LAPS</h3><div class="pick"><button data-laps="-1">−</button><button class="on" disabled>${RACE.laps}</button><button data-laps="1">+</button></div>
      ${RACE.daily ? `<div class="hint" style="margin-top:6px">📅 Today's track: your best lap also counts for the daily board.</div>` : ""}
      <h3>&nbsp;</h3><button class="go" data-open="1">${inRoom() ? "Open the race to the room" : "Start"}</button>
      ${inRoom() ? `<div class="hint" style="margin-top:6px">Everyone in the room can join; you press Start when they are in.</div>` : ""}
      <h3>HOW</h3><div class="hint">↑ / W go · ↓ / S brake · ← → / A D steer. Off the asphalt you slow right down. Cars bump.</div>
      ${bestHTML()}<h3>&nbsp;</h3><button data-home="1">Games</button>`;
    return;
  }
  const rows = RACE.players.map(p => {
    const o = p.id === myId() ? null : RACE.others[p.id] || {};
    const st = p.id === myId() ? (RACE.total ? fmtTime(RACE.total) : P === "go" ? `lap ${Math.min(RACE.lap, RACE.laps)}/${RACE.laps}` : "ready")
      : o.quit ? "left" : o.done ? fmtTime(o.done) : P === "go" ? `lap ${Math.min(o.lap || 1, RACE.laps)}/${RACE.laps}` : "ready";
    return `<div class="row"><span class="dot" style="background:${colorOf(p.id)}"></span><span class="n">${esc(p.name)}${p.id === myId() ? " (you)" : ""}</span><span class="v">${st}</span></div>`;
  }).join("");
  const order = finishOrder();
  gside.innerHTML = `<h3>${esc(t.name.toUpperCase())} · ${RACE.laps} LAP${RACE.laps > 1 ? "S" : ""}</h3>${rows}
    ${P === "lobby" ? (amOwner() ? `<h3>&nbsp;</h3><button class="go" data-startnow="1">Start the race</button> <button data-leave="1">Cancel</button>
        <div class="hint" style="margin-top:6px">${RACE.players.length > 1 ? "Everyone starts together when you press Start." : "Waiting for others to join…"}</div>`
      : `<div class="hint" style="margin-top:8px">Waiting for ${esc(RACE.ownerName || "the host")} to start.</div><h3>&nbsp;</h3><button data-leave="1">Leave</button>`) : ""}
    ${P === "done" && order.length ? `<h3>RESULTS</h3>` + order.map((r, i) => `<div class="row"><span class="n">${i + 1}. ${esc(r.name)}</span><span class="v">${fmtTime(r.time)}</span></div>`).join("") : ""}
    ${P === "done" ? `<h3>&nbsp;</h3><button class="go" data-again="1">Race again</button> <button data-home="1">Games</button>` : ""}
    <h3>HOW</h3><div class="hint">↑ / W go · ↓ / S brake · ← → / A D steer. Off the asphalt you slow right down. Cars bump.</div>${bestHTML()}`;
}
function bestHTML() {
  const best = boardsNow().boards["race-" + (RACE.track + 1)];
  return `<h3>BEST LAP HERE</h3>` + (best && best.length ? best.slice(0, 5).map((e, i) => `<div class="row"><span class="n">${i + 1}. ${esc(e.name)}</span><span class="v">${fmtTime(e.value)}</span></div>`).join("") : `<div class="hint">no lap yet</div>`);
}
function finishOrder() {
  const out = []; if (RACE.total) out.push({ name: myName(), time: RACE.total });
  for (const p of RACE.players) { const o = RACE.others[p.id]; if (o && o.done) out.push({ name: p.name, time: o.done }); }
  return out.sort((a, b) => a.time - b.time);
}
function raceClick(b) {
  if (b.dataset.track) { RACE.track = +b.dataset.track; RACE.daily = RACE.track === daily().track && RACE.daily; side(); }
  if (b.dataset.laps) { RACE.laps = Math.max(1, Math.min(10, RACE.laps + +b.dataset.laps)); side(); }
  if (b.dataset.open) openRace();
  if (b.dataset.startnow) startNow();
  if (b.dataset.leave) { leaveRace(); RACE.phase = "pick"; side(); }
  if (b.dataset.again) { leaveRace(); RACE.phase = "pick"; side(); }
}

function raceStep(dt) {
  const now = Date.now() / 1000, t = TRACKS[RACE.track];
  if (RACE.phase === "lobby") {
    ginfo.textContent = `${RACE.players.length} driver${RACE.players.length > 1 ? "s" : ""} on the grid`;
    if (amOwner() && inRoom() && now - RACE.pinged > LOBBY_PING) { RACE.pinged = now; gsend(lobbyMsg("lobby")); }
    return;
  }
  if (RACE.phase === "count") {
    ginfo.textContent = `starts in ${Math.max(0, Math.ceil(RACE.startAt - now))} s`;
    if (now >= RACE.startAt) { RACE.phase = "go"; side(); }
    return;
  }
  if (RACE.phase !== "go") return;
  RACE.t += dt;                                       // the race's own clock: a hidden window pauses it
  const k = GAME.keys, up = k.has("arrowup") || k.has("w"), down = k.has("arrowdown") || k.has("s");
  const left = k.has("arrowleft") || k.has("a"), right = k.has("arrowright") || k.has("d");
  const n = nearest(t, RACE.x, RACE.y), on = n.d <= t.w, top = on ? 95 : 32;
  if (up) RACE.v += (on ? 110 : 60) * dt; else if (down) RACE.v -= 160 * dt; else RACE.v -= 40 * dt * Math.sign(RACE.v);
  if (!on && RACE.v > top) RACE.v -= 180 * dt;        // the grass drags you down to its top speed
  RACE.v = Math.max(-25, Math.min(RACE.v, on ? top : Math.max(top, RACE.v)));
  const steer = (left ? -1 : 0) + (right ? 1 : 0);
  RACE.a += steer * dt * 2.9 * Math.min(1, Math.abs(RACE.v) / 40) * Math.sign(RACE.v || 1);
  RACE.x = Math.max(4, Math.min(GW - 4, RACE.x + Math.cos(RACE.a) * RACE.v * dt));
  RACE.y = Math.max(4, Math.min(GH - 4, RACE.y + Math.sin(RACE.a) * RACE.v * dt));
  // bumping: each car moves itself out of the others and loses speed (each Mac resolves its own car)
  for (const o of Object.values(RACE.others)) {
    if (o.quit || o.dx === undefined) continue;
    const dx = RACE.x - o.dx, dy = RACE.y - o.dy, dist = Math.hypot(dx, dy);
    if (dist < CAR_R * 2 && dist > 0.01) {
      RACE.x = o.dx + dx / dist * CAR_R * 2; RACE.y = o.dy + dy / dist * CAR_R * 2;
      RACE.v *= 0.55; RACE.a += (Math.random() - 0.5) * 0.3;
      if (now - RACE.bumpAt > 1) { RACE.bumpAt = now; if (tally("bumps") >= 10) achieve("bumper"); }
    }
  }
  // laps: past a third, then two thirds, then over the line
  const N = t.line.length, f = n.i / N;
  if (RACE.cp === 0 && f > 0.3 && f < 0.45) RACE.cp = 1;
  if (RACE.cp === 1 && f > 0.63 && f < 0.78) RACE.cp = 2;
  if (RACE.cp === 2 && f < 0.08) {
    const lapT = RACE.t - RACE.lapStart; RACE.best = RACE.best ? Math.min(RACE.best, lapT) : lapT; RACE.lapStart = RACE.t; RACE.cp = 0;
    if (RACE.lap >= RACE.laps) finishRace(); else RACE.lap++;
    side();
  }
  if (RACE.phase === "go") ginfo.textContent = `lap ${Math.min(RACE.lap, RACE.laps)}/${RACE.laps} · ${fmtTime(RACE.t)}${RACE.best ? " · best lap " + fmtTime(RACE.best) : ""}${on ? "" : " · off the track!"}`;
  if (inRoom() && RACE.players.length > 1 && now - RACE.sent > 0.1) {
    RACE.sent = now;
    gsend({ g: "race", k: "pos", id: RACE.id, x: Math.round(RACE.x * 10) / 10, y: Math.round(RACE.y * 10) / 10, a: Math.round(RACE.a * 100) / 100, v: Math.round(RACE.v), lap: RACE.lap });
  }
}
function finishRace() {
  RACE.phase = "done"; RACE.total = RACE.t;
  const best = +RACE.best.toFixed(3), firstHere = !Object.values(RACE.others).some(o => o.done);
  const pb = scoreBoard("race-" + (RACE.track + 1), best);
  const d = daily(); if (RACE.track === d.track) { scoreBoard(`daily-race-${d.day}`, best); achieve("daily"); }
  gsend({ g: "race", k: "done", id: RACE.id, time: +RACE.total.toFixed(3), best });
  achieve("first-race");
  const done = store("tracksDone", {}); done[RACE.track] = 1; keep("tracksDone", done); if (Object.keys(done).length >= 5) achieve("all-tracks");
  if (RACE.track === 0 && best < 5.5) achieve("oval-fast");
  if (RACE.laps >= 10) achieve("marathon");
  if (firstHere && RACE.players.length > 1) achieve("winner");
  toast(`🏁 ${fmtTime(RACE.total)} · best lap ${fmtTime(best)}${pb ? " · your best lap here!" : ""}`, null, 5000);
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
  const p0 = t.line[0], p1 = t.line[1], ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  gx.save(); gx.translate(p0[0], p0[1]); gx.rotate(ang);
  for (let j = -t.w; j < t.w; j += 2) for (let i = 0; i < 4; i += 2) gpx(i + ((j / 2) % 2 ? 2 : 0) - 2, j, 2, 2, "#f1ebe2");
  gx.restore();
}
function drawRace() {
  const t = TRACKS[RACE.track], now = Date.now() / 1000, P = RACE.phase;
  drawTrack(t);
  if (P === "pick" || P === "none") { gpx(GW / 2 - 70, 8, 140, 16, "#0d0b10cc"); gtext(`${t.name} · ${RACE.laps} lap${RACE.laps > 1 ? "s" : ""}`, GW / 2, 12, "#ffe7a8", 8, "center"); return; }
  // the others: on their grid spot until they move, then where they last said they were
  RACE.players.forEach((p, slot) => {
    if (p.id === myId()) return;
    const o = RACE.others[p.id] || (RACE.others[p.id] = {});
    if (o.quit) return;
    if (o.x === undefined) { const g = gridSpot(t, slot); o.x = g.x; o.y = g.y; o.a = g.a; }
    o.dx = o.dx === undefined ? o.x : o.dx + (o.x - o.dx) * 0.3; o.dy = o.dy === undefined ? o.y : o.dy + (o.y - o.dy) * 0.3;
    drawCar(o.dx, o.dy, o.a || 0, colorOf(p.id), p.name.slice(0, 8));
  });
  drawCar(RACE.x, RACE.y, RACE.a, myColor(), "you");
  if (P === "lobby") { gpx(GW / 2 - 80, GH / 2 - 14, 160, 28, "#0d0b10cc"); gtext(amOwner() ? "press Start when everyone is in" : "waiting for the start", GW / 2, GH / 2 - 4, "#a79d93", 8, "center"); }
  if (P === "count") { const left = Math.max(1, Math.ceil(RACE.startAt - now)); gpx(GW / 2 - 24, GH / 2 - 20, 48, 40, "#0d0b10cc"); gtext(String(left), GW / 2, GH / 2 - 12, "#ffe7a8", 20, "center"); }
  if (P === "go" && RACE.t < 1) gtext("GO!", GW / 2, GH / 2 - 12, "#8fd6b4", 20, "center");
  if (P === "done") {
    gpx(GW / 2 - 70, GH / 2 - 24, 140, 48, "#0d0b10dd");
    gtext("FINISHED", GW / 2, GH / 2 - 18, "#8fd6b4", 10, "center");
    gtext(fmtTime(RACE.total), GW / 2, GH / 2 - 2, "#ffe7a8", 14, "center");
  }
}

function raceMsg(from, name, d) {
  const now = Date.now() / 1000;
  // a lobby is its opener's: only they announce, start or close it (the host stamps who sent what)
  const owner = (RACE.lobbies[d.id] && RACE.lobbies[d.id].owner) || (RACE.id === d.id ? RACE.owner : "");
  if (["open", "lobby", "start", "close"].includes(d.k) && owner && owner !== from) return;
  if ((d.k === "open" || d.k === "lobby") && TRACKS[d.track] && Array.isArray(d.players)) {
    const fresh = !RACE.lobbies[d.id];
    RACE.lobbies[d.id] = { id: d.id, track: d.track, laps: Math.max(1, Math.min(10, +d.laps || 3)), owner: from, ownerName: name,
      players: d.players.slice(0, 12).map(p => ({ id: String(p.id), name: String(p.name || "").slice(0, 40) })), at: now };
    if (RACE.id === d.id && RACE.phase === "lobby") {
      RACE.players = RACE.lobbies[d.id].players;
      if (!RACE.players.some(p => p.id === myId())) RACE.phase = "pick"; else placeOnGrid();
      side();
    }
    else if (fresh && d.k === "open") {
      if (GAME.open) toast(`🏎 ${esc(name)} opened a race on ${esc(TRACKS[d.track].name)} · click to join`, () => joinRace(d.id), 10000);
      else note(`🏎 ${name} opened a race on ${TRACKS[d.track].name}: Games tab → Join`);
      if (GAME.open && GAME.view === "home") side();
    }
    peopleKey = "";
    return;
  }
  if (d.k === "close" || d.k === "start") { delete RACE.lobbies[d.id]; peopleKey = ""; }
  if (d.k === "close" && RACE.id === d.id && RACE.phase === "lobby") { RACE.phase = "pick"; toast(`${esc(name)} closed the race`, null, 3000); side(); }
  if (RACE.id !== d.id) return;
  if (amOwner() && RACE.phase === "lobby") {
    if (d.k === "join" && !RACE.players.some(p => p.id === from) && RACE.players.length < 12) { RACE.players.push({ id: from, name }); gsend(lobbyMsg("lobby")); side(); }
    if (d.k === "leave") { RACE.players = RACE.players.filter(p => p.id !== from); gsend(lobbyMsg("lobby")); side(); }
  }
  if (d.k === "start" && RACE.phase === "lobby") {
    RACE.players = (d.players || []).map(p => ({ id: String(p.id), name: String(p.name || "") }));
    if (!RACE.players.some(p => p.id === myId())) { RACE.phase = "pick"; return side(); }
    RACE.laps = Math.max(1, Math.min(10, +d.laps || RACE.laps));
    beginCountdown();
    RACE.startAt = now + Math.min(10, Math.max(1, +d.in || START_IN));
  }
  if (!RACE.players.some(p => p.id === from)) return;
  const o = RACE.others[from] || (RACE.others[from] = {});
  if (d.k === "pos") Object.assign(o, { x: +d.x, y: +d.y, a: +d.a, lap: +d.lap });
  if (d.k === "done") { o.done = +d.time; toast(`🏁 ${esc(name)} finished: ${fmtTime(o.done)}`, null, 3000); side(); }
  if (d.k === "quit") { o.quit = true; side(); }
}
function openLobbies() {
  const now = Date.now() / 1000;
  for (const [id, l] of Object.entries(RACE.lobbies)) if (now - l.at > LOBBY_GONE) delete RACE.lobbies[id];
  return Object.values(RACE.lobbies).filter(l => l.id !== RACE.id);
}

registerGame("race", {
  title: "🏎 Race",
  start: raceStart, step: raceStep, draw: drawRace, side: raceSide, click: raceClick, msg: raceMsg,
  leave: leaveRace,
  trackName: i => TRACKS[i].name,
  homeHTML: () => { const l = openLobbies(); return l.length ? `<h3>OPEN RACES</h3>` + l.map(x => `<div class="row"><span class="n">${esc(x.ownerName)} · ${esc(TRACKS[x.track].name)} · ${x.laps}L · ${x.players.length}</span><button class="go" data-joinrace="${esc(x.id)}">Join</button></div>`).join("") : ""; },
  tab: () => { const l = openLobbies(); return l.length ? `<div class="gh">OPEN RACES</div>` + l.map(x => `<div class="g"><span class="gn">🏎 ${esc(x.ownerName)} · ${esc(TRACKS[x.track].name)} · ${x.laps} laps · ${x.players.length} in</span><button data-gjoin="${esc(x.id)}">Join</button></div>`).join("") : ""; },
  tabClick: b => { if (b.dataset.gjoin) { joinRace(b.dataset.gjoin); return true; } return false; },
  tabKey: () => openLobbies().map(l => l.id + l.players.length).join(","),
  drawIcon: t => {
    const a = t * 1.4, cx = 60 + Math.cos(a) * 30, cy = 120 + Math.sin(a) * 18;
    gx.strokeStyle = "#3d332e"; gx.lineWidth = 8; gx.beginPath(); gx.ellipse(60, 120, 30, 18, 0, 0, Math.PI * 2); gx.stroke();
    drawCar(cx, cy, a + Math.PI / 2, "#e06c6c"); gtext("race", 60, 150, "#a79d93", 8, "center");
  },
});
// the home's Join buttons for open races
gside.addEventListener("click", ev => { const b = ev.target.closest("button[data-joinrace]"); if (b) joinRace(b.dataset.joinrace); });
