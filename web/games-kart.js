// 🏁 Desk Karts: a 3D kart race on giant office tracks, against bots and the room. games.js is the
// shell; games-kart-world.js holds the tracks, the karts' stats and looks, and the 3D scene.
//
// Driving: turning is limited by grip, so the quick way through a tight bend is a drift: hop (Space)
// while steering and keep Space held; steering into the drift charges a turbo faster (blue sparks,
// then orange: let go of Space to fire it). Also a rocket start (hold ↑ while the 2 shows; too early
// and the engine stalls), slipstream (stay right behind a kart for a moment), tricks (Space as you
// leave a ramp: a boost on landing), boost pads, and weight: heavy karts push light ones about.
//
// Every Mac drives its own kart. The race's opener also drives the bots and sends them with its own
// position; each Mac decides only whether its own karts were hit, took a box or finished. Items fly
// the same way on every Mac from the moment they are thrown.
//
// Room messages, {g: "kart", k, id, …}: open / lobby {track, laps, cls, fill, skill, players: [{id,
// name, car}], owner} (the owner sends it again when someone joins, leaves or changes kart, and every
// 20 s while waiting), join {car}, car {car}, leave, close, start {players, bots, in}, pos {x, y, z, a,
// v, lap, cp, si, f, h, b: [bots]} eight times a second, item {kind, iid, by, x, y, z, a, sp, si, tg},
// hit {iid, who}, boom {iid, x, y, z} (a reply-all went off), zap {by} (a power cut), box {n},
// done {time, best}, quit.
"use strict";

const KGATES = [0.25, 0.5, 0.75];
const KBOT_NAMES = ["Sam", "Noor", "Kai", "Mira", "Theo", "Ines", "Omar", "Lena", "Yuki", "Ravi"];
// The bots: how close to the limit they drive, how well they drift, start, trick and use items, and
// how much they ease off when far ahead of the people (or push when far behind).
const KSKILL = [
  { name: "Easy", top: 0.85, grip: 0.85, noise: 0.25, drift: false, smt: false, rocket: 0.15, trick: 0.3, trail: false, dodge: false, react: 0.9, ahead: 0.9, behind: 1.03 },
  { name: "Normal", top: 0.94, grip: 0.93, noise: 0.1, drift: true, smt: false, rocket: 0.45, trick: 0.7, trail: true, dodge: true, react: 0.45, ahead: 0.95, behind: 1.05 },
  { name: "Hard", top: 1.035, grip: 1.06, noise: 0.03, drift: true, smt: true, rocket: 0.85, trick: 0.95, trail: true, dodge: true, react: 0.15, ahead: 0.985, behind: 1.08 },
];
const KR = {
  phase: "none", track: 0, laps: 3, cls: 1, fill: true, skill: 1, car: "kart", lobbies: {}, players: [], karts: [], items: [], boxGone: {}, booms: [],
  id: "", owner: "", ownerName: "", t: 0, sent: 0, iidN: 0, wrongT: 0, flash: null, zapAt: -9,
  hopReq: false, itemPress: false, itemHeld: false, spaceDown: false,
  state: "none", scenes: [], meshes: new Map(), imeshes: new Map(), cam: null, camPos: null, fly: 0, lastDraw: 0, mats: {}, geos: {},
};
KR.car = kCar(store("kartCar", "kart")).id;
const kNow = () => Date.now() / 1000;
const kFlash = (text, sec) => { KR.flash = { text, until: kNow() + (sec || 1.2) }; };

// ---------- karts ----------
function kNewKart(p, slot, t) {
  const g = kGrid(t, slot), skill = p.skill === undefined ? 1 : p.skill, sk = KSKILL[skill] || KSKILL[1], lane = (((slot * 37) % 9) / 8 * 2 - 1) * 0.8;
  const k = { id: p.id, name: p.name, bot: !!p.bot, skill, car: kCar(p.car), color: colorOf(p.id),
    sim: p.bot ? KR.owner === myId() : p.id === myId(), lane0: lane, lane, laneTo: lane, laneHold: 0, wob: slot * 1.7,
    x: g.x, y: g.y, z: g.z, a: g.a, si: g.si, v: 0, vy: 0, air: false, lap: 1, cp: 0, lapStart: 0, best: 0, done: 0,
    steerS: 0, drift: 0, driftDir: 0, charge: 0, boostT: 0, boostMul: 1, spinT: 0, shieldT: 0, fallT: 0, droneT: 0,
    rushT: 0, otT: 0, zapT: 0, potT: 0, stallT: 0, item: "", itemN: 0, roll: 0, hold: 0, trail: "", orbit: null,
    slip: 0, trick: false, trickOk: 0, trickV: 0, hopAt: -9, airT: 0, hits: 0, stuck: 0, f: 0, h: 0,
    dx: g.x, dy: g.y, dz: g.z, da: g.a, heard: 0, spinV: 0, gone: false, revR: undefined };
  // a bot's start is decided ahead: a rocket start, sometimes a stall
  if (k.bot) k.revR = Math.random() < sk.rocket ? 1.15 + Math.random() * 0.45 : Math.random() < 0.1 ? 2.7 : undefined;
  return k;
}
const NO_INPUT = { thr: false, brk: false, steer: 0, hold: false, hop: false };
function kBoost(k, sec, mul) { k.boostMul = k.boostT > 0 ? Math.max(k.boostMul, mul) : mul; k.boostT = Math.max(k.boostT, sec); }
/// A kart's top speed now: its class and kart, a bot's handicap, a power cut, a caffeine rush, overtime.
function kTop(k) {
  const cls = KCLASSES[KR.cls];
  if (k.otT > 0) return cls.top * 1.5;
  let top = cls.top * k.car.speed * (k.topMul || 1);
  if (k.zapT > 0) top *= 0.72;
  if (k.rushT > 0) top *= 1.12;
  return top;
}
/// One step of a kart's driving: speed, steering, hops and drifts, walls, hills, ramps and jumps.
function kDrive(t, k, inp, dt) {
  if (k.fallT > 0) {                                  // fell off a roof: the delivery drone brings it back
    k.fallT -= dt; k.vy -= KT.G * dt; k.y += k.vy * dt;
    if (k.fallT <= 0) kRespawn(t, k);
    return;
  }
  for (const f of ["droneT", "shieldT", "rushT", "otT", "zapT", "potT"]) if (k[f] > 0) k[f] -= dt;
  const C = k.car, cls = KCLASSES[KR.cls], n = kNear(t, k.x, k.z, k.si), s = t.S[n.i], off = Math.abs(n.lat) > t.w + 0.4, immune = k.rushT > 0 || k.otT > 0;
  const base = kTop(k);
  let top = off && !k.air && !immune ? base * Math.min(0.62, 0.42 * C.off) : base;
  if (k.stallT > 0) { k.stallT -= dt; inp = { ...inp, thr: false }; }
  if (k.spinT > 0) { k.spinT -= dt; k.v *= Math.pow(0.1, dt); k.drift = 0; k.charge = 0; inp = NO_INPUT; }
  if (k.boostT > 0) { k.boostT -= dt; top = base * k.boostMul; }   // a boost also beats the grass
  if (!k.air) {
    if (k.boostT > 0 || k.otT > 0) k.v = Math.min(top, Math.max(k.v, 0) + 60 * dt);
    else if (inp.thr && k.v < top) { const u = Math.max(0, k.v) / top; k.v += cls.acc * C.acc * (1.35 * Math.pow(1 - u, 1.2) + 0.15) * dt; }
    else if (inp.brk) k.v -= (k.v > 0 ? KT.BRAKE : cls.acc * 0.6) * dt;
    else if (!inp.thr) k.v -= Math.sign(k.v) * Math.min(Math.abs(k.v), KT.COAST * dt);
    if (k.v > top) k.v = Math.max(top, k.v - (off ? 55 : 16) * dt);
    k.v = Math.max(-KT.REV, k.v);
  }
  // steering, smoothed for keyboards; how hard a kart can turn falls with speed (its grip)
  k.steerS += (inp.steer - k.steerS) * Math.min(1, dt * (k.bot ? 40 : 14));
  const st = k.steerS, sp = Math.max(Math.abs(k.v), 1), wet = s.wet && !k.air && !immune && n.lat > s.wet[0] && n.lat < s.wet[1];
  const low = Math.min(1, Math.abs(k.v) / 5) * (wet ? 0.4 : 1);
  k.wet = wet;
  // a hop: Space on the ground; land still holding it while steering and the drift starts. In the air
  // off a ramp, Space is a trick instead.
  if (inp.hop && !k.air && k.spinT <= 0 && k.otT <= 0) { k.vy = 4.2; k.air = true; k.hopAt = KR.t; k.y += 0.02; k.airT = 0; k.trickOk = 0; }
  else if (inp.hop && k.air && k.trickOk > 0 && !k.trick) { k.trick = true; k.trickV = 0; if (k.id === myId()) kFlash("TRICK!", 0.8); }
  if (!k.drift && !k.air && inp.hold && Math.abs(st) > 0.3 && k.v > base * 0.42 && KR.t - k.hopAt < 0.75 && k.spinT <= 0 && k.otT <= 0) { k.drift = Math.sign(st); k.charge = 0; k.driftAge = 0; }
  if (k.drift && (!inp.hold || k.v < base * 0.3 || k.otT > 0)) kDriftEnd(k, false);
  if (k.drift) {
    const into = st * k.drift, maxY = Math.min(2.9, KT.GRIP_DRIFT * C.drift / sp);
    if (!k.air) k.charge += (into > 0.5 ? KT.CHARGE_IN : into < -0.5 ? KT.CHARGE_OUT : KT.CHARGE) * dt;
    k.a += k.drift * maxY * (0.6 + 0.4 * into) * dt * low;
    k.x += Math.sin(k.a) * k.drift * k.v * 0.035 * dt; k.z -= Math.cos(k.a) * k.drift * k.v * 0.035 * dt;   // a little slide outwards
  } else {
    const maxY = Math.min(2.6 * C.hand, KT.GRIP * C.hand / sp);
    k.a += st * maxY * dt * low * Math.sign(k.v || 1) * (k.air ? 0.3 : 1);
  }
  k.a = kWrap(k.a);
  if (s.fan && !k.air && !immune) { k.x += -s.fz * s.fan * 7 * dt; k.z += s.fx * s.fan * 7 * dt; }
  if (!k.air && t.padAt.some(p => n.i >= p && n.i <= p + 2) && Math.abs(n.lat) < 2.4) kBoost(k, 1.0, 1.3);
  k.x += Math.cos(k.a) * k.v * dt; k.z += Math.sin(k.a) * k.v * dt;
  // walls: slide along them, losing the speed that went into them
  const m = kNear(t, k.x, k.z, n.i), s2 = t.S[m.i], lim = t.w + KT.MARGIN - KT.R;
  k.si = m.i;
  if (!s2.gap && Math.abs(m.lat) > lim && k.y > s2.y - 1.5) {
    const sg = Math.sign(m.lat), rx = -s2.fz, rz = s2.fx, push = Math.abs(m.lat) - lim;
    k.x -= rx * sg * push; k.z -= rz * sg * push;
    let vx = Math.cos(k.a) * k.v, vz = Math.sin(k.a) * k.v; const l = vx * rx + vz * rz;
    if (l * sg > 0) {
      const hit = Math.abs(l) / Math.max(0.5, Math.abs(k.v));
      vx -= rx * l; vz -= rz * l; const nv = Math.hypot(vx, vz);
      if (nv > 0.3) k.a = k.v >= 0 ? Math.atan2(vz, vx) : Math.atan2(-vz, -vx);
      k.v = Math.sign(k.v) * nv * (1 - 0.3 * hit);
      if (hit > 0.5 && k.drift) kDriftEnd(k, true);
    }
  }
  // the ground: follow it, leave it over a crest or a ramp's end, land back on it
  const gy = kGround(t, m);
  if (!k.air) {
    const ball = k.y + k.vy * dt - 0.5 * KT.G * dt * dt;
    if (gy < ball - 0.02) {
      k.air = true; k.y = ball; k.vy -= KT.G * dt; k.airT = 0;
      k.trickOk = s2.trick || t.S[(m.i - 1 + t.N) % t.N].trick ? 0.45 : 0;
    } else { k.vy = Math.max(-20, Math.min(20, (gy - k.y) / dt)); k.y = gy; }
  } else {
    k.vy -= KT.G * dt; k.y += k.vy * dt; k.airT += dt;
    if (k.trickOk > 0) k.trickOk -= dt;
    if (k.trick) k.trickV += dt * 10;
    if (k.y <= gy) {
      k.y = gy; k.air = false; k.vy = 0; k.trickOk = 0;
      if (k.trick) { k.trick = false; kBoost(k, 0.8 * C.mt, 1.3); }
    }
  }
  if (k.y < s2.y - 6) { k.fallT = 1.4; k.drift = 0; k.boostT = 0; k.trick = false; }
}
/// The end of a drift: a turbo if it charged far enough (unless a wall cut it short).
function kDriftEnd(k, cancel) {
  if (!cancel && k.charge >= KT.MT) {
    const smt = k.charge >= KT.SMT;
    kBoost(k, 0.42 * k.car.mt * (smt ? 3 : 1), smt ? 1.32 : 1.26);
    if (k.id === myId() && tally("kart-turbos") >= 100) achieve("drifter");
  }
  k.drift = 0; k.charge = 0; k.hopAt = -9;          // the hop is spent: a new drift needs a new hop
}
/// Back on the track after a fall: just past the gap, pointing the right way.
function kRespawn(t, k) {
  let i = k.si;
  for (let n = 0; n < 40 && (t.S[i].gap || t.S[(i - 2 + t.N) % t.N].gap); n++) i = (i + 1) % t.N;
  i = (i + 3) % t.N;
  const s = t.S[i];
  Object.assign(k, { x: s.x, z: s.z, y: s.y, si: i, a: kTan(s), v: 0, vy: 0, air: false, fallT: 0, droneT: 1.2, spinT: 0, trick: false });
}
/// Your keys: driving, and the item key's press and hold (a dragged item goes when you let go).
function kKeys() {
  const K = GAME.keys, has = (...a) => a.some(x => K.has(x));
  const inp = { thr: has("arrowup", "w"), brk: has("arrowdown", "s"), steer: (has("arrowright", "d") ? 1 : 0) - (has("arrowleft", "a") ? 1 : 0),
    hold: has(" ", "shift"), hop: KR.hopReq, use: KR.itemPress, held: KR.itemHeld, back: has("arrowdown", "s") };
  KR.hopReq = false; KR.itemPress = false;
  return inp;
}

