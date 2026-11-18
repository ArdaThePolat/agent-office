// 🎣 Fishing (games.js is the shell): one pond for everyone in the room.
//
// Hold Space (or the mouse) to charge a cast and let go to throw. When a fish swims by your bobber
// it may bite: the bobber dives and "!" shows; press Space within a second to hook it. Then reel:
// holding pulls the fish in and raises the line's tension; the fish surges and rests. Letting go
// always lowers the tension, but the fish swims off a little; in the red the line snaps, and with
// no tension for two seconds the fish gets away.
//
// The pond is shared: its fish come from a seed and a start time, so every Mac sees the same fish
// in the same places. Whoever opened the pond keeps it: it decides who hooks a fish when two try
// (the first word it gets), and while someone reels a fish it is theirs; caught, it is gone for
// everyone. You see the others on the dock with their lines. If two people open a pond at once,
// both move to the one with the smaller id; when its keeper leaves, the next person takes it over
// with the same fish. A 2-minute round adds everyone's catch up live. The daily challenge is
// today's species: the biggest one caught today has its own board.
//
// Room messages, {g: "fish", k, id, …}: pond {seed, el, owner, claims} (the keeper, every 8 s),
// me {x, st} (your bobber), hook {n} / land {n} / free {n} (to the keeper), claim {n, by, st, kg,
// name} (from it), bye, cup {in, len}.
"use strict";

const FISH = [
  // name, colour, kg range, how often (weight), fight (how hard it pulls)
  ["Bluegill", "#6fa8dc", 0.1, 0.6, 30, 0.6], ["Perch", "#c9b458", 0.2, 1.2, 24, 0.8], ["Trout", "#b98be0", 0.5, 4, 16, 1.1],
  ["Bass", "#5fbf7f", 0.8, 5, 14, 1.2], ["Carp", "#c27460", 2, 15, 8, 1.4], ["Pike", "#7f9a7a", 2, 12, 5, 1.7],
  ["Catfish", "#8a7f74", 3, 25, 3, 1.9], ["Golden Koi", "#f0c040", 1, 6, 1, 1.5],
];
const WATER = 90, POND_X0 = 85, POND_X1 = 312, FISH_EVERY = 3.2, FISH_LIFE = 34, POND_BEAT = 8, POND_GONE = 25;
const FISHING = { phase: "idle", power: 0, dist: 0, wait: 0, bite: 0, cand: -1, fish: null, reel: 0, tension: 0, slack: 0, caught: [], feed: [], cup: null, daily: false };
const POND = { id: "", owner: "", ownerName: "", seed: 0, epoch: 0, claims: {}, people: {}, beat: 0, sent: 0, meSent: "" };
const pondOwner = () => POND.owner === myId();
const pondT = () => Date.now() / 1000 - POND.epoch;

/// Fish n of the pond: the same on every Mac for the same seed. Today's species comes twice as often.
function fishAt(n) {
  const r = seeded((POND.seed ^ Math.imul(n + 1, 2654435761)) >>> 0), d = daily();
  const w = f => f[4] * (FISH.indexOf(f) === d.fish ? 2 : 1), total = FISH.reduce((s, f) => s + w(f), 0);
  let x = r() * total, kind = 0; for (let i = 0; i < FISH.length; i++) { x -= w(FISH[i]); if (x <= 0) { kind = i; break; } }
  const f = FISH[kind];
  return { n, kind, name: f[0], color: f[1], fight: f[5], kg: +(f[2] + Math.pow(r(), 2.2) * (f[3] - f[2])).toFixed(2),
    spawn: 1 + n * FISH_EVERY, life: FISH_LIFE - 6 + r() * 12, y: WATER + 12 + r() * 80, x0: POND_X0 + r() * (POND_X1 - POND_X0), dir: r() < 0.5 ? 1 : -1, speed: 6 + r() * 12 };
}
/// Where fish f is at pond time t, and which way it faces (it swims back and forth across the pond).
function fishPos(f, t) {
  const L = POND_X1 - POND_X0, u = f.x0 - POND_X0 + f.dir * f.speed * (t - f.spawn), m = ((u % (2 * L)) + 2 * L) % (2 * L);
  return { x: POND_X0 + (m < L ? m : 2 * L - m), face: (m < L ? 1 : -1) * f.dir };
}
function pondFish(t) {
  const out = [], lo = Math.max(0, Math.floor((t - 1 - FISH_LIFE - 6) / FISH_EVERY)), hi = Math.floor((t - 1) / FISH_EVERY);
  for (let n = lo; n <= hi; n++) { const f = fishAt(n); if (t >= f.spawn && t < f.spawn + f.life) out.push(f); }
  return out;
}

