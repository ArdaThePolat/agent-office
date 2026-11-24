// 🚀 Rocket Rumpus (games.js is the shell): a top-down arena shooter for 2 to 6 little rockets. A rocket
// always flies forward; one key turns it (one way only, like a wind-up toy: the opener may allow both
// ways), the other fires. Three shots, refilled one at a time. A hit blows the rocket apart and throws
// its pilot out: a tiny astronaut who spins with the turn key and puffs a jetpack with the fire key. A
// pilot who lasts 5 s on foot calls down a fresh rocket; a pilot who is shot or run over is out of the
// round. The last one left (flying or floating) takes the round; first to 5 rounds (3 or 7, the opener
// picks) takes the match.
//
// Three arenas: Crystal Quarry (metal pillars and walls of crystal to shoot through), Gravewell (a black
// hole in the middle that pulls rockets, pilots and shots; rocks drift around it) and Rotor Station (a
// rotor spinning in the middle, two blocks sliding up and down, cargo crates). Six power-ups come in
// capsules: the ion lance (a beam across the arena, through crystal), spike mines, the fan shot (three
// at once), the cryo shot (it freezes), the bubble shield (takes one hit) and bounce rounds (shots
// ricochet). After 45 s of a round the fence closes in (sudden death): no new rockets; a rocket the fence
// touches blows up (its pilot is thrown back toward the middle), and a pilot it touches is out.
//
// Who plays: open a match to the room; teammates join; the opener adds bots (Easy, Normal or Hard) and
// couch players (more people at the opener's keyboard, two keys each, three with both ways), then starts it. Alone, it is you
// (and your couch) against bots.
//
// Networking is ping-pong's model stretched to six: the opener's Mac runs the whole match at a
// fixed 120 steps a second and sends it 15 times a second (st); everyone else sends their two keys 15
// times a second (in: the held keys and press counters, so a quick tap is never lost) and draws the
// match a tenth of a second behind, moving smoothly between the last two pictures. The opener sends
// the lobby on every change and every 20 s.
//
// Room messages, {g: "rocketbrawl", k, id, …}, every number in them whole (the room re-encodes them, and
// a fraction like 123.4 grows into 123.40000000000001): open / lobby {ar, df, wn, tn, players: [{id,
// name, b, c}]}, join, leave, close, start {…the lobby, seed}, st (the match: see pack), in {t, f, fc,
// tc, td}, end {s, kl, w}, quit.
(() => {
"use strict";

const ID = "rocketbrawl";
const TAU = Math.PI * 2;

// ---------- tuning ----------
const TICK = 1 / 120;                                    // the simulation's fixed step
const TS = 8, COLS = 39, ROWS = 22;                      // the arena's grid of blocks
const AX0 = 4, AY0 = 20, AX1 = AX0 + COLS * TS, AY1 = AY0 + ROWS * TS;   // the arena, 312 × 176, under the 20 px score bar
const MX = (AX0 + AX1) / 2, MY = (AY0 + AY1) / 2;       // its middle
const SHIP_R = 4.5, PILOT_R = 2.5, SHOT_R = 1.5;         // radii
const SPEED = 66, TURN = 4.4, GRIP = 5, RECOIL = 14;     // px/s; rad/s; how quickly the drift follows the nose; a shot's kick
const GK = 1 - Math.exp(-GRIP * TICK);
const SHOT_V = 165, SHOT_LIFE = 1.45, RICO_LIFE = 2.4, AMMO = 3, RELOAD = 0.8, COOL = 0.13, MAX_SHOTS = 34;
const P_TURN = 7.5, PUFF = 50, P_DRAG = 1.9, P_MAX = 72, PUFF_CD = 0.25;   // a pilot on foot
const RESPAWN = 5, EJECT_INV = 0.35, SPAWN_INV = 1.2;    // on foot this long: a new rocket; moments nothing can hurt you
const READY_T = 1.9, END_T = 3.2, SD_AT = 45, SD_LEN = 26, SLOWMO = 0.7;
const PU_R = 6, PU_LIFE = 11, PU_FIRST = 3.5, PU_EVERY = 6.5, PU_MAX = 2;
const LANCE_CHARGE = 0.3, LANCE_T = 0.3, LANCE_W = 2.5;
const MINE_ARM = 0.7, MINE_TRIG = 10, MINE_BLAST = 18, MINE_LIFE = 20, MAX_MINES = 6;
const FREEZE_T = 2.4, SHIELD_T = 10, RICO_T = 9;
const HOLE_R = 7, HOLE_PULL = 38000;                     // Gravewell's black hole: its deadly core, its pull
const HUB_R = 9, ARM_L = 40, ARM_W = 3, ROTOR_W = 0.8;  // Rotor Station's rotor: hub, arm length and half width, rad/s
const PIST = [60, AX0 + AX1 - 60], PIST_H = 7, PIST_A = 52, PIST_P = 5.5;   // its sliding blocks: x, half size, swing, period
const SEND = 1 / 15, GONE = 8, LAG = 0.11, LOBBY_PING = 20, LOBBY_GONE = 60, MAX_P = 6, SEND_SHOTS = 24;
const WINS = [3, 5, 7];
const PH = ["ready", "fight", "end", "over"];
const COLORS = ["#ff5a4e", "#4d9dff", "#5fe06a", "#ffd23f", "#ff6fcf", "#3fe3e0"];
const CNAMES = ["RED", "BLUE", "GREEN", "YELLOW", "PINK", "CYAN"];
const BOT_NAMES = ["Bot Vega", "Bot Pip", "Bot Nova", "Bot Juno", "Bot Kip", "Bot Lux", "Bot Odo"];
const POWERS = [
  { id: "lance",  name: "ION LANCE",     c: "#ff4fd8", n: 1, how: "🔱 Ion lance: a beam right across the arena, through crystal" },
  { id: "mine",   name: "SPIKE MINES",   c: "#ff6a3c", n: 2, how: "✳ Spike mines: fire drops one behind you; it arms, then waits" },
  { id: "fan",    name: "FAN SHOT",      c: "#ffd23f", n: 3, how: "🔆 Fan shot: your next three shots go three at a time" },
  { id: "cryo",   name: "CRYO SHOT",     c: "#8fe3ff", n: 1, how: "❄ Cryo shot: a slow icy shot that freezes whoever it hits" },
  { id: "shield", name: "BUBBLE SHIELD", c: "#7dffb0", n: 0, how: "🫧 Bubble shield: takes one hit (10 s)" },
  { id: "bounce", name: "BOUNCE ROUNDS", c: "#b98bff", n: 0, how: "↯ Bounce rounds: your shots ricochet off walls (9 s)" },
];
const PW_LANCE = 0, PW_MINE = 1, PW_FAN = 2, PW_CRYO = 3, PW_SHIELD = 4, PW_BOUNCE = 5;
// The bots: how often they look again (s), how near their nose must be to fire, how far ahead they lead
// a moving rocket (0–1), aim error, how often they steer clear of walls and the black hole, dodge shots,
// fire when they could; whether they keep a shot in reserve, how far they shoot, the least time between shots.
const DIFFS = [
  { name: "Easy",   react: 0.3,  aim: 0.3,  lead: 0.2,  err: 0.16,  avoid: 0.55, hole: 0.6,  dodge: 0,    fire: 0.55, keep: 0, range: 150, gap: 0.5, blurb: "drowsy: slow to aim, wasteful, bumps into things" },
  { name: "Normal", react: 0.15, aim: 0.17, lead: 0.65, err: 0.07,  avoid: 0.85, hole: 0.92, dodge: 0.35, fire: 0.85, keep: 1, range: 195, gap: 0.28, blurb: "a fair fight" },
  { name: "Hard",   react: 0.07, aim: 0.1,  lead: 1,    err: 0.025, avoid: 1,    hole: 1,    dodge: 0.75, fire: 1,    keep: 1, range: 225, gap: 0.16, blurb: "leads its shots, dodges yours, hunts pilots" },
];
// Keys per seat: seat 0 is you; couch players at the opener's keyboard get seats 1–3. One way: turn,
// fire. Both ways: left, right, fire.
const SEATS = [
  { one: { t: ["arrowleft", "a"], f: ["arrowright", "d", " "] }, two: { l: ["arrowleft", "a"], r: ["arrowright", "d"], f: ["arrowup", "w", " "] }, k1: "← / A turn · → / D / Space fire", k2: "← → / A D turn · ↑ / W / Space fire" },
  { one: { t: ["z"], f: ["x"] }, two: { l: ["z"], r: ["c"], f: ["x"] }, k1: "Z turn · X fire", k2: "Z C turn · X fire" },
  { one: { t: ["v"], f: ["b"] }, two: { l: ["v"], r: ["n"], f: ["b"] }, k1: "V turn · B fire", k2: "V N turn · B fire" },
  { one: { t: ["k"], f: ["l"] }, two: { l: ["j"], r: ["l"], f: ["k"] }, k1: "K turn · L fire", k2: "J L turn · K fire" },
];
const EV = { ready: 1, go: 2, boom: 3, splat: 4, squash: 5, hole: 6, pick: 7, fizzle: 8, pop: 9, mine: 10, lance: 11, freeze: 12,
  respawn: 13, sd: 14, round: 15, over: 16, gone: 17, fence: 18 };

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const num = v => { const n = +v; return Number.isFinite(n) ? n : 0; };
const wrapA = a => { a %= TAU; return a < 0 ? a + TAU : a; };                       // 0 … 2π
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
const i10 = v => Math.round(v * 10);
const officeCut = () => typeof mgrCut !== "undefined" ? mgrCut : null;            // office.html's globals
const mateCut = id => { const m = typeof mateCuts !== "undefined" && mateCuts.get(id); return m && m.cut || null; };

// ---------- the arenas ----------
// A quarter of each (20 columns × 11 rows, the top left), mirrored into the other three: # metal (nothing
// gets through), * crystal (a shot breaks it; on Rotor Station, cargo crates). The middle column and the
// middle two rows are shared. Rockets start in the corners, then the middle of the top and bottom edges.
const ARENAS = [
  { id: "quarry", name: "Crystal Quarry", short: "Quarry", blurb: "metal pillars, walls of crystal to shoot through, a crystal cage in the middle", q: [
    "....................",
    "....................",
    "....................",
    "....................",
    "......##.....*......",
    "......##.....*......",
    ".........*..........",
    "..*......*..........",
    "..*..............***",
    "..*.............*...",
    "................*..#"] },
  { id: "well", name: "Gravewell", short: "Gravewell", blurb: "a black hole in the middle pulls in rockets, pilots and shots; rocks drift round it", q: [
    "....................",
    "....................",
    "....................",
    "...........*........",
    "....#.....***.......",
    "...........*........",
    "....................",
    "....................",
    "....................",
    "##..................",
    "##.................."] },
  { id: "rotor", name: "Rotor Station", short: "Rotor", blurb: "a rotor spins in the middle, two blocks slide up and down, crates to blow apart", q: [
    "....................",
    "....................",
    "..........**........",
    "..........*.........",
    "....................",
    "....................",
    "...*................",
    "...*................",
    "....................",
    "....................",
    "##..........*......."] },
];
for (const A of ARENAS) {
  A.tiles = new Uint8Array(COLS * ROWS);
  A.q.forEach((row, r) => [...row].forEach((ch, c) => {
    const v = ch === "#" ? 1 : ch === "*" ? 2 : 0;
    if (v) for (const [cc, rr] of [[c, r], [COLS - 1 - c, r], [c, ROWS - 1 - r], [COLS - 1 - c, ROWS - 1 - r]]) A.tiles[rr * COLS + cc] = v;
  }));
  A.crystals = [];
  for (let k = 0; k < A.tiles.length; k++) if (A.tiles[k] === 2) A.crystals.push(k);
}
const SPAWNS = [[24, 36], [AX0 + AX1 - 24, AY0 + AY1 - 36], [AX0 + AX1 - 24, 36], [24, AY0 + AY1 - 36], [MX, 34], [MX, AY0 + AY1 - 34]];
const ROCKS = [{ r: 8, ang: -Math.PI / 2, d: 54 }, { r: 6, ang: Math.PI / 6, d: 60 }, { r: 7, ang: Math.PI * 5 / 6, d: 58 }];
const tileIdx = (x, y) => { const c = Math.floor((x - AX0) / TS), r = Math.floor((y - AY0) / TS); return c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : r * COLS + c; };
const rotorA = rt => rt * ROTOR_W;
const pistonY = (k, rt) => MY + PIST_A * Math.sin(rt * TAU / PIST_P + k * Math.PI);
const pistonV = (k, rt) => PIST_A * TAU / PIST_P * Math.cos(rt * TAU / PIST_P + k * Math.PI);
/// The fence: the whole arena, or less in sudden death.
function fence(sd) { const ix = sd * (AX1 - AX0) / 2, iy = sd * (AY1 - AY0) / 2; return [AX0 + ix, AY0 + iy, AX1 - ix, AY1 - iy]; }

// ---------- the match: rockets, pilots, shots ----------
const newInput = () => ({ t: 0, f: 0, fp: 0, tp: 0, tps: -1 });      // turn held (−1 left, 1 right), fire held, presses, a tap's turn
function newWorld(cfg) {
  // cfg: { seed, n, arena (−1: all three in turn), win, turn (1 one way, 2 both ways), bots: per player a level or −1 }
  const z = () => new Array(cfg.n).fill(0);
  const W = { cfg, seed: cfg.seed, rng: seeded(cfg.seed), n: cfg.n, time: 0, acc: 0, slow: 0, ph: "ready", phT: 0, rt: 0, ft: 0, sd: 0, F: fence(0),
    round: 0, arena: 0, first: cfg.arena >= 0 ? cfg.arena : Math.floor(seeded(cfg.seed + 7)() * ARENAS.length),
    score: z(), kills: z(), q: z(), fired: z(), winner: -1, champ: -1, P: [], inp: [], ai: [], B: [], U: [], M: [], L: [], R: [], tiles: null,
    nid: 0, uid: 0, puIn: 0, ev: 0, events: [],
    stats: { shots: 0, booms: 0, splats: 0, squashes: 0, holes: 0, picks: 0, fizzles: 0, spawned: 0, respawns: 0, lances: 0, blasts: 0, freezes: 0, pops: 0, breaks: 0, sds: 0, rounds: 0, draws: 0, fenced: 0, types: {} } };
  for (let i = 0; i < W.n; i++) {
    W.P.push({ mode: 0, x: MX, y: MY, a: 0, vx: 0, vy: 0, ammo: AMMO, rel: 0, cd: 0, pw: -1, ch: 0, shield: 0, rico: 0, frozen: 0, inv: 0, charge: -1, resp: 0, puffCd: 0, puffT: 0, rk: 0, turn: 0 });
    W.inp.push(newInput());
    W.ai.push(cfg.bots && cfg.bots[i] >= 0 ? newBot(cfg.bots[i]) : null);
  }
  newRound(W);
  return W;
}
function newRound(W) {
  W.round++;
  W.arena = W.cfg.arena >= 0 ? W.cfg.arena : (W.first + W.round - 1) % ARENAS.length;
  const A = ARENAS[W.arena];
  Object.assign(W, { tiles: A.tiles.slice(), B: [], U: [], M: [], L: [], ph: "ready", phT: 0, rt: 0, ft: 0, sd: 0, F: fence(0), puIn: PU_FIRST, winner: -1 });
  W.R = A.id === "well" ? ROCKS.map(k => ({ r: k.r, x: MX + Math.cos(k.ang) * k.d * 1.45, y: MY + Math.sin(k.ang) * k.d * 0.8,
    vx: -Math.sin(k.ang) * 17, vy: Math.cos(k.ang) * 17 })) : [];
  // the players still in, on the first spawn spots, turned a place each round
  const live = [];
  for (let i = 0; i < W.n; i++) if (!W.q[i]) live.push(i); else W.P[i].mode = 0;
  live.forEach((i, k) => {
    const s = SPAWNS[(k + W.round - 1) % live.length];
    Object.assign(W.P[i], { mode: 1, x: s[0], y: s[1], a: wrapA(Math.atan2(MY - s[1], MX - s[0])), vx: 0, vy: 0, ammo: AMMO, rel: 0, cd: 0, pw: -1, ch: 0,
      shield: 0, rico: 0, frozen: 0, inv: 0, charge: -1, resp: 0, puffCd: 0, puffT: 0, rk: 0, turn: 0 });
  });
  for (const I of W.inp) Object.assign(I, { fp: 0, tp: 0 });
  emit(W, EV.ready, W.round, W.arena);
}
/// Something worth showing happened: kept a moment for the state messages, and shown here at once.
function emit(W, type, a, b, x, y) {
  const e = [++W.ev, type, a | 0, b | 0, Math.round(x || 0), Math.round(y || 0)];
  W.events.push({ e, t: W.time }); if (W.events.length > 24) W.events.shift();
  if (W === shownWorld()) onEvent(e);
}
const turnDir = (W, I) => { let t = I.t || (I.tp > 0 ? I.tps : 0); if (W.cfg.turn === 1 && t) t = -1; return t; };

/// One fixed step of the whole match.
function tick(W) {
  W.time += TICK; W.phT += TICK; W.rt += TICK;
  for (const I of W.inp) if (I.tp > 0) I.tp -= TICK;
  if (W.ph === "over") return;                                // the podium: everything stays as it was
  if (W.ph === "ready") {                                     // rockets on their spots, warping in
    stepRocks(W);
    if (W.phT >= READY_T) { W.ph = "fight"; W.phT = 0; emit(W, EV.go); }
    return;
  }
  if (W.ph === "fight") {
    W.ft += TICK;
    const sd = W.ft > SD_AT ? Math.min(1, (W.ft - SD_AT) / SD_LEN) : 0;
    if (sd > 0 && W.sd === 0) { emit(W, EV.sd); W.stats.sds++; }
    W.sd = sd; W.F = fence(sd);
  }
  stepRocks(W);
  for (let i = 0; i < W.n; i++) { const p = W.P[i]; if (p.mode === 1) stepShip(W, i, p, W.inp[i]); else if (p.mode === 2) stepPilot(W, i, p, W.inp[i]); }
  contacts(W);
  stepShots(W); stepMines(W); stepLances(W); stepPowerups(W);
  if (W.sd > 0) squeeze(W);
  if (W.ph === "fight") {
    const active = [], left = [];
    for (let i = 0; i < W.n; i++) if (!W.q[i]) { active.push(i); if (W.P[i].mode) left.push(i); }
    if (active.length < 2) { W.ph = "over"; W.phT = 0; W.champ = active.length ? active[0] : -1; emit(W, EV.over, W.champ, 1); return; }
    if (left.length <= 1) {
      // the last one left takes the round (nobody left: nobody does)
      W.winner = left.length ? left[0] : -1;
      if (W.winner >= 0) W.score[W.winner]++; else W.stats.draws++;
      W.ph = "end"; W.phT = 0; W.slow = SLOWMO; W.stats.rounds++;
      emit(W, EV.round, W.winner, W.winner >= 0 ? W.P[W.winner].mode : 0);
    }
  } else if (W.ph === "end" && W.phT >= END_T) {
    let best = 0;
    for (let i = 1; i < W.n; i++) if (W.score[i] > W.score[best] || W.score[i] === W.score[best] && W.kills[i] > W.kills[best]) best = i;
    if (W.score[best] >= W.cfg.win) { W.ph = "over"; W.phT = 0; W.champ = best; emit(W, EV.over, best, 0); }
    else newRound(W);
  }
}
/// The match moves on by dt seconds (slower for a moment after a round's last kill), the bots deciding
/// their keys before each step.
function runWorld(W, dt) {
  if (W.slow > 0) { W.slow -= dt; dt *= 0.35; }
  W.acc = Math.min(0.1, W.acc + dt);
  while (W.acc >= TICK) {
    for (let i = 0; i < W.n; i++) if (W.ai[i]) botStep(W, i, W.ai[i]);
    tick(W);
    W.acc -= TICK;
  }
}

function stepShip(W, i, p, I) {
  const dt = TICK;
  p.inv = Math.max(0, p.inv - dt); p.cd -= dt; p.shield = Math.max(0, p.shield - dt); p.rico = Math.max(0, p.rico - dt);
  if (p.ammo < AMMO) { if ((p.rel += dt) >= RELOAD) { p.ammo++; p.rel = 0; } } else p.rel = 0;
  p.turn = 0;
  if (p.frozen > 0) { p.frozen = Math.max(0, p.frozen - dt); I.fp = 0; p.charge = -1; }   // frozen: it slides on, nose fixed
  else {
    const dir = turnDir(W, I);
    if (dir) { p.a = wrapA(p.a + dir * TURN * dt); p.turn = dir; }
    p.vx += (Math.cos(p.a) * SPEED - p.vx) * GK; p.vy += (Math.sin(p.a) * SPEED - p.vy) * GK;
    if (I.fp > 0) { I.fp--; fire(W, i, p); }
    if (p.charge >= 0 && (p.charge += dt) >= LANCE_CHARGE) { p.charge = -1; lance(W, i, p); }
  }
  pull(W, p, 1);
  move(W, p, SHIP_R, 0.4, 200);
  if (ARENAS[W.arena].id === "well" && Math.hypot(p.x - MX, p.y - MY) < HOLE_R + 1.5) killShip(W, i, -1, "hole");
}
function stepPilot(W, i, p, I) {
  const dt = TICK;
  p.inv = Math.max(0, p.inv - dt); p.puffCd -= dt; p.puffT = Math.max(0, p.puffT - dt);
  if (p.frozen > 0) { p.frozen = Math.max(0, p.frozen - dt); I.fp = 0; }
  else {
    const dir = turnDir(W, I);
    if (dir) p.a = wrapA(p.a + dir * P_TURN * dt);
    if (I.fp > 0) {
      I.fp--;
      if (p.puffCd <= 0) {                                   // a puff of the jetpack, the way the pilot faces
        p.vx += Math.cos(p.a) * PUFF; p.vy += Math.sin(p.a) * PUFF;
        const s = Math.hypot(p.vx, p.vy); if (s > P_MAX) { p.vx *= P_MAX / s; p.vy *= P_MAX / s; }
        p.puffCd = PUFF_CD; p.puffT = 0.2;
      }
    }
  }
  const f = Math.exp(-P_DRAG * dt); p.vx *= f; p.vy *= f;
  pull(W, p, 1);
  move(W, p, PILOT_R, 0.5, 160);
  if (ARENAS[W.arena].id === "well" && Math.hypot(p.x - MX, p.y - MY) < HOLE_R + 0.5) return killPilot(W, i, -1, "hole");
  // a pilot who lasts long enough on foot calls down a new rocket (not in sudden death)
  if (W.ph === "fight" && W.sd === 0 && (p.resp += dt) >= RESPAWN) {
    Object.assign(p, { mode: 1, inv: SPAWN_INV, ammo: AMMO, rel: 0, cd: 0, pw: -1, ch: 0, frozen: 0, charge: -1, resp: 0, vx: p.vx * 0.3, vy: p.vy * 0.3 });
    move(W, p, SHIP_R, 0.4, 200);
    W.stats.respawns++;
    emit(W, EV.respawn, i, 0, p.x, p.y);
  }
}
/// Gravewell: the black hole pulls (k scales it: shots a little less).
function pull(W, o, k) {
  if (ARENAS[W.arena].id !== "well") return;
  const dx = MX - o.x, dy = MY - o.y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1, a = Math.min(420, HOLE_PULL / Math.max(d2, 64)) * k;
  o.vx += dx / d * a * TICK; o.vy += dy / d * a * TICK;
}
function move(W, o, r, e, vmax) {
  const s = Math.hypot(o.vx, o.vy); if (s > vmax) { o.vx *= vmax / s; o.vy *= vmax / s; }
  o.x += o.vx * TICK; o.y += o.vy * TICK;
  return hitWalls(W, o, r, e);
}

// ---------- collisions ----------
/// A circle pushed out of a box (its surface moving at sv); its speed into it bounces back by e. Returns
/// how hard it hit (0: not touching).
function circleBox(o, r, x0, y0, w, h, svx, svy, e) {
  const px = clamp(o.x, x0, x0 + w), py = clamp(o.y, y0, y0 + h);
  let dx = o.x - px, dy = o.y - py, d2 = dx * dx + dy * dy, nx, ny, pen;
  if (d2 >= r * r) return 0;
  if (d2 > 1e-9) { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; pen = r - d; }
  else {                                                   // the centre inside: out the nearest side
    const L = o.x - x0, R = x0 + w - o.x, T = o.y - y0, B = y0 + h - o.y, m = Math.min(L, R, T, B);
    [nx, ny] = m === L ? [-1, 0] : m === R ? [1, 0] : m === T ? [0, -1] : [0, 1]; pen = m + r;
  }
  return resolve(o, nx, ny, pen, svx, svy, e);
}
function circleCircle(o, r, cx, cy, cr, svx, svy, e) {
  const dx = o.x - cx, dy = o.y - cy, d = Math.hypot(dx, dy);
  if (d >= r + cr) return 0;
  const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
  return resolve(o, nx, ny, r + cr - d, svx, svy, e);
}
/// A rotor arm: the segment from (x0, y0) to (x1, y1), hw thick each side, turning at w round the middle.
function circleArm(o, r, x0, y0, x1, y1, hw, w, e) {
  const sx = x1 - x0, sy = y1 - y0, l2 = sx * sx + sy * sy, t = clamp(((o.x - x0) * sx + (o.y - y0) * sy) / l2, 0, 1);
  const cx = x0 + sx * t, cy = y0 + sy * t, dx = o.x - cx, dy = o.y - cy, d = Math.hypot(dx, dy);
  if (d >= r + hw) return 0;
  const nx = d > 1e-6 ? dx / d : -sy / Math.sqrt(l2), ny = d > 1e-6 ? dy / d : sx / Math.sqrt(l2);
  return resolve(o, nx, ny, r + hw - d, -w * (cy - MY), w * (cx - MX), e);
}
function resolve(o, nx, ny, pen, svx, svy, e) {
  o.x += nx * pen; o.y += ny * pen;
  const vn = (o.vx - svx) * nx + (o.vy - svy) * ny;
  if (vn < 0) { o.vx -= (1 + e) * vn * nx; o.vy -= (1 + e) * vn * ny; return -vn + 0.01; }
  return 0.01;
}
/// Keep a moving circle inside the fence and out of blocks and the arena's parts.
function hitWalls(W, o, r, e) {
  let hit = 0;
  const c0 = Math.floor((o.x - r - AX0) / TS), c1 = Math.floor((o.x + r - AX0) / TS), r0 = Math.floor((o.y - r - AY0) / TS), r1 = Math.floor((o.y + r - AY0) / TS);
  for (let rr = Math.max(0, r0); rr <= Math.min(ROWS - 1, r1); rr++) for (let cc = Math.max(0, c0); cc <= Math.min(COLS - 1, c1); cc++)
    if (W.tiles[rr * COLS + cc]) hit = Math.max(hit, circleBox(o, r, AX0 + cc * TS, AY0 + rr * TS, TS, TS, 0, 0, e));
  const id = ARENAS[W.arena].id;
  if (id === "well") for (const k of W.R) hit = Math.max(hit, circleCircle(o, r, k.x, k.y, k.r, k.vx, k.vy, e));
  else if (id === "rotor") {
    hit = Math.max(hit, circleCircle(o, r, MX, MY, HUB_R, 0, 0, e));
    const th = rotorA(W.rt);
    for (let k = 0; k < 4; k++) {
      const a = th + k * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
      hit = Math.max(hit, circleArm(o, r, MX + c * HUB_R, MY + s * HUB_R, MX + c * ARM_L, MY + s * ARM_L, ARM_W, ROTOR_W, e));
    }
    for (let k = 0; k < 2; k++) hit = Math.max(hit, circleBox(o, r, PIST[k] - PIST_H, pistonY(k, W.rt) - PIST_H, PIST_H * 2, PIST_H * 2, 0, pistonV(k, W.rt), e));
  }
  // the fence last: whatever pushed it, nothing ends up outside
  const F = W.F, w2 = (F[2] - F[0]) / 2, h2 = (F[3] - F[1]) / 2;
  if (w2 < r) o.x = (F[0] + F[2]) / 2;
  else if (o.x - r < F[0]) { o.x = F[0] + r; if (o.vx < 0) { hit = Math.max(hit, -o.vx); o.vx = -o.vx * e; } }
  else if (o.x + r > F[2]) { o.x = F[2] - r; if (o.vx > 0) { hit = Math.max(hit, o.vx); o.vx = -o.vx * e; } }
  if (h2 < r) o.y = (F[1] + F[3]) / 2;
  else if (o.y - r < F[1]) { o.y = F[1] + r; if (o.vy < 0) { hit = Math.max(hit, -o.vy); o.vy = -o.vy * e; } }
  else if (o.y + r > F[3]) { o.y = F[3] - r; if (o.vy > 0) { hit = Math.max(hit, o.vy); o.vy = -o.vy * e; } }
  return hit;
}
/// Is a point (a shot, a beam, a bot's look ahead) inside one of the arena's parts? Returns the way out
/// of it [nx, ny], or null. still: only the parts that stay put (a bot gambles a shot past moving arms).
function partNormal(W, x, y, r, still) {
  const id = ARENAS[W.arena].id;
  const circ = (cx, cy, cr) => { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); return d < cr + r ? (d > 1e-6 ? [dx / d, dy / d] : [1, 0]) : null; };
  if (id === "well") {
    for (const k of W.R) { const n = circ(k.x, k.y, k.r); if (n) return n; }
    return null;
  }
  if (id !== "rotor") return null;
  let n = circ(MX, MY, HUB_R); if (n || still) return n;
  const th = rotorA(W.rt);
  for (let k = 0; k < 4; k++) {
    const a = th + k * Math.PI / 2, c = Math.cos(a), s = Math.sin(a), u = (x - MX) * c + (y - MY) * s, v = -(x - MX) * s + (y - MY) * c;
    if (u > HUB_R - 2 && u < ARM_L + ARM_W + r && Math.abs(v) < ARM_W + r) return v >= 0 ? [-s, c] : [s, -c];
  }
  for (let k = 0; k < 2; k++) {
    const py = pistonY(k, W.rt), dx = x - PIST[k], dy = y - py;
    if (Math.abs(dx) < PIST_H + r && Math.abs(dy) < PIST_H + r) return Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
  }
  return null;
}
/// Rockets bump each other; a rocket that runs over someone else's pilot squashes them.
function contacts(W) {
  for (let i = 0; i < W.n; i++) {
    const p = W.P[i]; if (p.mode !== 1) continue;
    for (let j = i + 1; j < W.n; j++) {
      const q = W.P[j]; if (q.mode !== 1) continue;
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if (d >= SHIP_R * 2 || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d, pen = (SHIP_R * 2 - d) / 2;
      p.x -= nx * pen; p.y -= ny * pen; q.x += nx * pen; q.y += ny * pen;
      const vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
      if (vn < 0) { const J = -vn * 0.95; p.vx -= nx * J; p.vy -= ny * J; q.vx += nx * J; q.vy += ny * J; }
    }
    for (let j = 0; j < W.n; j++) {
      const q = W.P[j];
      if (j !== i && q.mode === 2 && Math.hypot(q.x - p.x, q.y - p.y) < SHIP_R + PILOT_R) killPilot(W, j, i, "squash");
    }
  }
}

// ---------- shooting, power-ups ----------
function fire(W, i, p) {
  const hx = Math.cos(p.a), hy = Math.sin(p.a), nx = p.x + hx * 6, ny = p.y + hy * 6;
  if (p.pw === PW_LANCE) { if (p.charge < 0) p.charge = 0; return; }            // it charges, then the beam
  if (p.pw === PW_MINE) {
    if (W.M.length >= MAX_MINES) { const m = W.M.shift(); emit(W, EV.fizzle, -1, 1, m.x, m.y); }
    W.M.push({ id: ++W.uid % 1000, o: i, x: p.x - hx * 7, y: p.y - hy * 7, t: 0 });
    if (!--p.ch) p.pw = -1;
    return;
  }
  if (p.pw === PW_CRYO) { shot(W, i, p, nx, ny, p.a, 1); if (!--p.ch) p.pw = -1; return; }
  if (p.ammo < 1 || p.cd > 0) return;
  p.ammo--; p.cd = COOL;
  if (p.pw === PW_FAN) { for (const s of [-0.24, 0, 0.24]) shot(W, i, p, nx, ny, p.a + s, 0); if (!--p.ch) p.pw = -1; }
  else shot(W, i, p, nx, ny, p.a, 0);
  p.vx -= hx * RECOIL; p.vy -= hy * RECOIL;
}
function shot(W, i, p, x, y, a, kind) {
  if (W.B.length >= MAX_SHOTS) W.B.shift();
  const v = kind ? SHOT_V * 0.72 : SHOT_V, rico = p.rico > 0 && !kind;
  W.B.push({ id: (W.nid = W.nid % 999 + 1), o: i, x, y, vx: Math.cos(a) * v + p.vx * 0.25, vy: Math.sin(a) * v + p.vy * 0.25,
    life: rico ? RICO_LIFE : SHOT_LIFE, bn: rico ? 3 : 0, k: kind, age: 0, hb: 0, rico: rico ? 1 : 0 });
  W.stats.shots++; W.fired[i]++;
}
function breakTile(W, k) { if (W.tiles[k] === 2) { W.tiles[k] = 0; W.stats.breaks++; } }
function stepShots(W) {
  const F = W.F, well = ARENAS[W.arena].id === "well";
  for (const b of W.B) {
    b.age += TICK;
    if ((b.life -= TICK) <= 0) { b.dead = 1; continue; }
    if (well) pull(W, b, 2.2);
    const ox = b.x, oy = b.y;
    b.x += b.vx * TICK; b.y += b.vy * TICK;
    // the fence: through it is gone (bounce rounds bounce, while there is no sudden death)
    if (b.x < F[0] || b.x > F[2] || b.y < F[1] || b.y > F[3]) {
      if (b.bn > 0 && W.sd === 0) {
        if (b.x < F[0] || b.x > F[2]) b.vx = -b.vx;
        if (b.y < F[1] || b.y > F[3]) b.vy = -b.vy;
        b.x = clamp(b.x, F[0], F[2]); b.y = clamp(b.y, F[1], F[3]); b.bn--; b.hb = 1;
      } else { b.dead = 1; continue; }
    }
    const k = tileIdx(b.x, b.y);
    if (k >= 0 && W.tiles[k]) {
      if (W.tiles[k] === 2) { breakTile(W, k); b.dead = 1; continue; }
      if (b.bn > 0) {                                      // off a metal block: back the way it came on the side it crossed
        const kx = tileIdx(b.x, oy), ky = tileIdx(ox, b.y), sx = kx >= 0 && W.tiles[kx], sy = ky >= 0 && W.tiles[ky];
        if (sx || !sy) b.vx = -b.vx;
        if (sy || !sx) b.vy = -b.vy;
        b.x = ox; b.y = oy; b.bn--; b.hb = 1;
      } else { b.dead = 1; continue; }
    }
    const n = partNormal(W, b.x, b.y, SHOT_R);
    if (n) {
      if (b.bn > 0) { const vn = b.vx * n[0] + b.vy * n[1]; if (vn < 0) { b.vx -= 2 * vn * n[0]; b.vy -= 2 * vn * n[1]; } b.x = ox; b.y = oy; b.bn--; b.hb = 1; }
      else { b.dead = 1; continue; }
    }
    if (well && Math.hypot(b.x - MX, b.y - MY) < HOLE_R + 1) { b.dead = 1; continue; }
  }
  // hits: rockets, pilots, mines (your own shot can hit you only once it has bounced)
  for (const b of W.B) {
    if (b.dead) continue;
    for (let j = 0; j < W.n && !b.dead; j++) {
      const p = W.P[j]; if (!p.mode || (j === b.o && !b.hb)) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (p.mode === 1 && d < SHIP_R + SHOT_R) { b.dead = 1; if (b.k) freeze(W, j, b.o); else killShip(W, j, b.o, "shot"); }
      else if (p.mode === 2 && d < PILOT_R + SHOT_R + 0.5) { b.dead = 1; if (b.k) freeze(W, j, b.o); else killPilot(W, j, b.o, "shot"); }
    }
    for (const m of W.M) if (!b.dead && Math.hypot(m.x - b.x, m.y - b.y) < 4) { b.dead = 1; m.boom = 1; }
  }
  // two shots that meet cancel out
  for (let x = 0; x < W.B.length; x++) {
    const a = W.B[x]; if (a.dead) continue;
    for (let y = x + 1; y < W.B.length; y++) {
      const c = W.B[y];
      if (!c.dead && c.o !== a.o && Math.abs(c.x - a.x) < 3 && Math.abs(c.y - a.y) < 3) { a.dead = c.dead = 1; break; }
    }
  }
  W.B = W.B.filter(b => !b.dead);
}
function freeze(W, i, by) {
  const p = W.P[i];
  if (W.ph !== "fight" || p.inv > 0) return;
  if (p.shield > 0) { p.shield = 0; p.inv = 0.25; W.stats.pops++; emit(W, EV.pop, i, by, p.x, p.y); return; }
  p.frozen = FREEZE_T; p.charge = -1; W.stats.freezes++;
  emit(W, EV.freeze, i, by, p.x, p.y);
}
function killShip(W, i, by, how) {
  const p = W.P[i];
  if (p.mode !== 1 || W.ph !== "fight") return false;
  const hard = how === "hole" || how === "fence";                // no shield and no spawn shield saves you from these
  if (p.inv > 0 && !hard) return false;
  if (p.shield > 0 && !hard) { p.shield = 0; p.inv = 0.25; W.stats.pops++; emit(W, EV.pop, i, by, p.x, p.y); return false; }
  if (by >= 0 && by !== i) { W.kills[by]++; W.P[by].rk++; }
  if (how === "hole") { p.mode = 0; W.stats.holes++; emit(W, EV.hole, i, by, p.x, p.y); return true; }
  W.stats.booms++; if (how === "fence") W.stats.fenced++;
  emit(W, how === "fence" ? EV.fence : EV.boom, i, by, p.x, p.y);
  // the pilot is thrown out, tumbling (from the fence: back toward the middle)
  const ea = W.rng() * TAU;
  Object.assign(p, { mode: 2, vx: p.vx * 0.45 + Math.cos(ea) * 28, vy: p.vy * 0.45 + Math.sin(ea) * 28, inv: EJECT_INV, resp: 0, frozen: 0, charge: -1,
    pw: -1, ch: 0, rico: 0, shield: 0, puffCd: 0.2, puffT: 0 });
  if (how === "fence") {
    const F = W.F, a = Math.atan2(MY - p.y, MX - p.x);
    p.x = clamp(p.x, Math.min(MX, F[0] + 12), Math.max(MX, F[2] - 12)); p.y = clamp(p.y, Math.min(MY, F[1] + 12), Math.max(MY, F[3] - 12));
    p.vx = Math.cos(a) * 55; p.vy = Math.sin(a) * 55;
  }
  return true;
}
function killPilot(W, i, by, how) {
  const p = W.P[i];
  if (p.mode !== 2 || W.ph !== "fight") return false;
  if (p.inv > 0 && how !== "hole" && how !== "fence") return false;
  if (by >= 0 && by !== i) { W.kills[by]++; W.P[by].rk++; }
  p.mode = 0;
  if (how === "hole") W.stats.holes++; else if (how === "squash") W.stats.squashes++; else W.stats.splats++;
  emit(W, how === "hole" ? EV.hole : how === "squash" ? EV.squash : EV.splat, i, by, p.x, p.y);
  return true;
}
/// The ion lance: from the nose straight ahead to the first metal (crystal on the way breaks), deadly for
/// a moment along its whole length.
function lance(W, i, p) {
  const hx = Math.cos(p.a), hy = Math.sin(p.a), x0 = p.x + hx * 6, y0 = p.y + hy * 6, F = W.F, well = ARENAS[W.arena].id === "well";
  let x = x0, y = y0;
  for (let s = 0; s < 420; s++) {
    x += hx; y += hy;
    if (x < F[0] || x > F[2] || y < F[1] || y > F[3]) break;
    const k = tileIdx(x, y);
    if (k >= 0 && W.tiles[k] === 1) break;
    if (k >= 0 && W.tiles[k] === 2) breakTile(W, k);
    if (partNormal(W, x, y, 0.5) || well && Math.hypot(x - MX, y - MY) < HOLE_R) break;
  }
  W.L.push({ o: i, x0, y0, x1: x, y1: y, t: LANCE_T });
  p.vx -= hx * 40; p.vy -= hy * 40; p.pw = -1; p.ch = 0;
  W.stats.lances++;
  emit(W, EV.lance, i, 0, x0, y0);
}
function segDist(x, y, L) {
  const sx = L.x1 - L.x0, sy = L.y1 - L.y0, l2 = sx * sx + sy * sy || 1, t = clamp(((x - L.x0) * sx + (y - L.y0) * sy) / l2, 0, 1);
  return Math.hypot(x - L.x0 - sx * t, y - L.y0 - sy * t);
}
function stepLances(W) {
  for (const L of W.L) {
    L.t -= TICK;
    for (let j = 0; j < W.n; j++) {
      const p = W.P[j]; if (j === L.o || !p.mode) continue;
      const d = segDist(p.x, p.y, L);
      if (p.mode === 1 && d < LANCE_W + SHIP_R) killShip(W, j, L.o, "lance");
      else if (p.mode === 2 && d < LANCE_W + PILOT_R) killPilot(W, j, L.o, "lance");
    }
    for (const m of W.M) if (segDist(m.x, m.y, L) < LANCE_W + 2) m.boom = 1;
  }
  W.L = W.L.filter(L => L.t > 0);
}
function stepMines(W) {
  for (const m of W.M) {
    m.t += TICK;
    if (m.t > MINE_LIFE) { m.dead = 1; emit(W, EV.fizzle, -1, 1, m.x, m.y); continue; }
    if (m.t >= MINE_ARM && !m.boom) for (const p of W.P) if (p.mode && Math.hypot(p.x - m.x, p.y - m.y) < MINE_TRIG) { m.boom = 1; break; }
  }
  for (const m of W.M) if (m.boom && !m.dead) blast(W, m);
  W.M = W.M.filter(m => !m.dead);
}
function blast(W, m) {
  m.dead = 1; W.stats.blasts++;
  emit(W, EV.mine, m.o, 0, m.x, m.y);
  for (let i = 0; i < W.n; i++) {
    const p = W.P[i], d = Math.hypot(p.x - m.x, p.y - m.y);
    if (p.mode === 1 && d < MINE_BLAST + SHIP_R) killShip(W, i, m.o, "mine");
    else if (p.mode === 2 && d < MINE_BLAST + PILOT_R) killPilot(W, i, m.o, "mine");
  }
  for (const k of ARENAS[W.arena].crystals) {
    const x = AX0 + (k % COLS) * TS + TS / 2, y = AY0 + Math.floor(k / COLS) * TS + TS / 2;
    if (Math.hypot(x - m.x, y - m.y) < MINE_BLAST + 2) breakTile(W, k);
  }
  for (const o of W.M) if (!o.dead && Math.hypot(o.x - m.x, o.y - m.y) < MINE_BLAST) o.boom = 1;   // a chain
}
function stepPowerups(W) {
  if (W.ph === "fight" && (W.puIn -= TICK) <= 0) {
    if (W.U.length < PU_MAX) {
      const s = puSpot(W);
      if (s) { const type = Math.floor(W.rng() * POWERS.length); W.U.push({ id: ++W.uid % 1000, type, x: s[0], y: s[1], life: PU_LIFE }); W.stats.spawned++; }
    }
    W.puIn = PU_EVERY + W.rng() * 3;
  }
  const F = W.F;
  for (const u of W.U) {
    if ((u.life -= TICK) <= 0 || u.x < F[0] + 2 || u.x > F[2] - 2 || u.y < F[1] + 2 || u.y > F[3] - 2) {
      u.dead = 1; W.stats.fizzles++; emit(W, EV.fizzle, u.type, 0, u.x, u.y); continue;
    }
    for (let i = 0; i < W.n; i++) {
      const p = W.P[i];
      if (p.mode === 1 && Math.hypot(p.x - u.x, p.y - u.y) < SHIP_R + PU_R) { take(p, u.type); u.dead = 1; W.stats.picks++; W.stats.types[u.type] = (W.stats.types[u.type] || 0) + 1; emit(W, EV.pick, i, u.type, u.x, u.y); break; }
    }
  }
  W.U = W.U.filter(u => !u.dead);
}
function take(p, type) {
  if (type === PW_SHIELD) p.shield = SHIELD_T;
  else if (type === PW_BOUNCE) p.rico = RICO_T;
  else { p.pw = type; p.ch = POWERS[type].n; p.charge = -1; }
}
/// Somewhere open for a capsule: off the blocks and the arena's parts, away from everyone.
function puSpot(W) {
  const F = W.F, id = ARENAS[W.arena].id;
  for (let n = 0; n < 40; n++) {
    const x = F[0] + 14 + W.rng() * (F[2] - F[0] - 28), y = F[1] + 14 + W.rng() * (F[3] - F[1] - 28);
    if (!(F[2] - F[0] > 30 && F[3] - F[1] > 30)) return null;
    let ok = true;
    for (const [dx, dy] of [[0, 0], [-8, -8], [8, -8], [-8, 8], [8, 8]]) { const k = tileIdx(x + dx, y + dy); if (k >= 0 && W.tiles[k]) ok = false; }
    if (id === "well" && (Math.hypot(x - MX, y - MY) < 40 || W.R.some(k => Math.hypot(x - k.x, y - k.y) < k.r + 10))) ok = false;
    if (id === "rotor" && (Math.hypot(x - MX, y - MY) < ARM_L + 10 || PIST.some(px => Math.abs(x - px) < 16))) ok = false;
    if (W.P.some(p => p.mode && Math.hypot(p.x - x, p.y - y) < 30) || W.U.some(u => Math.hypot(u.x - x, u.y - y) < 40)) ok = false;
    if (ok) return [x, y];
  }
  return null;
}
/// Gravewell's rocks drift, bouncing off the walls, blocks, each other and the black hole's rim.
function stepRocks(W) {
  for (const k of W.R) {
    k.x += k.vx * TICK; k.y += k.vy * TICK;
    if (k.x - k.r < AX0) { k.x = AX0 + k.r; k.vx = Math.abs(k.vx); } else if (k.x + k.r > AX1) { k.x = AX1 - k.r; k.vx = -Math.abs(k.vx); }
    if (k.y - k.r < AY0) { k.y = AY0 + k.r; k.vy = Math.abs(k.vy); } else if (k.y + k.r > AY1) { k.y = AY1 - k.r; k.vy = -Math.abs(k.vy); }
    const c0 = Math.floor((k.x - k.r - AX0) / TS), c1 = Math.floor((k.x + k.r - AX0) / TS), r0 = Math.floor((k.y - k.r - AY0) / TS), r1 = Math.floor((k.y + k.r - AY0) / TS);
    for (let rr = Math.max(0, r0); rr <= Math.min(ROWS - 1, r1); rr++) for (let cc = Math.max(0, c0); cc <= Math.min(COLS - 1, c1); cc++)
      if (W.tiles[rr * COLS + cc]) circleBox(k, k.r, AX0 + cc * TS, AY0 + rr * TS, TS, TS, 0, 0, 1);
    const dx = k.x - MX, dy = k.y - MY, d = Math.hypot(dx, dy) || 1, rim = 26 + k.r;
    if (d < rim) { const nx = dx / d, ny = dy / d, vn = k.vx * nx + k.vy * ny; k.x = MX + nx * rim; k.y = MY + ny * rim; if (vn < 0) { k.vx -= 2 * vn * nx; k.vy -= 2 * vn * ny; } }
  }
  for (let a = 0; a < W.R.length; a++) for (let b = a + 1; b < W.R.length; b++) {
    const p = W.R[a], q = W.R[b], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1, m = p.r + q.r;
    if (d >= m) continue;
    const nx = dx / d, ny = dy / d, vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
    p.x -= nx * (m - d) / 2; p.y -= ny * (m - d) / 2; q.x += nx * (m - d) / 2; q.y += ny * (m - d) / 2;
    if (vn < 0) { p.vx += vn * nx; p.vy += vn * ny; q.vx -= vn * nx; q.vy -= vn * ny; }
  }
}
/// Sudden death: the fence closes in. A rocket it touches blows up, a pilot it touches is out; crystal outside it shatters.
function squeeze(W) {
  const F = W.F;
  for (let i = 0; i < W.n; i++) {
    const p = W.P[i], r = p.mode === 1 ? SHIP_R : PILOT_R;
    if (!p.mode || !(p.x - r <= F[0] + 0.5 || p.x + r >= F[2] - 0.5 || p.y - r <= F[1] + 0.5 || p.y + r >= F[3] - 0.5)) continue;
    if (p.mode === 1) killShip(W, i, -1, "fence"); else killPilot(W, i, -1, "fence");
  }
  for (const k of ARENAS[W.arena].crystals) {
    if (!W.tiles[k]) continue;
    const x = AX0 + (k % COLS) * TS, y = AY0 + Math.floor(k / COLS) * TS;
    if (x < F[0] || y < F[1] || x + TS > F[2] || y + TS > F[3]) breakTile(W, k);
  }
  W.M = W.M.filter(m => m.x > F[0] && m.x < F[2] && m.y > F[1] && m.y < F[3]);
}

// ---------- bots (on the opener's Mac) ----------
// A bot looks again every so often (botThink): it picks a target (the nearest enemy, pilots first) and a
// course: at where the target will be, at a capsule on the way, or away from a wall, a shot coming, the
// black hole or the closing fence. Every step in between it turns toward that course, and fires the
// moment its nose sweeps across where the target will be: turning one way only, you cannot wait for a
// perfect line, you shoot as you swing past.
const newBot = d => ({ d, think: 0, want: null, spin: 0, spinDir: 0, err: 0, fire: 0, tgt: -1, ok: 0, cool: 0 });
function botStep(W, i, B) {
  const p = W.P[i], I = W.inp[i];
  if ((W.ph !== "fight" && W.ph !== "end") || !p.mode) { I.t = 0; return; }
  const D = DIFFS[B.d];
  B.cool = (B.cool || 0) - TICK;
  if ((B.think -= TICK) <= 0) { B.think = D.react * (0.7 + 0.6 * W.rng()); botThink(W, i, B, D); }
  if (B.fire) { I.fp = 1; B.fire = 0; }
  else if (p.mode === 1 && B.tgt >= 0 && B.ok && B.cool <= 0 && !p.frozen && aimed(W, p, B, D)) { I.fp = 1; B.cool = D.gap * (0.8 + 0.4 * W.rng()); }
  if (B.spin > 0) { B.spin -= TICK; I.t = B.spinDir; return; }
  if (B.want === null || p.frozen > 0) { I.t = 0; return; }
  const tol = p.mode === 2 ? 0.3 : 0.06;
  // one way: a course just clockwise of the nose is waited for, not looped round to (a wide wait when the target is far)
  if (W.cfg.turn === 1) { const ccw = wrapA(p.a - B.want); I.t = ccw > tol && ccw < TAU - (p.mode === 2 ? 0.3 : B.far ? 0.7 : 0.12) ? -1 : 0; }
  else { const d = angDiff(B.want, p.a); I.t = Math.abs(d) > tol ? Math.sign(d) : 0; }
}
/// Where to shoot to hit q: ahead of a moving rocket by the shot's flight time (as much as the level leads).
function lead(p, q, D) {
  let tx = q.x, ty = q.y;
  if (q.mode === 1) for (let k = 0; k < 2; k++) { const tt = Math.hypot(tx - p.x, ty - p.y) / SHOT_V; tx = q.x + q.vx * tt * D.lead; ty = q.y + q.vy * tt * D.lead; }
  return [tx, ty];
}
/// The nose is on the target now (closer counts as wider), with a shot to spare.
function aimed(W, p, B, D) {
  const q = W.P[B.tgt]; if (!q.mode) return false;
  const [tx, ty] = lead(p, q, D), d = Math.hypot(tx - p.x, ty - p.y), off = Math.abs(angDiff(p.a, Math.atan2(ty - p.y, tx - p.x) + B.err));
  if (p.pw === PW_LANCE) return off < 0.05 + D.aim * 0.15 && d < 260;
  if (p.pw === PW_MINE || d > D.range) return false;
  if (p.pw !== PW_CRYO && (p.ammo < 1 || D.keep && d > 90 && p.ammo < 2)) return false;
  return off < Math.max(D.aim, Math.atan2(SHIP_R + 1, d));
}
/// How far a straight look goes before the fence, a block (not crystal, for a shot: it breaks), a part
/// or the black hole.
function rayFree(W, x, y, a, max, shot) {
  const dx = Math.cos(a), dy = Math.sin(a), F = W.F, well = ARENAS[W.arena].id === "well", hole = shot ? HOLE_R + 2 : HOLE_R + 18;
  for (let d = 3; d < max; d += 3) {
    const px = x + dx * d, py = y + dy * d;
    if (px < F[0] + 3 || px > F[2] - 3 || py < F[1] + 3 || py > F[3] - 3) return d;
    const k = tileIdx(px, py); if (k >= 0 && W.tiles[k] && !(shot && W.tiles[k] === 2)) return d;
    if (partNormal(W, px, py, shot ? 1 : 3, shot) || well && Math.hypot(px - MX, py - MY) < hole) return d;
  }
  return max;
}
/// The most open way, among those quick to turn to.
function bestOpen(W, p) {
  const one = W.cfg.turn === 1;
  let best = p.a, bs = -1e9;
  for (let k = 0; k < 16; k++) {
    const a = wrapA(p.a + k / 16 * TAU), cost = one ? wrapA(p.a - a) : Math.abs(angDiff(a, p.a)), s = rayFree(W, p.x, p.y, a, 80) - cost * 9;
    if (s > bs) { bs = s; best = a; }
  }
  return best;
}
function botThink(W, i, B, D) {
  const p = W.P[i], well = ARENAS[W.arena].id === "well", F = W.F, hd = well ? Math.hypot(p.x - MX, p.y - MY) : 1e9, out = Math.atan2(p.y - MY, p.x - MX);
  const nearFence = W.sd > 0 && (p.x - F[0] < 22 || F[2] - p.x < 22 || p.y - F[1] < 22 || F[3] - p.y < 22);
  B.fire = 0; B.tgt = -1; B.ok = 0; B.far = 0;
  if (p.mode === 2) {
    // on foot: away from the nearest enemy rocket (and walls, the black hole, the fence), a puff when facing that way
    let fl = null, fd = 1e9;
    for (let j = 0; j < W.n; j++) { const q = W.P[j]; if (j !== i && q.mode === 1) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < fd) { fd = d; fl = q; } } }
    let want = fl ? Math.atan2(p.y - fl.y, p.x - fl.x) : B.want === null ? p.a : B.want;
    if (nearFence) want = Math.atan2(MY - p.y, MX - p.x);
    else if (hd < 70) want = out;
    else if (rayFree(W, p.x, p.y, want, 26) < 26) want = bestOpen(W, p);
    B.want = want;
    B.fire = Math.abs(angDiff(p.a, want)) < 0.5 && (fd < 90 || hd < 70 || nearFence) && W.rng() < 0.8 ? 1 : 0;
    return;
  }
  // the target: the nearest enemy, pilots first (easy points), frozen rockets next
  let best = -1, bc = 1e9;
  for (let j = 0; j < W.n; j++) {
    const q = W.P[j]; if (j === i || !q.mode) continue;
    const c = Math.hypot(q.x - p.x, q.y - p.y) * (q.mode === 2 ? 0.55 : 1) * (q.frozen > 0 ? 0.7 : 1);
    if (c < bc) { bc = c; best = j; }
  }
  if (best >= 0) {
    const q = W.P[best], d = Math.hypot(q.x - p.x, q.y - p.y);
    if (W.rng() < 0.5) B.err = (W.rng() - 0.5) * 2 * D.err;
    const [tx, ty] = lead(p, q, D), aim = Math.atan2(ty - p.y, tx - p.x);
    B.tgt = best; B.want = aim + B.err; B.far = d > D.range;
    B.ok = d < D.range + 20 && rayFree(W, p.x, p.y, aim, d, true) >= d - 6 && W.rng() < D.fire ? 1 : 0;
    if (p.pw === PW_MINE) {
      // a mine behind you, where someone is following
      for (let j = 0; j < W.n; j++) { const o = W.P[j]; if (j !== i && o.mode === 1 && Math.hypot(o.x - p.x, o.y - p.y) < 60 && Math.abs(angDiff(Math.atan2(o.y - p.y, o.x - p.x), p.a)) > 2.2) B.fire = 1; }
      if (W.rng() < 0.04) B.fire = 1;
    }
  } else B.want = bestOpen(W, p);
  // a capsule on the way, while holding no power
  if (p.pw < 0) for (const u of W.U) {
    const d = Math.hypot(u.x - p.x, u.y - p.y);
    if (d * 0.75 < bc && d < 110) { B.want = Math.atan2(u.y - p.y, u.x - p.x); break; }
  }
  // course corrections, the most urgent last: a shot coming, about to hit something, the black hole, the fence
  if (D.dodge && W.rng() < D.dodge) for (const b of W.B) {
    if (b.o === i && !b.hb) continue;
    const rx = b.x - p.x, ry = b.y - p.y, vx = b.vx - p.vx, vy = b.vy - p.vy, v2 = vx * vx + vy * vy, tc = -(rx * vx + ry * vy) / (v2 || 1);
    if (tc > 0 && tc < 0.5 && Math.hypot(rx + vx * tc, ry + vy * tc) < SHIP_R + 2.5) {
      B.spin = 0.12 + W.rng() * 0.1; B.spinDir = W.cfg.turn === 1 ? (W.inp[i].t ? 0 : -1) : (W.rng() < 0.5 ? -1 : 1);
      break;
    }
  }
  const look = 12 + SPEED * 0.4;
  if (rayFree(W, p.x, p.y, p.a, look) < look && W.rng() < D.avoid) B.want = bestOpen(W, p);
  if (hd < 62 && W.rng() < D.hole) B.want = hd < 34 ? out : out + (angDiff(p.a, out) > 0 ? 1.0 : -1.0);
  if (nearFence) B.want = Math.atan2(MY - p.y, MX - p.x);
}