// ---------- bots ----------
/// How far a bot leans on the rubber band: easing off far ahead of the best person, pushing far behind.
function kBand(k, sk) {
  if (k.done) return 0.75;
  const lead = kLeadHuman();
  if (lead === null) return 1;
  const gap = kDist(k) - lead;
  return gap > 0.1 ? sk.ahead : gap < -0.06 ? sk.behind : 1;
}
/// A bot's driving (also your kart's on autopilot): the racing line, slowing in time for its bends,
/// drifting through them, moving aside for a kart or a sticky note in the way.
function kBotDrive(t, k, dt) {
  const N = t.N, sk = KSKILL[k.bot ? k.skill : 2] || KSKILL[1], C = k.car, cls = KCLASSES[KR.cls];
  const fx = Math.cos(k.a), fz = Math.sin(k.a), here = t.S[k.si], nn = kNear(t, k.x, k.z, k.si);
  const edge = { lat: nn.lat, pred: nn.lat + Math.sin(kWrap(k.a - kTan(t.S[nn.i]))) * Math.max(Math.abs(k.v), 5) * 0.5 };
  let block = 0;
  for (const o of KR.karts) {
    if (o === k || o.gone) continue;
    const p = kSeen(o), dx = p.x - k.x, dz = p.z - k.z, al = dx * fx + dz * fz, sd = -dx * fz + dz * fx;
    if (al > 0 && al < 9 && Math.abs(sd) < 1.8 && (o.v || 0) < k.v + 1) { block = sd >= 0 ? -1 : 1; break; }
  }
  if (!block && sk.dodge) for (const it of KR.items) {
    if (it.kind !== "note") continue;
    const dx = it.x - k.x, dz = it.z - k.z, al = dx * fx + dz * fz, sd = -dx * fz + dz * fx;
    if (al > 0 && al < 14 && Math.abs(sd) < 1.6) { block = sd >= 0 ? -1 : 1; break; }
  }
  if (!block && sk.dodge) for (const h of t.hz) {
    const p = kHazardAt(t, h, KR.t + 0.4), dx = p.x - k.x, dz = p.z - k.z, al = dx * fx + dz * fz, sd = -dx * fz + dz * fx;
    if (al > 0 && al < 18 && Math.abs(sd) < 2.6) { block = sd >= 0 ? -1 : 1; break; }
  }
  const room = t.w - 1.3;
  if (block) { k.laneTo = Math.max(-room - here.off, Math.min(room - here.off, k.lane + block * 2.4)); k.laneHold = 1.2; }
  else if ((k.laneHold -= dt) <= 0) k.laneTo = k.lane0;
  k.lane += Math.max(-3 * dt, Math.min(3 * dt, k.laneTo - k.lane));
  k.wob += dt;
  const look = Math.max(2, Math.round((5 + Math.abs(k.v) * 0.32) / t.ds)), s = t.S[(k.si + look) % N];
  const lat = Math.max(-room, Math.min(room, s.off + k.lane + Math.sin(k.wob * 1.3) * sk.noise * 1.5));
  const px = s.x - s.fz * lat, pz = s.z + s.fx * lat, dist = Math.hypot(px - k.x, pz - k.z) || 1;
  const diff = kWrap(Math.atan2(pz - k.z, px - k.x) - k.a), sp = Math.max(Math.abs(k.v), 4);
  const needYaw = 2 * sp * Math.sin(diff) / dist;
  // the speed the line's bends allow from here on, braking in time for them
  const grip = (k.drift ? KT.GRIP_DRIFT * C.drift * 0.9 : KT.GRIP * C.hand * (sk.drift ? 1.15 : 1)) * sk.grip;
  let target = cls.top * C.speed * sk.top * kBand(k, sk);
  for (let d = 0; d < 36; d += 2) {
    const q = t.S[(k.si + d) % N], vmax = Math.sqrt(grip * (q.wet ? 0.4 : 1) / Math.max(1e-4, q.k));
    target = Math.min(target, Math.sqrt(vmax * vmax + 2 * KT.BRAKE * 0.7 * d * t.ds));
  }
  if (k.otT > 0) target = 99;
  k.topMul = k.bot ? sk.top * kBand(k, sk) : k.done ? 0.75 : 1;
  // drifts: hop into a bend, keep it while the bend lasts, let go for the turbo
  let hop = false, hold = !!k.drift, steer, bi = k.si, bend = 0;
  for (let d = 3; d <= 14; d++) { const q = t.S[(k.si + d) % N]; if (q.k > bend) { bend = q.k; bi = (k.si + d) % N; } }
  if (sk.drift && !k.drift && !k.air && k.otT <= 0 && k.v > cls.top * 0.5 && bend > 1 / 70 && KR.t - k.hopAt > 0.6 && Math.abs(edge.pred) < t.w - 2) {
    hop = true; hold = true; k.driftDir = t.S[bi].turn || 1;
  }
  if (!k.drift && KR.t - k.hopAt < 0.75) hold = true;
  if (k.drift) {
    k.driftAge = (k.driftAge || 0) + dt;
    const now = t.S[(k.si + 2) % N].k, ahead = Math.max(t.S[(k.si + 6) % N].k, t.S[(k.si + 10) % N].k), want = sk.smt ? KT.SMT : KT.MT;
    const flips = t.S[bi].turn && t.S[bi].turn !== k.drift && bend > 1 / 60;
    if (k.driftAge > 0.5 && ((now < 1 / 120 && ahead < 1 / 120) || (k.charge >= want && ahead < 1 / 70) || flips)) hold = false;
    if (k.driftAge > 0.5 && Math.abs(diff) > 1.4) hold = false;
    const inside = edge.lat * k.drift;                                    // how far toward the bend's inside edge
    if (inside > t.w - 1.2 || edge.pred * k.drift > t.w - 0.8) hold = false;
    const maxY = Math.min(2.9, KT.GRIP_DRIFT * C.drift / sp);
    let into = (needYaw * k.drift / maxY - 0.6) / 0.4;
    // good drivers pulse into the drift while the line allows it: a tighter line, a faster charge
    if (sk.smt && into < 0.5 && Math.abs(diff) < 0.15 && inside < t.w - 3 && Math.floor(k.driftAge * 4) % 2 === 0) into = 0.7;
    steer = Math.max(-1, Math.min(1, into)) * k.drift;
  } else {
    const maxY = Math.min(2.6 * C.hand, KT.GRIP * C.hand / sp);
    steer = Math.max(-1, Math.min(1, needYaw / maxY));
    if (hold && k.driftDir) steer = k.driftDir * Math.max(0.6, Math.abs(steer));
  }
  steer = Math.max(-1, Math.min(1, steer + (Math.random() - 0.5) * sk.noise));
  // about to leave the road (where it will be in half a second): turn away from the edge
  if (!k.drift && Math.abs(edge.pred) > t.w - 0.6 && k.otT <= 0) steer = -Math.sign(edge.pred);
  if (k.air && k.trickOk > 0 && !k.trick && Math.random() < sk.trick * dt * 8) hop = true;
  // no headway for three seconds (stuck on a wall, or wedged against another kart): the drone puts it
  // back a little further on, in a free lane
  const prog = kDist(k);
  if (prog > (k.progAt || -9) + 0.004 || k.spinT > 0 || k.stallT > 0 || KR.t < 2 || k.done) { k.progAt = prog; k.stuck = 0; }
  else if ((k.stuck += dt) > 3) {
    k.stuck = 0;
    const i = (k.si + 4) % N, s0 = t.S[i];
    const lane = [0, -2.5, 2.5, -4.5, 4.5].find(l => !KR.karts.some(o => o !== k && !o.gone && Math.hypot(kSeen(o).x - (s0.x - s0.fz * l), kSeen(o).z - (s0.z + s0.fx * l)) < 3)) || 0;
    Object.assign(k, { x: s0.x - s0.fz * lane, z: s0.z + s0.fx * lane, y: s0.y, si: i, a: kTan(s0), v: 0, vy: 0, air: false, droneT: 1.2 });
  }
  return { thr: k.v < target, brk: k.v > target + 3, steer, hold, hop };
}
/// A bot's items: drag a sticky note or a duck behind as a shield, throw it when someone is in range,
/// fire planes at the kart ahead, boost on straights, and the big ones straight away.
function kBotItems(t, k, dt) {
  const sk = KSKILL[k.skill] || KSKILL[1], fx = Math.cos(k.a), fz = Math.sin(k.a);
  k.hold += dt;
  const near = (lo, hi, cone) => KR.karts.find(o => {
    if (o === k || o.gone) return false;
    const p = kSeen(o), dx = p.x - k.x, dz = p.z - k.z, al = dx * fx + dz * fz;
    return al > lo && al < hi && Math.abs(-dx * fz + dz * fx) < cone;
  });
  if (k.hold < sk.react) return { use: false, held: true, back: false };
  if (k.potT > 0) return { use: Math.random() < dt * 3, held: true, back: false };
  if (k.orbit) {                                     // ducks: aimed, so fire when someone is lined up (or soon anyway)
    const fire = !!near(2, 40, 2.4) || (k.hold > 6 && Math.random() < dt * 2);
    const back = !fire && !!near(-12, -1, 3) && Math.random() < dt * 2;
    if (fire || back) k.hold = 0;
    return { use: fire || back, held: true, back };
  }
  if (k.trail) {
    let release = false, back = false;
    if (k.trail === "note") release = (!!near(-12, -1, 3) && Math.random() < dt * 4) || k.hold > 6;
    else release = !!near(3, 140, 80) || k.hold > 3;
    return { use: false, held: !release, back };
  }
  const out = { use: false, held: true, back: false };
  if (!k.item || k.roll > 0) return out;
  switch (k.item) {
    case "note": case "plane": out.use = true; out.held = sk.trail; break;
    case "espresso": out.use = t.S[(k.si + 15) % t.N].k < 1 / 80 || k.hold > 2; break;
    case "wrap": out.use = KR.items.some(it => it.kind !== "note" && it.by !== k.id && Math.hypot(it.x - k.x, it.z - k.z) < 30) || k.hold > 3; break;
    default: out.use = true;
  }
  return out;
}
/// How far round the race a kart is, in laps: the ranking compares this (a finished kart: its time).
function kDist(k) {
  const t = KTRACKS[KR.track];
  if (k.done) return 1e6 - k.done;
  const f = k.si / t.N;
  return (k.lap - 1) + (k.cp === 0 && f > 0.5 ? f - 1 : f);
}
function kLeadHuman() {
  let best = null;
  for (const k of KR.karts) if (!k.bot && !k.gone && !k.done) { const d = kDist(k); if (best === null || d > best) best = d; }
  return best;
}
/// The checkpoints (a quarter, half and three quarters round, in order) and the line.
function kLap(t, k) {
  if (k.done || k.fallT > 0) return;
  const f = k.si / t.N;
  if (k.cp < KGATES.length && f >= KGATES[k.cp] && f < KGATES[k.cp] + 0.12) k.cp++;
  if (k.cp === KGATES.length && f < 0.12) {
    const lapT = KR.t - k.lapStart; k.best = k.best ? Math.min(k.best, lapT) : lapT; k.lapStart = KR.t; k.cp = 0;
    if (k.lap >= KR.laps) { k.done = KR.t; if (k.id === myId()) kFinish(k); else if (k.bot) side(); }
    else { k.lap++; if (k.id === myId()) { kFlash(k.lap === KR.laps ? "FINAL LAP" : `LAP ${k.lap}`, 1.5); side(); } }
  }
}
/// The start: a kart that held the throttle from about when the 2 showed shoots off; one that held it
/// from the 3 stalls.
function kRocket(k) {
  const r = k.revR, mine = k.id === myId();
  if (r === undefined) return;
  if (r > 2.4) { k.stallT = 1.2; if (mine) kFlash("TOO EARLY: STALLED", 1.5); }
  else if (r >= 1.0 && r <= 1.7) { kBoost(k, 0.9, 1.2); if (mine) kFlash("PERFECT START!", 1.5); }
  else if (r >= 0.4) { kBoost(k, 0.4, 1.12); if (mine) kFlash("GOOD START", 1.2); }
}