function newPond() {
  Object.assign(POND, { id: myId() + "-" + Date.now(), owner: myId(), ownerName: myName(), seed: newSeed(), epoch: Date.now() / 1000, claims: {}, beat: Date.now() / 1000, sent: 0 });
  announcePond();
}
function announcePond() {
  if (!inRoom() || !pondOwner()) return;
  POND.sent = Date.now() / 1000;
  const t = pondT(), claims = {};
  for (const [n, c] of Object.entries(POND.claims)) { const f = fishAt(+n); if (t < f.spawn + f.life + 5) claims[n] = [c.by, c.st]; }
  gsend({ g: "fish", k: "pond", id: POND.id, seed: POND.seed, el: Math.round(t * 100) / 100, owner: POND.owner, ownerName: POND.ownerName, claims });
}
function fishStart(arg) {
  Object.assign(FISHING, { phase: "idle", power: 0, fish: null, tension: 0, daily: arg === "daily" });
  if (!POND.id || Date.now() / 1000 - POND.beat > POND_GONE || !inRoom()) newPond();
  gshow("fish");
  sayMe(true);
}
function sayMe(force) {
  const F = FISHING, st = F.phase === "reel" ? "reel" : ["wait", "bite", "hooking"].includes(F.phase) ? "wait" : "idle";
  const x = Math.round(F.phase === "reel" ? F.reel : F.dist), key = st + (st === "idle" ? "" : x);
  const now = Date.now() / 1000;
  if (!force && (key === POND.meSent || now - (POND.meAt || 0) < 0.25)) return;      // at most 4 a second
  POND.meSent = key; POND.meAt = now;
  gsend({ g: "fish", k: "me", id: POND.id, x, st, n: F.fish ? F.fish.n : -1 });
}

function fishSide() {
  const F = FISHING, mine = F.caught.slice(-6).reverse(), cup = F.cup, now = Date.now() / 1000, d = daily();
  const standing = cup ? Object.entries(cup.totals).sort((a, b) => b[1] - a[1]) : [];
  const here = Object.values(POND.people).filter(p => now - p.at < 20);
  gside.innerHTML = `<h3>HOW</h3><div class="hint">Hold Space to charge a cast, let go to throw. When a fish bites (!), press Space. Then hold Space to reel; let go when the line climbs into the red.</div>
    ${inRoom() ? `<h3>THE POND</h3><div class="hint">${here.length ? `fishing with you: ${here.map(p => esc(p.name)).join(", ")}` : "the room's pond: whoever fishes joins you here"}. A fish someone hooks is theirs.</div>` : ""}
    <h3>📅 TODAY'S FISH</h3><div class="hint">${esc(FISH[d.fish][0])}: the biggest one caught today has its own board.</div>
    <h3>2-MINUTE CATCH</h3>${cup && cup.end > now
      ? `<div class="hint">${now < cup.start ? `starts in ${Math.ceil(cup.start - now)} s` : `${Math.ceil(cup.end - now)} s left`}</div>` + standing.map(([n, kg]) => `<div class="row"><span class="n">${esc(n)}</span><span class="v">${kg.toFixed(2)} kg</span></div>`).join("")
      : `<button class="go" data-cup="1">${inRoom() ? "Start a round with the room" : "Start a round"}</button>`}
    <h3>YOUR CATCH</h3>${mine.length ? mine.map(f => `<div class="row"><span class="n">${esc(f.name)}</span><span class="v">${f.kg.toFixed(2)} kg</span></div>`).join("") : `<div class="hint">nothing yet</div>`}
    ${F.feed.length ? `<h3>THE ROOM</h3><div class="feed">${F.feed.slice(-6).reverse().map(x => `<div>${esc(x)}</div>`).join("")}</div>` : ""}
    <h3>&nbsp;</h3><button data-home="1">Games</button>`;
}
function startCup(announce) {
  const now = Date.now() / 1000, wait = announce && inRoom() ? 5 : 0;
  FISHING.cup = { start: now + wait, end: now + wait + 120, totals: { [myName()]: 0 } };
  if (announce) gsend({ g: "fish", k: "cup", id: POND.id, in: wait, len: 120 });
  toast(wait ? "🎣 A 2-minute round starts in 5 s" : "🎣 2 minutes: catch as much as you can", null, 4000);
  side();
}

