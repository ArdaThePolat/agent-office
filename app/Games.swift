// The mini-games' side in the app (the games themselves are web/games.js): game messages between the
// page and the room, scores to the room's leaderboard, and a notification when an agent needs you
// while a game is open.

import Cocoa
import UserNotifications
import WebKit

/// The first-person game (web/games-defuse.js) turns with the mouse, which needs the page to lock the
/// pointer. WebKit asks the web view's UI delegate first, through a method of its private delegate
/// protocol; without an answer the lock never comes. The page asks only on a click in that game, and
/// Esc (or leaving the window) frees it. On a WebKit that asks some other way, nothing is locked and
/// the game turns with the pointer over it instead.
extension AppDelegate: WKUIDelegate {
    @objc(_webViewDidRequestPointerLock:completionHandler:)
    func webViewDidRequestPointerLock(_ webView: WKWebView, completionHandler: @escaping (Bool) -> Void) { completionHandler(true) }
    @objc(_webViewDidLosePointerLock:)
    func webViewDidLosePointerLock(_ webView: WKWebView) {}
}

extension AppDelegate {
    /// Room → Mini-Games… (also G in the office).
    @objc func showGames() {
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        web.evaluateJavaScript("window.openGames && openGames()", completionHandler: nil)
    }

    /// From the page: {game: JSON of a game message}, {score: "board|value"}, {gameNotice: text},
    /// {badge: "🏅 12"}.
    func gameMessage(_ body: [String: String]) {
        if let g = body["game"], let d = g.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { roomClient?.sendGame(obj) }
        if let s = body["score"] {
            let parts = s.split(separator: "|")
            if parts.count == 2, let v = Double(parts[1]), v.isFinite { roomClient?.submitScore(String(parts[0]), v) }
        }
        if let t = body["gameNotice"] { gameNotice(t) }
        // the achievements' medal on your character, kept for the next connection
        if let b = body["badge"] { defaults.set(b, forKey: "gameBadge"); roomClient?.setBadge(b) }
    }

    /// A game message from the room, to the page at once (not with the next snapshot).
    func gameIn(_ msg: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: msg), let json = String(data: d, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.gameIn && gameIn(\(json))", completionHandler: nil)
    }

    /// An agent needs you while you play: a notification, so it reaches you even with the game in
    /// front (the page also shows it in the game).
    func gameNotice(_ text: String) {
        let c = UNUserNotificationCenter.current()
        c.delegate = self
        c.requestAuthorization(options: [.alert, .sound]) { ok, _ in
            guard ok else { return }
            let n = UNMutableNotificationContent()
            n.title = "An agent needs you"
            n.body = String(text.prefix(200))
            n.sound = .default
            c.add(UNNotificationRequest(identifier: "game-\(Date().timeIntervalSince1970)", content: n, trigger: nil))
        }
    }
}
