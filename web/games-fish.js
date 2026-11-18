// 🎣 Fishing (games.js is the shell). Hold Space (or the mouse) to charge a cast and let go to throw.
// When the bobber dives and "!" shows, press Space within a second to hook it. Then reel: holding
// pulls the fish in and raises the line's tension; the fish surges and rests. Letting go always
// lowers the tension, but the fish swims off a little; in the red the line snaps, and with no
// tension for two seconds the fish gets away.
//
// A 2-minute round alone or for the whole room adds everyone's catch up live. The daily challenge
// is today's species: the biggest one caught today has its own board (and it bites more often when
// you fish for it).
//
// Room messages, {g: "fish", k, …}: here (you are fishing), catch {name, kg}, cup {in, len}.
"use strict";

const FISH = [
  // name, colour, kg range, how often (weight), fight (how hard it pulls)
  ["Bluegill", "#6fa8dc", 0.1, 0.6, 30, 0.6], ["Perch", "#c9b458", 0.2, 1.2, 24, 0.8], ["Trout", "#b98be0", 0.5, 4, 16, 1.1],
  ["Bass", "#5fbf7f", 0.8, 5, 14, 1.2], ["Carp", "#c27460", 2, 15, 8, 1.4], ["Pike", "#7f9a7a", 2, 12, 5, 1.7],
  ["Catfish", "#8a7f74", 3, 25, 3, 1.9], ["Golden Koi", "#f0c040", 1, 6, 1, 1.5],
];
const FISHING = { phase: "idle", power: 0, dist: 0, wait: 0, bite: 0, fish: null, reel: 0, tension: 0, slack: 0, caught: [], feed: [], cup: null, people: {}, daily: false };
function fishStart(arg) {
  Object.assign(FISHING, { phase: "idle", power: 0, fish: null, tension: 0, daily: arg === "daily" });
  gshow("fish");
  gsend({ g: "fish", k: "here" });
}
function fishSide() {
  const F = FISHING, mine = F.caught.slice(-6).reverse(), cup = F.cup, now = Date.now() / 1000, d = daily();
  const standing = cup ? Object.entries(cup.totals).sort((a, b) => b[1] - a[1]) : [];
  gside.innerHTML = `<h3>HOW</h3><div class="hint">Hold Space to charge a cast, let go to throw. When the bobber dives and ! shows, press Space. Then hold Space to reel; let go when the line climbs into the red.</div>
    <h3>📅 TODAY'S FISH</h3><div class="hint">${esc(FISH[d.fish][0])}: the biggest one caught today has its own board.${F.daily ? " It bites more often while you fish for it." : ""}</div>
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
  if (announce) gsend({ g: "fish", k: "cup", in: wait, len: 120 });
  toast(wait ? "🎣 A 2-minute round starts in 5 s" : "🎣 2 minutes: catch as much as you can", null, 4000);
  side();
}
function pickFish() {
  const d = daily(), w = f => f[4] * (FISHING.daily && FISH.indexOf(f) === d.fish ? 3 : 1);
  const total = FISH.reduce((s, f) => s + w(f), 0); let r = Math.random() * total;
  for (const f of FISH) { r -= w(f); if (r <= 0) return f; }
  return FISH[0];
}
function fishKey(k, down) {
  if (k !== " ") return;
  const F = FISHING;
  if (down && F.phase === "idle") { F.phase = "charge"; F.power = 0; }
  else if (!down && F.phase === "charge") { F.phase = "wait"; F.dist = 30 + F.power * 150; F.wait = 2 + Math.random() * 5; }
  else if (down && F.phase === "bite") {
    const f = pickFish(), kg = +(f[2] + Math.pow(Math.random(), 2.2) * (f[3] - f[2])).toFixed(2);
    Object.assign(F, { phase: "reel", fish: { name: f[0], color: f[1], kg, fight: f[5], kind: FISH.indexOf(f) }, reel: F.dist, tension: 0.3, slack: 0, pull: 0, surge: 0, target: 0 });
  }
}
function fishStep(dt) {
  const F = FISHING, holding = GAME.keys.has(" "), now = Date.now() / 1000;
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
  if (F.phase === "wait") { F.wait -= dt; if (F.wait <= 0) { F.phase = "bite"; F.bite = 1.0; } }
  if (F.phase === "bite") { F.bite -= dt; if (F.bite <= 0) { F.phase = "wait"; F.wait = 1.5 + Math.random() * 4; } }
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
    if (F.tension >= 1) { F.phase = "idle"; F.fish = null; toast("💥 The line snapped", null, 2500); }
    else if (F.slack > 2) { F.phase = "idle"; F.fish = null; toast("The fish got away", null, 2500); }
    else if (F.reel <= 0) landFish(f, now);
  }
  const cup = F.cup && !F.cup.over ? ` · round: ${Math.max(0, Math.ceil(F.cup.end - now))} s` : "";
  ginfo.textContent = ({ idle: "hold Space to cast", charge: "let go to cast", wait: "waiting for a bite…", bite: "!! press Space !!", reel: "hold Space to reel" })[F.phase] + cup;
}
function landFish(f, now) {
  const F = FISHING, d = daily();
  F.phase = "idle"; F.caught.push(f); F.fish = null;
  const pb = scoreBoard("fish-big", f.kg);
  if (f.kind === d.fish) { scoreBoard(`daily-fish-${d.day}`, f.kg); achieve("daily"); }
  if (F.cup && now >= F.cup.start && now <= F.cup.end) F.cup.totals[myName()] = (F.cup.totals[myName()] || 0) + f.kg;
  gsend({ g: "fish", k: "catch", name: f.name, kg: f.kg });
  achieve("first-fish");
  if (f.name === "Golden Koi") achieve("koi");
  if (f.kg > 15) achieve("whopper");
  if (tally("fish") >= 50) achieve("angler");
  toast(`🐟 ${f.name}, ${f.kg.toFixed(2)} kg${f.kind === d.fish ? " · today's fish!" : ""}${pb ? " · your biggest yet!" : ""}`, null, 4000);
  side();
}
function drawFishSprite(x, y, c, s, tilt) {
  gx.save(); gx.translate(x, y); gx.rotate(tilt || 0); gx.scale(s, s);
  gx.fillStyle = c; gx.fillRect(-6, -2, 10, 4); gx.fillRect(-4, -3, 6, 6); gx.fillRect(4, -3, 3, 2); gx.fillRect(4, 1, 3, 2);
  gx.fillStyle = "#1b1820"; gx.fillRect(-5, -1, 1, 1);
  gx.restore();
}
function drawFishing(t) {
  const F = FISHING, wy = 90;
  gpx(0, 0, GW, wy, "#8fc4e8"); gpx(0, wy - 18, GW, 18, "#6a9a5f");
  for (let i = 0; i < GW; i += 24) gpx(i, wy - 22 - (hash("hill" + i) % 8), 24, 8, "#5f8d55");
  gpx(0, wy, GW, GH - wy, "#2a5a8a");
  for (let i = 0; i < 40; i++) { const xx = (hash("w" + i) % GW + t * 6) % GW; gpx(xx, wy + 6 + (hash("v" + i) % (GH - wy - 10)), 5, 1, "#3d72a6"); }
  gpx(0, wy - 6, 70, 6, "#8a6a45"); gpx(0, wy - 6, 70, 1, "#a8845a"); for (let i = 6; i < 70; i += 16) gpx(i, wy, 3, 22, "#6d5233");
  // the others fishing with you, along the dock
  Object.values(F.people).filter(p => Date.now() / 1000 - p.at < 20).slice(0, 3).forEach((p, i) => {
    const ox = 14 + i * 14; gpx(ox, wy - 18, 6, 12, p.color); gpx(ox + 1, wy - 23, 4, 5, "#f1c9a5"); gtext(p.name.slice(0, 6), ox + 3, wy - 32, "#1b1820", 5, "center");
  });
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
    gpx(GW - 22, 20, 10, 120, "#1b1820"); gpx(GW - 21, 21, 8, 30, "#5a1e1e"); gpx(GW - 21, 51, 8, 89, "#1e3a2a");
    const h = Math.min(1, F.tension) * 118; gpx(GW - 21, 139 - h, 8, 2, F.tension > 0.75 ? "#e06c6c" : "#8fd6b4");
    gtext("line", GW - 17, 142, "#a79d93", 6, "center");
  }
  if (F.cup && !F.cup.over && Date.now() / 1000 < F.cup.start) gtext(`round starts in ${Math.ceil(F.cup.start - Date.now() / 1000)}`, GW / 2, 10, "#1b1820", 9, "center");
}
function fishMsg(from, name, d) {
  const F = FISHING, now = Date.now() / 1000;
  F.people[from] = { name, color: colorOf(from), at: now };
  if (d.k === "catch" && typeof d.kg === "number" && typeof d.name === "string") {
    F.feed.push(`${name}: ${d.name.slice(0, 20)} ${d.kg.toFixed(2)} kg`);
    if (F.cup && now >= F.cup.start && now <= F.cup.end) F.cup.totals[name] = (F.cup.totals[name] || 0) + d.kg;
    if (GAME.open && GAME.view === "fish") side();
  }
  if (d.k === "cup") {
    const len = Math.min(300, Math.max(30, +d.len || 120)), wait = Math.min(30, Math.max(0, +d.in || 5));
    F.cup = { start: now + wait, end: now + wait + len, totals: { [name]: 0, [myName()]: 0 } };
    if (GAME.open && GAME.view === "fish") { toast(`🎣 ${esc(name)} started a 2-minute round`, null, 4000); side(); }
    else if (GAME.open) toast(`🎣 ${esc(name)} started a 2-minute fishing round · click to join`, () => fishStart(), 8000);
    else note(`🎣 ${name} started a 2-minute fishing round: Games tab → Fishing`);
  }
}
registerGame("fish", {
  title: "🎣 Fishing",
  start: fishStart, step: fishStep, draw: drawFishing, side: fishSide, msg: fishMsg,
  key: fishKey,
  mouse: (p, type) => { if (type === "mousedown") fishKey(" ", true); if (type === "mouseup") fishKey(" ", false); },
  click: b => { if (b.dataset.cup) startCup(true); },
  speciesName: i => FISH[i][0],
  drawIcon: t => {
    gpx(115, 128, 70, 24, "#2a5a8a"); gpx(115, 128, 70, 2, "#4f8fc9");
    const j = (t % 2.4) / 2.4, fy = 128 - Math.sin(j * Math.PI) * 22;
    drawFishSprite(140 + j * 20, fy, "#f0a35e", 1, j < 0.5 ? -0.4 : 0.4); gtext("fishing", 150, 156, "#a79d93", 8, "center");
  },
});
