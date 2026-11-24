// A shared room on the local network: everyone who knows the room's name and password sees each
// other's character in the lounge and can chat. One Agent Office hosts it (room.host = true); it
// advertises the room by name with Bonjour, so members need only the name and the password.
//
// What crosses the network: each member's name, a small picture, chat messages, and the mini-games'
// messages and scores. Nothing about anyone's sessions. Messages are relayed by the host and kept only in each app's memory.
//
// Wire format: one JSON object per WebSocket text message.
//   host → member, plain:  {t:"hello", v:1, sn}                  sn: 16 random bytes, base64
//   member → host, plain:  {t:"auth", cn, proof}                 cn: 16 random bytes, base64
//   then, both ways:       {t:"box", d}  d = AES-GCM(K, json), base64 of nonce|ciphertext|tag
// K = HKDF-SHA256(password, salt: sn|cn, info: "agent-office room v1 " + room name), 32 bytes, and
// proof = HMAC-SHA256(K, "member"). The password never travels; a host that does not know it
// cannot read anything, and nor can anyone else on the network.
//   inside a box, member → host:  {t:"profile", name, avatar}  {t:"say", text}
//                                 {t:"edit", mid, text}  {t:"unsay", mid}
//   inside a box, host → member:  {t:"welcome", you, members}  {t:"join"|"profile", member}
//                                 {t:"leave", id}  {t:"msg", id, mid, from, text, at}
//                                 {t:"edited", mid, text}  {t:"unsaid", mid}
//   mini-games, member → host:    {t:"g", d}  {t:"score", board, value}   (profile may carry a badge)
//   mini-games, host → member:    {t:"g", from, name, d}  {t:"scores", boards}   (welcome carries scores too)
// d is a game's own small message (web/games.js), relayed as it is to everyone. The host keeps the
// room's leaderboard: it takes a score only for a known board and within that board's bounds, keeps
// each name's best of the UTC day and the top ROOM_BOARD_SIZE, and saves it on its own Mac (scoresFile).
// mid names one message; the host gives it out and accepts an edit or an unsay of a message only
// from the connection that said it. A member whose app predates edit and unsay ignores those two,
// so it keeps showing the first text.

import Foundation
import Network
import CryptoKit