// ---------- the room: the state in whole numbers ----------
/// The match as a message: positions in tenths of a pixel (shots and capsules in whole pixels), angles in
/// hundredths of a radian, times in tenths of a second, the host's clock in ms. The crystals still
/// standing are bits, 30 to a number.
function pack(W, h) {
  const p = [];
  for (const q of W.P) {
    if (!q.mode) { p.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0); continue; }
    const fx = (q.shield > 0 ? 1 : 0) | (q.frozen > 0 ? 2 : 0) | (q.turn ? 4 : 0) | (q.charge >= 0 ? 8 : 0) | (q.inv > 0 ? 16 : 0) | (q.rico > 0 ? 32 : 0) | (q.puffT > 0 ? 64 : 0);
    p.push(q.mode, i10(q.x), i10(q.y), Math.round(wrapA(q.a) * 100) % 629, Math.round(q.vx), Math.round(q.vy), q.ammo * 10 + Math.min(9, Math.floor(q.rel / RELOAD * 10)),
      q.pw + 1 + q.ch * 8, fx, i10(q.mode === 2 ? q.resp : Math.max(q.shield, q.frozen)));
  }
  const b = [];
  for (const s of W.B.slice(-SEND_SHOTS)) b.push(s.id, Math.round(s.x), Math.round(s.y), s.o + 8 * s.k + 16 * s.rico);
  const u = [], m = [], l = [], o = [], bk = [];
  for (const x of W.U) u.push(x.id, x.type, Math.round(x.x), Math.round(x.y), i10(x.life));
  for (const x of W.M) m.push(x.id, Math.round(x.x), Math.round(x.y), x.o + (x.t >= MINE_ARM ? 8 : 0));
  for (const x of W.L) l.push(x.o, Math.round(x.x0), Math.round(x.y0), Math.round(x.x1), Math.round(x.y1), Math.round(x.t * 100));
  for (const x of W.R) o.push(i10(x.x), i10(x.y));
  const cr = ARENAS[W.arena].crystals;
  for (let j = 0; j < cr.length; j++) { if (j % 30 === 0) bk.push(0); if (W.tiles[cr[j]]) bk[bk.length - 1] |= 1 << (j % 30); }
  const e = W.events.filter(x => W.time - x.t < 0.6).slice(-8).map(x => x.e.slice());
  return { g: ID, k: "st", id: RB.id, h: Math.round(h), r: W.round, a: W.arena, ph: PH.indexOf(W.ph), pt: i10(W.phT), rt: Math.round(W.rt * 100), sd: Math.round(W.sd * 1000),
    s: W.score.slice(), kl: W.kills.slice(), w: W.winner, cw: W.champ, p, b, u, m, l, o, bk, e };
}
/// A state message back into a picture of the match (anything odd in it is clamped).
function unpack(d) {
  const A = v => Array.isArray(v) ? v.map(num) : [], p = A(d.p), n = Math.min(MAX_P, Math.floor(p.length / 10));
  const X = v => clamp(v, -10, GW + 10), Y = v => clamp(v, -10, GH + 10), ar = clamp(num(d.a) | 0, 0, ARENAS.length - 1), cr = ARENAS[ar].crystals, bk = A(d.bk);
  const V = { h: num(d.h), round: num(d.r) | 0, arena: ar, ph: PH[num(d.ph)] || "fight", phT: clamp(num(d.pt) / 10, 0, 999), rt: Math.max(0, num(d.rt) / 100), sd: clamp(num(d.sd) / 1000, 0, 1),
    score: A(d.s).slice(0, MAX_P), kills: A(d.kl).slice(0, MAX_P), winner: num(d.w) | 0, champ: d.cw === undefined ? -1 : num(d.cw) | 0, P: [], B: [], U: [], M: [], L: [], R: [],
    mask: new Uint8Array(cr.length), events: Array.isArray(d.e) ? d.e.filter(Array.isArray).map(e => e.map(num)) : [] };
  for (let i = 0; i < n; i++) {
    const o = i * 10, fx = p[o + 8] | 0, pw = p[o + 7] | 0;
    V.P.push({ mode: clamp(p[o] | 0, 0, 2), x: X(p[o + 1] / 10), y: Y(p[o + 2] / 10), a: p[o + 3] / 100, vx: clamp(p[o + 4], -300, 300), vy: clamp(p[o + 5], -300, 300),
      ammo: clamp(Math.floor(p[o + 6] / 10), 0, AMMO), rel: clamp(p[o + 6] % 10, 0, 9) / 10, pw: clamp((pw & 7) - 1, -1, POWERS.length - 1), ch: pw >> 3,
      shield: fx & 1, frozen: fx & 2, turn: fx & 4, charge: fx & 8, inv: fx & 16, rico: fx & 32, puff: fx & 64, tm: clamp(p[o + 9] / 10, 0, 99) });
  }
  const b = A(d.b), u = A(d.u), m = A(d.m), l = A(d.l), r = A(d.o);
  for (let k = 0; k + 3 < b.length; k += 4) V.B.push({ id: b[k], x: X(b[k + 1]), y: Y(b[k + 2]), o: b[k + 3] & 7, k: (b[k + 3] >> 3) & 1, rico: (b[k + 3] >> 4) & 1 });
  for (let k = 0; k + 4 < u.length; k += 5) V.U.push({ id: u[k], type: clamp(u[k + 1] | 0, 0, POWERS.length - 1), x: X(u[k + 2]), y: Y(u[k + 3]), life: u[k + 4] / 10 });
  for (let k = 0; k + 3 < m.length; k += 4) V.M.push({ id: m[k], x: X(m[k + 1]), y: Y(m[k + 2]), o: m[k + 3] & 7, armed: (m[k + 3] >> 3) & 1 });
  for (let k = 0; k + 5 < l.length; k += 6) V.L.push({ o: l[k], x0: X(l[k + 1]), y0: Y(l[k + 2]), x1: X(l[k + 3]), y1: Y(l[k + 4]), t: l[k + 5] / 100 });
  for (let k = 0; k + 1 < r.length && V.R.length < ROCKS.length; k += 2) V.R.push({ x: X(r[k] / 10), y: Y(r[k + 1] / 10), r: ROCKS[V.R.length].r });
  for (let j = 0; j < cr.length; j++) V.mask[j] = (bk[Math.floor(j / 30)] >> (j % 30)) & 1;
  return V;
}
/// What this Mac shows of its own match: the same picture the others get.
const viewOf = W => { const V = unpack(pack(W, 0)); V.events = []; return V; };
/// Between two pictures: rockets, pilots, shots and capsules slide (a jump of 40 px, a new round, is not slid).
function between(a, c, k) {
  if (a.round !== c.round) return c;
  const L = (x, y) => Math.abs(y - x) > 40 ? y : x + (y - x) * k;
  const LA = (x, y) => x + angDiff(y, x) * k;
  const byId = list => new Map(list.map(o => [o.id, o]));
  const ab = byId(a.B), au = byId(a.U);
  return Object.assign({}, c, {
    phT: a.ph === c.ph ? L(a.phT, c.phT) : c.phT, rt: c.rt >= a.rt ? a.rt + (c.rt - a.rt) * k : c.rt,
    P: c.P.map((q, i) => { const o = a.P[i]; return o && o.mode === q.mode && q.mode ? Object.assign({}, q, { x: L(o.x, q.x), y: L(o.y, q.y), a: LA(o.a, q.a) }) : q; }),
    B: c.B.map(s => { const o = ab.get(s.id); return o ? Object.assign({}, s, { x: L(o.x, s.x), y: L(o.y, s.y) }) : s; }),
    U: c.U.map(s => { const o = au.get(s.id); return o ? Object.assign({}, s, { life: L(o.life, s.life) }) : s; }),
    R: c.R.map((s, i) => a.R[i] ? Object.assign({}, s, { x: L(a.R[i].x, s.x), y: L(a.R[i].y, s.y) }) : s) });
}
/// A little past the newest picture, on its speeds (when the next one is late).
function ahead(s, dt) {
  if (dt <= 0 || s.ph !== "fight") return s;
  return Object.assign({}, s, { rt: s.rt + dt, P: s.P.map(p => p.mode ? Object.assign({}, p, { x: clamp(p.x + p.vx * dt, AX0, AX1), y: clamp(p.y + p.vy * dt, AY0, AY1) }) : p) });
}

