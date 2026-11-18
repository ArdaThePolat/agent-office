// Creating, joining and leaving a shared room from the app, and being poked.
//
// Create and Join ask for the room's name and password in a native dialog and write them to the
// "room" block of ~/.config/agent-office/config.json (the file is kept readable only by you); the
// app picks the change up at once, like an edit made by hand. A saved room stays until it is
// changed or deleted: every launch joins (or hosts) it again. Leave sets "enabled": false and
// keeps the name and password, so Join can fill them in again; Settings → Delete Saved Room
// removes the whole block.
//
// Both dialogs show the room this Mac has saved (name, password, and the host's address) with Copy
// Room Info, which puts it on the clipboard as env-file lines; Join's Paste Room Info fills the
// fields from such lines, so a host can hand the room over in one paste.
//
// A poke arrives as a notification and a short shake of the window. Pokes from the same person
// are shown at most once in POKE_QUIET seconds, so nobody can bury anyone in notifications.

import Cocoa
import UserNotifications

let POKE_QUIET: TimeInterval = 20

extension AppDelegate: UNUserNotificationCenterDelegate {
    // ---- create / join / leave ----
    @objc func createRoom() { roomDialog(create: true) }
    @objc func joinRoom() { roomDialog(create: false) }
    @objc func leaveRoom() {
        let r = Config.load().room
        guard r.enabled else { return }
        let a = NSAlert()
        a.messageText = "Leave \(r.name)?"
        a.informativeText = r.host
            ? "You host this room: leaving closes it for everyone until you join or create it again."
            : "Your lounge goes back to being only yours. The name and password are kept, so Join a Room fills them in."
        a.addButton(withTitle: "Leave"); a.addButton(withTitle: "Cancel")
        guard a.runModal() == .alertFirstButtonReturn else { return }
        saveRoom(["enabled": false])
    }

    func roomDialog(create: Bool) {
        let cfg = Config.load(), cur = cfg.room
        let a = NSAlert()
        a.messageText = create ? "Create a room" : "Join a room"
        a.informativeText = create
            ? "Your Mac hosts the room while Agent Office is open. Teammates on the same network join it with its name and password."
            : "Ask the person who hosts the room for its name and password, or for its room info to paste."
        let w: CGFloat = 240                              // the width of the alert's text column
        func field(_ placeholder: String, _ value: String, secure: Bool = false) -> NSTextField {
            let f = secure ? NSSecureTextField(frame: NSRect(x: 0, y: 0, width: w, height: 24)) : NSTextField(frame: NSRect(x: 0, y: 0, width: w, height: 24))
            f.placeholderString = placeholder; f.stringValue = value
            return f
        }
        func caption(_ s: String, bold: Bool = false) -> NSTextField {
            let l = NSTextField(labelWithString: s); l.font = bold ? .boldSystemFont(ofSize: 11) : .systemFont(ofSize: 11)
            l.textColor = bold ? .labelColor : .secondaryLabelColor; return l
        }
        let name = field("e.g. team lounge", create && cur.host == false ? "" : cur.name)
        let pass = field(create ? "at least 8 characters" : "", create ? "" : cur.password, secure: true)
        let addr = field("optional, e.g. their-mac.local", cur.host ? "" : cur.address)
        // (view, height): fields 28, captions 18, buttons 30, the current room's lines 15 each
        var rows: [(NSView, CGFloat)] = []
        if !cur.name.isEmpty {
            // the room this Mac has saved, as the lines Copy Room Info puts on the clipboard
            let state = cfg.roomOff ? "Saved room (left)" : cur.host ? "Current room (you host it)" : "Current room"
            rows.append((caption(state, bold: true), 18))
            let info = NSTextField(labelWithString: roomInfo(cur).map { "\($0.0)  \($0.1)" }.joined(separator: "\n"))
            info.font = .monospacedSystemFont(ofSize: 10, weight: .regular); info.isSelectable = true
            info.lineBreakMode = .byTruncatingTail; info.maximumNumberOfLines = 3
            rows.append((info, 45))
            let copy = ActionButton(title: "Copy Room Info") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(self.roomInfo(cur).map { "\($0.2)=\($0.1)" }.joined(separator: "\n") + "\n", forType: .string)
            }
            rows.append((copy, 30))
        }
        if !create {
            let paste = ActionButton(title: "Paste Room Info") {
                let found = Self.parseRoomInfo(NSPasteboard.general.string(forType: .string) ?? "")
                if let v = found["name"] { name.stringValue = v }
                if let v = found["password"] { pass.stringValue = v }
                if let v = found["address"] { addr.stringValue = v }
                if found.isEmpty {
                    let e = NSAlert(); e.messageText = "No room info on the clipboard"
                    e.informativeText = "Copy the lines the host's Copy Room Info gives, e.g.\nAGENT_OFFICE_ROOM_NAME=team lounge\nAGENT_OFFICE_ROOM_PASSWORD=…\nAGENT_OFFICE_ROOM_ADDRESS=their-mac.local"
                    e.runModal()
                }
            }
            rows.append((paste, 30))
        }
        rows += [(caption("Room name"), 18), (name, 28), (caption("Password"), 18), (pass, 28)]
        if !create { rows += [(caption("Host address, if not found by name"), 18), (addr, 28)] }
        // fixed frames, top to bottom, inside the alert's column: a stack view's fitting size runs
        // past it, and NSAlert does not widen itself
        let h = rows.reduce(CGFloat(0)) { $0 + $1.1 }
        let box = NSView(frame: NSRect(x: 0, y: 0, width: w, height: h))
        var y = h
        for (r, rh) in rows {
            y -= rh
            switch rh {
            case 28: r.frame = NSRect(x: 0, y: y + 4, width: w, height: 24)                 // a field
            case 30: r.frame = NSRect(x: -1, y: y + 2, width: w + 2, height: 28)            // a button, its bezel inset
            default: r.frame = NSRect(x: 1, y: y, width: w - 1, height: rh - 2)             // a caption or text
            }
            box.addSubview(r)
        }
        a.accessoryView = box
        a.addButton(withTitle: create ? "Create" : "Join"); a.addButton(withTitle: "Cancel")
        a.window.initialFirstResponder = name.stringValue.isEmpty ? name : pass
        NSApp.activate(ignoringOtherApps: true)
        guard a.runModal() == .alertFirstButtonReturn else { return }

