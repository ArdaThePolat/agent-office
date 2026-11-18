import Cocoa
import WebKit

/// The terminal under the office: the user's login shell on a pseudo-terminal, drawn by xterm.js
/// (web/terminal.html) in its own web view. The shell starts the first time the pane is shown and
/// keeps running while the pane is hidden; it ends with the app.
final class TerminalPane: NSObject, WKScriptMessageHandler {
    private(set) var view: WKWebView!
    private var loaded = false
    private var master: Int32 = -1
    private var child: pid_t = 0
    private var reader: DispatchSourceRead?
    private var exitWatch: DispatchSourceProcess?
    private var size = winsize(ws_row: 24, ws_col: 80, ws_xpixel: 0, ws_ypixel: 0)
    // Output waits here until the page has taken the previous batches: a command that prints
    // megabytes would otherwise queue more JavaScript calls than the page can run.
    private var pending = Data()
    private var inFlight = 0
    private var readerPaused = false
    private var flushQueued = false
    private static let maxInFlight = 4
    private static let maxBatch = 256 * 1024

    override init() {
        super.init()
        let conf = WKWebViewConfiguration()
        conf.userContentController.add(WeakHandler(self), name: "term")
        view = WKWebView(frame: .zero, configuration: conf)
        view.setValue(false, forKey: "drawsBackground")
    }

    /// Load the page once; its "ready" message starts the shell.
    func load() {
        guard !loaded, let page = Bundle.main.url(forResource: "terminal", withExtension: "html") else { return }
        loaded = true
        view.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
    }

    func focus() {
        view.window?.makeFirstResponder(view)
        view.evaluateJavaScript("window.termFocus && termFocus()", completionHandler: nil)
    }

    /// Hang up on the shell (the app is quitting).
    func stop() {
        if child > 0 { kill(child, SIGHUP) }
    }

    func userContentController(_ c: WKUserContentController, didReceive msg: WKScriptMessage) {
        guard let m = msg.body as? [String: Any], let t = m["t"] as? String else { return }
        switch t {
        case "ready", "restart":
            setSize(m)
            if child == 0 { spawn() }
        case "resize":
            setSize(m)
        case "in":
            if let s = m["d"] as? String { send(Data(s.utf8)) }
        case "bin":
            if let s = m["d"] as? String { send(Data(s.unicodeScalars.map { UInt8(truncatingIfNeeded: $0.value) })) }
        default: break
        }
    }

    private func setSize(_ m: [String: Any]) {
        guard let cols = m["cols"] as? Int, let rows = m["rows"] as? Int, cols > 0, rows > 0 else { return }
        size.ws_col = UInt16(clamping: cols); size.ws_row = UInt16(clamping: rows)
        if master >= 0 { _ = ioctl(master, TIOCSWINSZ, &size) }
    }

    private func send(_ d: Data) {
        guard master >= 0 else { return }
        d.withUnsafeBytes { raw in
            var off = 0
            while off < raw.count {
                let n = write(master, raw.baseAddress! + off, raw.count - off)
                if n > 0 { off += n } else if n < 0 && (errno == EAGAIN || errno == EINTR) { usleep(1000) } else { break }
            }
        }
    }

    // ---- the shell ----

    private func spawn() {
        let pw = getpwuid(getuid())
        var shell = pw.flatMap { String(cString: $0.pointee.pw_shell) } ?? ""
        if shell.isEmpty || access(shell, X_OK) != 0 { shell = "/bin/zsh" }
        let home = pw.flatMap { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        var env = ProcessInfo.processInfo.environment
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["TERM_PROGRAM"] = "AgentOffice"
        env["PWD"] = home
        if env["LANG"] == nil { env["LANG"] = "en_US.UTF-8" }
        // a login shell, as Terminal and iTerm start it: the "-" in argv[0] makes it read the profile
        let argv = cStrings(["-" + (shell as NSString).lastPathComponent])
        let envp = cStrings(env.map { "\($0.key)=\($0.value)" })
        let path = strdup(shell), dir = strdup(home)
        defer { free(path); free(dir); argv.forEach { free($0) }; envp.forEach { free($0) } }

        var fd: Int32 = -1
        // Only async-signal-safe calls between fork and exec: everything above was built first.
        let pid = forkpty(&fd, nil, nil, &size)
        if pid == 0 {
            _ = chdir(dir)
            _ = execve(path, argv, envp)
            _exit(127)
        }
        guard pid > 0 else { return }
        child = pid
        master = fd
        _ = fcntl(fd, F_SETFD, FD_CLOEXEC)                          // not inherited by the app's other children
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)

        let r = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
        r.setEventHandler { [weak self] in self?.readOutput() }
        r.resume()
        reader = r
        let w = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
        w.setEventHandler { [weak self] in self?.shellExited() }
        w.resume()
        exitWatch = w
    }

