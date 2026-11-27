// ⚽ Noggin Cup (games.js is the shell): side-view football, one on one, with big heads. Run, jump,
// kick and head the ball into the other goal. A match is 90 seconds; level after that, it goes to a
// golden goal (45 seconds more, then it is a draw).
//
// Every touch fills your lightning bar. When it is full, Shift (or X) arms the lightning shot: your
// next touch sends the ball zigzagging straight at the other goal, and whoever it hits on the way is
// zapped for a moment. Now and then a power-up floats down in a bubble: whoever touches it (or last
// touched the ball that pops it) gets it: a mega ball, frost for the other player, a big noggin, a
// guard across your goal, or spring boots.
//
// Against the computer (Easy, Normal or Hard: a robot that runs, jumps, kicks and uses its own
// lightning shot) or a teammate. Against a teammate it is the ping-pong model: the challenger's Mac
// runs the match and sends it 15 times a second; the other sends its keys 15 times a second (the held
// keys plus press counters, so a short tap is never lost) and draws the match a moment behind, moving
// smoothly between the last pictures it got.
//
// Your own picture (the profile's, cut out by office.html) is your head: its top, cropped round and
// pixelated. Without one you get a drawn face whose eyes follow the ball.
//
// Room messages, {g: "headball", k, id, …}, every number in them whole (the room re-encodes them):
// ask {to}, yes, no, st (the match: see packState), in {l, r, u: held keys; j, x, p: jump, kick and
// lightning presses so far}, end {s, e}, bye.
(() => {
"use strict";

const ID = "headball";
const TICK = 1 / 120;                                   // the physics' fixed step
const GROUND = 172, CEIL = 22;                          // where feet stand; the roof line the ball bounces off
const GOAL_W = 26, NET_X = 5, BAR_Y = 108, BAR_R = 2;   // a goal: its mouth, its back net, its crossbar
const HEAD_R = 11, GIANT_R = 16, NECK = 13;             // a head's radius; from the feet to the chin
const RUN = 96, JUMP = 272, P_GRAV = 880, SPRING_K = 1.32;
const BALL_R = 5, MEGA_R = 8, B_GRAV = 430, B_TOP = 500, DRAG = 0.12;
const E_GROUND = 0.66, E_WALL = 0.72, E_BAR = 0.6, E_HEAD = 0.55, E_BODY = 0.35, E_NET = 0.18;
const KICK_T = 0.24, KICK_VX = 290, KICK_VY = 210, NOD = 60;
const MATCH = 90, GOLDEN = 45, READY_T = 1.4, GOAL_T = 2.6;
const METER_TOUCH = 0.09, METER_IDLE = 0.02, ARM_T = 4;
const BOLT_V = 440, BOLT_T = 1.1, ZIG_V = 160, ZIG_T = 0.075, ZAP_T = 1.3;
const PU_R = 7;
const SEND = 1 / 15, GONE = 8, LAG = 0.11;              // messages a second; silence that ends a match; how far behind a guest draws
const PHASES = ["ready", "play", "goal", "over"];
const TAU = Math.PI * 2;
const POWERS = [
  { id: "mega",   name: "MEGA BALL",    t: 7,   c: "#ffb347", how: "🎈 Mega ball: the ball grows for 7 s" },
  { id: "frost",  name: "FROST",        t: 2.6, c: "#8fe3ff", how: "❄ Frost: the other player freezes" },
  { id: "giant",  name: "BIG NOGGIN",   t: 8,   c: "#ffd23f", how: "🗿 Big noggin: a giant head for 8 s" },
  { id: "guard",  name: "GOAL GUARD",   t: 6,   c: "#7dffb0", how: "🛡 Goal guard: a wall across your goal" },
  { id: "spring", name: "SPRING BOOTS", t: 8,   c: "#ff7ad9", how: "🌀 Spring boots: far higher jumps" },
];
// The computer: how often it looks again (s), how fast it runs, how far off it aims (px), how far
// ahead it reads the ball, how often it keeps its place instead of chasing, and how likely it kicks,
// jumps and uses its lightning shot when it could.
const DIFFS = [
  { name: "Easy",   think: 0.34, speed: 0.68, err: 20, read: 0.2, keep: 0.25, kick: 0.5,  jump: 0.4,  bolt: 0.25, eye: "#7dffb0", blurb: "a sleepy robot: slow, and it misses a lot" },
  { name: "Normal", think: 0.17, speed: 0.86, err: 9,  read: 0.6, keep: 0.7,  kick: 0.8,  jump: 0.72, bolt: 0.6,  eye: "#ffc94a", blurb: "a fair match" },
  { name: "Hard",   think: 0.07, speed: 1,    err: 3,  read: 1,   keep: 1,    kick: 0.97, jump: 0.95, bolt: 1,    eye: "#ff5a5a", blurb: "quick, keeps its goal, reads the ball and uses its lightning shot" },
];
const KEYS = { l: ["arrowleft", "a"], r: ["arrowright", "d"], u: ["arrowup", "w"], k: [" ", "s"], p: ["shift", "x"] };
const EV = { ready: 1, go: 2, goal: 3, gold: 4, end: 5, hit: 6, bolt: 7, zap: 8, pop: 9, bar: 10, arm: 11 };

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const num = v => { const n = +v; return Number.isFinite(n) ? n : 0; };
const officeCut = () => typeof mgrCut !== "undefined" ? mgrCut : null;            // office.html's globals
const mateCut = id => { const m = typeof mateCuts !== "undefined" && mateCuts.get(id); return m && m.cut || null; };

// ---------- the match: players, ball, goals, power-ups ----------
function newPlayer(side) {
  return { side, dir: side ? -1 : 1, x: side ? GW - 80 : 80, y: GROUND, vx: 0, vy: 0, ground: 1, kick: -1, hit: 0, jbuf: 0,
    meter: 0, armed: 0, frozen: 0, stun: 0, giant: 0, spring: 0, shield: 0, headR: HEAD_R, touchAt: -9 };
}
const newInput = () => ({ l: 0, r: 0, u: 0, f: 1, jp: 0, kp: 0, pp: 0 });
const headY = p => p.y - NECK - p.headR;
function newWorld(seed) {
  const W = { seed, rng: seeded(seed), time: 0, acc: 0, t: MATCH, ph: "ready", phT: 0, gold: 0, s: [0, 0], lastGoal: -1,
    ball: { x: GW / 2, y: 50, vx: 0, vy: 0, r: BALL_R, rot: 0, spin: 0, last: -1, how: 0, sup: 0, supBy: -1, supAt: 0, boltBy: -1, sbx: 0, sby: 0, zz: 0, still: 0 },
    P: [newPlayer(0), newPlayer(1)], inp: [newInput(), newInput()], ai: [null, null], diffs: [1, 1],
    pu: null, puIn: 8, mega: 0, ev: 0, events: [], stats: { goals: 0, pops: 0, fizzles: 0, bolts: 0, zaps: 0, kicks: 0, heads: 0 } };
  kickoff(W);
  return W;
}
function kickoff(W) {
  W.ph = "ready"; W.phT = 0;
  W.P.forEach((p, i) => Object.assign(p, { x: i ? GW - 80 : 80, y: GROUND, vx: 0, vy: 0, ground: 1, kick: -1, jbuf: 0, frozen: 0, stun: 0, armed: 0 }));
  // the ball drops near the middle: a little toward whoever just conceded (anywhere near it at the start)
  const toward = W.lastGoal < 0 ? (W.rng() < 0.5 ? -1 : 1) : W.lastGoal ? -1 : 1;
  Object.assign(W.ball, { x: GW / 2 + toward * (6 + W.rng() * 14), y: 50, vx: 0, vy: 0, spin: 3, sup: 0, supBy: -1, boltBy: -1, last: -1, how: 0, still: 0 });
  emit(W, EV.ready);
}
/// Something worth showing happened: kept (the last eight) for the guest's state, and shown here.
function emit(W, type, a, b, x, y) {
  const e = [++W.ev, type, a | 0, b | 0, Math.round(x || 0), Math.round(y || 0)];
  W.events.push(e); if (W.events.length > 8) W.events.shift();
  if (W === shownWorld()) onEvent(e);
}

/// One fixed step of the whole match.
function tick(W) {
  W.time += TICK; W.phT += TICK;
  if (W.ph === "ready") {                         // players on their spots, the ball hanging over the middle
    W.ball.rot = (W.ball.rot + TICK * 2) % TAU;
    for (const i of W.inp) i.jp = i.kp = i.pp = 0;
    if (W.phT >= READY_T) { W.ph = "play"; W.phT = 0; emit(W, EV.go); }
    return;
  }
  if (W.ph === "play") {
    W.t -= TICK;
    if (W.t <= 0) {
      W.t = 0;
      if (!W.gold && W.s[0] === W.s[1]) { W.gold = 1; W.t = GOLDEN; emit(W, EV.gold); }
      else { W.ph = "over"; W.phT = 0; emit(W, EV.end, W.s[0], W.s[1]); }
    }
    if (W.mega > 0) W.mega = Math.max(0, W.mega - TICK);
    stepPowerup(W);
  }
  if (W.ph === "goal" && W.phT >= GOAL_T) {
    if (W.gold) { W.ph = "over"; W.phT = 0; emit(W, EV.end, W.s[0], W.s[1]); }
    else kickoff(W);
    return;
  }
  for (const p of W.P) stepPlayer(W, p, W.inp[p.side]);
  pushPlayers(W);
  stepBall(W);
  const b = W.ball;
  if (W.ph === "play") {
    // a goal: the whole ball over the line, under the bar
    if (b.x + b.r < GOAL_W && b.y > BAR_Y) goal(W, 1);
    else if (b.x - b.r > GW - GOAL_W && b.y > BAR_Y) goal(W, 0);
  }
}
function goal(W, side) {
  const b = W.ball;
  W.s[side]++; W.ph = "goal"; W.phT = 0; W.lastGoal = side; W.stats.goals++;
  // an own goal only when the defender's touch turned the ball toward its own goal (not a shot it got a touch to)
  const how = b.last === 1 - side && b.turned ? 3 : b.sup > 0 || b.boltBy === side ? 2 : b.how === 1 ? 1 : 0;   // own goal, lightning, header, kick
  b.sup = 0;
  emit(W, EV.goal, side, how, b.x, b.y);
}

function stepPlayer(W, p, inp) {
  const dt = TICK, play = W.ph === "play";
  if (play) {
    for (const k of ["armed", "frozen", "stun", "giant", "spring", "shield"]) if (p[k] > 0) p[k] = Math.max(0, p[k] - dt);
    p.meter = Math.min(1, p.meter + METER_IDLE * dt);
  }
  const free = play && p.frozen <= 0 && p.stun <= 0;
  const want = free ? ((inp.r ? 1 : 0) - (inp.l ? 1 : 0)) * (inp.f || 1) : 0;
  // the scorer hops about while the goal is cheered
  if (W.ph === "goal" && W.lastGoal === p.side && p.ground && W.phT > 0.3) { p.vy = -JUMP * 0.7; p.ground = 0; }
  if (p.frozen > 0) p.vx *= 1 - 4 * dt;            // frozen: slides to a stop on the ice
  else p.vx += (want * RUN - p.vx) * Math.min(1, (p.ground ? 16 : 8) * dt);
  if (inp.jp) p.jbuf = 0.12;                       // a jump pressed just before landing still counts
  if (free && (p.jbuf > 0 || inp.u) && p.ground) { p.vy = -JUMP * (p.spring > 0 ? SPRING_K : 1); p.ground = 0; p.jbuf = 0; }
  if (free && inp.kp && p.kick < 0) { p.kick = 0; p.hit = 0; }
  if (free && inp.pp && p.meter >= 1 && p.armed <= 0) { p.armed = ARM_T; emit(W, EV.arm, p.side); }
  inp.jp = inp.kp = inp.pp = 0;
  p.jbuf = Math.max(0, p.jbuf - dt);
  if (p.kick >= 0 && (p.kick += dt) > KICK_T) p.kick = -1;
  p.vy += P_GRAV * dt;
  p.x += p.vx * dt; p.y += p.vy * dt;
  p.ground = 0;
  if (p.y >= GROUND) { p.y = GROUND; p.vy = 0; p.ground = 1; }
  const rT = p.giant > 0 ? GIANT_R : HEAD_R;
  p.headR += clamp(rT - p.headR, -dt * 20, dt * 20);
  // the crossbars: a head under one is pushed back down, one beside it back toward the pitch
  for (const g of [0, 1]) {
    const px = g ? GW - GOAL_W : GOAL_W, hy = headY(p), dx = p.x - px, dy = hy - BAR_Y, d = Math.hypot(dx, dy), min = p.headR + BAR_R;
    if (d >= min) continue;
    if (dy > 0) { const k = (min - d) / (d || 1); p.x += dx * k; p.y += dy * k; if (p.vy < 0) p.vy = 0; }
    else p.x += (g ? -1 : 1) * (Math.sqrt(min * min - dy * dy) - Math.abs(dx));
  }
  keepIn(p);
}
function keepIn(p) {
  const lo = GOAL_W + p.headR - 4, hi = GW - GOAL_W - p.headR + 4;
  if (p.x < lo) { p.x = lo; p.vx = Math.max(0, p.vx); }
  if (p.x > hi) { p.x = hi; p.vx = Math.min(0, p.vx); }
  if (p.y > GROUND) { p.y = GROUND; p.vy = Math.min(0, p.vy); p.ground = 1; }
}
/// The two players' heads bump: side by side they push apart; one landing on the other stands on its head.
function pushPlayers(W) {
  const [a, c] = W.P, dx = c.x - a.x, dy = headY(c) - headY(a), d = Math.hypot(dx, dy) || 0.01, min = a.headR + c.headR - 2;
  if (d >= min) return;
  const push = min - d, nx = dx / d, ny = dy / d;
  if (Math.abs(ny) > 0.55) {
    const top = ny < 0 ? c : a;
    top.y -= Math.abs(ny) * push;
    if (top.vy > 0) { top.vy = 0; top.ground = 1; }
  }
  a.x -= nx * push / 2; c.x += nx * push / 2;
  keepIn(a); keepIn(c);
}

/// Where the kicking boot is: its leg swings back a little, then up and through, then down again.
function footPos(p) {
  let th = 0.25;
  if (p.kick >= 0) {
    const k = p.kick / KICK_T;
    th = k < 0.2 ? 0.25 - 0.85 * (k / 0.2) : k < 0.55 ? -0.6 + 2.6 * ((k - 0.2) / 0.35) : 2.0 - 1.75 * ((k - 0.55) / 0.45);
  }
  const hx = p.x + p.dir * 2, hy = p.y - 7;
  return [hx + Math.sin(th) * 8 * p.dir, hy + Math.cos(th) * 8, th];
}

// the ball bounces off a circle moving at (vx, vy); returns how hard it hit (0: no touch)
let lastN = [0, 0];
function bounce(b, cx, cy, r, vx, vy, e) {
  const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), min = r + b.r;
  if (d >= min) return 0;
  const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : -1;
  b.x = cx + nx * min; b.y = cy + ny * min; lastN = [nx, ny];
  const rvx = b.vx - vx, rvy = b.vy - vy, vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0.01;
  b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
  b.spin += (rvx * -ny + rvy * nx) / b.r * 0.3;      // a glancing touch spins it
  return -vn;
}
function bounceSeg(b, x0, y0, x1, y1, r, vx, vy, e) {
  const sx = x1 - x0, sy = y1 - y0, L = sx * sx + sy * sy, t = L ? clamp(((b.x - x0) * sx + (b.y - y0) * sy) / L, 0, 1) : 0;
  return bounce(b, x0 + sx * t, y0 + sy * t, r, vx, vy, e);
}

function stepBall(W) {
  const b = W.ball, rT = W.mega > 0 ? MEGA_R : BALL_R;
  if (b.r !== rT) { b.r += clamp(rT - b.r, -TICK * 15, TICK * 15); if (b.y + b.r > GROUND) b.y = GROUND - b.r; }
  // sub-steps short enough that even the fastest ball moves under 1.5 px each: nothing is jumped over
  const n = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) + 300) * TICK / 1.5));
  for (let i = 0; i < n; i++) subStep(W, TICK / n);
  b.rot = ((b.rot % TAU) + TAU) % TAU;
  b.spin *= 1 - 0.4 * TICK;
  // a ball that lies dead still for long gets a little hop: nothing stalls a match
  if (W.ph === "play" && Math.hypot(b.vx, b.vy) < 6) { if ((b.still += TICK) > 5) { b.vy = -230; b.vx = (W.rng() - 0.5) * 80; b.still = 0; } }
  else b.still = 0;
}
function subStep(W, h) {
  const b = W.ball;
  if (b.sup > 0) {                                 // the lightning shot: straight at the goal, zigzagging, no gravity
    b.zz += h; b.sup -= h;
    b.vx = b.sbx; b.vy = b.sby + (Math.floor(b.zz / ZIG_T) % 2 ? 1 : -1) * ZIG_V;
    if (b.sup <= 0) endBolt(b);
  } else {
    b.vy += B_GRAV * h;
    const k = 1 - DRAG * h; b.vx *= k; b.vy *= k;
  }
  b.x += b.vx * h; b.y += b.vy * h; b.rot += b.spin * h;
  let solid = false;                               // touched something (not the grass): ends a lightning shot
  for (const p of W.P) if (touchPlayer(W, p)) solid = true;
  for (const g of [0, 1]) {
    const imp = bounceSeg(b, g ? GW - GOAL_W : 0, BAR_Y, g ? GW : GOAL_W, BAR_Y, BAR_R, 0, 0, E_BAR);
    if (imp) {
      solid = true;
      if (lastN[1] < -0.6) b.vx += (g ? -1 : 1) * 260 * h;   // lying on top: the net sags it back onto the pitch
      if (imp > 90) emit(W, EV.bar, g, 0, b.x, b.y + lastN[1] * -b.r);
    }
    // the goal guard: a wall across the mouth while it lasts, always pushing out toward the pitch
    if (W.P[g].shield > 0 && b.y + b.r > BAR_Y) {
      const mx = g ? GW - GOAL_W - 2 : GOAL_W + 2;
      if (!g && b.x - b.r < mx && b.x > GOAL_W - b.r) { b.x = mx + b.r; if (b.vx < 0) b.vx = -b.vx * 0.9; solid = true; }
      if (g && b.x + b.r > mx && b.x < GW - GOAL_W + b.r) { b.x = mx - b.r; if (b.vx > 0) b.vx = -b.vx * 0.9; solid = true; }
    }
  }
  // the side walls: the back of the nets under the bars, the stands above them
  const low = b.y > BAR_Y, lw = low ? NET_X + 1 : 0, rw = low ? GW - NET_X - 1 : GW;
  if (b.x - b.r < lw) { b.x = lw + b.r; if (b.vx < 0) { b.vx = -b.vx * (low ? E_NET : E_WALL); if (low) b.vy *= 0.6; } solid = true; }
  if (b.x + b.r > rw) { b.x = rw - b.r; if (b.vx > 0) { b.vx = -b.vx * (low ? E_NET : E_WALL); if (low) b.vy *= 0.6; } solid = true; }
  if (b.y - b.r < CEIL) { b.y = CEIL + b.r; if (b.vy < 0) b.vy = -b.vy * 0.5; solid = true; }
  if (b.y + b.r > GROUND) {
    b.y = GROUND - b.r;
    if (b.vy > 0) { b.vy = b.vy > 40 ? -b.vy * E_GROUND : 0; if (b.sup > 0) b.sby = -Math.abs(b.sby); }
    // rolling: the grass turns its spin toward rolling and slows it down
    b.spin += (b.vx / b.r - b.spin) * Math.min(1, 25 * h);
    b.vx *= 1 - 0.8 * h;
  }
  if (W.ph === "goal" && low && (b.x < GOAL_W || b.x > GW - GOAL_W)) { b.vx *= 1 - 6 * h; b.spin *= 1 - 6 * h; }   // the net holds a goal
  if (solid && b.sup > 0 && W.time - b.supAt > 0.05) endBolt(b);
  const sp = Math.hypot(b.vx, b.vy), top = b.sup > 0 ? BOLT_V + ZIG_V + 10 : B_TOP;
  if (sp > top) { b.vx *= top / sp; b.vy *= top / sp; }
}
function endBolt(b) { b.sup = 0; }
/// The ball against one player: the kicking boot, the head, the body and the boot at rest.
function touchPlayer(W, p) {
  const b = W.ball, vx0 = b.vx;
  if (b.sup > 0 && b.supBy === p.side && W.time - b.supAt < 0.25) return false;   // the shooter, just as it goes
  if (p.kick >= 0 && !p.hit) {
    const k = p.kick / KICK_T, [fx, fy] = footPos(p);
    if (k > 0.15 && k < 0.75 && Math.hypot(b.x - fx, b.y - fy) < b.r + 7 && (b.x - p.x) * p.dir > -6) { kickBall(W, p); return true; }
  }
  const zap = () => { if (b.sup > 0 && b.supBy !== p.side) { p.stun = ZAP_T; p.kick = -1; W.stats.zaps++; emit(W, EV.zap, p.side, 0, b.x, b.y); endBolt(b); } };
  const hy = headY(p);
  if (Math.hypot(b.x - p.x, b.y - hy) < p.headR + b.r) {
    zap();
    const imp = bounce(b, p.x, hy, p.headR, p.vx * 0.5, p.vy * 0.6, E_HEAD);
    if (imp > 0.01) {
      if (lastN[1] < -0.3) b.vx += p.dir * NOD * -lastN[1];          // off the top: nodded on toward the other goal
      backOff(b, p);
      W.stats.heads++; if (imp > 60) emit(W, EV.hit, p.side, 1, b.x, b.y); touch(W, p, 1, vx0);
    }
    return true;
  }
  let imp = 0;
  if (Math.abs(b.x - p.x) < 4 + b.r + 1 && b.y > p.y - NECK - 4 - b.r) {
    zap();
    imp = bounceSeg(b, p.x, p.y - 2, p.x, p.y - NECK + 1, 4, p.vx, p.vy, E_BODY);
  }
  if (!imp && p.kick < 0) { const [fx, fy] = footPos(p); imp = bounce(b, fx, fy, 2.5, p.vx, p.vy, 0.3); }
  if (imp) { backOff(b, p); touch(W, p, 0, vx0); return true; }
  return false;
}
/// Players cannot turn round, so a ball off the back of a head or body toward its own goal loses
/// most of its pace and pops up instead: own goals stay rare, and a player can still recover.
function backOff(b, p) {
  if (b.vx * p.dir < 0 && (b.x - p.x) * p.dir < 0 && b.sup <= 0) { b.vx *= 0.5; b.vy = Math.min(b.vy, 0) - 50; }
}
function kickBall(W, p) {
  const b = W.ball, high = clamp((p.y - 4 - b.y) / 16, 0, 1);      // 0 on the grass, 1 at the hip: higher is flatter
  p.hit = 1;
  b.vx = p.dir * (KICK_VX + 70 * high) + p.vx * 0.35;
  b.vy = -(KICK_VY - 150 * high) + Math.min(0, p.vy) * 0.25;
  b.spin = b.vx / b.r * 0.6;
  W.stats.kicks++;
  emit(W, EV.hit, p.side, 2, b.x, b.y);
  touch(W, p, 2, b.vx);
}
/// A player touched the ball: theirs now, their bar fills, and an armed lightning shot goes.
function touch(W, p, how, vx0) {
  const b = W.ball;
  b.last = p.side; b.how = how; b.turned = vx0 * p.dir > -40 && b.vx * p.dir < -40;
  if (b.boltBy !== p.side || b.sup <= 0) b.boltBy = -1;
  if (W.time - p.touchAt > 0.4) p.meter = Math.min(1, p.meter + METER_TOUCH);
  p.touchAt = W.time;
  if (p.armed > 0 && (b.x - p.x) * p.dir > -p.headR * 0.5) launchBolt(W, p);
}
function launchBolt(W, p) {
  const b = W.ball, tx = p.dir > 0 ? GW - GOAL_W * 0.45 : GOAL_W * 0.45, ty = (BAR_Y + GROUND) / 2 + 8;
  const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
  p.armed = 0; p.meter = 0;
  Object.assign(b, { sbx: dx / d * BOLT_V, sby: dy / d * BOLT_V, sup: BOLT_T, supBy: p.side, supAt: W.time, boltBy: p.side, zz: 0, last: p.side });
  W.stats.bolts++;
  emit(W, EV.bolt, p.side, 0, b.x, b.y);
}

