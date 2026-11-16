// A shared room on the local network: everyone who knows the room's name and password sees each
// other's character in the lounge and can chat. One Agent Office hosts it (room.host = true); it
// advertises the room by name with Bonjour, so members need only the name and the password.
//
// What crosses the network: each member's name, a small picture, and chat messages. Nothing about
// anyone's sessions. Messages are relayed by the host and kept only in each app's memory.
//
// Wire format: one JSON object per WebSocket text message.
//   host → member, plain:  {t:"hello", v:1, sn}                  sn: 16 random bytes, base64
//   member → host, plain:  {t:"auth", cn, proof}                 cn: 16 random bytes, base64
//   then, both ways:       {t:"box", d}  d = AES-GCM(K, json), base64 of nonce|ciphertext|tag
// K = HKDF-SHA256(password, salt: sn|cn, info: "agent-office room v1 " + room name), 32 bytes, and
// proof = HMAC-SHA256(K, "member"). The password never travels; a host that does not know it
// cannot read anything, and nor can anyone else on the network.
//   inside a box, member → host:  {t:"profile", name, avatar}  {t:"say", text}
//   inside a box, host → member:  {t:"welcome", you, members}  {t:"join"|"profile", member}
//                                 {t:"leave", id}  {t:"msg", id, from, text, at}

import Foundation
import Network
import CryptoKit

let ROOM_SERVICE = "_agent-office._tcp"
let ROOM_MAX_FRAME = 200_000          // bytes, any message
let ROOM_MAX_AVATAR = 120_000         // bytes of data URL
let ROOM_MAX_TEXT = 500               // characters per chat message
let ROOM_MAX_MEMBERS = 40

struct RoomConfig: Equatable {
    var name = ""
    var password = ""
    var host = false
    var alwaysJoin = true
    var enabled: Bool { !name.isEmpty && !password.isEmpty }
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
func wsParameters() -> NWParameters {
    let ws = NWProtocolWebSocket.Options()
    ws.autoReplyPing = true
    ws.maximumMessageSize = ROOM_MAX_FRAME
    let p = NWParameters.tcp
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
        var sn = Data(), key: SymmetricKey?, name = "", avatar = "", said: [Date] = []
        init(_ c: NWConnection, ip: String) { conn = c; self.ip = ip }
        var member: [String: Any] { ["id": id, "name": name, "avatar": avatar] }
    }
    let cfg: RoomConfig
    private let q = DispatchQueue(label: "agent-office.room.host")
    private var listener: NWListener?
    private var peers: [String: Peer] = [:]
    private var failures: [String: (n: Int, until: Date)] = [:]
    var onState: ((String) -> Void)?

    init(_ cfg: RoomConfig) { self.cfg = cfg }

    func start() {
        guard let l = try? NWListener(using: wsParameters()) else { onState?("could not open the room"); return }
        l.service = NWListener.Service(name: cfg.name, type: ROOM_SERVICE)
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.stateUpdateHandler = { [weak self] s in
            if case .failed(let e) = s { self?.onState?("room stopped: \(e)") }
            if case .ready = s { self?.onState?("hosting") }
        }
        l.start(queue: q)
        listener = l
    }
    func stop() { listener?.cancel(); peers.values.forEach { $0.conn.cancel() }; peers = [:] }

    private func accept(_ c: NWConnection) {
        var ip = "?"
        if case .hostPort(let h, _) = c.endpoint { ip = "\(h)" }
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
            if let box = seal(["t": "welcome", "you": p.id, "members": others], k) { wsSend(p.conn, box) }
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
            broadcast(["t": first ? "join" : "profile", "member": p.member])
        case "say":
            let now = Date()
            p.said = p.said.filter { now.timeIntervalSince($0) < 10 } + [now]
            guard p.said.count <= 5, !p.name.isEmpty else { return }          // at most 5 messages in 10 s
            let text = cleanText(m["text"] as? String ?? "")
            guard !text.isEmpty else { return }
            broadcast(["t": "msg", "id": p.id, "from": p.name, "text": text, "at": now.timeIntervalSince1970])
        default: break
        }
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
    struct Message { let id: String, from: String, text: String, at: Double }
    let cfg: RoomConfig
    var profile: () -> (name: String, avatar: String)
    var onChange: (() -> Void)?                          // called on the main queue

    // read on the main queue only
    private(set) var status = "looking"                   // looking | joined | local
    private(set) var detail = ""
    private(set) var you = ""
    private(set) var members: [String: [String: Any]] = [:]
    private(set) var messages: [Message] = []
    private(set) var membersVersion = 0
    private(set) var nextTry: Date?

