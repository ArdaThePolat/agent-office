import Cocoa
import WebKit

/// The terminal beside the office: tabs of the user's login shell, each on its own pseudo-terminal,
/// drawn by xterm.js (web/terminal.html) in one web view. The page owns the tabs and asks for a
/// shell per tab; a shell keeps running while the pane is hidden, and ends with its tab or the app.
final class TerminalPane: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private(set) var view: WKWebView!
    private var loaded = false
    private var shells: [Int: Shell] = [:]
    /// How many tabs the page shows: ⌘W closes a tab only while there is more than one.
    private(set) var tabCount = 0
    var onDrag: (() -> Void)?                                     // the grip was pressed (AgentOffice.swift follows the drag)

    override init() {
        super.init()
        let conf = WKWebViewConfiguration()
        conf.userContentController.add(WeakHandler(self), name: "term")
        view = TermWebView(frame: .zero, configuration: conf)
        view.setValue(false, forKey: "drawsBackground")
        view.navigationDelegate = self
    }

    /// This view carries a handler that types into your shell, so the one page it may show is
    /// terminal.html: any other navigation (a link in the output, say) is cancelled.
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let u = a.request.url
        decisionHandler(u?.isFileURL == true && u?.lastPathComponent == "terminal.html" ? .allow : .cancel)
    }

    var isLoaded: Bool { loaded }

    /// Load the page once; it opens its first tab, which starts a shell.
    func load() {
        guard !loaded, let page = Bundle.main.url(forResource: "terminal", withExtension: "html") else { return }
        loaded = true
        view.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
    }

    func focus() {
        view.window?.makeFirstResponder(view)
        js("window.termFocus && termFocus()")
    }

    /// Whether typing goes to the terminal right now.
    var hasFocus: Bool {
        guard !view.isHidden, let r = view.window?.firstResponder as? NSView else { return false }
        return r.isDescendant(of: view)
    }

    func newTab() { js("termNewTab()") }
    func closeTab() { js("termCloseTab()") }
    func selectTab(by step: Int) { js("termStep(\(step))") }

    /// Hang up on every shell (the app is quitting).
    func stop() { shells.values.forEach { $0.hangUp() } }

    private func js(_ s: String, _ done: (() -> Void)? = nil) {
        view.evaluateJavaScript(s) { _, _ in done?() }
    }

    func userContentController(_ c: WKUserContentController, didReceive msg: WKScriptMessage) {
        guard let m = msg.body as? [String: Any], let t = m["t"] as? String else { return }
        if t == "tabs" { tabCount = m["n"] as? Int ?? 0; return }
        if t == "drag" { onDrag?(); return }                     // the grip: the app tracks the drag
        guard let id = m["id"] as? Int else { return }
        switch t {
        case "open", "restart":
            let sh = shells[id] ?? Shell(id: id) { [weak self] s, done in self?.js(s, done) }
            shells[id] = sh
            sh.setSize(m)
            sh.spawn()
        case "resize":
            shells[id]?.setSize(m)
        case "in":
            if let s = m["d"] as? String { shells[id]?.send(Data(s.utf8)) }
        case "bin":
            if let s = m["d"] as? String { shells[id]?.send(Data(s.unicodeScalars.map { UInt8(truncatingIfNeeded: $0.value) })) }
        case "close":
            shells.removeValue(forKey: id)?.closeTab()
        default: break
        }
    }
}

/// One tab's shell on a pseudo-terminal. Its output goes to the page as termWrite(id, base64).
private final class Shell {
    let id: Int
    private let js: (String, @escaping () -> Void) -> Void
    private var master: Int32 = -1
    private var child: pid_t = 0
    private var closed = false
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
    // Input waits here while the program in front is not reading (a dev server, `sleep`): a write
    // source sends it as the terminal takes it, so typing or a paste never blocks the app. Beyond
    // maxInput the rest is dropped, as a terminal drops a paste that goes nowhere.
    private var toShell = Data()
    private var writer: DispatchSourceWrite?
    private static let maxInput = 1 << 20

    init(id: Int, js: @escaping (String, @escaping () -> Void) -> Void) { self.id = id; self.js = js }

    func setSize(_ m: [String: Any]) {
        guard let cols = m["cols"] as? Int, let rows = m["rows"] as? Int, cols > 0, rows > 0 else { return }
        size.ws_col = UInt16(clamping: cols); size.ws_row = UInt16(clamping: rows)
        if master >= 0 { _ = ioctl(master, TIOCSWINSZ, &size) }
    }

    func hangUp() { if child > 0 { kill(child, SIGHUP) } }

    // A closed tab's shell holds itself until it has exited, so it is still reaped.
    private var keepAlive: Shell?

    /// The tab is gone: hang up, and say nothing more to the page about it.
    func closeTab() {
        closed = true
        if child > 0 { keepAlive = self }
        hangUp()
    }

