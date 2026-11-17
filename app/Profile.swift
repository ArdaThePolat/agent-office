// Your name and picture: the manager in your office and your character in a shared room.
//
// The dialog writes the "manager" block of ~/.config/agent-office/config.json. A chosen picture
// is copied next to the config (manager.<ext>), so moving or deleting the original does not
// take it away; Remove picture goes back to a drawn character.

import Cocoa
import UniformTypeIdentifiers

extension AppDelegate {
    @objc func editProfile() {
        let cfg = Config.load()
        var picked: String? = nil                         // nil: unchanged, "": removed, else a file
        let a = NSAlert()
        a.messageText = "Your name and picture"
        a.informativeText = "You, at the manager's desk, and your character in a shared room."
        let w: CGFloat = 300
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
        let buttons = NSStackView(views: [choose, remove]); buttons.spacing = 6
        let side = NSStackView(views: [buttons, pathLbl]); side.orientation = .vertical; side.alignment = .leading
        let pic = NSStackView(views: [preview, side]); pic.alignment = .centerY; pic.spacing = 10
        preview.widthAnchor.constraint(equalToConstant: 72).isActive = true
        preview.heightAnchor.constraint(equalToConstant: 96).isActive = true
        let stack = NSStackView(views: [name, pic]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 10
        stack.frame = NSRect(x: 0, y: 0, width: w, height: 136)
        a.accessoryView = stack
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
            if m.isEmpty { j.removeValue(forKey: "manager") } else { j["manager"] = m }
        }) else { return }
        let env = Config.env().keys.filter { $0 == "AGENT_OFFICE_MANAGER_NAME" || $0 == "AGENT_OFFICE_MANAGER_IMAGE" }
        if !env.isEmpty {
            let e = NSAlert(); e.messageText = "Saved, but your env file decides"
            e.informativeText = "~/.config/agent-office/env sets \(env.sorted().joined(separator: ", ")), which wins over config.json. Settings → Import from env file… moves it here, so this change takes effect."
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