// ---------- who plays: this Mac's side ----------
// phase: pick → lobby → match → done. players: the match's, in a fixed order (an index names a player in
// every message, and gives its colour); b: a bot (run by the opener); c: a couch seat at the opener's keyboard.
const RB = { phase: "pick", id: "", owner: "", ownerName: "", players: [], set: loadSet(), mset: null, lobbies: {}, w: null, demo: null, view: null,
  snaps: [], off: null, evSeen: 0, heard: 0, sent: 0, pinged: 0, dirty: 0, lobbySent: 0, held: new Set(), cnt: { f: 0, t: 0, td: -1 }, seen: {}, from: {},
  t0: 0, result: "", sideKey: "", escAt: 0, ended: false, doneAt: 0 };
function loadSet() {
  const s = store("rocketbrawlSet", {}) || {};
  return { ar: clamp(num(s.ar) | 0, -1, ARENAS.length - 1), df: clamp(s.df === undefined ? 1 : num(s.df) | 0, 0, 2), wn: WINS.includes(+s.wn) ? +s.wn : 5, tn: +s.tn === 2 ? 2 : 1 };
}
const amHost = () => !!RB.id && RB.owner === myId();
const myIdx = () => RB.players.findIndex(p => p.id === myId());
const isDemo = () => RB.phase === "pick" || RB.phase === "lobby";
/// The world this Mac runs and shows (a teammate's Mac runs none: it draws the opener's pictures).
function shownWorld() { return isDemo() ? RB.demo : amHost() ? RB.w : null; }
const DEMO_NAMES = ["VEGA", "PIP", "NOVA", "JUNO"];
const nameOf = i => isDemo() ? DEMO_NAMES[i] || "BOT" : RB.players[i] ? RB.players[i].name : "?";
const colorOf2 = i => COLORS[i % COLORS.length];
const remotes = () => RB.players.some(p => !p.b && !p.c && p.id !== myId());

// ---------- the lobby ----------
const lobbyMsg = k => ({ g: ID, k, id: RB.id, ar: RB.set.ar, df: RB.set.df, wn: RB.set.wn, tn: RB.set.tn,
  players: RB.players.map(p => ({ id: p.id, name: p.name, b: p.b ? 1 : 0, c: p.c || 0 })) });
