import Cocoa

// The lounge's jukebox: what Spotify is playing (song, artist, album cover), with previous,
// play/pause and next.
//
// Spotify announces every change (a new song, play, pause) with a distributed notification, so
// nothing is polled. The buttons use Apple Events, and only while Spotify is already running: the
// jukebox never starts it. The first button press makes macOS ask once whether Agent Office may
// control Spotify; after that the jukebox also reads the current song at launch, instead of
// waiting for the next change. A "no" there (Automation error -1743) is shown in the jukebox's
// tooltip with where to change it, since macOS does not ask again.
// It is drawn only when Spotify is installed.
// The cover comes from Spotify's public oEmbed endpoint for the song's id, shrunk here to a
// COVER × COVER picture that the page draws as pixel art: Spotify's own site is asked for the
// cover of the song you play. Nothing about it is sent to the room.
final class Jukebox {
    static let bundle = "com.spotify.client"
    static let actions = ["previous": "previous track", "playpause": "playpause", "next": "next track"]
    static let COVER = 11                                   // the cover's size in art pixels (office.html)
    var onChange: (() -> Void)?
    private var info: [String: String] = [:]                 // state, track, artist, album, id
    private var artId = "", art = ""                         // the song the cover belongs to, a data: URL
    private var denied = false                               // macOS said no to controlling Spotify
    private(set) var installed = false                       // looked up at launch and when an app starts or quits
    private let defaults = UserDefaults.standard

    var running: Bool { !NSRunningApplication.runningApplications(withBundleIdentifier: Jukebox.bundle).isEmpty }

    /// For the page: {installed, running, denied, state, track, artist, album, art}; state is ""
    /// until Spotify says.
    var snapshot: [String: Any] {
        guard installed else { return ["installed": false, "running": false] }
        guard running else { return ["installed": true, "running": false, "denied": denied] }
        var s: [String: Any] = ["installed": true, "running": true, "denied": denied, "state": info["state"] ?? ""]
        for k in ["track", "artist", "album"] { s[k] = info[k] ?? "" }
        s["art"] = !art.isEmpty && artId == info["id"] ? art : ""
        return s
    }

    init() {
        lookUp()
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.spotify.client.PlaybackStateChanged"), object: nil, queue: .main) { [weak self] n in
            self?.apply(n.userInfo)
        }
        let ws = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
            ws.addObserver(forName: name, object: nil, queue: .main) { [weak self] n in
                guard (n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.bundleIdentifier == Jukebox.bundle else { return }
                guard let self else { return }
                self.info = [:]; self.lookUp(); self.onChange?()
                // started again and allowed before: fill the jukebox without waiting for a change
                if name == NSWorkspace.didLaunchApplicationNotification, self.defaults.bool(forKey: "jukeboxUsed") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.refresh() }
                }
            }
        }
        // Allowed before: read the song now. Not yet: no permission prompt until a button is pressed.
        if defaults.bool(forKey: "jukeboxUsed") { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.refresh() } }
    }

    private func lookUp() { installed = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Jukebox.bundle) != nil }

    /// After an Apple Event: remember whether macOS refused it (Automation, error -1743).
    private func note(_ error: String?) {
        let was = denied
        if let error { if error.contains("-1743") { denied = true } } else { denied = false }
        if denied != was { onChange?() }
    }

    private func apply(_ u: [AnyHashable: Any]?) {
        guard let u else { return }
        let state = (u["Player State"] as? String ?? "").lowercased()
        info = ["state": state]
        if state != "stopped" {
            info["track"] = u["Name"] as? String ?? ""
            info["artist"] = u["Artist"] as? String ?? ""
            info["album"] = u["Album"] as? String ?? ""
            info["id"] = u["Track ID"] as? String ?? ""
        }
        onChange?()
        fetchCover()
    }

    /// previous, playpause or next.
    func control(_ action: String) {
        guard let verb = Jukebox.actions[action], running else { return }
        defaults.set(true, forKey: "jukeboxUsed")
        Jukebox.run("""
        if application id "\(Jukebox.bundle)" is running then
          tell application id "\(Jukebox.bundle)" to \(verb)
        end if
        """) { [weak self] _, error in
            self?.note(error)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self?.refresh() }
        }
    }

    /// Ask Spotify what it is playing (only while it runs: asking would otherwise start it).
    func refresh() {
        guard running else { return }
        Jukebox.run("""
        if application id "\(Jukebox.bundle)" is running then
          tell application id "\(Jukebox.bundle)"
            set s to player state as string
            if s is "stopped" then return "stopped"
            set t to current track
            return s & linefeed & (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & (id of t)
          end tell
        end if
        """) { [weak self] out, error in
            guard let self else { return }
            self.note(error)
            guard let out, !out.isEmpty else { return }
            let f = out.components(separatedBy: "\n")
            self.info = ["state": f[0]]
            if f.count >= 5 { self.info["track"] = f[1]; self.info["artist"] = f[2]; self.info["album"] = f[3]; self.info["id"] = f[4] }
            self.onChange?()
            self.fetchCover()
        }
    }

    /// The current song's cover, once per song: oEmbed gives its picture, which is shrunk to COVER².
    private func fetchCover() {
        let id = info["id"] ?? ""
        guard id != artId else { return }
        artId = id; art = ""
        // spotify:track:<id> or spotify:episode:<id>; local files and ads have no page, so no cover
        let parts = id.split(separator: ":")
        guard parts.count == 3, parts[0] == "spotify", ["track", "episode"].contains(String(parts[1])),
              parts[2].allSatisfy({ $0.isLetter || $0.isNumber }),
              let page = "https://open.spotify.com/\(parts[1])/\(parts[2])".addingPercentEncoding(withAllowedCharacters: .alphanumerics),
              let url = URL(string: "https://open.spotify.com/oembed?url=\(page)") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let t = j["thumbnail_url"] as? String, let tu = URL(string: t), tu.scheme == "https" else { return }
            URLSession.shared.dataTask(with: tu) { data, _, _ in
                guard let data, let png = Jukebox.shrink(data) else { return }
                DispatchQueue.main.async {
                    guard let self, self.artId == id else { return }   // the song changed meanwhile
                    self.art = "data:image/png;base64," + png.base64EncodedString()
                    self.onChange?()
                }
            }.resume()
        }.resume()
    }

    /// A picture shrunk to COVER × COVER pixels (each one the average of its area), as PNG.
    private static func shrink(_ data: Data) -> Data? {
        guard let img = NSImage(data: data),
              let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: COVER, pixelsHigh: COVER, bitsPerSample: 8,
                                         samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                         bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSGraphicsContext.current?.imageInterpolation = .high
        img.draw(in: NSRect(x: 0, y: 0, width: COVER, height: COVER), from: .zero, operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }

    /// osascript off the main thread; back on the main thread, its trimmed output (nil on failure)
    /// and its error message (nil on success).
    private static func run(_ source: String, then: @escaping (String?, String?) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let p = Process(), out = Pipe(), err = Pipe()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            p.arguments = ["-e", source]
            p.standardOutput = out; p.standardError = err
            var text: String?, error: String? = "could not run osascript"
            if (try? p.run()) != nil {
                let data = out.fileHandleForReading.readDataToEndOfFile(), edata = err.fileHandleForReading.readDataToEndOfFile()
                p.waitUntilExit()
                if p.terminationStatus == 0 { text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines); error = nil }
                else { error = String(data: edata, encoding: .utf8) ?? "osascript failed" }
            }
            DispatchQueue.main.async { then(text, error) }
        }
    }
}
