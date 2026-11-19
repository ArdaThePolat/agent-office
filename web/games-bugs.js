// 🪲 Bug Whack (games.js is the shell): 45 seconds of bugs climbing out of the office's monitors,
// alone or with the room on the same bugs.
//
// Click one before it gets away: a bug is 1 point, a golden bug 5, and every fifth hit in a row 1
// more. Leave the green ones alone: they are features, and whacking one costs 3. Bugs come faster
// and stay shorter as the round goes on.
//
// Together: open a round, teammates join, the opener presses Start. The round is made from a seed
// the start carries, so every Mac shows the same bugs at the same desks at the same moment. The
// opener's Mac is the referee: a bug goes to whoever's click reaches it first, and it sends the
// scores with every bug it gives out. Your own click counts on your screen at once, and is put
// right if someone else got there first.
//
// Room messages, {g: "bugs", k, id, …}: open / lobby {players, owner}, join, leave, close, start
// {players, seed, in}, hit {n} (to the referee), got {n, by, pts} (from it), end {pts}, score {pts}.
"use strict";

const BUG_ROUND = 45, BUG_COLS = 4, BUG_ROWS = 3, BUG_DESKS = BUG_COLS * BUG_ROWS;
const BW = { phase: "idle", id: "", owner: "", ownerName: "", players: [], seed: 0, t: 0, sched: [], claimed: {}, pts: {}, streak: {}, pending: {}, splats: [], lobbies: {}, startAt: 0 };
const deskAt = i => ({ x: 40 + (i % BUG_COLS) * 80, y: 62 + Math.floor(i / BUG_COLS) * 50 });
const bwOwner = () => BW.owner === myId();

/// The round's bugs, the same on every Mac for the same seed: when each comes out, at which desk,
/// what kind, and for how long.
function bugSchedule(seed) {
  const r = seeded(seed), out = [], freeAt = Array(BUG_DESKS).fill(0);
  for (let t = 0.6; t < BUG_ROUND;) {
    const pace = t / BUG_ROUND, life = 1.3 - pace * 0.6;
    const free = [...Array(BUG_DESKS).keys()].filter(i => freeAt[i] <= t);
    if (free.length) {
      const desk = free[Math.floor(r() * free.length)], k = r();
      out.push({ n: out.length, at: t, desk, kind: k < 0.08 ? "gold" : k < 0.2 ? "feature" : "bug", life });
      freeAt[desk] = t + life + 0.2;
    }
    t += 0.55 - pace * 0.3 + r() * 0.35;
  }
  return out;
}
function bugsStart(arg) {
  Object.assign(BW, { phase: "pick", id: "" });
  gshow("bugs");
  if (arg === "demo") { Object.assign(BW, { id: "demo", owner: myId() }); beginBugs([{ id: myId(), name: myName() }], newSeed(), 0); }
}
function openBugs(together) {
  Object.assign(BW, { id: myId() + "-" + Date.now(), owner: myId(), ownerName: myName(), players: [{ id: myId(), name: myName() }] });
  if (!together || !inRoom()) return beginBugs(BW.players, newSeed(), 0);
  BW.phase = "lobby"; BW.pinged = Date.now() / 1000;
  gsend(bwLobby("open")); side();
}
const bwLobby = k => ({ g: "bugs", k, id: BW.id, players: BW.players, owner: BW.owner, ownerName: BW.ownerName });
function joinBugs(id) {
  const l = BW.lobbies[id]; if (!l) return;
  leaveCurrent();
  if (!GAME.open) openGames("home");
  Object.assign(BW, { phase: "lobby", id, owner: l.owner, ownerName: l.ownerName, players: l.players.filter(p => p.id !== myId()).concat([{ id: myId(), name: myName() }]) });
  gsend({ g: "bugs", k: "join", id });
  gshow("bugs");
}
function startBugs() {
  if (!bwOwner() || BW.phase !== "lobby") return;
  const seed = newSeed();
  gsend({ ...bwLobby("start"), seed, in: 3 });
  beginBugs(BW.players, seed, 3);
}
function beginBugs(players, seed, wait) {
  Object.assign(BW, { phase: "count", players, seed, sched: bugSchedule(seed), t: 0, claimed: {}, pts: {}, streak: {}, pending: {}, splats: [],
    startAt: Date.now() / 1000 + wait, ended: false });
  for (const p of players) BW.pts[p.id] = 0;
  side();
}
function leaveBugs() {
  if (!BW.id) return;
  if (BW.phase === "lobby") gsend({ g: "bugs", k: bwOwner() ? "close" : "leave", id: BW.id });
  BW.phase = "pick"; BW.id = "";
}