function sendLobby(k) {
  if (k === "open" || Date.now() / 1000 - RB.lobbySent > 0.25) { if (inRoom()) gsend(lobbyMsg(k || "lobby")); RB.lobbySent = RB.pinged = Date.now() / 1000; RB.dirty = 0; }
  else RB.dirty = 1;                                        // sent from the next frames (a burst of clicks is one message)
  side();
}
function openMatch() {
  Object.assign(RB, { phase: "lobby", id: Math.floor(Math.random() * 36 ** 6).toString(36), owner: myId(), ownerName: myName(), players: [{ id: myId(), name: myName(), b: 0, c: 0 }] });
  addBot(); if (!inRoom()) { addBot(); addBot(); }           // alone: three to fight; in a room: one, until teammates join
  sendLobby("open");
}
function joinMatch(id) {
  const l = RB.lobbies[id]; if (!l) return;
  leaveCurrent();
  if (!GAME.open) openGames("home");
  Object.assign(RB, { phase: "lobby", id: l.id, owner: l.owner, ownerName: l.ownerName, players: l.players.slice(), set: Object.assign({}, l.set) });
  gsend({ g: ID, k: "join", id });
  gshow(ID);
}
function addBot() {
  if (RB.players.length >= MAX_P) return;
  const used = new Set(RB.players.map(p => p.name));
  RB.players.push({ id: "bot-" + Math.random().toString(36).slice(2, 8), name: BOT_NAMES.find(n => !used.has(n)) || "Bot", b: 1, c: 0 });
}
function removeBot() { const i = RB.players.map(p => !!p.b).lastIndexOf(true); if (i >= 0) RB.players.splice(i, 1); }
function addCouch() {
  if (RB.players.length >= MAX_P) return;
  const used = new Set(RB.players.map(p => p.c)), c = [1, 2, 3].find(s => !used.has(s)); if (!c) return;
  RB.players.push({ id: myId() + "~" + c, name: `Couch ${c + 1}`, b: 0, c });
}
function removeCouch() { const i = RB.players.map(p => !!p.c).lastIndexOf(true); if (i >= 0) RB.players.splice(i, 1); }
function leaveMatch() {
  if (!RB.id) return;
  if (RB.phase === "lobby") gsend({ g: ID, k: amHost() ? "close" : "leave", id: RB.id });
  if (RB.phase === "match") gsend({ g: ID, k: "quit", id: RB.id });
  Object.assign(RB, { phase: "pick", id: "", owner: "", w: null, view: null, snaps: [], set: loadSet() });
  resetFX();
}
function startMatch() {
  if (!amHost() || RB.phase !== "lobby" || RB.players.length < 2) return;
  const seed = newSeed();
  if (inRoom()) gsend(Object.assign(lobbyMsg("start"), { seed }));
  beginMatch(seed);
}
function beginMatch(seed) {
  const S = RB.set, now = Date.now() / 1000;
  Object.assign(RB, { phase: "match", mset: Object.assign({}, S), snaps: [], off: null, evSeen: 0, heard: now, sent: 0, ended: false, result: "", t0: Date.now(),
    seen: {}, from: {}, view: null, cnt: { f: 0, t: 0, td: -1 }, roundKills: 0 });
  resetFX();
  if (amHost()) {
    RB.w = newWorld({ seed, n: RB.players.length, arena: S.ar, win: S.wn, turn: S.tn, bots: RB.players.map(p => p.b ? S.df : -1) });
    for (const p of RB.players) if (!p.b && !p.c && p.id !== myId()) RB.from[p.id] = now;
    for (const x of RB.w.events) onEvent(x.e);
    RB.view = viewOf(RB.w);
  } else RB.w = null;
  side();
}
/// A teammate left or went quiet: their rocket or pilot warps away; they are out of the rounds to come.
function dropPlayer(i, why) {
  const W = RB.w; if (!W || W.q[i]) return;
  W.q[i] = 1;
  const p = W.P[i];
  if (p.mode) { emit(W, EV.gone, i, 0, p.x, p.y); p.mode = 0; }
  toast(`🚀 ${esc(RB.players[i].name)} ${why}`, null, 3000);
}
/// The match is over on this Mac: the result, the record, the achievements.
function finish(why) {
  if (RB.phase !== "match") return;
  RB.phase = "done"; RB.doneAt = Date.now() / 1000;
  const V = RB.view, me = myIdx(), champ = V ? V.champ : -1;
  const won = !why && champ === me && me >= 0;
  RB.result = why || (won ? "You won the match!" : champ >= 0 && RB.players[champ] ? `${RB.players[champ].name} won the match` : "Match over");
  const rec = record();
  rec.played++; if (won) rec.won++;
  if (V && me >= 0) rec.kills += V.kills[me] || 0;
  keep("rocketbrawl", rec);
  if (won) {
    achieve("rocketbrawl-win");
    const bots = RB.players.filter(p => p.b);
    if (bots.length >= 3 && RB.mset && RB.mset.df === 2) achieve("rocketbrawl-hard");
  }
  toast(won ? `🚀 You won the match!` : `🚀 ${esc(RB.result)}`, null, 5000);
  RB.id = "";
  side();
}
function record() {
  const r = store("rocketbrawl", null) || {};
  return { played: num(r.played), won: num(r.won), kills: num(r.kills) };
}

// ---------- each frame ----------
function rbStep(dt) {
  const now = Date.now() / 1000;
  stepFX(dt);
  if (isDemo()) {
    // behind the title and the lobby: four bots fight on every arena in turn
    if (!RB.demo || RB.demo.round > 6 || RB.demo.ph === "over") RB.demo = newWorld({ seed: newSeed(), n: 4, arena: -1, win: 99, turn: 1, bots: [1, 2, 1, 2] });
    runWorld(RB.demo, dt);
    RB.view = viewOf(RB.demo);
    if (RB.phase === "lobby") {
      if (amHost() && inRoom() && (RB.dirty && now - RB.lobbySent > 0.25 || now - RB.pinged > LOBBY_PING)) sendLobby();
      ginfo.textContent = `${RB.players.length} in the lobby · ${RB.set.ar < 0 ? "all three arenas" : ARENAS[RB.set.ar].name} · first to ${RB.set.wn}`;
    } else ginfo.textContent = "2 to 6 rockets · open a match or play bots (on the right)";
  } else if (RB.phase === "match") {
    if (amHost()) {
      const W = RB.w;
      hostKeys(W);
      runWorld(W, dt);
      RB.players.forEach((p, i) => { if (!p.b && !p.c && p.id !== myId() && !W.q[i] && now - (RB.from[p.id] || RB.heard) > GONE) dropPlayer(i, "went quiet"); });
      if (inRoom() && remotes() && now - RB.sent >= SEND) { RB.sent = now; gsend(pack(W, Date.now() - RB.t0)); }
      RB.view = viewOf(W);
      if (W.ph === "over" && !RB.ended && W.phT > 0.2) {
        RB.ended = true;
        if (inRoom() && remotes()) gsend({ g: ID, k: "end", id: RB.id, s: W.score.slice(), kl: W.kills.slice(), w: W.champ });
        finish();
      }
    } else {
      if (now - RB.sent >= SEND) sendKeys(now);
      RB.view = guestView() || RB.view;
      // the opener's end message got lost: the pictures say it is over
      if (RB.view && RB.view.ph === "over" && (RB.view.phT > 2.5 || now - RB.heard > 1.5)) finish();
      else if (now - RB.heard > GONE) finish(`${RB.ownerName} went quiet: the match is over`);
    }
  } else if (RB.phase === "done" && RB.w) runWorld(RB.w, dt);
  if (RB.view) observe(RB.view, dt);
  if (RB.phase === "match" || RB.phase === "done") {
    const V = RB.view, me = myIdx();
    if (V) ginfo.textContent = `${ARENAS[V.arena].name} · round ${V.round} · first to ${(RB.mset || RB.set).wn}` + (me >= 0 ? ` · you: ${V.score[me] || 0} rounds, ${V.kills[me] || 0} kills` : "");
  }
  refreshSideIfChanged();
}
/// The keys of everyone at this keyboard (you, and couch players on the opener's Mac), held this frame.
function hostKeys(W) {
  const one = RB.mset.tn === 1, K = GAME.keys, h = l => l.some(x => K.has(x)) ? 1 : 0;
  RB.players.forEach((p, i) => {
    if (p.b || W.q[i] || !(p.id === myId() || p.c)) return;
    const S = SEATS[p.c || 0], I = W.inp[i];
    I.t = one ? -h(S.one.t) : h(S.two.r) - h(S.two.l);
    I.f = h(one ? S.one.f : S.two.f);
  });
}
function sendKeys(now) {
  RB.sent = now;
  const one = (RB.mset || RB.set).tn === 1, S = SEATS[0], K = GAME.keys, h = l => l.some(x => K.has(x)) ? 1 : 0;
  gsend({ g: ID, k: "in", id: RB.id, t: one ? -h(S.one.t) : h(S.two.r) - h(S.two.l), f: h(one ? S.one.f : S.two.f), fc: RB.cnt.f, tc: RB.cnt.t, td: RB.cnt.td });
}
/// A key went down (auto-repeats are not presses): a shot or a puff, or a tap of the turn key.
function rbKey(k, down) {
  if (!down) { RB.held.delete(k); return; }
  if (RB.held.has(k)) return;
  RB.held.add(k);
  if (RB.phase !== "match") return;
  const one = RB.mset.tn === 1, host = amHost();
  RB.players.forEach((p, i) => {
    const mine = p.id === myId(), seat = mine ? 0 : p.c && host ? p.c : -1;
    if (seat < 0 || p.b) return;
    const S = SEATS[seat], fire = (one ? S.one.f : S.two.f).includes(k);
    const dir = one ? (S.one.t.includes(k) ? -1 : 0) : S.two.l.includes(k) ? -1 : S.two.r.includes(k) ? 1 : 0;
    if (!fire && !dir) return;
    if (host) { const I = RB.w.inp[i]; if (fire) I.fp = Math.min(3, I.fp + 1); else { I.tp = 0.06; I.tps = dir; } return; }
    if (fire) RB.cnt.f++; else { RB.cnt.t++; RB.cnt.td = dir; }
    const now = Date.now() / 1000; if (now - RB.sent >= SEND) sendKeys(now);
  });
}
/// A teammate's keys, on the opener's Mac.
function takeInput(i, d) {
  const I = RB.w.inp[i], S = RB.seen[i] || (RB.seen[i] = { fc: 0, tc: 0 });
  I.t = clamp(num(d.t) | 0, -1, 1); I.f = num(d.f) ? 1 : 0;
  const fc = num(d.fc), tc = num(d.tc);
  if (fc > S.fc) I.fp = Math.min(3, I.fp + Math.min(3, fc - S.fc));
  if (tc > S.tc && !I.t) { I.tp = 0.07; I.tps = num(d.td) > 0 ? 1 : -1; }
  S.fc = fc; S.tc = tc;
}
function takeState(d) {
  const s = unpack(d), S = RB.snaps, now = Date.now();
  if (S.length && s.h <= S[S.length - 1].h) return;
  S.push(s); if (S.length > 12) S.shift();
  // how far the opener's clock is behind ours: the quickest message so far, creeping up slowly so a
  // slower connection is followed
  const off = now - s.h;
  RB.off = RB.off === null ? off : Math.min(off, RB.off + 0.5);
}
/// The picture now, on a teammate's Mac: LAG behind the newest, between the two pictures around that
/// moment; the events of the pictures passed are shown as they are reached.
function guestView() {
  const S = RB.snaps; if (!S.length) return null;
  const rh = Date.now() - RB.off - LAG * 1000, last = S[S.length - 1];
  let v;
  if (rh >= last.h) v = ahead(last, Math.min(0.12, (rh - last.h) / 1000));
  else if (rh <= S[0].h) v = S[0];
  else for (let i = S.length - 1; i > 0; i--) if (S[i - 1].h <= rh) { v = between(S[i - 1], S[i], (rh - S[i - 1].h) / (S[i].h - S[i - 1].h)); break; }
  for (const s of S) if (s.h <= rh) for (const e of s.events) if (e[0] > RB.evSeen) { RB.evSeen = e[0]; onEvent(e); }
  return v || last;
}

// ---------- from the room ----------
function rbMsg(from, name, d) {
  const now = Date.now() / 1000;
  const owner = (RB.lobbies[d.id] && RB.lobbies[d.id].owner) || (RB.id === d.id ? RB.owner : "");
  if (["open", "lobby", "start", "close", "st", "end"].includes(d.k) && owner && owner !== from) return;    // a match is its opener's
  const players = Array.isArray(d.players) ? d.players.slice(0, MAX_P).map(p => ({ id: String(p.id), name: String(p.name || "").slice(0, 24) || "?", b: p.b ? 1 : 0, c: clamp(num(p.c) | 0, 0, 3) })) : null;
  const set = { ar: clamp(num(d.ar) | 0, -1, ARENAS.length - 1), df: clamp(num(d.df) | 0, 0, 2), wn: WINS.includes(num(d.wn)) ? num(d.wn) : 5, tn: num(d.tn) === 2 ? 2 : 1 };
  if ((d.k === "open" || d.k === "lobby") && players) {
    const fresh = !RB.lobbies[d.id];
    RB.lobbies[d.id] = { id: d.id, owner: from, ownerName: name, players, set, at: now };
    if (RB.id === d.id && RB.phase === "lobby") {
      RB.players = players; RB.set = set;
      if (!players.some(p => p.id === myId())) { RB.phase = "pick"; RB.id = ""; toast("🚀 That match is full", null, 3000); }
      side();
    } else if (fresh && d.k === "open") {
      if (GAME.open) toast(`🚀 ${esc(name)} opened a Rocket Rumpus match · click to join`, () => joinMatch(d.id), 10000);
      else note(`🚀 ${name} opened a Rocket Rumpus match: Games tab → Join`);
      if (GAME.open && GAME.view === ID && RB.phase === "pick") side();
    }
    peopleKey = "";
    return;
  }
  if (d.k === "close" || d.k === "start") { delete RB.lobbies[d.id]; peopleKey = ""; }
  if (RB.id !== d.id || !RB.id) return;
  if (d.k === "close" && RB.phase === "lobby") { RB.phase = "pick"; RB.id = ""; RB.set = loadSet(); toast(`${esc(name)} closed the match`, null, 3000); side(); return; }
  if (d.k === "start" && RB.phase === "lobby" && players) {
    RB.players = players; RB.set = set;
    if (myIdx() < 0) { RB.phase = "pick"; RB.id = ""; return side(); }
    beginMatch(num(d.seed) || 1);
    return;
  }
  // the opener looks after the lobby
  if (amHost() && RB.phase === "lobby") {
    if (d.k === "join" && !RB.players.some(p => p.id === from)) {
      if (RB.players.length < MAX_P) RB.players.push({ id: from, name: String(name).slice(0, 24), b: 0, c: 0 });
      else { const bot = RB.players.findIndex(p => p.b); if (bot >= 0) RB.players.splice(bot, 1, { id: from, name: String(name).slice(0, 24), b: 0, c: 0 }); }
    }
    if (d.k === "join") sendLobby("lobby");                 // also when full: they hear it and stop waiting
    if (d.k === "leave") { RB.players = RB.players.filter(p => p.id !== from); sendLobby("lobby"); }
    return;
  }
  if (RB.phase !== "match") return;
  const k = RB.players.findIndex(p => p.id === from);
  if (k < 0) return;
  if (amHost()) {
    if (d.k === "in" && RB.w && !RB.w.q[k]) { RB.from[from] = now; takeInput(k, d); }
    if (d.k === "quit") dropPlayer(k, "left the match");
    return;
  }
  if (from !== RB.owner) return;
  RB.heard = now;
  if (d.k === "st") takeState(d);
  if (d.k === "end") {
    for (const e of Array.isArray(d.e) ? d.e : []) if (Array.isArray(e) && num(e[0]) > RB.evSeen) { RB.evSeen = num(e[0]); onEvent(e.map(num)); }
    if (RB.view) RB.view = Object.assign({}, RB.view, { score: Array.isArray(d.s) ? d.s.map(num) : RB.view.score, kills: Array.isArray(d.kl) ? d.kl.map(num) : RB.view.kills, champ: num(d.w) | 0, ph: "over" });
    finish();
  }
  if (d.k === "quit") finish(`${name} (the opener) left: the match is over`);
}
function openLobbies() {
  const now = Date.now() / 1000;
  for (const [id, l] of Object.entries(RB.lobbies)) if (now - l.at > LOBBY_GONE) delete RB.lobbies[id];
  return Object.values(RB.lobbies).filter(l => l.id !== RB.id);
}

// ---------- pictures: a small pixel painter ----------
const rgb = h => { const n = parseInt(String(h).slice(1, 7), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const hex = c => "#" + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE = [255, 255, 255], INK = [14, 10, 24], WARM = [255, 246, 214], SHADE = [16, 10, 40];
/// A colour lit (f > 0, toward a warm white) or in shadow (f < 0, toward a cool ink): pixel-art ramps shift hue.
const tone = (c, f) => f >= 0 ? mix(c, WARM, f) : mix(c, SHADE, -f);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
const nhash = (x, y, s) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = nhash(xi, yi, s), b = nhash(xi + 1, yi, s), c = nhash(xi, yi + 1, s), d = nhash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s, o) => { let t = 0, a = 0.5, f = 1; for (let i = 0; i < (o || 4); i++) { t += a * vnoise(x * f, y * f, s + i * 17); f *= 2; a *= 0.5; } return t / (1 - Math.pow(0.5, o || 4)); };
function canvasOf(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
/// A w×h picture painted pixel by pixel (with alpha blending), turned into a canvas at the end.
function painter(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  const P = {
    w, h, d,
    set(x, y, c, a) {
      x = Math.floor(x); y = Math.floor(y);
      if (x < 0 || y < 0 || x >= w || y >= h || !c) return;
      const k = (y * w + x) * 4;
      if (a === undefined || a >= 1) { d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255; return; }
      if (a <= 0) return;
      const ba = d[k + 3] / 255, oa = a + ba * (1 - a);
      for (let i = 0; i < 3; i++) d[k + i] = (c[i] * a + d[k + i] * ba * (1 - a)) / oa;
      d[k + 3] = oa * 255;
    },
    get(x, y) { if (x < 0 || y < 0 || x >= w || y >= h) return null; const k = (y * w + x) * 4; return d[k + 3] ? [d[k], d[k + 1], d[k + 2]] : null; },
    alpha(x, y) { return x < 0 || y < 0 || x >= w || y >= h ? 0 : d[(y * w + x) * 4 + 3]; },
    rect(x, y, ww, hh, c, a) { for (let j = y; j < y + hh; j++) for (let i = x; i < x + ww; i++) P.set(i, j, c, a); },
    /// a dark line round everything painted (4-neighbours)
    outline(c) {
      const solid = (x, y) => P.alpha(x, y) > 127, add = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) add.push(x, y);
      for (let i = 0; i < add.length; i += 2) P.set(add[i], add[i + 1], c || INK);
    },
    canvas() { const c = canvasOf(w, h), g = c.getContext("2d"), img = g.createImageData(w, h); img.data.set(d); g.putImageData(img, 0, 0); return c; },
  };
  return P;
}
const pics = new Map();
function pic(key, make) { let c = pics.get(key); if (!c) { if (pics.size > 1500) pics.clear(); c = make(); pics.set(key, c); } return c; }
/// Pictures from strings: one letter a pixel, its colour from pal ("." is see-through).
function sprite(rows, pal) {
  const P = painter(rows[0].length, rows.length);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) P.set(x, y, rgb(pal[ch])); }));
  return P.canvas();
}

// ---------- the pixel font: 5×7 letters, a base-32 digit per row ----------
const FONT = {
  A: "ehhvhhh", B: "uhhuhhu", C: "ehggghe", D: "uhhhhhu", E: "vgguggv", F: "vgguggg", G: "ehgnhhf", H: "hhhvhhh",
  I: "e44444e", J: "72222ic", K: "hikokih", L: "ggggggv", M: "hrllhhh", N: "hhpljhh", O: "ehhhhhe", P: "uhhuggg",
  Q: "ehhhlid", R: "uhhukih", S: "fgge11u", T: "v444444", U: "hhhhhhe", V: "hhhhha4", W: "hhhllla", X: "hha4ahh",
  Y: "hha4444", Z: "v1248gv", 0: "ehhhhhe", 1: "4c4444e", 2: "eh1248v", 3: "v2421he", 4: "26aiv22", 5: "vgu11he",
  6: "68guhhe", 7: "v124888", 8: "ehhehhe", 9: "ehhf12c", "!": "4444404", ":": "0cc0cc0", "-": "000v000",
  ".": "00000cc", "'": "4480000", "?": "eh12404", "*": "44veah0", "+": "044v440", " ": "0000000", "/": "1122488",
};
const cleanText = s => String(s).toUpperCase().replace(/[İI]/g, "I").replace(/[^A-Z0-9!:\-.'?*+/ ]/g, " ");
/// A line of pixel text at scale s: a top-to-bottom colour ramp, a dark outline and a drop shadow.
function textPic(str, s, top, bot, line, shadow) {
  str = cleanText(str);
  return pic(`t|${str}|${s}|${top}|${bot}|${line}|${shadow}`, () => {
    const gw = Math.max(1, str.length * 6 - 1), W = gw * s + 4, H = 7 * s + 4, P = painter(W, H), mask = new Uint8Array(W * H);
    const T = rgb(top), B = rgb(bot || top);
    [...str].forEach((ch, n) => (FONT[ch] || FONT[" "]).split("").forEach((row, r) => {
      const bits = parseInt(row, 32);
      for (let c = 0; c < 5; c++) if (bits & (16 >> c)) for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) mask[(1 + r * s + j) * W + 1 + (n * 6 + c) * s + i] = 1;
    }));
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
    if (shadow) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (on(x - 1, y - 1) || on(x - 2, y - 2) && s > 2) P.set(x, y, rgb(shadow));
    if (line) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) P.set(x, y, rgb(line));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (on(x, y)) {
      const t = (y - 1) / (7 * s - 1);
      P.set(x, y, mix(T, B, Math.min(1, Math.floor(t * 4) / 3)));
    }
    return P.canvas();
  });
}
/// Pixel text at (x, y), its top edge; align "left", "center" or "right". Returns its width.
function ptext(str, x, y, s, top, bot, align, line, shadow) {
  const c = textPic(str, s || 1, top || "#ffffff", bot, line === undefined ? "#140e20" : line, shadow === undefined ? "#06040c" : shadow);
  const w = c.width - 4, ox = align === "center" ? w / 2 : align === "right" ? w : 0;
  bx.drawImage(c, Math.round(x - ox - 1), Math.round(y - 1));
  return w;
}