// ---------- items ----------
/// What a box gives: defensive things at the front, the race-changers at the back.
function kRoll(place, total) {
  const r = total > 1 ? place / (total - 1) : 0, ramp = (a, b) => Math.max(0, Math.min(1, (r - a) / (b - a)));
  const mailOut = KR.items.some(i => i.kind === "mail") || KR.karts.some(k => k.item === "mail");
  const w = {
    note: 30 * (1 - r) + 2, duck3: 26 * (1 - r) + 12, wrap: 10 * (1 - r) + 3,
    plane: place ? 8 + 20 * Math.max(0, 1 - Math.abs(r - 0.5) * 2) + 8 * r : 0,
    espresso: 6 + 14 * r, espresso3: 18 * ramp(0.3, 1), pot: 14 * ramp(0.55, 1), rush: 16 * ramp(0.5, 1),
    mail: mailOut || place < 2 ? 0 : 6 * ramp(0.35, 1), zap: 8 * ramp(0.7, 1), overtime: place >= total / 2 ? 18 * ramp(0.75, 1) : 0,
  };
  let x = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [kind, v] of Object.entries(w)) { x -= v; if (x <= 0) return kind; }
  return "espresso";
}
/// Item boxes: a kart that drives through one gets a new item after a short roulette, in place of the
/// one it holds (which it can still use while the roulette spins); a dragged item stays.
function kBoxes(t, k, dt) {
  const now = KR.t;
  t.boxes.forEach((b, n) => {
    if ((KR.boxGone[n] || 0) > now || Math.abs(k.y + 0.8 - b.y) > 2.5) return;
    if ((k.x - b.x) ** 2 + (k.z - b.z) ** 2 < 1.9 * 1.9) {
      KR.boxGone[n] = now + 2;
      if (KR.multi) gsend({ g: "kart", k: "box", id: KR.id, n });
      if (k.roll <= 0) k.roll = 1.1;
    }
  });
  if (k.roll > 0 && (k.roll -= dt) <= 0) {
    const r = KR.rank || [], kind = kRoll(Math.max(0, r.indexOf(k)), r.length);
    k.hold = 0; k.orbit = null; k.potT = 0; k.item = ""; k.itemN = 0;      // what it held is swapped for the new one
    if (kind === "duck3") k.orbit = { kind: "duck", n: 3 };
    else if (kind === "espresso3") { k.item = "espresso"; k.itemN = 3; }
    else { k.item = kind; k.itemN = 1; }
  }
}
/// The item key: a press uses the item (a sticky note, duck or plane is dragged behind while the key
/// is held, and thrown when it is let go: backwards with ↓ held); with items going round, each press
/// fires one; a coffee pot boosts on every press.
function kItemUse(t, k, inp) {
  if (k.fallT > 0) return;
  if (k.potT > 0 && inp.use) { kBoost(k, 1.0, 1.3); return; }
  if (k.orbit && inp.use) { kThrow(t, k, k.orbit.kind, inp.back); if (--k.orbit.n <= 0) k.orbit = null; return; }
  if (k.trail && !inp.held) { kThrow(t, k, k.trail, inp.back); k.trail = ""; k.hold = 0; return; }
  if (!k.item || !inp.use) return;
  const kind = k.item;
  if (kind === "note" || kind === "plane") { k.trail = kind; k.item = ""; k.hold = 0; return; }
  if (kind === "espresso") { kBoost(k, 1.3, 1.3); if (--k.itemN > 0) return; }
  if (kind === "pot") { k.potT = 7.5; kBoost(k, 1.0, 1.3); }
  if (kind === "wrap") k.shieldT = 8;
  if (kind === "rush") { k.rushT = 7; kBoost(k, 1, 1.15); }
  if (kind === "mail") kSpawn(t, "mail", k, "", false);
  if (kind === "zap") { kZap(k.id); if (KR.multi) gsend({ g: "kart", k: "zap", id: KR.id, by: k.id }); }
  if (kind === "overtime") { k.otT = 4.5; k.drift = 0; k.charge = 0; }
  k.item = ""; k.itemN = 0; k.hold = 0;
}
function kThrow(t, k, kind, back) {
  if (kind === "plane" && !back) {
    const r = KR.rank || [], p = r.indexOf(k);
    kSpawn(t, "plane", k, p > 0 ? r[p - 1].id : "", false);
  } else kSpawn(t, kind, k, "", kind === "note" ? true : back);
}
function kSpawn(t, kind, k, tg, back) {
  const d = back ? -2.6 : 2.6, a = back && kind !== "note" ? kWrap(k.a + Math.PI) : k.a;
  const sp = kind === "note" ? 0 : kind === "mail" ? 60 : back ? 30 : kind === "plane" ? 46 : 42;
  const it = { iid: `${k.id}:${++KR.iidN}`, kind, by: k.id, x: k.x + Math.cos(k.a) * (kind === "mail" ? 0 : d), z: k.z + Math.sin(k.a) * (kind === "mail" ? 0 : d),
    y: k.y + (kind === "mail" ? 3.5 : 0), a, t: 0, b: 3, si: k.si, pos: k.si, sp, tg };
  kAddItem(it, true);
  if (KR.multi) gsend({ g: "kart", k: "item", id: KR.id, kind, iid: it.iid, by: k.id, x: kR1(it.x), y: kR1(it.y), z: kR1(it.z), a: kR2(it.a), sp, si: k.si, tg });
}
function kAddItem(it, known) {
  if (KR.items.some(o => o.iid === it.iid)) return;
  if (!known) { it.si = kNearAll(KTRACKS[KR.track], it.x, it.z); it.pos = it.si; }
  KR.items.push(it);
  while (KR.items.length > KT.ITEMS_MAX) KR.items.shift();
}
const kR1 = v => Math.round(v * 10) / 10, kR2 = v => Math.round(v * 100) / 100;
/// Items in flight: a duck runs along the ground and bounces off the walls three times, a plane flies
/// after the kart it was thrown at, a note stays where it fell, a reply-all flies along the track to
/// the leader and goes off over them.
function kItemsStep(t, dt) {
  for (const it of KR.items) {
    it.t += dt;
    if (it.kind === "mail") { kMailStep(t, it, dt); continue; }
    if (it.kind === "note") { if (it.t > 45) it.dead = true; continue; }
    let n = kNear(t, it.x, it.z, it.si);
    if (it.kind === "plane" && it.tg) {
      const tg = KR.karts.find(k => k.id === it.tg && !k.gone);
      if (tg) { const p = kSeen(tg), want = Math.atan2(p.z - it.z, p.x - it.x); it.a = kWrap(it.a + Math.max(-3.6 * dt, Math.min(3.6 * dt, kWrap(want - it.a)))); it.y += (p.y + 0.8 - it.y) * Math.min(1, dt * 3); }
    } else if (it.kind === "plane") { const g0 = kGround(t, n); it.y += ((g0 > -100 ? g0 : it.y) + 0.8 - it.y) * Math.min(1, dt * 3); }
    it.x += Math.cos(it.a) * it.sp * dt; it.z += Math.sin(it.a) * it.sp * dt;
    n = kNear(t, it.x, it.z, n.i); it.si = n.i;
    const s = t.S[n.i], gy = kGround(t, n);
    if (it.kind === "duck") {
      const lim = t.w + KT.MARGIN - 0.5;
      if (!s.gap && Math.abs(n.lat) > lim) {
        // a bounce: mirror the way it goes in the wall (only while it is still heading into it), back inside
        const sg = Math.sign(n.lat), out = (Math.cos(it.a) * -s.fz + Math.sin(it.a) * s.fx) * sg;
        if (out > 0) { it.a = kWrap(2 * kTan(s) - it.a); if (--it.b < 0) it.dead = true; }
        it.x -= -s.fz * sg * (Math.abs(n.lat) - lim); it.z -= s.fx * sg * (Math.abs(n.lat) - lim);
      }
      it.y = gy > -100 ? gy : it.y - 20 * dt;
      if (it.y < s.y - 6) it.dead = true;
    }
    if (it.t > (it.kind === "plane" ? 9 : 10)) it.dead = true;
  }
  // only this Mac's own karts are checked: it tells the others what hit them
  for (const it of KR.items) {
    if (it.dead || it.kind === "mail") continue;
    for (const k of KR.karts) {
      if (!k.sim || k.gone || k.fallT > 0 || (it.by === k.id && it.t < 0.6)) continue;
      if (it.kind === "plane" && it.tg && it.tg !== k.id) continue;
      const r = it.kind === "note" ? 1.5 : 1.7;
      if ((k.x - it.x) ** 2 + (k.z - it.z) ** 2 < r * r && Math.abs(k.y - it.y) < 2.2) {
        it.dead = true; kHitKart(k, it.kind, it.by);
        if (KR.multi) gsend({ g: "kart", k: "hit", id: KR.id, iid: it.iid, who: k.id });
        break;
      }
    }
  }
  KR.items = KR.items.filter(it => !it.dead);
  KR.booms = KR.booms.filter(b => KR.t - b.at < 0.7);
}
function kMailStep(t, it, dt) {
  const lead = (KR.rank || []).find(k => !k.gone && !k.done && k.id !== it.by);
  if (!lead || it.t > 30) { it.dead = true; return; }
  const p = kSeen(lead);
  if (!it.dive) {
    it.pos = (it.pos + it.sp * dt / t.ds) % t.N;
    const i = Math.floor(it.pos), s = t.S[i];
    it.si = i; it.x = s.x - s.fz * s.off; it.z = s.z + s.fx * s.off; it.y += (s.y + 3.5 - it.y) * Math.min(1, dt * 4); it.a = kTan(s);
    const ahead = ((lead.si - i) % t.N + t.N) % t.N;
    if (ahead * t.ds < 22) it.dive = true;
  } else {
    const dx = p.x - it.x, dy = p.y + 0.8 - it.y, dz = p.z - it.z, d = Math.hypot(dx, dy, dz);
    if (d < 1.8) { kBoom(it, p.x, p.y, p.z); if (KR.multi) gsend({ g: "kart", k: "boom", id: KR.id, iid: it.iid, x: kR1(p.x), y: kR1(p.y), z: kR1(p.z) }); return; }
    const step = Math.min(d, 48 * dt); it.x += dx / d * step; it.y += dy / d * step; it.z += dz / d * step; it.a = Math.atan2(dz, dx);
  }
}
/// A reply-all goes off: every kart of this Mac's close to it is hit.
function kBoom(it, x, y, z) {
  it.dead = true; KR.booms.push({ x, y, z, at: KR.t });
  for (const k of KR.karts) if (k.sim && !k.gone && (k.x - x) ** 2 + (k.z - z) ** 2 < 49 && Math.abs(k.y - y) < 4) kHitKart(k, "mail", it.by);
}
/// A power cut: everyone else (of this Mac's karts) drops what they hold and slows for a while, the
/// leaders longest.
function kZap(by) {
  KR.zapAt = KR.t;
  const r = KR.rank || [];
  for (const k of KR.karts) {
    if (!k.sim || k.gone || k.id === by || k.rushT > 0 || k.otT > 0) continue;
    k.trail = ""; k.orbit = null;
    if (k.shieldT > 0) { k.shieldT = 0; continue; }
    const frac = r.length > 1 ? Math.max(0, r.indexOf(k)) / (r.length - 1) : 0;
    k.zapT = 3 + 2.5 * (1 - frac); k.spinT = Math.max(k.spinT, 0.6); k.v *= 0.6; k.drift = 0; k.charge = 0;
    if (k.id === myId()) kFlash("POWER CUT", 1.5);
  }
}
/// A kart is hit: items going round or dragged behind take it, then bubble wrap; else it spins out.
function kHitKart(k, kind, by) {
  if (k.rushT > 0 || k.otT > 0 || (kind === "ram" && k.spinT > 0)) return false;
  if (kind !== "mail") {
    if (k.orbit) { if (--k.orbit.n <= 0) k.orbit = null; return false; }
    if (k.trail) { k.trail = ""; return false; }
  }
  if (k.shieldT > 0) { k.shieldT = 0; if (k.id === myId()) kFlash("POP! the wrap saved you"); return false; }
  k.spinT = Math.max(k.spinT, { note: 0.9, duck: 1.3, plane: 1.4, ram: 1.1, mail: 2.0 }[kind] || 1.2);
  k.v *= kind === "note" ? 0.55 : 0.3; k.drift = 0; k.charge = 0; k.hits++; k.trick = false;
  if (kind === "mail") { k.vy = 7; k.air = true; }
  if (k.id === myId()) kFlash(kind === "mail" ? "REPLY-ALL!" : kind === "ram" ? "BUMPED!" : "SPLAT!");
  if (by === myId() && k.id !== myId()) kGotOne();
  return true;
}
function kGotOne() { if (tally("kart-hits") >= 10) achieve("duck-hunter"); }
/// Slipstream: right behind another kart at speed for 1.5 s gives a boost.
function kSlip(k, dt) {
  if (k.air || k.otT > 0 || k.v < kTop(k) * 0.6) { k.slip = Math.max(0, k.slip - dt * 2); return; }
  const fx = Math.cos(k.a), fz = Math.sin(k.a);
  const behind = KR.karts.some(o => {
    if (o === k || o.gone) return false;
    const p = kSeen(o), dx = p.x - k.x, dz = p.z - k.z, al = dx * fx + dz * fz;
    return al > 2.5 && al < 15 && Math.abs(-dx * fz + dz * fx) < 1.4 + al * 0.06 && Math.abs(kWrap(p.a - k.a)) < 0.6;
  });
  k.slip = behind ? k.slip + dt : Math.max(0, k.slip - dt * 2);
  if (k.slip >= 1.5) { kBoost(k, 1.0, 1.22); k.slip = 0; if (k.id === myId()) kFlash("SLIPSTREAM", 0.9); }
}
/// Karts bump: each Mac moves only its own karts; the heavier kart moves less. A kart on a caffeine
/// rush or in overtime knocks the other over instead.
function kBumps() {
  const ks = KR.karts.filter(k => !k.gone && k.fallT <= 0);
  const wild = k => k.sim ? k.rushT > 0 || k.otT > 0 : !!(k.f & 3072);
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const a = ks[i], b = ks[j]; if (!a.sim && !b.sim) continue;
    const pa = kSeen(a), pb = kSeen(b), dx = pa.x - pb.x, dz = pa.z - pb.z, d = Math.hypot(dx, dz);
    if (d >= KT.BUMP || d < 0.01 || Math.abs(pa.y - pb.y) > 1.5) continue;
    const wa = wild(a), wb = wild(b);
    if (wa && !wb && b.sim) kHitKart(b, "ram", a.id);
    if (wb && !wa && a.sim) kHitKart(a, "ram", b.id);
    // apart: each Mac's own kart moves out of the way (all the way when the other is someone else's,
    // whose Mac moves it); the heavier kart moves less
    const ux = dx / d, uz = dz / d, push = KT.BUMP - d, ma = a.car.weight * (wa ? 4 : 1), mb = b.car.weight * (wb ? 4 : 1);
    const shA = b.sim ? mb / (ma + mb) : 1, shB = a.sim ? ma / (ma + mb) : 1;
    if (a.sim) { a.x += ux * push * shA; a.z += uz * push * shA; }
    if (b.sim) { b.x -= ux * push * shB; b.z -= uz * push * shB; }
    // and a knock: only the speed that went into the other kart is traded, by weight, so a side swipe
    // hardly slows anyone and running into a slower kart's back leaves you at about its speed
    const va = kVel(a), vb = kVel(b), closing = (va.x - vb.x) * ux + (va.z - vb.z) * uz;
    if (closing >= 0) continue;
    if (a.sim) kKnock(a, ux, uz, -closing * mb / (ma + mb) * 1.15);
    if (b.sim) kKnock(b, -ux, -uz, -closing * ma / (ma + mb) * 1.15);
  }
}
/// A kart's velocity: along its heading at its speed (someone else's, as last heard).
function kVel(k) { const a = k.sim ? k.a : k.da; return { x: Math.cos(a) * k.v, z: Math.sin(a) * k.v }; }
/// Adds a push of so much speed along (ux, uz) to a kart: its speed and heading follow the result.
function kKnock(k, ux, uz, amount) {
  const vx = Math.cos(k.a) * k.v + ux * amount, vz = Math.sin(k.a) * k.v + uz * amount, sp = Math.hypot(vx, vz);
  if (sp < 0.3) { k.v = 0; return; }
  const along = vx * Math.cos(k.a) + vz * Math.sin(k.a);       // still going forwards?
  if (along >= 0) { k.a = kWrap(k.a + Math.max(-0.35, Math.min(0.35, kWrap(Math.atan2(vz, vx) - k.a)))); k.v = along > 0 ? Math.max(along, sp * 0.85) : sp * 0.5; }
  else k.v = -Math.min(sp, KT.REV);
}