    func send(_ d: Data) {
        guard master >= 0 else { return }
        toShell.append(d.prefix(max(0, Self.maxInput - toShell.count)))
        drainInput()
    }
    /// Write what the terminal takes now; when it is full, wait for it to be writable again.
    private func drainInput() {
        while !toShell.isEmpty {
            let n = toShell.withUnsafeBytes { write(master, $0.baseAddress!, $0.count) }
            if n > 0 { toShell.removeFirst(n); continue }
            if n < 0 && errno == EINTR { continue }
            if n < 0 && errno == EAGAIN {
                if writer == nil {
                    let w = DispatchSource.makeWriteSource(fileDescriptor: master, queue: .main)
                    w.setEventHandler { [weak self] in self?.drainInput() }
                    w.resume()
                    writer = w
                }
                return
            }
            toShell.removeAll(); break                                 // the terminal is gone
        }
        writer?.cancel(); writer = nil
    }

    func spawn() {
        guard child == 0, !closed else { return }
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
        w.setEventHandler { [weak self] in self?.exited() }
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
        if closed { pending.removeAll() } else { flush() }
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
            self.js("termWrite(\(self.id), '\(chunk.base64EncodedString())')") { [weak self] in
                guard let self else { return }
                self.inFlight -= 1
                if self.readerPaused && self.inFlight < Self.maxInFlight { self.readerPaused = false; self.reader?.resume() }
                self.flush()
            }
            if !self.pending.isEmpty { self.flush() }
        }
    }

    private func exited() {
        var status: Int32 = 0
        waitpid(child, &status, WNOHANG)
        // what is still in the pipe is the shell's last output: show it before the notice
        if master >= 0 { readOutput() }
        if readerPaused { reader?.resume(); readerPaused = false }
        reader?.cancel(); reader = nil
        writer?.cancel(); writer = nil; toShell.removeAll()
        exitWatch?.cancel(); exitWatch = nil
        if master >= 0 { close(master); master = -1 }
        child = 0
        guard !closed else { keepAlive = nil; return }
        let code = (status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)
        let notify: () -> Void = { [weak self] in
            guard let self else { return }
            self.js("termExited(\(self.id), \(code))") {}
        }
        // after the output still on its way to the page
        if pending.isEmpty && inFlight == 0 { notify() } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: notify) }
    }
}

/// A click on a tab, or the +, acts even while the window is not the active one.
private final class TermWebView: WKWebView {
    override func acceptsFirstMouse(for e: NSEvent?) -> Bool { true }
}

/// WKUserContentController keeps its handlers strongly; this keeps the pane free to go.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}

/// Moving the terminal by dragging its grip: while the button is down, a see-through layer over the
/// window lights the part the terminal would take (the side nearest the mouse); letting go moves it
/// there, Esc or letting go outside the window leaves it where it was.
final class SideDrag {
    private let window: NSWindow
    private var monitor: Any?
    private let overlay: NSWindow, shade = SideShade()
    private var side: TerminalSide?
    private let done: (TerminalSide?) -> Void

    init(window: NSWindow, done: @escaping (TerminalSide?) -> Void) {
        self.window = window; self.done = done
        overlay = NSWindow(contentRect: window.contentLayoutRect, styleMask: .borderless, backing: .buffered, defer: false)
        overlay.isOpaque = false; overlay.backgroundColor = .clear; overlay.ignoresMouseEvents = true; overlay.hasShadow = false
        overlay.contentView = shade
    }
    func begin() {
        overlay.setFrame(window.convertToScreen(window.contentLayoutRect), display: false)
        window.addChildWindow(overlay, ordered: .above)
        update(NSEvent.mouseLocation)
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp, .keyDown]) { [weak self] e in
            guard let self else { return e }
            switch e.type {
            case .leftMouseDragged: self.update(NSEvent.mouseLocation); return nil
            case .leftMouseUp: self.update(NSEvent.mouseLocation); self.end(self.side); return nil
            case .keyDown where e.keyCode == 53: self.end(nil); return nil          // Esc
            default: return e
            }
        }
    }
    /// The side nearest the mouse, or none outside the window.
    private func update(_ screenPoint: NSPoint) {
        let r = overlay.frame
        guard r.contains(screenPoint) else { side = nil; shade.show(nil); return }
        side = TerminalSide.nearest(x: (screenPoint.x - r.minX) / r.width, y: (screenPoint.y - r.minY) / r.height)
        shade.show(side)
    }
    private func end(_ s: TerminalSide?) {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        window.removeChildWindow(overlay); overlay.orderOut(nil)
        done(s)
    }
}