function fishKey(k, down) {
  if (k !== " ") return;
  const F = FISHING;
  if (down && F.phase === "idle") { F.phase = "charge"; F.power = 0; }
  else if (!down && F.phase === "charge") { F.phase = "wait"; F.dist = 30 + F.power * 150; F.wait = 0; sayMe(); }
  else if (down && F.phase === "bite") hook(F.cand);
}
/// Try to hook fish n: the keeper decides (at once when that is you).
function hook(n) {
  const F = FISHING;
  if (pondOwner()) {
    const c = POND.claims[n];
    if (c && c.by !== myId()) { toast("Someone else hooked that one", null, 2000); F.phase = "wait"; return; }
    POND.claims[n] = { by: myId(), st: "hook" };
    if (inRoom()) gsend({ g: "fish", k: "claim", id: POND.id, n, by: myId(), st: "hook" });
    return startReel(n);
  }
  F.phase = "hooking"; F.hookAt = Date.now() / 1000;
  gsend({ g: "fish", k: "hook", id: POND.id, n });
}
function startReel(n) {
  const f = fishAt(n);
  Object.assign(FISHING, { phase: "reel", fish: { n, name: f.name, color: f.color, kg: f.kg, fight: f.fight, kind: f.kind }, reel: FISHING.dist, tension: 0.3, slack: 0, pull: 0, surge: 0, target: 0 });
  sayMe();
}
function loseFish(text) {
  const F = FISHING, n = F.fish ? F.fish.n : -1;
  F.phase = "idle"; F.fish = null; toast(text, null, 2500);
  if (n < 0) return;
  if (pondOwner()) { delete POND.claims[n]; if (inRoom()) gsend({ g: "fish", k: "claim", id: POND.id, n, by: "", st: "" }); }
  else gsend({ g: "fish", k: "free", id: POND.id, n });
  sayMe();
}
function fishStep(dt) {
  const F = FISHING, holding = GAME.keys.has(" "), now = Date.now() / 1000, t = pondT();
  // keeping the pond: the keeper says it is there; the others notice when it goes quiet
  if (inRoom()) {
    if (pondOwner() && now - POND.sent > POND_BEAT) announcePond();
    if (!pondOwner() && now - POND.beat > POND_GONE) takeOverPond();
    if (now - (POND.meAt || 0) > POND_BEAT) sayMe(true);
  }
  if (F.cup && now > F.cup.end && !F.cup.over) {
    F.cup.over = true;
    const mine = F.cup.totals[myName()] || 0;
    if (mine > 0) {
      const pb = scoreBoard("fish-haul", +mine.toFixed(2));
      toast(`🏆 Round over: ${mine.toFixed(2)} kg${pb ? " · your best round!" : ""}`, null, 6000);
      if (mine >= 30) achieve("haul");
    } else toast("Round over", null, 3000);
    side();
  }
  if (F.phase === "charge") F.power = Math.min(1, F.power + dt * 0.9);
  if (F.phase === "wait") {
    // a free fish passing the bobber may bite
    const bx = 82 + F.dist, near = pondFish(t).filter(f => !POND.claims[f.n] && Math.abs(fishPos(f, t).x - bx) < 12);
    if (near.length && Math.random() < dt * 0.9) { F.phase = "bite"; F.bite = 1.0; F.cand = near[0].n; }
  }
  if (F.phase === "bite") { F.bite -= dt; if (F.bite <= 0 || POND.claims[F.cand]) F.phase = "wait"; }
  if (F.phase === "hooking" && now - F.hookAt > 2) { F.phase = "wait"; toast("The fish slipped off", null, 2000); }
  if (F.phase === "reel") {
    const f = F.fish;
    F.surge = (F.surge || 0) - dt;
    if (F.surge <= 0) { F.surge = 0.6 + Math.random() * 0.9; F.target = Math.random() < 0.35 ? f.fight * (0.5 + Math.random() * 0.5) : Math.random() * 0.3; }
    F.pull += ((F.target || 0) - F.pull) * Math.min(1, dt * 4);
    F.tension += (holding ? 0.6 : -1.2) * dt + F.pull * dt * 0.45;
    if (holding) F.reel -= dt * (30 - f.fight * 6) * (1.25 - F.tension * 0.5);
    else F.reel = Math.min(F.dist + 40, F.reel + F.pull * dt * 6);
    F.tension = Math.max(0, F.tension);
    F.slack = F.tension < 0.06 ? F.slack + dt : 0;
    if (F.tension >= 1) loseFish("💥 The line snapped");
    else if (F.slack > 2) loseFish("The fish got away");
    else if (F.reel <= 0) landFish();
    else sayMe();
  }
  const cup = F.cup && !F.cup.over ? ` · round: ${Math.max(0, Math.ceil(F.cup.end - now))} s` : "";
  ginfo.textContent = ({ idle: "hold Space to cast", charge: "let go to cast", wait: "waiting for a bite…", bite: "!! press Space !!", hooking: "hooking…", reel: "hold Space to reel" })[F.phase] + cup;
}
function landFish() {
  const F = FISHING, f = F.fish;
  F.phase = "idle"; F.fish = null;
  if (pondOwner()) { POND.claims[f.n] = { by: myId(), st: "land" }; if (inRoom()) gsend({ g: "fish", k: "claim", id: POND.id, n: f.n, by: myId(), st: "land", kg: f.kg, name: f.name }); }
  else gsend({ g: "fish", k: "land", id: POND.id, n: f.n });
  caught(myId(), myName(), f);
  sayMe();
}
/// Someone (maybe you) landed fish f: the feed, the round's totals, and for you the boards.
function caught(by, name, f) {
  const F = FISHING, now = Date.now() / 1000, d = daily();
  if (F.cup && now >= F.cup.start && now <= F.cup.end) F.cup.totals[name] = (F.cup.totals[name] || 0) + f.kg;
  if (by !== myId()) { F.feed.push(`${name}: ${f.name} ${f.kg.toFixed(2)} kg`); if (GAME.open && GAME.view === "fish") side(); return; }
  F.caught.push(f);
  const pb = scoreBoard("fish-big", f.kg);
  if (f.kind === d.fish) { scoreBoard(`daily-fish-${d.day}`, f.kg); achieve("daily"); }
  achieve("first-fish");
  if (f.name === "Golden Koi") achieve("koi");
  if (f.kg > 15) achieve("whopper");
  if (tally("fish") >= 50) achieve("angler");
  toast(`🐟 ${f.name}, ${f.kg.toFixed(2)} kg${f.kind === d.fish ? " · today's fish!" : ""}${pb ? " · your biggest yet!" : ""}`, null, 4000);
  side();
}
/// The keeper went quiet: the next person by id keeps the same pond (same seed, time and claims).
function takeOverPond() {
  const now = Date.now() / 1000;
  const ids = Object.entries(POND.people).filter(([id, p]) => now - p.at < 20 && id !== POND.owner).map(([id]) => id).concat([myId()]).sort();
  POND.beat = now;
  if (ids[0] === myId()) { POND.owner = myId(); POND.ownerName = myName(); announcePond(); }
}

