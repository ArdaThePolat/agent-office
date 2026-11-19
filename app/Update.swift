// Updates: when the person turns on "Check for updates once a day", the app asks GitHub for the
// repository's latest release and compares it with the release it was built from. A newer one
// shows an Update button; clicking it moves the checkout the app was built from to that release
// tag, rebuilds and relaunches.
//
// The build stamps three values into Info.plist: the version (the newest release tag reachable
// from the commit it was built from), the GitHub repository (from the checkout's origin) and the
// checkout's path. Without a checkout to update, the button opens the release page instead.
//
// The update only fast-forwards (`git merge --ff-only <tag>`): local commits or uncommitted
// changes in the way stop it with the reason and the manual command, and nothing is lost. It also
// builds only a checkout whose tracked files are exactly the release's: an uncommitted edit or a local
// commit that the fast-forward let through stops it too, instead of being built into the app.

import Cocoa

final class Updater {
    let current: String           // e.g. "0.3.2"
    let repo: String              // "owner/name" on GitHub
    let source: String            // the checkout the app was built from, or ""
    private(set) var latest = ""  // e.g. "0.3.3"
    private(set) var tag = ""     // e.g. "v0.3.3"
    private(set) var page = ""    // the release's web page
    private(set) var status = "idle"   // idle | checking | current | available | updating | failed
    private(set) var detail = ""
    var onChange: (() -> Void)?
    private var busy = false

    convenience init() {
        let info = Bundle.main.infoDictionary ?? [:]
        self.init(current: info["CFBundleShortVersionString"] as? String ?? "0.0.0",
                  repo: info["AgentOfficeRepo"] as? String ?? "", source: info["AgentOfficeSource"] as? String ?? "")
    }
    init(current: String, repo r: String, source s: String) {
        self.current = current
        repo = r.range(of: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", options: .regularExpression) != nil ? r : ""
        source = FileManager.default.fileExists(atPath: s + "/.git") && FileManager.default.fileExists(atPath: s + "/scripts/build-app.sh") ? s : ""
    }

    /// Ask GitHub for the latest release. `then` runs on the main queue.
    func check(then: (() -> Void)? = nil) {
        guard !repo.isEmpty, !busy else { then?(); return }
        set("checking", "")
        var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases/latest")!)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("agent-office-updater", forHTTPHeaderField: "User-Agent")
        req.timeoutInterval = 20
        URLSession.shared.dataTask(with: req) { data, resp, err in
            DispatchQueue.main.async {
                defer { then?() }
                guard err == nil, (resp as? HTTPURLResponse)?.statusCode == 200, let data,
                      let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let t = j["tag_name"] as? String, t.range(of: "^v?[0-9]+\\.[0-9]+\\.[0-9]+$", options: .regularExpression) != nil
                else { self.set("failed", "could not reach GitHub"); return }
                self.tag = t
                self.latest = t.hasPrefix("v") ? String(t.dropFirst()) : t
                self.page = j["html_url"] as? String ?? "https://github.com/\(self.repo)/releases"
                UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "updateLastCheck")
                self.set(Updater.newer(self.latest, than: self.current) ? "available" : "current", "")
            }
        }.resume()
    }

    static func newer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p > q }
        }
        return false
    }

    /// Fast-forward the checkout to the release, rebuild into the folder this app is in, relaunch.
    func update() {
        guard status == "available" || status == "failed", !tag.isEmpty, !busy else { return }
        guard !source.isEmpty else {
            if let u = URL(string: page), u.scheme == "https" { NSWorkspace.shared.open(u) }
            return
        }
        busy = true
        set("updating", "fetching \(tag)…")
        let appPath = Bundle.main.bundlePath, dest = (appPath as NSString).deletingLastPathComponent
        let log = NSHomeDirectory() + "/Library/Logs/agent-office-update.log"
        DispatchQueue.global(qos: .userInitiated).async {
            let steps: [(String, [String], String)] = [
                ("fetching \(self.tag)…", ["/usr/bin/git", "-C", self.source, "fetch", "--tags", "origin"], "could not fetch from GitHub"),
                ("moving to \(self.tag)…", ["/usr/bin/git", "-C", self.source, "merge", "--ff-only", "refs/tags/\(self.tag)"],
                 "the checkout has local changes or commits in the way"),
                // what gets built must be the release: an edit nobody committed, or a local commit on
                // top, would be built and run as if it were the release, with nothing to show it
                ("checking the checkout…", ["/usr/bin/git", "-C", self.source, "diff", "--quiet", "refs/tags/\(self.tag)", "--"],
                 "the checkout's files differ from \(self.tag) (uncommitted edits or local commits; see git -C \(self.source) status)"),
                ("building…", ["/bin/bash", self.source + "/scripts/build-app.sh", dest], "the build failed"),
            ]
            FileManager.default.createFile(atPath: log, contents: Data("update to \(self.tag) at \(Date())\n".utf8))
            for (what, args, failure) in steps {
                DispatchQueue.main.async { self.set("updating", what) }
                if Updater.run(args, cwd: self.source, log: log) != 0 {
                    DispatchQueue.main.async {
                        self.busy = false
                        self.set("failed", "\(failure). By hand: cd \(self.source) && git pull && scripts/build-app.sh (log: ~/Library/Logs/agent-office-update.log)")
                    }
                    return
                }
            }
            DispatchQueue.main.async {
                // reopen the freshly built app once this one has quit
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/bin/sh")
                p.arguments = ["-c", "sleep 1; /usr/bin/open \"$0\"", appPath]
                try? p.run()
                NSApp.terminate(nil)
            }
        }
    }

    private static func run(_ args: [String], cwd: String, log: String) -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: args[0])
        p.arguments = Array(args.dropFirst())
        p.currentDirectoryURL = URL(fileURLWithPath: cwd)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
        env["GIT_TERMINAL_PROMPT"] = "0"
        p.environment = env
        let fh = FileHandle(forWritingAtPath: log)
        fh?.seekToEndOfFile()
        p.standardOutput = fh ?? FileHandle.nullDevice
        p.standardError = fh ?? FileHandle.nullDevice
        do { try p.run() } catch { return -1 }
        p.waitUntilExit()
        try? fh?.close()
        return p.terminationStatus
    }

    private func set(_ s: String, _ d: String) { status = s; detail = d; onChange?() }

    var json: [String: Any] {
        ["status": status, "detail": detail, "current": current, "latest": latest, "page": page, "canBuild": !source.isEmpty]
    }
}