/// The lit part of the window while dragging: a third of it on the side the terminal would take.
final class SideShade: NSView {
    private var side: TerminalSide?
    func show(_ s: TerminalSide?) { side = s; needsDisplay = true }
    override func draw(_ dirty: NSRect) {
        guard let side else { return }
        let b = bounds, t: CGFloat = 1 / 3
        let r: NSRect
        switch side {
        case .bottom: r = NSRect(x: 0, y: 0, width: b.width, height: b.height * t)
        case .top: r = NSRect(x: 0, y: b.height * (1 - t), width: b.width, height: b.height * t)
        case .left: r = NSRect(x: 0, y: 0, width: b.width * t, height: b.height)
        case .right: r = NSRect(x: b.width * (1 - t), y: 0, width: b.width * t, height: b.height)
        }
        NSColor(red: 0.56, green: 0.84, blue: 0.71, alpha: 0.22).setFill(); r.fill()
        let edge = NSBezierPath(rect: r.insetBy(dx: 1, dy: 1)); edge.lineWidth = 2
        NSColor(red: 0.56, green: 0.84, blue: 0.71, alpha: 0.9).setStroke(); edge.stroke()
        // "Terminal" over the side's name, as large as fits the lit part (a side strip is narrow)
        let lines = ["Terminal", side.title] as [NSString]
        var font = NSFont.boldSystemFont(ofSize: 15)
        while font.pointSize > 9, lines.contains(where: { $0.size(withAttributes: [.font: font]).width > r.width - 16 }) {
            font = NSFont.boldSystemFont(ofSize: font.pointSize - 1)
        }
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white]
        let h = lines[0].size(withAttributes: attrs).height
        for (i, l) in lines.enumerated() {
            let w = l.size(withAttributes: attrs).width
            l.draw(at: NSPoint(x: r.midX - w / 2, y: r.midY + (i == 0 ? 0 : -h)), withAttributes: attrs)
        }
    }
}

/// Which side of the office the terminal sits on.
enum TerminalSide: String, CaseIterable {
    case bottom, top, left, right
    var title: String { rawValue.capitalized }
    var vertical: Bool { self == .left || self == .right }        // side by side
    var terminalFirst: Bool { self == .top || self == .left }
    /// The side whose edge is nearest a point in the window (0…1 across, 0…1 up from the bottom).
    static func nearest(x: CGFloat, y: CGFloat) -> TerminalSide {
        [(x, TerminalSide.left), (1 - x, .right), (y, .bottom), (1 - y, .top)].min { $0.0 < $1.0 }!.1
    }
}

/// The office and the terminal side by side or one above the other; the divider drags, and its
/// place is remembered for each side.
final class OfficeSplit: NSSplitView, NSSplitViewDelegate {
    private let office: NSView, terminal: NSView
    private(set) var side: TerminalSide = .bottom
    private var unsized = false                                     // nothing saved for this side yet

    init(office: NSView, terminal: NSView, side: TerminalSide) {
        self.office = office; self.terminal = terminal
        super.init(frame: .zero)
        dividerStyle = .thin
        delegate = self
        place(side)
    }
    required init?(coder: NSCoder) { fatalError() }

    /// The least the office and the terminal each keep along the divider's axis.
    var officeMin: CGFloat { 200 }
    var terminalMin: CGFloat { side.vertical ? 160 : 80 }
    private var length: CGFloat { side.vertical ? bounds.width : bounds.height }
    private var terminalLength: CGFloat { side.vertical ? terminal.frame.width : terminal.frame.height }

    /// Put the terminal on `side`. Each side has its own saved divider; bottom keeps the name the
    /// single-side layout saved under, so an existing height carries over.
    func place(_ s: TerminalSide) {
        side = s
        autosaveName = nil
        arrangedSubviews.forEach { removeArrangedSubview($0); $0.removeFromSuperview() }
        isVertical = s.vertical
        for v in s.terminalFirst ? [terminal, office] : [office, terminal] { addArrangedSubview(v) }
        // the office takes the window's resizing; the terminal keeps its size
        let t = s.terminalFirst ? 0 : 1
        setHoldingPriority(.defaultLow + 10, forSubviewAt: t)
        setHoldingPriority(.defaultLow - 1, forSubviewAt: 1 - t)
        let name = s == .bottom ? "AgentOfficeTerminal" : "AgentOfficeTerminal-" + s.rawValue
        unsized = UserDefaults.standard.object(forKey: "NSSplitView Subview Frames " + name) == nil
        autosaveName = name
        adjustSubviews()
    }

    /// First time on this side, or a saved size that no longer fits: a third of the window.
    func fitTerminal() {
        guard !terminal.isHidden else { return }
        adjustSubviews()
        let l = length, tl = terminalLength
        guard unsized || tl < terminalMin || l - tl < officeMin else { return }
        unsized = false
        let want = max(terminalMin, (l / 3).rounded())
        setPosition(side.terminalFirst ? want : l - want - dividerThickness, ofDividerAt: 0)
    }

    override var dividerColor: NSColor { NSColor(red: 0.25, green: 0.23, blue: 0.32, alpha: 1) }

    func splitView(_ s: NSSplitView, constrainMinCoordinate p: CGFloat, ofSubviewAt i: Int) -> CGFloat {
        max(p, side.terminalFirst ? terminalMin : officeMin)
    }
    func splitView(_ s: NSSplitView, constrainMaxCoordinate p: CGFloat, ofSubviewAt i: Int) -> CGFloat {
        min(p, length - (side.terminalFirst ? officeMin : terminalMin) - dividerThickness)
    }
    func splitView(_ s: NSSplitView, canCollapseSubview v: NSView) -> Bool { false }
}