// ---------- pictures: rockets and pilots ----------
// Each is drawn from its shape, sampled per pixel at the angle it faces (so it turns cleanly at this
// size): lit from the top left of the screen whichever way it points, with a dark outline. The rocket:
// a round hull with a painted nose and a light band, a glass canopy, swept fins and an engine bell.
const SHIP_N = 64, SHIP_S = 19, PILOT_N = 16, PILOT_S = 13;
const LIGHT = (() => { const v = [-0.5, -0.62, 0.6], l = Math.hypot(...v); return v.map(x => x / l); })();
const FIN = [[0.2, 2.1], [-3.9, 5.5], [-6.5, 5.3], [-5.5, 1.9]];
function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; }
/// What is at (u, v) on the rocket (u forward, v to its right): a material, or "".
function shipAt(u, v) {
  const av = Math.abs(v), hull = (u / 5.9) ** 2 + (v / 2.85) ** 2;
  if (hull <= 1) {
    if (((u - 1.5) / 2.0) ** 2 + (v / 1.35) ** 2 <= 1) return "glass";
    if (u > 4.0) return "nose";
    if (u > -2.5 && u < -1.4) return "band";
    return "hull";
  }
  if (u < -5.0 && u > -7.7 && av < 1.3 + (-5.0 - u) * 0.28) return "bell";
  if (inPoly(u, av, FIN)) return u > -1.2 || av > 4.6 ? "finL" : "fin";
  return "";
}
/// A rocket's picture at angle index k: team colour c; look "" (normal), "ice" (frozen) or "flash".
function shipPic(c, k, look) {
  return pic(`ship|${c}|${k}|${look || ""}`, () => {
    const a = k / SHIP_N * TAU, ca = Math.cos(a), sa = Math.sin(a), P = painter(SHIP_S, SHIP_S), C = rgb(c), h = SHIP_S / 2;
    const ramp = { hull: C, nose: mix(C, WHITE, 0.45), band: [236, 232, 244], fin: tone(C, -0.42), finL: tone(C, -0.15), bell: [120, 116, 134] };
    for (let y = 0; y < SHIP_S; y++) for (let x = 0; x < SHIP_S; x++) {
      // 2×2 samples decide whether the pixel is on the rocket; its middle decides what it is
      let n = 0, mat = "";
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.5]]) {
        const sx = x + ox - h, sy = y + oy - h, u = sx * ca + sy * sa, v = -sx * sa + sy * ca, m = shipAt(u, v);
        if (m) { if (ox !== 0.5) n++; if (!mat || ox === 0.5) mat = m; }
      }
      if (n < 2 || !mat) continue;
      const sx = x + 0.5 - h, sy = y + 0.5 - h, u = sx * ca + sy * sa, v = -sx * sa + sy * ca;
      let col;
      if (mat === "glass") {
        // a dome: dark glass, a glint where it faces the light
        const du = (u - 1.5) / 2.0, dv = v / 1.35, z = Math.sqrt(Math.max(0, 1 - du * du - dv * dv));
        const nx = du * ca - dv * sa, ny = du * sa + dv * ca, lam = nx * LIGHT[0] + ny * LIGHT[1] + z * LIGHT[2];
        col = lam > 0.86 ? [226, 252, 255] : lam > 0.62 ? [96, 178, 222] : lam > 0.3 ? [40, 74, 126] : [22, 34, 70];
      } else if (mat === "fin" || mat === "finL") {
        const nx = -sa * Math.sign(v), ny = ca * Math.sign(v), lam = (nx * LIGHT[0] + ny * LIGHT[1]) * 0.6 + 0.4;
        col = tone(ramp[mat], lam > 0.62 ? 0.25 : lam < 0.25 ? -0.25 : 0);
      } else {
        // the hull, the nose, the band and the bell: a body of revolution along u
        const A2 = mat === "bell" ? 9 : 5.9 * 5.9, B2 = mat === "bell" ? 2.2 : 2.85 * 2.85, z = Math.sqrt(Math.max(0, 1 - u * u / (A2 * 1.6) - v * v / B2));
        let nu = mat === "bell" ? 0 : u / A2, nv = v / B2, nz = z / Math.sqrt(B2);
        const l = Math.hypot(nu, nv, nz) || 1; nu /= l; nv /= l; nz /= l;
        const nx = nu * ca - nv * sa, ny = nu * sa + nv * ca, lam = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2] + (dither(x, y) - 0.5) * 0.12;
        const f = lam > 0.9 ? 0.62 : lam > 0.7 ? 0.3 : lam > 0.38 ? 0 : lam > 0.12 ? -0.3 : -0.55;
        col = tone(ramp[mat], f);
        if (mat === "bell" && u < -7.0) col = [42, 36, 54];
      }
      if (look === "ice") col = mix(mix(col, [190, 238, 255], 0.55), WHITE, (x + y) % 5 === 0 ? 0.4 : 0);
      if (look === "flash") col = mix(col, WHITE, 0.75);
      P.set(x, y, col);
    }
    P.outline(look === "ice" ? [40, 90, 130] : INK);
    return P.canvas();
  });
}
const shipIdx = a => ((Math.round(wrapA(a) / TAU * SHIP_N) % SHIP_N) + SHIP_N) % SHIP_N;
/// A pilot: a white suit and helmet, a visor and a backpack in their colour; frame f swings arms and legs.
function pilotPic(c, k, f) {
  return pic(`pilot|${c}|${k}|${f}`, () => {
    const a = k / PILOT_N * TAU, ca = Math.cos(a), sa = Math.sin(a), P = painter(PILOT_S, PILOT_S), C = rgb(c), h = PILOT_S / 2, sw = f ? 0.7 : -0.7;
    for (let y = 0; y < PILOT_S; y++) for (let x = 0; x < PILOT_S; x++) {
      const sx = x + 0.5 - h, sy = y + 0.5 - h, u = sx * ca + sy * sa, v = -sx * sa + sy * ca;
      let col = null;
      const hd = Math.hypot(u - 0.6, v);
      if (hd < 2.4) {
        const z = Math.sqrt(Math.max(0, 1 - (hd / 2.4) ** 2)), nx = ((u - 0.6) * ca - v * sa) / 2.4, ny = ((u - 0.6) * sa + v * ca) / 2.4, lam = nx * LIGHT[0] + ny * LIGHT[1] + z * LIGHT[2];
        col = u > 1.3 && Math.abs(v) < 1.9 ? (lam > 0.72 ? [236, 252, 255] : tone(C, -0.3)) : lam > 0.7 ? [255, 255, 255] : lam > 0.3 ? [214, 214, 230] : [150, 146, 176];
      } else if (u < -1.0 && u > -3.4 && Math.abs(v) < 1.8) col = tone(C, u < -2.6 ? -0.35 : 0.05);
      else if (Math.hypot(u - 0.2 - sw * Math.sign(v) * 0.6, Math.abs(v) - 2.7) < 0.9) col = [226, 224, 238];
      else if (Math.hypot(u + 2.6 + sw * Math.sign(v) * 0.7, Math.abs(v) - 1.1) < 0.85) col = [160, 156, 182];
      if (col) P.set(x, y, col);
    }
    P.outline(INK);
    return P.canvas();
  });
}

// ---------- pictures: power-ups, mines, rocks ----------
const ICONS = {
  lance:  ["....lww", "...lwwl", "..lwl..", ".dcl...", "dcd....", "cd.....", "d......"],
  mine:   ["...G...", ".G.g.G.", "..ggg..", "Gggrggk", "..ggg..", ".G.g.G.", "...G..."],
  fan:    ["w..w..w", ".l.l.l.", "..lll..", "...c...", "..ccc..", "..ccc..", "...d..."],
  cryo:   ["...w...", ".w.l.w.", "..lwl..", "wlwwwlw", "..lwl..", ".w.l.w.", "...w..."],
  shield: ["..lll..", ".lw..l.", "lw....c", "l.....c", "l.....c", ".c...c.", "..ccc.."],
  bounce: ["......w", "w....wl", ".l..l..", "..ll...", "..l....", ".......", "ddddddd"],
};
function iconPic(type) {
  const P = POWERS[type], c = rgb(P.c);
  return pic("icon" + type, () => sprite(ICONS[P.id], { w: "#ffffff", l: hex(mix(c, WHITE, 0.55)), c: P.c, d: hex(tone(c, -0.45)), k: "#140e20", g: "#5d566e", G: "#a59fb8", r: "#ff4040" }));
}
/// A capsule: a round pod with a metal rim, glass tinted the power's colour, its icon inside.
function capsulePic(type) {
  return pic("cap" + type, () => {
    const S = 15, P = painter(S, S), c = rgb(POWERS[type].c), h = S / 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - h, dy = y + 0.5 - h, d = Math.hypot(dx, dy);
      if (d > 6.6) continue;
      const z = Math.sqrt(Math.max(0, 1 - (d / 6.6) ** 2)), lam = (dx * LIGHT[0] + dy * LIGHT[1]) / 6.6 + z * LIGHT[2];
      if (d > 5.1) P.set(x, y, lam > 0.8 ? mix(c, WHITE, 0.7) : lam > 0.5 ? mix(c, WHITE, 0.2) : lam > 0.2 ? tone(c, -0.25) : tone(c, -0.55));
      else if (d > 4.3) P.set(x, y, [24, 18, 40]);
      else P.set(x, y, mix([18, 14, 34], tone(c, -0.5), clamp(1 - d / 4.3, 0, 1) * 0.8));
    }
    P.outline(INK);
    const g = P.canvas(), x = g.getContext("2d");
    x.drawImage(iconPic(type), 4, 4);
    x.fillStyle = "rgba(255,255,255,0.9)"; x.fillRect(3, 2, 2, 1); x.fillRect(2, 3, 1, 2);
    return g;
  });
}
function minePic(c, lit) {
  return pic(`mine|${c}|${lit}`, () => {
    const P = painter(9, 9), C = rgb(c);
    for (const [x, y] of [[4, 0], [4, 8], [0, 4], [8, 4], [1, 1], [7, 1], [1, 7], [7, 7]]) P.set(x, y, [150, 144, 170]);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      const dx = x - 4, dy = y - 4, d = Math.hypot(dx, dy);
      if (d <= 2.6) P.set(x, y, d < 1 ? (lit ? [255, 70, 60] : [120, 30, 34]) : dx + dy < -1 ? [130, 124, 150] : dx + dy > 1 ? [52, 48, 66] : [86, 80, 104]);
    }
    P.set(3, 2, C); P.set(5, 6, C);
    P.outline(INK);
    return P.canvas();
  });
}
/// A rock: a lumpy, cratered ball, its craters turning with it, the light staying top left.
function rockPic(n, k) {
  return pic(`rock|${n}|${k}`, () => {
    const R = ROCKS[n].r, S = R * 2 + 5, P = painter(S, S), h = S / 2, a = k / 32 * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const base = [[132, 112, 104], [116, 108, 128], [140, 120, 98]][n];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - h, dy = y + 0.5 - h, u = dx * ca + dy * sa, v = -dx * sa + dy * ca, ang = Math.atan2(v, u);
      const rr = R * (0.86 + 0.14 * vnoise(Math.cos(ang) * 2 + 3, Math.sin(ang) * 2 + 3, 40 + n)), d = Math.hypot(dx, dy);
      if (d > rr) continue;
      const z = Math.sqrt(Math.max(0, 1 - (d / rr) ** 2)), lam = (dx * LIGHT[0] + dy * LIGHT[1]) / rr + z * LIGHT[2];
      let f = lam > 0.85 ? 0.35 : lam > 0.55 ? 0.12 : lam > 0.2 ? -0.15 : -0.45;
      // craters: darker pits with a lit far rim
      const cr = vnoise(u * 0.5 + 9, v * 0.5 + 9, 70 + n);
      if (cr > 0.68) f -= 0.3; else if (cr > 0.62) f += 0.15;
      P.set(x, y, tone(base, f + (dither(x, y) - 0.5) * 0.1));
    }
    P.outline(INK);
    return P.canvas();
  });
}

// ---------- pictures: the arenas ----------
const THEMES = {
  quarry: { top: [10, 8, 30], bot: [22, 10, 40], neb: [[44, 14, 82], [96, 30, 128], [176, 70, 168], [255, 150, 214]], neb2: [[12, 60, 80], [30, 120, 130]],
            metal: [[58, 52, 76], [92, 84, 116], [34, 30, 46], [132, 124, 158]], cry: [[42, 14, 64], [92, 42, 146], [154, 92, 220], [218, 172, 255], [255, 255, 255]], fence: [120, 220, 255] },
  well:   { top: [4, 5, 14], bot: [12, 6, 16], neb: [[30, 10, 20], [80, 22, 30], [164, 70, 40], [255, 176, 96]], neb2: [[14, 20, 54], [30, 50, 110]],
            metal: [[52, 64, 90], [80, 96, 128], [30, 37, 54], [128, 148, 184]], cry: [[14, 42, 60], [40, 104, 140], [90, 184, 216], [184, 240, 255], [255, 255, 255]], fence: [255, 190, 120] },
  rotor:  { floor: [42, 46, 56], metal: [[62, 66, 74], [94, 100, 112], [36, 39, 45], [138, 144, 156]], cry: [[58, 36, 18], [106, 66, 32], [154, 106, 52], [200, 154, 88], [240, 208, 144]], fence: [255, 200, 70] },
};
/// The arena behind everything (drawn once): space or the station's deck, the metal blocks, the fence,
/// the score bar's panel.
function arenaBg(ai) {
  return pic("bg" + ai, () => {
    const A = ARENAS[ai], T = THEMES[A.id], P = painter(GW, GH), seed = 101 + ai * 31;
    if (A.id === "rotor") stationFloor(P, T);
    else spaceBack(P, T, A.id, seed);
    // drop shadows under the metal, then the metal: plates bevelled where they meet the floor, rivets at the corners
    const solid = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && A.tiles[r * COLS + c] === 1;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (solid(c, r))
      for (let j = 0; j < TS + 2; j++) for (let i = 0; i < TS + 2; i++) P.set(AX0 + c * TS + i + 1, AY0 + r * TS + j + 2, [0, 0, 0], 0.18);
    const M = T.metal;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!solid(c, r)) continue;
      const x0 = AX0 + c * TS, y0 = AY0 + r * TS, up = !solid(c, r - 1), dn = !solid(c, r + 1), lf = !solid(c - 1, r), rt = !solid(c + 1, r);
      for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) {
        let col = tone(M[0], (vnoise((x0 + i) / 3, (y0 + j) / 3, seed) - 0.5) * 0.25);
        if (up && j < 2 || lf && i < 1) col = j === 0 && up ? M[3] : M[1];
        else if (dn && j >= TS - 2 || rt && i >= TS - 1) col = M[2];
        if (A.id === "rotor" && up && j === 2 && ((x0 + i) >> 1) % 2) col = [200, 160, 40];
        P.set(x0 + i, y0 + j, col);
      }
      const single = up && dn && lf && rt;
      if (single) { P.set(x0 + 3, y0 + 3, M[3]); P.set(x0 + 4, y0 + 3, M[1]); P.set(x0 + 3, y0 + 4, M[1]); P.set(x0 + 4, y0 + 4, M[2]); }
      else for (const [cx, cy, on] of [[2, 3, up && lf], [TS - 3, 3, up && rt], [2, TS - 4, dn && lf], [TS - 3, TS - 4, dn && rt]]) if (on) { P.set(x0 + cx, y0 + cy, M[3]); P.set(x0 + cx, y0 + cy + 1, M[2]); }
    }
    // the rim round the arena, and the score bar's panel
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (x >= AX0 && x < AX1 && y >= AY0 && y < AY1) continue;
      const edge = x === AX0 - 1 || x === AX1 || y === AY0 - 1 || y === AY1;
      if (y < AY0 - 1) P.set(x, y, mix([24, 18, 36], [12, 9, 20], y / AY0));
      else P.set(x, y, edge ? [40, 32, 58] : [14, 10, 22]);
    }
    for (let x = 0; x < GW; x++) { P.set(x, 0, [44, 36, 66]); P.set(x, AY0 - 2, [56, 46, 82]); }
    return P.canvas();
  });
}
function spaceBack(P, T, id, seed) {
  for (let y = AY0; y < AY1; y++) for (let x = AX0; x < AX1; x++) {
    let col = mix(T.top, T.bot, (y - AY0) / (AY1 - AY0));
    // the nebula: soft clouds in bands of colour, dithered at the edges between them; on Gravewell it
    // swirls in toward the hole
    let nx = x / 80, ny = y / 55;
    if (id === "well") { const dx = x - MX, dy = y - MY, d = Math.hypot(dx, dy), an = Math.atan2(dy, dx) + 120 / (d + 30); nx = Math.cos(an) * d / 60; ny = Math.sin(an) * d / 60; }
    const v = fbm(nx, ny, seed, 5), w = fbm(nx * 1.7 + 4, ny * 1.7, seed + 9, 3);
    const t = clamp((v - 0.42) / 0.4, 0, 1) * (id === "well" ? clamp(1.3 - Math.hypot(x - MX, y - MY) / 170, 0.25, 1) : 1);
    if (t > 0) { const lv = Math.min(3, Math.floor(t * 4 + (dither(x, y) - 0.5) * 0.5)); if (lv >= 0) col = mix(col, T.neb[lv], 0.2 + t * 0.3); }
    const t2 = clamp((w - 0.55) / 0.3, 0, 1);
    if (t2 > 0.2 + dither(x, y) * 0.5) col = mix(col, T.neb2[t2 > 0.6 ? 1 : 0], 0.18);
    if (fbm(nx * 2 + 9, ny * 2, seed + 3, 3) > 0.66) col = mix(col, [0, 0, 0], 0.35);       // dark dust lanes
    P.set(x, y, col);
  }
  // a planet low in a corner (Quarry: ringed, violet; Gravewell: a distant spiral galaxy instead)
  if (id === "quarry") {
    const cx = 22, cy = AY1 + 34, R = 62;
    for (let y = AY0; y < AY1; y++) for (let x = AX0; x < AX1; x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d < R) {
        const z = Math.sqrt(1 - (d / R) ** 2), lam = (dx * 0.62 - dy * 0.55) / R + z * 0.45, band = Math.sin(dy * 0.35 + vnoise(x / 9, y / 4, 5) * 3);
        const base = band > 0.3 ? [112, 76, 140] : [86, 58, 118], f = lam + (dither(x, y) - 0.5) * 0.16;
        P.set(x, y, f > 0.55 ? tone(base, 0.2) : f > 0.3 ? base : f > 0.05 ? tone(base, -0.45) : tone(base, -0.8));
      } else if (d < R + 3) P.set(x, y, [170, 130, 255], 0.28 * (R + 3 - d) / 3);
      const ry = (dy + dx * 0.32) * 3.2, rd = Math.hypot(dx, ry);
      if (rd > R * 1.15 && rd < R * 1.5 && !(d < R && dy + dx * 0.32 < 0) && (Math.floor(rd) % 5 !== 0)) P.set(x, y, [210, 180, 240], 0.32);
    }
  } else {
    const cx = 268, cy = 58;
    for (let y = cy - 18; y < cy + 18; y++) for (let x = cx - 30; x < cx + 30; x++) {
      const dx = (x - cx) / 1.8, dy = y - cy, d = Math.hypot(dx, dy), an = Math.atan2(dy, dx);
      const arm = Math.cos(2 * an - Math.log(d + 1) * 3.2), b = Math.exp(-d / 6) + Math.max(0, arm) * Math.exp(-d / 11) * 0.55;
      if (b > 0.08 + dither(x, y) * 0.12) P.set(x, y, b > 0.7 ? [255, 236, 210] : b > 0.35 ? [200, 170, 210] : [120, 96, 160], Math.min(0.8, b + 0.2));
    }
  }
  // stars: faint dust, brighter ones, a few with a cross of light
  for (let y = AY0; y < AY1; y++) for (let x = AX0; x < AX1; x++) {
    const h = nhash(x, y, seed);
    if (h < 0.006) {
      const c = [[255, 255, 255], [188, 212, 255], [255, 232, 196]][Math.floor(nhash(x, y, seed + 1) * 3)], b = nhash(x, y, seed + 2);
      P.set(x, y, c, 0.25 + b * 0.7);
      if (b > 0.93) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) P.set(x + dx, y + dy, c, 0.35);
    }
  }
}
function stationFloor(P, T) {
  // deck plates, 16 px, each a little different; a groove between them; scuffs; the rotor's sweep painted
  // on the floor; the sliding blocks' rails; lights along the walls
  for (let y = AY0; y < AY1; y++) for (let x = AX0; x < AX1; x++) {
    const px = Math.floor((x - AX0) / 16), py = Math.floor((y - AY0) / 16), lx = (x - AX0) % 16, ly = (y - AY0) % 16;
    let col = tone(T.floor, (nhash(px, py, 7) - 0.5) * 0.12 + (vnoise(x / 5, y / 5, 9) - 0.5) * 0.1);
    if (lx === 0 || ly === 0) col = tone(T.floor, -0.45);
    else if (lx === 1 || ly === 1) col = tone(T.floor, 0.12);
    if ((lx === 3 || lx === 12) && (ly === 3 || ly === 12)) col = tone(T.floor, 0.3);
    if (vnoise(x / 14, y / 14, 31) > 0.72 && dither(x, y) > 0.4) col = tone(col, -0.2);
    const d = Math.hypot(x - MX, y - MY);
    if (d > ARM_L + 3 && d < ARM_L + 6) col = (Math.floor(Math.atan2(y - MY, x - MX) * 12) % 2) ? [190, 150, 40] : [30, 30, 34];
    else if (d <= ARM_L + 3) col = tone(col, -0.18);
    for (const pxl of PIST) if (Math.abs(x - pxl) <= PIST_H + 2 && y > MY - PIST_A - PIST_H - 3 && y < MY + PIST_A + PIST_H + 3) {
      col = Math.abs(x - pxl) > PIST_H ? [190, 150, 40] : tone(T.floor, -0.55 + (Math.abs(x - pxl) < 2 ? 0.15 : 0));
    }
    P.set(x, y, col);
  }
  for (let x = AX0 + 10; x < AX1; x += 24) { P.set(x, AY0 + 1, [120, 220, 255]); P.set(x, AY1 - 2, [120, 220, 255]); }
}
/// A crystal block (Rotor Station: a cargo crate), variant v.
function crystalPic(ai, v) {
  return pic(`cry|${ai}|${v}`, () => {
    const C = THEMES[ARENAS[ai].id].cry, P = painter(TS, TS);
    if (ARENAS[ai].id === "rotor") {
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const edge = x === 0 || y === 0 || x === TS - 1 || y === TS - 1, brace = x === y || x + y === TS - 1;
        P.set(x, y, edge ? (x === 0 || y === 0 ? C[3] : C[0]) : brace ? C[3] : (y % 3 === 0 ? C[1] : C[2]));
      }
      P.set(1, 1, C[4]); P.set(TS - 2, 1, C[4]);
      if (v === 1) { P.set(3, 5, [220, 60, 50]); P.set(4, 5, [220, 60, 50]); }
      return P.canvas();
    }
    // a cut stone: four facets round a bright table, lit from the top left, a glint
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      if (x === 0 || y === 0 || x === TS - 1 || y === TS - 1) { P.set(x, y, (x === 0 || y === 0) && x + y < 9 ? mix(C[0], C[1], 0.5) : C[0]); continue; }
      const dx = x - 3.5, dy = y - 3.5;
      let c;
      if (Math.abs(dx) + Math.abs(dy) <= 1.5 + v * 0.5) c = C[3];
      else if (Math.abs(dy) >= Math.abs(dx)) c = dy < 0 ? C[3] : C[1];
      else c = dx < 0 ? C[2] : mix(C[1], C[2], 0.4);
      if (dy < 0 && Math.abs(dy) >= Math.abs(dx) && Math.abs(dx) + Math.abs(dy) > 2.4) c = mix(C[3], C[2], 0.35);
      P.set(x, y, c);
    }
    P.set(3, 3, C[4]); P.set(2, 1, C[4]); if (v === 2) P.set(5, 2, C[4]);
    return P.canvas();
  });
}
/// Rotor Station's rotor at one of 64 angles of its quarter turn: a round hub with bolts and four arms,
/// striped where they would hit you.
function rotorPic(k) {
  return pic("rotor" + k, () => {
    const S = (ARM_L + ARM_W) * 2 + 6, P = painter(S, S), h = S / 2, a = k / 64 * (Math.PI / 2), ca = Math.cos(a), sa = Math.sin(a);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - h, dy = y + 0.5 - h, d = Math.hypot(dx, dy);
      let u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      if (Math.abs(v) > Math.abs(u)) { const t = u; u = v; v = -t; }        // fold the cross onto one arm
      const au = Math.abs(u);
      if (d <= HUB_R) {
        const z = Math.sqrt(Math.max(0, 1 - (d / HUB_R) ** 2)), lam = (dx * LIGHT[0] + dy * LIGHT[1]) / HUB_R + z * LIGHT[2];
        let col = lam > 0.85 ? [196, 202, 214] : lam > 0.55 ? [140, 146, 160] : lam > 0.25 ? [92, 98, 110] : [56, 60, 70];
        const ba = wrapA(Math.atan2(dy, dx) - a) % (TAU / 6);
        if (Math.abs(d - 6.5) < 0.9 && (ba < 0.22 || ba > TAU / 6 - 0.22)) col = [36, 38, 46];
        if (d < 3) col = d < 1.6 ? [255, 210, 80] : [120, 80, 20];
        P.set(x, y, col);
      } else if (au <= ARM_L && Math.abs(v) <= ARM_W && au > HUB_R - 2 || au > ARM_L && Math.hypot(au - ARM_L, v) <= ARM_W) {
        const nv = v / ARM_W, side = nv * (Math.sign(u) || 1), sx = -sa * side, sy = ca * side, lam = (sx * LIGHT[0] + sy * LIGHT[1]) * 0.7;
        let col = Math.abs(nv) > 0.7 ? (lam > 0.1 ? [170, 176, 190] : [60, 64, 74]) : [112, 118, 132];
        if (au > ARM_L - 16 && Math.abs(nv) <= 0.7) col = Math.floor((au + v * 0.9) / 3) % 2 ? [228, 180, 40] : [36, 34, 40];
        if (Math.abs(nv) < 0.25 && au < ARM_L - 16) col = [74, 78, 90];
        P.set(x, y, col);
      }
    }
    P.outline(INK);
    return P.canvas();
  });
}
function pistonPic() {
  return pic("piston", () => {
    const S = PIST_H * 2, P = painter(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let c = x === 0 || y === 0 ? [176, 182, 196] : x === S - 1 || y === S - 1 ? [44, 46, 54] : [110, 116, 130];
      if (x > 1 && y > 1 && x < S - 2 && y < S - 2 && (x > 3 && x < S - 4 && y > 3 && y < S - 4)) c = Math.floor((x + y) / 3) % 2 ? [226, 178, 40] : [34, 32, 38];
      P.set(x, y, c);
    }
    for (const [x, y] of [[2, 2], [S - 3, 2], [2, S - 3], [S - 3, S - 3]]) P.set(x, y, [210, 214, 226]);
    P.outline(INK);
    return P.canvas();
  });
}
/// Gravewell's black hole, 16 frames of its turning disc: hot gas in spiral arms falling in, a bright ring
/// at the edge of the dark.
function holePic(f) {
  return pic("hole" + f, () => {
    const S = 84, P = painter(S, S), h = S / 2, ph = f / 16 * TAU;
    const ramp = [[90, 20, 30], [180, 60, 34], [255, 140, 60], [255, 214, 140], [255, 250, 230]];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - h, dy = y + 0.5 - h, d = Math.hypot(dx, dy), an = Math.atan2(dy, dx);
      if (d < HOLE_R) { P.set(x, y, [0, 0, 0]); continue; }
      if (d < HOLE_R + 1.6) { P.set(x, y, an > -2.4 && an < 0.6 ? [255, 250, 230] : [255, 200, 120]); continue; }
      if (d > 40) continue;
      const lr = Math.log(d), s1 = Math.sin(3 * an + 5 * lr - ph), s2 = Math.sin(6 * an + 9 * lr - 2 * ph + 1.3);
      const fall = clamp(1 - (d - HOLE_R) / 32, 0, 1), I = fall * fall * (0.55 + 0.3 * s1 + 0.15 * s2) + (d < 12 ? 0.25 : 0);
      if (I < 0.07 + dither(x, y) * 0.08) continue;
      const lv = clamp(Math.floor(I * 5 + dither(x, y) * 0.6 - 0.3), 0, 4);
      P.set(x, y, ramp[lv], clamp(I * 1.6, 0.2, 1));
    }
    return P.canvas();
  });
}