// ---------- the race ----------
const kOwner = () => KR.owner === myId();
function kLobbyMsg(k) { return { g: "kart", k, id: KR.id, track: KR.track, laps: KR.laps, cls: KR.cls, fill: KR.fill, skill: KR.skill, players: KR.players, owner: KR.owner, ownerName: KR.ownerName }; }
function kartStart(arg) {
  Object.assign(KR, { phase: "pick", id: "", karts: [], items: [], me: null });
  if (KR.state === "ready") kClear();
  gshow("kart");
  kLoad();
  if (arg === "demo") kOpen();
}
function kOpen() {
  Object.assign(KR, { phase: "lobby", id: myId() + "-" + Date.now(), owner: myId(), ownerName: myName(), players: [{ id: myId(), name: myName(), car: KR.car }], pinged: kNow() });
  if (inRoom()) { gsend(kLobbyMsg("open")); kSetup(KR.players, []); side(); }
  else kBegin(KR.players, kMakeBots(KR.players.length), 4.5);
}
function kMakeBots(humans) {
  if (!KR.fill) return [];
  const names = KBOT_NAMES.slice().sort((a, b) => hash(KR.id + a) - hash(KR.id + b));
  return Array.from({ length: Math.max(0, KT.MAX - humans) }, (_, i) => ({ id: `bot:${i}`, name: names[i], skill: KR.skill, car: KCARS[hash(KR.id + i) % KCARS.length].id, bot: true }));
}
function kJoin(id) {
  const l = KR.lobbies[id]; if (!l) return;
  leaveCurrent();
  if (!GAME.open) openGames("home");
  Object.assign(KR, { phase: "lobby", id: l.id, track: l.track, laps: l.laps, cls: l.cls, fill: l.fill, skill: l.skill, owner: l.owner, ownerName: l.ownerName,
    players: l.players.filter(p => p.id !== myId()).concat([{ id: myId(), name: myName(), car: KR.car }]) });
  gsend({ g: "kart", k: "join", id, car: KR.car });
  gshow("kart");
  kLoad();
  kSetup(KR.players, []);
}
function kLeave() {
  kShowGL(false);
  if (!KR.id) return;
  if (KR.phase === "lobby") gsend({ g: "kart", k: kOwner() ? "close" : "leave", id: KR.id });
  if (KR.phase === "count" || KR.phase === "go" || KR.phase === "done") gsend({ g: "kart", k: "quit", id: KR.id });
  KR.phase = "pick"; KR.id = ""; KR.karts = []; KR.items = []; KR.me = null;
  kClear();
}
/// Takes the karts and items of the last race out of the scene.
function kClear() {
  for (const m of KR.meshes.values()) if (m.parent) m.parent.remove(m);
  for (const m of KR.imeshes.values()) if (m.parent) m.parent.remove(m);
  KR.meshes.clear(); KR.imeshes.clear();
}
function kStartNow() {
  if (!kOwner() || KR.phase !== "lobby") return;
  const bots = kMakeBots(KR.players.length);
  gsend({ ...kLobbyMsg("start"), bots: bots.map(b => ({ id: b.id, name: b.name, skill: b.skill, car: b.car })), in: KT.START_IN });
  kBegin(KR.players, bots, KT.START_IN);
}
function kSetup(players, bots) {
  const t = kTrack(KR.track);
  kClear();
  const all = bots.map(b => ({ ...b, bot: true })).concat(players.map(p => ({ ...p, bot: false })));
  KR.karts = all.slice(0, KT.MAX).map((p, slot) => kNewKart(p, slot, t));
  KR.me = KR.karts.find(k => k.id === myId()) || null;
  Object.assign(KR, { items: [], booms: [], boxGone: {}, t: 0, rank: KR.karts.slice(), flash: null, wrongT: 0, multi: inRoom() && players.length > 1 });
}
function kBegin(players, bots, inSec) {
  KR.players = players;
  kSetup(players, bots);
  KR.phase = "count"; KR.startAt = kNow() + inSec;
  side();
}
function kFinish(k) {
  KR.phase = "done";
  const t = KTRACKS[KR.track], best = +k.best.toFixed(3), place = 1 + KR.karts.filter(o => o !== k && o.done && o.done < k.done).length, n = KR.karts.filter(o => !o.gone).length;
  const pb = scoreBoard("kart-" + (KR.track + 1), best);
  gsend({ g: "kart", k: "done", id: KR.id, time: +k.done.toFixed(3), best });
  achieve("kart-first");
  if (n >= 4 && place <= 3) achieve("kart-podium");
  if (n >= 4 && place === 1) { achieve("kart-win"); if (!k.hits) achieve("clean-win"); }
  KR.place = place;
  toast(`🏁 ${kOrd(place)} of ${n} on ${esc(t.name)} · ${fmtTime(k.done)} · best lap ${fmtTime(best)}${pb ? " · your best lap here!" : ""}`, null, 6000);
  side();
}
const kOrd = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
/// Where a kart is seen: its own position for the karts this Mac drives, else the smoothed one.
const kSeen = k => k.sim ? k : { x: k.dx, y: k.dy, z: k.dz, a: k.da };