function stepPowerup(W) {
  if (!W.pu) {
    if ((W.puIn -= TICK) <= 0) { const R = W.rng; W.pu = { type: Math.floor(R() * POWERS.length), x: 70 + R() * 180, y: CEIL - 12, ty: 84 + R() * 44, life: 10 }; }
    return;
  }
  const u = W.pu;
  u.life -= TICK; u.y += (u.ty - u.y) * Math.min(1, TICK * 1.6);
  if (u.life <= 0) { W.pu = null; W.puIn = 6 + W.rng() * 5; W.stats.fizzles++; emit(W, EV.pop, -1, u.type, u.x, u.y); return; }
  let who = -1;
  for (const p of W.P) if (Math.hypot(p.x - u.x, headY(p) - u.y) < p.headR + PU_R) who = p.side;
  const b = W.ball;
  if (who < 0 && Math.hypot(b.x - u.x, b.y - u.y) < b.r + PU_R) who = b.last >= 0 ? b.last : Math.abs(W.P[0].x - b.x) < Math.abs(W.P[1].x - b.x) ? 0 : 1;
  if (who < 0) return;
  const p = W.P[who], o = W.P[1 - who], T = POWERS[u.type].t;
  switch (POWERS[u.type].id) {
    case "mega": W.mega = T; break;
    case "frost": o.frozen = T; o.kick = -1; break;
    case "giant": p.giant = T; break;
    case "guard": p.shield = T; break;
    case "spring": p.spring = T; break;
  }
  W.pu = null; W.puIn = 9 + W.rng() * 6; W.stats.pops++;
  emit(W, EV.pop, who, u.type, u.x, u.y);
}

// ---------- the computer ----------
/// Where the ball will be in t seconds: gravity, bounces on the grass and the side walls.
function predict(b, t) {
  let x = b.x, y = b.y, vx = b.sup > 0 ? b.sbx : b.vx, vy = b.sup > 0 ? b.sby : b.vy;
  for (let s = 0; s < t; s += 1 / 60) {
    if (!(b.sup > 0)) vy += B_GRAV / 60;
    x += vx / 60; y += vy / 60;
    if (y + b.r > GROUND) { y = GROUND - b.r; vy = -Math.abs(vy) * E_GROUND; }
    if (x < b.r) { x = b.r; vx = Math.abs(vx) * E_WALL; }
    if (x > GW - b.r) { x = GW - b.r; vx = -Math.abs(vx) * E_WALL; }
  }
  return { x, y };
}
/// Follows the ball's path for half a second and says whether a kick now would meet it with the boot,
/// and whether a jump now would meet it with the front of the head (above where the head is anyway:
/// a ball that would hit the standing head needs no jump).
function plans(p, b) {
  let x = b.x, y = b.y, vx = b.sup > 0 ? b.sbx : b.vx, vy = b.sup > 0 ? b.sby : b.vy;
  const hy0 = headY(p), v0 = JUMP * (p.spring > 0 ? SPRING_K : 1), reach = p.headR + b.r - 1;
  let kick = false, jump = false, standHit = false;
  for (let k = 1; k <= 30; k++) {
    const t = k / 60;
    if (!(b.sup > 0)) vy += B_GRAV / 60;
    x += vx / 60; y += vy / 60;
    if (y + b.r > GROUND) { y = GROUND - b.r; vy = -Math.abs(vy) * E_GROUND; }
    const hx = p.x + p.vx * t * 0.6, front = (x - hx) * p.dir;
    if (k >= 3 && k <= 8 && front > -2 && front < 20 && y > p.y - 24 - b.r) kick = true;
    if (!standHit && Math.hypot(x - hx, y - hy0) < reach) standHit = true;
    const jy = hy0 - v0 * t + 0.5 * P_GRAV * t * t;
    if (!standHit && !jump && jy < hy0 && Math.hypot(x - hx, y - jy) < reach && y < hy0 - 6 && front > -3) jump = true;
  }
  return { kick, jump: jump && !standHit };
}
/// The computer's keys for one step. It plays the ball when it is near its own goal, coming at it, or
/// when it is the nearer of the two; otherwise it keeps a place between the ball and its goal. It
/// stays goal-side of the ball (hopping over one rolling back past it rather than pushing it home),
/// kicks when the ball is at its boot, jumps for balls dropping onto its head or flying at its goal,
/// and arms its lightning shot near the ball.
function aiStep(W, side, diff) {
  const p = W.P[side], o = W.P[1 - side], b = W.ball, D = DIFFS[diff], inp = W.inp[side];
  const A = W.ai[side] || (W.ai[side] = { t: 0, tx: p.x, err: 0, kc: 0, jc: 0, sc: 0, keep: true, R: seeded((W.seed * 7 + side * 131 + 1) >>> 0) });
  inp.l = inp.r = inp.u = 0; inp.f = D.speed;
  if (W.ph !== "play" || p.frozen > 0 || p.stun > 0) return;
  const dir = p.dir, R = A.R, mouth = side ? GW - GOAL_W : GOAL_W, bvx = b.sup > 0 ? b.sbx : b.vx;
  A.t -= TICK; A.kc -= TICK; A.jc -= TICK; A.sc -= TICK;
  if (A.t <= 0) {
    A.t = D.think * (0.6 + R() * 0.8);
    A.err = (R() - 0.5) * 2 * D.err;
    if (R() < 0.15) A.keep = R() < D.keep;                         // now and then it gets keen (or careful) again
    const f = predict(b, 0.15 + 0.35 * D.read), ahead = (f.x - p.x) * dir, home = (f.x - mouth) * dir;
    const coming = bvx * dir < -80, nearer = Math.abs(p.x - f.x) <= Math.abs(o.x - f.x) + 8;
    let tx;
    if (ahead < -4) tx = f.x - dir * 18;                             // the ball is past it: back between it and the goal
    else if (home < 110 || (coming && home < 200) || nearer || !A.keep) tx = f.x - dir * (f.y < GROUND - 30 ? 4 : 10);
    else tx = mouth + dir * clamp(home * 0.45, 30, 60 + 50 * D.read);  // the other one has it: hold a place in front of goal
    A.tx = tx + A.err;
  }
  const dx = A.tx - p.x;
  if (dx > 2.5) inp.r = 1; else if (dx < -2.5) inp.l = 1;
  const rel = (b.x - p.x) * dir, plan = plans(p, b);
  if (p.kick < 0 && A.kc <= 0 && plan.kick) { A.kc = 0.22 + (1 - D.kick) * 0.5; if (R() < D.kick) inp.kp = 1; }
  if (p.ground && A.jc <= 0) {
    const hop = rel < 0 && rel > -24 && b.y > GROUND - 18 && dx * dir < -4;     // rolling back past it: hop over, don't push it home
    if (plan.jump || hop) { A.jc = 0.25; if (R() < D.jump) inp.jp = 1; }
  }
  if (p.meter >= 1 && p.armed <= 0 && A.sc <= 0 && rel > -2 && rel < 40) { A.sc = 0.6; if (R() < D.bolt) inp.pp = 1; }
}
/// Runs a world on for dt seconds in fixed steps; the computer plays the sides in `ai`.
function runWorld(W, dt, ai) {
  W.acc = Math.min(0.1, W.acc + dt);
  while (W.acc >= TICK) {
    for (const s of [0, 1]) if (ai[s]) aiStep(W, s, W.diffs[s]);
    tick(W);
    W.acc -= TICK;
  }
}

// ---------- who plays: the game's state on this Mac ----------
const HB = { phase: "idle", mode: "cpu", diff: clamp(+store("headballDiff", 1) || 0, 0, 2), me: 0, id: "", opp: "", oppName: "",
  w: null, demo: null, asks: {}, held: new Set(), cnt: { j: 0, x: 0, p: 0 }, seen: { j: 0, x: 0, p: 0 }, sent: 0, heard: 0,
  snaps: [], off: null, evSeen: 0, view: null, overAt: 0, result: "", sideKey: "", escAt: 0, waitAt: 0 };
