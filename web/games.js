// Agent Office — the lounge's mini-games: the shell they share. Loaded by office.html after its own
// script (it uses its globals: room, bridge, esc, snap, SHIRTS, hash, roomMates, openSession,
// peopleKey), then each game registers itself: games-race.js, games-fish.js, games-bugs.js,
// games-pong.js, games-archery.js, games-sky.js.
//
// A game opens over the whole office. With a room, game messages go through the room's host
// ({game: …} to the app, gameIn(…) back; Room.swift relays them as they are, {g: <game>, k: <kind>,
// …}). Scores go to the room's leaderboard, which the host keeps on its own Mac; without a room,
// your own bests are kept in this page's storage. Achievements are this Mac's; their count rides on
// your character in the lounge (the profile's badge). While a game is open, an agent that starts
// waiting for you shows in the game, and the app sends a notification.
"use strict";

const GW = 320, GH = 200;                         // the games' own pixels
const BOARD_NAMES = {
  "race-1": "Race · Oval · best lap", "race-2": "Race · Hairpin · best lap", "race-3": "Race · Snake · best lap",
  "race-4": "Race · Chicane · best lap", "race-5": "Race · Grand Loop · best lap",
  "fish-big": "Fishing · biggest fish", "fish-haul": "Fishing · 2-minute catch",
  "bugs": "Bug Whack · best round", "pong-wins": "Ping-pong · games won",
  "archery": "Archery · best round", "sky": "Sky Patrol · best flight",
};
const LOW_WINS = b => b.startsWith("race-") || b.startsWith("daily-race");
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
  #game .gside { width: 240px; border-left: 2px solid var(--line); padding: 10px; overflow-y: auto; }
  #game .gside h3 { font-size: 11px; color: var(--muted); font-weight: normal; letter-spacing: .06em; margin: 12px 0 6px; }
  #game .gside h3:first-child { margin-top: 0; }
  #game .row { display: flex; gap: 6px; align-items: center; margin: 3px 0; }
  #game .row .n { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #game .row .v { color: var(--muted); }
  #game .grid { display: grid; grid-template-columns: 1fr; gap: 5px; }
  #game .pick { display: flex; gap: 4px; flex-wrap: wrap; }
  #game .pick button { padding: 4px 8px; }
  #game .pick button.on { background: var(--accent); color: #1b1820; border-color: var(--accent); }
  #game .feed div { color: var(--muted); margin: 3px 0; }
  #game .gtoast { position: fixed; top: 46px; left: 50%; transform: translateX(-50%); background: #3a2a14; border: 2px solid #ffb347;
    color: #ffe7a8; padding: 8px 14px; border-radius: 6px; display: none; cursor: pointer; max-width: 80%; z-index: 2; }
  #game .hint { color: var(--muted); font-size: 11px; line-height: 1.5; }
  #game .ach { display: flex; gap: 6px; margin: 4px 0; font-size: 11px; }
  #game .ach.off { opacity: .4; }
  @media (max-width: 640px) { #game .gside { display: none; } }
  #people .tabs { display: flex; border-bottom: 1px solid #3a302c; }
  #people .tabs button { flex: 1; font: 11px Menlo, monospace; background: none; border: 0; color: var(--muted); padding: 5px 0; cursor: pointer; }
  #people .tabs button.on { color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  #people .g { display: flex; align-items: center; gap: 6px; padding: 4px; }
  #people .g .gn { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #people .g button { font: 11px Menlo, monospace; color: #1b1820; background: #8fd6b4; border: 0; border-radius: 4px; padding: 3px 7px; cursor: pointer; }
  #people .g button.alt { background: #2c252b; color: var(--text); border: 1px solid #4a3d36; }
  #people .gh { color: var(--muted); font-size: 10px; padding: 6px 6px 2px; letter-spacing: .06em; }
  #people .sc { padding: 2px 6px; }
  #people .sc b { display: block; color: #ffe7a8; font-weight: normal; margin: 6px 0 2px; font-size: 11px; }
  #people .sc div { display: flex; gap: 6px; font-size: 11px; }
  #people .sc div span:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #people .sc div span:last-child { color: var(--muted); }`;
document.head.appendChild(gstyle);

// ---------- shared ----------
const GAME = { open: false, view: "home", keys: new Set(), last: 0, raf: 0 };
const GAMES = {};                                   // id → { title, start, step, draw, side, key, mouse, click, msg, tab, tabClick, leave }
function registerGame(id, g) { GAMES[id] = g; }
const myName = () => (snap && snap.manager && snap.manager.name) || "You";
const inRoom = () => room.status === "joined";
const myId = () => room.you || "me";
const colorOf = id => SHIRTS[hash(id) % SHIRTS.length];
const myColor = () => colorOf(myId());
const fmtTime = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const fmtScore = (b, v) => LOW_WINS(b) ? fmtTime(v) : b.startsWith("fish") || b.startsWith("daily-fish") ? v.toFixed(2) + " kg" : String(Math.round(v));
function gsend(d) { if (bridge && inRoom()) bridge.postMessage({ game: JSON.stringify(d) }); }
/// A random number generator from a seed: the same seed gives the same numbers on every Mac, so a
/// shared round (the bugs, the pond's fish) is the same everywhere without being sent.
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const newSeed = () => Math.floor(Math.random() * 2 ** 31);
function store(key, fallback) { try { return JSON.parse(localStorage.getItem("agentOffice." + key) || "null") ?? fallback; } catch (e) { return fallback; } }
function keep(key, v) { try { localStorage.setItem("agentOffice." + key, JSON.stringify(v)); } catch (e) {} }

// today, by this Mac's calendar: the daily challenge's track and fish, the same for everyone that day
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function daily() { const h = hash("daily " + today()); return { day: today(), track: h % 5, fish: (h >>> 4) % 8 }; }
function boardName(b) {
  if (BOARD_NAMES[b]) return BOARD_NAMES[b];
  const m = /^daily-(race|fish)-(.+)$/.exec(b);
  if (!m) return b;
  return m[1] === "race" ? `📅 Daily race · best lap (${m[2]})` : `📅 Daily fish · biggest (${m[2]})`;
}

/// A score: your own best on this Mac, and the room's board (the host keeps each name's best).
/// True when it beats your own best.
function scoreBoard(board, value) {
  const bests = store("bests", {});
  const old = bests[board], better = old === undefined || (LOW_WINS(board) ? value < old : value > old);
  if (better) { bests[board] = value; keep("bests", bests); }
  if (bridge && inRoom()) bridge.postMessage({ score: `${board}|${value}` });
  peopleKey = "";
  return better;
}
function boardsNow() {
  if (inRoom() && room.scores && Object.keys(room.scores).length) return { room: true, boards: room.scores };
  const boards = {};
  for (const [b, v] of Object.entries(store("bests", {}))) boards[b] = [{ name: myName(), value: v }];
  return { room: false, boards };
}
function boardsHTML(compact) {
  const { room: isRoom, boards } = boardsNow(), d = daily();
  const dailies = [`daily-race-${d.day}`, `daily-fish-${d.day}`].filter(b => boards[b] && boards[b].length);
  const names = dailies.concat(Object.keys(BOARD_NAMES).filter(b => boards[b] && boards[b].length));
  const list = names.length ? names.map(b => `<div class="sc"><b>${esc(boardName(b))}</b>` + boards[b].slice(0, compact ? 3 : 10).map((e, i) =>
      `<div><span>${i + 1}. ${esc(e.name)}</span><span>${fmtScore(b, e.value)}</span></div>`).join("") + `</div>`).join("")
    : `<div class="empty">No scores yet. Play something!</div>`;
  return (isRoom || !names.length ? "" : `<div class="empty">Your bests on this Mac (join a room for the room's leaderboard).</div>`) + list;
}
function toast(html, onClick, ms) {
  gtoast.innerHTML = html; gtoast.style.display = "block"; gtoast.onclick = () => { gtoast.style.display = "none"; if (onClick) onClick(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => { gtoast.style.display = "none"; }, ms || 6000);
}
/// Something for you while no game is open: the office's log strip.
function note(text) { if (window.loungeNote) loungeNote(text); }

// ---------- achievements ----------
// Kept on this Mac. Their count is the medal over your character in the lounge (also for teammates).
const ACHIEVEMENTS = [
  ["first-race", "🏁", "First race", "finish a race"],
  ["all-tracks", "🗺", "Tourist", "finish a race on all five tracks"],
  ["oval-fast", "⚡", "Oval in a flash", "lap the Oval in under 5.5 s"],
  ["marathon", "🏃", "Marathon", "finish a 10-lap race"],
  ["winner", "🥇", "Podium", "win a race against at least one teammate"],
  ["bumper", "💥", "Bumper cars", "bump into other cars 10 times"],
  ["first-fish", "🐟", "First catch", "catch a fish"],
  ["koi", "✨", "Golden", "catch a golden koi"],
  ["whopper", "🐋", "Whopper", "catch a fish over 15 kg"],
  ["haul", "🧺", "Full basket", "catch 30 kg in a 2-minute round"],
  ["angler", "🎣", "Angler", "catch 50 fish in all"],
  ["exterminator", "🪲", "Exterminator", "score 50 in a Bug Whack round"],
  ["golden-bug", "🌟", "Shiny", "whack a golden bug"],
  ["pong-cpu", "🤖", "Beat the machine", "beat the computer at ping-pong"],
  ["pong-win", "🏓", "Table champion", "win ping-pong against a teammate"],
  ["daily", "📅", "Daily player", "finish a daily challenge"],
  ["perfect", "💎", "Perfect catch", "land a fish without it ever leaving the green bar"],
  ["archer", "🏹", "Archer", "finish a round of archery"],
  ["bullseye", "🎯", "Bullseye", "hit a 10"],
  ["hat-trick", "🎩", "Hat trick", "three 10s in one end"],
  ["sharpshooter", "🦅", "Sharpshooter", "score 120 or more in an archery round"],
  ["ace", "✈", "Ace", "shoot down 100 planes in all"],
  ["gunship", "💣", "Gunship down", "shoot down a gunship"],
  ["sky-10k", "🌤", "High flyer", "score 10,000 in one flight"],
];
function achieved() { return store("achievements", {}); }
function achieve(id) {
  const a = achieved(); if (a[id]) return;
  const def = ACHIEVEMENTS.find(x => x[0] === id); if (!def) return;
  a[id] = Date.now(); keep("achievements", a);
  toast(`${def[1]} Achievement: <b>${esc(def[2])}</b>`, null, 5000);
  sendBadge(); peopleKey = "";
}
/// A running count kept on this Mac (fish caught, bumps…); returns the new total.
function tally(key, n) { const s = store("stats", {}); s[key] = (s[key] || 0) + (n || 1); keep("stats", s); return s[key]; }
function sendBadge() { const n = Object.keys(achieved()).length; if (bridge && n) bridge.postMessage({ badge: `🏅${n}` }); }
window.myBadge = () => { const n = Object.keys(achieved()).length; return n ? `🏅${n}` : ""; };
function achievementsHTML() {
  const a = achieved();
  return `<div class="hint">${Object.keys(a).length} of ${ACHIEVEMENTS.length}</div>` + ACHIEVEMENTS.map(([id, icon, title, how]) =>
    `<div class="ach${a[id] ? "" : " off"}" title="${esc(how)}"><span>${icon}</span><span><b>${esc(title)}</b> · ${esc(how)}</span></div>`).join("");
}

// ---------- the overlay ----------
function fitCanvas() {
  const r = gcv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  gcv.width = Math.max(1, Math.floor(r.width * dpr)); gcv.height = Math.max(1, Math.floor(r.height * dpr));
  const k = Math.min(gcv.width / GW, gcv.height / GH);
  GAME.k = k; GAME.ox = (gcv.width - GW * k) / 2; GAME.oy = (gcv.height - GH * k) / 2; GAME.dpr = dpr;
  gx.setTransform(k, 0, 0, k, GAME.ox, GAME.oy);
  gx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", () => { if (GAME.open) fitCanvas(); });
function gpx(x, y, w, h, c) { gx.fillStyle = c; gx.fillRect(x, y, w, h); }
function gtext(t, x, y, c, size, align) {
  gx.font = `${size || 8}px Menlo, monospace`; gx.fillStyle = c || "#f1ebe2"; gx.textAlign = align || "left"; gx.textBaseline = "top"; gx.fillText(t, x, y);
}
/// A mouse event's place in the games' own pixels.
function gamePoint(ev) {
  const r = gcv.getBoundingClientRect(), dpr = GAME.dpr || 1;
  return { x: ((ev.clientX - r.left) * dpr - GAME.ox) / GAME.k, y: ((ev.clientY - r.top) * dpr - GAME.oy) / GAME.k };
}
for (const type of ["mousedown", "mouseup", "mousemove"]) gcv.addEventListener(type, ev => {
  const g = GAMES[GAME.view]; if (g && g.mouse) g.mouse(gamePoint(ev), type);
});

function openGames(view) {
  GAME.open = true; gameEl.style.display = "flex"; GAME.keys.clear();
  gshow(view || "home");
  fitCanvas();
  if (!GAME.raf) GAME.raf = requestAnimationFrame(gtick);
  sendBadge();
}
function closeGames() {
  const g = GAMES[GAME.view]; if (g && g.leave) g.leave();
  GAME.open = false; gameEl.style.display = "none"; cancelAnimationFrame(GAME.raf); GAME.raf = 0; GAME.view = "home"; peopleKey = "";
}
window.openGames = openGames;
window.gameOpen = () => GAME.open;
gameEl.querySelector(".gclose").addEventListener("click", closeGames);
/// Before joining another game (a toast, the Games tab): leave the one in front properly, so its
/// lobby is closed or its players told, instead of left waiting.
function leaveCurrent() { const g = GAME.open && GAMES[GAME.view]; if (g && g.leave) g.leave(); }
/// Switch the overlay to a view: "home" or a game's id.
function gshow(view) {
  if (view !== GAME.view) { const g = GAMES[GAME.view]; if (g && g.leave) g.leave(); }
  GAME.view = view;
  if (view === "home") { gtitle.textContent = "🎮 Mini-games"; ginfo.textContent = inRoom() ? `with ${room.name}` : "on your own (join a room to play together)"; }
  else gtitle.textContent = GAMES[view].title;
  side();
}
function side() { if (GAME.view === "home") homeSide(); else if (GAMES[GAME.view].side) GAMES[GAME.view].side(); }
function gtick(ts) {
  GAME.raf = requestAnimationFrame(gtick);
  const dt = Math.min(0.05, (ts - (GAME.last || ts)) / 1000); GAME.last = ts;
  gx.save(); gx.setTransform(1, 0, 0, 1, 0, 0); gx.fillStyle = "#0d0b10"; gx.fillRect(0, 0, gcv.width, gcv.height); gx.restore();
  if (GAME.view === "home") return drawHome(ts / 1000);
  const g = GAMES[GAME.view];
  g.step(dt); g.draw(ts / 1000);
}
window.addEventListener("keydown", ev => {
  if (!GAME.open) return;
  const k = ev.key.toLowerCase();
  if (ev.key === "Escape") { ev.preventDefault(); return GAME.view === "home" ? closeGames() : gshow("home"); }
  GAME.keys.add(k);
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) ev.preventDefault();
  const g = GAMES[GAME.view]; if (g && g.key) g.key(k, true);
}, true);
window.addEventListener("keyup", ev => {
  if (!GAME.open) return;
  const k = ev.key.toLowerCase(); GAME.keys.delete(k);
  const g = GAMES[GAME.view]; if (g && g.key) g.key(k, false);
}, true);
gside.addEventListener("click", ev => {
  const b = ev.target.closest("button"); if (!b) return;
  if (b.dataset.home) return gshow("home");
  if (b.dataset.play) return GAMES[b.dataset.play].start(b.dataset.arg);
  const g = GAMES[GAME.view]; if (g && g.click) g.click(b);
});

// An agent started waiting for you (office.html's tracker calls this): in the game, and as a
// notification from the app.
window.gameAlert = s => {
  if (!GAME.open) return;
  const what = s.title || s.cwd || "A session";
  toast(`⚠ <b>${esc(what)}</b> needs you · click to go to it`, () => { closeGames(); openSession(s); }, 15000);
  if (bridge) bridge.postMessage({ gameNotice: what });
};

// ---------- home ----------
function homeSide() {
  const d = daily(), extra = Object.values(GAMES).map(g => g.homeHTML ? g.homeHTML() : "").join("");
  gside.innerHTML = `<h3>PLAY</h3><div class="grid">
      <button class="go" data-play="race">🏎 Race</button><button class="go" data-play="fish">🎣 Fishing</button>
      <button class="go" data-play="bugs">🪲 Bug Whack</button><button class="go" data-play="pong">🏓 Ping-pong</button>
      <button class="go" data-play="archery">🏹 Archery</button><button class="go" data-play="sky">✈ Sky Patrol</button></div>
    <h3>📅 TODAY'S CHALLENGE</h3><div class="hint">${esc(GAMES.race.trackName(d.track))} (best lap) and the biggest ${esc(GAMES.fish.speciesName(d.fish))}: the same for everyone today.</div>
    <div class="grid" style="margin-top:5px"><button data-play="race" data-arg="daily">Race today's track</button><button data-play="fish" data-arg="daily">Fish for today's</button></div>
    ${extra}
    <h3>LEADERBOARD</h3>${boardsHTML(true)}
    <h3>ACHIEVEMENTS</h3>${achievementsHTML()}`;
}
function drawHome(t) {
  gpx(0, 0, GW, GH, "#1b1820");
  gtext("MINI-GAMES", GW / 2, 30, "#8fd6b4", 16, "center");
  gtext("pick one on the right · Esc goes back", GW / 2, 52, "#a79d93", 8, "center");
  // the games' icons, three to a row: each game draws its own around its iconCenter
  Object.values(GAMES).filter(g => g.drawIcon).forEach((g, i) => {
    const [cx, cy] = g.iconCenter || [0, 0], x = 60 + (i % 3) * 100, y = 92 + Math.floor(i / 3) * 64;
    gx.save(); gx.translate(x - cx, y - cy); g.drawIcon(t); gx.restore();
  });
}

// ---------- from the room ----------
window.gameIn = msg => {
  const d = msg.d || {}, from = msg.from;
  if (!from || from === room.you) return;                          // our own, back from the host
  const g = GAMES[d.g]; if (g && g.msg) g.msg(from, msg.name || "Someone", d);
};

// ---------- the people panel's Games and Scores tabs ----------
window.gamesTabHTML = () => {
  const parts = Object.values(GAMES).map(g => g.tab ? g.tab() : "").join("");
  return `<div class="list">${parts}
    <div class="gh">PLAY</div>
    <div class="g"><span class="gn">🏎 Race · 5 tracks</span><button data-gplay="race">Play</button></div>
    <div class="g"><span class="gn">🎣 Fishing</span><button data-gplay="fish">Play</button></div>
    <div class="g"><span class="gn">🪲 Bug Whack</span><button data-gplay="bugs">Play</button></div>
    <div class="g"><span class="gn">🏓 Ping-pong</span><button data-gplay="pong">Play</button></div>
    <div class="g"><span class="gn">🏹 Archery</span><button data-gplay="archery">Play</button></div>
    <div class="g"><span class="gn">✈ Sky Patrol</span><button data-gplay="sky">Play</button></div>
    <div class="empty">${inRoom() ? "Races, rounds and challenges you start are open to the room. G opens the games." : "On your own for now: join a room to play together. G opens the games."}</div></div>`;
};
window.scoresTabHTML = () => `<div class="list">${boardsHTML(true)}<div class="gh">ACHIEVEMENTS</div><div class="sc">${
  ACHIEVEMENTS.filter(a => achieved()[a[0]]).map(a => `<div><span>${a[1]} ${esc(a[2])}</span><span></span></div>`).join("") || `<div><span>none yet</span><span></span></div>`}</div></div>`;
window.gamesPanelClick = b => {
  if (b.dataset.gplay) { openGames("home"); GAMES[b.dataset.gplay].start(); return true; }
  for (const g of Object.values(GAMES)) if (g.tabClick && g.tabClick(b)) return true;
  return false;
};
window.gamesKey = () => Object.values(GAMES).map(g => g.tabKey ? g.tabKey() : "").join("|") + JSON.stringify(boardsNow()) + Object.keys(achieved()).length;

// the demo (office.html opened without the app): ?game=race, fish, bugs, pong, archery or sky opens one
if (!bridge) {
  const want = new URLSearchParams(location.search).get("game") || "";
  if (want) setTimeout(() => { openGames("home"); if (GAMES[want]) GAMES[want].start("demo"); }, 300);
}