function kartStep(dt) {
  const now = kNow(), P = KR.phase;
  if (P === "lobby") {
    ginfo.textContent = `${KR.players.length} driver${KR.players.length > 1 ? "s" : ""} on the grid${KR.fill ? ", bots fill the rest" : ""}`;
    if (kOwner() && inRoom() && now - KR.pinged > KT.LOBBY_PING) { KR.pinged = now; gsend(kLobbyMsg("lobby")); }
    return;
  }
  if (P === "count") {
    const r = KR.startAt - now, me = KR.me;
    ginfo.textContent = `starts in ${Math.max(0, Math.ceil(r))} s · hold ↑ as the 2 shows for a rocket start`;
    if (me) { const thr = GAME.keys.has("arrowup") || GAME.keys.has("w"); if (thr && me.revR === undefined) me.revR = r; if (!thr) me.revR = undefined; }
    if (now >= KR.startAt) { KR.phase = "go"; KR.t = 0; for (const k of KR.karts) if (k.sim) kRocket(k); side(); }
    return;
  }
  if (P !== "go" && P !== "done") { ginfo.textContent = ""; return; }
  const t = kTrack(KR.track);
  KR.t += dt;
  const n = Math.ceil(dt / (1 / 60)), h = dt / n;
  for (let i = 0; i < n; i++) kSim(t, h);
  KR.rank = KR.karts.filter(k => !k.gone).sort((a, b) => kDist(b) - kDist(a));
  const me = KR.me;
  if (me && !me.done) { const s = t.S[me.si], back = Math.cos(me.a - kTan(s)) < -0.2 && me.v > 2; KR.wrongT = back ? KR.wrongT + dt : 0; }
  // the top bar a few times a second, the panel when the order (or a lap) changes: no DOM work every frame
  if (now - (KR.infoAt || 0) > 0.25) {
    KR.infoAt = now;
    const text = me && !me.done ? `${me.car.icon} lap ${Math.min(me.lap, KR.laps)}/${KR.laps} · ${kOrd(KR.rank.indexOf(me) + 1)} of ${KR.rank.length} · ${fmtTime(KR.t)}${me.best ? " · best lap " + fmtTime(me.best) : ""}`
      : me ? `finished ${kOrd(KR.place || 1)} · ${fmtTime(me.done)}` : "";
    if (ginfo.textContent !== text) ginfo.textContent = text;
    const order = KR.rank.map(k => k.id + k.lap + (k.done ? "d" : "")).join(",");
    if (order !== KR.sideOrder && now - (KR.sideAt || 0) > 1) { KR.sideOrder = order; KR.sideAt = now; side(); }
  }
  if (KR.multi && now - KR.sent > KT.SEND && me && !KR.karts.every(k => k.done || k.gone)) {   // quiet once everyone is in
    KR.sent = now;
    const msg = { g: "kart", k: "pos", id: KR.id, ...kPack(me) };
    if (kOwner()) msg.b = KR.karts.filter(k => k.bot).map(k => { const p = kPack(k); return [p.x, p.y, p.z, p.a, p.v, p.lap, p.cp, p.si, p.f, p.d, p.h]; });
    gsend(msg);
  }
}
function kFlags(k) {
  return (k.shieldT > 0 ? 1 : 0) | (k.spinT > 0 ? 2 : 0) | (k.boostT > 0 ? 4 : 0) | (k.drift ? 8 : 0) | (k.charge >= KT.SMT ? 16 : k.charge >= KT.MT ? 32 : 0)
    | (k.done ? 64 : 0) | (k.drift < 0 ? 128 : 0) | (k.fallT > 0 ? 256 : 0) | (k.droneT > 0 ? 512 : 0) | (k.rushT > 0 ? 1024 : 0) | (k.otT > 0 ? 2048 : 0)
    | (k.zapT > 0 ? 4096 : 0) | (k.trick ? 8192 : 0) | (k.slip > 0.3 ? 16384 : 0) | (k.stallT > 0 ? 32768 : 0);
}
const KTRAILS = ["", "note", "duck", "plane"];
/// What a kart holds, for the others to draw: the dragged item, and how many go round (and which).
function kHeld(k) { return KTRAILS.indexOf(k.trail) + (k.orbit ? k.orbit.n * 4 + (k.orbit.kind === "plane" ? 16 : 0) : 0); }
function kPack(k) { return { x: kR1(k.x), y: kR1(k.y), z: kR1(k.z), a: kR2(k.a), v: Math.round(k.v), lap: k.lap, cp: k.cp, si: k.si, f: kFlags(k), d: k.done ? +k.done.toFixed(3) : 0, h: kHeld(k) }; }
function kSim(t, h) {
  for (const k of KR.karts) {
    if (k.gone) continue;
    if (!k.sim) {                                     // someone else's: carry on the way it was going until the next word
      if (kNow() - k.heard < 0.4 && !(k.f & 256)) { k.x += Math.cos(k.a) * k.v * h; k.z += Math.sin(k.a) * k.v * h; }
      const q = Math.min(1, h * 12);
      k.dx += (k.x - k.dx) * q; k.dy += (k.y - k.dy) * q; k.dz += (k.z - k.dz) * q; k.da = kWrap(k.da + kWrap(k.a - k.da) * q);
      continue;
    }
    let inp;
    if (k.id === myId() && !k.done) { const keys = kKeys(); inp = k.otT > 0 ? { ...kBotDrive(t, k, h), use: keys.use, held: keys.held, back: keys.back } : keys; }
    else { inp = kBotDrive(t, k, h); if (k.bot) Object.assign(inp, kBotItems(t, k, h)); }
    kDrive(t, k, inp, h);
    if (!k.done || k.bot) { kBoxes(t, k, h); kItemUse(t, k, inp); }
    kSlip(k, h);
    kLap(t, k);
  }
  kBumps();
  for (const hz of t.hz) {
    const p = kHazardAt(t, hz, KR.t);
    for (const k of KR.karts) {
      if (!k.sim || k.gone || k.fallT > 0 || Math.abs(k.y - p.y) > 2.5) continue;
      const dx = k.x - p.x, dz = k.z - p.z, d = Math.hypot(dx, dz);
      if (d >= 2.1) continue;
      kHitKart(k, "ram", "");
      const s = t.S[hz.i], side = (dx * -s.fz + dz * s.fx) >= 0 ? 1 : -1;     // knocked to the side it was on, out of the way
      k.x += -s.fz * side * (2.2 - d); k.z += s.fx * side * (2.2 - d);
    }
  }
  kItemsStep(t, h);
}