const isGuest = () => HB.mode === "net" && HB.me === 1;
/// The world this Mac runs and shows (a guest runs none: it draws the host's pictures).
function shownWorld() { return HB.phase === "idle" || HB.phase === "wait" ? HB.demo : isGuest() ? null : HB.w; }
function currentView() { return HB.phase === "idle" || HB.phase === "wait" ? HB.demo : isGuest() ? HB.view : HB.w; }
const oppLabel = () => HB.mode === "cpu" ? "the computer" : HB.oppName || "your opponent";
function teamColors() {
  if (HB.phase === "idle" || HB.phase === "wait") return ["#5b8def", "#e06c6c"];
  const ids = HB.me ? [HB.opp, myId()] : [myId(), HB.opp], c0 = colorOf(ids[0]);
  const c1 = HB.mode === "cpu" ? (c0 === "#e06c6c" ? "#f0a35e" : "#e06c6c") : colorOf(ids[1]);
  return [c0, c1 === c0 ? SHIRTS[(SHIRTS.indexOf(c0) + 3) % SHIRTS.length] : c1];
}
/// A side's player: name, colour, picture or drawn face (or the robot).
function sideInfo(s) {
  const color = teamColors()[s];
  if (HB.phase === "idle" || HB.phase === "wait") return s ? { id: "cpu", name: "CPU", robot: true, diff: 1, color } : { id: "noggin-ace", name: "ACE", color };
  if (s === HB.me) return { id: myId(), name: myName(), color, cut: officeCut(), me: true };
  if (HB.mode === "cpu") return { id: "cpu", name: "CPU", robot: true, diff: HB.diff, color };
  return { id: HB.opp, name: HB.oppName, color, cut: mateCut(HB.opp) };
}

function playCpu() {
  Object.assign(HB, { mode: "cpu", me: 0, id: "", opp: "", phase: "play", w: newWorld(newSeed()), result: "" });
  HB.w.diffs = [HB.diff, HB.diff];
  resetFX();
  for (const e of HB.w.events) onEvent(e);
  refreshSide();
}
/// The challenges still open: one is dropped a minute after it came.
function pruneAsks() {
  const now = Date.now() / 1000;
  for (const [id, a] of Object.entries(HB.asks)) if (now - a.at >= 60) delete HB.asks[id];
  return Object.values(HB.asks);
}
function ask(id) {
  const m = roomMates().find(x => x.id === id); if (!m) return;
  Object.assign(HB, { id: myId() + "-" + Date.now(), mode: "net", me: 0, phase: "wait", opp: m.id, oppName: m.name, waitAt: Date.now() / 1000 });
  gsend({ g: ID, k: "ask", id: HB.id, to: m.id });
  refreshSide();
}
function accept(id) {
  const a = HB.asks[id]; if (!a) return;
  delete HB.asks[id]; peopleKey = "";
  leaveCurrent();
  if (!GAME.open) openGames("home");
  Object.assign(HB, { id, mode: "net", me: 1, phase: "play", opp: a.from, oppName: a.name, heard: Date.now() / 1000, snaps: [], off: null,
    evSeen: 0, view: null, w: null, cnt: { j: 0, x: 0, p: 0 }, result: "", overAt: 0 });
  resetFX();
  gsend({ g: ID, k: "yes", id });
  gshow(ID);
}
function decline(id) {
  if (!HB.asks[id]) return;
  delete HB.asks[id]; peopleKey = "";
  gsend({ g: ID, k: "no", id });
  refreshSide();
}
function startHost() {
  Object.assign(HB, { phase: "play", w: newWorld(newSeed()), heard: Date.now() / 1000, seen: { j: 0, x: 0, p: 0 }, sent: 0, result: "" });
  resetFX();
  for (const e of HB.w.events) onEvent(e);
  refreshSide();
}
function leaveMatch() {
  if (HB.id && HB.mode === "net" && (HB.phase === "play" || HB.phase === "wait")) gsend({ g: ID, k: "bye", id: HB.id });
  if (HB.phase === "play" || HB.phase === "wait") { HB.phase = "idle"; HB.id = ""; }
}
/// The match is over on this Mac: the result, the record, the achievements.
function finish(s, why) {
  if (HB.phase !== "play") return;
  HB.phase = "over"; HB.overAt = Date.now() / 1000;
  const mine = s[HB.me], theirs = s[1 - HB.me], res = why ? "" : mine > theirs ? "w" : mine < theirs ? "l" : "d";
  const who = HB.mode === "cpu" ? `the computer (${DIFFS[HB.diff].name})` : HB.oppName;
  HB.result = why ? `${why} · ${mine}–${theirs}` : res === "w" ? `You beat ${who} ${mine}–${theirs}` : res === "l" ? `${who} won ${theirs}–${mine}` : `A draw with ${who}, ${mine}–${theirs}`;
  if (res) {
    const rec = record(), row = HB.mode === "cpu" ? rec.cpu[HB.diff] : rec.net;
    row["wdl".indexOf(res)]++;
    rec.last = HB.result; rec.at = Date.now();
    keep("headball", rec);
    if (res === "w") {
      achieve("headball-win");
      if (HB.mode === "cpu" && HB.diff === 2) achieve("headball-hard");
      if (HB.mode === "net") achieve("headball-derby");
    }
    toast(res === "w" ? `⚽ You won ${mine}–${theirs}!` : `⚽ ${esc(HB.result)}`, null, 5000);
  } else toast(`⚽ ${esc(HB.result)}`, null, 4000);
  HB.id = "";
  refreshSide();
}
function record() {
  const r = store("headball", null) || {};
  return { cpu: Array.isArray(r.cpu) && r.cpu.length === 3 ? r.cpu : [[0, 0, 0], [0, 0, 0], [0, 0, 0]], net: Array.isArray(r.net) ? r.net : [0, 0, 0], last: r.last || "", at: r.at || 0 };
}

// ---------- the room: the host's state, the guest's keys ----------
const i10 = v => Math.round(v * 10);
/// The match in whole numbers: positions in tenths of a pixel, times in tenths of a second (the
/// host's clock in ms), the ball's turn in hundredths of a radian.
function packState(W) {
  const b = W.ball;
  return { g: ID, k: "st", id: HB.id, h: Math.round(W.time * 1000), c: i10(W.t), ph: PHASES.indexOf(W.ph), pt: i10(W.phT), gd: W.gold, s: W.s.slice(),
    b: [i10(b.x), i10(b.y), Math.round(b.vx), Math.round(b.vy), Math.round(b.rot * 100) % 629, i10(b.r), i10(Math.max(0, b.sup)), b.last, b.supBy],
    p: W.P.map(p => [i10(p.x), i10(p.y), Math.round(p.vx), Math.round(p.vy), p.kick < 0 ? -1 : Math.round(p.kick * 1000), Math.round(p.meter * 100),
      i10(p.armed), i10(p.frozen), i10(p.stun), i10(p.giant), i10(p.spring), i10(p.shield), p.ground, i10(p.headR)]),
    u: W.pu ? [W.pu.type, i10(W.pu.x), i10(W.pu.y), i10(W.pu.life)] : 0, m: i10(W.mega), e: W.events.map(e => e.slice()) };
}
/// A state message back into a picture of the match (anything odd in it is clamped).
function unpack(d) {
  const b = Array.isArray(d.b) ? d.b : [], ps = Array.isArray(d.p) ? d.p : [], s = Array.isArray(d.s) ? d.s : [];
  const X = v => clamp(num(v) / 10, -20, GW + 20), Y = v => clamp(num(v) / 10, -20, GH + 20), T = v => clamp(num(v) / 10, 0, 600);
  return { h: num(d.h), t: T(d.c), ph: PHASES[num(d.ph)] || "play", phT: T(d.pt), gold: num(d.gd) ? 1 : 0, s: [clamp(num(s[0]), 0, 99), clamp(num(s[1]), 0, 99)],
    ball: { x: X(b[0]), y: Y(b[1]), vx: num(b[2]), vy: num(b[3]), rot: num(b[4]) / 100, r: clamp(num(b[5]) / 10, 2, 12) || BALL_R, sup: T(b[6]), last: num(b[7]), supBy: num(b[8]) },
    P: [0, 1].map(i => { const q = Array.isArray(ps[i]) ? ps[i] : [];
      return { side: i, dir: i ? -1 : 1, x: X(q[0]), y: Y(q[1]), vx: num(q[2]), vy: num(q[3]), kick: num(q[4]) < 0 ? -1 : clamp(num(q[4]) / 1000, 0, KICK_T),
        meter: clamp(num(q[5]) / 100, 0, 1), armed: T(q[6]), frozen: T(q[7]), stun: T(q[8]), giant: T(q[9]), spring: T(q[10]), shield: T(q[11]),
        ground: num(q[12]) ? 1 : 0, headR: clamp(num(q[13]) / 10, 4, 20) || HEAD_R }; }),
    pu: Array.isArray(d.u) ? { type: clamp(num(d.u[0]) | 0, 0, POWERS.length - 1), x: X(d.u[1]), y: Y(d.u[2]), life: T(d.u[3]) } : null,
    mega: T(d.m), events: Array.isArray(d.e) ? d.e.filter(Array.isArray).map(unpackEvent) : [] };
}
/// An event from the host with its side 0|1 and power index in range: onEvent indexes FX and POWERS with them.
function unpackEvent(e) {
  const v = e.map(num);
  if (v[1] === EV.goal || v[1] === EV.arm) v[2] = v[2] ? 1 : 0;
  if (v[1] === EV.pop) v[3] = clamp(Math.round(num(v[3])), 0, POWERS.length - 1);
  return v;
}
function takeState(d) {
  const s = unpack(d), S = HB.snaps, now = Date.now();
  if (S.length && s.h <= S[S.length - 1].h) return;
  S.push(s); if (S.length > 12) S.shift();
  // how far the host's clock is behind ours: the quickest message so far, creeping up slowly so a
  // slower connection is followed
  const off = now - s.h;
  HB.off = HB.off === null ? off : Math.min(off, HB.off + 0.5);
  refreshSideIfChanged();
}
function takeInput(d) {
  const I = HB.w.inp[1];
  I.l = d.l ? 1 : 0; I.r = d.r ? 1 : 0; I.u = d.u ? 1 : 0; I.f = 1;
  for (const [k, f] of [["j", "jp"], ["x", "kp"], ["p", "pp"]]) {
    const n = num(d[k]);
    if (n !== HB.seen[k]) { if (n > HB.seen[k]) I[f] = 1; HB.seen[k] = n; }
  }
}
/// The guest's picture now: LAG behind the host's newest, between the two pictures around that moment
/// (a little ahead of the newest, on its speeds, when the next is late). The events of the pictures
/// passed are shown as they are reached.
function guestView() {
  const S = HB.snaps; if (!S.length) return null;
  const rh = Date.now() - HB.off - LAG * 1000, last = S[S.length - 1];
  let v;
  if (rh >= last.h) v = ahead(last, Math.min(0.12, (rh - last.h) / 1000));
  else if (rh <= S[0].h) v = S[0];
  else for (let i = S.length - 1; i > 0; i--) if (S[i - 1].h <= rh) { v = between(S[i - 1], S[i], (rh - S[i - 1].h) / (S[i].h - S[i - 1].h)); break; }
  for (const s of S) if (s.h <= rh) for (const e of s.events) if (e[0] > HB.evSeen) { HB.evSeen = e[0]; onEvent(e); }
  return v || last;
}
function between(a, c, k) {
  const L = (x, y) => Math.abs(y - x) > 40 ? y : x + (y - x) * k;          // a jump (a kick-off) is not slid across
  let dr = c.ball.rot - a.ball.rot; dr -= Math.round(dr / TAU) * TAU;
  return Object.assign({}, c, { t: a.t + (c.t - a.t) * k,
    ball: Object.assign({}, c.ball, { x: L(a.ball.x, c.ball.x), y: L(a.ball.y, c.ball.y), r: L(a.ball.r, c.ball.r), rot: a.ball.rot + dr * k }),
    P: c.P.map((p, i) => Object.assign({}, p, { x: L(a.P[i].x, p.x), y: L(a.P[i].y, p.y), headR: L(a.P[i].headR, p.headR),
      kick: p.kick >= 0 && a.P[i].kick >= 0 ? L(a.P[i].kick, p.kick) : p.kick })),
    pu: c.pu && a.pu && a.pu.type === c.pu.type ? Object.assign({}, c.pu, { x: L(a.pu.x, c.pu.x), y: L(a.pu.y, c.pu.y) }) : c.pu });
}
function ahead(s, dt) {
  if (dt <= 0 || s.ph !== "play") return s;
  const b = s.ball, y = Math.min(GROUND - b.r, b.y + b.vy * dt + (b.sup > 0 ? 0 : 0.5 * B_GRAV * dt * dt));
  return Object.assign({}, s, { ball: Object.assign({}, b, { x: clamp(b.x + b.vx * dt, b.r, GW - b.r), y }),
    P: s.P.map(p => Object.assign({}, p, { x: p.x + p.vx * dt, y: Math.min(GROUND, p.y + p.vy * dt) })) });
}

function hbMsg(from, name, d) {
  const now = Date.now() / 1000;
  if (d.k === "ask") {
    if (d.to !== myId()) return;
    pruneAsks();
    HB.asks[d.id] = { id: d.id, from, name, at: now };
    if (GAME.open) toast(`⚽ ${esc(name)} challenges you to Noggin Cup · click to accept`, () => accept(d.id), 15000);
    else note(`⚽ ${name} challenges you to Noggin Cup: Games tab → Accept`);
    peopleKey = ""; refreshSide();
    return;
  }
  if (d.id !== HB.id || !HB.id) {
    // a challenge taken back before it was answered
    if (d.k === "bye" && HB.asks[d.id] && HB.asks[d.id].from === from) { delete HB.asks[d.id]; peopleKey = ""; refreshSide(); }
    return;
  }
  if (from !== HB.opp) return;
  HB.heard = now;
  if (d.k === "yes" && HB.phase === "wait" && HB.me === 0) startHost();
  if (d.k === "no" && HB.phase === "wait") { HB.phase = "idle"; HB.id = ""; toast(`${esc(name)} said not now`, null, 3000); refreshSide(); }
  if (d.k === "in" && HB.me === 0 && HB.phase === "play" && HB.w) takeInput(d);
  if (d.k === "st" && isGuest() && HB.phase === "play") takeState(d);
  if (d.k === "end" && isGuest() && HB.phase === "play") {
    for (const e of Array.isArray(d.e) ? d.e : []) if (Array.isArray(e) && num(e[0]) > HB.evSeen) { HB.evSeen = num(e[0]); onEvent(unpackEvent(e)); }
    const s = Array.isArray(d.s) ? d.s.map(num) : [0, 0];
    if (HB.view) HB.view = Object.assign({}, HB.view, { s, ph: "over" });
    finish(s);
  }
  if (d.k === "bye" && (HB.phase === "play" || HB.phase === "wait")) {
    if (HB.phase === "wait") { HB.phase = "idle"; HB.id = ""; refreshSide(); return; }
    const V = currentView();
    finish(V ? V.s : [0, 0], `${HB.oppName} left`);
  }
}