/// An explosion's fireball, frame f of 10: a white-hot core swelling through yellow and orange, lit from
/// the top left like a puff, then cooling to smoke and breaking up, ragged and dithered at the edge.
function fireballPic(f, big) {
  return pic(`fire|${f}|${big}`, () => {
    const R = big ? 14 : 9, S = R * 2 + 3, P = painter(S, S), h = S / 2, k = f / 9, r = R * (0.42 + 0.58 * Math.sqrt(k));
    const ramp = [[255, 255, 255], [255, 246, 196], [255, 214, 96], [255, 160, 60], [236, 92, 44], [160, 46, 44], [84, 44, 64], [46, 34, 54]];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - h, dy = y + 0.5 - h, d = Math.hypot(dx, dy) + (vnoise(x / 2.2, y / 2.2, 31 + f) - 0.5) * 3.5;
      if (d > r) continue;
      if (k > 0.45 && vnoise(x / 2.6, y / 2.6, 77) < (k - 0.45) * 1.7) continue;            // holes as it burns out
      const lvl = (d / r) * 3.2 + k * 5.2 + (dx + dy) / r * 0.9 + (dither(x, y) - 0.5) * 0.8;
      P.set(x, y, ramp[clamp(Math.floor(lvl), 0, 7)], k > 0.75 ? 1 - (k - 0.75) * 3 : 1);
    }
    return P.canvas();
  });
}

// ---------- show: particles, shakes, banners ----------
const FX = { parts: [], rings: [], debris: [], feed: [], labels: [], ghosts: [], trails: [], blasts: [], banner: null, shake: 0, flash: 0, flashC: "#ffffff",
  prev: null, born: new Map(), decal: null, dctx: null, bump: {} };