let ROOM_SERVICE = "_agent-office._tcp"
// The host listens here, so a member can also join by address when the network hides Bonjour
// (Wi-Fi that blocks devices announcing themselves, a VPN exit node). Unregistered, and below
// macOS's range for automatic ports (49152 and up), so the system never hands it out itself.
let ROOM_PORT: UInt16 = 48731
let ROOM_MAX_FRAME = 200_000          // bytes, any message
let ROOM_MAX_AVATAR = 120_000         // bytes of data URL
let ROOM_MAX_TEXT = 500               // characters per chat message
let ROOM_MAX_MEMBERS = 40
let ROOM_KEPT_MESSAGES = 300          // messages each app keeps, and the host can still edit or unsay
let ROOM_AWAY: Double = 15 * 60       // seconds someone who left is listed as reconnecting
let ROOM_BOARD_SIZE = 10
// the leaderboards: (lowest is best?, smallest and largest score taken). Race: the best lap on track n,
// in seconds (a lap, so races of any length compare); fishing: the biggest fish and a two-minute
// round's catch, in kg; Bug Whack: a round's points; ping-pong: games won; archery: a round's points
// (15 arrows, at most 150); Sky Patrol: a flight's points; Desk Karts: the best lap on track n, in
// seconds.
let ROOM_BOARDS: [String: (lowWins: Bool, min: Double, max: Double)] = [
    "race-1": (true, 3, 600), "race-2": (true, 3, 600), "race-3": (true, 3, 600),
    "race-4": (true, 3, 600), "race-5": (true, 3, 600),
    "fish-big": (false, 0.01, 100), "fish-haul": (false, 0.01, 2000),
    "bugs": (false, 1, 2000), "pong-wins": (false, 1, 100_000),
    "archery": (false, 1, 150), "sky": (false, 1, 1_000_000),
    "kart-1": (true, 5, 600), "kart-2": (true, 5, 600), "kart-3": (true, 5, 600), "kart-4": (true, 5, 600),
]
let ROOM_DAILY_KEPT = 7               // days of daily-challenge boards the host keeps
/// The start of the current UTC day. The room's boards (ROOM_BOARDS) start empty every day at 00:00
/// UTC, the same moment for every member wherever they are: the host keeps only scores made since.
/// The daily challenge's boards are a UTC day's already ("daily-race-<UTC date>").
func utcMidnight(_ d: Date = Date()) -> Double { (d.timeIntervalSince1970 / 86400).rounded(.down) * 86400 }
/// A board's rule: one of ROOM_BOARDS, or a daily challenge's ("daily-race-2026-11-18" or
/// "daily-fish-…") for today, yesterday or tomorrow in UTC (a member's clock may be off, or on a
/// version that still names the day by its own time zone); any other day is refused, so old days
/// cannot be filled in later.
func roomBoardRule(_ board: String) -> (lowWins: Bool, min: Double, max: Double)? {
    if let r = ROOM_BOARDS[board] { return r }
    guard let m = board.range(of: "^daily-(race|fish)-[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression), m.lowerBound == board.startIndex else { return nil }
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    let day = String(board.suffix(10)), now = Date()
    guard [-86400.0, 0, 86400].contains(where: { f.string(from: now.addingTimeInterval($0)) == day }) else { return nil }
    return board.hasPrefix("daily-race") ? (true, 3, 600) : (false, 0.01, 100)
}
/// Out of the room (it was lost, or not there when the app started): looks this many seconds apart,
/// then one a minute for ROOM_RETRY_MINUTE_FOR seconds, then one every ROOM_RETRY_SLOW. A host's
/// update takes a minute or two, a Mac's restart a few: the early looks find it the moment it is back.
let ROOM_RETRY_QUICK: [TimeInterval] = [3, 5, 10, 15, 20, 30, 45, 60]
let ROOM_RETRY_MINUTE_FOR: TimeInterval = 30 * 60
let ROOM_RETRY_SLOW: TimeInterval = 5 * 60
let ROOM_GAME_RATE = 40               // game messages per member in 2 s (a car's position, 10 a second)
let ROOM_GAME_BYTES = 1500            // bytes of one game message
let ROOM_SCORE_RATE = 5               // scores per member in 10 s
let ROOM_SPOTS: Set<String> = ["make", "drink", "game", "chat"]   // where a member can stand in the lounge
// what one member can do to another; a poke also reaches the poked person's Mac as a notification
let ROOM_ACTS: Set<String> = ["hug", "kiss", "highfive", "fight", "coffee", "wave", "poke"]

struct RoomConfig: Equatable {
    var name = ""
    var password = ""
    var host = false
    var alwaysJoin = true
    var port: UInt16 = ROOM_PORT          // the host's port
    var address = ""                      // a member's fallback: "host" or "host:port"
    var enabled: Bool { !name.isEmpty && !password.isEmpty }

    /// `address` as an endpoint: a name or an IPv4/IPv6 address, with an optional port.
    var addressEndpoint: NWEndpoint? {
        var a = address.trimmingCharacters(in: .whitespaces), port = ROOM_PORT
        guard !a.isEmpty else { return nil }
        if a.hasPrefix("["), let close = a.firstIndex(of: "]") {        // [v6]:port
            let rest = a[a.index(after: close)...]
            if rest.hasPrefix(":"), let p = UInt16(rest.dropFirst()) { port = p }
            a = String(a[a.index(after: a.startIndex)..<close])
        } else if a.filter({ $0 == ":" }).count == 1, let i = a.lastIndex(of: ":"), let p = UInt16(a[a.index(after: i)...]) {
            port = p; a = String(a[..<i])
        }
        guard a.range(of: "^[A-Za-z0-9.:%-]{1,253}$", options: .regularExpression) != nil else { return nil }
        // a WebSocket client builds its request from a URL, so the endpoint is one
        let hostPart = a.contains(":") ? "[\(a)]" : a
        guard let url = URL(string: "ws://\(hostPart):\(port)/") else { return nil }
        return .url(url)
    }
}

func roomKey(password: String, room: String, sn: Data, cn: Data) -> SymmetricKey {
    HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: Data(password.utf8)), salt: sn + cn,
                           info: Data(("agent-office room v1 " + room).utf8), outputByteCount: 32)
}
func randomBytes(_ n: Int) -> Data { Data((0..<n).map { _ in UInt8.random(in: 0...255) }) }
func seal(_ obj: [String: Any], _ key: SymmetricKey) -> [String: Any]? {
    guard let d = try? JSONSerialization.data(withJSONObject: obj),
          let box = try? AES.GCM.seal(d, using: key).combined else { return nil }
    return ["t": "box", "d": box.base64EncodedString()]
}
func open(_ msg: [String: Any], _ key: SymmetricKey) -> [String: Any]? {
    guard msg["t"] as? String == "box", let s = msg["d"] as? String, let d = Data(base64Encoded: s),
          let box = try? AES.GCM.SealedBox(combined: d), let plain = try? AES.GCM.open(box, using: key) else { return nil }
    return try? JSONSerialization.jsonObject(with: plain) as? [String: Any]
}
/// The room's connections. TCP keepalive: a peer that vanished without closing (a Mac asleep or off
/// the network) is noticed within about half a minute, on both sides. Without it a member keeps a
/// dead connection and believes it is still in the room, and the host lists a member who is gone.
func wsParameters() -> NWParameters {
    let ws = NWProtocolWebSocket.Options()
    ws.autoReplyPing = true
    ws.maximumMessageSize = ROOM_MAX_FRAME
    let tcp = NWProtocolTCP.Options()
    tcp.enableKeepalive = true; tcp.keepaliveIdle = 15; tcp.keepaliveInterval = 5; tcp.keepaliveCount = 3
    let p = NWParameters(tls: nil, tcp: tcp)
    p.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
    return p
}
func wsSend(_ c: NWConnection, _ obj: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj) else { return }
    let ctx = NWConnection.ContentContext(identifier: "m", metadata: [NWProtocolWebSocket.Metadata(opcode: .text)])
    c.send(content: d, contentContext: ctx, isComplete: true, completion: .contentProcessed { _ in })
}
/// A name as shown to others: no control characters, at most 40 characters.
func cleanName(_ s: String) -> String {
    String(s.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.prefix(40))
        .trimmingCharacters(in: .whitespaces)
}
func cleanText(_ s: String) -> String {
    String(String(s.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) || $0 == "\n" }).prefix(ROOM_MAX_TEXT))
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