// ---------- each frame ----------
function hbStep(dt) {
  const now = Date.now() / 1000;
  stepFX(dt);
  if (HB.phase === "idle" || HB.phase === "wait") {
    // behind the title: the computer plays itself
    if (!HB.demo || (HB.demo.ph === "over" && HB.demo.phT > 3)) { HB.demo = newWorld(newSeed()); HB.demo.diffs = [1, 2]; }
    runWorld(HB.demo, dt, [true, true]);
    if (HB.phase === "wait" && now - HB.waitAt > 45) {
      gsend({ g: ID, k: "bye", id: HB.id }); HB.phase = "idle"; HB.id = "";
      toast(`No answer from ${esc(HB.oppName)}`, null, 3000); refreshSide();
    }
    ginfo.textContent = HB.phase === "wait" ? `waiting for ${HB.oppName} to accept` : "pick an opponent";
  } else if (HB.phase === "play" && isGuest()) {
    if (now - HB.sent >= SEND) sendKeys(now);
    if (now - HB.heard > GONE) finish(HB.view ? HB.view.s : [0, 0], `${HB.oppName} went quiet`);
    else {
      HB.view = guestView() || HB.view;
      // the host's end message got lost: the pictures say it is over
      if (HB.view && HB.view.ph === "over" && HB.view.phT > 2) finish(HB.view.s);
    }
  } else if (HB.phase === "play") {
    const W = HB.w, I = W.inp[HB.me], k = GAME.keys, held = list => list.some(x => k.has(x)) ? 1 : 0;
    I.l = held(KEYS.l); I.r = held(KEYS.r); I.u = held(KEYS.u); I.f = 1;
    runWorld(W, dt, HB.mode === "cpu" ? [HB.me !== 0, HB.me !== 1] : [false, false]);
    if (HB.mode === "net") {
      if (now - HB.sent >= SEND) { HB.sent = now; gsend(packState(W)); }
      if (now - HB.heard > GONE) finish(W.s, `${HB.oppName} went quiet`);
    }
    if (W.ph === "over" && HB.phase === "play") {
      if (HB.mode === "net") gsend({ g: ID, k: "end", id: HB.id, s: W.s.slice(), e: W.events.map(e => e.slice()) });
      finish(W.s);
    }
  } else if (HB.phase === "over" && HB.w && !isGuest()) {
    for (const i of HB.w.inp) Object.assign(i, newInput());
    runWorld(HB.w, dt, [false, false]);                // the ball rolls on after the whistle
  }
  const V = currentView();
  if (V) observe(V, dt);
  if (HB.phase === "play" || HB.phase === "over") {
    const s = V ? V.s : [0, 0];
    ginfo.textContent = `you ${s[HB.me]} : ${s[1 - HB.me]} ${oppLabel()}` + (V && HB.phase === "play" ? ` · ${clock(V)}${V.gold ? " golden goal" : ""}` : "");
  }
  refreshSideIfChanged();
}
function sendKeys(now) {
  const k = GAME.keys, held = list => list.some(x => k.has(x)) ? 1 : 0;
  HB.sent = now;
  gsend({ g: ID, k: "in", id: HB.id, l: held(KEYS.l), r: held(KEYS.r), u: held(KEYS.u), j: HB.cnt.j, x: HB.cnt.x, p: HB.cnt.p });
}
/// A key went down (auto-repeats are not presses): jump, kick and the lightning shot.
function hbKey(k, down) {
  if (!down) { HB.held.delete(k); return; }
  if (HB.held.has(k)) return;
  HB.held.add(k);
  if (HB.phase !== "play") return;
  const what = KEYS.u.includes(k) ? "j" : KEYS.k.includes(k) ? "x" : KEYS.p.includes(k) ? "p" : "";
  if (!what) return;
  if (isGuest()) { HB.cnt[what]++; const now = Date.now() / 1000; if (now - HB.sent >= SEND) sendKeys(now); return; }
  if (HB.w) HB.w.inp[HB.me][{ j: "jp", x: "kp", p: "pp" }[what]] = 1;
}
const clock = V => { const s = Math.max(0, Math.ceil(V.t - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ---------- pictures: a small pixel painter ----------
const rgb = h => { const n = parseInt(String(h).slice(1, 7), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const hex = c => "#" + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dim = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const WHITE = [255, 255, 255], INK = [22, 18, 30];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
const nhash = (x, y, s) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
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
    rect(x, y, ww, hh, c, a) { for (let j = y; j < y + hh; j++) for (let i = x; i < x + ww; i++) P.set(i, j, c, a); },
    /// a dark line round everything painted (4-neighbours)
    outline(c) {
      const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 127, add = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) add.push(x, y);
      for (let i = 0; i < add.length; i += 2) P.set(add[i], add[i + 1], c || INK);
    },
    canvas() { const c = canvasOf(w, h), g = c.getContext("2d"), img = g.createImageData(w, h); img.data.set(d); g.putImageData(img, 0, 0); return c; },
  };
  return P;
}
const pics = new Map();
function pic(key, make) { let c = pics.get(key); if (!c) { if (pics.size > 600) pics.clear(); c = make(); pics.set(key, c); } return c; }
/// A line of square pixels, Bresenham's way.
function pline(x0, y0, x1, y1, c, s) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1); s = s || 1;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, o = s >> 1;
  let err = dx + dy;
  gx.fillStyle = c;
  for (let n = 0; n < 400; n++) {
    gx.fillRect(x0 - o, y0 - o, s, s);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
const rpx = (x, y, w, h, c) => gpx(Math.round(x), Math.round(y), w, h, c);

// ---------- the pixel font: 5×7 letters, a base-32 digit per row ----------
const FONT = {
  A: "ehhvhhh", B: "uhhuhhu", C: "ehggghe", D: "uhhhhhu", E: "vgguggv", F: "vgguggg", G: "ehgnhhf", H: "hhhvhhh",
  I: "e44444e", J: "72222ic", K: "hikokih", L: "ggggggv", M: "hrllhhh", N: "hhpljhh", O: "ehhhhhe", P: "uhhuggg",
  Q: "ehhhlid", R: "uhhukih", S: "fgge11u", T: "v444444", U: "hhhhhhe", V: "hhhhha4", W: "hhhllla", X: "hha4ahh",
  Y: "hha4444", Z: "v1248gv", 0: "ehhhhhe", 1: "4c4444e", 2: "eh1248v", 3: "v2421he", 4: "26aiv22", 5: "vgu11he",
  6: "68guhhe", 7: "v124888", 8: "ehhehhe", 9: "ehhf12c", "!": "4444404", ":": "0cc0cc0", "-": "000v000",
  ".": "00000cc", "'": "4480000", "?": "eh12404", "*": "44veah0", "+": "044v440", " ": "0000000",
};
/// A line of pixel text at scale s: a top-to-bottom colour ramp, a dark outline and a drop shadow.
function textPic(str, s, top, bot, line, shadow) {
  str = String(str).toUpperCase().replace(/[İI]/g, "I").replace(/[^A-Z0-9!:\-.'?*+ ]/g, " ");
  return pic(`t|${str}|${s}|${top}|${bot}|${line}|${shadow}`, () => {
    const gw = str.length * 6 - 1, W = gw * s + 4, H = 7 * s + 4, P = painter(W, H), mask = new Uint8Array(W * H);
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
      P.set(x, y, mix(T, B, Math.floor(t * 4) / 3 > 1 ? 1 : Math.floor(t * 4) / 3));
    }
    return P.canvas();
  });
}
/// Pixel text at (x, y), its top edge; align "left", "center" or "right".
function ptext(str, x, y, s, top, bot, align, line, shadow) {
  const c = textPic(str, s || 1, top || "#ffffff", bot, line === undefined ? "#16121e" : line, shadow === undefined ? "#0a0812" : shadow);
  const w = c.width - 4, ox = align === "center" ? w / 2 : align === "right" ? w : 0;
  gx.drawImage(c, Math.round(x - ox - 1), Math.round(y - 1));
  return w;
}

// ---------- pictures: heads ----------
const SKINS = ["#f6d2ae", "#eab88f", "#d49a6a", "#b07448", "#8a5530", "#5e3a22"];
const HAIRS = ["#2a1c14", "#4a2e1a", "#7a4a26", "#c4893a", "#e9cf7a", "#a83a1e", "#1b1b22", "#8d8f9c"];
function lookOf(id) { const h = hash("noggin " + id); return { skin: SKINS[h % SKINS.length], hair: HAIRS[(h >>> 4) % HAIRS.length], style: (h >>> 8) % 6 }; }
const LIGHT = (() => { const v = [-0.55, -0.65, 0.52], l = Math.hypot(...v); return v.map(x => x / l); })();
/// A head's picture (square, its centre in the middle pixel): a cut-out photo, the robot, or a
/// drawn head. Faces on drawn heads are added as they are drawn (the eyes follow the ball).
function headPic(info, R, dir) {
  R = Math.max(3, Math.round(R));
  if (info.cut) { const c = photoHead(info.cut, R, info.color); if (c) return c; }
  if (info.robot) return pic(`robot|${R}|${dir}`, () => paintRobot(R, dir));
  const L = lookOf(info.id);
  return pic(`head|${R}|${dir}|${info.id}|${info.color}`, () => paintHead(R, dir, L, info.color));
}
function headShade(dx, dy, R) {
  const nz = Math.sqrt(Math.max(0, 1 - (dx * dx + dy * dy) / (R * R)));
  return (dx / R) * LIGHT[0] + (dy / R) * LIGHT[1] + nz * LIGHT[2];
}
const tone = (lam, x, y) => lam > 0.62 + (dither(x, y) - 0.5) * 0.12 ? 1.12 : lam > 0.12 + (dither(x, y) - 0.5) * 0.12 ? 1 : 0.78;
function paintHead(R, dir, L, team) {
  const M = Math.max(4, Math.ceil(R * 0.36)), S = 2 * R + 2 * M + 1, c = S / 2, P = painter(S, S), skin = rgb(L.skin), hair = rgb(L.hair), band = rgb(team);
  // which pixels are hair, for each style (u: toward the face, v: down, both in head radii)
  const hairAt = (dx, dy, inside) => {
    const u = dx * dir / R, v = dy / R, dist = Math.hypot(dx, dy) / R;
    switch (L.style) {
      case 0: return inside && (v < -0.42 || (u < -0.22 && v < 0.18) || (u > 0.1 && v < -0.3));                       // short crop
      case 1: { if (inside) return v < -0.38 || (u < -0.3 && v < 0.05);                                               // spikes
        const a = Math.atan2(dy, dx), f = ((a + Math.PI) / (Math.PI / 5)) % 1, len = 0.32 * (1 - Math.abs(f * 2 - 1));
        return v < -0.35 && dist < 1 + len; }
      case 2: return (inside && (v < -0.28 || (u < -0.05 && v < 0.3))) || (dist < 1.1 && v < -0.25);                 // a mop with a fringe
      case 3: return dist < 1.28 && v < 0.3 && !(inside && u > 0.05 && v > -0.38) && !(u > 0.75);                     // curls
      case 4: return false;                                                                                         // bald (a headband)
      default: return (inside && (v < -0.4 || (u < -0.3 && v < 0.02))) || Math.hypot(u + 0.78, v + 0.72) < 0.34;      // a bun
    }
  };
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = i + 0.5 - c, dy = j + 0.5 - c, inside = dx * dx + dy * dy <= R * R, isHair = hairAt(dx, dy, inside);
    if (!inside && !isHair) continue;
    const lam = headShade(clamp(dx, -R, R), clamp(dy, -R, R), R * 1.05), t = tone(lam, i, j);
    let col = isHair ? dim(hair, t === 1.12 ? 1.35 : t) : dim(skin, t);
    if (isHair && L.style === 3 && (i + j) % 3 === 0) col = dim(hair, 0.8);                                         // curls
    if (isHair && L.style !== 3 && t > 1 && (i * 2 + j) % 5 === 0) col = dim(hair, 1.6);                           // a shine in the hair
    P.set(i, j, col);
  }
  if (L.style === 4) {                             // the headband, its knot behind
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const dx = i + 0.5 - c, dy = j + 0.5 - c, v = dy / R;
      if (dx * dx + dy * dy <= R * R && v > -0.66 && v < -0.42) P.set(i, j, dim(band, v < -0.6 ? 1.2 : 1));
    }
    const kx = Math.round(c - dir * (R + 1)), ky = Math.round(c - R * 0.55);
    P.set(kx, ky, band); P.set(kx - dir, ky + 1, band); P.set(kx - dir, ky + 2, dim(band, 0.8)); P.set(kx, ky + 3, dim(band, 0.8));
  }
  // the ear on the back of the head, the nose on the front
  const ex = Math.round(c - dir * R * 0.32 - 1), ey = Math.round(c);
  P.rect(ex, ey - 1, 2, 3, dim(skin, 0.82)); P.set(ex + (dir > 0 ? 1 : 0), ey, dim(skin, 0.65));
  const nx = Math.round(c + dir * (R - 0.2)) - (dir < 0 ? 1 : 0);
  P.rect(nx, Math.round(c), 2, 2, dim(skin, 0.95)); P.set(nx + (dir > 0 ? 1 : 0), Math.round(c) + 1, dim(skin, 0.8));
  P.outline();
  return P.canvas();
}
function paintRobot(R, dir) {
  const M = 4, S = 2 * R + 2 * M + 1, c = S / 2, P = painter(S, S);
  const steel = [[78, 88, 112], [126, 138, 164], [176, 188, 210], [222, 230, 244]];
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = i + 0.5 - c, dy = j + 0.5 - c;
    if (dx * dx + dy * dy > R * R) continue;
    const lam = headShade(dx, dy, R * 1.03) + (dither(i, j) - 0.5) * 0.15, u = dx * dir / R, v = dy / R;
    let col = steel[lam > 0.75 ? 3 : lam > 0.35 ? 2 : lam > -0.05 ? 1 : 0];
    if (Math.abs(v - 0.38) < 0.06) col = dim(steel[0], 0.8);                                   // a seam round the chin
    if (u > -0.15 && v > -0.48 && v < 0.12 && u < 1) col = v < -0.4 ? [44, 52, 82] : [16, 20, 34];   // the visor
    if (u > 0.2 && u < 0.62 && v > 0.52 && v < 0.7 && (i % 2)) col = [30, 34, 48];               // the mouth grille
    P.set(i, j, col);
  }
  // a glint on the visor, rivets, the bolt on the side
  P.set(Math.round(c + dir * R * 0.55), Math.round(c - R * 0.32), [120, 140, 190]);
  for (const a of [-0.5, 0.2, 0.9]) P.set(Math.round(c - dir * R * Math.cos(a) * 0.8), Math.round(c + R * 0.38 + Math.sin(a) * 0.3), [52, 60, 80]);
  const bx = Math.round(c - dir * R * 0.45), by = Math.round(c);
  P.rect(bx - 1, by - 1, 3, 3, steel[3]); P.set(bx, by, steel[0]);
  P.outline();
  return P.canvas();
}
const photoCache = new WeakMap();
/// Your picture as a head: a square off the top of the cut-out (the face), round, a little posterized,
/// shaded like a ball and outlined. Null when the picture cannot be read.
function photoHead(cut, R, team) {
  let m = photoCache.get(cut);
  if (!m) photoCache.set(cut, m = {});
  if (m[R] !== undefined) return m[R];
  try {
    const M = 4, S = 2 * R + 2 * M + 1, c = S / 2, D = 2 * R;
    let side = Math.min(cut.w, cut.h) * 0.82;
    if (cut.h > cut.w * 1.5) side = cut.w * 0.7;                   // a whole figure: its head is narrower than it
    const tmp = canvasOf(D, D), tg = tmp.getContext("2d");
    tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
    tg.drawImage(cut.canvas, cut.x + (cut.w - side) / 2, cut.y, side, side, 0, 0, D, D);
    const src = tg.getImageData(0, 0, D, D).data, P = painter(S, S), back = dim(rgb(team), 0.5);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const dx = i + 0.5 - c, dy = j + 0.5 - c, d = Math.hypot(dx, dy);
      if (d > R) continue;
      const si = clamp(Math.floor(i - (c - R)), 0, D - 1), sj = clamp(Math.floor(j - (c - R)), 0, D - 1), k = (sj * D + si) * 4;
      let col = src[k + 3] > 100 ? [src[k], src[k + 1], src[k + 2]].map(v => Math.round(v / 18) * 18) : back;
      if (d > R - 1.6) { const lam = headShade(dx, dy, R); col = lam > 0.3 ? mix(col, WHITE, 0.22) : lam < -0.2 ? dim(col, 0.72) : col; }
      P.set(i, j, col);
    }
    P.outline();
    m[R] = P.canvas();
  } catch (e) { m[R] = null; }
  return m[R];
}

// ---------- pictures: the ball, power-ups ----------
const ICO = (() => {
  const p = (1 + Math.sqrt(5)) / 2, v = [];
  for (const [a, b] of [[1, p], [-1, p], [1, -p], [-1, -p]]) v.push([0, a, b], [a, b, 0], [b, 0, a]);
  return v.map(u => { const l = Math.hypot(...u); return u.map(x => x / l); });
})();
/// The ball at radius r, turned to frame f of 16: a sphere with the dark patches of a football,
/// lit from the top left, outlined.
function ballPic(r, f, bolt) {
  return pic(`ball|${r}|${f}|${bolt ? 1 : 0}`, () => {
    const S = 2 * r + 3, c = S / 2, P = painter(S, S), a = f / 16 * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const base = bolt ? [214, 250, 255] : [246, 244, 236], patch = bolt ? [40, 140, 230] : [34, 36, 50];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const dx = i + 0.5 - c, dy = j + 0.5 - c;
      if (dx * dx + dy * dy > r * r + 0.3) continue;
      const nx = dx / r, ny = dy / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      // the point on the ball before its turn (about the axis into the screen), tilted so the patches wander
      const qx = nx * ca + ny * sa, qy = -nx * sa + ny * ca, ty = qy * 0.88 - nz * 0.47, tz = qy * 0.47 + nz * 0.88;
      let best = -1; for (const v of ICO) best = Math.max(best, qx * v[0] + ty * v[1] + tz * v[2]);
      const lam = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], t = lam > 0.6 ? 1 : lam > 0.15 ? 0.86 : 0.68;
      const dark = best > 0.94 && dx * dx + dy * dy < (r - 0.9) * (r - 0.9);
      let col = dim(dark ? patch : base, t);
      if (lam > 0.93 && !dark) col = WHITE;
      P.set(i, j, col);
    }
    P.outline(bolt ? [10, 60, 110] : INK);
    return P.canvas();
  });
}
const ICON_PAL = { k: "#1b1420", w: "#ffffff", l: "#cfd6e6", g: "#8a93a8", y: "#ffd23f", o: "#ff9a2e", r: "#ff4d4d", c: "#8fe3ff", b: "#3c8dff",
  p: "#ff7ad9", P: "#b03d8f", s: "#f2c79c", S: "#c99668", h: "#5a3a22", m: "#7dffb0", n: "#2f9e5f", Y: "#b8860b" };