function drawFishSprite(x, y, c, s, tilt) {
  gx.save(); gx.translate(x, y); gx.rotate(tilt || 0); gx.scale(s, s);
  gx.fillStyle = c; gx.fillRect(-6, -2, 10, 4); gx.fillRect(-4, -3, 6, 6); gx.fillRect(4, -3, 3, 2); gx.fillRect(4, 1, 3, 2);
  gx.fillStyle = "#1b1820"; gx.fillRect(-5, -1, 1, 1);
  gx.restore();
}
function drawLine(fromX, fromY, bx, tension, bite, t, fish) {
  const dip = bite ? 3 + Math.sin(t * 30) * 1.5 : Math.sin(t * 3 + fromX) * 0.8;
  gx.strokeStyle = "#f1ebe2aa"; gx.lineWidth = 0.6; gx.beginPath(); gx.moveTo(fromX, fromY);
  gx.quadraticCurveTo((fromX + bx) / 2, WATER - (fish ? 10 * tension : -4), bx, WATER + dip); gx.stroke();
  gpx(bx - 1.5, WATER - 2 + dip, 3, 3, "#e06c6c"); gpx(bx - 1.5, WATER - 2 + dip, 3, 1, "#f1ebe2");
  if (bite) gtext("!", bx, WATER - 22, "#ffe7a8", 14, "center");
  if (fish) drawFishSprite(bx + 4, WATER + 10 + Math.sin(t * 8) * 2, fish.color, 1.4, Math.sin(t * 6) * 0.3);
}
function drawFishing(t) {
  const F = FISHING, wy = WATER, pt = pondT(), now = Date.now() / 1000;
  gpx(0, 0, GW, wy, "#8fc4e8"); gpx(0, wy - 18, GW, 18, "#6a9a5f");
  for (let i = 0; i < GW; i += 24) gpx(i, wy - 22 - (hash("hill" + i) % 8), 24, 8, "#5f8d55");
  gpx(0, wy, GW, GH - wy, "#2a5a8a");
  for (let i = 0; i < 40; i++) { const xx = (hash("w" + i) % GW + t * 6) % GW; gpx(xx, wy + 6 + (hash("v" + i) % (GH - wy - 10)), 5, 1, "#3d72a6"); }
  // the pond's free fish, the same on every Mac
  for (const f of pondFish(pt)) {
    if (POND.claims[f.n]) continue;
    const p = fishPos(f, pt), fade = Math.min(1, (pt - f.spawn) / 1.5, (f.spawn + f.life - pt) / 1.5);
    gx.globalAlpha = 0.55 * fade; drawFishSprite(p.x, f.y, "#173a5c", 1.2, 0); gx.globalAlpha = 1;
    if (f.kind === daily().fish && fade > 0.5) gpx(p.x - 1, f.y - 6, 2, 2, "#ffe7a8");
  }
  gpx(0, wy - 6, 70, 6, "#8a6a45"); gpx(0, wy - 6, 70, 1, "#a8845a"); for (let i = 6; i < 70; i += 16) gpx(i, wy, 3, 22, "#6d5233");
  // the others on the dock, with their lines
  Object.entries(POND.people).filter(([, p]) => now - p.at < 20).slice(0, 3).forEach(([id, p], i) => {
    const ox = 10 + i * 14;
    gpx(ox, wy - 18, 6, 12, colorOf(id)); gpx(ox + 1, wy - 23, 4, 5, "#f1c9a5"); gtext(p.name.slice(0, 6), ox + 3, wy - 32, "#1b1820", 5, "center");
    if (p.st !== "idle") {
      const tipX = ox + 14, tipY = wy - 30;
      gx.strokeStyle = "#6d5233"; gx.lineWidth = 1; gx.beginPath(); gx.moveTo(ox + 4, wy - 14); gx.lineTo(tipX, tipY); gx.stroke();
      drawLine(tipX, tipY, 82 + p.x, 0.4, false, t, p.st === "reel" && p.n >= 0 ? fishAt(p.n) : null);
    }
  });
  const px0 = 56, py0 = wy - 6;
  gpx(px0, py0 - 14, 7, 14, myColor()); gpx(px0 + 1, py0 - 20, 5, 6, "#f1c9a5");
  const bend = F.phase === "reel" ? 6 + F.tension * 8 : 0, tipX = px0 + 26, tipY = py0 - 26 + bend;
  gx.strokeStyle = "#6d5233"; gx.lineWidth = 1.5; gx.beginPath(); gx.moveTo(px0 + 5, py0 - 10); gx.quadraticCurveTo(px0 + 16, py0 - 26, tipX, tipY); gx.stroke();
  if (F.phase === "charge") { gpx(px0 - 2, py0 - 40, 34, 5, "#1b1820"); gpx(px0 - 1, py0 - 39, 32 * F.power, 3, F.power > 0.85 ? "#e06c6c" : "#8fd6b4"); }
  if (["wait", "bite", "hooking", "reel"].includes(F.phase)) drawLine(tipX, tipY, tipX + (F.phase === "reel" ? F.reel : F.dist), F.tension, F.phase === "bite", t, F.phase === "reel" ? F.fish : null);
  if (F.phase === "reel") {
    gpx(GW - 22, 20, 10, 120, "#1b1820"); gpx(GW - 21, 21, 8, 30, "#5a1e1e"); gpx(GW - 21, 51, 8, 89, "#1e3a2a");
    const h = Math.min(1, F.tension) * 118; gpx(GW - 21, 139 - h, 8, 2, F.tension > 0.75 ? "#e06c6c" : "#8fd6b4");
    gtext("line", GW - 17, 142, "#a79d93", 6, "center");
  }
  if (F.cup && !F.cup.over && now < F.cup.start) gtext(`round starts in ${Math.ceil(F.cup.start - now)}`, GW / 2, 10, "#1b1820", 9, "center");
}