// ---------- the host ----------
final class RoomHost {
    final class Peer {
        let conn: NWConnection, ip: String, id = String(UUID().uuidString.prefix(8)).lowercased()
        var sn = Data(), key: SymmetricKey?, name = "", avatar = "", spot = "", badge = "", said: [Date] = [], played: [Date] = [], scored: [Date] = []
        init(_ c: NWConnection, ip: String) { conn = c; self.ip = ip }
        var member: [String: Any] { ["id": id, "name": name, "avatar": avatar, "spot": spot, "badge": badge] }
    }
    let cfg: RoomConfig
    private let q = DispatchQueue(label: "agent-office.room.host")
    private var listener: NWListener?
    private var peers: [String: Peer] = [:]
    private var failures: [String: (n: Int, until: Date)] = [:]
    // who said each recent message, for edit and unsay: the latest ROOM_KEPT_MESSAGES
    private var said: [(mid: String, by: String)] = []
    private let tag = String(UUID().uuidString.prefix(6)).lowercased()   // mids stay unique across host restarts
    private var nextMid = 0
    /// Where this room's leaderboard is kept (one JSON file for every room this Mac hosts, by room
    /// name); nil keeps it in memory only.
    var scoresFile: String? { didSet { loadScores() } }
    private var boards: [String: [[String: Any]]] = [:]
    var onState: ((String) -> Void)?

    init(_ cfg: RoomConfig) { self.cfg = cfg }

    /// Listen on the room's port; if something else holds it, on any free port (members then find
    /// the room by name only).
    func start(anyPort: Bool = false) {
        let port = anyPort ? nil : NWEndpoint.Port(rawValue: cfg.port)
        guard let l = (try? port.map { try NWListener(using: wsParameters(), on: $0) } ?? NWListener(using: wsParameters())) else {
            if !anyPort { start(anyPort: true) } else { onState?("could not open the room") }
            return
        }
        l.service = NWListener.Service(name: cfg.name, type: ROOM_SERVICE)
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.stateUpdateHandler = { [weak self] s in
            guard let self else { return }
            if case .failed(let e) = s {
                l.cancel()
                if !anyPort { self.onState?("port \(self.cfg.port) is taken (\(e)); using any port"); self.q.async { self.start(anyPort: true) } }
                else { self.onState?("room stopped: \(e)") }
            }
            if case .ready = s { self.onState?("hosting on port \(l.port?.rawValue ?? 0)") }
        }
        l.start(queue: q)
        listener = l
        if !watching { watching = true; watchMidnight() }
    }
    func stop() {
        listener?.cancel(); peers.values.forEach { $0.conn.cancel() }; peers = [:]
        q.async { self.listener = nil   // ends watchMidnight
            if self.saving { self.saving = false; self.writeScores() } }   // a score from the last 2 s is not lost
    }