const pendingPts = () => Object.values(BW.pending).reduce((s, v) => s + v, 0);
const alive = b => BW.t >= b.at && BW.t < b.at + b.life && !BW.claimed[b.n];
function bugsSide() {
  const P = BW.phase;
  const scores = BW.players.map(p => [p, (BW.pts[p.id] || 0) + (p.id === myId() ? pendingPts() : 0)]).sort((a, b) => b[1] - a[1]);
  gside.innerHTML = `<h3>HOW</h3><div class="hint">Click a bug before it gets away: 🪲 1 point, 🌟 golden 5, every fifth hit in a row +1. Leave the 🟩 green ones: they are features (−3).</div>
    ${P === "pick" ? `<h3>&nbsp;</h3><div class="grid"><button class="go" data-solo="1">Play alone (45 s)</button>${inRoom() ? `<button class="go" data-room="1">Open a round for the room</button>` : ""}</div>
      ${inRoom() ? `<div class="hint" style="margin-top:6px">Together everyone gets the same bugs: the first click takes it.</div>` : ""}` : ""}
    ${P === "lobby" ? `<h3>PLAYERS</h3>${BW.players.map(p => `<div class="row"><span class="dot" style="background:${colorOf(p.id)}"></span><span class="n">${esc(p.name)}</span></div>`).join("")}
      ${bwOwner() ? `<h3>&nbsp;</h3><button class="go" data-start="1">Start</button> <button data-leave="1">Cancel</button>` : `<div class="hint" style="margin-top:8px">Waiting for ${esc(BW.ownerName)} to start.</div><h3>&nbsp;</h3><button data-leave="1">Leave</button>`}` : ""}
    ${P === "count" || P === "play" || P === "over" ? `<h3>${P === "over" ? "FINAL" : "SCORES"}</h3>` + scores.map(([p, v]) => `<div class="row"><span class="dot" style="background:${colorOf(p.id)}"></span><span class="n">${esc(p.name)}${p.id === myId() ? " (you)" : ""}</span><span class="v">${v}</span></div>`).join("") : ""}
    ${P === "over" ? `<h3>&nbsp;</h3><button class="go" data-again="1">Play again</button>` : ""}
    <h3>BEST ROUNDS</h3>${(boardsNow().boards.bugs || []).slice(0, 5).map((e, i) => `<div class="row"><span class="n">${i + 1}. ${esc(e.name)}</span><span class="v">${Math.round(e.value)}</span></div>`).join("") || `<div class="hint">none yet</div>`}
    <h3>&nbsp;</h3><button data-home="1">Games</button>`;
}

