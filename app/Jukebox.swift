import Cocoa

// The lounge's jukebox: what is playing on this Mac (song or video, artist, cover, how far in),
// with previous, play/pause and next.
//
// Two sources, the first that has something wins:
// - Now Playing (nowplaying.py): whatever macOS's own Now Playing shows, from any app (Spotify,
//   Music, a video in Chrome or Safari, a podcast app). macOS answers it only to Apple-signed
//   programs, so a helper runs it with Apple's python3 (from the Xcode tools the build needs). It
//   wakes on Now Playing's change notifications, sends the cover itself, and its buttons need no
//   permission. When the Xcode tools are missing or the helper keeps failing, this source is off.
// - Spotify: Spotify's distributed notification for the song, Apple Events for the buttons (only
//   while Spotify is running: the jukebox never starts it). The first press makes macOS ask once
//   whether Agent Office may control Spotify; a "no" (Automation error -1743) is shown in the
//   tooltip, since macOS does not ask again. Its cover comes from Spotify's public oEmbed endpoint
//   for the song's id, so it is asked only while Now Playing has nothing.
// A cover is kept for as long as the same item plays: a pause, or an update that arrives without
// the picture, does not take it away.
// Each cover is shrunk here to COVER × COVER, drawn by the page as pixel art. Nothing about what
// plays is sent to the room.
final class Jukebox {
    static let spotify = "com.spotify.client"
    static let actions = ["previous": "previous track", "playpause": "playpause", "next": "next track"]
    static let COVER = 11                                   // the cover's size in art pixels (office.html)
    var onChange: (() -> Void)?
    private let defaults = UserDefaults.standard

