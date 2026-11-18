// 🏓 Ping-pong (games.js is the shell): first to 7, against the computer or a teammate.
//
// Against a teammate: challenge them from the Games tab or this game's side panel; they get a
// toast (or a line in the log) and Accept. The one who challenged runs the ball and sends it with
// both scores 15 times a second; the other sends their paddle and draws the ball moving on from the
// last word it had. ↑↓ / W S or the mouse move your paddle. Wins against teammates count on the
// leaderboard.
//
// Room messages, {g: "pong", k, id, …}: ask {to}, yes, no, st {b: [x, y, vx, vy], l, r, s: [left,
// right]}, pad {y}, end {s}, bye.
"use strict";

const PONG_TO = 7, PAD_H = 32, PAD_X = 12, BALL = 4, PONG_RATE = 1 / 15;
const PONG = { phase: "idle", mode: "cpu", id: "", me: "l", l: 84, r: 84, b: [160, 100, 0, 0], s: [0, 0], sent: 0, heard: 0, asks: {}, mouseY: null };
const pongOpp = () => PONG.mode === "cpu" ? "the computer" : PONG.oppName || "your opponent";
function pongStart(arg) {
  if (arg === "demo" || !PONG.id) { PONG.mode = "cpu"; PONG.phase = arg === "demo" ? "play" : "idle"; resetPong(); }
  gshow("pong");
}
function resetPong() { Object.assign(PONG, { l: 84, r: 84, s: [0, 0] }); serve(Math.random() < 0.5 ? 1 : -1); }
function serve(dir) { const a = (Math.random() - 0.5) * 0.8; PONG.b = [GW / 2, GH / 2, Math.cos(a) * 110 * dir, Math.sin(a) * 110]; PONG.wait = 0.8; }
function pongSide() {
  const mates = typeof roomMates === "function" ? roomMates() : [];
  const asks = Object.values(PONG.asks).filter(a => Date.now() / 1000 - a.at < 60);
  gside.innerHTML = `<h3>HOW</h3><div class="hint">↑ ↓ / W S or the mouse move your paddle. First to ${PONG_TO}.</div>
    ${PONG.phase === "play" ? `<h3>${PONG.mode === "cpu" ? "VS THE COMPUTER" : "VS " + esc(pongOpp()).toUpperCase()}</h3><div class="row"><span class="n">you</span><span class="v">${PONG.s[PONG.me === "l" ? 0 : 1]}</span></div><div class="row"><span class="n">${esc(pongOpp())}</span><span class="v">${PONG.s[PONG.me === "l" ? 1 : 0]}</span></div>`
      : `<h3>&nbsp;</h3><button class="go" data-cpu="1">Play the computer</button>`}
    ${asks.length ? `<h3>CHALLENGES</h3>` + asks.map(a => `<div class="row"><span class="n">${esc(a.name)}</span><button class="go" data-yes="${esc(a.id)}">Accept</button><button data-no="${esc(a.id)}">Not now</button></div>`).join("") : ""}
    ${mates.length && PONG.phase !== "play" ? `<h3>CHALLENGE A TEAMMATE</h3>` + mates.map(m => `<div class="row"><span class="n">${esc(m.name)}</span><button data-ask="${esc(m.id)}">Challenge</button></div>`).join("") : ""}
    ${PONG.phase === "wait" ? `<div class="hint" style="margin-top:8px">Waiting for ${esc(pongOpp())} to accept…</div>` : ""}
    <h3>MOST WINS</h3>${(boardsNow().boards["pong-wins"] || []).slice(0, 5).map((e, i) => `<div class="row"><span class="n">${i + 1}. ${esc(e.name)}</span><span class="v">${Math.round(e.value)}</span></div>`).join("") || `<div class="hint">none yet</div>`}
    <h3>&nbsp;</h3><button data-home="1">Games</button>`;
}
function ask(id) {
  const m = roomMates().find(x => x.id === id); if (!m) return;
  Object.assign(PONG, { id: myId() + "-" + Date.now(), mode: "net", me: "l", phase: "wait", opp: m.id, oppName: m.name });
  gsend({ g: "pong", k: "ask", id: PONG.id, to: m.id });
  side();
}
function accept(id) {
  const a = PONG.asks[id]; if (!a) return;
  delete PONG.asks[id];
  leaveCurrent();
  if (!GAME.open) openGames("home");
  Object.assign(PONG, { id, mode: "net", me: "r", phase: "play", opp: a.from, oppName: a.name, heard: Date.now() / 1000 });
  resetPong();
  gsend({ g: "pong", k: "yes", id });
  gshow("pong");
}
function decline(id) {
  if (!PONG.asks[id]) return;
  delete PONG.asks[id]; peopleKey = "";
  gsend({ g: "pong", k: "no", id });
  if (GAME.open && GAME.view === "pong") side();
}
function pongStep(dt) {
  const P = PONG, k = GAME.keys, now = Date.now() / 1000;
  if (P.phase !== "play") { ginfo.textContent = P.phase === "over" ? P.result : P.phase === "wait" ? "waiting for an answer" : "pick an opponent"; return; }
  // your paddle
  const mine = P.me, up = k.has("arrowup") || k.has("w"), down = k.has("arrowdown") || k.has("s");
  if (up) P[mine] -= 150 * dt; if (down) P[mine] += 150 * dt;
  if (P.mouseY !== null && !up && !down) P[mine] += Math.max(-150 * dt, Math.min(150 * dt, P.mouseY - PAD_H / 2 - P[mine]));
  P[mine] = Math.max(0, Math.min(GH - PAD_H, P[mine]));
  if (P.mode === "net" && now - P.heard > 8) { endPong(false, `${pongOpp()} left`); return; }
  if (P.mode === "net" && P.me === "r") {
    // the other side runs the ball: carry it on from the last word
    P.b[0] += P.b[2] * dt; P.b[1] += P.b[3] * dt;
    if (P.b[1] < 0 || P.b[1] > GH - BALL) P.b[3] = -P.b[3];
    if (now - P.sent > PONG_RATE) { P.sent = now; gsend({ g: "pong", k: "pad", id: P.id, y: Math.round(P.r) }); }
    ginfo.textContent = `you ${P.s[1]} : ${P.s[0]} ${pongOpp()}`;
    return;
  }
  if (P.mode === "cpu") {
    // the computer chases the ball only while it comes its way, aims a little off (a new guess at
    // every return) and is slower than a fast ball: it can be beaten
    const target = P.b[2] > 0 ? P.b[1] - PAD_H / 2 + (P.cpuErr || 0) : GH / 2 - PAD_H / 2;
    P.r += Math.max(-100 * dt, Math.min(100 * dt, target - P.r)); P.r = Math.max(0, Math.min(GH - PAD_H, P.r));
  }
  if (P.wait > 0) P.wait -= dt;
  else {
    const b = P.b; b[0] += b[2] * dt; b[1] += b[3] * dt;
    if (b[1] < 0) { b[1] = 0; b[3] = Math.abs(b[3]); } if (b[1] > GH - BALL) { b[1] = GH - BALL; b[3] = -Math.abs(b[3]); }
    const hit = (px, side) => {
      const pad = side === "l" ? P.l : P.r;
      if (b[1] + BALL < pad || b[1] > pad + PAD_H) return false;
      const off = (b[1] + BALL / 2 - (pad + PAD_H / 2)) / (PAD_H / 2), speed = Math.min(260, Math.hypot(b[2], b[3]) * 1.06);
      // where it meets the paddle sets the angle, plus a little spin, so no rally is flat forever
      const ang = Math.max(-1, Math.min(1, off * 0.9 + (Math.random() - 0.5) * 0.4));
      b[2] = Math.cos(ang) * speed * (side === "l" ? 1 : -1); b[3] = Math.sin(ang) * speed; b[0] = px;
      if (side === "l") P.cpuErr = (Math.random() - 0.5) * PAD_H * 1.3;
      return true;
    };
    if (b[0] <= PAD_X + 4 && b[2] < 0 && !hit(PAD_X + 4, "l") && b[0] < 0) { P.s[1]++; serve(1); }
    if (b[0] >= GW - PAD_X - 4 - BALL && b[2] > 0 && !hit(GW - PAD_X - 4 - BALL, "r") && b[0] > GW) { P.s[0]++; serve(-1); }
    if (P.s[0] >= PONG_TO || P.s[1] >= PONG_TO) {
      const won = P.s[0] > P.s[1];
      if (P.mode === "net") gsend({ g: "pong", k: "end", id: P.id, s: P.s });
      endPong(won, won ? "you won" : `${pongOpp()} won`);
      return;
    }
  }
  if (P.mode === "net" && now - P.sent > PONG_RATE) {
    P.sent = now;
    gsend({ g: "pong", k: "st", id: P.id, b: P.b.map(v => Math.round(v * 10) / 10), l: Math.round(P.l), s: P.s });
  }
  ginfo.textContent = `you ${P.s[0]} : ${P.s[1]} ${pongOpp()}`;
}
function endPong(won, text) {
  const P = PONG; P.phase = "over"; P.result = `${text} · ${P.s[P.me === "l" ? 0 : 1]} : ${P.s[P.me === "l" ? 1 : 0]}`;
  if (won && P.mode === "cpu") achieve("pong-cpu");
  if (won && P.mode === "net") { achieve("pong-win"); scoreBoard("pong-wins", tally("pongWins")); }
  toast(won ? `🏓 You won ${P.result.split(" · ")[1]}` : `🏓 ${esc(P.result)}`, null, 5000);
  P.id = ""; side();
}
function drawPong() {
  const P = PONG;
  gpx(0, 0, GW, GH, "#1e5a3a"); gpx(0, 0, GW, 2, "#f1ebe2"); gpx(0, GH - 2, GW, 2, "#f1ebe2");
  for (let y = 4; y < GH; y += 10) gpx(GW / 2 - 1, y, 2, 6, "#f1ebe2aa");
  gpx(PAD_X, P.l, 4, PAD_H, P.me === "l" ? myColor() : colorOf(P.opp || "cpu"));
  gpx(GW - PAD_X - 4, P.r, 4, PAD_H, P.me === "r" ? myColor() : P.mode === "cpu" ? "#a79d93" : colorOf(P.opp || "cpu"));
  if (P.phase === "play") gpx(P.b[0], P.b[1], BALL, BALL, "#ffe7a8");
  gtext(String(P.s[0]), GW / 2 - 24, 10, "#f1ebe2", 16, "center"); gtext(String(P.s[1]), GW / 2 + 24, 10, "#f1ebe2", 16, "center");
  if (P.phase !== "play") { gpx(GW / 2 - 90, GH / 2 - 16, 180, 32, "#0d0b10cc"); gtext(P.phase === "over" ? P.result : P.phase === "wait" ? "waiting for an answer…" : "play the computer or a teammate", GW / 2, GH / 2 - 5, "#ffe7a8", 8, "center"); }
}
function pongMsg(from, name, d) {
  const P = PONG, now = Date.now() / 1000;
  if (d.k === "ask" && d.to === myId()) {
    P.asks[d.id] = { id: d.id, from, name, at: now };
    if (GAME.open) toast(`🏓 ${esc(name)} challenges you to ping-pong · click to accept`, () => accept(d.id), 15000);
    else note(`🏓 ${name} challenges you to ping-pong: Games tab → Accept`);
    peopleKey = ""; if (GAME.open && GAME.view === "pong") side();
    return;
  }
  if (d.id !== P.id) return;
  P.heard = now;
  if (d.k === "yes" && P.phase === "wait" && from === P.opp) { P.phase = "play"; resetPong(); side(); }
  if (d.k === "no" && P.phase === "wait") { P.phase = "idle"; toast(`${esc(name)} said not now`, null, 3000); side(); }
  if (d.k === "pad" && P.me === "l" && from === P.opp) P.r = Math.max(0, Math.min(GH - PAD_H, +d.y || 0));
  if (d.k === "st" && P.me === "r" && from === P.opp && Array.isArray(d.b)) { P.b = d.b.map(Number); P.l = +d.l || 0; const before = P.s.join(); P.s = (d.s || [0, 0]).map(Number); if (P.s.join() !== before) side(); }
  if (d.k === "end" && P.me === "r") { P.s = (d.s || P.s).map(Number); endPong(P.s[1] > P.s[0], P.s[1] > P.s[0] ? "you won" : `${pongOpp()} won`); }
  if (d.k === "bye" && P.phase !== "over") { P.phase = "over"; P.result = `${pongOpp()} left`; P.id = ""; side(); }
}
registerGame("pong", {
  title: "🏓 Ping-pong",
  start: pongStart, step: pongStep, draw: drawPong, side: pongSide, msg: pongMsg,
  leave: () => { if (PONG.id && PONG.mode === "net") gsend({ g: "pong", k: "bye", id: PONG.id }); if (PONG.phase === "play" || PONG.phase === "wait") { PONG.phase = "idle"; PONG.id = ""; } },
  mouse: (p, type) => { if (type === "mousemove") PONG.mouseY = p.y; },
  click: b => {
    if (b.dataset.cpu) { Object.assign(PONG, { mode: "cpu", me: "l", phase: "play", id: "", opp: "" }); resetPong(); side(); }
    if (b.dataset.ask) ask(b.dataset.ask);
    if (b.dataset.yes) accept(b.dataset.yes);
    if (b.dataset.no) decline(b.dataset.no);
  },
  tab: () => {
    const asks = Object.values(PONG.asks).filter(a => Date.now() / 1000 - a.at < 60);
    const mates = inRoom() ? roomMates() : [];
    return (asks.length ? `<div class="gh">CHALLENGES</div>` + asks.map(a => `<div class="g"><span class="gn">🏓 ${esc(a.name)} challenges you</span><button data-gyes="${esc(a.id)}">Accept</button><button class="alt" data-gno="${esc(a.id)}">✕</button></div>`).join("") : "")
      + (mates.length ? `<div class="gh">PING-PONG</div>` + mates.map(m => `<div class="g"><span class="gn">🏓 ${esc(m.name)}</span><button class="alt" data-gask="${esc(m.id)}">Challenge</button></div>`).join("") : "");
  },
  tabClick: b => {
    if (b.dataset.gyes) { accept(b.dataset.gyes); return true; }
    if (b.dataset.gno) { decline(b.dataset.gno); return true; }
    if (b.dataset.gask) { openGames("home"); gshow("pong"); ask(b.dataset.gask); return true; }
    return false;
  },
  tabKey: () => Object.keys(PONG.asks).join(",") + (inRoom() ? roomMates().map(m => m.id).join(",") : ""),
  drawIcon: t => { const y = 128 + Math.sin(t * 3) * 10; gpx(255, 112, 3, 22, "#f1ebe2"); gpx(295, 112, 3, 22, "#f1ebe2"); gpx(260 + ((t * 40) % 32), y, 3, 3, "#ffe7a8"); gtext("ping-pong", 276, 150, "#a79d93", 8, "center"); },
});