// ---------- the side panel ----------
const KSTATS = [["speed", "Speed"], ["acc", "Accel"], ["hand", "Handling"], ["weight", "Weight"], ["drift", "Drift"], ["off", "Off-road"], ["mt", "Turbo"]];
function kStatsHTML(car) {
  return KSTATS.map(([key, label]) => {
    const vals = KCARS.map(c => c[key]), lo = Math.min(...vals), hi = Math.max(...vals), w = 20 + 80 * (car[key] - lo) / (hi - lo || 1);
    return `<div class="row"><span class="n" style="flex:0 0 64px">${label}</span><span style="flex:1;height:6px;background:#2d2630;border-radius:3px"><span style="display:block;height:6px;width:${w.toFixed(0)}%;background:var(--accent);border-radius:3px"></span></span></div>`;
  }).join("");
}
function kartSide() {
  const t = KTRACKS[KR.track], P = KR.phase, car = kCar(KR.car);
  const how = `<h3>HOW</h3><div class="hint">↑/W go · ↓/S brake · ←→/AD steer. <b>Drift:</b> tap Space while turning and keep it held; steer into the bend to charge faster, then let go for a turbo (blue sparks, then orange for a long one). Tight bends need a drift. <b>Rocket start:</b> hold ↑ as the 2 shows (from the 3 and you stall). <b>Slipstream:</b> stay right behind a kart. <b>Tricks:</b> Space as you fly off a ramp. <b>Puddles</b> make you slide; <b>rolling things</b> on the road knock you over. <b>Items:</b> E or X (a new box swaps what you hold for something new); hold it to drag a note or plane behind you as a shield and let go to throw (↓ held: backwards). ☕ boost · 🫖 boosts for 7 s · 📝 note · 🦆 three ducks (go round you; each press fires one where you aim) · ✈ plane (finds the kart ahead) · 🛡 wrap · 🌟 rush (nothing stops you) · 📧 reply-all (hits the leader) · 🔌 power cut (everyone else slows) · 🚀 overtime (autopilot).</div>`;
  const carPick = `<h3>KART</h3><div class="pick">${KCARS.map(c => `<button data-kcar="${c.id}" class="${c.id === KR.car ? "on" : ""}" title="${esc(c.name)} · ${c.cls}">${c.icon}</button>`).join("")}</div>
    <div class="hint" style="margin:5px 0 3px">${car.icon} <b>${esc(car.name)}</b> · ${car.cls}</div>${kStatsHTML(car)}`;
  if (P === "pick" || P === "none") {
    gside.innerHTML = `<h3>TRACK</h3><div class="pick">${KTRACKS.map((x, i) => `<button data-ktrack="${i}" class="${i === KR.track ? "on" : ""}">${i + 1}. ${esc(x.name)}</button>`).join("")}</div>
      ${carPick}
      <h3>SPEED</h3><div class="pick">${KCLASSES.map((c, i) => `<button data-kcls="${i}" class="${i === KR.cls ? "on" : ""}">${c.name}</button>`).join("")}</div>
      <h3>LAPS</h3><div class="pick"><button data-klaps="-1">−</button><button class="on" disabled>${KR.laps}</button><button data-klaps="1">+</button></div>
      <h3>BOTS</h3><div class="pick"><button data-kfill="1" class="${KR.fill ? "on" : ""}">Fill the grid</button><button data-kfill="0" class="${KR.fill ? "" : "on"}">None</button></div>
      ${KR.fill ? `<div class="pick" style="margin-top:4px">${KSKILL.map((s, i) => `<button data-kskill="${i}" class="${i === KR.skill ? "on" : ""}">${s.name}</button>`).join("")}</div>` : ""}
      <h3>&nbsp;</h3><button class="go" data-kopen="1">${inRoom() ? "Open the race to the room" : "Start"}</button>
      ${inRoom() ? `<div class="hint" style="margin-top:6px">Everyone in the room can join; you press Start when they are in${KR.fill ? ", and bots fill the free spots" : ""}.</div>` : ""}
      ${how}${kBestHTML()}<h3>&nbsp;</h3><button data-home="1">Games</button>`;
    return;
  }
  const rank = (KR.rank && KR.rank.length ? KR.rank : KR.karts).filter(k => !k.gone);
  const rows = (P === "lobby" ? KR.players.map(p => ({ id: p.id, name: p.name, bot: false, car: kCar(p.car) })) : rank).map((k, i) => {
    const st = P === "lobby" ? "ready" : k.done ? fmtTime(k.done) : P === "count" ? "ready" : `lap ${Math.min(k.lap, KR.laps)}/${KR.laps}`;
    return `<div class="row"><span class="dot" style="background:${colorOf(k.id)}"></span><span class="n">${P === "lobby" ? "" : kOrd(i + 1) + " "}${k.car.icon} ${esc(k.name)}${k.bot ? " 🤖" : ""}${k.id === myId() ? " (you)" : ""}</span><span class="v">${st}</span></div>`;
  }).join("");
  gside.innerHTML = `<h3>${esc(t.name.toUpperCase())} · ${KR.laps} LAP${KR.laps > 1 ? "S" : ""} · ${KCLASSES[KR.cls].name.toUpperCase()}</h3>${rows}
    ${P === "lobby" ? carPick : ""}
    ${P === "lobby" ? (kOwner() ? `<h3>&nbsp;</h3><button class="go" data-kstart="1">Start the race</button> <button data-kleave="1">Cancel</button>
        <div class="hint" style="margin-top:6px">${KR.players.length > 1 ? "Everyone starts together when you press Start." : "Waiting for others to join…"}${KR.fill ? " Bots fill the free spots." : ""}</div>`
      : `<div class="hint" style="margin-top:8px">Waiting for ${esc(KR.ownerName || "the host")} to start.</div><h3>&nbsp;</h3><button data-kleave="1">Leave</button>`) : ""}
    ${P === "done" ? `<h3>&nbsp;</h3><button class="go" data-kagain="1">Race again</button> <button data-home="1">Games</button>` : ""}
    ${P === "go" || P === "count" ? `<h3>&nbsp;</h3><button data-kleave="1">Leave the race</button>` : ""}
    ${how}${kBestHTML()}`;
}
function kBestHTML() {
  const best = boardsNow().boards["kart-" + (KR.track + 1)];
  return `<h3>BEST LAP HERE</h3>` + (best && best.length ? best.slice(0, 5).map((e, i) => `<div class="row"><span class="n">${i + 1}. ${esc(e.name)}</span><span class="v">${fmtTime(e.value)}</span></div>`).join("") : `<div class="hint">no lap yet</div>`);
}
function kartClick(b) {
  if (b.dataset.ktrack) { KR.track = +b.dataset.ktrack; KR.fly = 0; side(); }
  if (b.dataset.kcar) {
    KR.car = kCar(b.dataset.kcar).id; keep("kartCar", KR.car);
    if (KR.phase === "lobby") {
      const me = KR.players.find(p => p.id === myId()); if (me) me.car = KR.car;
      if (kOwner()) gsend(kLobbyMsg("lobby")); else gsend({ g: "kart", k: "car", id: KR.id, car: KR.car });
      kSetup(KR.players, []);
    }
    side();
  }
  if (b.dataset.kcls) { KR.cls = +b.dataset.kcls; side(); }
  if (b.dataset.klaps) { KR.laps = Math.max(1, Math.min(KT.LAPS_MAX, KR.laps + +b.dataset.klaps)); side(); }
  if (b.dataset.kfill) { KR.fill = b.dataset.kfill === "1"; side(); }
  if (b.dataset.kskill) { KR.skill = +b.dataset.kskill; side(); }
  if (b.dataset.kopen) kOpen();
  if (b.dataset.kstart) kStartNow();
  if (b.dataset.kleave || b.dataset.kagain) { kLeave(); side(); }
}