    private func cStrings(_ a: [String]) -> [UnsafeMutablePointer<CChar>?] { a.map { strdup($0) } + [nil] }

    private func readOutput() {
        var buf = [UInt8](repeating: 0, count: 65536)
        while pending.count < Self.maxBatch {
            let n = read(master, &buf, buf.count)
            if n > 0 { pending.append(buf, count: n) } else { break }
        }
        flush()
    }

    private func flush() {
        guard !pending.isEmpty else { return }
        if inFlight >= Self.maxInFlight {
            if !readerPaused { reader?.suspend(); readerPaused = true }
            return
        }
        // gather what arrives within a few milliseconds into one call
        guard !flushQueued else { return }
        flushQueued = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.004) { [weak self] in
            guard let self else { return }
            self.flushQueued = false
            let chunk = self.pending.prefix(Self.maxBatch)
            self.pending.removeFirst(chunk.count)
            self.inFlight += 1
            self.view.evaluateJavaScript("termWrite('\(chunk.base64EncodedString())')") { [weak self] _, _ in
                guard let self else { return }
                self.inFlight -= 1
                if self.readerPaused && self.inFlight < Self.maxInFlight { self.readerPaused = false; self.reader?.resume() }
                self.flush()
            }
            if !self.pending.isEmpty { self.flush() }
        }
    }

    private func shellExited() {
        var status: Int32 = 0
        waitpid(child, &status, WNOHANG)
        // what is still in the pipe is the shell's last output: show it before the notice
        if master >= 0 { readOutput() }
        if readerPaused { reader?.resume(); readerPaused = false }
        reader?.cancel(); reader = nil
        exitWatch?.cancel(); exitWatch = nil
        if master >= 0 { close(master); master = -1 }
        child = 0
        let code = (status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)
        let notify: () -> Void = { [weak self] in self?.view.evaluateJavaScript("termExited(\(code))", completionHandler: nil) }
        // after the output still on its way to the page
        if pending.isEmpty && inFlight == 0 { notify() } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: notify) }
    }
}

/// WKUserContentController keeps its handlers strongly; this keeps the pane free to go.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}

/// The office above, the terminal below; the divider drags, and its place is remembered.
final class OfficeSplit: NSSplitView, NSSplitViewDelegate {
    static let officeMin: CGFloat = 200
    static let terminalMin: CGFloat = 80

    init(office: NSView, terminal: NSView) {
        super.init(frame: .zero)
        isVertical = false
        dividerStyle = .thin
        delegate = self
        addArrangedSubview(office)
        addArrangedSubview(terminal)
        // the office takes the window's resizing; the terminal keeps its height
        setHoldingPriority(.defaultLow - 1, forSubviewAt: 0)
        setHoldingPriority(.defaultLow + 10, forSubviewAt: 1)
    }
    required init?(coder: NSCoder) { fatalError() }

    override var dividerColor: NSColor { NSColor(red: 0.25, green: 0.23, blue: 0.32, alpha: 1) }

    func splitView(_ s: NSSplitView, constrainMinCoordinate p: CGFloat, ofSubviewAt i: Int) -> CGFloat {
        max(p, Self.officeMin)
    }
    func splitView(_ s: NSSplitView, constrainMaxCoordinate p: CGFloat, ofSubviewAt i: Int) -> CGFloat {
        min(p, s.bounds.height - Self.terminalMin - s.dividerThickness)
    }
    func splitView(_ s: NSSplitView, canCollapseSubview v: NSView) -> Bool { false }
}
