// Keeping macOS's permissions (Desktop folder, Accessibility, Automation, Local Network) across
// updates, asked for by the app instead of a command in a terminal.
//
// macOS remembers a permission by the app's signature. Signed ad-hoc, every build is a new app to
// it and every permission is asked for again; signed with the local certificate that
// signing-setup.sh makes, every build is the same app (scripts/build-app.sh uses it when it is
// there). The app offers that setup before an update, the moment it matters, and from Settings.
// The script runs from the app's own Resources, so a checkout still on an older version works too.
// It asks macOS for your password once, to trust the certificate for code signing.

import Cocoa

let SIGNING_ID = "Agent Office Local Signing"

extension AppDelegate {
    /// True when the local certificate is in the keychain and trusted for code signing.
    static func signingReady() -> Bool {
        let p = Process(), out = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        p.arguments = ["find-identity", "-v", "-p", "codesigning"]
        p.standardOutput = out; p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return false }
        let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        p.waitUntilExit()
        return text.contains("\"\(SIGNING_ID)\"")
    }

    /// Before an update: offer the setup once (unless it is done or was declined for good), then
    /// go on with `then` whatever the answer.
    func offerSigning(then: @escaping () -> Void) {
        guard !defaults.bool(forKey: "signingDeclined") else { return then() }
        DispatchQueue.global(qos: .userInitiated).async {
            let ready = AppDelegate.signingReady()
            DispatchQueue.main.async {
                if ready { return then() }
                let a = NSAlert()
                a.messageText = "Keep Agent Office's permissions after updates?"
                a.informativeText = "Each update is a new app to macOS, so it asks again for the Desktop folder, Accessibility, Automation and Local Network. Set Up makes a certificate on this Mac that signs Agent Office's builds and nothing else, so every update is the same app and a permission you give stays.\n\nmacOS asks for your password once, to trust it. You are asked for each permission one last time after this update. If a dialog asks whether codesign may use the key, choose Always Allow."
                a.addButton(withTitle: "Set Up"); a.addButton(withTitle: "Not Now"); a.addButton(withTitle: "Don't Ask Again")
                NSApp.activate(ignoringOtherApps: true)
                switch a.runModal() {
                case .alertFirstButtonReturn: self.runSigningSetup { _ in then() }
                case .alertThirdButtonReturn: self.defaults.set(true, forKey: "signingDeclined"); then()
                default: then()
                }
            }
        }
    }

    /// Settings → Set Up…
    @objc func setUpSigning() {
        runSigningSetup { ok in
            self.refreshSettingsSigning()
            let a = NSAlert()
            a.messageText = ok ? "Set up" : "Not set up"
            a.informativeText = ok
                ? "The next update (or scripts/build-app.sh) signs Agent Office with it. macOS asks for each permission one last time after that build, then keeps them."
                : "The certificate could not be set up. You can run it in a terminal to see why: scripts/signing-setup.sh in your checkout."
            a.runModal()
        }
    }

    /// Run signing-setup.sh from Resources off the main thread; `then(ok)` on the main thread.
    func runSigningSetup(then: @escaping (Bool) -> Void) {
        guard let script = Bundle.main.path(forResource: "signing-setup", ofType: "sh") else { return then(false) }
        DispatchQueue.global(qos: .userInitiated).async {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/bash"); p.arguments = [script]
            p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
            var ok = false
            if (try? p.run()) != nil { p.waitUntilExit(); ok = p.terminationStatus == 0 && AppDelegate.signingReady() }
            DispatchQueue.main.async { then(ok) }
        }
    }

    func refreshSettingsSigning() {
        DispatchQueue.global(qos: .utility).async {
            let ready = AppDelegate.signingReady()
            DispatchQueue.main.async {
                self.settingsSigningLabel?.stringValue = ready ? "Keep permissions: yes" : "Keep permissions: no"
                self.settingsSigningLabel?.toolTip = ready
                    ? "Builds are signed with this Mac's certificate: updates keep macOS's permissions."
                    : "Builds are signed ad-hoc: macOS asks for its permissions again after each update."
                self.settingsSigningButton?.isEnabled = !ready
                self.settingsSigningButton?.title = ready ? "Set Up ✓" : "Set Up…"
            }
        }
    }
}