// ---------- drawing ----------
/// Puts every kart, item and box where it is now, with what it is doing.
function kPlace(sc, t, ts, dt) {
  const now = kNow();
  for (const k of KR.karts) {
    let m = KR.meshes.get(k.id);
    if (!m) { m = kKartMesh(k); KR.meshes.set(k.id, m); }
    if (m.parent !== sc) sc.add(m);
    const p = kSeen(k), f = k.sim ? kFlags(k) : k.f, U = m.userData, s = t.S[k.si] || t.S[0];
    m.visible = !k.gone && !(f & 256 && p.y < s.y - 30);
    m.position.set(p.x, p.y, p.z);
    k.spinV = f & 2 ? (k.spinV || 0) + dt * 13 : 0;
    if (!k.sim) k.trickV = f & 8192 ? (k.trickV || 0) + dt * 10 : 0;
    const drift = f & 8 ? (f & 128 ? -1 : 1) : 0, ot = !!(f & 2048);
    m.rotation.y = -(p.a + drift * 0.42 + k.spinV);
    U.body.rotation.z = k.air ? Math.max(-0.3, Math.min(0.3, k.vy * 0.03)) : Math.atan(s.slope || 0) * Math.cos(p.a - kTan(s));
    U.body.rotation.x = f & 8192 ? -(k.trickV % (Math.PI * 2)) : drift * 0.1;
    U.body.visible = !ot; U.rocket.visible = ot; U.rflame.visible = ot && Math.floor(ts * 20) % 2 === 0;
    U.shield.visible = !!(f & 1);
    U.aura.visible = !!(f & 1024); if (f & 1024) U.aura.material.color.setHSL((ts * 2) % 1, 0.9, 0.6);
    U.cloud.visible = !!(f & 4096);
    U.smoke.forEach((sm, i) => { sm.visible = !!(f & 32768); sm.position.y = 0.6 + ((ts * 2 + i * 0.33) % 1) * 1.6; });
    U.flame.visible = !!(f & 4) && !ot && Math.floor(ts * 20) % 2 === 0;
    const spark = f & 16 ? 2 : f & 32 ? 1 : drift ? 0 : -1;
    U.sparks.forEach(sp => { sp.visible = spark >= 0 && Math.floor(ts * 24 + sp.position.z) % 2 === 0; if (spark >= 0) sp.material = U.sparkMats[spark]; });
    U.drone.visible = !!(f & 512);
    if (U.drone.visible) U.drone.position.set(0, 2.6 + (1.2 - Math.max(0, k.sim ? k.droneT : 0.6)) * 4, 0);
    U.shadow.visible = !k.air;
    // the dragged item and the ones going round
    const hc = k.sim ? kHeld(k) : k.h || 0, trail = KTRAILS[hc & 3] || "", on = (hc >> 2) & 3, okind = hc & 16 ? "plane" : "duck";
    if (U.trailKind !== trail) { U.trail.clear(); if (trail) U.trail.add(kItemMesh(trail)); U.trailKind = trail; }
    const okey = on ? okind + on : "";
    if (U.orbitKey !== okey) {
      U.orbit.clear();
      for (let i = 0; i < on; i++) { const im = kItemMesh(okind); im.scale.setScalar(0.5); im.position.set(Math.cos(i * 2.094) * 2.2, 0.4, Math.sin(i * 2.094) * 2.2); U.orbit.add(im); }
      U.orbitKey = okey;
    }
    U.orbit.rotation.y = ts * 4;
  }
  const live = new Set();
  for (const it of KR.items) {
    live.add(it.iid);
    let m = KR.imeshes.get(it.iid);
    if (!m) { m = kItemMesh(it.kind); KR.imeshes.set(it.iid, m); sc.add(m); }
    m.position.set(it.x, it.y + (it.kind === "plane" ? 0.6 : 0), it.z); m.rotation.y = -it.a + (it.kind === "duck" ? Math.sin(ts * 20) * 0.2 : 0);
    if (it.kind === "mail") m.rotation.x = Math.sin(ts * 12) * 0.3;
  }
  for (const [iid, m] of KR.imeshes) if (!live.has(iid)) { if (m.parent) m.parent.remove(m); KR.imeshes.delete(iid); }
  // reply-all blasts: a quick growing sphere
  KR.boomMeshes = KR.boomMeshes || [];
  KR.booms.forEach((b, i) => {
    let m = KR.boomMeshes[i];
    if (!m) { m = kAdd(sc, new THREE.SphereGeometry(1, 10, 8), kBasic("#ffb347", { transparent: true, opacity: 0.6, depthWrite: false }).clone()); KR.boomMeshes[i] = m; }
    if (m.parent !== sc) sc.add(m);
    const age = KR.t - b.at; m.visible = true; m.position.set(b.x, b.y + 1, b.z); m.scale.setScalar(1 + age * 12); m.material.opacity = Math.max(0, 0.6 - age);
  });
  for (let i = KR.booms.length; i < KR.boomMeshes.length; i++) KR.boomMeshes[i].visible = false;
  (sc.userData.boxes || []).forEach((b, n) => { b.visible = !((KR.boxGone[n] || 0) > KR.t); b.rotation.set(ts * 0.8, ts * 1.3 + n, 0); b.position.y = t.boxes[n].y + Math.sin(ts * 3 + n) * 0.2; });
  // the start lights: one more red each second, then all green
  const r = KR.phase === "count" ? KR.startAt - now : 99, green = KR.phase === "go" && KR.t < 1.5;
  (sc.userData.lights || []).forEach((l, i) => l.material.color.set(green ? "#5fe07f" : r <= 3 - i ? "#ff4040" : "#3a1414"));
  // the kart you are choosing, turning on the start line
  if (KR.phase === "pick" || KR.phase === "none") {
    if (!KR.preview || KR.preview.userData.car !== KR.car || KR.preview.parent !== sc) {
      if (KR.preview && KR.preview.parent) KR.preview.parent.remove(KR.preview);
      KR.preview = kKartMesh({ id: myId(), name: myName(), car: kCar(KR.car), color: myColor(), bot: false });
      KR.preview.userData.car = KR.car;
      [KR.preview.userData.shield, KR.preview.userData.aura, KR.preview.userData.rocket, KR.preview.userData.cloud, KR.preview.userData.drone, KR.preview.userData.flame].forEach(o => { o.visible = false; });
      KR.preview.userData.smoke.forEach(o => { o.visible = false; }); KR.preview.userData.sparks.forEach(o => { o.visible = false; });
      sc.add(KR.preview);
    }
    const s0 = t.S[6]; KR.preview.position.set(s0.x, s0.y, s0.z); KR.preview.rotation.y = ts * 0.7; KR.preview.visible = true;
  } else if (KR.preview) KR.preview.visible = false;
  const ht = KR.phase === "go" || KR.phase === "done" ? KR.t : ts;
  for (const z of sc.userData.hz || []) {
    const p = kHazardAt(t, z.h, ht); z.g.position.set(p.x, p.y, p.z);
    if (z.h.kind === "vacuum") z.spin.rotation.y = ts * 2; else z.spin.rotation.x = -p.lat / (z.h.kind === "barrel" ? 0.95 : 1.85);
  }
  for (const a of sc.userData.anim) a(ts);
}
const KCAM_H = { forklift: 1.3, copier: 0.6, coffee: 0.7, chair: 0.5, trolley: 0.3 };   // how much higher the camera rides
function kCamera(t, ts, dt) {
  const cam = KR.cam, me = KR.me, P = KR.phase, q = 1 - Math.exp(-dt * 8);
  const want = KR.cw || (KR.cw = new THREE.Vector3()), look = KR.cl || (KR.cl = new THREE.Vector3());
  let fov = 66;
  if (!me || P === "pick" || P === "none") {           // no race: around the kart you are choosing
    const s0 = t.S[6], a = ts * 0.25;
    want.set(s0.x + Math.cos(a) * 4.6, s0.y + 2.1, s0.z + Math.sin(a) * 4.6); look.set(s0.x, s0.y + 1.0, s0.z);
  } else if (P === "done") {
    const p = kSeen(me), a = ts * 0.35;
    want.set(p.x + Math.cos(a) * 8, p.y + 3.5, p.z + Math.sin(a) * 8); look.set(p.x, p.y + 1, p.z);
  } else {
    // behind and above, higher for the tall karts so they never fill the view
    const a = me.a, tall = KCAM_H[me.car.id] || 0, back = 5.8 + tall * 0.8, lean = me.drift * 0.9, rx = -Math.sin(a), rz = Math.cos(a);
    want.set(me.x - Math.cos(a) * back - rx * lean, Math.max(me.y, t.S[me.si].y) + 2.4 + tall, me.z - Math.sin(a) * back - rz * lean);
    look.set(me.x + Math.cos(a) * 4 + rx * lean * 0.5, me.y + 1 + tall * 0.5, me.z + Math.sin(a) * 4 + rz * lean * 0.5);
    if (me.fallT > 0) want.copy(KR.camPos);
    fov = 64 + Math.min(1, Math.max(0, me.v) / KCLASSES[KR.cls].top) * 8 + (me.boostT > 0 || me.otT > 0 ? 9 : 0);
  }
  if (KR.camSnap || KR.camPos.lengthSq() === 0) { KR.camPos.copy(want); KR.camLook.copy(look); KR.camSnap = false; }
  else { KR.camPos.lerp(want, q); KR.camLook.lerp(look, q); }
  cam.position.copy(KR.camPos);
  if (me && (me.spinT > 0 || me.stallT > 0) && P === "go") cam.position.y += Math.sin(ts * 40) * 0.08;
  cam.lookAt(KR.camLook);
  if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * q; cam.updateProjectionMatrix(); }
}
/// Lines the 3D canvas up under the part of the games' canvas where the game is drawn.
function kShowGL(on) {
  const c = KR.glc; if (!c) return;
  if (!on) { if (c.style.display !== "none") c.style.display = "none"; return; }
  const dpr = GAME.dpr || 1, key = [gcv.offsetLeft, gcv.offsetTop, GAME.ox, GAME.oy, GAME.k, dpr].join(",");
  if (c.style.display !== "block") c.style.display = "block";
  if (KR.glKey === key) return;
  KR.glKey = key;
  Object.assign(c.style, { left: gcv.offsetLeft + GAME.ox / dpr + "px", top: gcv.offsetTop + GAME.oy / dpr + "px", width: GW * GAME.k / dpr + "px", height: GH * GAME.k / dpr + "px" });
}
function kartDraw(ts) {
  if (KR.state !== "ready") {
    kShowGL(false);
    gpx(0, 0, GW, GH, "#1b1820");
    gtext(KR.state === "failed" ? KR.err || "3D is not available" : KR.state === "lost" ? "the 3D view was lost: waiting for it…" : "loading the karts…", GW / 2, GH / 2 - 4, "#a79d93", 8, "center");
    return;
  }
  const t = kTrack(KR.track), sc = kScene(KR.track), dt = Math.max(0, Math.min(0.1, KR.lastDraw ? ts - KR.lastDraw : 0));
  KR.lastDraw = ts;
  if (KR.sceneOf !== KR.track) { KR.sceneOf = KR.track; KR.camSnap = true; }
  kPlace(sc, t, ts, dt);
  kCamera(t, ts, dt);
  KR.renderer.render(sc, KR.cam);
  if (KR.copy) gx.drawImage(KR.glc, 0, 0, GW, GH);            // tests read the picture back from the games' canvas
  else { kShowGL(true); gx.clearRect(0, 0, GW, GH); }
  kHUD(t, ts);
}
function kMini(t) {
  if (t.mini) return t.mini;
  const W = 58, H = 46, sx = W / (t.bb.x1 - t.bb.x0), sz = H / (t.bb.z1 - t.bb.z0), k = Math.min(sx, sz);
  const ox = GW - 6 - W + (W - (t.bb.x1 - t.bb.x0) * k) / 2, oy = 6 + (H - (t.bb.z1 - t.bb.z0) * k) / 2;
  t.mini = { k, at: (x, z) => [ox + (x - t.bb.x0) * k, oy + (z - t.bb.z0) * k] };
  return t.mini;
}
function kHUD(t, ts) {
  const P = KR.phase, me = KR.me, now = kNow();
  // the other people's names over their karts (crisp 2D text where the kart is on screen)
  const v = KR.v3 || (KR.v3 = new THREE.Vector3());
  for (const k of KR.karts) {
    if (k === me || k.gone || k.bot && P !== "lobby") continue;
    const p = kSeen(k); v.set(p.x, p.y + 2.6, p.z);
    if (v.distanceTo(KR.cam.position) > 70) continue;
    v.project(KR.cam);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
    const x = (v.x + 1) / 2 * GW, y = (1 - v.y) / 2 * GH, name = k.name.slice(0, 10);
    gpx(x - name.length * 2 - 2, y - 7, name.length * 4 + 4, 8, "#0d0b10aa"); gtext(name, x, y - 6.5, k.bot ? "#a79d93" : "#ffe7a8", 6, "center");
  }
  // speed: lines at the edges while boosting or in someone's slipstream
  if (me && (P === "go") && (me.boostT > 0 || me.otT > 0 || me.slip > 0.3)) {
    const col = me.slip > 0.3 && me.boostT <= 0 ? "#cfe8ff88" : "#ffffffaa";
    for (let i = 0; i < 10; i++) { const r = hash("sl" + i + Math.floor(ts * 12)), y = 20 + (r % 160), left = i % 2, len = 14 + (r >> 8) % 20; gpx(left ? 0 : GW - len, y, len, 1, col); }
  }
  // a power cut: the lights flicker
  if (KR.t - KR.zapAt < 0.6 && Math.floor(ts * 20) % 2) gpx(0, 0, GW, GH, "#0d0b10aa");
  // the minimap
  const mm = kMini(t);
  gpx(GW - 68, 2, 66, 54, "#0d0b1088");
  gx.strokeStyle = "#f1ebe2aa"; gx.lineWidth = 2; gx.beginPath();
  t.S.forEach((s, i) => { if (i % 3) return; const [x, y] = mm.at(s.x, s.z); i ? gx.lineTo(x, y) : gx.moveTo(x, y); }); gx.closePath(); gx.stroke();
  for (const it of KR.items) if (it.kind === "mail") { const [x, y] = mm.at(it.x, it.z); gpx(x - 2, y - 2, 4, 4, "#e06c6c"); }
  for (const k of KR.karts) { if (k.gone) continue; const p = kSeen(k), [x, y] = mm.at(p.x, p.z); gpx(x - 1.5, y - 1.5, 3, 3, k === me ? "#ffffff" : k.color); }
  if (P === "pick" || P === "none") {
    const car = kCar(KR.car);
    gpx(GW / 2 - 80, 8, 160, 26, "#0d0b10cc");
    gtext(`${t.name} · ${KR.laps} lap${KR.laps > 1 ? "s" : ""} · ${KCLASSES[KR.cls].name}`, GW / 2, 11, "#ffe7a8", 8, "center");
    gtext(`${car.icon} ${car.name} · ${KR.fill ? `${KT.MAX - 1} ${KSKILL[KR.skill].name.toLowerCase()} bots` : "no bots"}`, GW / 2, 22, "#a79d93", 7, "center");
    return;
  }
  if (!me) return;
  // your item
  gpx(4, 4, 28, 28, "#0d0b10cc"); gx.strokeStyle = "#ffe7a8"; gx.lineWidth = 1; gx.strokeRect(4.5, 4.5, 27, 27);
  const kinds = Object.keys(KITEMS), held = me.orbit ? me.orbit.kind : me.trail || me.item;
  const ic = me.roll > 0 ? KITEMS[kinds[Math.floor(ts * 12) % kinds.length]].icon : me.potT > 0 ? KITEMS.pot.icon : held ? KITEMS[held].icon : "";
  if (ic) gtext(ic, 18, 9, "#f1ebe2", 16, "center");
  if (me.orbit && me.orbit.n > 0) gtext("×" + me.orbit.n, 30, 24, "#ffe7a8", 7, "right");
  else if (me.itemN > 1 && me.roll <= 0) gtext("×" + me.itemN, 30, 24, "#ffe7a8", 7, "right");
  if (me.trail) gtext("held", 18, 33, "#a79d93", 6, "center");
  const timer = me.potT > 0 ? me.potT / 7.5 : me.rushT > 0 ? me.rushT / 7 : me.otT > 0 ? me.otT / 4.5 : me.shieldT > 0 ? me.shieldT / 8 : 0;
  if (timer > 0) { gpx(4, 34, 28, 3, "#0d0b10aa"); gpx(4, 34, 28 * timer, 3, "#ffe7a8"); }
  // lap, time, place
  gpx(35, 4, 50, 22, "#0d0b1088");
  gtext(`LAP ${Math.min(me.lap, KR.laps)}/${KR.laps}`, 38, 6, "#f1ebe2", 8);
  gtext(fmtTime(P === "go" ? KR.t : me.done || 0), 38, 16, "#a79d93", 7);
  const place = KR.rank ? KR.rank.indexOf(me) + 1 : KR.karts.indexOf(me) + 1;
  if (P === "go" || P === "done") {
    gpx(GW - 64, GH - 29, 61, 26, "#0d0b1088");
    gtext(kOrd(me.done ? KR.place || place : place), GW - 30, GH - 26, me.done || place > 3 ? "#f1ebe2" : "#ffe7a8", 18, "right");
    gtext(`/${KR.rank.length}`, GW - 6, GH - 16, "#a79d93", 8, "right");
  }
  // the drift's charge: grey, then blue past a turbo, orange past a long one
  if (me.drift) {
    const c = Math.min(1, me.charge / KT.SMT);
    gpx(GW / 2 - 24, GH - 10, 48, 4, "#0d0b10aa"); gpx(GW / 2 - 24 + 48 * KT.MT / KT.SMT, GH - 11, 1, 6, "#f1ebe2");
    gpx(GW / 2 - 24, GH - 10, 48 * c, 4, me.charge >= KT.SMT ? "#ffb347" : me.charge >= KT.MT ? "#7fd0ff" : "#a79d93");
  }
  // the big words in the middle
  if (P === "lobby") { gpx(GW / 2 - 80, GH / 2 - 14, 160, 28, "#0d0b10cc"); gtext(kOwner() ? "press Start when everyone is in" : "waiting for the start", GW / 2, GH / 2 - 4, "#a79d93", 8, "center"); }
  if (P === "count") {
    const left = Math.max(1, Math.ceil(KR.startAt - now));
    if (left > 3) gpx(GW / 2 - 34, GH / 2 - 38, 68, 24, "#0d0b10aa");
    gtext(left > 3 ? "READY" : String(left), GW / 2, GH / 2 - 34, left === 2 ? "#8fd6b4" : "#ffe7a8", left > 3 ? 18 : 26, "center");
    gpx(GW / 2 - 48, GH - 24, 96, 11, "#0d0b10aa"); gtext("hold ↑ as the 2 shows", GW / 2, GH - 22, "#f1ebe2", 7, "center");
  }
  if (P === "go" && KR.t < 1) gtext("GO!", GW / 2, GH / 2 - 34, "#8fd6b4", 26, "center");
  if (P === "go" && KR.wrongT > 1 && Math.floor(ts * 3) % 2) gtext("WRONG WAY", GW / 2, GH / 2 - 26, "#e06c6c", 14, "center");
  if (KR.flash && now < KR.flash.until) gtext(KR.flash.text, GW / 2, 42, "#ffe7a8", 11, "center");
  if (P === "done") {
    const rows = KR.rank.slice(0, 8);
    gpx(GW / 2 - 84, 34, 168, 20 + rows.length * 11, "#0d0b10dd");
    gtext("RESULTS", GW / 2, 38, "#8fd6b4", 9, "center");
    rows.forEach((k, i) => {
      const y = 52 + i * 11, col = k === me ? "#ffe7a8" : "#f1ebe2";
      gtext(`${i + 1}. ${k.car.icon} ${k.name.slice(0, 10)}${k.bot ? " ·bot" : ""}`, GW / 2 - 78, y, col, 8);
      gtext(k.done ? fmtTime(k.done) : `lap ${Math.min(k.lap, KR.laps)}`, GW / 2 + 78, y, k.done ? col : "#a79d93", 8, "right");
    });
  }
}