const ICONS = {
  frost: [".....c.....", ".c..ccc..c.", "..c..c..c..", "...c.c.c...", ".c..cwc..c.", "cccccwccccc", ".c..cwc..c.", "...c.c.c...", "..c..c..c..", ".c..ccc..c.", ".....c....."],
  giant: ["y..hhhhh..y", "yyhhhhhhhyy", "y.hhssshhh.", "..hsssssss.", "..sskssks..", "..sssssss..", "..ssssssS..", "...skkks...", "...SsssS...", "....SSS....", "..........."],
  guard: ["kkkkkkkkkkk", "kmmmmmmmmmk", "kmwwmmmmmmk", "kmwmmnmmmmk", "kmmmnnnmmmk", "kmmnnnnnmmk", ".kmmmnmmmk.", ".kmmmnmmmk.", "..kmmmmmk..", "...kmmmk...", "....kkk...."],
  spring: ["..kkkkk....", ".kpppppkk..", ".kpppppppk.", ".kkkkkkkkk.", "...l...l...", "..lllllll..", "...g...g...", "..lllllll..", "...g...g...", "..lllllll..", "..........."],
  mega: ["o.........o", ".o.......o.", "...........", "...........", "...........", "...........", "...........", "...........", "...........", ".o.......o.", "o.........o"],
};
function iconPic(type) {
  const id = POWERS[type].id;
  return pic(`icon|${id}`, () => {
    const P = painter(11, 11);
    ICONS[id].forEach((row, j) => [...row].forEach((ch, i) => { if (ICON_PAL[ch]) P.set(i, j, rgb(ICON_PAL[ch])); }));
    return P.canvas();
  });
}
/// A power-up's bubble: a glassy ring in its colour, a glint, the icon inside.
function orbPic(type) {
  return pic(`orb|${type}`, () => {
    const P = painter(21, 21), col = rgb(POWERS[type].c), c = 10.5;
    for (let j = 0; j < 21; j++) for (let i = 0; i < 21; i++) {
      const d = Math.hypot(i + 0.5 - c, j + 0.5 - c);
      if (d > 9.5) continue;
      if (d > 8.4) P.set(i, j, mix(col, WHITE, (i + j) < 18 ? 0.5 : 0));
      else P.set(i, j, dim(col, 0.35), 0.55);
    }
    P.outline([20, 16, 30]);
    P.set(5, 5, WHITE); P.set(6, 4, WHITE); P.set(4, 6, WHITE); P.set(7, 4, mix(col, WHITE, 0.6));
    return P.canvas();
  });
}

// ---------- pictures: the stadium ----------
const NEUTRAL = [[226, 226, 214], [60, 60, 70], [214, 190, 90], [120, 170, 110], [170, 110, 160], [230, 140, 90]];
const CROWD_SKIN = SKINS.map(rgb), CROWD_HAIR = HAIRS.map(rgb);
/// The stadium at night, painted once per pair of team colours: sky, floodlights, the roof, two tiers
/// of fans (home fans in the left team's colours on the left), boxes, banners, the advertising boards'
/// frame and the pitch in perspective. Also the crowd once more with arms up, for cheering.
function stadium(cols) {
  return pic(`stadium|${cols}`, () => {
    const P = painter(GW, GH), A = rgb(cols[0]), B = rgb(cols[1]), R = seeded(20261123);
    const sky = [[5, 7, 26], [10, 14, 42], [18, 24, 66], [28, 36, 86]];
    for (let y = 0; y < 22; y++) for (let x = 0; x < GW; x++) {
      const t = y / 21 * (sky.length - 1), i = Math.floor(t);
      P.set(x, y, sky[Math.min(sky.length - 1, i + (t - i > dither(x, y) ? 1 : 0))]);
    }
    for (let k = 0; k < 46; k++) { const x = R() * GW | 0, y = R() * 12 | 0; P.set(x, y, mix(sky[1], [235, 238, 255], 0.35 + R() * 0.6)); }
    // the floodlight masts: a lattice, a bank of lamps, a glow round them
    for (const mx of [24, GW - 25]) {
      for (let y = 0; y < 24; y++) {
        P.set(mx - 3, y, [58, 64, 92]); P.set(mx + 3, y, [58, 64, 92]);
        if (y % 4 === 0) P.rect(mx - 3, y, 7, 1, [44, 50, 76]); else P.set(mx - 3 + ((y % 4) * 2 - 1), y, [44, 50, 76]);
      }
    }
    // the roof: girders underneath, a lit front edge, small lamps along it
    for (let y = 12; y < 22; y++) for (let x = 0; x < GW; x++) {
      const girder = (x + y * 2) % 14 < 2 || (x - y * 2 + 280) % 14 < 2;
      const col = y === 19 ? [100, 110, 150] : y > 19 ? [58, 65, 99] : girder ? [43, 49, 80] : [26, 30, 51];
      P.set(x, y, col, x > 10 && x < GW - 10 || y > 14 ? 1 : 0.85);
    }
    P.rect(0, 12, GW, 1, [46, 53, 85]);
    for (let x = 6; x < GW; x += 16) P.rect(x, 21, 3, 1, [255, 241, 184]);
    crowd(P, 0, false, A, B);
    glow(P, 0);
    for (const mx of [24, GW - 25]) {                  // the lamps, on top of their glow
      P.rect(mx - 13, 0, 27, 10, [24, 26, 40]); P.rect(mx - 13, 9, 27, 1, [50, 56, 84]);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
        const lx = mx - 12 + c * 6 + 1, ly = 1 + r * 4;
        P.rect(lx, ly, 5, 3, [255, 248, 214]); P.rect(lx, ly + 2, 5, 1, [255, 214, 120]); P.set(lx + 2, ly + 1, WHITE);
      }
    }
    // between the tiers: a concrete band of boxes with lit windows
    P.rect(0, 63, GW, 7, [58, 63, 82]); P.rect(0, 63, GW, 1, [86, 93, 122]); P.rect(0, 69, GW, 1, [34, 38, 54]);
    for (let x = 6; x < GW - 8; x += 22) {
      P.rect(x, 65, 12, 3, [32, 30, 40]);
      P.rect(x + 1, 65, 10, 2, R() < 0.8 ? [255, 214, 140] : [90, 110, 150]);
      if (R() < 0.6) P.set(x + 3 + (R() * 6 | 0), 66, [40, 32, 30]);
    }
    // the front wall of the lower tier, fans' banners hung on it
    P.rect(0, 114, GW, 7, [36, 40, 58]); P.rect(0, 114, GW, 1, [70, 76, 104]);
    for (const [x, w, c, s] of [[34, 26, A, 0], [92, 20, A, 1], [204, 22, B, 1], [258, 28, B, 0]]) {
      for (let y = 115; y < 121; y++) for (let i = x; i < x + w; i++) {
        const stripe = s ? ((i - x) >> 2) % 2 : (y - 115) % 3 === 1;
        P.set(i, y + (((i - x) % 7 === 3) ? 0 : 0), stripe ? WHITE : c);
      }
      P.rect(x, 120, w, 1, dim(c, 0.6));
    }
    // the advertising boards' frame (their lights are drawn as they scroll)
    P.rect(0, 121, GW, 1, [64, 70, 96]); P.rect(0, 122, GW, 9, [6, 7, 12]); P.rect(0, 131, GW, 1, [16, 18, 26]);
    pitch(P);
    const cheer = painter(GW, 92);
    crowd(cheer, 22, true, A, B);
    glow(cheer, 22);
    return { base: P.canvas(), cheer: cheer.canvas() };
  });
}
/// The floodlights' glow and the roof lamps' light falling on the stands (painted on both crowds).
function glow(P, oy) {
  for (const mx of [24, GW - 25]) for (let y = Math.max(0, oy); y < 64; y++) for (let x = mx - 46; x <= mx + 46; x++) {
    const d = Math.hypot((x - mx) / 1.25, (y - 4) * 1.1);
    if (d > 42) continue;
    const a = Math.pow(1 - d / 42, 1.8), q = Math.floor(a * 4 + dither(x, y)) / 4;
    if (q > 0) P.set(x, y - oy, [255, 236, 180], q * 0.42);
  }
  for (let x = 6; x < GW; x += 16) for (let y = Math.max(22, oy); y < 40; y++) P.rect(x - 1 - ((y - 22) >> 3), y - oy, 5 + ((y - 22) >> 2), 1, [255, 240, 200], 0.05);
}
/// Two tiers of fans: seat rows, and on them people (a head, a shirt), in the teams' colours mostly.
/// The same seed for the calm crowd and the cheering one, so the two line up pixel for pixel.
function crowd(P, oy, cheer, A, B) {
  const R = seeded(77);
  const stand = [36, 42, 74];
  for (const [y0, y1, rh, l0, l1] of [[22, 63, 4, 0.44, 0.64], [70, 114, 5, 0.58, 0.8]]) {
    for (let y = y0; y < y1; y++) for (let x = 0; x < GW; x++) {
      const l = l0 + (l1 - l0) * (y - y0) / (y1 - y0), row = (y - y0) % rh;
      P.set(x, y - oy, dim(row === rh - 1 ? [48, 56, 92] : row === 0 ? [28, 33, 58] : [36, 42, 74], l));
    }
    for (let y = y0 + 1; y + rh <= y1; y += rh) {
      const l = l0 + (l1 - l0) * (y - y0) / (y1 - y0);
      for (let x = 1 + (R() * 3 | 0); x < GW - 2; x += 3 + (R() < 0.18 ? 1 : 0)) {
        const empty = R() < 0.06, home = x < GW * (0.42 + R() * 0.16), fan = R() < 0.74, nn = R() * NEUTRAL.length | 0;
        const skin = CROWD_SKIN[R() * 5 | 0], hairC = CROWD_HAIR[R() * CROWD_HAIR.length | 0], hasHair = R() < 0.7, arms = R() < 0.8, scarf = R() < 0.25;
        if (empty) continue;
        const shirt = dim(mix(fan ? (home ? A : B) : NEUTRAL[nn], stand, 0.3), l), up = cheer && arms ? 1 : 0, hy = y - up - oy;
        P.rect(x, hy, 2, 2, dim(skin, l * 0.9));
        if (hasHair) P.rect(x, hy, 2, 1, dim(hairC, l));
        P.rect(x - 1 + (rh > 4 ? 0 : 1), y + 2 - oy - up, rh > 4 ? 3 : 2, rh - 2 + up, shirt);
        if (up) {
          if (scarf) P.rect(x - 1, hy - 2, 4, 1, dim(home ? A : B, l * 1.15));
          P.set(x - 1, hy - 1, dim(skin, l)); P.set(x + 2, hy - 1, dim(skin, l));
        }
      }
    }
  }
}
/// The pitch, seen from the side and a little above: mown stripes and lines in perspective, darker
/// under the stands.
const VP = 260, persp = (x, y) => GW / 2 + (x - GW / 2) * (y + VP) / (GROUND + VP);
function pitch(P) {
  const g1 = [62, 138, 60], g2 = [53, 122, 52];
  for (let y = 132; y < GH; y++) for (let x = 0; x < GW; x++) {
    const x0 = GW / 2 + (x - GW / 2) * (GROUND + VP) / (y + VP), stripe = Math.floor((x0 + 1000) / 26.67) % 2;
    const far = clamp((y - 132) / 18, 0, 1), n = nhash(x, y, 3);
    let col = dim(stripe ? g1 : g2, 0.78 + 0.22 * far);
    if (n < 0.08) col = dim(col, 0.88); else if (n > 0.94) col = dim(col, 1.1);
    if (y === 132) col = dim(col, 0.55);
    P.set(x, y, col);
  }
  const line = (x, y, a) => P.set(x, y, [236, 240, 226], a || 0.8);
  for (let x = 0; x < GW; x++) line(x, 134, 0.7);
  for (let y = 134; y < GH; y++) line(GW / 2, y, 0.65);
  for (let k = 0; k < 360; k++) { const a = k / 360 * TAU, y = 162 + Math.sin(a) * 11; line(Math.round(GW / 2 + Math.cos(a) * 36 * (y + VP) / (GROUND + VP)), Math.round(y), 0.65); }
  P.rect(GW / 2 - 1, 162, 2, 1, [236, 240, 226]);
  for (const s of [0, 1]) {
    const X = (x, y) => Math.round(s ? GW - persp(x, y) : persp(x, y));
    for (let y = 134; y < GH; y++) { line(X(GOAL_W, y), y, 0.6); if (y >= 144 && y <= 196) line(X(GOAL_W + 46, y), y, 0.6); if (y >= 156 && y <= 186) line(X(GOAL_W + 16, y), y, 0.6); }
    for (const [y, w] of [[144, 46], [196, 46], [156, 16], [186, 16]]) for (let x = X(GOAL_W, y), e = X(GOAL_W + w, y), d = e > x ? 1 : -1; x !== e; x += d) line(x, y, 0.6);
    line(X(GOAL_W + 33, 170), 170, 0.9);
  }
}
/// The goal's still parts as pictures: what is behind the ball (the far side's frame and net, the roof
/// net, a shadow), the near side's net, and the frame in front (posts and crossbar). Painted for the
/// left goal and mirrored for the right (the light still comes from the top left).
function goalPics(g) {
  return pic(`goal|${g}`, () => {
    const W = GOAL_W + 8, y0 = BAR_Y - 12, H = GROUND + 4 - y0, back = painter(W, H), net = painter(W, H), frame = painter(W, H);
    const X = x => g ? W - 1 - x : x, Y = y => y - y0;
    const mesh = (P, x0, x1, ya, yb, col, a) => {
      for (let y = ya; y <= yb; y++) for (let x = x0; x <= x1; x++) {
        const u = (x - x0 + (y - ya)) % 4, v = (x - x0 - (y - ya) + 400) % 4;
        if (u === 0 || v === 0) P.set(X(x), Y(y), col, a);
      }
    };
    const netC = [214, 222, 236], white = [244, 244, 238], grey = [168, 172, 180], greyD = [120, 124, 134], dark = [20, 18, 26];
    for (let y = GROUND - 7; y <= GROUND; y++) for (let x = NET_X; x <= GOAL_W + 2; x++) back.set(X(x), Y(y), [0, 0, 0], 0.3);
    mesh(back, NET_X + 2, GOAL_W + 2, BAR_Y - 7, GROUND - 7, netC, 0.22);
    for (let y = BAR_Y - 7; y < BAR_Y; y++) for (let x = 0; x <= GOAL_W + Math.round((BAR_Y - y) * 2 / 7); x++)
      if ((x + y) % 3 === 0 || y === BAR_Y - 4) back.set(X(x), Y(y), netC, 0.3);
    for (let y = BAR_Y - 7; y <= GROUND - 7; y++) { back.set(X(GOAL_W + 2), Y(y), grey); back.set(X(GOAL_W + 3), Y(y), greyD); back.set(X(NET_X + 2), Y(y), greyD); }
    for (let x = 0; x <= GOAL_W + 3; x++) { back.set(X(x), Y(BAR_Y - 8), grey); back.set(X(x), Y(BAR_Y - 7), greyD); }
    mesh(net, NET_X + 1, GOAL_W - 2, BAR_Y + 2, GROUND - 1, netC, 0.4);
    for (let y = BAR_Y; y <= GROUND; y++) { frame.set(X(NET_X - 1), Y(y), dark); frame.set(X(NET_X), Y(y), grey); frame.set(X(NET_X + 1), Y(y), dark); }
    for (let x = NET_X; x <= GOAL_W; x++) { frame.set(X(x), Y(GROUND), grey); frame.set(X(x), Y(GROUND + 1), dark); }
    // the crossbar and the post: white tubes, light on the top and the left, outlined
    const tube = [dark, WHITE, white, [196, 198, 196], dark];
    for (let x = 0; x <= GOAL_W + 2; x++) for (let k = 0; k < 5; k++) frame.set(X(x), Y(BAR_Y - 2 + k), tube[k]);
    const postX = k => g ? W - 1 - (GOAL_W + 2) + k : GOAL_W - 2 + k;          // left to right on the screen
    for (let y = BAR_Y - 1; y <= GROUND + 1; y++) for (let k = 0; k < 5; k++) {
      if (y <= BAR_Y + 1 && (k === 0 || k === 4)) continue;                     // the bar's outline stays where they meet
      frame.set(postX(k), Y(y), y === GROUND + 1 ? dark : tube[k]);
    }
    frame.rect(postX(0), Y(GROUND + 2), 5, 1, [0, 0, 0], 0.35);
    return { back: back.canvas(), net: net.canvas(), frame: frame.canvas(), x: g ? GW - W : 0, y: y0 };
  });
}
/// The advertising boards' scrolling text: a long strip of panels, lit LED by LED.
function ledStrip(cols, goalSide, flash) {
  return pic(`led|${cols}|${goalSide}|${flash}`, () => {
    const segs = goalSide >= 0
      ? [0, 1, 2, 3].map(i => ["GOAL!", (i + flash) % 2 ? "#ffffff" : "#ffe14a", hex(dim(rgb(cols[goalSide]), (i + flash) % 2 ? 0.55 : 0.35))])
      : [["NOGGIN CUP", "#ffd24a", "#3a0e14"], ["* HEADS UP *", "#ffffff", "#10285a"], ["COME ON!", "#ffffff", hex(dim(rgb(cols[0]), 0.45))],
         ["AGENT OFFICE", "#7dffb0", "#08261a"], ["KICK IT!", "#ff9a5c", "#2a1008"], ["LET'S GO!", "#ffffff", hex(dim(rgb(cols[1]), 0.45))]];
    const widths = segs.map(s => s[0].length * 6 + 15), W = widths.reduce((a, b) => a + b, 0), P = painter(W, 9);
    let x = 0;
    segs.forEach(([text, fg, bg], n) => {
      P.rect(x, 0, widths[n], 9, rgb(bg));
      [...text.toUpperCase()].forEach((ch, i) => (FONT[ch] || FONT[" "]).split("").forEach((row, r) => {
        const bits = parseInt(row, 32);
        for (let c = 0; c < 5; c++) if (bits & (16 >> c)) P.set(x + 8 + i * 6 + c, 1 + r, rgb(fg));
      }));
      x += widths[n];
    });
    for (let i = 0; i < W; i += 2) for (let y = 0; y < 9; y++) { const c = P.get(i, y); if (c) P.set(i, y, dim(c, 0.72)); }
    return { c: P.canvas(), w: W };
  });
}