        let n = name.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let p = pass.stringValue
        let problem = n.isEmpty ? "The room needs a name."
            : n.count > 40 ? "Keep the room's name to 40 characters."
            : p.isEmpty ? "The room needs its password."
            : create && p.count < 8 ? "Use a password of at least 8 characters: it is the only thing that keeps the room yours."
            : !create && !addr.stringValue.isEmpty && RoomConfig(address: addr.stringValue).addressEndpoint == nil ? "That host address is not a name or an IP address."
            : nil
        if let problem {
            let e = NSAlert(); e.messageText = "Not saved"; e.informativeText = problem; e.runModal()
            return roomDialog(create: create)
        }
        var block: [String: Any] = ["name": n, "password": p, "host": create, "enabled": true, "alwaysJoin": true]
        block["address"] = create ? "" : addr.stringValue.trimmingCharacters(in: .whitespaces)
        guard saveRoom(block) else { return }
        roomSharing = true
        if create {
            let i = NSAlert(); i.messageText = "\(n) is open"
            i.informativeText = "Teammates choose Room → Join a Room… (or the Join button in the lounge) and type the name and the password, or paste the room info: Room → Create a Room… shows it, with Copy Room Info. Tell them the password in person or over a private channel.\n\nIf the room is not found by name on their network, they can add your Mac's address: \(Self.localHostName)"
            i.runModal()
        }
    }

    /// This Mac's name on the local network, the address teammates use when a name lookup fails.
    static var localHostName: String { (ProcessInfo.processInfo.hostName as NSString).deletingPathExtension + ".local" }

    /// A room as (label, value, env key) lines: what the dialog shows and Copy Room Info copies.
    /// The address is this Mac's name when it hosts, else the saved one (left out when empty).
    func roomInfo(_ r: RoomConfig) -> [(String, String, String)] {
        var lines = [("name    ", r.name, "AGENT_OFFICE_ROOM_NAME"), ("password", r.password, "AGENT_OFFICE_ROOM_PASSWORD")]
        let address = r.host ? Self.localHostName : r.address
        if !address.isEmpty { lines.append(("host    ", address, "AGENT_OFFICE_ROOM_ADDRESS")) }
        return lines
    }

    /// Room fields from pasted KEY=VALUE lines (env-file style: `export`, quotes and `#` comments
    /// allowed). AGENT_OFFICE_ROOM_NAME, _PASSWORD and _ADDRESS, also without the AGENT_OFFICE_
    /// prefix; other lines are ignored.
    static func parseRoomInfo(_ text: String) -> [String: String] {
        var out: [String: String] = [:]
        for line in text.components(separatedBy: .newlines) {
            let l = line.trimmingCharacters(in: .whitespaces)
            guard !l.hasPrefix("#"), let eq = l.firstIndex(of: "=") else { continue }
            var k = String(l[..<eq]).trimmingCharacters(in: .whitespaces).uppercased()
            if k.hasPrefix("EXPORT ") { k = String(k.dropFirst(7)).trimmingCharacters(in: .whitespaces) }
            if k.hasPrefix("AGENT_OFFICE_") { k = String(k.dropFirst(13)) }
            guard let field = ["ROOM_NAME": "name", "ROOM_PASSWORD": "password", "ROOM_ADDRESS": "address"][k] else { continue }
            var v = String(l[l.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
            if v.count >= 2, (v.hasPrefix("\"") && v.hasSuffix("\"")) || (v.hasPrefix("'") && v.hasSuffix("'")) { v = String(v.dropFirst().dropLast()) }
            if !v.isEmpty { out[field] = v }
        }
        return out
    }

    /// Change config.json through `edit`, keeping every other key; mode 0600. False (after saying
    /// why) when it could not be read or written.
    func writeConfig(_ edit: (inout [String: Any]) -> Void) -> Bool {
        let dir = home + "/.config/agent-office", path = dir + "/config.json"
        var j: [String: Any] = [:]
        if let d = FileManager.default.contents(atPath: path) {
            guard let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else {
                let e = NSAlert(); e.messageText = "Could not read config.json"
                e.informativeText = "\(path) is not valid JSON, so it was left as it is. Fix it, then try again."
                e.runModal(); return false
            }
            j = o
        }
        edit(&j)
        do {
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            let d = try JSONSerialization.data(withJSONObject: j, options: [.prettyPrinted, .sortedKeys])
            try d.write(to: URL(fileURLWithPath: path), options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
        } catch {
            let e = NSAlert(); e.messageText = "Could not save config.json"; e.informativeText = error.localizedDescription
            e.runModal(); return false
        }
        return true
    }

    /// Merge `fields` into config.json's "room" block (or remove the block, `forget`).
    @discardableResult
    func saveRoom(_ fields: [String: Any], forget: Bool = false) -> Bool {
        guard writeConfig({ j in
            if forget { j.removeValue(forKey: "room") } else {
                var room = j["room"] as? [String: Any] ?? [:]
                for (k, v) in fields { if let s = v as? String, s.isEmpty { room.removeValue(forKey: k) } else { room[k] = v } }
                j["room"] = room
            }
        }) else { return false }
        // the env file and the environment win over config.json: say so rather than look broken
        let env = Config.env().keys.filter { ["AGENT_OFFICE_ROOM_NAME", "AGENT_OFFICE_ROOM_PASSWORD", "AGENT_OFFICE_ROOM_HOST",
                                              "AGENT_OFFICE_ROOM_ENABLED", "AGENT_OFFICE_ROOM_ADDRESS"].contains($0) }
        if !env.isEmpty {
            let e = NSAlert(); e.messageText = forget ? "Deleted, but your env file still sets a room" : "Saved, but your env file decides"
            e.informativeText = "~/.config/agent-office/env sets \(env.sorted().joined(separator: ", ")), which wins over config.json. Settings → Import from env file… moves them here, so this change takes effect."
            e.runModal()
        }
        syncRoom()
        refreshSettingsRoom()
        return true
    }

    /// Settings → Delete Saved Room: the whole "room" block goes, name and password included.
    @objc func deleteSavedRoom() {
        let r = Config.load().room
        let a = NSAlert()
        guard !r.name.isEmpty || !r.password.isEmpty else {
            a.messageText = "No saved room"; a.informativeText = "Create or join a room from the lounge or the Room menu."
            a.runModal(); return
        }
        a.messageText = "Delete the saved room \(r.name)?"
        a.informativeText = (r.host ? "You host it: it closes for everyone. " : "")
            + "Its name and password are removed from this Mac. To come back, create or join it again with the password."
        a.addButton(withTitle: "Delete"); a.addButton(withTitle: "Cancel")
        a.buttons[0].hasDestructiveAction = true
        guard a.runModal() == .alertFirstButtonReturn else { return }
        saveRoom([:], forget: true)
    }

    /// Settings → Import from env file: the room and manager lines of ~/.config/agent-office/env
    /// move into config.json, where the room buttons and Delete Saved Room can change them. The
    /// env file wins over config.json, so the lines are taken out of it (a copy stays in env.bak);
    /// left in, they would undo every later change made from the app.
    @objc func importFromEnv() { importEnv(ask: true) }

    /// The first launch of a version that has this does the same without asking, once: a setup
    /// made with the env file becomes editable from the app with nothing to click. After that the
    /// person's own edits stand, and only the Settings button imports again.
    func importEnvOnce() {
        guard !defaults.bool(forKey: "envImported") else { return }
        if importEnv(ask: false) { defaults.set(true, forKey: "envImported") }
    }

    /// Replace the env file's lines with `lines`, keeping the old file as env.bak; both mode 0600.
    func rewriteEnv(_ lines: [String]) throws {
        let path = home + "/.config/agent-office/env", bak = path + ".bak"
        try? FileManager.default.removeItem(atPath: bak)
        try FileManager.default.copyItem(atPath: path, toPath: bak)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: bak)
        try lines.joined(separator: "\n").write(toFile: path, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
    }

    /// Take `keys` out of the env file (comments and every other line stay; a copy is kept in
    /// env.bak), so config.json decides them. False when the file could not be rewritten.
    func dropEnvKeys(_ keys: Set<String>) -> Bool {
        let path = home + "/.config/agent-office/env"
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return true }
        var dropped = false
        let kept = text.components(separatedBy: "\n").filter { line in
            let l = line.trimmingCharacters(in: .whitespaces)
            guard !l.hasPrefix("#"), let eq = l.firstIndex(of: "=") else { return true }
            var k = String(l[..<eq]).trimmingCharacters(in: .whitespaces)
            if k.hasPrefix("export ") { k = String(k.dropFirst(7)).trimmingCharacters(in: .whitespaces) }
            if keys.contains(k) { dropped = true; return false }
            return true
        }
        guard dropped else { return true }
        return (try? rewriteEnv(kept)) != nil
    }

    /// True when there was nothing to import or config.json now holds it.
    @discardableResult
    func importEnv(ask: Bool) -> Bool {
        let path = home + "/.config/agent-office/env"
        let keys: [String: (String, String)] = [          // env key → (config block, field)
            "AGENT_OFFICE_ROOM_NAME": ("room", "name"), "AGENT_OFFICE_ROOM_PASSWORD": ("room", "password"),
            "AGENT_OFFICE_ROOM_HOST": ("room", "host"), "AGENT_OFFICE_ROOM_ALWAYS_JOIN": ("room", "alwaysJoin"),
            "AGENT_OFFICE_ROOM_ENABLED": ("room", "enabled"), "AGENT_OFFICE_ROOM_ADDRESS": ("room", "address"),
            "AGENT_OFFICE_ROOM_PORT": ("room", "port"),
            "AGENT_OFFICE_MANAGER_NAME": ("manager", "name"), "AGENT_OFFICE_MANAGER_IMAGE": ("manager", "image"),
        ]
        let text = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
        var found: [(key: String, value: String)] = [], kept: [String] = []
        for line in text.components(separatedBy: "\n") {
            let l = line.trimmingCharacters(in: .whitespaces)
            if !l.hasPrefix("#"), let eq = l.firstIndex(of: "=") {
                var k = String(l[..<eq]).trimmingCharacters(in: .whitespaces)
                if k.hasPrefix("export ") { k = String(k.dropFirst(7)).trimmingCharacters(in: .whitespaces) }
                if keys[k] != nil {
                    var v = String(l[l.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
                    if v.count >= 2, (v.hasPrefix("\"") && v.hasSuffix("\"")) || (v.hasPrefix("'") && v.hasSuffix("'")) { v = String(v.dropFirst().dropLast()) }
                    found.append((k, v)); continue
                }
            }
            kept.append(line)
        }
        let a = NSAlert()
        guard !found.isEmpty else {
            guard ask else { return true }
            a.messageText = "Nothing to import"
            a.informativeText = "~/.config/agent-office/env has no room or manager settings (AGENT_OFFICE_ROOM_…, AGENT_OFFICE_MANAGER_…)."
            a.runModal(); return true
        }
        if ask {
            let list = found.map { "\($0.key) = \($0.key == "AGENT_OFFICE_ROOM_PASSWORD" ? "(\($0.value.count) characters)" : $0.value)" }
            a.messageText = "Import \(found.count) setting\(found.count == 1 ? "" : "s") from the env file?"
            a.informativeText = list.joined(separator: "\n")
                + "\n\nThey move to config.json, so the Room menu and Settings can change them, and are taken out of the env file (a copy is kept in env.bak)."
            a.addButton(withTitle: "Import"); a.addButton(withTitle: "Cancel")
            guard a.runModal() == .alertFirstButtonReturn else { return false }
        }

        var room: [String: Any] = [:], manager: [String: Any] = [:]
        let yes = { (v: String) in ["1", "true", "yes"].contains(v.lowercased()) }
        let no = { (v: String) in ["0", "false", "no"].contains(v.lowercased()) }
        for (k, v) in found {
            let (block, field) = keys[k]!
            var val: Any = v
            switch field {
            case "host": val = yes(v)
            case "alwaysJoin", "enabled": val = !no(v)
            case "port": guard let n = Int(v), n > 0, n < 65536 else { continue }; val = n
            default: if v.isEmpty { continue }
            }
            if block == "room" { room[field] = val } else { manager[field] = val }
        }
        // config.json first; the env file changes only once that is safely written
        guard writeConfig({ j in
            if !room.isEmpty { var r = j["room"] as? [String: Any] ?? [:]; r.merge(room) { _, b in b }; j["room"] = r }
            if !manager.isEmpty { var m = j["manager"] as? [String: Any] ?? [:]; m.merge(manager) { _, b in b }; j["manager"] = m }
        }) else { return false }
        do { try rewriteEnv(kept) } catch {
            // left in place the lines still win, exactly as before the import: nothing breaks
            guard ask else { return true }
            let e = NSAlert(); e.messageText = "Imported, but the env file was not changed"
            e.informativeText = "\(error.localizedDescription)\n\nRemove the AGENT_OFFICE_ROOM_ and AGENT_OFFICE_MANAGER_ lines from ~/.config/agent-office/env by hand, or they keep winning."
            e.runModal()
        }
        if ask, !room.isEmpty { roomSharing = true }
        managerImageSent = nil
        syncRoom(); push(); refreshSettingsRoom()
        guard ask else { return true }
        let done = NSAlert(); done.messageText = "Imported"
        done.informativeText = "The room and your character are now set from config.json." + (ProcessInfo.processInfo.environment.keys.contains { keys[$0] != nil }
            ? "\n\nThe app was also started with some of these as environment variables, which still win until it is opened normally." : "")
        done.runModal()
        return true
    }

    // ---- poked ----
    func poked(by name: String) {
        let now = Date()
        if let last = lastPoke[name], now.timeIntervalSince(last) < POKE_QUIET { return }
        lastPoke[name] = now
        let c = UNUserNotificationCenter.current()
        c.delegate = self
        c.requestAuthorization(options: [.alert, .sound]) { ok, _ in
            guard ok else { return }
            let n = UNMutableNotificationContent()
            n.title = "👉 \(name) poked you"
            n.body = "in the room \(self.roomRunning.name)"
            n.sound = .default
            c.add(UNNotificationRequest(identifier: "poke-\(now.timeIntervalSince1970)", content: n, trigger: nil))
        }
        if window.isMiniaturized || !window.isVisible { NSApp.requestUserAttention(.informationalRequest) }
        else { shakeWindow() }
    }
    /// A short side-to-side shake, about half a second, ending where it started.
    func shakeWindow() {
        guard !shaking else { return }
        shaking = true
        let start = window.frame.origin
        let steps: [CGFloat] = [-12, 12, -10, 10, -7, 7, -4, 4, -2, 0]
        for (i, dx) in steps.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.045 * Double(i)) { [weak self] in
                guard let self else { return }
                self.window.setFrameOrigin(NSPoint(x: start.x + dx, y: start.y))
                if i == steps.count - 1 { self.shaking = false }
            }
        }
    }
    // show the banner even while Agent Office is the app in front
    func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification,
                                withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .sound])
    }
    func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); done()
    }
}