    private let q = DispatchQueue(label: "agent-office.room.member")
    private var browser: NWBrowser?
    private var conn: NWConnection?
    private var key: SymmetricKey?
    private var welcomed = false                          // the host accepted our password
    private var found = 0                                 // the attempt that found the room
    private var cn = Data()
    private var retry: Timer?
    private var attempt = 0

    init(_ cfg: RoomConfig, profile: @escaping () -> (name: String, avatar: String)) { self.cfg = cfg; self.profile = profile }

    func start() {
        join()
        if cfg.alwaysJoin {
            retry = Timer.scheduledTimer(withTimeInterval: 15 * 60, repeats: true) { [weak self] _ in
                if self?.status != "joined" { self?.join() }
            }
        }
    }
    func stop() { retry?.invalidate(); onChange = nil; q.async { self.browser?.cancel(); self.conn?.cancel() } }

    /// Look for the room on the network and join it; if it is not there within 8 seconds, stay local.
    func join() {
        guard status != "joined" else { return }
        attempt += 1
        let mine = attempt
        set { $0.status = "looking"; $0.detail = "looking for \($0.cfg.name)…" }
        q.async {
            self.browser?.cancel()
            let b = NWBrowser(for: .bonjour(type: ROOM_SERVICE, domain: nil), using: .tcp)
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
            self.q.asyncAfter(deadline: .now() + 8) {
                guard self.attempt == mine, self.found != mine, self.conn == nil else { return }
                self.browser?.cancel(); self.browser = nil
                self.local("the room is not on this network")
            }
        }
    }
    func say(_ text: String) {
        let t = cleanText(text)
        q.async { guard !t.isEmpty, let c = self.conn, let k = self.key, let box = seal(["t": "say", "text": t], k) else { return }
            wsSend(c, box) }
    }
    func sendProfile() {
        q.async { guard let c = self.conn, let k = self.key else { return }
            let p = DispatchQueue.main.sync { self.profile() }
            if let box = seal(["t": "profile", "name": p.name, "avatar": p.avatar], k) { wsSend(c, box) } }
    }

    private func connect(_ endpoint: NWEndpoint) {
        let c = NWConnection(to: endpoint, using: wsParameters())
        conn = c; key = nil; welcomed = false
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
                $0.status = "joined"; $0.detail = ""; $0.you = m["you"] as? String ?? ""
                $0.members = Dictionary(list.compactMap { x in (x["id"] as? String).map { ($0, x) } }, uniquingKeysWith: { a, _ in a })
                $0.membersVersion += 1
            }
            sendProfile()
        case "join", "profile":
            if let x = m["member"] as? [String: Any], let id = x["id"] as? String {
                set { $0.members[id] = x; $0.membersVersion += 1 }
            }
        case "leave":
            if let id = m["id"] as? String { set { $0.members[id] = nil; $0.membersVersion += 1 } }
        case "msg":
            if let id = m["id"] as? String, let from = m["from"] as? String, let text = m["text"] as? String {
                let at = m["at"] as? Double ?? Date().timeIntervalSince1970
                set { $0.messages.append(Message(id: id, from: from, text: text, at: at)); if $0.messages.count > 300 { $0.messages.removeFirst() } }
            }
        default: break
        }
    }
    private func closed() {
        guard conn != nil else { return }
        let wasIn = welcomed
        conn = nil; key = nil; welcomed = false
        local(wasIn ? "lost the room" : "the room did not let us in (wrong password?)")
    }
    private func local(_ why: String) {
        set {
            $0.status = "local"; $0.detail = why; $0.members = [:]; $0.membersVersion += 1
            $0.nextTry = $0.cfg.alwaysJoin ? Date().addingTimeInterval(15 * 60) : nil
        }
    }
    private func set(_ f: @escaping (RoomClient) -> Void) {
        DispatchQueue.main.async { f(self); self.onChange?() }
    }

    /// What the page needs; `withMembers` adds the members' pictures, sent only when they change.
    func json(withMembers: Bool) -> [String: Any] {
        var o: [String: Any] = ["status": status, "detail": detail, "name": cfg.name, "you": you, "host": cfg.host,
                                "alwaysJoin": cfg.alwaysJoin, "nextTry": nextTry?.timeIntervalSince1970 ?? 0,
                                "count": members.count,
                                "messages": messages.map { ["id": $0.id, "from": $0.from, "text": $0.text, "at": $0.at] }]
        if withMembers { o["members"] = Array(members.values) }
        return o
    }
}