// ---------- show: particles, shakes, banners ----------
const FX = { parts: [], shake: 0, flash: 0, flashC: "#ffffff", banner: null, trail: [], bulge: [null, null], cheer: [0, 0], flashes: 0,
  mood: [{ k: "", t: 0 }, { k: "", t: 0 }], led: null, labels: [], prev: null, armed: [0, 0] };
function resetFX() { Object.assign(FX, { parts: [], shake: 0, flash: 0, banner: null, trail: [], bulge: [null, null], cheer: [0, 0], flashes: 0, mood: [{ k: "", t: 0 }, { k: "", t: 0 }], led: null, labels: [], prev: null }); }
function burst(x, y, n, colors, speed, g, life, size) {
  for (let i = 0; i < n && FX.parts.length < 500; i++) {
    const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7);
    FX.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.2, g: g || 0, life: life * (0.6 + Math.random() * 0.4), max: life, c: colors[i % colors.length], s: size || 1 });
  }
}
const dust = (x, y, n) => burst(x, y, n, ["#9aa36c", "#7d8a56", "#c2c79a"], 30, 40, 0.45, 1);
function confetti(side) {
  const cols = [teamColors()[side], "#ffffff", "#ffd23f", hex(mix(rgb(teamColors()[side]), WHITE, 0.4))];
  for (let i = 0; i < 90 && FX.parts.length < 500; i++)
    FX.parts.push({ x: Math.random() * GW, y: 20 - Math.random() * 40, vx: (Math.random() - 0.5) * 30, vy: 20 + Math.random() * 40, g: 12, life: 2.6 + Math.random(), max: 3.6, c: cols[i % 4], s: Math.random() < 0.3 ? 2 : 1, flutter: Math.random() * TAU });
}
function banner(text, dur, top, bot, s, sub) {
  if (HB.phase === "idle" || HB.phase === "wait") return;
  FX.banner = { text, dur, top, bot, s, sub: sub || "", t: 0 };
}
/// Something happened in the match (here, or on the host): show it, count achievements.
function onEvent(e) {
  const [, type, a, b, x, y] = e;
  switch (type) {
    case EV.ready: banner("READY", READY_T - 0.15, "#ffffff", "#9fb4ff", 3); break;
    case EV.go: banner("GO!", 0.7, "#fff7c2", "#ffb347", 4); FX.flash = 0.2; FX.flashC = "#ffffff"; break;
    case EV.goal: {
      const into = 1 - a;
      banner("GOAL!", GOAL_T - 0.3, "#fff6b0", "#ff8f1f", 5, ["", "HEADER!", "LIGHTNING SHOT!", "OWN GOAL"][b] || "");
      FX.shake = 0.6; FX.flash = 0.45; FX.flashC = "#ffffff"; FX.cheer[a] = 3; FX.flashes = 2.5;
      FX.mood[a] = { k: "happy", t: 3.2 }; FX.mood[1 - a] = { k: "sad", t: 3.2 };
      FX.led = { side: a, t: 3.2 };
      FX.bulge[into] = { t: 0, y: y, a: 5 };
      confetti(a);
      burst(x, y, 24, ["#ffffff", "#ffe7a8", teamColors()[a]], 90, 120, 0.7, 1);
      if (b === 2 && a === HB.me && HB.phase === "play") achieve("headball-bolt");
      break;
    }
    case EV.gold: banner("GOLDEN GOAL", 2, "#fff2a8", "#d99a12", 3, "NEXT GOAL WINS"); FX.flash = 0.3; FX.flashC = "#ffe7a8"; break;
    case EV.end: banner("FULL TIME", 2.4, "#ffffff", "#b9c6ff", 4); FX.cheer = [2.5, 2.5]; FX.flashes = 2; break;
    case EV.hit: burst(x, y, b === 2 ? 8 : 5, b === 2 ? ["#ffffff", "#cfe9b5", "#6fae5f"] : ["#ffffff", "#ffe7a8"], b === 2 ? 70 : 45, 60, 0.3, 1); break;
    case EV.bolt: FX.flash = 0.35; FX.flashC = "#bff6ff"; FX.shake = Math.max(FX.shake, 0.25); burst(x, y, 30, ["#ffffff", "#8fe3ff", "#3fb8ff"], 130, 0, 0.45, 1); break;
    case EV.zap: FX.shake = Math.max(FX.shake, 0.35); burst(x, y, 26, ["#ffffff", "#8fe3ff", "#fff27a"], 110, 0, 0.5, 1); break;
    case EV.pop:
      if (a < 0) { burst(x, y, 10, ["#cfd6e6", "#8a93a8"], 30, 0, 0.4, 1); break; }
      burst(x, y, 28, [POWERS[b].c, "#ffffff"], 90, 30, 0.6, 1);
      FX.labels.push({ text: POWERS[b].name, x, y: y - 14, t: 0, c: POWERS[b].c });
      break;
    case EV.bar: FX.shake = Math.max(FX.shake, 0.15); burst(x, y, 10, ["#ffffff", "#ffe7a8"], 80, 120, 0.35, 1); break;
    case EV.arm: FX.armed[a] = 0.4; break;
  }
}
function stepFX(dt) {
  for (const p of FX.parts) {
    p.life -= dt; p.vy += p.g * dt;
    if (p.flutter !== undefined) { p.flutter += dt * 6; p.vx += Math.sin(p.flutter) * 40 * dt; p.vx *= 1 - 1.5 * dt; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.y > GROUND + 6 && p.flutter !== undefined) { p.y = GROUND + 6; p.vy = 0; p.vx = 0; }
  }
  FX.parts = FX.parts.filter(p => p.life > 0);
  FX.shake = Math.max(0, FX.shake - dt * 1.6); FX.flash = Math.max(0, FX.flash - dt * 2.5); FX.flashes = Math.max(0, FX.flashes - dt);
  FX.cheer = FX.cheer.map(c => Math.max(0, c - dt)); FX.armed = FX.armed.map(c => Math.max(0, c - dt));
  for (const m of FX.mood) m.t = Math.max(0, m.t - dt);
  if (FX.banner && (FX.banner.t += dt) > FX.banner.dur) FX.banner = null;
  if (FX.led && (FX.led.t -= dt) <= 0) FX.led = null;
  for (const b of FX.bulge) if (b) b.t += dt;
  for (const l of FX.labels) { l.t += dt; l.y -= dt * 12; }
  FX.labels = FX.labels.filter(l => l.t < 1.4);
}
/// Effects read off the picture itself, the same on host and guest: bounces kick up grass, a ball
/// into the back of the net bulges it, landings make dust, the lightning shot leaves a trail.
function observe(V, dt) {
  const b = V.ball, pv = FX.prev;
  if (b.sup > 0 && V.ph !== "ready") { FX.trail.push([b.x, b.y]); if (FX.trail.length > 18) FX.trail.shift(); if (Math.random() < 0.6) burst(b.x, b.y, 1, ["#8fe3ff", "#ffffff"], 40, 0, 0.3, 1); }
  else if (FX.trail.length) FX.trail.splice(0, 2);
  if (pv) {
    if (pv.vy > 90 && b.vy <= 0 && b.y + b.r > GROUND - 3) dust(b.x, GROUND, Math.min(8, pv.vy / 40 | 0));
    for (const g of [0, 1]) {
      const inNet = b.y > BAR_Y && (g ? b.x > GW - NET_X - b.r - 3 : b.x < NET_X + b.r + 3);
      if (inNet && (g ? pv.vx > 40 && b.vx <= 0 : pv.vx < -40 && b.vx >= 0)) FX.bulge[g] = { t: 0, y: b.y, a: Math.min(5, Math.abs(pv.vx) / 60) };
    }
    V.P.forEach((p, i) => {
      const q = pv.P[i]; if (!q) return;
      if (!q.ground && p.ground && q.vy > 160) dust(p.x, GROUND, 5);
      if (q.ground && !p.ground && p.vy < -120) dust(p.x, GROUND, 3);
    });
  }
  FX.prev = { vx: b.vx, vy: b.vy, P: V.P.map(p => ({ ground: p.ground, vy: p.vy })) };
}