function fishMsg(from, name, d) {
  const now = Date.now() / 1000, F = FISHING;
  if (d.k === "pond") {
    // adopt it when we have none, ours went quiet, it is the same pond, or its id wins (the smaller)
    if (!(POND.id === d.id || !POND.id || now - POND.beat > POND_GONE || d.id < POND.id)) return;
    const moving = POND.id !== d.id;
    Object.assign(POND, { id: d.id, owner: String(d.owner || from), ownerName: String(d.ownerName || name), seed: (+d.seed) >>> 0, epoch: now - (+d.el || 0), beat: now });
    if (moving) {
      POND.claims = {};
      if (F.phase === "reel" || F.phase === "bite" || F.phase === "hooking") { F.phase = "idle"; F.fish = null; }
      if (GAME.open && GAME.view === "fish") toast(`🎣 Fishing in ${esc(POND.ownerName)}'s pond`, null, 3000);
    }
    if (d.claims && typeof d.claims === "object") for (const [n, c] of Object.entries(d.claims)) if (Array.isArray(c)) POND.claims[n] = { by: String(c[0]), st: String(c[1]) };
    return;
  }
  if (d.k === "cup") {
    const len = Math.min(300, Math.max(30, +d.len || 120)), wait = Math.min(30, Math.max(0, +d.in || 5));
    F.cup = { start: now + wait, end: now + wait + len, totals: { [name]: 0, [myName()]: 0 } };
    if (GAME.open && GAME.view === "fish") { toast(`🎣 ${esc(name)} started a 2-minute round`, null, 4000); side(); }
    else if (GAME.open) toast(`🎣 ${esc(name)} started a 2-minute fishing round · click to join`, () => fishStart(), 8000);
    else note(`🎣 ${name} started a 2-minute fishing round: Games tab → Fishing`);
    return;
  }
  if (d.id !== POND.id) return;
  if (d.k === "me") { POND.people[from] = { name, x: +d.x || 0, st: ["idle", "wait", "reel"].includes(d.st) ? d.st : "idle", n: +d.n, at: now }; return; }
  if (d.k === "bye") { delete POND.people[from]; if (from === POND.owner) { POND.beat = 0; takeOverPond(); } return; }
  if (pondOwner()) {
    // the keeper decides
    const n = +d.n, c = POND.claims[n];
    if (d.k === "hook") {
      const f = fishAt(n), t = pondT();
      if (!c && t >= f.spawn && t < f.spawn + f.life) POND.claims[n] = { by: from, st: "hook" };
      const now2 = POND.claims[n] || { by: "", st: "" };
      gsend({ g: "fish", k: "claim", id: POND.id, n, by: now2.by, st: now2.st });
      if (now2.by !== from && F.phase === "bite" && F.cand === n) F.phase = "wait";
    }
    if (d.k === "free" && c && c.by === from && c.st === "hook") { delete POND.claims[n]; gsend({ g: "fish", k: "claim", id: POND.id, n, by: "", st: "" }); }
    if (d.k === "land" && c && c.by === from) {
      const f = fishAt(n); POND.claims[n] = { by: from, st: "land" };
      gsend({ g: "fish", k: "claim", id: POND.id, n, by: from, st: "land", kg: f.kg, name: f.name });
      caught(from, name, f);
    }
    return;
  }
  if (d.k === "claim" && from === POND.owner) {
    const n = +d.n;
    if (d.by) POND.claims[n] = { by: String(d.by), st: String(d.st) }; else delete POND.claims[n];
    if (F.phase === "hooking" && n === F.cand) {
      if (d.by === myId()) startReel(n);
      else { F.phase = "wait"; toast(d.by ? "Someone else hooked that one" : "The fish slipped off", null, 2000); }
    }
    if (d.st === "land" && d.by !== myId()) {
      const who = (POND.people[d.by] && POND.people[d.by].name) || (d.by === POND.owner ? POND.ownerName : "Someone");
      caught(d.by, who, fishAt(n));
    }
  }
}
registerGame("fish", {
  title: "🎣 Fishing",
  start: fishStart, step: fishStep, draw: drawFishing, side: fishSide, msg: fishMsg,
  key: fishKey,
  leave: () => { if (FISHING.phase === "reel") loseFish("You left"); FISHING.phase = "idle"; gsend({ g: "fish", k: "bye", id: POND.id }); if (pondOwner()) POND.beat = 0; },
  mouse: (p, type) => { if (type === "mousedown") fishKey(" ", true); if (type === "mouseup") fishKey(" ", false); },
  click: b => { if (b.dataset.cup) startCup(true); },
  speciesName: i => FISH[i][0],
  tab: () => { const now = Date.now() / 1000, n = Object.values(POND.people).filter(p => now - p.at < 20).length;
    return n && POND.id && now - POND.beat < POND_GONE ? `<div class="gh">FISHING</div><div class="g"><span class="gn">🎣 ${n} fishing in the pond</span><button data-gplay="fish">Join</button></div>` : ""; },
  tabKey: () => Object.values(POND.people).filter(p => Date.now() / 1000 - p.at < 20).length,
  drawIcon: t => {
    gpx(115, 128, 70, 24, "#2a5a8a"); gpx(115, 128, 70, 2, "#4f8fc9");
    const j = (t % 2.4) / 2.4, fy = 128 - Math.sin(j * Math.PI) * 22;
    drawFishSprite(140 + j * 20, fy, "#f0a35e", 1, j < 0.5 ? -0.4 : 0.4); gtext("fishing", 150, 156, "#a79d93", 8, "center");
  },
});