function bugsStep(dt) {
  const now = Date.now() / 1000;
  BW.splats = BW.splats.filter(s => (s.life -= dt) > 0);
  if (BW.phase === "lobby") {
    ginfo.textContent = `${BW.players.length} player${BW.players.length > 1 ? "s" : ""} in`;
    if (bwOwner() && now - BW.pinged > 20) { BW.pinged = now; gsend(bwLobby("lobby")); }
    return;
  }
  if (BW.phase === "count") { ginfo.textContent = `starts in ${Math.max(1, Math.ceil(BW.startAt - now))} s`; if (now >= BW.startAt) { BW.phase = "play"; side(); } return; }
  if (BW.phase !== "play") { ginfo.textContent = BW.phase === "over" ? `round over: ${BW.pts[myId()] || 0} points` : "alone or with the room"; return; }
  const before = BW.t; BW.t += dt;
  // the referee: a bug that got away (not a feature) ends everyone's run of hits
  if (bwOwner() && BW.sched.some(b => b.kind !== "feature" && !BW.claimed[b.n] && b.at + b.life > before && b.at + b.life <= BW.t)) BW.streak = {};
  ginfo.textContent = `${Math.ceil(Math.max(0, BUG_ROUND - BW.t))} s · ${(BW.pts[myId()] || 0) + pendingPts()} points`;
  if (BW.t >= BUG_ROUND && !BW.ended) {
    if (bwOwner()) { if (BW.players.length > 1) gsend({ g: "bugs", k: "end", id: BW.id, pts: BW.pts }); endBugs(); }
    else if (BW.t >= BUG_ROUND + 3) endBugs();                     // the referee went quiet: what we know
  }
}
function endBugs() {
  BW.ended = true; BW.phase = "over"; BW.pending = {};
  const mine = BW.pts[myId()] || 0;
  if (mine > 0) {
    const pb = scoreBoard("bugs", mine);
    if (BW.players.length === 1) gsend({ g: "bugs", k: "score", pts: mine });
    toast(`🪲 ${mine} points${pb ? " · your best round!" : ""}`, null, 5000);
    if (mine >= 50) achieve("exterminator");
  }
  side();
}
/// The referee gives bug n to `by` (when nobody has it yet) and works out the points.
function refereeHit(n, by) {
  const b = BW.sched[n]; if (!b) return;
  const had = BW.claimed[n];
  if (!had && BW.t < b.at + b.life + 0.5) {
    BW.claimed[n] = by;
    if (b.kind === "feature") { BW.pts[by] = Math.max(0, (BW.pts[by] || 0) - 3); BW.streak[by] = 0; }
    else { BW.streak[by] = (BW.streak[by] || 0) + 1; BW.pts[by] = (BW.pts[by] || 0) + (b.kind === "gold" ? 5 : 1) + (BW.streak[by] % 5 === 0 ? 1 : 0); }
  }
  // one word per bug: a click that lost already heard who got it; one too late hears "nobody"
  if (BW.players.length > 1 && (!had || had === by) && (BW.claimed[n] || by !== myId())) gsend({ g: "bugs", k: "got", id: BW.id, n, by: BW.claimed[n] || "", pts: BW.pts });
  gotBug(n, BW.claimed[n]);
}
function gotBug(n, by) {
  const b = BW.sched[n]; delete BW.pending[n];
  if (!b || !by) return;
  const d = deskAt(b.desk), who = BW.players.find(p => p.id === by);
  if (by === myId() && b.kind === "gold") achieve("golden-bug");
  if (by !== myId()) BW.splats.push({ x: d.x, y: d.y - 14, life: 0.7, text: who ? who.name.slice(0, 6) : "?", c: colorOf(by) });
  side();
}
function bugsMouse(p, type) {
  if (type !== "mousedown" || BW.phase !== "play") return;
  const hit = BW.sched.find(b => { if (!alive(b)) return false; const d = deskAt(b.desk); return Math.abs(p.x - d.x) < 22 && p.y > d.y - 30 && p.y < d.y + 14; });
  if (!hit) return;
  const d = deskAt(hit.desk), gain = hit.kind === "feature" ? -3 : hit.kind === "gold" ? 5 : 1;
  BW.splats.push({ x: d.x, y: d.y - 14, life: 0.6, text: (gain > 0 ? "+" : "−") + Math.abs(gain), c: gain < 0 ? "#e06c6c" : hit.kind === "gold" ? "#ffe7a8" : "#8fd6b4" });
  if (bwOwner()) return refereeHit(hit.n, myId());
  BW.claimed[hit.n] = myId(); BW.pending[hit.n] = gain;              // counted at once, put right by the referee
  gsend({ g: "bugs", k: "hit", id: BW.id, n: hit.n });
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
  gpx(0, 0, GW, GH, "#3a3040"); for (let y = 0; y < GH; y += 8) gpx(0, y, GW, 1, "#33293a");
  gpx(0, 0, GW, 26, "#e2d3b5"); gpx(0, 24, GW, 2, "#b09372");
  for (let i = 0; i < BUG_DESKS; i++) {
    const d = deskAt(i);
    gpx(d.x - 20, d.y, 40, 6, "#8a6a45"); gpx(d.x - 18, d.y + 6, 2, 10, "#6d5233"); gpx(d.x + 16, d.y + 6, 2, 10, "#6d5233");
    gpx(d.x - 10, d.y - 16, 20, 14, "#222"); gpx(d.x - 8, d.y - 14, 16, 10, "#1d3b4a"); gpx(d.x - 2, d.y - 2, 4, 2, "#444");
  }
  if (BW.phase === "play") for (const b of BW.sched) if (alive(b)) {
    const d = deskAt(b.desk), age = BW.t - b.at, rise = Math.min(1, age / 0.15, (b.life - age) / 0.15);
    drawBug(d.x, d.y - 10 - rise * 12, b.kind, 1 + (b.kind === "gold" ? Math.sin(t * 12) * 0.08 : 0));
  }
  for (const s of BW.splats) gtext(s.text, s.x, s.y - (0.7 - s.life) * 20, s.c, 9, "center");
  gtext(`${(BW.pts[myId()] || 0) + pendingPts()}`, 8, 8, "#1b1820", 10);
  if (BW.phase === "play") { gpx(GW - 108, 9, 100, 6, "#b09372"); gpx(GW - 108, 9, 100 * Math.max(0, 1 - BW.t / BUG_ROUND), 6, "#5fbf7f"); }
  const msg = BW.phase === "over" ? `${BW.pts[myId()] || 0} points` : BW.phase === "count" ? String(Math.max(1, Math.ceil(BW.startAt - Date.now() / 1000)))
    : BW.phase === "lobby" ? (bwOwner() ? "press Start when everyone is in" : "waiting for the start") : BW.phase === "play" ? "" : "alone or with the room";
  if (msg) { gpx(GW / 2 - 80, GH / 2 - 16, 160, 32, "#0d0b10cc"); gtext(msg, GW / 2, GH / 2 - 6, "#ffe7a8", BW.phase === "count" ? 16 : 9, "center"); }
}
function bugsMsg(from, name, d) {
  const now = Date.now() / 1000;
  // a round is its opener's: only they announce, start or close it (the host stamps who sent what)
  const owner = (BW.lobbies[d.id] && BW.lobbies[d.id].owner) || (BW.id === d.id ? BW.owner : "");
  if (["open", "lobby", "start", "close"].includes(d.k) && owner && owner !== from) return;
  if (d.k === "score") { if (+d.pts > 0) { const t = `🪲 ${name} whacked ${Math.round(+d.pts)} points of bugs`; if (GAME.open) toast(esc(t), null, 4000); else note(t); } return; }
  if ((d.k === "open" || d.k === "lobby") && Array.isArray(d.players)) {
    const fresh = !BW.lobbies[d.id];
    BW.lobbies[d.id] = { id: d.id, owner: from, ownerName: name, players: d.players.slice(0, 12).map(p => ({ id: String(p.id), name: String(p.name || "").slice(0, 40) })), at: now };
    if (BW.id === d.id && BW.phase === "lobby") { BW.players = BW.lobbies[d.id].players; if (!BW.players.some(p => p.id === myId())) BW.phase = "pick"; side(); }
    else if (fresh && d.k === "open") {
      if (GAME.open) toast(`🪲 ${esc(name)} opened a Bug Whack round · click to join`, () => joinBugs(d.id), 10000);
      else note(`🪲 ${name} opened a Bug Whack round: Games tab → Join`);
    }
    peopleKey = ""; return;
  }
  if (d.k === "close" || d.k === "start") { delete BW.lobbies[d.id]; peopleKey = ""; }
  if (BW.id !== d.id) return;
  if (d.k === "close" && BW.phase === "lobby") { BW.phase = "pick"; toast(`${esc(name)} closed the round`, null, 3000); return side(); }
  if (bwOwner() && BW.phase === "lobby") {
    if (d.k === "join" && !BW.players.some(p => p.id === from) && BW.players.length < 12) { BW.players.push({ id: from, name }); gsend(bwLobby("lobby")); side(); }
    if (d.k === "leave") { BW.players = BW.players.filter(p => p.id !== from); gsend(bwLobby("lobby")); side(); }
  }
  if (d.k === "start" && BW.phase === "lobby") {
    const players = (d.players || []).map(p => ({ id: String(p.id), name: String(p.name || "") }));
    if (!players.some(p => p.id === myId())) { BW.phase = "pick"; return side(); }
    beginBugs(players, (+d.seed) >>> 0, Math.min(10, Math.max(1, +d.in || 3)));
  }
  if (!BW.players.some(p => p.id === from)) return;
  if (d.k === "hit" && bwOwner() && BW.phase === "play") refereeHit(+d.n, from);
  if ((d.k === "got" || d.k === "end") && from === BW.owner) {
    if (d.pts && typeof d.pts === "object") for (const [id, v] of Object.entries(d.pts)) BW.pts[id] = +v || 0;
    if (d.k === "got") { if (d.by) BW.claimed[+d.n] = d.by; gotBug(+d.n, d.by); }
    if (d.k === "end" && !BW.ended) endBugs();
  }
}
function openRounds() {
  const now = Date.now() / 1000;
  for (const [id, l] of Object.entries(BW.lobbies)) if (now - l.at > 60) delete BW.lobbies[id];
  return Object.values(BW.lobbies).filter(l => l.id !== BW.id);
}
registerGame("bugs", {
  title: "🪲 Bug Whack",
  start: bugsStart, step: bugsStep, draw: drawBugs, side: bugsSide, mouse: bugsMouse, msg: bugsMsg, leave: leaveBugs,
  click: b => {
    if (b.dataset.solo) openBugs(false);
    if (b.dataset.room) openBugs(true);
    if (b.dataset.start) startBugs();
    if (b.dataset.leave || b.dataset.again) { leaveBugs(); side(); }
  },
  tab: () => { const l = openRounds(); return l.length ? `<div class="gh">BUG WHACK</div>` + l.map(x => `<div class="g"><span class="gn">🪲 ${esc(x.ownerName)}'s round · ${x.players.length} in</span><button data-gbjoin="${esc(x.id)}">Join</button></div>`).join("") : ""; },
  tabClick: b => { if (b.dataset.gbjoin) { joinBugs(b.dataset.gbjoin); return true; } return false; },
  tabKey: () => openRounds().map(l => l.id + l.players.length).join(","),
  homeHTML: () => { const l = openRounds(); return l.length ? `<h3>OPEN BUG ROUNDS</h3>` + l.map(x => `<div class="row"><span class="n">${esc(x.ownerName)} · ${x.players.length} in</span><button class="go" data-bjoin="${esc(x.id)}">Join</button></div>`).join("") : ""; },
  iconCenter: [215, 132],
  drawIcon: t => { drawBug(215, 128 - Math.abs(Math.sin(t * 3)) * 8, "bug", 1.5); gtext("bug whack", 215, 150, "#a79d93", 8, "center"); },
});
gside.addEventListener("click", ev => { const b = ev.target.closest("button[data-bjoin]"); if (b) joinBugs(b.dataset.bjoin); });