// ---------- drawing ----------
function hbDraw(t) {
  gx.imageSmoothingEnabled = false;
  const V = currentView(), cols = teamColors();
  if (!V) {
    gpx(0, 0, GW, GH, "#0b0d18");
    ptext("NOGGIN CUP", GW / 2, 70, 3, "#fff2a8", "#e0a020", "center");
    gtext(`${HB.oppName} is setting up the kick-off…`, GW / 2, 110, "#a79d93", 8, "center");
    return;
  }
  const info = [sideInfo(0), sideInfo(1)], st = stadium(cols);
  gx.save();
  if (FX.shake > 0) gx.translate(Math.round((Math.random() - 0.5) * FX.shake * 8), Math.round((Math.random() - 0.5) * FX.shake * 6));
  gx.drawImage(st.base, 0, 0);
  drawCrowd(st, t, cols);
  drawLED(t, cols);
  const goals = [goalPics(0), goalPics(1)];
  for (const g of [0, 1]) gx.drawImage(goals[g].back, goals[g].x, goals[g].y);
  if (V.pu) drawPower(V.pu, t);
  for (const p of V.P) drawShadow(p);
  drawShadow(null, V.ball);
  for (const p of V.P) drawPlayer(p, info[p.side], V, t);
  const b = V.ball, inGoal = b.y > BAR_Y && (b.x < GOAL_W || b.x > GW - GOAL_W);
  if (inGoal) drawBall(V, t);
  for (const g of [0, 1]) drawGoalFront(g, goals[g], t);
  if (!inGoal) drawBall(V, t);
  for (const p of V.P) if (p.shield > 0) drawGuard(p.side, p.shield, t);
  for (const p of FX.parts) { if (p.life < p.max * 0.3) gx.globalAlpha = p.life / (p.max * 0.3); rpx(p.x, p.y, p.s, p.s, p.c); gx.globalAlpha = 1; }
  for (const l of FX.labels) { gx.globalAlpha = l.t > 1 ? (1.4 - l.t) / 0.4 : 1; ptext(l.text, l.x, l.y, 1, "#ffffff", l.c, "center"); gx.globalAlpha = 1; }
  gx.restore();
  drawHUD(V, info, t);
  drawBannerNow(V, info, t);
  if (FX.flash > 0) { gx.globalAlpha = Math.min(0.55, FX.flash); gpx(0, 0, GW, GH, FX.flashC); gx.globalAlpha = 1; }
  drawOverlay(V, info, t);
}
/// The fans: columns of the cheering crowd swapped in where people jump (the scoring side's fans after a
/// goal, a Mexican wave now and then), camera flashes, flags waving.
function drawCrowd(st, t, cols) {
  const wave = (t * 70) % 1100 - 120;
  for (let c = 0; c < GW / 4; c++) {
    const x = c * 4, s = x < GW / 2 ? 0 : 1, ph = nhash(c, 1, 9) * TAU;
    let up = FX.cheer[s] > 0 && Math.sin(t * 15 + ph) > -0.2;
    if (!up && x > wave && x < wave + 26) up = Math.sin((x - wave) / 26 * Math.PI) > 0.3;
    if (!up && nhash(c, Math.floor(t * 1.5), 4) < 0.03) up = true;
    if (up) gx.drawImage(st.cheer, x, 0, 4, 92, x, 22, 4, 92);
  }
  const flashes = FX.flashes > 0 ? 9 : Math.random() < 0.04 ? 1 : 0;
  for (let i = 0; i < flashes; i++) {
    const x = Math.random() * GW | 0, y = 24 + (Math.random() * 88 | 0);
    if (y > 62 && y < 71) continue;
    gpx(x, y, 1, 1, "#ffffff"); gx.globalAlpha = 0.5; gpx(x - 1, y, 3, 1, "#ffffff"); gpx(x, y - 1, 1, 3, "#ffffff"); gx.globalAlpha = 1;
  }
  // flags in the lower tier, waving
  for (const [fx, fy, s] of [[52, 86, 0], [118, 98, 0], [146, 76, 0], [182, 90, 1], [226, 80, 1], [284, 96, 1]]) {
    const c = rgb(cols[s]), lift = FX.cheer[s] > 0 ? 3 : 0;
    rpx(fx, fy - 6 - lift, 1, 9, "#2a2630");
    for (let i = 0; i < 8; i++) {
      const wy = Math.round(Math.sin(t * 6 + i * 0.8 + fx) * 1.2);
      gpx(fx + 1 + i, fy - 6 - lift + wy, 1, 5, hex(i % 4 < 2 ? c : mix(c, WHITE, 0.75)));
      gpx(fx + 1 + i, fy - 2 - lift + wy, 1, 1, hex(dim(c, 0.6)));
    }
  }
}
function drawLED(t, cols) {
  const strip = FX.led ? ledStrip(cols, FX.led.side, Math.floor(t * 6) % 2) : ledStrip(cols, -1, 0);
  const off = Math.floor(t * (FX.led ? 40 : 22)) % strip.w;
  for (let x = -off; x < GW; x += strip.w) gx.drawImage(strip.c, x, 122);
  for (let x = 63; x < GW; x += 64) gpx(x, 122, 1, 9, "#06070c");
}
function drawShadow(p, b) {
  const x = p ? p.x : b.x, air = p ? GROUND - p.y : GROUND - b.y - b.r, w = p ? Math.max(6, 14 - air / 6) : Math.max(2, b.r * 2 - air / 12);
  gx.globalAlpha = 0.32 * clamp(1 - air / 150, 0.25, 1);
  rpx(x - w / 2, GROUND, Math.round(w), 2, "#06140a"); rpx(x - w / 2 + 1, GROUND - 1, Math.max(1, Math.round(w) - 2), 1, "#06140a");
  gx.globalAlpha = 1;
}
function drawGoalFront(g, pics, t) {
  const b = FX.bulge[g];
  if (!b || b.t > 1.4) gx.drawImage(pics.net, pics.x, pics.y);
  else {
    // the near net bulging back (and wobbling) where the ball went in: drawn knot by knot
    const amp = b.a * Math.exp(-b.t * 3.2) * Math.cos(b.t * 16), X = x => g ? GW - 1 - x : x;
    const node = (i, j) => { const x = NET_X + 1 + i * 4 + (j & 1) * 2, y = BAR_Y + 2 + j * 2, w = 1 - (x - NET_X) / (GOAL_W - NET_X);
      return [X(x - amp * 1.6 * w * Math.exp(-((y - b.y) ** 2) / 160)), y]; };
    gx.globalAlpha = 0.4;
    const rows = Math.floor((GROUND - 1 - BAR_Y - 2) / 2);
    for (let j = 0; j < rows; j++) for (let i = 0; i <= 4; i++) {
      const [ax, ay] = node(i, j), [bx, by] = node(i, j + 1), i2 = j & 1 ? i + 1 : i - 1;
      if ((j & 1) === 0 || i < 4) pline(ax, ay, bx, by, "#d6deec");
      if (i2 >= 0 && i2 <= 4) { const [cx, cy] = node(i2, j + 1); pline(ax, ay, cx, cy, "#d6deec"); }
    }
    gx.globalAlpha = 1;
  }
  gx.drawImage(pics.frame, pics.x, pics.y);
}
function drawGuard(g, left, t) {
  const x = g ? GW - GOAL_W - 3 : GOAL_W + 1;
  if (left < 1.5 && Math.floor(t * 10) % 2) return;
  for (let y = BAR_Y + 3; y < GROUND; y++) {
    const k = (y * 3 - t * 90) % 24, glow = k < 0 ? k + 24 : k;
    gx.globalAlpha = glow < 4 ? 0.95 : 0.45;
    gpx(x, y, 3, 1, glow < 4 ? "#eafff2" : "#7dffb0");
  }
  gx.globalAlpha = 0.18; gpx(x - 2, BAR_Y + 3, 7, GROUND - BAR_Y - 3, "#7dffb0"); gx.globalAlpha = 1;
}
function drawPower(u, t) {
  if (u.life < 2 && Math.floor(t * 8) % 2) return;
  const x = Math.round(u.x), y = Math.round(u.y + Math.sin(t * 3 + u.x) * 2);
  gx.drawImage(orbPic(u.type), x - 10, y - 10);
  if (POWERS[u.type].id === "mega") gx.drawImage(ballPic(4, Math.floor(t * 8) % 16), x - 5, y - 5);
  gx.drawImage(iconPic(u.type), x - 5, y - 5);
  const a = t * 3;
  for (let i = 0; i < 3; i++) { const k = a + i * TAU / 3; gpx(Math.round(x + Math.cos(k) * 12), Math.round(y + Math.sin(k) * 12), 1, 1, i ? POWERS[u.type].c : "#ffffff"); }
}
function drawBall(V, t) {
  const b = V.ball, r = Math.round(b.r), bolt = b.sup > 0;
  // the lightning shot's trail: a jagged bolt along where it has been
  const tr = FX.trail;
  if (tr.length > 1) {
    let px = tr[0][0], py = tr[0][1];
    for (let i = 1; i < tr.length; i++) {
      const [x, y] = tr[i], j = (Math.random() - 0.5) * 4;
      gx.globalAlpha = 0.25 + 0.6 * i / tr.length;
      pline(px, py, x + j, y - j, "#3fb8ff", 3);
      pline(px, py, x + j, y - j, "#e8fbff", 1);
      px = x + j; py = y - j;
    }
    gx.globalAlpha = 1;
  }
  if (bolt) {
    gx.globalAlpha = 0.35 + Math.random() * 0.2;
    disc(Math.round(b.x), Math.round(b.y), r + 4, "#8fe3ff");
    gx.globalAlpha = 1;
  }
  const f = Math.floor((((b.rot % TAU) + TAU) % TAU) / TAU * 16) % 16;
  gx.drawImage(ballPic(r, f, bolt), Math.round(b.x) - r - 1, Math.round(b.y) - r - 1);
}
/// A player: shadow done; legs (the front one kicks), shorts, shirt in the team's colour, arms, the big
/// head on top (with a face that looks at the ball when it is a drawn one), and what is on them.
function drawPlayer(p, info, V, t) {
  const d = p.dir, x = Math.round(p.x), y = Math.round(p.y), team = rgb(info.color);
  const shirt = info.color, shirtD = hex(dim(team, 0.68)), shirtL = hex(mix(team, WHITE, 0.35)), shorts = "#232741", sock = "#efeae0", boot = "#1d1d26";
  const look = lookOf(info.id), skin = info.robot ? "#9aa6bd" : look.skin, skinD = info.robot ? "#6a7690" : hex(dim(rgb(look.skin), 0.8));
  const air = !p.ground, run = p.ground && Math.abs(p.vx) > 15 ? Math.sin(p.x * 0.33) : 0;
  const X = dx => x + dx * d, box = (dx, dy, w, h, c) => gpx(d > 0 ? x + dx : x - dx - w + 1, y + dy, w, h, c);
  // the back leg and boot
  const bfx = -1 - Math.round(run * 2), bfy = air ? -2 : 0;
  box(-2, -7, 2, 5 + bfy, sock); box(bfx - 2, -2 + bfy, 4, 2, boot); box(bfx + 1, -2 + bfy, 1, 1, "#4a4a58");
  // the back arm
  box(-4 - Math.round(run), -14, 2, 4, skinD);
  // shorts and shirt
  box(-4, -9, 8, 3, shorts); box(-4, -9, 8, 1, "#30365a"); box(3, -9, 1, 3, shirtD);
  box(-4, -16, 8, 7, shirt); box(-4, -16, 2, 7, shirtD); box(2, -16, 2, 1, shirtL); box(1, -15, 3, 1, shirtL);
  box(0, -16, 2, 2, "#f4f1ea"); box(-1, -12, 1, 3, shirtL);
  // the front leg: from the hip to the boot, which swings when kicking
  const [fx, fy, th] = footPos(p), hx = X(2), hy = y - 7, rx = Math.round(fx + (p.kick < 0 ? run * 2 * d : 0)), ry = Math.round(fy) - (air && p.kick < 0 ? 2 : 0);
  pline(hx, hy, rx, ry - 1, sock, 2);
  if (th > 0.9 && p.kick >= 0) { gpx(rx - 1, ry - 3, 3, 3, boot); gpx(rx + d, ry - 4, 1, 2, boot); gpx(rx - 1, ry - 1, 3, 1, "#4a4a58"); }
  else { gpx(d > 0 ? rx - 1 : rx - 2, ry - 1, 4, 2, boot); gpx(d > 0 ? rx + 2 : rx - 2, ry - 1, 1, 1, "#4a4a58"); }
  if (p.spring > 0) for (const sx of [X(bfx - 1), rx]) for (let k = 0; k < 3; k++) gpx(sx - 1 + (k % 2), (sx === rx ? ry : y + bfy) + 1 + k, 2, 1, k % 2 ? "#ff7ad9" : "#cfd6e6");
  // the front arm swings opposite the legs; out when kicking
  if (p.kick >= 0) box(3, -15, 3, 2, skin); else box(3 + Math.round(run), -14, 2, 4, skin);
  box(3 + (p.kick >= 0 ? 0 : Math.round(run)), -15, 2, 1, shirt);
  drawHead(p, info, V, t);
  // on top: frozen in a block of ice, zapped (sparks and stars), armed (crackling)
  const top = y - NECK - 2 * p.headR;
  if (p.frozen > 0) {
    const w = Math.round(p.headR * 2 + 6), h = y - top + 4;
    gx.globalAlpha = 0.5; gpx(x - w / 2 | 0, top - 2, w, h, "#9fe6ff"); gx.globalAlpha = 0.85;
    gpx(x - w / 2 | 0, top - 2, w, 1, "#e8fbff"); gpx(x - w / 2 | 0, top - 2, 1, h, "#e8fbff"); gpx((x - w / 2 | 0) + w - 1, top - 2, 1, h, "#5fb8e8"); gpx(x - w / 2 | 0, top - 2 + h - 1, w, 1, "#5fb8e8");
    pline(x - w / 2 + 3, top + 3, x - w / 2 + 8, top + 8, "#ffffff"); pline(x + 2, y - 8, x + 5, y - 5, "#e8fbff");
    gx.globalAlpha = 1;
  }
  if (p.stun > 0) for (let i = 0; i < 3; i++) {
    const a = t * 6 + i * TAU / 3, sx = Math.round(x + Math.cos(a) * (p.headR + 1)), sy = Math.round(top - 2 + Math.sin(a) * 2);
    gpx(sx - 1, sy, 3, 1, "#fff27a"); gpx(sx, sy - 1, 1, 3, "#fff27a"); gpx(sx, sy, 1, 1, "#ffffff");
  }
  if (p.armed > 0 || FX.armed[p.side] > 0) {
    const hy = headY(p);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TAU, r = p.headR + 2 + Math.random() * 2;
      gpx(Math.round(p.x + Math.cos(a) * r), Math.round(hy + Math.sin(a) * r), 1, 1, Math.random() < 0.5 ? "#ffffff" : "#8fe3ff");
    }
    if (Math.random() < 0.3) { const a = Math.random() * TAU, r = p.headR + 1; let px = p.x + Math.cos(a) * r, py = hy + Math.sin(a) * r;
      for (let k = 0; k < 3; k++) { const nx = px + Math.cos(a) * 3 + (Math.random() - 0.5) * 4, ny = py + Math.sin(a) * 3 + (Math.random() - 0.5) * 4; pline(px, py, nx, ny, "#bff6ff"); px = nx; py = ny; } }
  }
}
function drawHead(p, info, V, t) {
  const R = Math.max(3, Math.round(p.headR)), d = p.dir, hx = Math.round(p.x), hy = Math.round(headY(p));
  const photo = info.cut ? photoHead(info.cut, R, info.color) : null, c = photo || headPic(info, R, d), o = (c.width - 1) / 2;
  gx.drawImage(c, hx - o, hy - o);
  if (photo) return;                                            // a photo keeps its own face
  const b = V.ball, lx = b.x - hx, ly = b.y - hy, ll = Math.hypot(lx, ly) || 1, ox = lx / ll, oy = ly / ll;
  const s = R / HEAD_R, mood = FX.mood[p.side], busy = p.kick >= 0 || p.armed > 0, open = !p.ground || p.kick >= 0;
  const at = (u, v) => [hx + Math.round(u * s) * d - (d < 0 ? 1 : 0), hy + Math.round(v * s)];
  if (info.robot) {
    // LED eyes in the visor, glowing in the difficulty's colour; an antenna with a blinking tip
    const eye = DIFFS[info.diff || 0].eye, shift = Math.round(ox * 1.4) * 1;
    for (const u of [2, 7]) {
      const [ex, ey] = at(u, -3);
      if (mood.t > 0 && mood.k === "happy") { gpx(ex - 1 + shift, ey, 1, 1, eye); gpx(ex + shift, ey - 1, 1, 1, eye); gpx(ex + 1 + shift, ey, 1, 1, eye); }
      else if (mood.t > 0 && mood.k === "sad" || p.stun > 0) gpx(ex - 1 + shift, ey, 3, 1, eye);
      else { gx.globalAlpha = 0.35; gpx(ex - 1 + shift, ey - 1, 4, 4, eye); gx.globalAlpha = 1; gpx(ex + shift, ey + (busy ? 1 : 0), 2, busy ? 1 : 2, eye); }
    }
    const tipY = hy - R - 4;
    gpx(hx - d, hy - R - 3, 1, 3, "#5d6880"); gpx(hx - d - 1, tipY - 1, 3, 2, Math.floor(t * 2.5 + p.side) % 2 ? eye : "#3a4058");
    return;
  }
  // a drawn face: eyes that follow the ball and blink, eyebrows, a mouth that shows the mood
  const blink = ((t + p.side * 1.7) % 3.6) < 0.12;
  for (const u of [1, 6]) {
    const [ex, ey] = at(u, -3);
    if (blink || p.stun > 0) { gpx(ex, ey + 2, 3, 1, "#2a1a22"); continue; }
    gpx(ex, ey, 3, 4, "#ffffff"); gpx(ex, ey + 3, 3, 1, "#d8d4e4");
    gpx(ex + (ox > 0.3 ? 1 : ox < -0.3 ? 0 : d > 0 ? 1 : 0), ey + (oy > 0.35 ? 2 : oy < -0.35 ? 0 : 1), 2, 2, "#1d1424");
    if (busy || mood.k === "sad" && mood.t > 0) { const [bx, by] = at(u, -5); gpx(bx, by + (u === 6 ? 1 : 0) * (busy ? 1 : 0), 3, 1, "#2a1a22"); }
    else { const [bx, by] = at(u, -5); gpx(bx, by, 3, 1, hex(dim(rgb(lookOf(info.id).hair), 0.8))); }
  }
  const [mx, my] = at(4, 5);
  if (mood.t > 0 && mood.k === "happy") { gpx(mx - 1, my, 5, 2, "#5a1e2a"); gpx(mx, my + 1, 3, 1, "#e06c6c"); gpx(mx - 1, my - 1, 1, 1, "#5a1e2a"); gpx(mx + 3, my - 1, 1, 1, "#5a1e2a"); }
  else if (mood.t > 0 && mood.k === "sad") { gpx(mx, my, 3, 1, "#5a1e2a"); gpx(mx - 1, my + 1, 1, 1, "#5a1e2a"); gpx(mx + 3, my + 1, 1, 1, "#5a1e2a"); }
  else if (open) { gpx(mx, my - 1, 3, 3, "#5a1e2a"); gpx(mx + 1, my, 1, 1, "#e06c6c"); }
  else gpx(mx, my, 3, 1, "#7a3a3a");
}
/// A small head (the scoreboard's, the title's, the icon's) centred on (cx, cy), with a face of a few pixels.
function smallHead(info, cx, cy, R, dir, t) {
  const photo = info.cut ? photoHead(info.cut, R, info.color) : null, c = photo || headPic(info, R, dir), o = (c.width - 1) / 2;
  gx.drawImage(c, cx - o, cy - o);
  if (photo) return;
  const ex = k => dir > 0 ? cx + k : cx - k - 1;
  if (info.robot) { const eye = DIFFS[info.diff || 0].eye; gpx(ex(1), cy - 2, 1, 1, eye); gpx(ex(Math.round(R * 0.6)), cy - 2, 1, 1, eye); return; }
  const blink = ((t + cx * 0.01) % 3.3) < 0.12, h = R > 7 ? 2 : 1;
  for (const k of [1, Math.round(R * 0.55) + 1]) { gpx(ex(k), cy - 2, 1, blink ? 1 : h + 1, blink ? "#2a1a22" : "#ffffff"); if (!blink) gpx(ex(k), cy - 1 + (h > 1 ? 1 : 0), 1, 1, "#1d1424"); }
  gpx(dir > 0 ? cx + 2 : cx - 3 - (R > 7 ? 1 : 0), cy + Math.round(R * 0.45), R > 7 ? 3 : 2, 1, "#7a3a3a");
}
function drawHUD(V, info, t) {
  // the scoreboard: both scores, the clock in the middle; names and little heads either side
  const x0 = 124, w = 72;
  gpx(x0 - 1, 0, w + 2, 21, "#05060c"); gpx(x0, 1, w, 19, "#11142a"); gpx(x0, 1, w, 1, "#3c4470"); gpx(x0, 19, w, 1, "#0a0b16");
  for (const s of [0, 1]) {
    const bx = s ? x0 + w - 22 : x0 + 1;
    gpx(bx, 2, 21, 17, "#0a0c1a"); gpx(bx, 17, 21, 2, info[s].color);
    ptext(String(V.s[s]), bx + 11, 3, 2, "#ffffff", "#c9d2ff", "center");
  }
  const low = !V.gold && V.t <= 10 && V.ph === "play" && Math.floor(t * 4) % 2;
  ptext(clock(V), x0 + w / 2, 4, 1, V.gold ? "#fff2a8" : low ? "#ff7a5a" : "#ffd27a", V.gold ? "#e0a020" : low ? "#ff4a3a" : "#ff9f2e", "center");
  if (V.gold) ptext("GOLD", x0 + w / 2, 12, 1, "#fff2a8", "#e0a020", "center");
  else { gpx(x0 + 25, 14, 22, 2, "#24284a"); gpx(x0 + 25, 14, Math.round(22 * V.t / MATCH), 2, "#ffd27a"); }
  for (const s of [0, 1]) {
    const name = String(info[s].name).slice(0, 12), hx = s ? x0 + w + 4 : x0 - 18;
    gpx(hx - 1, 2, 16, 16, "#0a0c1a"); smallHead(info[s], hx + 7, 10, 6, s ? -1 : 1, t);
    gtext(name, s ? hx + 18 : hx - 3, 5, "#f1ebe2", 7, s ? "left" : "right");
    if (info[s].me && HB.phase !== "idle" && HB.phase !== "wait") gtext("you", s ? hx + 18 : hx - 3, 13, "#8fd6b4", 6, s ? "left" : "right");
  }
  // the lightning bars and the power-ups each player has, at the bottom corners
  for (const p of V.P) {
    const s = p.side, bx = s ? GW - 72 : 12, full = p.meter >= 0.999, my = info[s].me;
    bolt(s ? GW - 9 : 3, 187, full ? "#fff27a" : "#8a93a8");
    gpx(bx - 1, 188, 62, 7, "#05060c"); gpx(bx, 189, 60, 5, "#1a1e36");
    const fill = Math.round(58 * p.meter), fx = s ? bx + 59 - fill : bx + 1;
    gpx(fx, 190, fill, 3, p.armed > 0 ? (Math.floor(t * 12) % 2 ? "#ffffff" : "#8fe3ff") : full ? (Math.floor(t * 4) % 2 ? "#bff6ff" : "#5fd0ff") : "#3fa0e0");
    gpx(fx, 190, fill, 1, "#bff6ff");
    if (full && my && p.armed <= 0 && HB.phase === "play") ptext("SHIFT", s ? bx - 4 : bx + 64, 187, 1, "#fff27a", "#ffb347", s ? "right" : "left");
    if (p.armed > 0) ptext("ARMED", s ? bx - 4 : bx + 64, 187, 1, "#ffffff", "#8fe3ff", s ? "right" : "left");
    let ix = s ? GW - 18 : 4;
    for (const [k, pi] of [["giant", 2], ["spring", 4], ["shield", 3], ["frozen", 1]]) {
      if (!(p[k] > 0)) continue;
      gx.drawImage(iconPic(pi), ix, 173);
      gpx(ix, 185, Math.round(11 * Math.min(1, p[k] / POWERS[pi].t)), 1, POWERS[pi].c);
      ix += s ? -14 : 14;
    }
  }
  if (V.mega > 0) { gx.drawImage(orbPic(0), GW / 2 - 10, 22); gx.drawImage(ballPic(4, Math.floor(t * 8) % 16), GW / 2 - 5, 27); gpx(GW / 2 - 10, 44, Math.round(21 * V.mega / POWERS[0].t), 1, POWERS[0].c); }
  // who is who, at the kick-off
  if ((V.ph === "ready" || V.ph === "play" && V.phT < 1) && HB.phase === "play") {
    const p = V.P[HB.me], x = Math.round(p.x), ty = Math.round(headY(p) - p.headR - 15 + Math.sin(t * 8) * 1.5);
    gpx(x - 11, ty - 1, 23, 11, "#8fd6b4"); gpx(x - 10, ty, 21, 9, "#0b0d18");
    ptext("YOU", x + 1, ty + 1, 1, "#ffffff", "#bff0d8", "center", "", "");
    gpx(x - 2, ty + 10, 5, 1, "#8fd6b4"); gpx(x - 1, ty + 11, 3, 1, "#8fd6b4"); gpx(x, ty + 12, 1, 1, "#8fd6b4");
  }
}
function disc(x, y, r, c) { for (let dy = -r; dy <= r; dy++) { const w = Math.round(Math.sqrt(r * r - dy * dy)); gpx(x - w, y + dy, w * 2 + 1, 1, c); } }
function bolt(x, y, c) { gpx(x + 2, y, 3, 1, c); gpx(x + 1, y + 1, 3, 1, c); gpx(x, y + 2, 5, 1, c); gpx(x + 2, y + 3, 2, 1, c); gpx(x + 1, y + 4, 2, 1, c); gpx(x + 1, y + 5, 1, 1, c); }
function drawBannerNow(V, info, t) {
  const B = FX.banner; if (!B) return;
  const s = B.t < 0.1 ? B.s + 2 : B.t < 0.18 ? B.s + 1 : B.s, fade = B.dur - B.t < 0.3 ? (B.dur - B.t) / 0.3 : 1;
  gx.globalAlpha = fade;
  const y = 66 - s * 3;
  ptext(B.text, GW / 2, y, s, B.top, B.bot, "center", "#1a0f08", "#0a0812");
  if (B.sub) ptext(B.sub, GW / 2, y + 7 * s + 6, 1, "#ffffff", "#ffd27a", "center");
  gx.globalAlpha = 1;
}
function drawOverlay(V, info, t) {
  if (HB.phase === "idle" || HB.phase === "wait") {
    gx.globalAlpha = 0.55; gpx(0, 0, GW, GH, "#05060c"); gx.globalAlpha = 1;
    // the title: NOGGIN over CUP, a ball bouncing between two heads
    const bob = Math.round(Math.sin(t * 2) * 2);
    ptext("NOGGIN", GW / 2, 34 + bob, 5, "#fff6c8", "#f0a020", "center", "#2a1606");
    ptext("CUP", GW / 2, 78 + bob, 3, "#ffffff", "#9fd8ff", "center", "#0a1430");
    // either side of CUP: a head keeping the ball up, and the robot watching it
    const hop = Math.abs(Math.sin(t * 3.2)), lh = hop < 0.12 ? 91 : 90;          // the head nods as the ball lands
    smallHead({ id: "noggin-ace", color: "#5b8def" }, 46, lh, 9, 1, t);
    smallHead({ id: "cpu", robot: true, diff: 1, color: "#e06c6c" }, GW - 46, 90, 9, -1, t);
    gx.drawImage(ballPic(4, Math.floor(t * 12) % 16), 46 - 5, Math.round(lh - 15 - hop * 22) - 5);
    gx.globalAlpha = 0.78; gpx(0, 112, GW, 30, "#05060c"); gx.globalAlpha = 1;
    gpx(0, 112, GW, 1, "#2a2f4a"); gpx(0, 141, GW, 1, "#2a2f4a");
    gtext(HB.phase === "wait" ? `waiting for ${HB.oppName} to accept…` : "play the computer or a teammate (on the right)", GW / 2, 116, "#ffe7a8", 7, "center");
    gtext("← → run    ↑ jump    space kick    shift lightning shot", GW / 2, 129, "#c9c0b6", 6, "center");
    return;
  }
  if (HB.phase === "over" && Date.now() / 1000 - HB.overAt > 1.6) {
    const mine = V.s[HB.me], theirs = V.s[1 - HB.me], res = /left|quiet/.test(HB.result) ? "MATCH OVER" : mine > theirs ? "YOU WIN!" : mine < theirs ? "YOU LOSE" : "DRAW";
    gx.globalAlpha = 0.6; gpx(60, 46, 200, 74, "#05060c"); gx.globalAlpha = 1;
    gpx(60, 46, 200, 1, "#ffd27a"); gpx(60, 119, 200, 1, "#ffd27a");
    ptext(res, GW / 2, 54, 3, res === "YOU WIN!" ? "#fff6b0" : "#ffffff", res === "YOU WIN!" ? "#ff8f1f" : "#9fb4ff", "center");
    ptext(`${V.s[0]} - ${V.s[1]}`, GW / 2, 82, 2, "#ffffff", "#c9d2ff", "center");
    gtext(HB.result, GW / 2, 104, "#ffe7a8", 7, "center");
  }
}

