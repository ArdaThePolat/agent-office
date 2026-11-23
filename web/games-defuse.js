// 💣 Defuse (games.js is the shell): a top-down team shooter for the room, 1 on 1 up to 5 on 5, on two
// maps: Dune, a desert town with two bomb sites and three ways between the spawns, and Depot, a small
// warehouse. One team attacks: it carries a bomb to site A or B and plants it; the other defends the
// sites, and defuses the bomb once it is down. A round ends when a team is out, the bomb goes off or
// is defused, or the clock runs out (that one goes to the defenders). First to 5 rounds; the teams
// swap sides after round 4. Bots fill empty places, so it also plays alone.
//
// Who decides what: whoever opened the match is its referee. Every player moves themselves and says
// where they are ten times a second, with the shots they fired and whom they hit (the shooter's own
// view decides a hit, so what you see is what you hit). The referee keeps health, deaths, the bomb,
// the clock and the score, runs the bots, and sends all that with its own position, ten times a
// second. So everyone sends 10 messages a second, inside the room's limit (Room.swift).
//
// Room messages, {g: "defuse", k, id, …}: open / lobby {map, players: [{id, name, t, b}]} (the referee
// again on every change and every 20 s), join, team {t}, leave, close, start {map, players, seed},
// p {x, y, a, w, s: tracers [[x, y]…], h: hits [[player, damage]…], st: the referee's state (refState)},
// plant {x, y, site}, defuse, quit.
(() => {
"use strict";

const T = 8;                                       // a tile, in the games' pixels
const R = 3.2;                                     // a player's radius
const SPEED = 52;                                  // px a second, running
const WIN = 5, HALF = 4, BUY = 6, ROUND = 105, BOMB = 35, PLANT = 3, DEFUSE = 5, END = 4;
const SEND = 0.1, GONE = 6, LOBBY_PING = 20, LOBBY_GONE = 60, MAX_TEAM = 5;
const TEAMS = [{ name: "Sand", c: "#f0a35e" }, { name: "Sky", c: "#5b8def" }];
const WEAPONS = [                                  // the four to pick from, then the pistol everyone has
  { n: "Rifle",   k: "AR", dmg: 30,  rate: 9,    auto: 1, mag: 30, rel: 2.4, sp: 0.012, mv: 0.07, rc: 0.012, rmax: 0.07, spd: 0.92, range: 420 },
  { n: "SMG",     k: "SM", dmg: 21,  rate: 12,   auto: 1, mag: 30, rel: 2.0, sp: 0.03,  mv: 0.03, rc: 0.008, rmax: 0.06, spd: 1.0,  range: 300 },
  { n: "Shotgun", k: "SG", dmg: 15,  rate: 1.1,  auto: 0, mag: 7,  rel: 2.8, sp: 0.13,  mv: 0.02, rc: 0,     rmax: 0,    spd: 0.95, range: 170, pel: 7, fall: 1 },
  { n: "Sniper",  k: "SR", dmg: 115, rate: 0.75, auto: 0, mag: 5,  rel: 3.2, sp: 0.002, mv: 0.18, rc: 0,     rmax: 0,    spd: 0.82, range: 600 },
  { n: "Pistol",  k: "P",  dmg: 26,  rate: 4,    auto: 0, mag: 12, rel: 1.6, sp: 0.014, mv: 0.03, rc: 0.03,  rmax: 0.06, spd: 1.0,  range: 320 },
];
const BOT_NAMES = ["Bot Ada", "Bot Kai", "Bot Noor", "Bot Remy", "Bot Juno", "Bot Sami", "Bot Lia", "Bot Ozan", "Bot Mira", "Bot Tess"];
const REASONS = { out: "the other team is out", time: "time ran out", boom: "the bomb went off", cut: "the bomb was defused" };
// Only whole numbers go into room messages: the host re-encodes each message (Foundation's JSON) before
// it checks the size limit, and a fraction like 123.4 comes out as 123.40000000000001. So positions
// travel as whole pixels and angles in hundredths of a radian.
const ri = Math.round, ra = a => Math.round(a * 100);

// ---------- the maps: carved out of solid rock, a rectangle at a time ----------
// # wall, x crate, . and , floor, A and B the bomb sites, a and d the attackers' and defenders' spawns
const isOpen = c => c !== "#" && c !== "x";
function buildMap(name, blurb, w, h, theme, carve) {
  const g = Array.from({ length: h }, () => new Array(w).fill("#"));
  const set = (x, y, ww, hh, ch, onFloor) => {
    for (let j = y; j < y + hh; j++) for (let i = x; i < x + ww; i++)
      if (i > 0 && j > 0 && i < w - 1 && j < h - 1 && (!onFloor || isOpen(g[j][i]))) g[j][i] = ch;
  };
  carve({ floor: (x, y, ww, hh, ch) => set(x, y, ww, hh, ch || "."), mark: (x, y, ww, hh, ch) => set(x, y, ww, hh, ch, true),
          crate: (x, y, ww, hh) => set(x, y, ww || 1, hh || 1, "x"), wall: (x, y, ww, hh) => set(x, y, ww || 1, hh || 1, "#") });
  const m = { name, blurb, w, h, g, theme, sites: {}, spawn: { a: [], d: [] }, flows: {} };
  const tiles = { A: [], B: [] };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const c = g[j][i];
    if (c === "A" || c === "B") tiles[c].push([i, j]);
    if (c === "a" || c === "d") m.spawn[c].push([i, j]);
  }
  for (const k of ["A", "B"]) {
    // the site's spot: its open tile nearest the middle (a crate may stand in the very middle)
    const t = tiles[k], cx = t.reduce((s, p) => s + p[0], 0) / t.length, cy = t.reduce((s, p) => s + p[1], 0) / t.length;
    const [si, sj] = t.reduce((b, p) => Math.hypot(p[0] - cx, p[1] - cy) < Math.hypot(b[0] - cx, b[1] - cy) ? p : b, t[0]);
    m.sites[k] = { tiles: new Set(t.map(([i, j]) => j * w + i)), x: si * T + T / 2, y: sj * T + T / 2, mx: cx * T + T / 2, my: cy * T + T / 2 };
  }
  // spawn spots a tile apart, in a checker, so nobody starts on top of anybody
  for (const s of ["a", "d"]) m.spawn[s] = m.spawn[s].filter(([i, j]) => (i + j) % 2 === 0).map(([i, j]) => [i * T + T / 2, j * T + T / 2]);
  return m;
}
const MAPS = [
  buildMap("Dune", "a desert town: site A in the west, B in the east, a courtyard between", 72, 48,
    { floor: "#c9a96e", floor2: "#b99a63", speck: "#d8bc84", wall: "#8a6a44", top: "#ae8a5c", edge: "#5e4630", crate: "#7a5230", plank: "#a0703f", siteC: "#e06c6c", out: "#3a2c1e" },
    m => {
      m.floor(3, 37, 15, 9, ","); m.mark(5, 39, 10, 5, "a");                  // the attackers' yard (south-west)
      m.floor(36, 2, 15, 7, ","); m.mark(38, 3, 11, 5, "d");                  // the defenders' house (north)
      m.floor(4, 3, 17, 12); m.mark(7, 5, 10, 7, "A");                        // site A
      m.floor(52, 24, 16, 13); m.mark(55, 26, 10, 8, "B");                    // site B
      m.floor(28, 18, 16, 13);                                                // the courtyard
      m.floor(6, 26, 4, 11); m.floor(4, 20, 9, 7); m.floor(9, 15, 4, 5);      // west: up through the hut to A
      m.floor(18, 38, 16, 3); m.floor(30, 31, 4, 7);                          // middle: east, then up into the courtyard
      m.floor(18, 43, 33, 3); m.floor(44, 33, 7, 10); m.floor(51, 33, 1, 4);  // east: the long road, then the tunnel into B
      m.floor(21, 4, 15, 4); m.floor(51, 4, 10, 4); m.floor(58, 8, 4, 16);    // the defenders' roads to A and down to B
      m.floor(34, 9, 4, 9);                                                   // the house straight down into the courtyard
      m.floor(21, 20, 7, 4); m.floor(21, 12, 4, 8); m.floor(44, 26, 8, 4);    // the courtyard's ways to A and to B
      m.crate(10, 7, 2, 2); m.crate(15, 10, 2, 1); m.crate(6, 12, 1, 2); m.wall(18, 6, 1, 3);       // cover on A
      m.crate(58, 29, 2, 2); m.crate(62, 27, 1, 2); m.crate(56, 33, 2, 1); m.crate(64, 32, 1, 1);   // cover on B
      m.crate(32, 22, 2, 2); m.crate(38, 26, 2, 2); m.wall(36, 20, 1, 1); m.crate(41, 19, 1, 1);    // the courtyard
      m.crate(7, 22, 1, 1); m.crate(11, 24, 1, 1);                                                  // the hut
      m.crate(26, 5, 1, 1); m.crate(55, 6, 1, 1); m.crate(25, 44, 1, 1); m.crate(38, 43, 1, 1); m.crate(47, 37, 1, 1);
    }),
  buildMap("Depot", "a small warehouse: one hall, a block in the middle, a site at each end", 48, 30,
    { floor: "#7d7f86", floor2: "#73757c", speck: "#8a8c93", wall: "#4a4c55", top: "#5e606a", edge: "#2e3038", crate: "#3f6f8f", plank: "#5b8db0", siteC: "#e3c74f", out: "#1c1d22" },
    m => {
      m.floor(2, 2, 44, 26, ",");
      m.mark(19, 23, 10, 4, "a"); m.mark(19, 3, 10, 3, "d");
      m.mark(3, 10, 9, 10, "A"); m.mark(36, 10, 9, 10, "B");
      m.wall(19, 11, 10, 8);                                                  // the block in the middle
      m.crate(8, 6, 6, 1); m.crate(34, 6, 6, 1); m.crate(8, 23, 6, 1); m.crate(34, 23, 6, 1);   // shelves
      m.crate(6, 13, 2, 2); m.crate(9, 17, 1, 1); m.crate(40, 13, 2, 2); m.crate(38, 17, 1, 1);  // cover on the sites
      m.crate(16, 21, 1, 1); m.crate(31, 21, 1, 1); m.crate(16, 8, 1, 1); m.crate(31, 8, 1, 1);
    }),
];

const tileAt = (m, x, y) => { const i = Math.floor(x / T), j = Math.floor(y / T); return i < 0 || j < 0 || i >= m.w || j >= m.h ? "#" : m.g[j][i]; };
const solidAt = (m, x, y) => !isOpen(tileAt(m, x, y));
const blocked = (m, x, y) => solidAt(m, x - R, y - R) || solidAt(m, x + R, y - R) || solidAt(m, x - R, y + R) || solidAt(m, x + R, y + R);
function slide(m, o, dx, dy) { if (!blocked(m, o.x + dx, o.y)) o.x += dx; if (!blocked(m, o.x, o.y + dy)) o.y += dy; }
/// Nothing solid between two points (checked every 2 px).
function clear(m, x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
  for (let k = 1; k < n; k++) if (solidAt(m, x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n)) return false;
  return true;
}
/// How far a shot along angle a goes before a wall or a crate stops it.
function wallDist(m, x, y, a, max) {
  const dx = Math.cos(a), dy = Math.sin(a);
  for (let d = 1; d < max; d++) if (solidAt(m, x + dx * d, y + dy * d)) return d;
  return max;
}
/// Where along the ray from (x, y) at angle a it meets the circle, or -1.
function circleHit(x, y, a, cx, cy, r) {
  const dx = Math.cos(a), dy = Math.sin(a), fx = cx - x, fy = cy - y, t = fx * dx + fy * dy;
  if (t < 0) return -1;
  const px = fx - dx * t, py = fy - dy * t, d2 = px * px + py * py;
  return d2 > r * r ? -1 : t - Math.sqrt(r * r - d2);
}
function siteAt(m, x, y) {
  const k = Math.floor(y / T) * m.w + Math.floor(x / T);
  return m.sites.A.tiles.has(k) ? "A" : m.sites.B.tiles.has(k) ? "B" : "";
}
/// The way to a tile from everywhere: steps to it, by breadth-first search (kept per map and target).
function flow(m, x, y) {
  const ti = Math.floor(x / T), tj = Math.floor(y / T), key = ti + "," + tj;
  if (m.flows[key]) return m.flows[key];
  if (Object.keys(m.flows).length > 300) m.flows = {};        // bounded: bombs and guard spots come and go
  const d = new Int16Array(m.w * m.h).fill(-1), q = [tj * m.w + ti];
  d[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], i = c % m.w, j = (c - i) / m.w;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, n = nj * m.w + ni;
      if (ni >= 0 && nj >= 0 && ni < m.w && nj < m.h && d[n] < 0 && isOpen(m.g[nj][ni])) { d[n] = d[c] + 1; q.push(n); }
    }
  }
  return (m.flows[key] = d);
}
/// The next point on the way to a flow's target: the centre of the neighbouring tile closest to it.
function nextStep(m, f, x, y) {
  const i = Math.floor(x / T), j = Math.floor(y / T), here = f[j * m.w + i];
  let best = here < 0 ? 1e9 : here, bi = i, bj = j;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ni = i + di, nj = j + dj, v = ni >= 0 && nj >= 0 && ni < m.w && nj < m.h ? f[nj * m.w + ni] : -1;
    if (v >= 0 && v < best) { best = v; bi = ni; bj = nj; }
  }
  return { x: bi * T + T / 2, y: bj * T + T / 2, left: best };
}
function spawnSpot(m, role, slot) {
  const s = m.spawn[role];
  return s[Math.floor((slot + 0.5) * s.length / MAX_TEAM) % s.length];
}
// Where bots go (tiles): spots to hold on each site and in the middle, and the ways the attackers take
// to each site (each a list of points to pass). A spot a crate covers moves to the nearest open tile.
const PLANS = {
  Dune: { A: [[16, 12], [8, 6], [19, 4], [13, 9], [6, 9]], B: [[56, 25], [63, 34], [54, 31], [60, 26], [65, 25]], mid: [[35, 12], [47, 27], [35, 25]],
          ways: { A: [[[8, 23]], [[35, 25], [22, 16]]], B: [[[35, 44], [47, 38]], [[35, 25], [47, 27]]] } },
  Depot: { A: [[5, 11], [10, 19], [11, 12], [4, 18]], B: [[42, 11], [37, 19], [36, 12], [43, 18]], mid: [[24, 8], [24, 20]],
           ways: { A: [[[12, 25]], [[17, 15]]], B: [[[35, 25]], [[30, 15]]] } },
};
for (const m of MAPS) {
  const spot = ([i, j]) => {
    for (let r = 0; r < 4; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const x = (i + di) * T + T / 2, y = (j + dj) * T + T / 2;
      if (!blocked(m, x, y)) return [x, y];
    }
    return [i * T + T / 2, j * T + T / 2];
  };
  const P = PLANS[m.name];
  m.plan = { A: P.A.map(spot), B: P.B.map(spot), mid: P.mid.map(spot), ways: { A: P.ways.A.map(w => w.map(spot)), B: P.ways.B.map(w => w.map(spot)) } };
}
const angDiff = (a, b) => ((((a - b) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const turnTo = (from, to, max) => from + Math.max(-max, Math.min(max, angDiff(to, from)));

// ---------- state ----------
// DF: this Mac's side. phase: pick → lobby → match → done. players: the match's, in a fixed order
// (an index names a player in every message); t: team 0/1; b: a bot (run by the referee).
// view: "fps" (first person) or "top" (from above), each player's own choice (V switches).
const DF = { phase: "pick", map: 0, id: "", owner: "", ownerName: "", players: [], lobbies: {}, others: {}, tracers: [], banner: "", sent: 0,
  heard: 0, pinged: 0, sideKey: "", view: store("defuseView", "fps"), turn: 0, shotAt: {}, hitAt: 0, hurtAt: 0, noLock: false, escAt: 0 };
// ME: your own player. w: the weapon picked (0–3); sec: holding the pistol; ammo per weapon; rel: reload
// time left; cd: until the next shot; rec: recoil; trig: trigger held; shots/hits: to send.
const ME = { x: 0, y: 0, a: 0, w: 0, sec: false, ammo: [], rel: 0, cd: 0, rec: 0, trig: false, click: false, mx: GW / 2, my: GH / 2,
  shots: [], hits: [], act: 0, spect: -1, moving: false, bob: 0, kick: 0 };
// V: the match as this Mac knows it; on the referee it is the match itself (refState sends it).
let V = null;
const amRef = () => DF.owner === myId();
const myIdx = () => DF.players.findIndex(p => p.id === myId());
const teamOf = i => (DF.players[i] || {}).t;
const roleOf = i => teamOf(i) === V.at ? "a" : "d";
const alive = i => V && V.hp[i] > 0;
const curW = () => (ME.sec ? 4 : ME.w);
const mapNow = () => MAPS[DF.map];

/// Where a player is now: you, a bot (from the referee), or a teammate (from their last word).
function posOf(i) {
  if (i === myIdx()) return ME;
  const p = DF.players[i]; if (!p) return null;
  if (p.b) return V && V.bots[i] ? V.bots[i] : null;
  const o = DF.others[p.id];
  return o && o.x !== undefined ? o : null;
}

// ---------- lobby ----------
const lobbyMsg = k => ({ g: "defuse", k, id: DF.id, map: DF.map, players: DF.players.map(p => ({ id: p.id, name: p.name, t: p.t, b: p.b ? 1 : 0 })) });
const count = t => DF.players.filter(p => p.t === t).length;
function sendLobby(k) { if (inRoom()) gsend(lobbyMsg(k || "lobby")); DF.pinged = Date.now() / 1000; side(); }
function openMatch() {
  Object.assign(DF, { phase: "lobby", id: myId() + "-" + Date.now(), owner: myId(), ownerName: myName(), players: [{ id: myId(), name: myName(), t: 0 }], others: {} });
  if (!inRoom()) addBot(1);                         // alone: someone to play against
  sendLobby("open");
}
function joinMatch(id) {
  const l = DF.lobbies[id]; if (!l) return;
  leaveCurrent();
  if (!GAME.open) openGames("home");
  Object.assign(DF, { phase: "lobby", id: l.id, map: l.map, owner: l.owner, ownerName: l.ownerName, players: l.players.slice(), others: {} });
  gsend({ g: "defuse", k: "join", id });
  gshow("defuse");
}
function addBot(t) {
  if (count(t) >= MAX_TEAM) return;
  const used = new Set(DF.players.map(p => p.name)), name = BOT_NAMES.find(n => !used.has(n)) || "Bot";
  DF.players.push({ id: "bot-" + Math.random().toString(36).slice(2, 8), name, t, b: true });
}
function removeBot(t) { const i = DF.players.map(p => p.t === t && p.b).lastIndexOf(true); if (i >= 0) DF.players.splice(i, 1); }
function leaveMatch() {
  if (!DF.id) return;
  if (DF.phase === "lobby") gsend({ g: "defuse", k: amRef() ? "close" : "leave", id: DF.id });
  if (DF.phase === "match") gsend({ g: "defuse", k: "quit", id: DF.id });
  Object.assign(DF, { phase: "pick", id: "", owner: "" }); V = null;
  gcv.style.cursor = ""; unlockMouse();
}
function startMatch() {
  if (!amRef() || DF.phase !== "lobby" || !count(0) || !count(1)) return;
  const seed = newSeed();
  if (inRoom()) gsend({ ...lobbyMsg("start"), seed });
  beginMatch(seed);
}

// ---------- the match ----------
function beginMatch(seed) {
  const n = DF.players.length;
  DF.phase = "match"; DF.heard = Date.now() / 1000; DF.tracers = []; DF.banner = ""; DF.feedSeen = 0; DF.lost = false; DF.lastRw = null; DF.others = {};
  DF.shotAt = {}; DF.hitAt = 0; DF.hurtAt = 0; DF.lastHp = 100; DF.turn = 0;
  V = { r: 0, ph: "buy", t: BUY, sc: [0, 0], at: 0, hp: new Array(n).fill(100), kd: DF.players.map(() => [0, 0]), quit: new Array(n).fill(0),
        bomb: { s: "c", c: -1, x: 0, y: 0, site: "", t: 0 }, feed: [], rw: null, bots: {}, seq: 0, rng: seeded(seed), bt: [], heard: {} };
  ME.ammo = WEAPONS.map(w => w.mag);
  if (amRef()) refRound();
  else newRound();
  side();
}
/// Back to your spawn for a new round, guns full.
function newRound() {
  const i = myIdx(); if (i < 0) return;
  const slot = DF.players.filter((p, k) => k < i && p.t === DF.players[i].t).length, s = spawnSpot(mapNow(), roleOf(i), slot);
  ME.x = s[0]; ME.y = s[1];
  const site = mapNow().sites[roleOf(i) === "a" ? "A" : "B"];
  ME.a = Math.atan2(site.y - ME.y, site.x - ME.x);
  ME.ammo = WEAPONS.map(w => w.mag); ME.rel = 0; ME.cd = 0; ME.rec = 0; ME.act = 0; ME.spect = -1; ME.trig = false; ME.roundKills = 0;
  DF.tracers = [];
}

// ---------- the referee ----------
function refRound() {
  const m = mapNow(), n = DF.players.length;
  if (V.r === HALF) { V.at = 1 - V.at; DF.banner = "Switching sides"; DF.bannerAt = Date.now() / 1000; }
  V.r++; V.ph = "buy"; V.t = BUY; V.rw = null;
  for (let i = 0; i < n; i++) V.hp[i] = V.quit[i] ? 0 : 100;
  const att = DF.players.map((p, i) => i).filter(i => teamOf(i) === V.at && V.hp[i] > 0);
  V.bomb = { s: "c", c: att.length ? att[Math.floor(V.rng() * att.length)] : -1, x: 0, y: 0, site: "", t: 0 };
  V.bots = {}; V.sounds = []; V.intel = [null, null];
  // the round's plan: the attackers go for one site, each by one of its ways (and one of three or more
  // sneaks to the other site); the defenders split over the sites, one takes an early look from the
  // middle, and some are ready to move over when the enemy shows up at the other site
  const goal = V.rng() < 0.5 ? "A" : "B", other = goal === "A" ? "B" : "A", now = Date.now() / 1000;
  const bots = DF.players.map((p, i) => i).filter(i => DF.players[i].b);
  const attackers = bots.filter(i => roleOf(i) === "a"), defenders = bots.filter(i => roleOf(i) === "d");
  bots.forEach(i => {
    const p = DF.players[i], slot = DF.players.filter((q, k) => k < i && q.t === p.t).length, s = spawnSpot(m, roleOf(i), slot);
    const r = V.rng(), w = r < 0.55 ? 0 : r < 0.75 ? 1 : r < 0.87 ? 2 : 3;
    V.bots[i] = { x: s[0], y: s[1], a: 0, w, dx: s[0], dy: s[1], goal, seen: -1, react: 0, cd: 0, burst: 0, act: 0, wait: V.rng() * 0.6,
      path: [], spot: null, at: false, holdUntil: 0, lookA: 0, strafe: 1, strafeT: 0, seed: V.rng() * 10, last: null, heard: null, rotates: V.rng() < 0.6, midUntil: 0 };
  });
  const lurker = attackers.length >= 3 ? attackers[Math.floor(V.rng() * attackers.length)] : -1;
  attackers.forEach(i => {
    const b = V.bots[i], g = i === lurker && V.bomb.c !== i ? other : goal, ways = m.plan.ways[g];
    b.goal = g; b.path = ways[Math.floor(V.rng() * ways.length)].map(p => p.slice());
    const site = m.sites[g];
    b.path.push(V.bomb.c === i ? [site.x, site.y] : m.plan[g][Math.floor(V.rng() * m.plan[g].length)].slice());
  });
  const first = V.rng() < 0.5 ? "A" : "B";             // the defenders do not know the attackers' plan
  defenders.forEach((i, n) => {
    const b = V.bots[i]; b.goal = n % 2 ? (first === "A" ? "B" : "A") : first;
    if (n === 0 && defenders.length >= 2) b.midUntil = now + BUY + 10 + V.rng() * 10;
  });
  newRound();
}
function hurt(v, dmg, k, w) {
  if (!(V.hp[v] > 0) || !(dmg > 0)) return;
  V.hp[v] = Math.max(0, V.hp[v] - Math.round(dmg));
  // a bot that is hit turns to where it came from, and goes to look if it cannot see the shooter
  const bv = V.bots[v], from = k >= 0 ? posOf(k) : null;
  if (bv && from && V.hp[v] > 0) { bv.heard = { x: from.x, y: from.y, t: Date.now() / 1000 }; bv.last = { x: from.x, y: from.y, t: Date.now() / 1000 }; }
  if (V.hp[v] > 0) return;
  if (k >= 0 && teamOf(k) !== teamOf(v)) V.kd[k][0]++;
  V.kd[v][1]++;
  V.feed.push({ n: ++V.seq, k, v, w });
  if (V.feed.length > 5) V.feed.shift();
  if (V.bomb.s === "c" && V.bomb.c === v) {                      // the carrier fell: the bomb is on the ground
    const p = posOf(v); V.bomb = { s: "d", c: -1, x: p ? p.x : 0, y: p ? p.y : 0, site: "", t: 0 };
  }
}
function winRound(team, why, by) {
  V.sc[team]++; V.ph = "end"; V.t = END; V.rw = [team, why, by === undefined ? -1 : by];
}
/// A shot was heard here (the bots listen; the referee keeps the last few seconds).
function noise(x, y, team) { if (V && V.sounds) V.sounds.push({ x, y, team, t: Date.now() / 1000 }); }
function refStep(dt) {
  const m = mapNow(), n = DF.players.length, now = Date.now() / 1000;
  if (V.sounds.length) V.sounds = V.sounds.filter(s => now - s.t < 3).slice(-40);
  // players who went quiet are out
  DF.players.forEach((p, i) => {
    if (p.b || i === myIdx() || V.quit[i]) return;
    const o = DF.others[p.id];
    if (now - ((o && o.at) || DF.heard) > GONE) { V.quit[i] = 1; hurt(i, 999, -1, -1); }
  });
  const aliveOf = t => DF.players.filter((p, i) => p.t === t && V.hp[i] > 0).length;
  const att = V.at, def = 1 - V.at;
  V.t -= dt;
  if (V.ph === "buy" && V.t <= 0) { V.ph = "live"; V.t = ROUND; }
  else if (V.ph === "live") {
    if (!aliveOf(att)) winRound(def, "out");
    else if (!aliveOf(def)) winRound(att, "out");
    else if (V.t <= 0) winRound(def, "time");
  } else if (V.ph === "planted") {
    V.bomb.t -= dt;
    if (V.bomb.t <= 0) { V.bomb.s = "x"; winRound(att, "boom"); }
    else if (!aliveOf(def)) winRound(att, "out");
  } else if (V.ph === "end" && V.t <= 0) {
    if (V.sc[0] >= WIN || V.sc[1] >= WIN) { V.ph = "over"; V.t = 0; }
    else refRound();
  }
  // a dropped bomb: the first attacker to walk over it picks it up
  if (V.bomb.s === "d") for (let i = 0; i < n; i++) {
    const p = posOf(i);
    if (teamOf(i) === att && V.hp[i] > 0 && p && Math.hypot(p.x - V.bomb.x, p.y - V.bomb.y) < 9) { V.bomb.s = "c"; V.bomb.c = i; break; }
  }
  if (V.bomb.s === "c" && V.bomb.c >= 0) { const p = posOf(V.bomb.c); if (p) { V.bomb.x = p.x; V.bomb.y = p.y; } }
  for (const [i, b] of Object.entries(V.bots)) botStep(+i, b, dt, m);
}
/// The referee's word: everything about the match that is not a player's own position.
function refState() {
  const bp = [];
  for (const [i, b] of Object.entries(V.bots)) bp.push([+i, ri(b.x), ri(b.y), ra(b.a), b.w]);
  const st = { r: V.r, ph: V.ph, tl: Math.round(V.t * 10), sc: V.sc, at: V.at, hp: V.hp, kd: V.kd, q: V.quit,
    bo: [V.bomb.s, V.bomb.c, ri(V.bomb.x), ri(V.bomb.y), V.bomb.site, Math.round(V.bomb.t * 10)],
    fe: V.feed.map(f => [f.n, f.k, f.v, f.w]), bp, bt: V.bt.splice(0, 8) };
  if (V.rw) st.rw = V.rw;
  return st;
}
/// The referee's word, on everyone else's Mac.
function applyState(st) {
  const was = V.r, wasPh = V.ph;
  if (st.ph === "planted" && wasPh !== "planted") { DF.banner = `Bomb planted on ${(st.bo || [])[4] || "a site"}`; DF.bannerAt = Date.now() / 1000; }
  Object.assign(V, { r: st.r, ph: st.ph, t: st.tl / 10, sc: st.sc, at: st.at, hp: st.hp, kd: st.kd, quit: st.q || V.quit, rw: st.rw || null });
  const b = st.bo || [];
  V.bomb = { s: b[0], c: b[1], x: b[2], y: b[3], site: b[4], t: (b[5] || 0) / 10 };
  V.feed = (st.fe || []).map(f => ({ n: f[0], k: f[1], v: f[2], w: f[3] }));
  const keep = {};
  for (const [i, x, y, a100, w] of st.bp || []) {
    const o = V.bots[i] || { dx: x, dy: y }, a = a100 / 100;
    keep[i] = Object.assign(o, { x, y, a, w });
    if (Math.hypot(o.dx - x, o.dy - y) > 40) { o.dx = x; o.dy = y; }             // a new round: no sliding across the map
  }
  V.bots = keep;
  for (const [i, x, y] of st.bt || []) { const p = posOf(i); if (p) { DF.tracers.push({ x0: p.dx ?? p.x, y0: p.dy ?? p.y, x1: x, y1: y, at: performance.now() }); DF.shotAt[i] = performance.now(); } }
  if (st.r !== was) { if (V.r === HALF + 1 && was === HALF) { DF.banner = "Switching sides"; DF.bannerAt = Date.now() / 1000; } newRound(); }
}

// ---------- bots (on the referee's Mac) ----------
// Each frame a bot looks (in front of it, about 150°, or anyone right next to it), listens (shots in
// the last two seconds), then: fights what it sees; hunts where it last saw someone; looks where it
// heard shooting; or does its job for the round (the plan made in refRound).
function botStep(i, b, dt, m) {
  if (!(V.hp[i] > 0)) return;
  b.dx = b.x; b.dy = b.y;
  const team = teamOf(i), attacking = team === V.at, W = WEAPONS[b.w], t = Date.now() / 1000;
  b.cd -= dt;
  if (V.ph === "buy" || V.ph === "over") return;
  let foe = -1, fd = 1e9;
  DF.players.forEach((p, k) => {
    if (p.t === team || !(V.hp[k] > 0)) return;
    const q = posOf(k); if (!q) return;
    const d = Math.hypot(q.x - b.x, q.y - b.y);
    if (d > 320 || d >= fd) return;
    const off = Math.abs(angDiff(Math.atan2(q.y - b.y, q.x - b.x), b.a));
    if ((off < 1.3 || d < 40) && clear(m, b.x, b.y, q.x, q.y)) { fd = d; foe = k; }
  });
  if (foe >= 0 && V.ph !== "end") {
    const q = posOf(foe);
    b.last = { x: q.x, y: q.y, t }; V.intel[team] = { x: q.x, y: q.y, t };
    return botFight(i, b, foe, q, fd, dt, m, W);
  }
  b.seen = -1;
  if (V.ph === "end") return;
  if (b.wait > 0) { b.wait -= dt; return; }
  // shots it hears from the other team: it turns that way (and an idle bot goes to look, below)
  for (const s of V.sounds) if (s.team !== team && t - s.t < 2 && Math.hypot(s.x - b.x, s.y - b.y) < 300 && (!b.heard || b.heard.t < s.t)) b.heard = { x: s.x, y: s.y, t: s.t };
  const carrier = attacking && V.bomb.s === "c" && V.bomb.c === i;
  // where it last saw an enemy, for a few seconds (the bomb carrier keeps to its job)
  if (b.last && t - b.last.t < 4 && !carrier) {
    if (botGo(b, b.last.x, b.last.y, dt, m, 1) < 10) b.last = null;
    return;
  }
  b.last = null;
  if (attacking) {
    if (V.ph === "planted") return botGuard(b, dt, m, nearSpots(m.plan[V.bomb.site] || m.plan.A, V.bomb.x, V.bomb.y), t);
    if (V.bomb.s === "d" && nearestTo(V.at, V.bomb.x, V.bomb.y) === i) { botGo(b, V.bomb.x, V.bomb.y, dt, m, 1); return; }
    while (b.path.length && Math.hypot(b.path[0][0] - b.x, b.path[0][1] - b.y) < 12) b.path.shift();
    if (b.path.length && !(carrier && siteAt(m, b.x, b.y) === b.goal)) { botGo(b, b.path[0][0], b.path[0][1], dt, m, 1); b.act = 0; return; }
    if (carrier) {
      const site = m.sites[b.goal];
      if (siteAt(m, b.x, b.y) === b.goal) {
        b.act += dt; b.a = turnTo(b.a, b.a + 1, 1.5 * dt);
        if (b.act >= PLANT && V.ph === "live") plant(b.x, b.y, b.goal);
        return;
      }
      b.act = 0; botGo(b, site.x, site.y, dt, m, 1); return;
    }
    return botGuard(b, dt, m, m.plan[b.goal], t);                // on the site: from spot to spot
  }
  // defending
  if (V.ph === "planted") {
    const d = Math.hypot(V.bomb.x - b.x, V.bomb.y - b.y);
    if (d < 10) { b.act += dt; if (b.act >= DEFUSE) { V.bomb.s = "f"; winRound(1 - V.at, "cut", i); } return; }
    b.act = 0; botGo(b, V.bomb.x, V.bomb.y, dt, m, 1); return;
  }
  // seen at the other site? those ready to move over go there
  const intel = V.intel[team];
  if (intel && t - intel.t < 8 && b.rotates) {
    const other = b.goal === "A" ? "B" : "A", s2 = m.sites[other];
    if (Math.hypot(intel.x - s2.x, intel.y - s2.y) < 170) { b.goal = other; b.spot = null; b.midUntil = 0; }
  }
  // shooting nearby: an idle defender goes to see
  if (b.heard && t - b.heard.t < 2 && Math.hypot(b.heard.x - b.x, b.heard.y - b.y) < 220) { b.last = { x: b.heard.x, y: b.heard.y, t: b.heard.t }; b.heard = null; return; }
  if (b.midUntil > t) return botGuard(b, dt, m, m.plan.mid, t);
  return botGuard(b, dt, m, m.plan[b.goal], t);
}
/// Walk toward a point by the way the map allows; it faces where it walks, or a shot it just heard.
/// Returns how far the point still is.
function botGo(b, tx, ty, dt, m, pace) {
  const left = Math.hypot(tx - b.x, ty - b.y);
  if (left < 3) return left;
  const W = WEAPONS[b.w], f = flow(m, tx, ty), st = nextStep(m, f, b.x, b.y);
  const gx2 = st.left <= 1 ? tx : st.x, gy2 = st.left <= 1 ? ty : st.y, v = SPEED * W.spd * 0.95 * pace * dt;
  let a = Math.atan2(gy2 - b.y, gx2 - b.x);
  if (b.unstick > 0) { b.unstick -= dt; a += b.side * Math.PI / 2; }        // caught on a corner: a sidestep
  const x0 = b.x, y0 = b.y;
  slide(m, b, Math.cos(a) * v, Math.sin(a) * v);
  b.stuck = Math.hypot(b.x - x0, b.y - y0) < v * 0.3 ? (b.stuck || 0) + dt : 0;
  if (b.stuck > 0.4) { b.stuck = 0; b.unstick = 0.35; b.side = V.rng() < 0.5 ? 1 : -1; }
  const t = Date.now() / 1000, look = b.heard && t - b.heard.t < 1.5 ? Math.atan2(b.heard.y - b.y, b.heard.x - b.x) : a;
  b.a = turnTo(b.a, look, 6 * dt);
  return left;
}
/// Keep a place: walk to one of the spots, watch from it for a few seconds (looking around, shifting a
/// little), then move on to another.
function botGuard(b, dt, m, spots, t) {
  if (!spots || !spots.length) return;
  if (!b.spot || (b.at && t > b.holdUntil)) {
    const choice = spots.filter(s => s !== b.spot);
    b.spot = (choice.length ? choice : spots)[Math.floor(V.rng() * (choice.length || spots.length))];
    b.at = false;
  }
  if (!b.at) {
    if (botGo(b, b.spot[0], b.spot[1], dt, m, 0.85) < 8) { b.at = true; b.holdUntil = t + 2 + V.rng() * 3; b.lookA = b.a + (V.rng() - 0.5) * 2.5; }
    return;
  }
  if (b.heard && t - b.heard.t < 2) b.lookA = Math.atan2(b.heard.y - b.y, b.heard.x - b.x);
  else if (V.rng() < dt * 0.7) b.lookA = b.a + (V.rng() - 0.5) * 3;
  b.a = turnTo(b.a, b.lookA + Math.sin(t * 0.9 + b.seed) * 0.5, 3 * dt);
  const side = Math.sin(t * 1.6 + b.seed) * SPEED * 0.3 * dt;                 // shifting its weight, peeking
  slide(m, b, Math.cos(b.a + Math.PI / 2) * side, Math.sin(b.a + Math.PI / 2) * side);
}
/// A fight: turn to the enemy (after a moment to react), keep the gun's range, step side to side, back off
/// when hurt, and shoot in bursts; moving costs it some accuracy, as it does you.
function botFight(i, b, foe, q, d, dt, m, W) {
  const want = Math.atan2(q.y - b.y, q.x - b.x);
  if (b.seen !== foe) { b.seen = foe; b.react = 0.22 + V.rng() * 0.3; b.burst = 0; }
  b.a = turnTo(b.a, want, 8 * dt);
  b.react -= dt; b.act = 0;
  const pref = [180, 110, 45, 260, 140][b.w], ux = Math.cos(want), uy = Math.sin(want);
  let mx = 0, my = 0;
  if (d > pref * 1.25) { mx += ux; my += uy; } else if (d < pref * 0.6) { mx -= ux; my -= uy; }
  if ((b.strafeT -= dt) <= 0) { b.strafe = [-1, 1, -1, 1, 0][Math.floor(V.rng() * 5)]; b.strafeT = 0.3 + V.rng() * 0.6; }
  if (b.w !== 3 || b.cd > 0.3) { mx += -uy * b.strafe; my += ux * b.strafe; }    // a sniper stands still to shoot
  if (V.hp[i] < 30) { mx -= ux * 1.2; my -= uy * 1.2; }
  const moving = Math.hypot(mx, my) > 0.1;
  if (moving) {
    const l = Math.hypot(mx, my), v = SPEED * W.spd * 0.65 * dt, x0 = b.x, y0 = b.y;
    slide(m, b, mx / l * v, my / l * v);
    if (Math.hypot(b.x - x0, b.y - y0) < v * 0.3) b.strafe = -b.strafe;
  }
  if (b.react <= 0 && Math.abs(angDiff(want, b.a)) < 0.18 && b.cd <= 0) {
    b.burst++;
    b.cd = W.auto ? (b.burst % (3 + Math.floor(b.seed) % 3) ? 1 / W.rate : 0.25 + V.rng() * 0.25) : 1 / W.rate + V.rng() * 0.15;
    const spread = W.sp + (moving ? W.mv * 0.45 : 0) + 0.03, a = b.a + (V.rng() - 0.5) * 2 * (W.pel ? 0 : spread);
    shoot(m, i, b.x, b.y, a, b.w, (x, y) => { V.bt.push([i, ri(x), ri(y)]); DF.tracers.push({ x0: b.x, y0: b.y, x1: x, y1: y, at: performance.now() }); });
    DF.shotAt[i] = performance.now(); noise(b.x, b.y, teamOf(i));
  }
}
const nearSpots = (spots, x, y) => spots.slice().sort((a, c) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(c[0] - x, c[1] - y)).slice(0, 3);
/// The living player of a team nearest a point.
function nearestTo(team, x, y) {
  let best = -1, bd = 1e9;
  DF.players.forEach((p, k) => { if (p.t !== team || !(V.hp[k] > 0)) return; const o = posOf(k); if (!o) return; const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = k; } });
  return best;
}
function plant(x, y, site) {
  if (V.ph !== "live" || !site) return;
  V.ph = "planted"; V.bomb = { s: "p", c: -1, x, y, site, t: BOMB };
  DF.banner = `Bomb planted on ${site}`; DF.bannerAt = Date.now() / 1000;
}

// ---------- shooting ----------
/// One shot from player i: the first enemy or wall along it decides. Calls tracer(x, y) for its end and
/// returns the hits [[player, damage]].
function shoot(m, i, x, y, a, wi, tracer) {
  const W = WEAPONS[wi], hits = {};
  for (let p = 0; p < (W.pel || 1); p++) {
    const pa = W.pel ? a + (Math.random() - 0.5) * 2 * W.sp : a;
    let best = wallDist(m, x, y, pa, W.range), who = -1;
    DF.players.forEach((q, k) => {
      if (q.t === teamOf(i) || !(V.hp[k] > 0)) return;
      const o = posOf(k); if (!o) return;
      const d = circleHit(x, y, pa, o.dx ?? o.x, o.dy ?? o.y, R + 0.6);
      if (d >= 0 && d < best) { best = d; who = k; }
    });
    if (p < 3) tracer(x + Math.cos(pa) * best, y + Math.sin(pa) * best);
    if (who >= 0) hits[who] = (hits[who] || 0) + W.dmg * (W.fall ? Math.max(0.3, 1 - best / W.range) : 1);
  }
  const out = Object.entries(hits).map(([k, d]) => [+k, Math.round(d)]);
  if (amRef()) for (const [k, d] of out) hurt(k, d, i, wi);
  return out;
}
function myShot() {
  const W = WEAPONS[curW()], i = myIdx(), m = mapNow();
  const walk = GAME.keys.has("shift"), spread = W.sp + (ME.moving ? W.mv * (walk ? 0.35 : 1) : 0) + ME.rec;
  const a = ME.a + (Math.random() - 0.5) * 2 * (W.pel ? 0 : spread);
  const hits = shoot(m, i, ME.x, ME.y, a, curW(), (x, y) => {
    DF.tracers.push({ x0: ME.x, y0: ME.y, x1: x, y1: y, at: performance.now(), mine: 1 });
    ME.shots.push([ri(x), ri(y)]);
  });
  if (!amRef()) ME.hits.push(...hits);
  if (hits.length) DF.hitAt = performance.now();
  ME.kick = 1; DF.shotAt[i] = performance.now();
  if (amRef()) noise(ME.x, ME.y, teamOf(i));           // the bots hear you
  ME.ammo[curW()]--; ME.cd = 1 / W.rate; ME.rec = Math.min(W.rmax, ME.rec + W.rc);
  if (!ME.ammo[curW()]) reload();
}
function reload() { const W = WEAPONS[curW()]; if (ME.rel <= 0 && ME.ammo[curW()] < W.mag) ME.rel = W.rel; }

// ---------- a frame ----------
function dfStep(dt) {
  const now = Date.now() / 1000;
  if (DF.phase === "lobby") {
    ginfo.textContent = `${DF.players.length} in the lobby · ${MAPS[DF.map].name}`;
    if (amRef() && inRoom() && now - DF.pinged > LOBBY_PING) sendLobby();
    return;
  }
  if (DF.phase !== "match" || !V) { gcv.style.cursor = ""; return; }
  gcv.style.cursor = "none";
  const m = mapNow(), i = myIdx(), me = DF.players[i];
  if (i < 0) return;
  if (amRef()) refStep(dt);
  else {
    V.t -= dt; if (V.ph === "planted") V.bomb.t -= dt;
    if (now - DF.heard > GONE) { V.ph = "over"; DF.lost = true; }
  }
  const live = alive(i) && V.ph !== "buy" && V.ph !== "over", k = GAME.keys;
  let mx, my;
  if (DF.view === "fps") {
    // first person: the mouse (or ← →) turns you; W S go forward and back, A D step aside
    if (alive(i) && V.ph !== "over") ME.a += ((k.has("arrowright") ? 1 : 0) - (k.has("arrowleft") ? 1 : 0)) * 2.6 * dt + DF.turn;
    DF.turn = 0;
    const fwd = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0), str = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);
    mx = Math.cos(ME.a) * fwd - Math.sin(ME.a) * str; my = Math.sin(ME.a) * fwd + Math.cos(ME.a) * str;
  } else {
    // from above: aiming from where you are on the screen to the mouse; WASD move along the screen
    if (ME.spect < 0) { const cam = camera(); ME.a = Math.atan2(ME.my - (ME.y - Math.round(cam.y)), ME.mx - (ME.x - Math.round(cam.x))); }
    mx = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    my = (k.has("s") || k.has("arrowdown") ? 1 : 0) - (k.has("w") || k.has("arrowup") ? 1 : 0);
  }
  ME.moving = live && !!(Math.abs(mx) > 0.01 || Math.abs(my) > 0.01) && !ME.act;
  if (ME.moving) {
    const l = Math.hypot(mx, my), v = SPEED * WEAPONS[curW()].spd * (k.has("shift") ? 0.5 : 1) * dt;
    slide(m, ME, mx / l * v, my / l * v);
    ME.bob += dt * (k.has("shift") ? 6 : 10);
  }
  if (alive(i) && V.hp[i] < (DF.lastHp ?? 100)) DF.hurtAt = performance.now();
  DF.lastHp = V.hp[i];
  ME.cd -= dt; ME.rec = Math.max(0, ME.rec - 0.25 * dt);
  if (ME.rel > 0 && (ME.rel -= dt) <= 0) ME.ammo[curW()] = WEAPONS[curW()].mag;
  const W = WEAPONS[curW()];
  if (live && V.ph !== "end" && ME.trig && ME.rel <= 0 && ME.cd <= 0 && ME.ammo[curW()] > 0 && (W.auto || ME.click) && !ME.act) { ME.click = false; myShot(); }
  // planting and defusing: hold E, standing still
  const role = i >= 0 ? roleOf(i) : "", holding = k.has("e") && live && !ME.moving;
  const canPlant = role === "a" && V.ph === "live" && V.bomb.s === "c" && V.bomb.c === i && siteAt(m, ME.x, ME.y);
  const canDefuse = role === "d" && V.ph === "planted" && Math.hypot(ME.x - V.bomb.x, ME.y - V.bomb.y) < 12;
  if (holding && (canPlant || canDefuse)) {
    ME.act += dt;
    if (canPlant && ME.act >= PLANT) {
      ME.act = 0;
      if (amRef()) plant(ME.x, ME.y, siteAt(m, ME.x, ME.y));
      else gsend({ g: "defuse", k: "plant", id: DF.id, x: ri(ME.x), y: ri(ME.y), site: siteAt(m, ME.x, ME.y) });
    }
    if (canDefuse && ME.act >= DEFUSE) {
      ME.act = 0;
      if (amRef()) { V.bomb.s = "f"; winRound(1 - V.at, "cut", i); }
      else gsend({ g: "defuse", k: "defuse", id: DF.id });
    }
  } else ME.act = 0;
  // dead: watch a teammate who is still in
  if (!alive(i)) {
    const mates = DF.players.map((p, k2) => k2).filter(k2 => teamOf(k2) === me.t && alive(k2) && posOf(k2));
    if (!mates.includes(ME.spect)) ME.spect = mates.length ? mates[0] : -1;
  } else ME.spect = -1;
  // the others' places, smoothed between their words
  const f = 1 - Math.exp(-dt * 14);
  const turnTo = (from, to) => from + ((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * f;
  for (const o of Object.values(DF.others)) if (o.x !== undefined) {
    o.dx = o.dx === undefined ? o.x : o.dx + (o.x - o.dx) * f; o.dy = o.dy === undefined ? o.y : o.dy + (o.y - o.dy) * f;
    o.da = o.da === undefined ? o.a : turnTo(o.da, o.a);
  }
  if (!amRef()) for (const b of Object.values(V.bots)) { b.dx += (b.x - b.dx) * f; b.dy += (b.y - b.dy) * f; b.da = b.da === undefined ? b.a : turnTo(b.da, b.a); }
  // your word, ten times a second
  if (now - DF.sent >= SEND) {
    DF.sent = now;
    const msg = { g: "defuse", k: "p", id: DF.id, x: ri(ME.x), y: ri(ME.y), a: ra(ME.a), w: curW() };
    if (ME.shots.length) msg.s = ME.shots.splice(0, 6);
    ME.shots.length = 0;
    if (ME.hits.length) msg.h = ME.hits.splice(0, 12);
    if (amRef()) msg.st = refState();
    gsend(msg);
  }
  // the end of a round, and of the match
  if (V.rw && V.rw !== DF.lastRw) {
    DF.lastRw = V.rw;
    const [team, why, by] = V.rw;
    DF.banner = `${TEAMS[team].name} win the round · ${REASONS[why] || why}`; DF.bannerAt = now;
    if (why === "cut" && by === i) achieve("defuse-cutter");
    if (team === me.t && ME.roundKills >= 3 && ME.roundKills >= DF.players.filter(p => p.t !== me.t).length) achieve("defuse-ace");
  }
  for (const fe of V.feed) if (fe.n > (DF.feedSeen || 0)) { DF.feedSeen = fe.n; if (fe.k === i && fe.v !== i) ME.roundKills = (ME.roundKills || 0) + 1; }
  if (V.ph === "over" && DF.phase === "match") {
    // the referee's last word, so everyone sees the end (it sends nothing more after this)
    if (amRef()) gsend({ g: "defuse", k: "p", id: DF.id, x: ri(ME.x), y: ri(ME.y), a: ra(ME.a), w: curW(), st: refState() });
    DF.phase = "done"; gcv.style.cursor = ""; unlockMouse();
    const won = V.sc[me.t] > V.sc[1 - me.t];
    if (won && !DF.lost) achieve("defuse-win");
    toast(DF.lost ? "💣 The referee left: the match is over" : won ? `💣 You won ${V.sc[me.t]}–${V.sc[1 - me.t]}` : `💣 ${TEAMS[1 - me.t].name} won ${V.sc[1 - me.t]}–${V.sc[me.t]}`, null, 6000);
    side();
  }
  ginfo.textContent = `${MAPS[DF.map].name} · round ${V.r} · ${TEAMS[0].name} ${V.sc[0]} : ${V.sc[1]} ${TEAMS[1].name}`;
  const key = JSON.stringify([V.sc, V.kd, V.hp.map(h => h > 0), V.ph, DF.phase]);
  if (key !== DF.sideKey) { DF.sideKey = key; side(); }
}

// ---------- drawing ----------
const canvases = {};
/// The whole map, drawn once: floors with sand in them, walls with a lit top, crates, the sites' letters.
function mapCanvas(m) {
  if (canvases[m.name]) return canvases[m.name];
  const c = document.createElement("canvas"); c.width = m.w * T; c.height = m.h * T;
  const g = c.getContext("2d"), th = m.theme, rnd = seeded(hash(m.name));
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const ch = m.g[j][i], x = i * T, y = j * T;
    if (ch === "#") {
      const inner = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => { const r = m.g[j + dj]; return r && r[i + di] !== undefined && isOpen(r[i + di]); });
      g.fillStyle = inner ? th.wall : th.out; g.fillRect(x, y, T, T);
      if (inner) { g.fillStyle = th.top; g.fillRect(x, y, T, 3); g.fillStyle = th.edge; g.fillRect(x, y + T - 1, T, 1); }
      continue;
    }
    g.fillStyle = ch === "," || ch === "a" || ch === "d" ? th.floor2 : th.floor; g.fillRect(x, y, T, T);
    for (let s = 0; s < 2; s++) { g.fillStyle = th.speck; g.fillRect(x + Math.floor(rnd() * T), y + Math.floor(rnd() * T), 1, 1); }
    if (ch === "A" || ch === "B") { g.fillStyle = th.siteC + "22"; g.fillRect(x, y, T, T); }
    if (ch === "x") {
      g.fillStyle = th.crate; g.fillRect(x, y, T, T);
      g.fillStyle = th.plank; g.fillRect(x + 1, y + 1, T - 2, 1); g.fillRect(x + 1, y + 4, T - 2, 1); g.fillRect(x + 1, y + T - 2, T - 2, 1);
      g.fillStyle = "#00000044"; g.fillRect(x, y + T - 1, T, 1);
    }
  }
  for (const k of ["A", "B"]) {                     // the site's letter, painted big on the floor
    const s = m.sites[k];
    g.font = "bold 28px Menlo, monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = th.siteC + "66"; g.fillText(k, s.mx, s.my);
  }
  return (canvases[m.name] = c);
}
function mini(m) {
  const key = m.name + "-mini";
  if (canvases[key]) return canvases[key];
  const c = document.createElement("canvas"); c.width = m.w; c.height = m.h;
  const g = c.getContext("2d");
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const ch = m.g[j][i];
    g.fillStyle = ch === "#" ? "#00000000" : ch === "x" ? "#5a4a3a" : ch === "A" || ch === "B" ? "#7a4a44" : "#8a7a64";
    g.fillRect(i, j, 1, 1);
  }
  return (canvases[key] = c);
}
/// The camera leans toward the mouse, so you see further where you aim.
function camOff() { return { x: (ME.mx - GW / 2) * 0.3, y: (ME.my - GH / 2) * 0.3 }; }
function camera() {
  const m = mapNow(), f = ME.spect >= 0 ? posOf(ME.spect) : ME, o = ME.spect >= 0 ? { x: 0, y: 0 } : camOff();
  const fx = f ? (f.dx ?? f.x) : ME.x, fy = f ? (f.dy ?? f.y) : ME.y;
  return { x: Math.max(0, Math.min(m.w * T - GW, fx + o.x - GW / 2)), y: Math.max(0, Math.min(m.h * T - GH, fy + o.y - GH / 2)), fx, fy };
}
let vis = null, visAt = 0, visFrom = "";
/// Which tiles in view the player (or whoever you watch) can see, every 50 ms.
function visibility(m, cam) {
  const key = Math.round(cam.fx) + "," + Math.round(cam.fy) + "," + Math.round(cam.x) + "," + Math.round(cam.y);
  if (vis && (key === visFrom || performance.now() - visAt < 50)) return vis;
  visFrom = key; visAt = performance.now();
  const i0 = Math.floor(cam.x / T), j0 = Math.floor(cam.y / T), cols = Math.ceil(GW / T) + 1, rows = Math.ceil(GH / T) + 1;
  vis = { i0, j0, cols, rows, v: new Uint8Array(cols * rows) };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const cx = (i0 + i) * T + T / 2, cy = (j0 + j) * T + T / 2, d = Math.hypot(cx - cam.fx, cy - cam.fy);
    // stop a little short of the tile's centre, so a wall's face counts as seen
    const f = d > 5 ? (d - 4.5) / d : 0;
    vis.v[j * cols + i] = clear(m, cam.fx, cam.fy, cam.fx + (cx - cam.fx) * f, cam.fy + (cy - cam.fy) * f) ? 1 : 0;
  }
  return vis;
}
function drawSoldier(x, y, a, color, w, me) {
  gx.fillStyle = "#00000055"; gx.beginPath(); gx.arc(x + 0.6, y + 0.8, R, 0, Math.PI * 2); gx.fill();
  gx.strokeStyle = "#1b1820"; gx.lineWidth = 1.6; gx.beginPath(); gx.moveTo(x, y);
  const len = w === 3 ? 7.5 : w === 4 ? 4.5 : 6; gx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); gx.stroke();
  gx.fillStyle = color; gx.beginPath(); gx.arc(x, y, R, 0, Math.PI * 2); gx.fill();
  gx.strokeStyle = me ? "#ffffff" : "#1b1820"; gx.lineWidth = me ? 0.9 : 0.6; gx.stroke();
  gx.fillStyle = "#00000040"; gx.beginPath(); gx.arc(x + Math.cos(a) * 1.2, y + Math.sin(a) * 1.2, 1.4, 0, Math.PI * 2); gx.fill();
}
function dfDraw() {
  const m = mapNow();
  if (DF.phase !== "match" && DF.phase !== "done") return drawPreview(m);
  if (!V) return;
  const i0 = myIdx();
  if (DF.view === "fps") {
    const eye = eyeOf();
    gx.save(); gx.beginPath(); gx.rect(0, 0, GW, GH); gx.clip();
    drawFPS(m, eye, i0, DF.players[i0]);
    gx.restore();
    return drawHud(m, { fx: eye.x, fy: eye.y, a: eye.a }, i0, DF.players[i0]);
  }
  const cam = camera(), now = performance.now(), i = i0, me = DF.players[i];
  gx.save();
  gx.beginPath(); gx.rect(0, 0, GW, GH); gx.clip();
  gx.translate(-Math.round(cam.x), -Math.round(cam.y));
  gx.drawImage(mapCanvas(m), 0, 0);
  // what cannot be seen from here is in shadow
  const vz = visibility(m, cam);
  gx.fillStyle = "rgba(10,8,14,0.5)";
  for (let j = 0; j < vz.rows; j++) for (let k = 0; k < vz.cols; k++) if (!vz.v[j * vz.cols + k]) gx.fillRect((vz.i0 + k) * T, (vz.j0 + j) * T, T, T);
  const seen = (x, y) => clear(m, cam.fx, cam.fy, x, y);
  // the bomb
  const bo = V.bomb, mineTeamAttacks = me && me.t === V.at;
  if (bo.s === "p" || bo.s === "x" || bo.s === "f" || (bo.s === "d" && (mineTeamAttacks || seen(bo.x, bo.y)))) {
    const blink = bo.s === "p" && Math.floor(now / (bo.t < 10 ? 150 : 400)) % 2;
    gx.fillStyle = "#2a2a2a"; gx.fillRect(bo.x - 3, bo.y - 2, 6, 4);
    gx.fillStyle = blink ? "#ff4040" : bo.s === "f" ? "#5fbf7f" : "#a03030"; gx.fillRect(bo.x - 1, bo.y - 1, 2, 2);
  }
  // the fallen, then everyone standing: teammates always, enemies when in sight
  DF.players.forEach((p, k) => {
    const o = posOf(k); if (!o || V.quit[k]) return;
    const x = o.dx ?? o.x, y = o.dy ?? o.y, friend = me && p.t === me.t;
    if (!(V.hp[k] > 0)) {
      if (friend || seen(x, y)) { gx.fillStyle = TEAMS[p.t].c + "88"; gx.fillRect(x - 3, y - 0.5, 6, 1); gx.fillRect(x - 0.5, y - 3, 1, 6); }
      return;
    }
    if (k === i) return;
    if (!friend && !seen(x, y)) return;
    drawSoldier(x, y, o.a || 0, TEAMS[p.t].c, o.w || 0, false);
    gtext(p.name.slice(0, 9), x, y - 10, friend ? "#f1ebe2" : "#ffb0a8", 5, "center");
    const hp = V.hp[k]; gx.fillStyle = "#0008"; gx.fillRect(x - 4, y - 5.5, 8, 1.2); gx.fillStyle = hp > 50 ? "#5fbf7f" : hp > 25 ? "#e3c74f" : "#e06c6c"; gx.fillRect(x - 4, y - 5.5, 8 * hp / 100, 1.2);
    if (bo.s === "c" && bo.c === k && friend) { gx.fillStyle = "#ff4040"; gx.fillRect(x + 2.5, y - 4, 2, 2); }
  });
  if (alive(i)) drawSoldier(ME.x, ME.y, ME.a, TEAMS[me.t].c, curW(), true);
  // the bomb going off
  if (bo.s === "x" && V.ph === "end") {
    const f = Math.min(1, (END - V.t) / 1.2);
    gx.fillStyle = `rgba(255,160,60,${0.7 * (1 - f)})`; gx.beginPath(); gx.arc(bo.x, bo.y, 10 + 60 * f, 0, Math.PI * 2); gx.fill();
  }
  // shots: a short streak that fades
  DF.tracers = DF.tracers.filter(t => now - t.at < 90);
  for (const t of DF.tracers) {
    gx.strokeStyle = `rgba(255,236,160,${1 - (now - t.at) / 90})`; gx.lineWidth = t.mine ? 0.8 : 0.6;
    gx.beginPath(); gx.moveTo(t.x0, t.y0); gx.lineTo(t.x1, t.y1); gx.stroke();
  }
  gx.restore();
  drawHud(m, cam, i, me);
}
function drawPreview(m) {
  const c = mapCanvas(m), k = Math.min(GW / c.width, (GH - 20) / c.height), w = c.width * k, h = c.height * k;
  gx.drawImage(c, (GW - w) / 2, 4, w, h);
  gpx(0, GH - 16, GW, 16, "#0d0b10dd");
  gtext(`${m.name}: ${m.blurb}`, GW / 2, GH - 12, "#ffe7a8", 6, "center");
  if (DF.phase === "lobby") { gpx(GW / 2 - 90, GH / 2 - 14, 180, 22, "#0d0b10cc"); gtext(amRef() ? "pick the teams, then Start" : `waiting for ${DF.ownerName} to start`, GW / 2, GH / 2 - 8, "#a79d93", 8, "center"); }
}
function drawHud(m, cam, i, me) {
  const now = Date.now() / 1000, W = WEAPONS[curW()];
  // the minimap: the map, your team, the bomb when your team knows where it is, enemies in sight
  const mm = mini(m), k = 60 / m.w, mw = 60, mh = m.h * k;
  gpx(2, 2, mw + 2, mh + 2, "#0d0b10aa"); gx.drawImage(mm, 3, 3, mw, mh);
  for (const s of ["A", "B"]) gtext(s, 3 + m.sites[s].x / T * k, 3 + m.sites[s].y / T * k - 3, "#ffb0a8", 5, "center");
  DF.players.forEach((p, k2) => {
    const o = posOf(k2); if (!o || !(V.hp[k2] > 0)) return;
    const x = o.dx ?? o.x, y = o.dy ?? o.y, friend = p.t === me.t;
    if (!friend && !clear(m, cam.fx, cam.fy, x, y)) return;
    gpx(3 + x / T * k - 1, 3 + y / T * k - 1, 2, 2, k2 === i ? "#ffffff" : TEAMS[p.t].c);
  });
  if (V.bomb.s === "p" || (V.bomb.s !== "c" && me.t === V.at)) gpx(3 + V.bomb.x / T * k - 1, 3 + V.bomb.y / T * k - 1, 2, 2, Math.floor(now * 3) % 2 ? "#ff4040" : "#ffe7a8");
  if (DF.view === "fps") {                         // which way you look
    const ex = 3 + cam.fx / T * k, ey = 3 + cam.fy / T * k;
    gx.strokeStyle = "#ffffff"; gx.lineWidth = 0.6; gx.beginPath(); gx.moveTo(ex, ey); gx.lineTo(ex + Math.cos(cam.a) * 6, ey + Math.sin(cam.a) * 6); gx.stroke();
  }
  // the score and the clock
  const t = V.ph === "planted" ? V.bomb.t : V.t, clock = `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;
  gpx(GW / 2 - 52, 2, 104, 18, "#0d0b10cc");
  gtext(String(V.sc[0]), GW / 2 - 36, 5, TEAMS[0].c, 10, "center"); gtext(String(V.sc[1]), GW / 2 + 36, 5, TEAMS[1].c, 10, "center");
  gtext(V.ph === "planted" ? "💣 " + clock : clock, GW / 2, 4, V.ph === "planted" ? "#ff8080" : "#f1ebe2", 8, "center");
  gtext(V.ph === "buy" ? "buy time" : `round ${V.r}`, GW / 2, 13, "#a79d93", 5, "center");
  gtext(me.t === V.at ? "ATTACK" : "DEFEND", GW / 2 + (me.t ? 36 : -36), 15, "#a79d93", 4, "center");
  // the kill feed
  V.feed.slice(-4).forEach((f, n) => {
    const kn = f.k >= 0 && DF.players[f.k] ? DF.players[f.k].name.slice(0, 8) : "", vn = DF.players[f.v] ? DF.players[f.v].name.slice(0, 8) : "";
    const line = kn ? `${kn} ▸ ${vn}` : `✕ ${vn}`, w = line.length * 3.2 + 6;
    gpx(GW - w - 2, 2 + n * 9, w, 8, "#0d0b10aa");
    gtext(line, GW - 4, 3.5 + n * 9, f.k === i || f.v === i ? "#ffe7a8" : "#f1ebe2", 5, "right");
  });
  // health, and the gun
  if (i >= 0) {
    const hp = V.hp[i];
    gpx(2, GH - 14, 52, 12, "#0d0b10cc"); gtext(`✚ ${hp}`, 6, GH - 12, hp > 25 ? "#f1ebe2" : "#ff8080", 8);
    const ammo = ME.rel > 0 ? "reloading…" : `${ME.ammo[curW()]}/${W.mag}`;
    gpx(GW - 74, GH - 14, 72, 12, "#0d0b10cc"); gtext(`${W.n} ${ammo}`, GW - 6, GH - 12, ME.ammo[curW()] ? "#f1ebe2" : "#ff8080", 7, "right");
    if (V.bomb.s === "c" && V.bomb.c === i) gtext("💣 you carry the bomb: E on a site", GW / 2, GH - 11, "#ffb0a8", 6, "center");
  }
  // planting and defusing
  if (ME.act > 0) {
    const full = V.ph === "planted" ? DEFUSE : PLANT, f = Math.min(1, ME.act / full);
    gpx(GW / 2 - 40, GH / 2 + 14, 80, 6, "#0d0b10cc"); gpx(GW / 2 - 39, GH / 2 + 15, 78 * f, 4, V.ph === "planted" ? "#5fbf7f" : "#ff8080");
    gtext(V.ph === "planted" ? "defusing…" : "planting…", GW / 2, GH / 2 + 22, "#f1ebe2", 6, "center");
  }
  // the weapon menu at buy time
  if (V.ph === "buy" && alive(i)) {
    gpx(GW / 2 - 78, GH - 40, 156, 22, "#0d0b10dd");
    WEAPONS.slice(0, 4).forEach((w, n) => gtext(`${n + 1} ${w.n}`, GW / 2 - 58 + n * 39, GH - 37, n === ME.w ? "#8fd6b4" : "#a79d93", 6, "center"));
    gtext(`buy time: pick 1–4 · starts in ${Math.max(0, Math.ceil(V.t))}`, GW / 2, GH - 28, "#ffe7a8", 5, "center");
  }
  // banners
  if (DF.banner && now - DF.bannerAt < 3.5) { gpx(0, GH / 2 - 34, GW, 14, "#0d0b10cc"); gtext(DF.banner, GW / 2, GH / 2 - 31, "#ffe7a8", 8, "center"); }
  if (!alive(i) && V.ph !== "over") {
    const who = ME.spect >= 0 ? DF.players[ME.spect].name : "";
    gtext(who ? `you are out · watching ${who}` : "you are out · wait for the next round", GW / 2, GH - 24, "#ffb0a8", 6, "center");
  }
  if (V.ph === "over") {
    gpx(GW / 2 - 90, GH / 2 - 26, 180, 46, "#0d0b10ee");
    gtext(DF.lost ? "the referee left" : `${TEAMS[V.sc[0] > V.sc[1] ? 0 : 1].name} win the match`, GW / 2, GH / 2 - 20, "#8fd6b4", 10, "center");
    gtext(`${V.sc[0]} : ${V.sc[1]}`, GW / 2, GH / 2 - 4, "#ffe7a8", 12, "center");
  }
  // the crosshair: wider as the gun gets less accurate
  if (DF.view === "fps" && DF.phase === "match" && !locked() && !DF.noLock && alive(i) && V.ph !== "over")
    gtext("click to aim with the mouse · Esc frees it", GW / 2, GH / 2 + 30, "#ffe7a8", 6, "center");
  if (alive(i) && V.ph !== "over") {
    const fps = DF.view === "fps", s = 2 + (W.sp + (ME.moving ? W.mv : 0) + ME.rec) * (fps ? 240 : 40), x = fps ? GW / 2 : ME.mx, y = fps ? GH / 2 : ME.my;
    gpx(x - s - 3, y - 0.5, 3, 1, "#8fd6b4"); gpx(x + s, y - 0.5, 3, 1, "#8fd6b4"); gpx(x - 0.5, y - s - 3, 1, 3, "#8fd6b4"); gpx(x - 0.5, y + s, 1, 3, "#8fd6b4");
  }
}

// ---------- first person ----------
// A raycaster over the same tile map: for each of the 320 columns a ray walks the grid to the first
// wall or crate, and the wall is drawn as tall as near it is. The floor is the top-down map itself,
// seen in perspective (so the sites' letters are on the ground); above is the sky (Dune) or the roof
// (Depot). Players are pictures standing in the world, hidden column by column behind nearer walls.
const FOV = 0.66, TEX = 16, SENS = 0.0035;
let fpsCanvas = null, fpsImg = null, fpsBuf = null;
const zbuf = new Float32Array(GW);
const rgbOf = hex => { const n = parseInt(hex.slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const pack = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;       // ImageData's bytes, RGBA, read as one little-endian number
function shade(c, f) { return ((255 << 24) | ((((c >>> 16) & 255) * f) << 16) | ((((c >>> 8) & 255) * f) << 8) | ((c & 255) * f)) >>> 0; }
const fog = d => Math.max(0.28, 1 - d / 22);
/// A small picture drawn once, as pixels (0 = see-through).
function pixels(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); draw(g);
  return { w, h, p: new Uint32Array(g.getImageData(0, 0, w, h).data.buffer.slice(0)) };
}
function texturesOf(m) {
  const key = m.name + "-tex";
  if (canvases[key]) return canvases[key];
  const th = m.theme, rnd = seeded(hash(key));
  const speckle = (g, c, n) => { g.fillStyle = c; for (let s = 0; s < n; s++) g.fillRect(Math.floor(rnd() * TEX), Math.floor(rnd() * TEX), 1, 1); };
  const wall = pixels(TEX, TEX, g => {                 // blocks of stone (or concrete panels), lit from above
    g.fillStyle = th.top; g.fillRect(0, 0, TEX, TEX); speckle(g, th.wall, 40);
    g.fillStyle = th.edge;
    for (let y = 0; y < TEX; y += 4) { g.fillRect(0, y + 3, TEX, 1); g.fillRect((y / 4) % 2 ? 4 : 11, y, 1, 3); }
  });
  const crate = pixels(TEX, TEX, g => {                // planks with a brace
    g.fillStyle = th.crate; g.fillRect(0, 0, TEX, TEX);
    g.fillStyle = th.plank; for (let y = 1; y < TEX; y += 5) g.fillRect(1, y, TEX - 2, 3);
    g.fillStyle = th.crate; for (let k = 0; k < TEX; k++) g.fillRect(k, k, 2, 1);
    g.fillStyle = "#00000066"; g.fillRect(0, 0, TEX, 1); g.fillRect(0, TEX - 1, TEX, 1); g.fillRect(0, 0, 1, TEX); g.fillRect(TEX - 1, 0, 1, TEX);
  });
  const map = mapCanvas(m), mp = new Uint32Array(map.getContext("2d").getImageData(0, 0, map.width, map.height).data.buffer.slice(0));
  // the sky over the desert, a roof over the warehouse: one colour a row, darker toward the top
  const sky = [], [r0, g0, b0] = rgbOf(m.name === "Dune" ? "#3d6fb0" : "#1e1f25"), [r1_, g1, b1] = rgbOf(m.name === "Dune" ? "#d9e6ea" : "#3d3f48");
  for (let y = 0; y < GH / 2; y++) { const f = y / (GH / 2); sky.push(pack(r0 + (r1_ - r0) * f | 0, g0 + (g1 - g0) * f | 0, b0 + (b1 - b0) * f | 0)); }
  return (canvases[key] = { wall, crate, map: mp, mapW: map.width, mapH: map.height, sky });
}
const sprites = {};
function soldier(t) {
  if (sprites["s" + t]) return sprites["s" + t];
  const c = TEAMS[t].c, dark = "#1b1820";
  return (sprites["s" + t] = pixels(12, 22, g => {
    g.fillStyle = c; g.fillRect(3, 0, 6, 3);                        // helmet
    g.fillStyle = "#e0ac83"; g.fillRect(4, 3, 4, 3);                // face
    g.fillStyle = dark; g.fillRect(4, 4, 1, 1); g.fillRect(7, 4, 1, 1);
    g.fillStyle = c; g.fillRect(2, 6, 8, 8); g.fillRect(1, 7, 1, 5); g.fillRect(10, 7, 1, 5);   // body, arms
    g.fillStyle = "#00000044"; g.fillRect(2, 11, 8, 1);
    g.fillStyle = "#3b4258"; g.fillRect(3, 14, 2, 7); g.fillRect(7, 14, 2, 7);                 // legs
    g.fillStyle = dark; g.fillRect(2, 21, 3, 1); g.fillRect(7, 21, 3, 1); g.fillRect(3, 9, 7, 2);   // boots, the gun
  }));
}
function corpse(t) {
  if (sprites["c" + t]) return sprites["c" + t];
  return (sprites["c" + t] = pixels(20, 5, g => { g.fillStyle = TEAMS[t].c; g.fillRect(3, 1, 12, 3); g.fillStyle = "#e0ac83"; g.fillRect(15, 1, 3, 3); g.fillStyle = "#3b4258"; g.fillRect(0, 2, 4, 2); }));
}
function bombSprite(on) {
  const k = "b" + (on ? 1 : 0);
  if (sprites[k]) return sprites[k];
  return (sprites[k] = pixels(8, 5, g => { g.fillStyle = "#2a2a2a"; g.fillRect(0, 1, 8, 4); g.fillStyle = "#6a6a6a"; g.fillRect(1, 2, 6, 1); g.fillStyle = on ? "#ff4040" : "#7a2020"; g.fillRect(3, 0, 2, 2); }));
}
const spark = () => sprites.spark || (sprites.spark = pixels(3, 3, g => { g.fillStyle = "#ffe7a8"; g.fillRect(1, 0, 1, 3); g.fillRect(0, 1, 3, 1); }));
/// Who you look through: yourself, or the teammate you watch while you are out.
function eyeOf() {
  if (ME.spect >= 0) { const o = posOf(ME.spect); if (o) return { x: o.dx ?? o.x, y: o.dy ?? o.y, a: o.da ?? o.a ?? 0 }; }
  return { x: ME.x, y: ME.y, a: ME.a };
}
function drawFPS(m, eye, i, me) {
  if (!fpsCanvas) { fpsCanvas = document.createElement("canvas"); fpsCanvas.width = GW; fpsCanvas.height = GH; fpsImg = fpsCanvas.getContext("2d").createImageData(GW, GH); fpsBuf = new Uint32Array(fpsImg.data.buffer); }
  const W = GW, H = GH, half = H / 2, buf = fpsBuf, tx = texturesOf(m);
  const bob = ME.moving && ME.spect < 0 ? Math.sin(ME.bob) * 1.2 : 0, hz = half + bob;
  const px = eye.x / T, py = eye.y / T, dx = Math.cos(eye.a), dy = Math.sin(eye.a), plx = -dy * FOV, ply = dx * FOV;
  // sky and floor, a row at a time
  const r0x = dx - plx, r0y = dy - ply, r1x = dx + plx, r1y = dy + ply;
  for (let y = 0; y < H; y++) {
    if (y < hz) { buf.fill(tx.sky[Math.max(0, Math.min(tx.sky.length - 1, Math.floor(y - bob)))], y * W, y * W + W); continue; }
    const dist = (0.5 * H) / (y - hz + 0.5), f = fog(dist);
    const sx = dist * (r1x - r0x) / W, sy = dist * (r1y - r0y) / W;
    let fx = px + dist * r0x, fy = py + dist * r0y;
    for (let x = 0; x < W; x++, fx += sx, fy += sy) {
      const mx = Math.floor(fx * T), my = Math.floor(fy * T);
      buf[y * W + x] = mx >= 0 && my >= 0 && mx < tx.mapW && my < tx.mapH ? shade(tx.map[my * tx.mapW + mx], f) : 0xff141218;
    }
  }
  // the walls, a column at a time
  for (let x = 0; x < W; x++) {
    const cam = 2 * x / W - 1, rx = dx + plx * cam, ry = dy + ply * cam, ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
    let mx = Math.floor(px), my = Math.floor(py), stx = rx < 0 ? -1 : 1, sty = ry < 0 ? -1 : 1;
    let sdx = rx < 0 ? (px - mx) * ddx : (mx + 1 - px) * ddx, sdy = ry < 0 ? (py - my) * ddy : (my + 1 - py) * ddy, side = 0, ch = "#";
    for (let n = 0; n < 256; n++) {
      if (sdx < sdy) { sdx += ddx; mx += stx; side = 0; } else { sdy += ddy; my += sty; side = 1; }
      if (mx < 0 || my < 0 || mx >= m.w || my >= m.h) { ch = "#"; break; }
      ch = m.g[my][mx]; if (!isOpen(ch)) break;
    }
    const perp = Math.max(0.05, side ? sdy - ddy : sdx - ddx);
    zbuf[x] = perp;
    const lh = H / perp, top = Math.max(0, Math.floor(hz - lh / 2)), bot = Math.min(H, Math.ceil(hz + lh / 2));
    let wx = side ? px + perp * rx : py + perp * ry; wx -= Math.floor(wx);
    let tc = Math.min(TEX - 1, Math.floor(wx * TEX)); if ((!side && rx > 0) || (side && ry < 0)) tc = TEX - 1 - tc;
    const t = (ch === "x" ? tx.crate : tx.wall).p, f = fog(perp) * (side ? 0.75 : 1), step = TEX / lh;
    let tp = (top - hz + lh / 2) * step;
    for (let y = top; y < bot; y++, tp += step) buf[y * W + x] = shade(t[Math.min(TEX - 1, Math.max(0, tp | 0)) * TEX + tc], f);
  }
  // the things standing in the world, far to near
  const things = [], now = performance.now(), labels = [];
  DF.players.forEach((p, k) => {
    if (k === i && ME.spect < 0) return;
    if (k === ME.spect) return;
    const o = posOf(k); if (!o || V.quit[k]) return;
    const dead = !(V.hp[k] > 0);
    things.push({ x: o.dx ?? o.x, y: o.dy ?? o.y, img: dead ? corpse(p.t) : soldier(p.t), h: dead ? 0.16 : 0.82, k, dead, flash: now - (DF.shotAt[k] || 0) < 60 });
  });
  const bo = V.bomb;
  if (bo.s === "p" || bo.s === "d" || bo.s === "f" || bo.s === "x") things.push({ x: bo.x, y: bo.y, img: bombSprite(bo.s === "p" && Math.floor(now / (bo.t < 10 ? 150 : 400)) % 2), h: 0.14 });
  for (const t of DF.tracers) if (now - t.at < 70 && !t.mine) things.push({ x: t.x1, y: t.y1, img: spark(), h: 0.1, mid: true });
  for (const t of DF.tracers) if (now - t.at < 70 && t.mine) things.push({ x: t.x1, y: t.y1, img: spark(), h: 0.1, mid: true });
  const inv = 1 / (plx * dy - dx * ply);
  for (const s of things) { const rx = s.x / T - px, ry = s.y / T - py; s.tx = inv * (dy * rx - dx * ry); s.ty = inv * (-ply * rx + plx * ry); }
  things.sort((a, b) => b.ty - a.ty);
  for (const s of things) {
    if (s.ty < 0.15) continue;
    const sh = H * s.h / s.ty, sw = sh * s.img.w / s.img.h, cx = W / 2 * (1 + s.tx / s.ty);
    const floor = hz + 0.5 * H / s.ty, bottom = s.mid ? hz + sh / 2 : floor, topY = bottom - sh;
    const x0 = Math.floor(cx - sw / 2), x1 = Math.ceil(cx + sw / 2), f = fog(s.ty);
    let shown = false;
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
      if (s.ty >= zbuf[x]) continue;
      shown = true;
      const u = Math.min(s.img.w - 1, Math.floor((x - (cx - sw / 2)) / sw * s.img.w));
      for (let y = Math.max(0, Math.floor(topY)); y < Math.min(H, Math.ceil(bottom)); y++) {
        const v = Math.min(s.img.h - 1, Math.floor((y - topY) / sh * s.img.h)), c = s.img.p[v * s.img.w + u];
        if (c >>> 24) buf[y * W + x] = s.flash && v >= 8 && v <= 11 ? 0xff80e8ff : shade(c, f);
      }
    }
    if (shown && s.k !== undefined && !s.dead) labels.push({ x: cx, y: topY - 4, k: s.k, ty: s.ty });
  }
  fpsCanvas.getContext("2d").putImageData(fpsImg, 0, 0);
  gx.drawImage(fpsCanvas, 0, 0);
  // names over teammates (and over an enemy in your sights), with a health bar
  for (const l of labels) {
    const p = DF.players[l.k], friend = me && p.t === me.t, aimed = Math.abs(l.x - W / 2) < 6;
    if (!friend && !aimed) continue;
    gtext(p.name.slice(0, 10), l.x, l.y - 6, friend ? "#f1ebe2" : "#ffb0a8", Math.max(4, Math.min(7, 8 / l.ty)), "center");
    if (friend) { const hp = V.hp[l.k]; gpx(l.x - 5, l.y, 10, 1.2, "#0008"); gpx(l.x - 5, l.y, 10 * hp / 100, 1.2, hp > 50 ? "#5fbf7f" : hp > 25 ? "#e3c74f" : "#e06c6c"); }
  }
  // your gun, kicking back when it fires
  if (alive(i) && ME.spect < 0) drawGun(curW(), ME.kick, now - (DF.shotAt[i] || 0) < 50, bob, me ? me.t : 0);
  ME.kick = Math.max(0, ME.kick - 0.15);
  // hit: a mark on the crosshair; hurt: red at the edges
  if (now - DF.hitAt < 140) { gx.strokeStyle = "#ffffff"; gx.lineWidth = 0.8; gx.beginPath(); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { gx.moveTo(W / 2 + a * 3, half + b * 3); gx.lineTo(W / 2 + a * 6, half + b * 6); } gx.stroke(); }
  if (now - DF.hurtAt < 300) { const a = 0.35 * (1 - (now - DF.hurtAt) / 300); gpx(0, 0, W, 6, `rgba(220,40,40,${a})`); gpx(0, H - 6, W, 6, `rgba(220,40,40,${a})`); gpx(0, 0, 6, H, `rgba(220,40,40,${a})`); gpx(W - 6, 0, 6, H, `rgba(220,40,40,${a})`); }
}
// Your gun in your hands. Each is drawn from the side (x from the muzzle back to the stock, y down
// from the bore), then put in perspective: it points from the lower right toward the crosshair, its
// far end smaller, up and down staying up and down. L: its length; M and S: where the muzzle and the
// far end of the stock land on the screen. back: drawn behind the gun (the arm under it); front: over
// it (the hands). "sleeve" is your team's colour, "skin" and "skinD" your hands.
const GUNS = [
  { L: 130, M: [204, 140], S: [330, 196], parts: [                                                   // rifle
      [[[0, -2], [34, -2], [34, 2], [0, 2]], "#2b2d33"], [[[0, -3], [7, -3], [7, 3], [0, 3]], "#1c1e22"],
      [[[9, -9], [12, -9], [13, -2], [10, -2]], "#2b2d33"],
      [[[30, -5], [66, -5], [66, 6], [30, 6]], "#3a3e46"],
      [[[36, -2], [42, -2], [42, 0], [36, 0]], "#202226"], [[[46, -2], [52, -2], [52, 0], [46, 0]], "#202226"], [[[56, -2], [62, -2], [62, 0], [56, 0]], "#202226"],
      [[[64, -8], [104, -8], [104, 4], [64, 4]], "#454a53"], [[[64, -10], [100, -10], [100, -8], [64, -8]], "#2b2e34"],
      [[[89, -15], [97, -15], [99, -10], [87, -10]], "#2b2e34"], [[[74, -4], [88, -4], [88, -1], [74, -1]], "#1c1e22"],
      [[[66, 4], [100, 4], [100, 9], [66, 9]], "#3a3e46"],
      [[[72, 9], [84, 9], [90, 32], [78, 34]], "#24262b"], [[[74, 12], [83, 12], [84, 15], [75, 15]], "#30333a"],
      [[[90, 9], [96, 9], [96, 14], [90, 13]], "#2b2e34"],
      [[[96, 8], [106, 8], [112, 28], [102, 30]], "#26282d"],
      [[[104, -6], [134, -4], [134, 14], [106, 10]], "#3a3e46"]],
    back: [[[[40, 8], [60, 8], [56, 70], [28, 70]], "sleeve"]],
    front: [[[[38, 0], [60, 0], [62, 9], [40, 10]], "skin"],
      [[[41, -5], [58, -5], [58, 0], [41, 0]], "skinD"],
      [[[48, -5], [49, -5], [49, 0], [48, 0]], "skin"],
      [[[55, -5], [56, -5], [56, 0], [55, 0]], "skin"],
      [[[104, 24], [124, 22], [150, 80], [112, 90]], "sleeve"], [[[96, 8], [110, 9], [114, 27], [100, 28]], "skin"], [[[89, 9], [97, 9], [97, 11], [89, 11]], "skinD"]] },
  { L: 104, M: [210, 146], S: [322, 192], parts: [                                                   // SMG
      [[[0, -2], [16, -2], [16, 2], [0, 2]], "#2b2d33"],
      [[[14, -7], [72, -7], [72, 6], [14, 6]], "#3d4149"], [[[18, -9], [66, -9], [66, -7], [18, -7]], "#2b2e34"],
      [[[18, -12], [22, -12], [22, -9], [18, -9]], "#2b2e34"], [[[60, -12], [66, -12], [66, -9], [60, -9]], "#2b2e34"],
      [[[24, -3], [52, -3], [52, -1], [24, -1]], "#25282d"],
      [[[34, 6], [44, 6], [45, 38], [35, 38]], "#24262b"],
      [[[56, 6], [66, 6], [71, 26], [61, 28]], "#26282d"],
      [[[72, -5], [102, -3], [102, -1], [72, -3]], "#2b2e34"], [[[72, 3], [102, 5], [102, 7], [72, 5]], "#2b2e34"], [[[98, -4], [104, -4], [104, 8], [98, 8]], "#2b2e34"]],
    back: [[[[18, 8], [34, 8], [30, 70], [6, 70]], "sleeve"]],
    front: [[[[16, 0], [34, 0], [36, 9], [18, 10]], "skin"],
      [[[19, -5], [32, -5], [32, 0], [19, 0]], "skinD"],
      [[[25, -5], [26, -5], [26, 0], [25, 0]], "skin"],
      [[[31, -5], [32, -5], [32, 0], [31, 0]], "skin"],
      [[[62, 24], [80, 22], [100, 80], [66, 90]], "sleeve"], [[[54, 7], [68, 8], [72, 27], [58, 28]], "skin"], [[[48, 7], [56, 7], [56, 9], [48, 9]], "skinD"]] },
  { L: 140, M: [202, 140], S: [330, 198], parts: [                                                   // shotgun
      [[[0, -5], [68, -5], [68, 0], [0, 0]], "#3b3e44"], [[[4, 0], [62, 0], [62, 4], [4, 4]], "#2a2c31"],
      [[[2, -7], [4, -7], [4, -5], [2, -5]], "#d8d8d8"],
      [[[16, -1], [46, -1], [46, 9], [16, 9]], "#8a5a32"], [[[19, 2], [43, 2], [43, 3], [19, 3]], "#5e3a1e"], [[[19, 5], [43, 5], [43, 6], [19, 6]], "#5e3a1e"],
      [[[64, -8], [98, -8], [98, 7], [64, 7]], "#3b3e44"], [[[72, -4], [86, -4], [86, -1], [72, -1]], "#18191d"],
      [[[82, 7], [94, 7], [94, 10], [82, 10]], "#2a2c31"],
      [[[96, -6], [142, 0], [142, 18], [112, 14], [110, 26], [98, 26], [96, 8]], "#7a4a28"], [[[100, -4], [140, 1], [140, 3], [100, -2]], "#94603a"]],
    back: [[[[20, 11], [44, 11], [40, 70], [8, 70]], "sleeve"]],
    front: [[[[18, 3], [44, 3], [46, 12], [20, 13]], "skin"],
      [[[21, -2], [42, -2], [42, 3], [21, 3]], "skinD"],
      [[[29, -2], [30, -2], [30, 3], [29, 3]], "skin"],
      [[[38, -2], [39, -2], [39, 3], [38, 3]], "skin"],
      [[[100, 24], [122, 22], [150, 80], [110, 90]], "sleeve"], [[[96, 9], [110, 10], [113, 27], [100, 28]], "skin"], [[[88, 9], [96, 9], [96, 11], [88, 11]], "skinD"]] },
  { L: 165, M: [198, 136], S: [334, 198], parts: [                                                   // sniper
      [[[0, -2], [72, -2], [72, 1], [0, 1]], "#2f3530"], [[[0, -4], [9, -4], [9, 3], [0, 3]], "#1f2420"], [[[3, -4], [4, -4], [4, 3], [3, 3]], "#3a403a"],
      [[[52, -5], [114, -5], [114, 6], [52, 6]], "#4f5f3d"],
      [[[66, -20], [74, -20], [74, -9], [66, -9]], "#1c1f23"], [[[72, -18], [112, -18], [112, -11], [72, -11]], "#25282d"],
      [[[110, -20], [120, -20], [120, -9], [110, -9]], "#1c1f23"], [[[67, -18], [69, -18], [69, -11], [67, -11]], "#6fa8d8"],
      [[[88, -23], [95, -23], [95, -18], [88, -18]], "#1c1f23"],
      [[[78, -11], [83, -11], [83, -5], [78, -5]], "#2a2d31"], [[[102, -11], [107, -11], [107, -5], [102, -5]], "#2a2d31"],
      [[[92, 6], [102, 6], [102, 13], [92, 13]], "#2a2d31"],
      [[[110, 0], [114, 0], [121, 7], [117, 9]], "#2a2d31"], [[[118, 6], [124, 6], [124, 11], [118, 11]], "#2a2d31"],
      [[[114, -4], [168, -6], [168, 16], [128, 12], [122, 26], [110, 26], [112, 6]], "#4f5f3d"]],
    back: [[[[60, 9], [80, 9], [76, 70], [48, 70]], "sleeve"]],
    front: [[[[58, 1], [80, 1], [82, 10], [60, 11]], "skin"],
      [[[61, -4], [78, -4], [78, 1], [61, 1]], "skinD"],
      [[[68, -4], [69, -4], [69, 1], [68, 1]], "skin"],
      [[[75, -4], [76, -4], [76, 1], [75, 1]], "skin"],
      [[[114, 24], [134, 22], [160, 80], [122, 90]], "sleeve"], [[[110, 9], [124, 10], [126, 27], [112, 28]], "skin"], [[[102, 9], [110, 9], [110, 11], [102, 11]], "skinD"]] },
  { L: 64, M: [214, 150], S: [290, 184], parts: [                                                    // pistol
      [[[0, -8], [48, -8], [48, 0], [0, 0]], "#3c3f47"],
      [[[36, -7], [37, -7], [37, -1], [36, -1]], "#262830"], [[[39, -7], [40, -7], [40, -1], [39, -1]], "#262830"], [[[42, -7], [43, -7], [43, -1], [42, -1]], "#262830"],
      [[[2, -10], [5, -10], [5, -8], [2, -8]], "#262830"], [[[42, -11], [47, -11], [47, -8], [42, -8]], "#262830"],
      [[[4, 0], [44, 0], [44, 5], [4, 5]], "#2f3238"], [[[20, 5], [30, 5], [30, 9], [20, 9]], "#2f3238"],
      [[[32, 4], [44, 4], [50, 26], [36, 28]], "#26282d"]],
    back: [[[[16, 14], [38, 14], [46, 90], [8, 90]], "sleeve"]],
    front: [[[[20, 6], [40, 8], [42, 26], [24, 24]], "skinD"], [[[40, 24], [58, 22], [80, 90], [44, 90]], "sleeve"], [[[32, 5], [48, 5], [54, 27], [38, 29]], "skin"]] },
];
const GUN_X = 100, GUN_Y = 80;                     // the gun pictures cover the screen from here to the corner
function gunPicture(w, team) {
  const key = `gun${w}-${team}`;
  if (canvases[key]) return canvases[key];
  const G = GUNS[w], c = document.createElement("canvas"); c.width = GW - GUN_X; c.height = GH - GUN_Y;
  const g = c.getContext("2d"), W = c.width, H = c.height;
  // thicker toward you (d), and thick overall (1.7): a gun held close, most of it below the screen's edge
  const at = (x, y) => { const t = x / G.L, d = (0.6 + 0.9 * t) * 1.7; return [G.M[0] + (G.S[0] - G.M[0]) * t - GUN_X, G.M[1] + (G.S[1] - G.M[1]) * t + y * d - GUN_Y]; };
  const dim = (hex, f) => "#" + rgbOf(hex).map(v => Math.round(v * f).toString(16).padStart(2, "0")).join("");
  // hands (fingers a shade lighter), sleeves a darker shade of your team's colour
  const color = k => ({ sleeve: dim(TEAMS[team].c, 0.55), skin: "#c98f62", skinD: "#e2ab80" })[k] || k;
  const poly = ([pts, col]) => {
    g.fillStyle = color(col); g.beginPath();
    pts.forEach(([x, y], n) => { const [sx, sy] = at(x, y); if (n) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
    g.closePath(); g.fill();
  };
  (G.back || []).forEach(poly); G.parts.forEach(poly); (G.front || []).forEach(poly);
  // pixel art out of it: hard edges, a dark outline, light along top edges and between parts, shade under
  const img = g.getImageData(0, 0, W, H), d = img.data, out = new Uint8ClampedArray(d.length);
  for (let k = 3; k < d.length; k += 4) d[k] = d[k] < 128 ? 0 : 255;
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] === 255;
  const lum = k => d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4;
    if (!solid(x, y)) {
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) { out[k] = 18; out[k + 1] = 16; out[k + 2] = 21; out[k + 3] = 255; }
      continue;
    }
    const up = (k - W * 4), f = !solid(x, y - 1) ? 1.45 : !solid(x, y + 1) ? 0.65 : Math.abs(lum(k) - lum(up)) > 14 ? 1.25 : 1;
    for (let ch = 0; ch < 3; ch++) out[k + ch] = Math.min(255, d[k + ch] * f);
    out[k + 3] = 255;
  }
  img.data.set(out); g.putImageData(img, 0, 0);
  return (canvases[key] = { c, muzzle: G.M });
}
function drawGun(w, kick, flash, bob, team) {
  const pic = gunPicture(w, team), W = WEAPONS[w];
  // reloading: the gun dips out of sight and comes back up
  const rel = ME.rel > 0 ? Math.sin(Math.min(1, Math.max(0, 1 - ME.rel / W.rel)) * Math.PI) : 0;
  const ox = kick * 3, oy = kick * 4 + Math.abs(bob) * 2 + rel * 36;
  gx.drawImage(pic.c, GUN_X + ox, GUN_Y + oy);
  if (flash) {
    const s = [1.1, 0.9, 1.7, 1.4, 0.8][w], mx = pic.muzzle[0] + ox - 3, my = pic.muzzle[1] + oy - 1;
    gx.fillStyle = "rgba(255,220,120,0.35)"; gx.beginPath(); gx.arc(mx, my, 9 * s, 0, Math.PI * 2); gx.fill();
    gpx(mx - 7 * s, my - 1, 14 * s, 2, "#ffd060"); gpx(mx - 1, my - 6 * s, 2, 12 * s, "#ffd060");
    gpx(mx - 3 * s, my - 3 * s, 6 * s, 6 * s, "#ffe7a8"); gpx(mx - 1.5 * s, my - 1.5 * s, 3 * s, 3 * s, "#ffffff");
  }
}
// the mouse turns you: locked to the game when the app allows it (a click locks it, Esc frees it),
// else while the pointer is over the game
// Freed (WebKit may use the Esc itself to free it, without passing it on): the next Esc leaves, as
// it does when escape() frees it.
document.addEventListener("pointerlockchange", () => { if (document.pointerLockElement !== gcv) { ME.trig = false; if (DF.phase === "match") DF.escAt = Date.now(); } });
document.addEventListener("pointerlockerror", () => lockFailed());
function lockFailed() {
  if (DF.noLock) return;
  DF.noLock = true;
  toast("🖱 The mouse could not be locked here: turn with the mouse over the game, or ← →", null, 6000);
}
const locked = () => document.pointerLockElement === gcv;
function lockMouse() {
  if (DF.noLock || locked() || !gcv.requestPointerLock) return;
  try {
    const r = gcv.requestPointerLock();
    if (r && r.catch) r.catch(() => lockFailed());
  } catch (e) { lockFailed(); return; }
  const at = Date.now();
  setTimeout(() => { if (!locked() && DF.view === "fps" && DF.phase === "match" && Date.now() - at >= 1400) lockFailed(); }, 1500);
}
function unlockMouse() { if (locked() && document.exitPointerLock) document.exitPointerLock(); }
gcv.addEventListener("mousemove", ev => {
  if (GAME.view !== "defuse" || DF.view !== "fps" || DF.phase !== "match") return;
  if (locked() || DF.noLock) DF.turn += (ev.movementX || 0) * SENS;
});
function setView(v) {
  DF.view = v; keep("defuseView", v);
  if (v !== "fps") unlockMouse();
  side();
}

// ---------- the side panel ----------
function dfSide() {
  if (DF.phase === "pick") {
    const l = openLobbies();
    gside.innerHTML = `<h3>MAP</h3><div class="pick">${MAPS.map((x, n) => `<button data-map="${n}" class="${n === DF.map ? "on" : ""}">${esc(x.name)}</button>`).join("")}</div>
      <div class="hint" style="margin-top:6px">${esc(MAPS[DF.map].name)}: ${esc(MAPS[DF.map].blurb)}.</div>
      <h3>&nbsp;</h3><button class="go" data-dopen="1">${inRoom() ? "Open a match to the room" : "Play against bots"}</button>
      ${inRoom() ? `<div class="hint" style="margin-top:6px">1 on 1 up to 5 on 5. Teammates join; bots fill empty places; you start it.</div>` : ""}
      ${l.length ? `<h3>OPEN MATCHES</h3>` + l.map(x => `<div class="row"><span class="n">${esc(x.ownerName)} · ${esc(MAPS[x.map].name)} · ${x.players.length}/10</span><button class="go" data-djoin="${esc(x.id)}">Join</button></div>`).join("") : ""}
      ${howHTML()}<h3>&nbsp;</h3><button data-home="1">Games</button>`;
    return;
  }
  const i = myIdx(), teams = [0, 1].map(t => DF.players.map((p, k) => ({ p, k })).filter(x => x.p.t === t));
  const row = ({ p, k }) => {
    const st = DF.phase === "lobby" ? (p.b ? "bot" : "") : V ? `${(V.kd[k] || [0, 0])[0]}/${(V.kd[k] || [0, 0])[1]}${V.quit[k] ? " · left" : V.hp[k] > 0 ? "" : " · out"}` : "";
    return `<div class="row"><span class="dot" style="background:${TEAMS[p.t].c}"></span><span class="n">${esc(p.name)}${k === i ? " (you)" : ""}</span><span class="v">${esc(st)}</span></div>`;
  };
  const role = t => V ? (t === V.at ? " · attack" : " · defend") : "";
  let h = `<h3>${esc(MAPS[DF.map].name.toUpperCase())}${V ? ` · ROUND ${V.r}` : ""}</h3>`;
  for (const t of [0, 1]) {
    h += `<h3>${TEAMS[t].name.toUpperCase()}${V ? " · " + V.sc[t] : ""}${role(t)}</h3>` + (teams[t].map(row).join("") || `<div class="hint">nobody yet</div>`);
    if (DF.phase === "lobby") {
      const mine = i >= 0 && DF.players[i].t === t;
      h += `<div class="pick" style="margin-top:4px">${!mine && teams[t].length < MAX_TEAM ? `<button data-dteam="${t}">Join ${TEAMS[t].name}</button>` : ""}` +
        (amRef() ? `<button data-dbot="${t}" ${teams[t].length >= MAX_TEAM ? "disabled" : ""}>+ bot</button><button data-dunbot="${t}">− bot</button>` : "") + `</div>`;
    }
  }
  if (DF.phase === "lobby") {
    h += amRef() ? `<h3>&nbsp;</h3><button class="go" data-dstart="1" ${count(0) && count(1) ? "" : "disabled"}>Start the match</button> <button data-dleave="1">Cancel</button>
        <div class="hint" style="margin-top:6px">Each side needs someone: a teammate or a bot. Up to 5 a side.</div>`
      : `<div class="hint" style="margin-top:8px">Waiting for ${esc(DF.ownerName)} to start.</div><h3>&nbsp;</h3><button data-dleave="1">Leave</button>`;
  }
  if (DF.phase === "match") h += `<h3>&nbsp;</h3><button data-dleave="1">Leave the match</button>`;
  if (DF.phase === "done") h += `<h3>&nbsp;</h3><button class="go" data-dagain="1">Another match</button> <button data-home="1">Games</button>`;
  gside.innerHTML = h + howHTML();
}
function howHTML() {
  const view = `<h3>VIEW</h3><div class="pick"><button data-dview="fps" class="${DF.view === "fps" ? "on" : ""}">First person</button>` +
    `<button data-dview="top" class="${DF.view === "top" ? "on" : ""}">From above</button></div>`;
  const move = DF.view === "fps"
    ? `W S forward and back, A D step aside, the mouse turns (click once to lock it to the game; ← → turn too)`
    : `WASD move, the mouse aims`;
  return view + `<h3>HOW</h3><div class="hint">${move} · click shoots · Shift walks (steadier aim) · R reloads ·
    Q pistol / main gun · 1–4 at buy time picks Rifle, SMG, Shotgun or Sniper · V switches the view. Attackers carry the bomb to
    A or B and hold E there for ${PLANT} s; defenders hold E at a planted bomb for ${DEFUSE} s. You see enemies only in your
    line of sight. First to ${WIN} rounds; sides swap after round ${HALF}. Esc frees the mouse; Esc twice leaves the match.</div>`;
}
function dfClick(b) {
  const d = b.dataset;
  if (d.dview) setView(d.dview);
  if (d.map !== undefined) { DF.map = +d.map; side(); }
  if (d.dopen) openMatch();
  if (d.djoin) joinMatch(d.djoin);
  if (d.dstart) startMatch();
  if (d.dleave || d.dagain) { leaveMatch(); side(); }
  if (d.dbot !== undefined && amRef()) { addBot(+d.dbot); sendLobby(); }
  if (d.dunbot !== undefined && amRef()) { removeBot(+d.dunbot); sendLobby(); }
  if (d.dteam !== undefined) {
    const t = +d.dteam;
    if (amRef()) { const me = DF.players[myIdx()]; if (me && count(t) < MAX_TEAM) { me.t = t; sendLobby(); } }
    else gsend({ g: "defuse", k: "team", id: DF.id, t });
  }
}

// ---------- from the room ----------
function dfMsg(from, name, d) {
  const now = Date.now() / 1000;
  const owner = (DF.lobbies[d.id] && DF.lobbies[d.id].owner) || (DF.id === d.id ? DF.owner : "");
  if (["open", "lobby", "start", "close"].includes(d.k) && owner && owner !== from) return;   // a match is its referee's
  const players = Array.isArray(d.players) ? d.players.slice(0, 10).map(p => ({ id: String(p.id), name: String(p.name || "").slice(0, 40), t: p.t ? 1 : 0, b: !!p.b })) : null;
  if ((d.k === "open" || d.k === "lobby") && MAPS[d.map] && players) {
    const fresh = !DF.lobbies[d.id];
    DF.lobbies[d.id] = { id: d.id, map: d.map, owner: from, ownerName: name, players, at: now };
    if (DF.id === d.id && DF.phase === "lobby") {
      DF.players = players; DF.map = d.map;
      if (!players.some(p => p.id === myId())) { DF.phase = "pick"; DF.id = ""; toast("💣 That match is full", null, 3000); }
      side();
    } else if (fresh && d.k === "open") {
      if (GAME.open) toast(`💣 ${esc(name)} opened a Defuse match on ${esc(MAPS[d.map].name)} · click to join`, () => joinMatch(d.id), 10000);
      else note(`💣 ${name} opened a Defuse match on ${MAPS[d.map].name}: Games tab → Join`);
      if (GAME.open && GAME.view === "defuse" && DF.phase === "pick") side();
    }
    peopleKey = "";
    return;
  }
  if (d.k === "close" || d.k === "start") { delete DF.lobbies[d.id]; peopleKey = ""; }
  if (DF.id !== d.id) return;
  if (d.k === "close" && DF.phase === "lobby") { DF.phase = "pick"; DF.id = ""; toast(`${esc(name)} closed the match`, null, 3000); side(); return; }
  if (d.k === "start" && DF.phase === "lobby" && players) {
    DF.players = players; DF.map = MAPS[d.map] ? d.map : DF.map;
    if (myIdx() < 0) { DF.phase = "pick"; DF.id = ""; return side(); }
    beginMatch(+d.seed || 1);
    return;
  }
  // the referee looks after the lobby
  if (amRef() && DF.phase === "lobby") {
    if (d.k === "join" && !DF.players.some(p => p.id === from)) {
      // the smaller side; when both are full, a person takes a bot's place
      const t = count(0) <= count(1) ? 0 : 1, tt = count(t) < MAX_TEAM ? t : 1 - t;
      if (count(tt) < MAX_TEAM) DF.players.push({ id: from, name, t: tt });
      else { const bot = DF.players.findIndex(p => p.b); if (bot >= 0) DF.players.splice(bot, 1, { id: from, name, t: DF.players[bot].t }); }
    }
    if (d.k === "join") sendLobby();                 // also when full: they hear it and stop waiting
    if (d.k === "leave") { DF.players = DF.players.filter(p => p.id !== from); sendLobby(); }
    if (d.k === "team") { const p = DF.players.find(x => x.id === from), t = d.t ? 1 : 0; if (p && count(t) < MAX_TEAM) { p.t = t; sendLobby(); } }
    return;
  }
  if (DF.phase !== "match" || !V) return;
  const k = DF.players.findIndex(p => p.id === from);
  if (k < 0) return;
  if (d.k === "p") {
    const o = DF.others[from] || (DF.others[from] = {});
    Object.assign(o, { x: +d.x || 0, y: +d.y || 0, a: (+d.a || 0) / 100, w: Math.max(0, Math.min(4, d.w | 0)), at: now });
    if (Array.isArray(d.s)) for (const s of d.s.slice(0, 6)) { DF.tracers.push({ x0: o.dx ?? o.x, y0: o.dy ?? o.y, x1: +s[0], y1: +s[1], at: performance.now() }); DF.shotAt[k] = performance.now(); }
    if (amRef() && Array.isArray(d.s) && d.s.length) noise(o.x, o.y, teamOf(k));   // the bots hear them
    if (from === DF.owner && d.st) { DF.heard = now; applyState(d.st); }
    // the referee takes a shooter's hits while both are in and the round is on
    if (amRef() && Array.isArray(d.h) && V.hp[k] > 0 && (V.ph === "live" || V.ph === "planted")) {
      const W = WEAPONS[o.w];
      for (const [v, dmg] of d.h.slice(0, 12)) if (DF.players[v] && teamOf(v) !== teamOf(k)) hurt(v, Math.min(+dmg || 0, W.dmg * (W.pel || 1)), k, o.w);
    }
  }
  if (amRef() && d.k === "plant" && V.bomb.s === "c" && V.bomb.c === k && V.hp[k] > 0) plant(+d.x, +d.y, siteAt(mapNow(), +d.x, +d.y));
  if (amRef() && d.k === "defuse" && V.ph === "planted" && V.hp[k] > 0 && teamOf(k) !== V.at) {
    const o = DF.others[from];
    if (o && Math.hypot(o.x - V.bomb.x, o.y - V.bomb.y) < 20) { V.bomb.s = "f"; winRound(1 - V.at, "cut", k); }
  }
  if (d.k === "quit") {
    if (amRef()) { V.quit[k] = 1; hurt(k, 999, -1, -1); }
    if (from === DF.owner) { V.ph = "over"; DF.lost = true; }       // the referee left: nobody keeps the match
    toast(`${esc(name)} left the match`, null, 3000);
  }
}
function openLobbies() {
  const now = Date.now() / 1000;
  for (const [id, l] of Object.entries(DF.lobbies)) if (now - l.at > LOBBY_GONE) delete DF.lobbies[id];
  return Object.values(DF.lobbies).filter(l => l.id !== DF.id);
}

ACHIEVEMENTS.push(["defuse-win", "💣", "Mission done", "win a Defuse match"],
                  ["defuse-cutter", "✂", "Wire cutter", "defuse the bomb"],
                  ["defuse-ace", "🃏", "One-person army", "take out the whole other team (3 or more) in one round"]);
registerGame("defuse", {
  title: "💣 Defuse",
  start: arg => {
    if (DF.phase === "done") leaveMatch();
    if (arg === "demo") { DF.map = 0; gshow("defuse"); openMatch(); addBot(0); addBot(1); startMatch(); return; }
    if (DF.phase !== "lobby" && DF.phase !== "match") DF.phase = "pick";
    gshow("defuse");
  },
  step: dfStep, draw: dfDraw, side: dfSide, click: dfClick, msg: dfMsg, leave: leaveMatch,
  key: (k, down) => {
    if (down && k === "v") return setView(DF.view === "fps" ? "top" : "fps");
    if (!down || DF.phase !== "match" || !V) return;
    if (k === "r") reload();
    if (k === "q") { ME.sec = !ME.sec; ME.rel = 0; }
    if (V.ph === "buy" && "1234".includes(k)) { ME.w = +k - 1; ME.sec = false; ME.rel = 0; ME.ammo[ME.w] = WEAPONS[ME.w].mag; }
  },
  mouse: (p, type) => {
    if (!locked()) { ME.mx = Math.max(0, Math.min(GW, p.x)); ME.my = Math.max(0, Math.min(GH, p.y)); }
    // first person: the first click locks the mouse to the game, the next ones shoot
    if (type === "mousedown" && DF.view === "fps" && DF.phase === "match" && !locked() && !DF.noLock) { lockMouse(); return; }
    if (type === "mousedown") { ME.trig = true; ME.click = true; }
    if (type === "mouseup") ME.trig = false;
  },
  cancel: () => { ME.trig = false; ME.act = 0; },
  // in a match one Esc never leaves: it frees a locked mouse (or, with the mouse free, asks), and the
  // next Esc within 2.5 s leaves
  escape: () => {
    if (locked()) { unlockMouse(); DF.escAt = Date.now(); toast("Esc again leaves the match", null, 2500); return true; }
    if (DF.phase === "match" && Date.now() - DF.escAt > 2500) { DF.escAt = Date.now(); toast("Esc again leaves the match", null, 2500); return true; }
    return false;
  },
  tab: () => { const l = openLobbies(); return l.length ? `<div class="gh">DEFUSE MATCHES</div>` + l.map(x => `<div class="g"><span class="gn">💣 ${esc(x.ownerName)} · ${esc(MAPS[x.map].name)} · ${x.players.length}/10</span><button data-gdjoin="${esc(x.id)}">Join</button></div>`).join("") : ""; },
  tabClick: b => { if (b.dataset.gdjoin) { joinMatch(b.dataset.gdjoin); return true; } return false; },
  tabKey: () => openLobbies().map(l => l.id + l.players.length).join(","),
  homeHTML: () => { const l = openLobbies(); return l.length ? `<h3>OPEN DEFUSE MATCHES</h3>` + l.map(x => `<div class="row"><span class="n">${esc(x.ownerName)} · ${esc(MAPS[x.map].name)} · ${x.players.length}/10</span><button class="go" data-djoinhome="${esc(x.id)}">Join</button></div>`).join("") : ""; },
  iconCenter: [0, 0],
  drawIcon: t => {
    gpx(-26, -14, 52, 30, "#c9a96e"); gpx(-26, -14, 52, 4, "#ae8a5c"); gpx(4, -2, 8, 8, "#7a5230");
    const a = Math.sin(t * 2) * 0.5;
    gx.save(); gx.translate(-12, 6); drawSoldier(0, 0, a, TEAMS[1].c, 0, false); gx.restore();
    if (Math.floor(t * 4) % 3 === 0) { gx.strokeStyle = "#ffe7a8"; gx.lineWidth = 0.7; gx.beginPath(); gx.moveTo(-6 + Math.cos(a) * 6, 6 + Math.sin(a) * 6); gx.lineTo(20, 6 + Math.sin(a) * 26); gx.stroke(); }
    gpx(18, -10, 5, 4, "#2a2a2a"); gpx(19.5, -9, 2, 2, Math.floor(t * 3) % 2 ? "#ff4040" : "#a03030");
    gtext("defuse", 0, 20, "#a79d93", 8, "center");
  },
});
// the home's Join buttons for open matches
gside.addEventListener("click", ev => { const b = ev.target.closest("button[data-djoinhome]"); if (b) joinMatch(b.dataset.djoinhome); });
window.defuseTest = { DF, ME, MAPS, flow, nextStep, clear, spawnSpot, refState, applyState, get V() { return V; }, set V(v) { V = v; },
  openMatch, addBot, startMatch, refStep, dfStep, dfDraw, dfSide, dfMsg, shoot, WEAPONS, drawFPS, zbuf, get fpsBuf() { return fpsBuf; } };
})();
