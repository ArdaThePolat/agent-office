// The music bar: what the Spotify app is playing, with its cover, and previous / play-pause /
// next. Off until "Show what Spotify is playing" is ticked in Settings; while off, nothing is
// sent to Spotify. While on, the app asks Spotify with AppleScript on the office's timer, and
// only while Spotify runs: a `tell` to an app that is not running launches it. macOS asks once
// for permission to control Spotify (Privacy → Automation); refused, every read fails and the
// bar says where to allow it. Nothing here leaves the Mac except the cover image, which the page
// loads from Spotify's image host.

import Cocoa

final class SpotifyBridge {
    static let shared = SpotifyBridge()
    private let q = DispatchQueue(label: "agent-office.spotify")
    private var last = ""
    private var busy = false
    private var running: Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: "com.spotify.client").isEmpty
    }

    /// The player as JSON for the page, delivered on the main thread when it changed (or `force`).
    func poll(force: Bool, _ deliver: @escaping (String) -> Void) {
        guard !busy else { return }
        guard running else { publish(["state": "off"], force, deliver); return }
        busy = true
        q.async {
            let out = Self.osascript("""
            tell application "Spotify"
              set s to player state as string
              if s is "stopped" then return s
              return s & tab & (name of current track) & tab & (artist of current track) & tab & (artwork url of current track)
            end tell
            """)
            var o: [String: Any] = ["state": "noaccess"]
            if let out {
                let f = out.components(separatedBy: "\t")
                o["state"] = f[0]
                if f.count >= 3 { o["track"] = f[1]; o["artist"] = f[2] }
                // the page loads the cover only from Spotify's image host
                if f.count >= 4, f[3].hasPrefix("https://i.scdn.co/image/") { o["art"] = f[3] }
            }
            DispatchQueue.main.async { self.busy = false; self.publish(o, force, deliver) }
        }
    }

    /// Tell the page the bar is off, without asking Spotify.
    func off(force: Bool, _ deliver: (String) -> Void) { publish(["state": "off"], force, deliver) }

    /// "prev", "toggle" or "next"; anything else is ignored. `then` runs on the main thread.
    func control(_ cmd: String, then: @escaping () -> Void) {
        guard let verb = ["prev": "previous track", "toggle": "playpause", "next": "next track"][cmd], running else { return }
        q.async {
            _ = Self.osascript("tell application \"Spotify\" to \(verb)")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: then)
        }
    }

    private func publish(_ o: [String: Any], _ force: Bool, _ deliver: (String) -> Void) {
        guard let d = try? JSONSerialization.data(withJSONObject: o), let json = String(data: d, encoding: .utf8) else { return }
        if !force && json == last { return }
        last = json
        deliver(json)
    }

    /// stdout without its trailing newline, or nil when osascript fails (no permission, Spotify gone).
    private static func osascript(_ source: String) -> String? {
        let p = Process(), out = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-e", source]
        p.standardOutput = out; p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { return nil }
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .newlines)
    }
}

extension AppDelegate {
    /// The player to the page: on the timer (only when it changed), and forced after a button,
    /// a page reload or the setting changing. With the setting off the page is told "off" once.
    func pushMusic(force: Bool = false) {
        let deliver: (String) -> Void = { [weak self] json in
            self?.web?.evaluateJavaScript("window.updateMusic && updateMusic(\(json))", completionHandler: nil)
        }
        // a read already in flight when the setting is turned off must not bring the bar back
        if showMusic { SpotifyBridge.shared.poll(force: force) { [weak self] j in if self?.showMusic == true { deliver(j) } } }
        else { SpotifyBridge.shared.off(force: force, deliver) }
    }
}
