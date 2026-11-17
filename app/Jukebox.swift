import Cocoa

// The lounge's jukebox: what Spotify is playing (song, artist, album cover), with previous,
// play/pause and next.
//
// Spotify announces every change (a new song, play, pause) with a distributed notification, so
// nothing is polled. The buttons use Apple Events, and only while Spotify is already running: the
// jukebox never starts it. The first button press makes macOS ask once whether Agent Office may
// control Spotify; after that the jukebox also reads the current song at launch, instead of
// waiting for the next change.
// The cover comes from Spotify's public oEmbed endpoint for the song's id, shrunk here to a
// COVER × COVER picture that the page draws as pixel art. What you listen to stays on this Mac:
// it is not sent to the room.
final class Jukebox {
    static let bundle = "com.spotify.client"
    static let actions = ["previous": "previous track", "playpause": "playpause", "next": "next track"]
    static let COVER = 11                                   // the cover's size in art pixels (office.html)
    var onChange: (() -> Void)?
    private var info: [String: String] = [:]                 // state, track, artist, album, id
    private var artId = "", art = ""                         // the song the cover belongs to, a data: URL
    private let defaults = UserDefaults.standard

    var running: Bool { !NSRunningApplication.runningApplications(withBundleIdentifier: Jukebox.bundle).isEmpty }

    /// For the page: {running, state, track, artist, album, art}; state is "" until Spotify says.
    var snapshot: [String: Any] {
        guard running else { return ["running": false] }
        var s: [String: Any] = ["running": true, "state": info["state"] ?? ""]
        for k in ["track", "artist", "album"] { s[k] = info[k] ?? "" }
        s["art"] = !art.isEmpty && artId == info["id"] ? art : ""
        return s
    }

    init() {
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.spotify.client.PlaybackStateChanged"), object: nil, queue: .main) { [weak self] n in
            self?.apply(n.userInfo)
        }
        let ws = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
            ws.addObserver(forName: name, object: nil, queue: .main) { [weak self] n in
                guard (n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.bundleIdentifier == Jukebox.bundle else { return }
                self?.info = [:]; self?.onChange?()
            }
        }
        // Allowed before: read the song now. Not yet: no permission prompt until a button is pressed.
        if defaults.bool(forKey: "jukeboxUsed") { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.refresh() } }
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
        """) { [weak self] _ in
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
        """) { [weak self] out in
            guard let self, let out, !out.isEmpty else { return }
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

    /// osascript off the main thread; its trimmed output (nil on failure) back on the main thread.
    private static func run(_ source: String, then: @escaping (String?) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let p = Process(), out = Pipe()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            p.arguments = ["-e", source]
            p.standardOutput = out; p.standardError = FileHandle.nullDevice
            var text: String?
            if (try? p.run()) != nil {
                let data = out.fileHandleForReading.readDataToEndOfFile()
                p.waitUntilExit()
                if p.terminationStatus == 0 { text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) }
            }
            DispatchQueue.main.async { then(text) }
        }
    }
}