    /// Settings → "Jukebox in the lounge" (on unless turned off): off stops the helper and hides it.
    var enabled: Bool {
        get { defaults.object(forKey: "jukebox") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "jukebox"); newValue ? startHelper() : stopHelper(); onChange?() }
    }

    // ---- Now Playing (the helper) ----
    private var helper: Process?, helperIn: FileHandle?
    private var helperFailures = 0
    private var helperSeen = false                           // it has answered at least once
    private var np: [String: Any] = [:]                      // its latest line; "app" is "" when nothing plays

    // ---- Spotify ----
    private var info: [String: String] = [:]                 // state, track, artist, album, id
    private var denied = false                               // macOS said no to controlling Spotify
    private var spotifyInstalled = false                     // looked up at launch and when Spotify starts or quits
    var spotifyRunning: Bool { !NSRunningApplication.runningApplications(withBundleIdentifier: Jukebox.spotify).isEmpty }

    // the cover, by what it belongs to: the helper's key, or Spotify's track id
    private var artKey = "", art = ""

    private var npApp: String { np["app"] as? String ?? "" }
    private var spotifyKey: String {
        let id = info["id"] ?? ""
        return id.isEmpty ? [info["track"] ?? "", info["artist"] ?? "", info["album"] ?? ""].joined(separator: "|") : id
    }

    /// For the page: {available, on, app, state, track, artist, album, key, art, duration, elapsed,
    /// at, denied}. `available`: the jukebox is drawn. `on`: something to show and to control.
    var snapshot: [String: Any] {
        let available = enabled && (helper != nil || spotifyInstalled)
        guard available else { return ["available": false, "on": false] }
        if !npApp.isEmpty {
            let key = np["key"] as? String ?? ""
            var s: [String: Any] = ["available": true, "on": true, "app": np["name"] as? String ?? npApp,
                                    "state": (np["playing"] as? Bool ?? false) ? "playing" : "paused", "key": key,
                                    "art": artKey == key ? art : ""]
            s["track"] = np["title"] ?? ""; s["artist"] = np["artist"] ?? ""; s["album"] = np["album"] ?? ""
            for k in ["duration", "elapsed", "at"] { s[k] = np[k] ?? 0 }
            return s
        }
        guard spotifyRunning else { return ["available": true, "on": false] }
        let key = spotifyKey
        var s: [String: Any] = ["available": true, "on": true, "app": "Spotify", "denied": denied,
                                "state": info["state"] ?? "", "key": key, "art": artKey == key ? art : ""]
        for k in ["track", "artist", "album"] { s[k] = info[k] ?? "" }
        return s
    }

    init() {
        spotifyInstalled = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Jukebox.spotify) != nil
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.spotify.client.PlaybackStateChanged"), object: nil, queue: .main) { [weak self] n in
            self?.apply(n.userInfo)
        }
        let ws = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
            ws.addObserver(forName: name, object: nil, queue: .main) { [weak self] n in
                guard (n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.bundleIdentifier == Jukebox.spotify else { return }
                guard let self else { return }
                self.info = [:]
                self.spotifyInstalled = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Jukebox.spotify) != nil
                self.onChange?()
                // started again and allowed before: fill the jukebox without waiting for a change
                if name == NSWorkspace.didLaunchApplicationNotification, self.defaults.bool(forKey: "jukeboxUsed") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.refresh() }
                }
            }
        }
        if enabled { startHelper() }
        // Allowed before: read the song now. Not yet: no permission prompt until a button is pressed.
        if defaults.bool(forKey: "jukeboxUsed") { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.refresh() } }
    }

    /// previous, playpause or next: to the app Now Playing shows, else to Spotify.
    func control(_ action: String) {
        guard enabled, let verb = Jukebox.actions[action] else { return }
        if !npApp.isEmpty, let h = helperIn {
            try? h.write(contentsOf: Data((action + "\n").utf8))
            return
        }
        guard spotifyRunning else { return }
        defaults.set(true, forKey: "jukeboxUsed")
        Jukebox.run("""
        if application id "\(Jukebox.spotify)" is running then
          tell application id "\(Jukebox.spotify)" to \(verb)
        end if
        """) { [weak self] _, error in
            self?.note(error)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self?.refresh() }
        }
    }

    // ---- the helper ----

    /// Apple's python3 from the active Xcode tools, if there is one. Never /usr/bin/python3 when
    /// they are missing: that stub opens the "install the command line developer tools" dialog.
    private static func python() -> String? {
        let p = Process(), out = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select"); p.arguments = ["-p"]
        p.standardOutput = out; p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        let dir = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        p.waitUntilExit()
        let py = dir + "/usr/bin/python3"
        return p.terminationStatus == 0 && FileManager.default.isExecutableFile(atPath: py) ? py : nil
    }

    private func startHelper() {
        guard helper == nil, helperFailures < 3,
              let script = Bundle.main.path(forResource: "nowplaying", ofType: "py") else { return }
        DispatchQueue.global(qos: .utility).async {
            guard let py = Jukebox.python() else { return }
            DispatchQueue.main.async { self.launchHelper(py, script) }
        }
    }

    private func launchHelper(_ py: String, _ script: String) {
        guard helper == nil, enabled else { return }
        let p = Process(), inp = Pipe(), out = Pipe()
        p.executableURL = URL(fileURLWithPath: py)
        p.arguments = ["-I", script]                         // isolated: no user site-packages, no cwd on the path
        p.standardInput = inp; p.standardOutput = out; p.standardError = FileHandle.nullDevice
        p.qualityOfService = .utility
        var buffer = Data()
        out.fileHandleForReading.readabilityHandler = { [weak self] fh in
            let chunk = fh.availableData
            if chunk.isEmpty { fh.readabilityHandler = nil; return }
            buffer.append(chunk)
            while let nl = buffer.firstIndex(of: 0x0A) {
                let line = buffer[buffer.startIndex..<nl]; buffer = Data(buffer[buffer.index(after: nl)...])
                guard var j = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else { continue }
                // the cover is shrunk here, off the main thread: it arrives as the app's full picture
                let cover = (j.removeValue(forKey: "art") as? String).flatMap { Data(base64Encoded: $0) }.flatMap(Jukebox.shrink)
                DispatchQueue.main.async { self?.helperLine(j, cover: cover) }
            }
        }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self, self.helper === proc else { return }
                self.helper = nil; self.helperIn = nil; self.np = [:]
                if proc.terminationReason != .exit || proc.terminationStatus != 0 { self.helperFailures += 1 }
                self.onChange?()
                if self.enabled { DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.startHelper() } }
            }
        }
        do { try p.run() } catch { helperFailures += 1; return }
        helper = p; helperIn = inp.fileHandleForWriting
        onChange?()
    }

    private func stopHelper() {
        guard let p = helper else { return }
        helper = nil; helperIn = nil; np = [:]
        p.terminate()                                        // it also exits on its own when its stdin closes
    }

    private func helperLine(_ j: [String: Any], cover: Data?) {
        helperSeen = true
        np = j
        if let cover, let key = j["key"] as? String {
            artKey = key; art = "data:image/png;base64," + cover.base64EncodedString()
        }
        onChange?()
    }

    // ---- Spotify ----

    /// After an Apple Event: remember whether macOS refused it (Automation, error -1743).
    private func note(_ error: String?) {
        let was = denied
        if let error { if error.contains("-1743") { denied = true } } else { denied = false }
        if denied != was { onChange?() }
    }

    private func apply(_ u: [AnyHashable: Any]?) {
        guard let u else { return }
        let state = (u["Player State"] as? String ?? "").lowercased()
        var next = ["state": state]
        if state != "stopped" {
            next["track"] = u["Name"] as? String ?? ""
            next["artist"] = u["Artist"] as? String ?? ""
            next["album"] = u["Album"] as? String ?? ""
            next["id"] = u["Track ID"] as? String ?? ""
            // a state change that leaves the song out is still the same song
            if next["track"] == "" && next["id"] == "" { for k in ["track", "artist", "album", "id"] { next[k] = info[k] } }
        }
        info = next
        onChange?()
        fetchCover()
    }

    /// Ask Spotify what it is playing (only while it runs: asking would otherwise start it).
    func refresh() {
        guard spotifyRunning else { return }
        Jukebox.run("""
        if application id "\(Jukebox.spotify)" is running then
          tell application id "\(Jukebox.spotify)"
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

    /// The current Spotify song's cover, once per song, and only while Now Playing has nothing:
    /// oEmbed gives its picture, which is shrunk to COVER².
    private func fetchCover() {
        guard helper == nil || (helperSeen && npApp.isEmpty) else { return }
        let id = info["id"] ?? ""
        guard !id.isEmpty, id != artKey else { return }        // no id: keep the cover there is
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
                    guard let self, (self.info["id"] ?? "") == id else { return }   // the song changed meanwhile
                    self.artKey = id; self.art = "data:image/png;base64," + png.base64EncodedString()
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
