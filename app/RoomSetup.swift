// Creating, joining and leaving a shared room from the app, and being poked.
//
// Create and Join ask for the room's name and password in a native dialog and write them to the
// "room" block of ~/.config/agent-office/config.json (the file is kept readable only by you); the
// app picks the change up at once, like an edit made by hand. A saved room stays until it is
// changed or deleted: every launch joins (or hosts) it again. Leave sets "enabled": false and
// keeps the name and password, so Join can fill them in again; Settings → Delete Saved Room
// removes the whole block.
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
        let cur = Config.load().room
        let a = NSAlert()
        a.messageText = create ? "Create a room" : "Join a room"
        a.informativeText = create
            ? "Your Mac hosts the room while Agent Office is open. Teammates on the same network join it with its name and password."
            : "Ask the person who hosts the room for its name and password."
        let w: CGFloat = 300
        func field(_ placeholder: String, _ value: String, secure: Bool = false) -> NSTextField {
            let f = secure ? NSSecureTextField(frame: NSRect(x: 0, y: 0, width: w, height: 24)) : NSTextField(frame: NSRect(x: 0, y: 0, width: w, height: 24))
            f.placeholderString = placeholder; f.stringValue = value
            return f
        }
        func caption(_ s: String) -> NSTextField {
            let l = NSTextField(labelWithString: s); l.font = .systemFont(ofSize: 11); l.textColor = .secondaryLabelColor; return l
        }
        let name = field("e.g. team lounge", create && cur.host == false ? "" : cur.name)
        let pass = field(create ? "at least 8 characters" : "", create ? "" : cur.password, secure: true)
        let addr = field("optional, e.g. their-mac.local", cur.host ? "" : cur.address)
        var rows: [NSView] = [caption("Room name"), name, caption("Password"), pass]
        if !create { rows += [caption("Host address (only when the room is not found by name)"), addr] }
        let stack = NSStackView(views: rows)
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 4
        stack.frame = NSRect(x: 0, y: 0, width: w, height: CGFloat(rows.count) * 26)
        a.accessoryView = stack
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
            let host = (ProcessInfo.processInfo.hostName as NSString).deletingPathExtension
            let i = NSAlert(); i.messageText = "\(n) is open"
            i.informativeText = "Teammates choose Room → Join a Room… (or the Join button in the lounge) and type the name and the password. Tell them the password in person or over a private channel.\n\nIf the room is not found by name on their network, they can add your Mac's address: \(host).local"
            i.runModal()
        }
    }

    /// Merge `fields` into config.json's "room" block, keeping every other key. False (after
    /// saying why) when the file could not be written.
    @discardableResult
    func saveRoom(_ fields: [String: Any], forget: Bool = false) -> Bool {
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
        if forget { j.removeValue(forKey: "room") } else {
            var room = j["room"] as? [String: Any] ?? [:]
            for (k, v) in fields { if let s = v as? String, s.isEmpty { room.removeValue(forKey: k) } else { room[k] = v } }
            j["room"] = room
        }
        do {
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            let d = try JSONSerialization.data(withJSONObject: j, options: [.prettyPrinted, .sortedKeys])
            try d.write(to: URL(fileURLWithPath: path), options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
        } catch {
            let e = NSAlert(); e.messageText = "Could not save the room"; e.informativeText = error.localizedDescription
            e.runModal(); return false
        }
        // the env file and the environment win over config.json: say so rather than look broken
        let env = Config.env().keys.filter { ["AGENT_OFFICE_ROOM_NAME", "AGENT_OFFICE_ROOM_PASSWORD", "AGENT_OFFICE_ROOM_HOST",
                                              "AGENT_OFFICE_ROOM_ENABLED", "AGENT_OFFICE_ROOM_ADDRESS"].contains($0) }
        if !env.isEmpty {
            let e = NSAlert(); e.messageText = forget ? "Deleted, but your env file still sets a room" : "Saved, but your env file decides"
            e.informativeText = "~/.config/agent-office/env sets \(env.sorted().joined(separator: ", ")), which wins over config.json. Remove those lines for this change to take effect."
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