// ---------- from the room ----------
function kartMsg(from, name, d) {
  const now = kNow(), num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : 0));
  const owner = (KR.lobbies[d.id] && KR.lobbies[d.id].owner) || (KR.id === d.id ? KR.owner : "");
  const player = p => ({ id: String(p.id), name: String(p.name || "").slice(0, 40), car: kCar(String(p.car || "")).id });
  if (["open", "lobby", "start", "close"].includes(d.k) && owner && owner !== from) return;
  if ((d.k === "open" || d.k === "lobby") && KTRACKS[d.track] && Array.isArray(d.players)) {
    const fresh = !KR.lobbies[d.id];
    KR.lobbies[d.id] = { id: d.id, track: d.track, laps: num(d.laps, 1, KT.LAPS_MAX) || 3, cls: num(d.cls, 0, KCLASSES.length - 1) | 0, fill: d.fill !== false,
      skill: num(d.skill, 0, 2) | 0, owner: from, ownerName: name, players: d.players.slice(0, KT.MAX).map(player), at: now };
    if (KR.id === d.id && KR.phase === "lobby") {
      const l = KR.lobbies[d.id];
      Object.assign(KR, { players: l.players, fill: l.fill, skill: l.skill, cls: l.cls, laps: l.laps });
      if (!KR.players.some(p => p.id === myId())) { KR.phase = "pick"; KR.id = ""; } else kSetup(KR.players, []);
      side();
    } else if (fresh && d.k === "open") {
      if (GAME.open) toast(`🏁 ${esc(name)} opened a kart race on ${esc(KTRACKS[d.track].name)} · click to join`, () => kJoin(d.id), 10000);
      else note(`🏁 ${name} opened a kart race on ${KTRACKS[d.track].name}: Games tab → Join`);
      if (GAME.open && GAME.view === "home") side();
    }
    peopleKey = "";
    return;
  }
  if (d.k === "close" || d.k === "start") { delete KR.lobbies[d.id]; peopleKey = ""; }
  if (d.k === "close" && KR.id === d.id && KR.phase === "lobby") { KR.phase = "pick"; KR.id = ""; toast(`${esc(name)} closed the race`, null, 3000); side(); }
  if (KR.id !== d.id) return;
  if (kOwner() && KR.phase === "lobby") {
    if (d.k === "join" && !KR.players.some(p => p.id === from) && KR.players.length < KT.MAX) { KR.players.push(player({ id: from, name, car: d.car })); gsend(kLobbyMsg("lobby")); kSetup(KR.players, []); side(); }
    if (d.k === "car") { const p = KR.players.find(x => x.id === from); if (p) { p.car = kCar(String(d.car || "")).id; gsend(kLobbyMsg("lobby")); kSetup(KR.players, []); side(); } }
    if (d.k === "leave") { KR.players = KR.players.filter(p => p.id !== from); gsend(kLobbyMsg("lobby")); kSetup(KR.players, []); side(); }
  }
  if (d.k === "start" && KR.phase === "lobby") {
    const players = (Array.isArray(d.players) ? d.players : []).slice(0, KT.MAX).map(player);
    if (!players.some(p => p.id === myId())) { KR.phase = "pick"; KR.id = ""; return side(); }
    const bots = (Array.isArray(d.bots) ? d.bots : []).slice(0, KT.MAX - players.length).map((b, i) => ({ id: `bot:${i}`, name: String(b.name || "Bot").slice(0, 20), skill: num(b.skill, 0, 2) | 0, car: kCar(String(b.car || "")).id, bot: true }));
    KR.laps = num(d.laps, 1, KT.LAPS_MAX) || KR.laps; KR.cls = num(d.cls, 0, KCLASSES.length - 1) | 0;
    kBegin(players, bots, num(d.in, 1, 10) || KT.START_IN);
    return;
  }
  const k = KR.karts.find(x => x.id === from && !x.bot);
  if (d.k === "item" && ["duck", "plane", "note", "mail"].includes(d.kind) && KR.karts.some(x => x.id === d.by)) {
    const N = kTrack(KR.track).N, si = num(d.si, 0, N - 1) | 0;
    kAddItem({ iid: String(d.iid).slice(0, 80), kind: d.kind, by: String(d.by), x: num(d.x, -1e4, 1e4), y: num(d.y, -100, 100), z: num(d.z, -1e4, 1e4), a: num(d.a, -7, 7),
      sp: num(d.sp, 0, 80), t: 0, b: 3, si, pos: si, tg: String(d.tg || "") }, d.kind === "mail");
    return;
  }
  if (d.k === "hit") {
    const it = KR.items.find(x => x.iid === d.iid);
    if (it) { it.dead = true; if (it.by === myId() && d.who !== myId()) kGotOne(); KR.items = KR.items.filter(x => !x.dead); }
    return;
  }
  if (d.k === "boom") { const it = KR.items.find(x => x.iid === d.iid); if (it && !it.dead) kBoom(it, num(d.x, -1e4, 1e4), num(d.y, -100, 100), num(d.z, -1e4, 1e4)); KR.items = KR.items.filter(x => !x.dead); return; }
  if (d.k === "zap") { if (KR.karts.some(x => x.id === d.by)) kZap(String(d.by)); return; }
  if (d.k === "box") { if (Number.isInteger(d.n)) KR.boxGone[d.n] = KR.t + 2; return; }
  if (!k) return;
  if (d.k === "pos") {
    const set = (o, x, y, z, a, v, lap, cp, si, f, done, h) => {
      const N = kTrack(KR.track).N;
      Object.assign(o, { x: num(x, -1e4, 1e4), y: num(y, -100, 100), z: num(z, -1e4, 1e4), a: num(a, -7, 7), v: num(v, -20, 60), lap: num(lap, 1, 99) | 0, cp: num(cp, 0, 3) | 0,
        si: num(si, 0, N - 1) | 0, f: num(f, 0, 65535) | 0, h: num(h, 0, 255) | 0, heard: now });
      if (done && !o.done) { o.done = num(done, 0, 3600); side(); }
    };
    set(k, d.x, d.y, d.z, d.a, d.v, d.lap, d.cp, d.si, d.f, 0, d.h);
    if (from === KR.owner && Array.isArray(d.b)) {
      KR.karts.filter(x => x.bot).forEach((b, i) => { const r = d.b[i]; if (Array.isArray(r) && !b.sim) set(b, ...r); });
    }
  }
  if (d.k === "done") { k.done = num(d.time, 0, 3600); toast(`🏁 ${esc(name)} finished: ${fmtTime(k.done)}`, null, 3000); side(); }
  if (d.k === "quit") {
    k.gone = true;
    if (from === KR.owner) for (const b of KR.karts) if (b.bot && !b.sim) b.gone = true;   // the bots went with their driver
    side();
  }
}
function kOpenLobbies() {
  const now = kNow();
  for (const [id, l] of Object.entries(KR.lobbies)) if (now - l.at > KT.LOBBY_GONE) delete KR.lobbies[id];
  return Object.values(KR.lobbies).filter(l => l.id !== KR.id);
}

registerGame("kart", {
  title: "🏁 Desk Karts",
  start: kartStart, step: kartStep, draw: kartDraw, side: kartSide, click: kartClick, msg: kartMsg,
  leave: kLeave,
  // Space / Shift: a hop (a drift when held while steering), or a trick off a ramp; E / X: the item
  key: (k, down) => {
    if (k === " " || k === "shift") { if (down && !KR.spaceDown) KR.hopReq = true; KR.spaceDown = down; }
    if (k === "e" || k === "x") { if (down && !KR.itemHeld) KR.itemPress = true; KR.itemHeld = down; }
  },
  cancel: () => { KR.spaceDown = false; KR.itemHeld = false; },
  homeHTML: () => { const l = kOpenLobbies(); return l.length ? `<h3>OPEN KART RACES</h3>` + l.map(x => `<div class="row"><span class="n">${esc(x.ownerName)} · ${esc(KTRACKS[x.track].name)} · ${x.laps}L · ${x.players.length}</span><button class="go" data-joinkart="${esc(x.id)}">Join</button></div>`).join("") : ""; },
  tab: () => { const l = kOpenLobbies(); return l.length ? `<div class="gh">OPEN KART RACES</div>` + l.map(x => `<div class="g"><span class="gn">🏁 ${esc(x.ownerName)} · ${esc(KTRACKS[x.track].name)} · ${x.laps} laps · ${x.players.length} in</span><button data-gkjoin="${esc(x.id)}">Join</button></div>`).join("") : ""; },
  tabClick: b => { if (b.dataset.gkjoin) { kJoin(b.dataset.gkjoin); return true; } return false; },
  tabKey: () => kOpenLobbies().map(l => l.id + l.players.length).join(","),
  iconCenter: [160, 100],
  drawIcon: t => {
    // a road running into the distance and a kart on it, drawn in 2D
    gx.fillStyle = "#3f7d3a"; gx.fillRect(130, 78, 60, 34);
    gx.fillStyle = "#55535a"; gx.beginPath(); gx.moveTo(156, 78); gx.lineTo(164, 78); gx.lineTo(186, 112); gx.lineTo(134, 112); gx.closePath(); gx.fill();
    for (let i = 0; i < 4; i++) { const y = 80 + ((i * 9 + t * 30) % 32), w = 1 + (y - 78) * 0.06; gpx(160 - w / 2, y, w, 2 + (y - 78) * 0.08, "#f1ebe2"); }
    const bob = Math.sin(t * 8) > 0 ? 1 : 0, kx = 160 + Math.sin(t * 1.5) * 8;
    gpx(kx - 8, 100 + bob, 16, 5, "#e06c6c"); gpx(kx - 9, 104 + bob, 4, 3, "#1b1820"); gpx(kx + 5, 104 + bob, 4, 3, "#1b1820");
    gpx(kx - 3, 95 + bob, 6, 6, "#f0c8a0"); gpx(kx - 3, 94 + bob, 6, 2, "#f1ebe2");
    gtext("karts", 160, 116, "#a79d93", 8, "center");
  },
});
// the home's Join buttons for open kart races
gside.addEventListener("click", ev => { const b = ev.target.closest("button[data-joinkart]"); if (b) kJoin(b.dataset.joinkart); });