function resetFX() {
  Object.assign(FX, { parts: [], rings: [], debris: [], feed: [], labels: [], ghosts: [], trails: [], blasts: [], banner: null, shake: 0, flash: 0, prev: null, born: new Map(), bump: {} });
  clearDecals();
}
function clearDecals() {
  if (!FX.decal) { FX.decal = canvasOf(GW, GH); FX.dctx = FX.decal.getContext("2d"); }
  FX.dctx.clearRect(0, 0, GW, GH);
}
function part(x, y, vx, vy, life, c, s, drag, kind) {
  if (FX.parts.length < 700) FX.parts.push({ x, y, vx, vy, life, max: life, c, s: s || 1, drag: drag || 0, kind: kind || 0 });
}
function burst(x, y, n, colors, speed, life, size, drag, kind) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = speed * (0.25 + Math.random() * 0.75);
    part(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.5 + Math.random() * 0.5), colors[i % colors.length], size, drag, kind);
  }
}
const ring = (x, y, r, vr, life, c, w) => FX.rings.push({ x, y, r, vr, life, max: life, c, w: w || 1 });
const FIRE = ["#ffffff", "#fff3b0", "#ffd25a", "#ff9a3c", "#ff5a2e", "#b8302c"];
/// A scorch mark on the floor (kept for the round): a dithered dark blot.
function scorch(x, y, r) {
  if (!FX.dctx) clearDecals();
  const g = FX.dctx;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    const d = Math.hypot(i, j) / r + (nhash(x + i, y + j, 3) - 0.5) * 0.5;
    if (d < 1 && dither(x + i, y + j) < 1 - d) { g.fillStyle = d < 0.45 ? "rgba(6,4,10,0.55)" : "rgba(20,10,20,0.35)"; g.fillRect(Math.round(x + i), Math.round(y + j), 1, 1); }
  }
}
function explode(x, y, color, big) {
  const k = big ? 1.6 : 1;
  FX.blasts.push({ x, y, t: 0, big: big ? 1 : 0 });
  for (let i = 0; i < 3; i++) { const a = Math.random() * TAU, d = 3 + Math.random() * 5 * k; FX.blasts.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, t: -0.05 - i * 0.05, big: 0, small: 1 }); }
  burst(x, y, Math.round(22 * k), FIRE, 75 * k, 0.5, 1, 2.2, 1);
  burst(x, y, Math.round(8 * k), FIRE.slice(1, 4), 60 * k, 0.4, 2, 2.5, 1);
  burst(x, y, Math.round(12 * k), ["#4a4058", "#5d5470", "#3a3346"], 24 * k, 1.3, 2, 1.4, 2);
  burst(x, y, 10, [color, "#ffffff"], 95 * k, 0.45, 1, 1, 0);
  ring(x, y, 3, 85 * k, 0.3, "#fff3b0", 1); ring(x, y, 2, 45 * k, 0.45, color, 1);
  const n = big ? 4 : 6;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = 35 + Math.random() * 55;
    FX.debris.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, a: Math.random() * TAU, va: (Math.random() - 0.5) * 14, life: 0.9 + Math.random() * 0.7, c: i % 3 === 2 ? "#c8c4d8" : color, w: 2 + (i % 2), h: 1 + (i % 3 === 0 ? 1 : 0) });
  }
  scorch(x, y, big ? 9 : 6);
  FX.shake = Math.max(FX.shake, big ? 0.75 : 0.5); FX.flash = Math.max(FX.flash, big ? 0.22 : 0.12); FX.flashC = "#fff3d0";
}
function banner(text, dur, top, bot, s, sub) {
  if (isDemo()) return;
  FX.banner = { text, dur, top, bot, s, sub: sub || "", t: 0 };
}
function feedLine(k, v, how) {
  if (isDemo()) return;
  FX.feed.push({ k, v, how, t: 0 }); if (FX.feed.length > 4) FX.feed.shift();
}
const shortName = i => cleanText(nameOf(i)).trim().split(/\s+/).pop().slice(0, 8) || CNAMES[i];
/// Something happened in the match (here, or on the opener's Mac): show it, count achievements.
function onEvent(e) {
  const [, type, a, b, x, y] = e, me = isDemo() ? -9 : myIdx(), col = i => colorOf2(Math.max(0, i));
  switch (type) {
    case EV.ready:
      banner(`ROUND ${a}`, 1.4, "#ffffff", "#9fb4ff", 3, ARENAS[b] ? ARENAS[b].name : "");
      clearDecals(); FX.trails = []; RB.roundKills = 0;
      break;
    case EV.go: banner("FIGHT!", 0.75, "#fff7c2", "#ff8f3c", 4); FX.flash = 0.2; FX.flashC = "#ffffff"; break;
    case EV.boom: case EV.fence:
      explode(x, y, col(a), false);
      if (type === EV.fence) burst(x, y, 14, ["#ff4040", "#ffd0d0"], 60, 0.4, 1, 1);
      feedLine(b, a, type === EV.fence ? "fence" : "boom");
      if (b === me && a !== me) RB.roundKills = (RB.roundKills || 0) + 1;
      break;
    case EV.splat: case EV.squash:
      burst(x, y, 16, [col(a), "#ffffff", "#e8e4f0"], 55, 0.5, 1, 2);
      ring(x, y, 1, 30, 0.3, "#ffffff");
      FX.ghosts.push({ x, y, t: 0, c: col(a) });
      FX.shake = Math.max(FX.shake, 0.22);
      feedLine(b, a, type === EV.squash ? "squash" : "splat");
      if (b === me && a !== me) { RB.roundKills = (RB.roundKills || 0) + 1; if (type === EV.squash) achieve("rocketbrawl-squash"); }
      break;
    case EV.hole:
      for (let i = 0; i < 24; i++) { const an = Math.random() * TAU, r = 4 + Math.random() * 10; part(x + Math.cos(an) * r, y + Math.sin(an) * r, (MX - x) * 2, (MY - y) * 2, 0.5, [col(a), "#ffd25a", "#ffffff"][i % 3], 1, 1.5); }
      ring(MX, MY, 22, -40, 0.4, "#ffb060");
      feedLine(b, a, "hole");
      break;
    case EV.pick:
      ring(x, y, 3, 60, 0.4, POWERS[b].c, 1); burst(x, y, 14, [POWERS[b].c, "#ffffff"], 50, 0.45, 1, 2);
      if (!isDemo()) FX.labels.push({ text: POWERS[b].name, x, y: y - 12, t: 0, c: POWERS[b].c });
      break;
    case EV.fizzle: burst(x, y, 8, ["#8a8098", "#c8c0d8"], 22, 0.4, 1, 2); break;
    case EV.pop: ring(x, y, 5, 50, 0.35, "#7dffb0", 1); burst(x, y, 14, ["#7dffb0", "#ffffff"], 60, 0.4, 1, 1.5); break;
    case EV.mine: explode(x, y, col(a), true); ring(x, y, 4, MINE_BLAST * 3.2, 0.3, "#ff6a3c", 2); break;
    case EV.lance: FX.flash = Math.max(FX.flash, 0.25); FX.flashC = "#ffc0f0"; FX.shake = Math.max(FX.shake, 0.45); break;
    case EV.freeze: burst(x, y, 16, ["#ffffff", "#bff6ff", "#8fe3ff"], 45, 0.6, 1, 2); ring(x, y, 3, 30, 0.35, "#bff6ff"); break;
    case EV.respawn: ring(x, y, 14, -30, 0.45, col(a), 1); ring(x, y, 2, 40, 0.4, "#ffffff"); burst(x, y, 12, [col(a), "#ffffff"], 40, 0.5, 1, 2); break;
    case EV.sd: banner("SUDDEN DEATH", 2.2, "#ffd0d0", "#ff3b3b", 3, "THE FENCE IS CLOSING IN"); FX.flash = 0.3; FX.flashC = "#ff3030"; break;
    case EV.round: {
      const name = a >= 0 ? shortName(a) : "";
      banner(a >= 0 ? `${name} WINS` : "NOBODY", 2.6, a >= 0 ? "#ffffff" : "#c8c0d8", a >= 0 ? col(a) : "#6a6080", 3, a >= 0 ? `TAKES ROUND ${RB.view ? RB.view.round : ""}` : "IS LEFT FLYING");
      if (a >= 0) confetti(col(a));
      if (a === me && me >= 0) { if (b === 2) achieve("rocketbrawl-foot"); }
      if ((RB.roundKills || 0) >= 3) achieve("rocketbrawl-triple");
      break;
    }
    case EV.over: if (a >= 0) confetti(col(a)); break;
    case EV.gone: burst(x, y, 12, ["#8a8098", "#ffffff"], 30, 0.5, 1, 2); feedLine(-1, a, "gone"); break;
  }
}
function confetti(c) {
  if (isDemo()) return;
  const cols = [c, "#ffffff", "#ffd23f", hex(mix(rgb(c), WHITE, 0.45))];
  for (let i = 0; i < 70; i++) part(Math.random() * GW, AY0 - Math.random() * 30, (Math.random() - 0.5) * 30, 25 + Math.random() * 35, 2.4 + Math.random(), cols[i % 4], Math.random() < 0.3 ? 2 : 1, 0, 3);
}
function stepFX(dt) {
  for (const p of FX.parts) {
    p.life -= dt;
    if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
    if (p.kind === 3) { p.vx += Math.sin(p.life * 7 + p.x) * 30 * dt; p.vy = Math.min(p.vy + 10 * dt, 40); }
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  FX.parts = FX.parts.filter(p => p.life > 0);
  for (const r of FX.rings) { r.life -= dt; r.r = Math.max(0, r.r + r.vr * dt); }
  FX.rings = FX.rings.filter(r => r.life > 0);
  for (const d of FX.debris) {
    d.life -= dt; const f = Math.exp(-1.2 * dt); d.vx *= f; d.vy *= f; d.x += d.vx * dt; d.y += d.vy * dt; d.a += d.va * dt;
    if (Math.random() < dt * 30) part(d.x, d.y, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 0.45, Math.random() < 0.4 ? "#ff9a3c" : "#5d5470", 1, 1, 2);
  }
  FX.debris = FX.debris.filter(d => d.life > 0);
  for (const b of FX.blasts) b.t += dt;
  FX.blasts = FX.blasts.filter(b => b.t < (b.small ? 0.3 : 0.5));
  for (const g of FX.ghosts) { g.t += dt; g.y -= dt * 10; }
  FX.ghosts = FX.ghosts.filter(g => g.t < 1.3);
  for (const l of FX.labels) { l.t += dt; l.y -= dt * 10; }
  FX.labels = FX.labels.filter(l => l.t < 1.4);
  for (const f of FX.feed) f.t += dt;
  FX.feed = FX.feed.filter(f => f.t < 4.5);
  FX.shake = Math.max(0, FX.shake - dt * 1.8); FX.flash = Math.max(0, FX.flash - dt * 2.2);
  if (FX.banner && (FX.banner.t += dt) > FX.banner.dur) FX.banner = null;
}
/// Effects read off the picture itself, the same on the opener's Mac and the others': muzzle flashes for
/// new shots, sparks where shots stop, shards where crystal breaks, flames and trails behind rockets.
function observe(V, dt) {
  const pv = FX.prev, now = performance.now() / 1000;
  if (pv && pv.round === V.round) {
    const old = new Map(pv.B.map(b => [b.id, b])), cur = new Set();
    for (const b of V.B) {
      cur.add(b.id);
      if (old.has(b.id)) continue;
      FX.born.set(b.id, now);
      const c = b.k ? "#bff6ff" : colorOf2(b.o);
      burst(b.x, b.y, 3, ["#ffffff", c], 30, 0.15, 1, 3);
      part(b.x, b.y, 0, 0, 0.06, "#ffffff", 3, 0, 4);
    }
    for (const b of pv.B) if (!cur.has(b.id)) {
      const t0 = FX.born.get(b.id), age = t0 === undefined ? 0 : now - t0;
      FX.born.delete(b.id);
      if (age < (b.rico ? RICO_LIFE : SHOT_LIFE) - 0.12) { burst(b.x, b.y, 5, ["#ffffff", colorOf2(b.o), "#ffe7a8"], 45, 0.22, 1, 3); ring(b.x, b.y, 1, 16, 0.15, "#ffffff"); }
    }
    const cr = ARENAS[V.arena].crystals, C = THEMES[ARENAS[V.arena].id].cry;
    for (let j = 0; j < cr.length; j++) if (pv.mask[j] && !V.mask[j]) {
      const x = AX0 + (cr[j] % COLS) * TS + TS / 2, y = AY0 + Math.floor(cr[j] / COLS) * TS + TS / 2;
      burst(x, y, 12, [hex(C[3]), hex(C[2]), hex(C[4]), hex(C[1])], 55, 0.6, 1, 2.5);
      for (let i = 0; i < 3; i++) { const a = Math.random() * TAU; FX.debris.push({ x, y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, a, va: (Math.random() - 0.5) * 12, life: 0.5, c: hex(C[2]), w: 2, h: 2, cold: 1 }); }
      ring(x, y, 2, 30, 0.2, hex(C[4]));
    }
    const ou = new Set(pv.U.map(u => u.id));
    for (const u of V.U) if (!ou.has(u.id)) { ring(u.x, u.y, 16, -36, 0.4, POWERS[u.type].c); ring(u.x, u.y, 2, 30, 0.3, "#ffffff"); }
    // rockets rubbing against each other throw sparks
    for (let i = 0; i < V.P.length; i++) for (let j = i + 1; j < V.P.length; j++) {
      const p = V.P[i], q = V.P[j];
      if (p.mode !== 1 || q.mode !== 1 || Math.hypot(p.x - q.x, p.y - q.y) > SHIP_R * 2 + 1) continue;
      const key = i * 8 + j;
      if (now - (FX.bump[key] || 0) > 0.3) { FX.bump[key] = now; burst((p.x + q.x) / 2, (p.y + q.y) / 2, 8, ["#ffffff", "#ffe7a8", "#ffb347"], 60, 0.25, 1, 2); FX.shake = Math.max(FX.shake, 0.15); }
    }
  } else if (pv && pv.round !== V.round) { FX.born.clear(); FX.trails = []; }
  // engines: a flame and a little smoke behind every rocket; a puff of the jetpack behind pilots
  const live = V.ph === "fight" || V.ph === "end";
  V.P.forEach((p, i) => {
    const tr = FX.trails[i] || (FX.trails[i] = []);
    if (p.mode !== 1 || !live) { tr.length = 0; }
    if (p.mode === 1 && live && !p.frozen) {
      const bx2 = p.x - Math.cos(p.a) * 7.5, by2 = p.y - Math.sin(p.a) * 7.5;
      if (Math.random() < dt * 70) part(bx2 + (Math.random() - 0.5) * 1.5, by2 + (Math.random() - 0.5) * 1.5, -Math.cos(p.a) * 30 + (Math.random() - 0.5) * 14, -Math.sin(p.a) * 30 + (Math.random() - 0.5) * 14, 0.22, FIRE[1 + Math.floor(Math.random() * 4)], 1, 3, 5);
      if (Math.random() < dt * 14) part(bx2, by2, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, 0.6, "#3a3346", 1, 1.5, 2);
      tr.push([p.x - Math.cos(p.a) * 6, p.y - Math.sin(p.a) * 6]); if (tr.length > 14) tr.shift();
    }
    if (p.mode === 2 && p.puff && Math.random() < dt * 60) part(p.x - Math.cos(p.a) * 3, p.y - Math.sin(p.a) * 3, -Math.cos(p.a) * 25 + (Math.random() - 0.5) * 10, -Math.sin(p.a) * 25 + (Math.random() - 0.5) * 10, 0.3, Math.random() < 0.5 ? "#ffffff" : "#bfe6ff", 1, 3);
    if (p.charge && Math.random() < dt * 50) { const a = Math.random() * TAU, nx = p.x + Math.cos(p.a) * 7, ny = p.y + Math.sin(p.a) * 7; part(nx + Math.cos(a) * 9, ny + Math.sin(a) * 9, -Math.cos(a) * 40, -Math.sin(a) * 40, 0.22, "#ff9ff0", 1, 0); }
    if (p.frozen && Math.random() < dt * 8) part(p.x + (Math.random() - 0.5) * 8, p.y + (Math.random() - 0.5) * 8, 0, 6, 0.6, "#ffffff", 1, 0);
  });
  // Gravewell: dust spiralling in
  if (ARENAS[V.arena].id === "well" && Math.random() < dt * 25) {
    const a = Math.random() * TAU, r = 30 + Math.random() * 14;
    part(MX + Math.cos(a) * r, MY + Math.sin(a) * r, -Math.sin(a) * 34 - Math.cos(a) * 16, Math.cos(a) * 34 - Math.sin(a) * 16, 0.9, Math.random() < 0.5 ? "#ffb060" : "#ff7040", 1, 0.6, 6);
  }
  FX.prev = V;
}

// ---------- drawing ----------
let buf = null, bx = null;
function ensureBuf() { if (!buf) { buf = canvasOf(GW, GH); bx = buf.getContext("2d"); bx.imageSmoothingEnabled = false; } }
const px = (x, y, w, h, c) => { bx.fillStyle = c; bx.fillRect(Math.round(x), Math.round(y), w, h); };
/// A line of square pixels, Bresenham's way.
function pline(x0, y0, x1, y1, c, s) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1); s = s || 1;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, o = s >> 1;
  let err = dx + dy;
  bx.fillStyle = c;
  for (let n = 0; n < 500; n++) {
    bx.fillRect(x0 - o, y0 - o, s, s);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
/// A ring of pixels.
function pring(x, y, r, c) {
  bx.fillStyle = c;
  const n = Math.max(8, Math.round(r * 6));
  for (let i = 0; i < n; i++) { const a = i / n * TAU; bx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1); }
}
/// A soft round glow, added to what is under it.
function glow(x, y, r, c, a) {
  const key = `glow|${r}|${c}`;
  const g = pic(key, () => { const S = r * 2 + 1, P = painter(S, S), C = rgb(c); for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const d = Math.hypot(i - r, j - r) / (r + 0.5); if (d < 1) P.set(i, j, C, (1 - d) * (1 - d)); } return P.canvas(); });
  bx.globalCompositeOperation = "lighter"; bx.globalAlpha = a === undefined ? 1 : a;
  bx.drawImage(g, Math.round(x - r), Math.round(y - r));
  bx.globalCompositeOperation = "source-over"; bx.globalAlpha = 1;
}
function rbDraw(t) {
  ensureBuf();
  gx.imageSmoothingEnabled = false;
  const V = RB.view;
  if (!V) {
    bx.fillStyle = "#0b0816"; bx.fillRect(0, 0, GW, GH);
    ptext("ROCKET RUMPUS", GW / 2, 70, 3, "#fff2a8", "#ff8f3c", "center");
    gx.drawImage(buf, 0, 0);
    gtext(`${RB.ownerName || "The opener"} is lighting the engines…`, GW / 2, 110, "#a79d93", 8, "center");
    return;
  }
  const A = ARENAS[V.arena], sh = FX.shake, sx = sh > 0 ? Math.round((Math.random() - 0.5) * sh * 7) : 0, sy = sh > 0 ? Math.round((Math.random() - 0.5) * sh * 5) : 0;
  bx.save(); bx.translate(sx, sy);
  drawArena(V, A, t);
  drawThings(V, t);
  bx.restore();
  bx.drawImage(arenaBg(V.arena), 0, 0, GW, AY0 - 1, 0, 0, GW, AY0 - 1);     // the score bar's panel again: nothing flies over it
  drawHUD(V, t);
  drawBanner(t);
  drawOverlays(V, t);
  gx.drawImage(buf, 0, 0);
  if (FX.flash > 0) { gx.globalAlpha = Math.min(0.5, FX.flash); gpx(0, 0, GW, GH, FX.flashC); gx.globalAlpha = 1; }
  drawTexts(V, t);
}
function drawArena(V, A, t) {
  bx.drawImage(arenaBg(V.arena), 0, 0);
  // stars twinkle
  if (A.id !== "rotor") for (let i = 0; i < 26; i++) {
    const x = AX0 + Math.floor(nhash(i, 1, V.arena) * (AX1 - AX0)), y = AY0 + Math.floor(nhash(i, 2, V.arena) * (AY1 - AY0)), b = 0.5 + 0.5 * Math.sin(t * (1.5 + nhash(i, 3, 0) * 3) + i);
    if (b > 0.55) { bx.globalAlpha = b; px(x, y, 1, 1, "#ffffff"); if (b > 0.93) { px(x - 1, y, 3, 1, "#cfe0ff"); px(x, y - 1, 1, 3, "#cfe0ff"); } bx.globalAlpha = 1; }
  }
  if (A.id === "well") {
    glow(MX, MY, 30, "#ff6a30", 0.25 + 0.05 * Math.sin(t * 2));
    bx.drawImage(holePic(Math.floor(t * 14) % 16), MX - 42, MY - 42);
  }
  if (FX.decal) bx.drawImage(FX.decal, 0, 0);
  // the crystal still standing, glowing softly
  const cr = A.crystals;
  for (let j = 0; j < cr.length; j++) if (V.mask[j]) {
    const k = cr[j], x = AX0 + (k % COLS) * TS, y = AY0 + Math.floor(k / COLS) * TS;
    bx.drawImage(crystalPic(V.arena, (k * 7) % 3), x, y);
    if (A.id !== "rotor" && (k * 13 + Math.floor(t * 2)) % 23 === 0) px(x + 2 + (k % 3), y + 2, 1, 1, "#ffffff");
  }
  if (A.id !== "rotor") for (let j = 0; j < cr.length; j += 3) if (V.mask[j]) { const k = cr[j]; glow(AX0 + (k % COLS) * TS + 4, AY0 + Math.floor(k / COLS) * TS + 4, 6, hex(THEMES[A.id].cry[2]), 0.12 + 0.05 * Math.sin(t * 2 + j)); }
  if (A.id === "rotor") {
    for (let k = 0; k < 2; k++) bx.drawImage(pistonPic(), PIST[k] - PIST_H, Math.round(pistonY(k, V.rt)) - PIST_H);
    const th = wrapA(rotorA(V.rt)), q = Math.PI / 2, fr = Math.round((th % q) / q * 64) % 64, rp = rotorPic(fr);
    bx.drawImage(rp, Math.round(MX - rp.width / 2), Math.round(MY - rp.height / 2));
    if (Math.floor(t * 3) % 2) glow(MX, MY, 5, "#ffb030", 0.6);
  }
  if (A.id === "well") V.R.forEach((r, i) => { const p = rockPic(i, Math.floor(wrapA(V.rt * (0.6 + i * 0.25) * (i % 2 ? -1 : 1)) / TAU * 32) % 32); bx.drawImage(p, Math.round(r.x - p.width / 2), Math.round(r.y - p.height / 2)); });
  // the fence: a line of light with emitters along it
  const fc = hex(THEMES[A.id].fence);
  if (V.sd <= 0) {
    if (A.id !== "rotor") {
      bx.globalAlpha = 0.5 + 0.15 * Math.sin(t * 3);
      px(AX0, AY0, AX1 - AX0, 1, fc); px(AX0, AY1 - 1, AX1 - AX0, 1, fc); px(AX0, AY0, 1, AY1 - AY0, fc); px(AX1 - 1, AY0, 1, AY1 - AY0, fc);
      bx.globalAlpha = 1;
      for (let x = AX0; x <= AX1; x += 26) { px(x - 1, AY0 - 1, 3, 2, "#2a2440"); px(x - 1, AY1 - 1, 3, 2, "#2a2440"); px(x, AY0, 1, 1, fc); px(x, AY1 - 1, 1, 1, fc); }
      const s = (t * 60) % ((AX1 - AX0) * 2 + (AY1 - AY0) * 2), per = AX1 - AX0;
      const at = d => d < per ? [AX0 + d, AY0] : d < per + (AY1 - AY0) ? [AX1 - 1, AY0 + d - per] : d < per * 2 + (AY1 - AY0) ? [AX1 - 1 - (d - per - (AY1 - AY0)), AY1 - 1] : [AX0, AY1 - 1 - (d - per * 2 - (AY1 - AY0))];
      for (const o of [0, 333, 666]) { const [x, y] = at((s + o) % (per * 2 + (AY1 - AY0) * 2)); glow(x, y, 3, fc, 0.8); px(x, y, 1, 1, "#ffffff"); }
    }
  }
}
function drawThings(V, t) {
  const now = performance.now() / 1000;
  // power-ups: capsules bobbing, glowing, blinking as they run out
  for (const u of V.U) {
    if (u.life < 2.5 && Math.floor(t * 8) % 2) continue;
    const y = u.y + Math.sin(t * 3 + u.id) * 1.5;
    glow(u.x, y, 9, POWERS[u.type].c, 0.35 + 0.15 * Math.sin(t * 5));
    bx.drawImage(capsulePic(u.type), Math.round(u.x - 7.5), Math.round(y - 7.5));
    const a = t * 2 + u.id; px(u.x + Math.cos(a) * 9, y + Math.sin(a) * 9, 1, 1, "#ffffff");
  }
  for (const m of V.M) {
    const lit = m.armed && Math.floor(t * 4 + m.id) % 2;
    if (lit) glow(m.x, m.y, 6, "#ff3020", 0.5);
    bx.drawImage(minePic(colorOf2(m.o), lit ? 1 : 0), Math.round(m.x - 4.5), Math.round(m.y - 4.5));
  }
  // trails behind rockets: a fading streak of their colour
  FX.trails.forEach((tr, i) => {
    if (!tr || tr.length < 2) return;
    for (let k = 1; k < tr.length; k++) if (Math.abs(tr[k][0] - tr[k - 1][0]) + Math.abs(tr[k][1] - tr[k - 1][1]) < 10) { bx.globalAlpha = (k / tr.length) * 0.35; pline(tr[k - 1][0], tr[k - 1][1], tr[k][0], tr[k][1], colorOf2(i)); }
    bx.globalAlpha = 1;
  });
  // smoke under everything that flies
  for (const p of FX.parts) if (p.kind === 2) { bx.globalAlpha = Math.min(0.6, p.life / p.max); px(p.x, p.y, p.s, p.s, p.c); }
  bx.globalAlpha = 1;
  // pilots, then rockets
  V.P.forEach((p, i) => {
    if (p.mode !== 2) return;
    const c = colorOf2(i), f = Math.floor(t * (p.puff ? 14 : 5) + i) % 2;
    if (p.inv && Math.floor(t * 20) % 2) return;
    bx.drawImage(pilotPic(c, Math.round(wrapA(p.a) / TAU * PILOT_N) % PILOT_N, f), Math.round(p.x - PILOT_S / 2), Math.round(p.y - PILOT_S / 2));
    if (p.frozen) { bx.globalAlpha = 0.5; pring(p.x, p.y, 4, "#bff6ff"); bx.globalAlpha = 1; }
    // the countdown to a new rocket: a ring filling round them
    if (V.sd <= 0 && V.ph === "fight") {
      const f2 = clamp(p.tm / RESPAWN, 0, 1), n = Math.round(f2 * 16);
      for (let k = 0; k < 16; k++) { const a = -Math.PI / 2 + k / 16 * TAU; px(p.x + Math.cos(a) * 7, p.y + Math.sin(a) * 7, 1, 1, k < n ? c : "#ffffff22"); }
    }
  });
  const ready = V.ph === "ready";
  V.P.forEach((p, i) => {
    if (p.mode !== 1) return;
    const c = colorOf2(i), k = shipIdx(p.a);
    if (ready) {
      // warping in: a column of light, the rocket flickering into place
      const f = clamp((V.phT - 0.2) / 1.0, 0, 1);
      bx.globalAlpha = 0.5 * (1 - f); px(p.x - 3, AY0, 7, AY1 - AY0, c); bx.globalAlpha = 1;
      glow(p.x, p.y, 10, c, 0.6 * (1 - f) + 0.2);
      if (f < 1 && Math.floor(t * 30) % 3 === 0) return;
      bx.globalAlpha = 0.35 + 0.65 * f;
    }
    if (!ready && !p.frozen) {
      // the engine: a flickering flame out of the bell
      const hx = Math.cos(p.a), hy = Math.sin(p.a), fl = 2 + (Math.floor(t * 30 + i * 3) % 3);
      glow(p.x - hx * 8, p.y - hy * 8, 4, "#ff9a3c", 0.55);
      pline(p.x - hx * 7.5, p.y - hy * 7.5, p.x - hx * (7.5 + fl), p.y - hy * (7.5 + fl), "#ff8a2e");
      pline(p.x - hx * 7.5, p.y - hy * 7.5, p.x - hx * (7.5 + fl * 0.5), p.y - hy * (7.5 + fl * 0.5), "#fff3b0");
    }
    if (p.inv && !ready && Math.floor(t * 16) % 2) bx.globalAlpha = 0.45;
    bx.drawImage(shipPic(c, k, p.frozen ? "ice" : ""), Math.round(p.x - SHIP_S / 2), Math.round(p.y - SHIP_S / 2));
    bx.globalAlpha = 1;
    if (p.charge) { glow(p.x + Math.cos(p.a) * 7, p.y + Math.sin(p.a) * 7, 7, "#ff4fd8", 0.7 + 0.3 * Math.sin(t * 40)); px(p.x + Math.cos(p.a) * 7 - 1, p.y + Math.sin(p.a) * 7 - 1, 2, 2, "#ffffff"); }
    if (p.shield) {
      const blink = p.tm < 2 && Math.floor(t * 8) % 2;
      if (!blink) { bx.globalAlpha = 0.55; pring(p.x, p.y, 8, "#7dffb0"); bx.globalAlpha = 0.25; pring(p.x, p.y, 7, "#bfffe0"); bx.globalAlpha = 1; const a = t * 3; px(p.x + Math.cos(a) * 8 - 0.5, p.y + Math.sin(a) * 8 - 0.5, 1, 1, "#ffffff"); }
    }
    if (p.rico) { const a = -t * 4; px(p.x + Math.cos(a) * 7, p.y + Math.sin(a) * 7, 1, 1, "#b98bff"); px(p.x - Math.cos(a) * 7, p.y - Math.sin(a) * 7, 1, 1, "#d8c0ff"); }
    // ammo: three pips under the rocket, the next one filling
    if (!ready) for (let n = 0; n < AMMO; n++) {
      const x = Math.round(p.x) - 4 + n * 3, y = Math.round(p.y) + 8;
      px(x, y, 2, 1, n < p.ammo ? c : n === p.ammo && p.rel > 0.5 ? "#ffffff55" : "#00000088");
    }
    if (p.pw >= 0 && !ready) { bx.globalAlpha = 0.9; bx.drawImage(iconPic(p.pw), Math.round(p.x + 5), Math.round(p.y - 12)); bx.globalAlpha = 1; }
  });
  // shots: a glow, a bright core and a short tail
  const tails = FX.tails || (FX.tails = new Map()), seen = new Map();
  for (const b of V.B) {
    const c = b.k ? "#8fe3ff" : colorOf2(b.o), o = tails.get(b.id);
    // the tail: back along the way it came since the last frame, twice as long
    if (o && Math.abs(o[0] - b.x) + Math.abs(o[1] - b.y) < 14) { bx.globalAlpha = 0.45; pline(b.x + (o[0] - b.x) * 2.2, b.y + (o[1] - b.y) * 2.2, b.x, b.y, c); bx.globalAlpha = 1; }
    seen.set(b.id, [b.x, b.y]);
    glow(b.x, b.y, b.k ? 5 : 4, c, 0.75);
    if (b.k) { px(b.x - 1, b.y - 1, 3, 3, "#bff6ff"); px(b.x, b.y, 1, 1, "#ffffff"); }
    else { px(b.x - 1, b.y, 3, 1, c); px(b.x, b.y - 1, 1, 3, c); px(b.x, b.y, 1, 1, "#ffffff"); }
    if (b.rico) px(b.x - 1, b.y - 1, 1, 1, "#d8c0ff");
  }
  FX.tails = seen;
  // lance beams
  for (const L of V.L) {
    const f = clamp(L.t / LANCE_T, 0, 1), c = colorOf2(L.o), w = f > 0.6 ? 3 : 1, wob = Math.floor(performance.now() / 40) % 2;
    bx.globalAlpha = 0.25 + 0.3 * f; pline(L.x0, L.y0, L.x1, L.y1, "#ff4fd8", w + 2 + wob); bx.globalAlpha = 1;
    if (w > 1) pline(L.x0, L.y0, L.x1, L.y1, c, w);
    pline(L.x0, L.y0, L.x1, L.y1, "#ffffff", 1);
    glow(L.x1, L.y1, 8, "#ff4fd8", f); glow(L.x0, L.y0, 6, "#ffffff", f);
    if (Math.random() < 0.8) { const k = Math.random(); burst(L.x0 + (L.x1 - L.x0) * k, L.y0 + (L.y1 - L.y0) * k, 1, ["#ffffff", "#ff9ff0"], 30, 0.2, 1, 3); }
  }
  // flames, sparks, debris, rings, the ghosts of pilots
  bx.globalCompositeOperation = "lighter";
  for (const p of FX.parts) if (p.kind === 1 || p.kind === 5 || p.kind === 6 || p.kind === 4) {
    const f = p.life / p.max;
    bx.globalAlpha = Math.min(1, f * 1.5);
    const c = p.kind === 1 ? FIRE[Math.min(FIRE.length - 1, Math.floor((1 - f) * FIRE.length))] : p.c;
    if (p.kind === 4) glow(p.x, p.y, 4, "#ffffff", f); else px(p.x, p.y, p.s, p.s, c);
  }
  bx.globalCompositeOperation = "source-over"; bx.globalAlpha = 1;
  for (const p of FX.parts) if (p.kind === 0 || p.kind === 3) { bx.globalAlpha = Math.min(1, p.life / p.max * 2); px(p.x, p.y, p.s, p.s, p.c); }
  bx.globalAlpha = 1;
  for (const d of FX.debris) {
    bx.save(); bx.translate(Math.round(d.x), Math.round(d.y)); bx.rotate(Math.round(d.a / (Math.PI / 4)) * Math.PI / 4);
    bx.fillStyle = "#140e20"; bx.fillRect(-d.w / 2 - 1, -d.h / 2 - 1, d.w + 2, d.h + 2); bx.fillStyle = d.c; bx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
    bx.restore();
  }
  for (const b of FX.blasts) {
    if (b.t < 0) continue;
    if (b.t < 0.08 && !b.small) glow(b.x, b.y, b.big ? 22 : 14, "#ffe7a0", 1 - b.t / 0.08);
    const f = Math.min(9, Math.floor(b.t / (b.small ? 0.03 : 0.05))), pic2 = fireballPic(f, b.big);
    bx.drawImage(pic2, Math.round(b.x - pic2.width / 2), Math.round(b.y - pic2.height / 2));
  }
  for (const r of FX.rings) { bx.globalAlpha = r.life / r.max; pring(r.x, r.y, r.r, r.c); if (r.w > 1) pring(r.x, r.y, r.r + 1, r.c); }
  bx.globalAlpha = 1;
  for (const g of FX.ghosts) {
    bx.globalAlpha = 1 - g.t / 1.3;
    const x = Math.round(g.x), y = Math.round(g.y);
    px(x - 1, y - 2, 3, 3, "#e8e4f0"); px(x, y - 1, 2, 1, g.c); px(x - 2, y + 1, 1, 1, "#e8e4f0"); px(x + 2, y + 1, 1, 1, "#e8e4f0");
    bx.globalAlpha = 1;
  }
  // sudden death: outside the closing fence it is dark, the fence itself crackles red
  if (V.sd > 0) {
    const F = fence(V.sd), f0 = F.map(Math.round);
    bx.globalAlpha = 0.6; bx.fillStyle = "#1a0408";
    bx.fillRect(AX0, AY0, AX1 - AX0, f0[1] - AY0); bx.fillRect(AX0, f0[3], AX1 - AX0, AY1 - f0[3]);
    bx.fillRect(AX0, f0[1], f0[0] - AX0, f0[3] - f0[1]); bx.fillRect(f0[2], f0[1], AX1 - f0[2], f0[3] - f0[1]);
    bx.globalAlpha = 1;
    const fl = 0.7 + 0.3 * Math.sin(t * 30);
    bx.globalAlpha = fl;
    px(f0[0], f0[1], f0[2] - f0[0], 1, "#ff3b3b"); px(f0[0], f0[3] - 1, f0[2] - f0[0], 1, "#ff3b3b"); px(f0[0], f0[1], 1, f0[3] - f0[1], "#ff3b3b"); px(f0[2] - 1, f0[1], 1, f0[3] - f0[1], "#ff3b3b");
    bx.globalAlpha = 1;
    for (let k = 0; k < 6; k++) {
      const side = (k + Math.floor(t * 9)) % 4, r = Math.random();
      const x = side < 2 ? f0[0] + r * (f0[2] - f0[0]) : side === 2 ? f0[0] : f0[2] - 1, y = side >= 2 ? f0[1] + r * (f0[3] - f0[1]) : side === 0 ? f0[1] : f0[3] - 1;
      px(x, y, 1, 1, "#ffffff"); glow(x, y, 3, "#ff3b3b", 0.6);
    }
  }
  for (const l of FX.labels) { bx.globalAlpha = l.t > 1 ? (1.4 - l.t) / 0.4 : 1; ptext(l.text, l.x, l.y, 1, "#ffffff", l.c, "center"); bx.globalAlpha = 1; }
}
/// The score bar: each player's rocket (or pilot, or a cross when out), the rounds they have won.
function drawHUD(V, t) {
  const n = V.P.length; if (!n) return;
  if (isDemo()) {
    // behind the title and the lobby: the six rockets parade along the bar
    for (let i = 0; i < COLORS.length; i++) {
      const x = ((t * 22 + i * 56) % (GW + 40)) - 20, y = 9 + Math.sin(t * 2 + i) * 1.5;
      for (let f = 1; f < 5; f++) { bx.globalAlpha = 0.5 - f * 0.1; px(x - 7 - f * 2, y, 2, 1, f < 2 ? "#ffd25a" : COLORS[i]); }
      bx.globalAlpha = 1;
      bx.drawImage(shipPic(COLORS[i], 0, ""), Math.round(x - 9.5), Math.round(y - 9.5));
    }
    return;
  }
  const cw = Math.floor((GW - 4) / n), win = (RB.mset || RB.set).wn, me = isDemo() ? -1 : myIdx();
  V.P.forEach((p, i) => {
    const x0 = 2 + i * cw, c = colorOf2(i), out = !p.mode;
    if (i === me) { px(x0, 1, cw - 2, AY0 - 4, "#2a2040"); px(x0, AY0 - 3, cw - 2, 1, c); }
    if (out) { bx.globalAlpha = 0.35; bx.drawImage(shipPic(c, 0, ""), x0 - 2, 0); bx.globalAlpha = 1; px(x0 + 4, 5, 1, 1, "#ff6060"); pline(x0 + 4, 5, x0 + 10, 11, "#ff6060"); pline(x0 + 10, 5, x0 + 4, 11, "#ff6060"); }
    else if (p.mode === 2) bx.drawImage(pilotPic(c, 12, Math.floor(t * 4) % 2), x0 + 2, 2);
    else bx.drawImage(shipPic(c, 0, p.frozen ? "ice" : ""), x0 - 2, 0);
    const pip = Math.min(win, Math.max(3, Math.floor((cw - 20) / 4)));
    for (let k = 0; k < win; k++) {
      const x = x0 + 17 + (k % pip) * 4, y = 12 + Math.floor(k / pip) * 3;
      if (k < (V.score[i] || 0)) { px(x, y, 3, 2, c); px(x, y, 1, 1, "#ffffff"); } else px(x, y, 3, 2, "#3a3050");
    }
  });
}
/// Words in the shell's own text (sharp at any size), over the blown-up pixels: names in the score bar,
/// "YOU" and names over the rockets as a round starts, the lobby's list, the podium's names, the title's hints.
function drawTexts(V, t) {
  const n = V.P.length, cw = Math.floor((GW - 4) / Math.max(1, n)), me = isDemo() ? -1 : myIdx();
  if (!isDemo()) V.P.forEach((p, i) => {
    const x0 = 2 + i * cw, nm = String(nameOf(i)).slice(0, Math.max(3, Math.floor((cw - 20) / 3.4)));
    gtext(nm, x0 + 17, 3, p.mode ? (i === me ? "#ffffff" : "#d8d0e8") : "#6a6080", 5);
  });
  if (RB.phase === "pick") {
    gtext("2 to 6 rockets · one key turns, one key fires", GW / 2, 145, "#ffe7a8", 7, "center");
    gtext("open a match or play the bots: on the right →", GW / 2, 155, "#c9c0b6", 6, "center");
    return;
  }
  if (RB.phase === "lobby") {
    const y0 = 34;
    RB.players.forEach((p, i) => {
      gtext(p.name.slice(0, 22) + (p.id === myId() ? " (you)" : ""), GW / 2 - 70, y0 + 31 + i * 14, colorOf2(i), 7);
      gtext(p.b ? DIFFS[RB.set.df].name.toLowerCase() + " bot" : p.c ? SEATS[p.c]["k" + RB.set.tn] : "", GW / 2 + 90, y0 + 32 + i * 14, "#a79d93", 5, "right");
    });
    gtext(amHost() ? "add bots or couch players, then Start (on the right)" : `waiting for ${RB.ownerName} to start`, GW / 2, y0 + 40 + RB.players.length * 14, "#a79d93", 6, "center");
    return;
  }
  if (V.ph === "over" || RB.phase === "done") {
    const order = podiumOrder(V), xs = [GW / 2, GW / 2 - 66, GW / 2 + 66], hs = [40, 28, 20];
    order.slice(0, 3).forEach((i, k) => {
      gtext(String(nameOf(i)).slice(0, 14), xs[k], 172, colorOf2(i), 6, "center");
      gtext(`★ ${V.score[i] || 0}  ✕ ${V.kills[i] || 0}`, xs[k], 180, "#c9c0b6", 5, "center");
    });
    order.slice(3).forEach((i, k) => gtext(`${k + 4}. ${String(nameOf(i)).slice(0, 12)}  ★${V.score[i] || 0} ✕${V.kills[i] || 0}`, 20, 58 + k * 10, colorOf2(i), 5));
    return;
  }
  // the kill feed, top right under the bar: who got whom, and how
  FX.feed.forEach((f, n2) => {
    const y = AY0 + 3 + n2 * 8, a = f.t > 4 ? (4.5 - f.t) / 0.5 : 1;
    const parts = [[shortName(f.v), colorOf2(f.v)], [{ boom: "✸", splat: "✚", squash: "⤓", hole: "◉", fence: "▥", gone: "↯" }[f.how] || "✸", "#ffd25a"]];
    if (f.k >= 0 && f.k !== f.v) parts.push([shortName(f.k), colorOf2(f.k)]);
    gx.font = "5px Menlo, monospace";
    const w = parts.reduce((s2, [txt]) => s2 + gx.measureText(txt).width + 3, 4);
    gx.globalAlpha = a * 0.7; gpx(GW - 4 - w, y - 1, w, 7, "#0b0816"); gx.globalAlpha = a;
    let x = GW - 6;
    for (const [txt, c] of parts) { gtext(txt, x, y, c, 5, "right"); x -= gx.measureText(txt).width + 3; }
    gx.globalAlpha = 1;
  });
  if (V.ph === "ready" || V.ph === "fight" && V.phT < 1.2) V.P.forEach((p, i) => {
    if (!p.mode) return;
    const lab = i === me ? "YOU" : String(nameOf(i)).slice(0, 8), y = (p.y - 16 < AY0 + 1 ? p.y + 10 : p.y - 16) + Math.sin(t * 6);
    gtext(lab, p.x, y, i === me ? "#ffffff" : colorOf2(i), 5, "center");
  });
}
function podiumOrder(V) {
  const order = V.P.map((p, i) => i).sort((a, b) => ((V.score[b] || 0) - (V.score[a] || 0)) || ((V.kills[b] || 0) - (V.kills[a] || 0)));
  if (V.champ >= 0) { const k = order.indexOf(V.champ); if (k > 0) { order.splice(k, 1); order.unshift(V.champ); } }
  return order;
}
function drawBanner(t) {
  const B = FX.banner; if (!B) return;
  const s = B.t < 0.08 ? B.s + 2 : B.t < 0.16 ? B.s + 1 : B.s, fade = B.dur - B.t < 0.3 ? (B.dur - B.t) / 0.3 : 1;
  bx.globalAlpha = fade;
  const y = 72 - s * 3;
  bx.globalAlpha = fade * 0.55; px(0, y - 4, GW, 7 * s + 10 + (B.sub ? 12 : 0), "#06040c"); bx.globalAlpha = fade;
  ptext(B.text, GW / 2, y, s, B.top, B.bot, "center", "#120a18", "#06040c");
  if (B.sub) ptext(B.sub, GW / 2, y + 7 * s + 5, 1, "#ffffff", "#ffd27a", "center");
  bx.globalAlpha = 1;
}
function drawOverlays(V, t) {
  if (RB.phase === "pick") {
    // the title over the bots' fight
    bx.globalAlpha = 0.5; px(0, AY0, GW, AY1 - AY0, "#06040c"); bx.globalAlpha = 1;
    const bob = Math.round(Math.sin(t * 2) * 2);
    ptext("ROCKET", GW / 2, 42 + bob, 5, "#fff6c8", "#ff9a2e", "center", "#2a0e06");
    ptext("RUMPUS", GW / 2, 86 + bob, 4, "#ffd0f4", "#c45cff", "center", "#1a0630");
    // a rocket looping round the title, a shot after it
    const a = t * 1.6, rx = GW / 2 + Math.cos(a) * 118, ry = 78 + Math.sin(a) * 52, ha = a + Math.PI / 2;
    bx.drawImage(shipPic(COLORS[0], shipIdx(ha), ""), Math.round(rx - 9.5), Math.round(ry - 9.5));
    const b2 = a - 0.35; glow(GW / 2 + Math.cos(b2) * 118, 78 + Math.sin(b2) * 52, 4, COLORS[1], 0.8);
    bx.globalAlpha = 0.8; px(0, 140, GW, 26, "#06040c"); bx.globalAlpha = 1;
    px(0, 140, GW, 1, "#3a2f50"); px(0, 165, GW, 1, "#3a2f50");
    return;
  }
  if (RB.phase === "lobby") {
    bx.globalAlpha = 0.6; px(0, AY0, GW, AY1 - AY0, "#06040c"); bx.globalAlpha = 1;
    const n = RB.players.length, w = 200, h = 34 + n * 14, x0 = (GW - w) / 2, y0 = 34;
    px(x0, y0, w, h, "#120d1e"); px(x0, y0, w, 1, "#ffd27a"); px(x0, y0 + h - 1, w, 1, "#3a2f50");
    ptext("LOBBY", GW / 2, y0 + 6, 2, "#ffffff", "#9fb4ff", "center");
    RB.players.forEach((p, i) => { bx.drawImage(shipPic(colorOf2(i), shipIdx(t * 0.8 + i), ""), x0 + 10, y0 + 26 + i * 14); });
    return;
  }
  if (V.ph === "over" || RB.phase === "done") drawPodium(V, t);
}
/// The match's end: the top three on a podium, the winner on the high step, rockets hovering, confetti.
function drawPodium(V, t) {
  bx.globalAlpha = 0.72; px(0, AY0, GW, AY1 - AY0, "#06040c"); bx.globalAlpha = 1;
  const order = podiumOrder(V);
  ptext(V.champ >= 0 ? `${shortName(V.champ)} WINS THE MATCH` : "MATCH OVER", GW / 2, 26, 2, "#fff6b0", "#ff8f1f", "center");
  const steps = [{ x: GW / 2, h: 40, c: [255, 210, 80] }, { x: GW / 2 - 66, h: 28, c: [200, 206, 222] }, { x: GW / 2 + 66, h: 20, c: [214, 140, 80] }];
  order.slice(0, 3).forEach((i, k) => {
    const S = steps[k], top = 170 - S.h, c = colorOf2(i);
    if (k === 0) { bx.globalAlpha = 0.16 + 0.04 * Math.sin(t * 3); px(S.x - 16, AY0, 32, top - AY0, "#fff2b0"); px(S.x - 10, AY0, 20, top - AY0, "#fff8d8"); bx.globalAlpha = 1; }
    px(S.x - 26, top, 52, S.h, hex(tone(S.c, -0.22)));
    px(S.x - 26, top, 52, 3, hex(tone(S.c, 0.4))); px(S.x - 26, top + 3, 52, 1, hex(tone(S.c, -0.5)));
    px(S.x + 22, top + 4, 4, S.h - 4, hex(tone(S.c, -0.45))); px(S.x - 26, top + 4, 1, S.h - 4, hex(tone(S.c, 0.15)));
    px(S.x - 26, top + S.h - 4, 52, 4, hex(tone(S.c, -0.6)));
    for (let r = 0; r < 4; r++) px(S.x - 22 + r * 13, top + S.h - 3, 2, 1, hex(tone(S.c, 0.2)));
    ptext(String(k + 1), S.x - 1, top + 7, 2, "#ffffff", hex(tone(S.c, 0.3)), "center", hex(tone(S.c, -0.7)));
    const hy = top - 16 + Math.sin(t * 3 + k) * 2;
    glow(S.x, hy + 9, 6, "#ffb347", 0.5 + 0.3 * Math.sin(t * 20));
    for (let f = 0; f < 3; f++) px(S.x - 1 + (f === 1 ? 1 : 0), hy + 8 + f * 2 + (Math.floor(t * 20 + f) % 2), f === 2 ? 1 : 2, 2, FIRE[f + 1]);
    bx.drawImage(shipPic(c, shipIdx(-Math.PI / 2), ""), Math.round(S.x - 9.5), Math.round(hy - 9.5));
    if (k === 0) for (let n = 0; n < 4; n++) { const a = t * 2 + n * TAU / 4; px(S.x + Math.cos(a) * 14, hy + Math.sin(a) * 6, 1, 1, n % 2 ? "#ffffff" : "#ffd23f"); }
    const cut = !isDemo() && RB.players[i] ? (RB.players[i].id === myId() ? officeCut() : RB.players[i].b ? null : mateCut(RB.players[i].id)) : null;
    if (cut && typeof pixelSprite === "function") {
      const sp = pic("ava|" + RB.players[i].id + "|" + cut.w, () => pixelSprite(cut, 16));
      bx.drawImage(sp, Math.round(S.x - sp.width / 2), Math.round(hy - 32));
    }
  });
  order.slice(3).forEach((i, k) => bx.drawImage(shipPic(colorOf2(i), 0, ""), 0, 51 + k * 10));
}