// ---------- the side panel, the Games tab ----------
function hbSide() {
  const now = Date.now() / 1000, asks = pruneAsks(), mates = inRoom() ? roomMates() : [];
  let h = "";
  if (HB.phase === "play") {
    const V = currentView(), s = V ? V.s : [0, 0];
    h += `<h3>${HB.mode === "cpu" ? "VS THE COMPUTER · " + DIFFS[HB.diff].name.toUpperCase() : "VS " + esc(HB.oppName).toUpperCase()}</h3>
      <div class="row"><span class="n">you</span><span class="v">${s[HB.me]}</span></div>
      <div class="row"><span class="n">${esc(oppLabel())}</span><span class="v">${s[1 - HB.me]}</span></div>
      <div class="grid" style="margin-top:6px"><button data-hbquit="1">Leave the match</button></div>`;
  } else {
    if (HB.phase === "over" && HB.result) h += `<h3>FULL TIME</h3><div class="hint">${esc(HB.result)}</div>`;
    h += `<h3>VS THE COMPUTER</h3><div class="pick">${DIFFS.map((x, i) => `<button data-hbdiff="${i}" class="${i === HB.diff ? "on" : ""}">${x.name}</button>`).join("")}</div>
      <div class="hint" style="margin-top:4px">${esc(DIFFS[HB.diff].blurb)}</div>
      <div class="grid" style="margin-top:6px"><button class="go" data-hbcpu="1">${HB.phase === "over" && HB.mode === "cpu" ? "Play again" : "Kick off"}</button></div>`;
    if (HB.phase === "wait") h += `<div class="hint" style="margin-top:8px">Waiting for ${esc(HB.oppName)} to accept…</div><div class="grid" style="margin-top:4px"><button data-hbcancel="1">Take the challenge back</button></div>`;
  }
  if (asks.length) h += `<h3>CHALLENGES</h3>` + asks.map(a => `<div class="row"><span class="n">${esc(a.name)}</span><button class="go" data-hbyes="${esc(a.id)}">Accept</button><button data-hbno="${esc(a.id)}">Not now</button></div>`).join("");
  if (HB.phase !== "play" && HB.phase !== "wait") {
    if (mates.length) h += `<h3>CHALLENGE A TEAMMATE</h3>` + mates.map(m => `<div class="row"><span class="n">${esc(m.name)}</span><button data-hbask="${esc(m.id)}">Challenge</button></div>`).join("");
    else h += `<div class="hint" style="margin-top:8px">${inRoom() ? "Nobody else in the room right now." : "Join a room to challenge a teammate."}</div>`;
  }
  const rec = record(), wdl = r => `${r[0]}W ${r[1]}D ${r[2]}L`;
  h += `<h3>HOW TO PLAY</h3><div class="hint">← → / A D run · ↑ / W jump · Space / S kick. Jump into the ball to head it.<br>
      Every touch fills your ⚡ bar. Full? Shift / X arms the lightning shot: your next touch sends the ball zigzagging at the goal and zaps anyone in its way.<br>
      ${MATCH} seconds; level after that is a golden goal (${GOLDEN} s more, then a draw).</div>
    <h3>POWER-UPS</h3><div class="hint">Touch the bubble (or pop it with the ball you touched last):<br>${POWERS.map(p => esc(p.how)).join("<br>")}</div>
    <h3>YOUR RECORD</h3><div class="hint">${rec.last ? "Last: " + esc(rec.last) + "<br>" : ""}${DIFFS.map((x, i) => `${x.name}: ${wdl(rec.cpu[i])}`).join(" · ")}<br>Teammates: ${wdl(rec.net)}</div>
    <h3>&nbsp;</h3><button data-home="1">Games</button>`;
  gside.innerHTML = h;
  HB.sideKey = sideKey();
}
function sideKey() {
  const V = currentView();
  return [HB.phase, HB.mode, HB.diff, V && HB.phase === "play" ? V.s.join(":") : "", pruneAsks().map(a => a.id).join(","), inRoom() ? roomMates().map(m => m.id).join(",") : ""].join("|");
}
const refreshSide = () => { if (GAME.open && GAME.view === ID) hbSide(); };
const refreshSideIfChanged = () => { if (GAME.open && GAME.view === ID && sideKey() !== HB.sideKey) hbSide(); };
function hbClick(b) {
  if (b.dataset.hbdiff !== undefined) { HB.diff = clamp(+b.dataset.hbdiff, 0, 2); keep("headballDiff", HB.diff); hbSide(); }
  if (b.dataset.hbcpu) playCpu();
  if (b.dataset.hbquit) { leaveMatch(); refreshSide(); }
  if (b.dataset.hbcancel) { leaveMatch(); refreshSide(); }
  if (b.dataset.hbask) ask(b.dataset.hbask);
  if (b.dataset.hbyes) accept(b.dataset.hbyes);
  if (b.dataset.hbno) decline(b.dataset.hbno);
}
const openAsks = pruneAsks;

ACHIEVEMENTS.push(["headball-win", "⚽", "Cup winner", "win a Noggin Cup match"],
                  ["headball-hard", "🤖", "Outplayed the robot", "beat the computer at Noggin Cup on Hard"],
                  ["headball-bolt", "⚡", "Bolt from the blue", "score with a lightning shot"],
                  ["headball-derby", "🏆", "Office derby", "beat a teammate at Noggin Cup"]);
registerGame(ID, {
  title: "⚽ Noggin Cup",
  start: arg => {
    if (arg === "demo") { gshow(ID); playCpu(); return; }
    if (HB.phase !== "play" && HB.phase !== "wait" && HB.phase !== "over") HB.phase = "idle";
    gshow(ID);
  },
  step: hbStep, draw: hbDraw, side: hbSide, click: hbClick, msg: hbMsg, key: hbKey,
  leave: leaveMatch,
  cancel: () => { HB.held.clear(); },
  // in a match, the first Esc only warns: a second one leaves it
  escape: () => {
    if (HB.phase === "play" && Date.now() - HB.escAt > 2500) { HB.escAt = Date.now(); toast("Esc again leaves the match", null, 2500); return true; }
    return false;
  },
  tab: () => {
    const asks = openAsks(), mates = inRoom() ? roomMates() : [];
    return (asks.length ? `<div class="gh">NOGGIN CUP CHALLENGES</div>` + asks.map(a => `<div class="g"><span class="gn">⚽ ${esc(a.name)} challenges you</span><button data-hbgyes="${esc(a.id)}">Accept</button><button class="alt" data-hbgno="${esc(a.id)}">✕</button></div>`).join("") : "")
      + (mates.length ? `<div class="gh">NOGGIN CUP</div>` + mates.map(m => `<div class="g"><span class="gn">⚽ ${esc(m.name)}</span><button class="alt" data-hbgask="${esc(m.id)}">Challenge</button></div>`).join("") : "");
  },
  tabClick: b => {
    if (b.dataset.hbgyes) { accept(b.dataset.hbgyes); return true; }
    if (b.dataset.hbgno) { decline(b.dataset.hbgno); return true; }
    if (b.dataset.hbgask) { openGames("home"); gshow(ID); ask(b.dataset.hbgask); return true; }
    return false;
  },
  tabKey: () => pruneAsks().map(a => a.id).join(",") + (inRoom() ? roomMates().map(m => m.id).join(",") : ""),
  homeHTML: () => { const a = openAsks(); return a.length ? `<h3>NOGGIN CUP CHALLENGES</h3>` + a.map(x => `<div class="row"><span class="n">${esc(x.name)}</span><button class="go" data-hbhome="${esc(x.id)}">Accept</button></div>`).join("") : ""; },
  // the home screen's icon: a little pitch, a goal, two big heads and a ball bouncing between them
  iconCenter: [0, 0],
  drawIcon: t => {
    gpx(-30, 7, 60, 5, "#3e8a3c"); gpx(-30, 7, 60, 1, "#5fae55"); gpx(-30, 11, 60, 1, "#2f6e2e");
    for (const x of [-30, 27]) { gpx(x, -10, 3, 1, "#f4f4ee"); gpx(x + (x < 0 ? 2 : 0), -10, 1, 17, "#f4f4ee"); gx.globalAlpha = 0.4; for (let y = -8; y < 7; y += 2) gpx(x + (x < 0 ? 0 : 1), y, 2, 1, "#d6deec"); gx.globalAlpha = 1; }
    const k = (t * 0.8) % 1, bx = -12 + 24 * (k < 0.5 ? k * 2 : 2 - k * 2), by = -2 - Math.abs(Math.sin(k * TAU)) * 14;
    for (const [x, s, info] of [[-15, 1, { id: "noggin-ace", color: "#5b8def" }], [15, -1, { id: "cpu", robot: true, diff: 1, color: "#e06c6c" }]]) {
      gpx(x - 2, -2, 4, 5, info.color); gpx(x - 2, 3, 4, 2, "#232741"); gpx(x - 2, 5, 1, 2, "#efeae0"); gpx(x + 1, 5, 1, 2, "#efeae0");
      smallHead(info, x, -9, 6, s, t);
    }
    gx.drawImage(ballPic(3, Math.floor(t * 12) % 16), Math.round(bx) - 4, Math.round(by) - 4);
    gtext("noggin cup", 0, 20, "#a79d93", 8, "center");
  },
});
// the home panel's Accept buttons
gside.addEventListener("click", ev => { const b = ev.target.closest("button[data-hbhome]"); if (b) accept(b.dataset.hbhome); });
// for the tests (local/tests/headball): the match without the page
})();