    private func accept(_ c: NWConnection) {
        var ip = "?"
        if case .hostPort(let h, _) = c.endpoint { ip = "\(h)" }
        failures = failures.filter { $0.value.until > Date() || $0.value.n < 3 && $0.value.until == .distantPast }
        if failures.count > 1000 { failures = [:] }                          // never grows without bound
        if let f = failures[ip], f.until > Date() { c.cancel(); return }      // too many wrong passwords
        if peers.count >= ROOM_MAX_MEMBERS { c.cancel(); return }
        let p = Peer(c, ip: ip)
        peers[p.id] = p
        c.stateUpdateHandler = { [weak self] s in
            switch s { case .failed, .cancelled: self?.drop(p); default: break }
        }
        c.start(queue: q)
        p.sn = randomBytes(16)
        wsSend(c, ["t": "hello", "v": 1, "sn": p.sn.base64EncodedString()])
        q.asyncAfter(deadline: .now() + 10) { [weak self] in if p.key == nil { self?.drop(p) } }
        receive(p)
    }
    private func receive(_ p: Peer) {
        p.conn.receiveMessage { [weak self] data, _, _, err in
            guard let self else { return }
            if let data, data.count <= ROOM_MAX_FRAME,
               let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { self.handle(p, msg) }
            if err == nil, self.peers[p.id] != nil { self.receive(p) } else { self.drop(p) }
        }
    }
    private func handle(_ p: Peer, _ msg: [String: Any]) {
        guard let key = p.key else {
            guard msg["t"] as? String == "auth", let cs = msg["cn"] as? String, let cn = Data(base64Encoded: cs), cn.count == 16,
                  let ps = msg["proof"] as? String, let proof = Data(base64Encoded: ps) else { return drop(p) }
            let k = roomKey(password: cfg.password, room: cfg.name, sn: p.sn, cn: cn)
            guard HMAC<SHA256>.isValidAuthenticationCode(proof, authenticating: Data("member".utf8), using: k) else {
                let f = failures[p.ip] ?? (0, .distantPast)
                failures[p.ip] = (f.n + 1, f.n + 1 >= 3 ? Date().addingTimeInterval(600) : .distantPast)
                return drop(p)
            }
            failures[p.ip] = nil
            p.key = k
            let others = peers.values.filter { $0 !== p && $0.key != nil && !$0.name.isEmpty }.map { $0.member }
            _ = rollOver()
            if let box = seal(["t": "welcome", "you": p.id, "members": others, "scores": boards], k) { wsSend(p.conn, box) }
            return
        }
        guard let m = open(msg, key) else { return }
        switch m["t"] as? String {
        case "profile":
            let first = p.name.isEmpty
            p.name = cleanName(m["name"] as? String ?? "")
            if p.name.isEmpty { p.name = "Teammate" }
            let a = m["avatar"] as? String ?? ""
            p.avatar = a.count <= ROOM_MAX_AVATAR && a.hasPrefix("data:image/png;base64,") ? a : ""
            let sp = m["spot"] as? String ?? ""
            p.spot = ROOM_SPOTS.contains(sp) ? sp : ""            // "" = their own routine
            p.badge = String(cleanName(m["badge"] as? String ?? "").prefix(8))   // the mini-games' medal: "🏅 12"
            broadcast(["t": first ? "join" : "profile", "member": p.member])
        case "say":
            let now = Date()
            p.said = p.said.filter { now.timeIntervalSince($0) < 10 } + [now]
            guard p.said.count <= 5, !p.name.isEmpty else { return }          // at most 5 messages in 10 s
            let text = cleanText(m["text"] as? String ?? "")
            guard !text.isEmpty else { return }
            nextMid += 1
            let mid = "\(tag)-\(nextMid)"
            said.append((mid, p.id)); if said.count > ROOM_KEPT_MESSAGES { said.removeFirst() }
            broadcast(["t": "msg", "id": p.id, "mid": mid, "from": p.name, "text": text, "at": now.timeIntervalSince1970])
        case "edit", "unsay":
            // only your own message; counted with chat messages against the rate limit
            let now = Date()
            p.said = p.said.filter { now.timeIntervalSince($0) < 10 } + [now]
            guard p.said.count <= 5, let mid = m["mid"] as? String,
                  let i = said.firstIndex(where: { $0.mid == mid }), said[i].by == p.id else { return }
            if m["t"] as? String == "unsay" {
                said.remove(at: i)
                broadcast(["t": "unsaid", "mid": mid])
            } else {
                let text = cleanText(m["text"] as? String ?? "")
                guard !text.isEmpty else { return }
                broadcast(["t": "edited", "mid": mid, "text": text])
            }
        case "g":
            // only what is passed on counts: a sender a little over the rate loses the excess, not everything
            let now = Date()
            p.played = p.played.filter { now.timeIntervalSince($0) < 2 }
            guard p.played.count < ROOM_GAME_RATE, !p.name.isEmpty, let d = m["d"] as? [String: Any],
                  let raw = try? JSONSerialization.data(withJSONObject: d), raw.count <= ROOM_GAME_BYTES else { return }
            p.played.append(now)
            broadcast(["t": "g", "from": p.id, "name": p.name, "d": d])
        case "score":
            let now = Date()
            p.scored = p.scored.filter { now.timeIntervalSince($0) < 10 }
            guard p.scored.count < ROOM_SCORE_RATE, !p.name.isEmpty, let board = m["board"] as? String, let rule = roomBoardRule(board),
                  let value = (m["value"] as? NSNumber)?.doubleValue, value.isFinite, value >= rule.min, value <= rule.max else { return }
            p.scored.append(now)
            if addScore(board, p.name, value, rule.lowWins) { broadcast(["t": "scores", "boards": boards]) }
        case "act":
            // a hug, a high five… for another member; counted with chat messages against the rate limit
            let now = Date()
            p.said = p.said.filter { now.timeIntervalSince($0) < 10 } + [now]
            guard p.said.count <= 5, !p.name.isEmpty else { return }
            let kind = m["kind"] as? String ?? "", to = m["to"] as? String ?? ""
            guard ROOM_ACTS.contains(kind), to != p.id, let target = peers[to], !target.name.isEmpty else { return }
            broadcast(["t": "act", "from": p.id, "to": to, "kind": kind, "fromName": p.name, "toName": target.name,
                       "at": now.timeIntervalSince1970])
        default: break
        }
    }
    /// Keep `name`'s best on `board` and the board's top ROOM_BOARD_SIZE; true when it changed.
    private func addScore(_ board: String, _ name: String, _ value: Double, _ lowWins: Bool) -> Bool {
        let rolled = rollOver()                            // yesterday's best does not stand in today's way
        var list = boards[board] ?? []
        let better = { (a: Double, b: Double) in lowWins ? a < b : a > b }
        if let i = list.firstIndex(where: { $0["name"] as? String == name }) {
            guard better(value, list[i]["value"] as? Double ?? (lowWins ? .infinity : 0)) else { return false }
            list.remove(at: i)
        }
        list.append(["name": name, "value": (value * 1000).rounded() / 1000, "at": Date().timeIntervalSince1970])
        list.sort { better($0["value"] as? Double ?? 0, $1["value"] as? Double ?? 0) }
        let kept = Array(list.prefix(ROOM_BOARD_SIZE))
        guard kept.contains(where: { $0["name"] as? String == name }) else { return rolled }
        boards[board] = kept
        // daily boards: only the last ROOM_DAILY_KEPT days
        let dailies = boards.keys.filter { $0.hasPrefix("daily-") }.sorted { $0.suffix(10) > $1.suffix(10) }
        let days = Array(Set(dailies.map { String($0.suffix(10)) })).sorted(by: >)
        if days.count > ROOM_DAILY_KEPT { for k in dailies where !days.prefix(ROOM_DAILY_KEPT).contains(String(k.suffix(10))) { boards.removeValue(forKey: k) } }
        saveScores()
        return true
    }
    private func loadScores() {
        guard let f = scoresFile, let d = FileManager.default.contents(atPath: f),
              let all = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let mine = all[cfg.name] as? [String: [[String: Any]]] else { return }
        boards = mine.filter { ROOM_BOARDS[$0.key] != nil || $0.key.hasPrefix("daily-") }
        _ = rollOver()
    }
    /// Drop the room's boards' scores from before today's 00:00 UTC; true when anything went.
    private func rollOver() -> Bool {
        let from = utcMidnight()
        var changed = false
        for key in Array(boards.keys) where ROOM_BOARDS[key] != nil {
            let list = boards[key] ?? [], kept = list.filter { ($0["at"] as? Double ?? 0) >= from }
            guard kept.count != list.count else { continue }
            boards[key] = kept.isEmpty ? nil : kept
            changed = true
        }
        if changed { saveScores() }
        return changed
    }
    /// At 00:00 UTC the members' Scores tabs empty too, without waiting for the day's first score:
    /// a check a minute while the room is up.
    private var watching = false
    private func watchMidnight() {
        q.asyncAfter(deadline: .now() + 60) { [weak self] in
            guard let self, self.listener != nil else { self?.watching = false; return }
            if self.rollOver() { self.broadcast(["t": "scores", "boards": self.boards]) }
            self.watchMidnight()
        }
    }
    /// Written at most every 2 s, the last state wins: a burst of scores is one write.
    private var saving = false
    private func saveScores() {
        guard scoresFile != nil, !saving else { return }
        saving = true
        q.asyncAfter(deadline: .now() + 2) { self.saving = false; self.writeScores() }
    }
    private func writeScores() {
        guard let f = scoresFile else { return }
        var all = (FileManager.default.contents(atPath: f).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }) ?? [:]
        all[cfg.name] = boards
        guard let d = try? JSONSerialization.data(withJSONObject: all, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? FileManager.default.createDirectory(atPath: (f as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try? d.write(to: URL(fileURLWithPath: f), options: .atomic)
    }
    private func broadcast(_ obj: [String: Any]) {
        for peer in peers.values { if let k = peer.key, let box = seal(obj, k) { wsSend(peer.conn, box) } }
    }
    private func drop(_ p: Peer) {
        guard peers.removeValue(forKey: p.id) != nil else { return }
        p.conn.cancel()
        if p.key != nil, !p.name.isEmpty { broadcast(["t": "leave", "id": p.id]) }
    }
}

// ---------- a member (the host is one too) ----------
final class RoomClient {
    struct Message {
        let id: String, mid: String, from: String
        var text: String
        let at: Double
        var edited = false, deleted = false
    }
    struct Act { let seq: Int, from: String, to: String, kind: String, fromName: String, toName: String, at: Double }
    let cfg: RoomConfig
    var profile: () -> (name: String, avatar: String)
    private var spot = ""                                 // the lounge spot this member chose, "" = routine
    var badge = ""                                        // q: the mini-games' medal shown on your character
    func setBadge(_ b: String) { q.async { guard b != self.badge else { return }; self.badge = b; self.sendProfile() } }
    /// Go to a spot in the lounge (one of ROOM_SPOTS), or back to the routine with "".
    func setSpot(_ s: String) {
        q.async { self.spot = ROOM_SPOTS.contains(s) ? s : ""; self.sendProfile() }
    }
    var onChange: (() -> Void)?                          // called on the main queue
    var onPoked: ((_ fromName: String) -> Void)?         // someone poked you; called on the main queue
    var onGame: ((_ msg: [String: Any]) -> Void)?        // a mini-game message {from, name, d}; main queue

    // read on the main queue only
    private(set) var status = "looking"                   // looking | joined | local
    private(set) var detail = ""
    private(set) var you = ""
    private(set) var members: [String: [String: Any]] = [:]
    private(set) var messages: [Message] = []
    private(set) var acts: [Act] = []                     // the latest few, for the page to play
    private(set) var scores: [String: Any] = [:]          // the room's leaderboards, from the host
    private var actSeq = 0
    private(set) var membersVersion = 0
    private(set) var nextTry: Date?

    private let q = DispatchQueue(label: "agent-office.room.member")
    private var browser: NWBrowser?
    private var conn: NWConnection?
    private var key: SymmetricKey?
    private var welcomed = false                          // the host accepted our password
    private var gotHello = false                          // a room answered at all
    private var found = 0                                 // the attempt that found the room
    private var cn = Data()
    private var retry: Timer?
    private var watcher: NWBrowser?                       // q: waits for the room to be announced again
    private var attempt = 0

    init(_ cfg: RoomConfig, profile: @escaping () -> (name: String, avatar: String)) {
        self.cfg = cfg; self.profile = profile
        recent = UserDefaults.standard.dictionary(forKey: "roomRecent." + cfg.name) as? [String: Double] ?? [:]
    }
    // Who was in this room lately, by name, with when they were last seen; kept across restarts.
    // The page lists the ones not here now as reconnecting, for ROOM_AWAY seconds: after a host's
    // restart (an update), the people who were there show up again as they come back.
    private var recent: [String: Double] = [:]
    private var recentSaved = 0.0

    func start() {
        join()
        if cfg.alwaysJoin {
            // a backstop for the schedule in local(): a wrong password is tried again only this often
            retry = Timer.scheduledTimer(withTimeInterval: 15 * 60, repeats: true) { [weak self] _ in
                if self?.status != "joined" { self?.join() }
            }
            // back on a network (Wi-Fi again, a wake from sleep, a VPN coming up): look at once
            let m = NWPathMonitor()
            m.pathUpdateHandler = { [weak self] path in
                guard path.status == .satisfied else { return }
                DispatchQueue.main.async {
                    guard let s = self, !s.stopped, s.status == "local", !s.detail.contains("did not let us in") else { return }
                    s.outSince = Date(); s.quick = ROOM_RETRY_QUICK
                    s.join()
                }
            }
            m.start(queue: q)
            pathMonitor = m
        }
    }
    private var pathMonitor: NWPathMonitor?
    var discover = true                                   // look for the room by name (off: by address only)
    private var stopped = false
    func stop() { stopped = true; retry?.invalidate(); retryGen += 1; onChange = nil; onPoked = nil
        q.async { self.pathMonitor?.cancel(); self.browser?.cancel(); self.watcher?.cancel(); self.watcher = nil; self.conn?.cancel() } }

    /// Look for the room on the network and join it; if it is not there within 8 seconds, stay local.
    func join() {
        guard status != "joined", !stopped else { return }
        retryGen += 1                                     // a look scheduled earlier is this one
        attempt += 1
        let mine = attempt
        set { $0.status = "looking"; $0.detail = "looking for \($0.cfg.name)…" }
        q.async {
            self.browser?.cancel()
            self.watcher?.cancel(); self.watcher = nil
            let b = NWBrowser(for: .bonjour(type: self.discover ? ROOM_SERVICE : "_agent-office-none._tcp", domain: nil), using: .tcp)
            b.browseResultsChangedHandler = { [weak self] results, _ in
                guard let self, self.conn == nil else { return }
                for r in results {
                    if case .service(let name, _, _, _) = r.endpoint, name == self.cfg.name {
                        self.browser?.cancel(); self.browser = nil
                        self.found = mine
                        self.connect(r.endpoint); return
                    }
                }
            }
            b.start(queue: self.q)
            self.browser = b
            // not announced on this network within 3 s: try the address, when there is one
            if let ep = self.cfg.addressEndpoint {
                self.q.asyncAfter(deadline: .now() + 3) {
                    guard self.attempt == mine, self.found != mine, self.conn == nil else { return }
                    self.browser?.cancel(); self.browser = nil
                    self.found = mine
                    self.set { $0.detail = "trying \($0.cfg.address)…" }
                    self.connect(ep)
                }
            }
            self.q.asyncAfter(deadline: .now() + 8) {
                guard self.attempt == mine, self.found != mine, self.conn == nil else { return }
                self.browser?.cancel(); self.browser = nil
                self.local("the room is not on this network" + (self.cfg.address.isEmpty ? "" : " or at \(self.cfg.address)"))
            }
        }
    }
    /// Do something to another member: one of ROOM_ACTS.
    func act(_ kind: String, to id: String) {
        q.async { guard ROOM_ACTS.contains(kind), let c = self.conn, let k = self.key,
                        let box = seal(["t": "act", "kind": kind, "to": id], k) else { return }
            wsSend(c, box) }
    }
    func say(_ text: String) {
        let t = cleanText(text)
        q.async { guard !t.isEmpty, let c = self.conn, let k = self.key, let box = seal(["t": "say", "text": t], k) else { return }
            wsSend(c, box) }
    }
    /// Change or take back one of your own messages (the host refuses anyone else's).
    func edit(_ mid: String, _ text: String) {
        let t = cleanText(text)
        q.async { guard !mid.isEmpty, !t.isEmpty, let c = self.conn, let k = self.key,
                        let box = seal(["t": "edit", "mid": mid, "text": t], k) else { return }
            wsSend(c, box) }
    }
    func unsay(_ mid: String) {
        q.async { guard !mid.isEmpty, let c = self.conn, let k = self.key, let box = seal(["t": "unsay", "mid": mid], k) else { return }
            wsSend(c, box) }
    }
    /// A mini-game message to everyone in the room (the host relays it); dropped while not joined.
    func sendGame(_ d: [String: Any]) {
        q.async { guard let c = self.conn, let k = self.key, let box = seal(["t": "g", "d": d], k) else { return }
            wsSend(c, box) }
    }
    func submitScore(_ board: String, _ value: Double) {
        q.async { guard value.isFinite, roomBoardRule(board) != nil, let c = self.conn, let k = self.key,
                        let box = seal(["t": "score", "board": board, "value": value], k) else { return }
            wsSend(c, box) }
    }
    func sendProfile() {
        q.async { guard let c = self.conn, let k = self.key else { return }
            let p = DispatchQueue.main.sync { self.profile() }
            if let box = seal(["t": "profile", "name": p.name, "avatar": p.avatar, "spot": self.spot, "badge": self.badge], k) { wsSend(c, box) } }
    }

    private func connect(_ endpoint: NWEndpoint) {
        let c = NWConnection(to: endpoint, using: wsParameters())
        conn = c; key = nil; welcomed = false; gotHello = false
        c.stateUpdateHandler = { [weak self] s in
            switch s {
            case .failed, .cancelled: self?.closed()
            default: break
            }
        }
        c.start(queue: q)
        receive(c)
        q.asyncAfter(deadline: .now() + 10) { [weak self] in if self?.conn === c, self?.key == nil { c.cancel() } }
    }
    private func receive(_ c: NWConnection) {
        c.receiveMessage { [weak self] data, _, _, err in
            guard let self, self.conn === c else { return }
            if let data, data.count <= ROOM_MAX_FRAME,
               let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { self.handle(c, msg) }
            if err == nil { self.receive(c) } else { c.cancel() }
        }
    }
    private func handle(_ c: NWConnection, _ msg: [String: Any]) {
        if key == nil {
            guard msg["t"] as? String == "hello", let ss = msg["sn"] as? String, let sn = Data(base64Encoded: ss), sn.count == 16 else { return }
            gotHello = true
            cn = randomBytes(16)
            let k = roomKey(password: cfg.password, room: cfg.name, sn: sn, cn: cn)
            let proof = Data(HMAC<SHA256>.authenticationCode(for: Data("member".utf8), using: k))
            wsSend(c, ["t": "auth", "cn": cn.base64EncodedString(), "proof": proof.base64EncodedString()])
            key = k
            return
        }
        guard let m = open(msg, key!) else { return }
        switch m["t"] as? String {
        case "welcome":
            welcomed = true
            let list = (m["members"] as? [[String: Any]]) ?? []
            set {
                $0.status = "joined"; $0.detail = ""; $0.quick = []; $0.outSince = nil; $0.nextTry = nil; $0.you = m["you"] as? String ?? ""
                $0.members = Dictionary(list.compactMap { x in (x["id"] as? String).map { ($0, x) } }, uniquingKeysWith: { a, _ in a })
                $0.membersVersion += 1
                if let sc = m["scores"] as? [String: Any] { $0.scores = sc }
            }
            sendProfile()
        case "join", "profile":
            if let x = m["member"] as? [String: Any], let id = x["id"] as? String {
                set { $0.members[id] = x; $0.membersVersion += 1 }
            }
        case "leave":
            if let id = m["id"] as? String { set { $0.members[id] = nil; $0.membersVersion += 1 } }
        case "act":
            if let from = m["from"] as? String, let to = m["to"] as? String, let kind = m["kind"] as? String, ROOM_ACTS.contains(kind) {
                let fn = cleanName(m["fromName"] as? String ?? ""), tn = cleanName(m["toName"] as? String ?? "")
                let at = m["at"] as? Double ?? Date().timeIntervalSince1970
                set { $0.actSeq += 1; $0.acts.append(Act(seq: $0.actSeq, from: from, to: to, kind: kind, fromName: fn, toName: tn, at: at))
                      if $0.acts.count > 10 { $0.acts.removeFirst() }
                      if kind == "poke", to == $0.you, from != $0.you { $0.onPoked?(fn.isEmpty ? "Someone" : fn) } }
            }
        case "msg":
            if let id = m["id"] as? String, let from = m["from"] as? String, let text = m["text"] as? String {
                let at = m["at"] as? Double ?? Date().timeIntervalSince1970
                let mid = m["mid"] as? String ?? ""                   // "" from a host without edit and unsay
                set { $0.messages.append(Message(id: id, mid: mid, from: from, text: text, at: at))
                      if $0.messages.count > ROOM_KEPT_MESSAGES { $0.messages.removeFirst() } }
            }
        case "g":
            if let from = m["from"] as? String, let d = m["d"] as? [String: Any] {
                let name = cleanName(m["name"] as? String ?? "")
                DispatchQueue.main.async { self.onGame?(["from": from, "name": name, "d": d]) }
            }
        case "scores":
            if let b = m["boards"] as? [String: Any] { set { $0.scores = b } }
        case "edited":
            if let mid = m["mid"] as? String, !mid.isEmpty, let text = m["text"] as? String {
                set { if let i = $0.messages.firstIndex(where: { $0.mid == mid && !$0.deleted }) { $0.messages[i].text = text; $0.messages[i].edited = true } }
            }
        case "unsaid":
            // kept as a "deleted" line, so the page's count of what you have read stays right
            if let mid = m["mid"] as? String, !mid.isEmpty {
                set { if let i = $0.messages.firstIndex(where: { $0.mid == mid }) { $0.messages[i].text = ""; $0.messages[i].deleted = true } }
            }
        default: break
        }
    }
    private func closed() {
        guard conn != nil else { return }
        let wasIn = welcomed, answered = gotHello
        conn = nil; key = nil; welcomed = false; gotHello = false
        local(wasIn ? "lost the room" : answered ? "the room did not let us in (wrong password?)"
              : "could not reach the room" + (cfg.address.isEmpty ? "" : " at \(cfg.address)"), lost: wasIn)
    }
    /// Out of the room: lost (usually the host restarting its app for an update, which takes a minute
    /// or two, or its Mac) or not there when this app started (the host may be updating at the same
    /// moment). Either way the next looks come quickly, then once a minute, then every few minutes,
    /// for as long as the app runs (ROOM_RETRY_*). And while out, the room's Bonjour announcement is
    /// watched: a host that comes back announces the room again, and that is the "join me again" a
    /// host could not otherwise send (it does not know where its members are, and members take no
    /// incoming connections). A wrong password stays wrong: no quick looks and no watch for it.
    private func local(_ why: String, lost: Bool = false) {
        set {
            $0.status = "local"; $0.detail = why; $0.members = [:]; $0.membersVersion += 1
            if lost || $0.outSince == nil { $0.outSince = Date(); $0.quick = ROOM_RETRY_QUICK }
            guard $0.cfg.alwaysJoin, !$0.stopped else { $0.nextTry = nil; return }
            if why.contains("did not let us in") { $0.nextTry = Date().addingTimeInterval(15 * 60); return }
            let out = Date().timeIntervalSince($0.outSince ?? Date())
            let d = !$0.quick.isEmpty ? $0.quick.removeFirst() : out < ROOM_RETRY_MINUTE_FOR ? 60 : ROOM_RETRY_SLOW
            $0.nextTry = Date().addingTimeInterval(d)
            let gen = $0.retryGen
            DispatchQueue.main.asyncAfter(deadline: .now() + d) { [weak self] in
                if let s = self, s.retryGen == gen, s.status == "local" { s.join() }
            }
            $0.watch()
        }
    }
    /// Join the moment the room is announced on this network. Bonjour can still list a room that just
    /// went away (or never call at all while nothing is announced), so any sight of it counts, added
    /// or changed, at most one join every few seconds; a stale record only costs one failed look.
    private func watch() {
        guard cfg.alwaysJoin, discover, !stopped else { return }
        q.async {
            guard self.watcher == nil else { return }
            let b = NWBrowser(for: .bonjour(type: ROOM_SERVICE, domain: nil), using: .tcp)
            b.browseResultsChangedHandler = { [weak self] _, changes in
                guard let self else { return }
                for c in changes {
                    var r: NWBrowser.Result?
                    if case .added(let x) = c { r = x }
                    if case .changed(_, let x, _) = c { r = x }
                    guard let r, case .service(let name, _, _, _) = r.endpoint, name == self.cfg.name else { continue }
                    DispatchQueue.main.async {
                        guard self.status == "local", Date().timeIntervalSince(self.watchJoined) > 4 else { return }
                        self.watchJoined = Date()
                        self.join()
                    }
                    return
                }
            }
            b.start(queue: self.q)
            self.watcher = b
        }
    }
    private var watchJoined = Date.distantPast            // main queue: the last join the watch started
    private var outSince: Date?                           // main queue: out of the room since (nil: in it)
    private var retryGen = 0                              // main queue: a scheduled look is for this join
    private var quick: [TimeInterval] = []                // main queue: the quick looks still to come
    private func set(_ f: @escaping (RoomClient) -> Void) {
        DispatchQueue.main.async { f(self); self.onChange?() }
    }

    /// What the page needs; `withMembers` adds the members' pictures, sent only when they change.
    func json(withMembers: Bool) -> [String: Any] {
        let now = Date().timeIntervalSince1970
        let here = Set(members.compactMap { $0.key == you ? nil : ($0.value["name"] as? String) }.filter { !$0.isEmpty })
        if status == "joined" { for n in here { recent[n] = now } }
        recent = recent.filter { now - $0.value < ROOM_AWAY }
        if now - recentSaved > 60 || recent.count != (UserDefaults.standard.dictionary(forKey: "roomRecent." + cfg.name)?.count ?? 0) {
            UserDefaults.standard.set(recent, forKey: "roomRecent." + cfg.name); recentSaved = now
        }
        let away = recent.filter { !here.contains($0.key) }.sorted { $0.key < $1.key }.map { ["name": $0.key, "at": $0.value] }
        var o: [String: Any] = ["status": status, "detail": detail, "name": cfg.name, "you": you, "host": cfg.host,
                                "alwaysJoin": cfg.alwaysJoin, "nextTry": nextTry?.timeIntervalSince1970 ?? 0,
                                "count": members.count, "away": away, "scores": scores,
                                "messages": messages.map { ["id": $0.id, "mid": $0.mid, "from": $0.from, "text": $0.text, "at": $0.at,
                                                              "edited": $0.edited, "deleted": $0.deleted] },
                                "acts": acts.map { ["seq": $0.seq, "from": $0.from, "to": $0.to, "kind": $0.kind,
                                                    "fromName": $0.fromName, "toName": $0.toName, "at": $0.at] }]
        if withMembers { o["members"] = Array(members.values) }
        return o
    }
}