// ---------- the side panel, the Games tab ----------
function rbSide() {
  const S = RB.set, host = amHost(), lob = openLobbies();
  const pick = (attr, list, cur, on) => `<div class="pick">${list.map(([v, label]) => `<button data-${attr}="${v}" class="${v === cur ? "on" : ""}" ${on ? "" : "disabled"}>${esc(label)}</button>`).join("")}</div>`;
  const settings = edit => `<h3>ARENA</h3>${pick("rbar", [[-1, "All three"], ...ARENAS.map((a, i) => [i, a.short])], S.ar, edit)}
      <div class="hint" style="margin-top:4px">${S.ar < 0 ? "Crystal Quarry, Gravewell and Rotor Station, a round each in turn." : esc(ARENAS[S.ar].name + ": " + ARENAS[S.ar].blurb + ".")}</div>
      <h3>BOTS</h3>${pick("rbdf", DIFFS.map((d, i) => [i, d.name]), S.df, edit)}<div class="hint" style="margin-top:4px">${esc(DIFFS[S.df].blurb)}</div>
      <h3>FIRST TO</h3>${pick("rbwn", WINS.map(w => [w, w + " rounds"]), S.wn, edit)}<div class="hint" style="margin-top:4px">A round is half a minute or so; with five or six rockets the rounds spread out, so 3 makes a quick match.</div>
      <h3>TURNING</h3>${pick("rbtn", [[1, "One way"], [2, "Both ways"]], S.tn, edit)}`;
  const dot = c => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c}"></span>`;
  let h = "";
  if (RB.phase === "pick" || RB.phase === "done") {
    if (RB.phase === "done" && RB.result) h += `<h3>THE MATCH</h3><div class="hint">${esc(RB.result)}</div>${scoreRows(dot)}`;
    h += settings(true) + `<h3>&nbsp;</h3><div class="grid"><button class="go" data-rbopen="1">${inRoom() ? "Open a match to the room" : "Play against bots"}</button></div>
      ${inRoom() ? `<div class="hint" style="margin-top:6px">2 to 6 rockets: teammates join, bots and couch players fill in, you start it.</div>` : ""}`;
    if (lob.length) h += `<h3>OPEN MATCHES</h3>` + lob.map(x => `<div class="row"><span class="n">${esc(x.ownerName)} · ${x.players.length}/${MAX_P}</span><button class="go" data-rbjoin="${esc(x.id)}">Join</button></div>`).join("");
  } else if (RB.phase === "lobby") {
    const me = myIdx();
    h += `<h3>PLAYERS · ${RB.players.length}/${MAX_P}</h3>` + RB.players.map((p, i) => `<div class="row">${dot(colorOf2(i))}<span class="n">${esc(p.name)}${i === me ? " (you)" : ""}</span><span class="v">${p.b ? "bot" : p.c ? esc(SEATS[p.c]["k" + S.tn].split(" · ")[0]) : ""}</span></div>`).join("");
    if (host) h += `<div class="pick" style="margin-top:4px"><button data-rbbot="1" ${RB.players.length >= MAX_P ? "disabled" : ""}>+ bot</button><button data-rbunbot="1">− bot</button>
        <button data-rbcouch="1" ${RB.players.length >= MAX_P || RB.players.filter(p => p.c).length >= 3 ? "disabled" : ""}>+ couch</button><button data-rbuncouch="1">− couch</button></div>
        <div class="hint" style="margin-top:4px">A couch player shares this keyboard: ${SEATS.slice(1).map(s => esc(s["k" + S.tn])).join(", then ")}.</div>`;
    h += settings(host);
    h += host ? `<h3>&nbsp;</h3><div class="grid"><button class="go" data-rbstart="1" ${RB.players.length >= 2 ? "" : "disabled"}>Start the match</button><button data-rbleave="1">Cancel</button></div>`
      : `<div class="hint" style="margin-top:8px">Waiting for ${esc(RB.ownerName)} to start.</div><h3>&nbsp;</h3><button data-rbleave="1">Leave</button>`;
  } else if (RB.phase === "match") {
    const V = RB.view;
    h += `<h3>${V ? esc(ARENAS[V.arena].name.toUpperCase()) + " · ROUND " + V.round : "THE MATCH"} · FIRST TO ${(RB.mset || S).wn}</h3>${scoreRows(dot)}
      <h3>&nbsp;</h3><button data-rbleave="1">Leave the match</button>`;
  }
  const keys = SEATS[0]["k" + (RB.phase === "match" && RB.mset ? RB.mset.tn : S.tn)];
  h += `<h3>HOW TO PLAY</h3><div class="hint">Your rocket always flies forward. ${esc(keys)}. Three shots, refilled one by one.<br>
      Hit: your pilot is thrown out. On foot the same keys spin you and puff your jetpack; last ${RESPAWN} s and a new rocket comes for you. Shot or run over on foot: out of the round.<br>
      Last one left takes the round. After ${SD_AT} s the fence closes in: no new rockets from then on. Esc twice leaves a match.</div>
    <h3>POWER-UPS</h3><div class="hint">Fly through a capsule:<br>${POWERS.map(p => esc(p.how)).join("<br>")}</div>`;
  const rec = record();
  if (rec.played) h += `<h3>YOUR RECORD</h3><div class="hint">${rec.won} of ${rec.played} matches won · ${rec.kills} kills</div>`;
  h += `<h3>&nbsp;</h3><button data-home="1">Games</button>`;
  gside.innerHTML = h;
  RB.sideKey = sideKey();
}
function scoreRows(dot) {
  const V = RB.view; if (!V || isDemo()) return "";
  const order = RB.players.map((p, i) => i).sort((a, b) => ((V.score[b] || 0) - (V.score[a] || 0)) || ((V.kills[b] || 0) - (V.kills[a] || 0)));
  return order.map(i => { const p = RB.players[i], q = V.P[i];
    return `<div class="row">${dot(colorOf2(i))}<span class="n">${esc(p.name)}${i === myIdx() ? " (you)" : ""}</span><span class="v">★${V.score[i] || 0} · ✕${V.kills[i] || 0}${q && !q.mode && RB.phase === "match" ? " · out" : q && q.mode === 2 ? " · on foot" : ""}</span></div>`; }).join("");
}
function sideKey() {
  const V = RB.view;
  return [RB.phase, JSON.stringify(RB.set), RB.players.map(p => p.id + p.name).join(","), Object.keys(RB.lobbies).join(","),
    V && !isDemo() ? V.score.join(":") + "|" + V.kills.join(":") + "|" + V.P.map(p => p.mode).join("") + V.round : "", RB.result].join("|");
}
const refreshSideIfChanged = () => { if (GAME.open && GAME.view === ID && sideKey() !== RB.sideKey) rbSide(); };
function rbClick(b) {
  const d = b.dataset, edit = RB.phase !== "lobby" || amHost();
  const setv = (k, v) => { if (!edit) return; RB.set[k] = v; keep("rocketbrawlSet", RB.set); if (RB.phase === "lobby") sendLobby("lobby"); else rbSide(); };
  if (d.rbar !== undefined) setv("ar", clamp(+d.rbar, -1, ARENAS.length - 1));
  if (d.rbdf !== undefined) setv("df", clamp(+d.rbdf, 0, 2));
  if (d.rbwn !== undefined && WINS.includes(+d.rbwn)) setv("wn", +d.rbwn);
  if (d.rbtn !== undefined) setv("tn", +d.rbtn === 2 ? 2 : 1);
  if (d.rbopen) { if (RB.phase === "done") leaveMatch(); openMatch(); }
  if (d.rbjoin) joinMatch(d.rbjoin);
  if (d.rbstart) startMatch();
  if (d.rbleave) { leaveMatch(); rbSide(); }
  if (amHost() && RB.phase === "lobby") {
    if (d.rbbot) { addBot(); sendLobby("lobby"); }
    if (d.rbunbot) { removeBot(); sendLobby("lobby"); }
    if (d.rbcouch) { addCouch(); sendLobby("lobby"); }
    if (d.rbuncouch) { removeCouch(); sendLobby("lobby"); }
  }
}

// ---------- the home screen's icon: two rockets chasing round a patch of space, shots, a pop ----------
function drawIcon(t) {
  const bg = pic("iconbg", () => {
    const P = painter(66, 36);
    for (let y = 0; y < 36; y++) for (let x = 0; x < 66; x++) {
      const v = fbm(x / 18, y / 12, 5, 3), corner = (x < 2 || x > 63) && (y < 2 || y > 33);
      if (corner && (x === 0 || x === 65 || y === 0 || y === 35)) continue;
      let c = mix([12, 8, 30], [26, 10, 44], y / 36);
      if (v > 0.55) c = mix(c, [120, 40, 140], (v - 0.55) * 1.4);
      if (nhash(x, y, 9) < 0.03) c = [220, 220, 255];
      P.set(x, y, c);
    }
    P.outline([58, 46, 82]);
    return P.canvas();
  });
  gx.drawImage(bg, -33, -20);
  const a = t * 2.2, R1 = 20, R2 = 9;
  const s1 = [Math.cos(a) * R1, -2 + Math.sin(a) * R2], s2 = [Math.cos(a - 1.5) * R1, -2 + Math.sin(a - 1.5) * R2];
  const head = b => Math.atan2(Math.cos(b) * R2, -Math.sin(b) * R1);
  for (const [s, b, c] of [[s2, a - 1.5, COLORS[1]], [s1, a, COLORS[0]]]) gx.drawImage(shipPic(c, shipIdx(head(b)), ""), Math.round(s[0] - 9.5), Math.round(s[1] - 9.5));
  const k = (t * 1.5) % 1, sa = a - 1.5 + k * 1.2;
  if (k < 0.8) { gpx(Math.round(Math.cos(sa) * R1) - 1, Math.round(-2 + Math.sin(sa) * R2), 3, 1, COLORS[1]); gpx(Math.round(Math.cos(sa) * R1), Math.round(-2 + Math.sin(sa) * R2) - 1, 1, 3, "#ffffff"); }
  if (Math.floor(t * 2) % 5 === 0) { const f = (t * 2) % 1; for (let i = 0; i < 6; i++) { const b = i / 6 * TAU; gpx(Math.round(24 + Math.cos(b) * f * 6), Math.round(-12 + Math.sin(b) * f * 5), 1, 1, FIRE[i % 4]); } }
  gtext("rocket rumpus", 0, 20, "#a79d93", 8, "center");
}

ACHIEVEMENTS.push(["rocketbrawl-win", "🚀", "Top rocket", "win a Rocket Rumpus match"],
                  ["rocketbrawl-hard", "🤖", "Bot buster", "win Rocket Rumpus against three or more Hard bots"],
                  ["rocketbrawl-squash", "🥞", "Flattened", "run over a pilot with your rocket"],
                  ["rocketbrawl-foot", "🧑‍🚀", "Last one floating", "win a round on foot, out of your rocket"],
                  ["rocketbrawl-triple", "💥", "Triple pop", "take out three in one round"]);
registerGame(ID, {
  title: "🚀 Rocket Rumpus",
  start: arg => {
    if (arg === "demo") { gshow(ID); if (RB.phase !== "match") { openMatch(); startMatch(); } return; }
    if (RB.phase !== "lobby" && RB.phase !== "match") { RB.phase = "pick"; RB.id = ""; }
    gshow(ID);
  },
  step: rbStep, draw: rbDraw, side: rbSide, click: rbClick, msg: rbMsg, key: rbKey, leave: leaveMatch,
  cancel: () => { RB.held.clear(); },
  // in a match, the first Esc only warns: a second one leaves it
  escape: () => {
    if (RB.phase === "match" && Date.now() - RB.escAt > 2500) { RB.escAt = Date.now(); toast("Esc again leaves the match", null, 2500); return true; }
    return false;
  },
  tab: () => { const l = openLobbies(); return l.length ? `<div class="gh">ROCKET RUMPUS MATCHES</div>` + l.map(x => `<div class="g"><span class="gn">🚀 ${esc(x.ownerName)} · ${x.players.length}/${MAX_P}</span><button data-rbgjoin="${esc(x.id)}">Join</button></div>`).join("") : ""; },
  tabClick: b => { if (b.dataset.rbgjoin) { joinMatch(b.dataset.rbgjoin); return true; } return false; },
  tabKey: () => openLobbies().map(l => l.id + l.players.length).join(","),
  homeHTML: () => { const l = openLobbies(); return l.length ? `<h3>OPEN ROCKET RUMPUS MATCHES</h3>` + l.map(x => `<div class="row"><span class="n">${esc(x.ownerName)} · ${x.players.length}/${MAX_P}</span><button class="go" data-rbjoinhome="${esc(x.id)}">Join</button></div>`).join("") : ""; },
  iconCenter: [0, 0],
  drawIcon,
});
// the home panel's Join buttons
gside.addEventListener("click", ev => { const b = ev.target.closest("button[data-rbjoinhome]"); if (b) joinMatch(b.dataset.rbjoinhome); });
// for headless tests: the match without the page
window.rocketbrawlTest = { RB, FX, ARENAS, POWERS, DIFFS, EV, PH, SEATS, COLORS, newWorld, newRound, tick, runWorld, botStep, newBot, pack, unpack, between, guestView, viewOf,
  rbStep, rbDraw, rbSide, rbMsg, rbKey, rbClick, killShip, killPilot, fire, take, hitWalls, fence, onEvent, observe, openMatch, startMatch, beginMatch, leaveMatch, finish,
  shipPic, pilotPic, capsulePic, arenaBg, rotorPic, holePic, crystalPic, minePic, rockPic, fireballPic, iconPic, drawIcon, get buf() { return buf; },
  C: { TICK, TS, COLS, ROWS, AX0, AY0, AX1, AY1, MX, MY, SHIP_R, PILOT_R, SHOT_R, SPEED, TURN, AMMO, RELOAD, RESPAWN, READY_T, END_T, SD_AT, SD_LEN, PU_LIFE, PU_FIRST,
    SEND, LAG, GONE, MAX_SHOTS, SEND_SHOTS, MINE_ARM, LANCE_CHARGE, LANCE_T, FREEZE_T, SHIELD_T, RICO_T, HOLE_R, HUB_R, ARM_L, PIST, PIST_H, SHOT_V, EJECT_INV, SPAWN_INV } };
})();
