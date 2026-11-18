// Your name and picture: the manager in your office and your character in a shared room.
//
// The dialog writes the "manager" block of ~/.config/agent-office/config.json. A chosen picture
// is copied next to the config (manager.<ext>), so moving or deleting the original does not
// take it away; Remove picture goes back to a drawn character. Saving makes this the manager at
// once: AGENT_OFFICE_MANAGER_ lines in the env file, which would win over config.json, are taken
// out of it (a copy stays in env.bak).

import Cocoa
import UniformTypeIdentifiers

extension AppDelegate {
    @objc func editProfile() {
        let cfg = Config.load()
        var picked: String? = nil                         // nil: unchanged, "": removed, else a file
        let a = NSAlert()
        a.messageText = "Your name and picture"
        a.informativeText = "You, at the manager's desk, and your character in a shared room."
        let w: CGFloat = 240                              // the width of the alert's text column
        let name = NSTextField(frame: NSRect(x: 0, y: 0, width: w, height: 24))
        name.placeholderString = "Your name"; name.stringValue = cfg.managerName
        let preview = NSImageView(frame: NSRect(x: 0, y: 0, width: 72, height: 96))
        preview.imageScaling = .scaleProportionallyUpOrDown
        preview.wantsLayer = true; preview.layer?.cornerRadius = 6; preview.layer?.backgroundColor = NSColor.quaternaryLabelColor.cgColor
        preview.image = cfg.managerImage.isEmpty ? nil : NSImage(contentsOfFile: cfg.managerImage)
        let pathLbl = NSTextField(labelWithString: "")
        pathLbl.font = .systemFont(ofSize: 11); pathLbl.textColor = .secondaryLabelColor; pathLbl.lineBreakMode = .byTruncatingMiddle
        func showPath() {
            let p = picked ?? cfg.managerImage
            pathLbl.stringValue = p.isEmpty ? "No picture: a drawn character" : (p as NSString).lastPathComponent
        }
        showPath()
        let choose = ActionButton(title: "Choose Picture…") {
            let o = NSOpenPanel()
            o.allowedContentTypes = [.png, .jpeg, .heic, .tiff, .gif]
            o.message = "A photo or a drawing; a plain background is cut away."
            guard o.runModal() == .OK, let u = o.url, let im = NSImage(contentsOf: u) else { return }
            picked = u.path; preview.image = im; showPath()
        }
        let remove = ActionButton(title: "Remove Picture") { picked = ""; preview.image = nil; showPath() }
        // fixed frames, sized to the alert's own column: a stack view's fitting size runs past it
        // and NSAlert does not widen itself, so buttons get cut off at the right edge
        let box = NSView(frame: NSRect(x: 0, y: 0, width: w, height: 132))
        name.frame = NSRect(x: 0, y: 108, width: w, height: 24)
        preview.frame = NSRect(x: 0, y: 0, width: 72, height: 96)
        choose.frame = NSRect(x: 82, y: 64, width: w - 82, height: 28)
        remove.frame = NSRect(x: 82, y: 32, width: w - 82, height: 28)
        pathLbl.frame = NSRect(x: 85, y: 6, width: w - 85, height: 16)
        for v in [name, preview, choose, remove, pathLbl] { box.addSubview(v) }
        a.accessoryView = box
        a.addButton(withTitle: "Save"); a.addButton(withTitle: "Cancel")
        a.window.initialFirstResponder = name
        NSApp.activate(ignoringOtherApps: true)
        guard a.runModal() == .alertFirstButtonReturn else { return }

        var image: String? = nil                          // the value to store, when it changes
        if let p = picked {
            if p.isEmpty { image = "" } else {
                let dir = home + "/.config/agent-office", ext = (p as NSString).pathExtension.lowercased()
                let dest = dir + "/manager." + (ext.isEmpty ? "png" : ext)
                do {
                    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
                    if p != dest {
                        // one picture at a time: an older one with another extension would be left behind
                        for old in ["png", "jpg", "jpeg", "heic", "tiff", "gif"] { try? FileManager.default.removeItem(atPath: dir + "/manager." + old) }
                        try FileManager.default.copyItem(atPath: p, toPath: dest)
                        // a copy keeps the original's date, and the picture cache is keyed on it
                        try FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: dest)
                    }
                    image = dest
                } catch {
                    let e = NSAlert(); e.messageText = "Could not copy the picture"; e.informativeText = error.localizedDescription
                    e.runModal(); return
                }
            }
        }
        let n = String(name.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
        guard writeConfig({ j in
            var m = j["manager"] as? [String: Any] ?? [:]
            if n.isEmpty { m.removeValue(forKey: "name") } else { m["name"] = n }
            if let image { if image.isEmpty { m.removeValue(forKey: "image") } else { m["image"] = image } }
            // a picture only the env file set, left as it was: kept here, as the env line goes below
            else if m["image"] == nil, !cfg.managerImage.isEmpty { m["image"] = cfg.managerImage }
            if m.isEmpty { j.removeValue(forKey: "manager") } else { j["manager"] = m }
        }) else { return }
        // You just chose who you are: an AGENT_OFFICE_MANAGER_ line in the env file would win over
        // it, so it goes (a copy stays in env.bak). The process environment cannot be changed from
        // here, so that one is only named.
        let keys: Set<String> = ["AGENT_OFFICE_MANAGER_NAME", "AGENT_OFFICE_MANAGER_IMAGE"]
        let dropped = dropEnvKeys(keys)
        let still = keys.filter { ProcessInfo.processInfo.environment[$0] != nil }
            .union(dropped ? [] : keys.filter { Config.env()[$0] != nil })
        if !still.isEmpty {
            let e = NSAlert(); e.messageText = "Saved, but \(still.sorted().joined(separator: ", ")) still decides"
            e.informativeText = dropped
                ? "Agent Office was started with it as an environment variable, which wins over config.json. Open the app normally (from the Dock or Finder) for this change to show."
                : "~/.config/agent-office/env sets it and could not be changed. Remove that line by hand for this change to show."
            e.runModal()
        }
        managerImageSent = nil
        push()
        roomClient?.sendProfile()                          // teammates see the new name and picture
    }
}

/// An NSButton that runs a closure: the dialog's buttons act on its own local state.
final class ActionButton: NSButton {
    private var run: () -> Void = {}
    convenience init(title: String, _ run: @escaping () -> Void) {
        self.init(frame: .zero)
        self.title = title; bezelStyle = .rounded; self.run = run
        target = self; action = #selector(fire)
    }
    @objc private func fire() { run() }
}
