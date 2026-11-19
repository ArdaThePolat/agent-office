// Water reminder (Settings → Remind me to drink water, off by default; the glass on your desk in
// the office turns it on and off too). Every N minutes (any number, 1…480), and only between a
// start and an end time read on this Mac's own clock, the office shows a small card asking you to
// drink some water. A start later than the end runs overnight; equal times mean all day. "Done"
// starts the next interval, "In 10 min" asks again in 10 minutes; unanswered, it asks again after the
// next interval. Outside the hours nothing shows, and the first reminder of the day comes one
// interval after the start. While the window is not on screen a notification says it too.

import Cocoa
import UserNotifications

let WATER_LATER: TimeInterval = 10 * 60
let WATER_RANGE = 1...480                         // minutes the interval may be set to
var waterDue: Date? = nil                         // the next reminder, while one is set
private var waterBox: NSButton?                   // Settings' tick, kept in step with the desk's glass

extension AppDelegate {
    /// On or off. Before this setting existed, a non-zero `waterMinutes` meant on.
    var waterOn: Bool {
        get { defaults.object(forKey: "waterOn") as? Bool ?? (defaults.integer(forKey: "waterMinutes") > 0) }
        set { defaults.set(newValue, forKey: "waterOn"); waterBox?.state = newValue ? .on : .off; scheduleWater() }
    }
    /// The interval in minutes, kept while the reminder is off (60 until set).
    var waterMinutes: Int {
        get { let m = defaults.integer(forKey: "waterMinutes"); return WATER_RANGE.contains(m) ? m : 60 }
        set {
            if defaults.object(forKey: "waterOn") == nil { defaults.set(waterOn, forKey: "waterOn") }   // before the old meaning changes
            defaults.set(min(max(newValue, WATER_RANGE.lowerBound), WATER_RANGE.upperBound), forKey: "waterMinutes"); scheduleWater()
        }
    }
    /// The hours, as minutes after local midnight: 09:00 to 18:00 until set.
    var waterStart: Int {
        get { defaults.object(forKey: "waterStart") as? Int ?? 9 * 60 }
        set { defaults.set(newValue, forKey: "waterStart"); scheduleWater() }
    }
    var waterEnd: Int {
        get { defaults.object(forKey: "waterEnd") as? Int ?? 18 * 60 }
        set { defaults.set(newValue, forKey: "waterEnd"); scheduleWater() }
    }

    /// Is `d` inside the hours, on this Mac's clock and time zone?
    func inWaterHours(_ d: Date) -> Bool {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d), m = (c.hour ?? 0) * 60 + (c.minute ?? 0)
        let s = waterStart, e = waterEnd
        return s == e || (s < e ? (m >= s && m < e) : (m >= s || m < e))
    }

    /// The next reminder: one interval (or `after` seconds) from now, moved to one interval after
    /// the next start when that falls outside the hours; none while it is off.
    func scheduleWater(after s: TimeInterval? = nil) {
        guard waterOn else { waterDue = nil; return }
        let step = TimeInterval(waterMinutes * 60)
        var due = Date().addingTimeInterval(s ?? step)
        if !inWaterHours(due),
           let start = Calendar.current.nextDate(after: due, matching: DateComponents(hour: waterStart / 60, minute: waterStart % 60),
                                                 matchingPolicy: .nextTime) {
            due = start.addingTimeInterval(step)
            if !inWaterHours(due) { due = start }   // hours shorter than one interval: once, at the start
        }
        waterDue = due
    }

    /// Polled with everything else (every 2 s): show the card when one is due.
    func checkWater() {
        guard let due = waterDue, Date() >= due else { return }
        guard inWaterHours(Date()) else { scheduleWater(); return }   // e.g. the Mac slept past the end
        let mins = waterMinutes
        scheduleWater()                                             // unanswered: again after the next interval
        web.evaluateJavaScript("window.showWater && showWater(\(mins))", completionHandler: nil)
        if sound { NSSound(named: "Purr")?.play() }
        if !window.isVisible || window.isMiniaturized || !window.occlusionState.contains(.visible) { notifyWater() }
    }

    /// From the page: the card's "done" / "later", or "toggle" from the glass on the desk.
    func waterAnswered(_ a: String) {
        switch a {
        case "toggle": waterOn.toggle()
        case "later": scheduleWater(after: WATER_LATER)
        default: scheduleWater()
        }
    }

    /// What the page needs for the glass on the desk.
    var waterSnapshot: [String: Any] {
        ["on": waterOn, "minutes": waterMinutes, "start": waterStart, "end": waterEnd,
         "due": waterDue.map { $0.timeIntervalSince1970 as Any } ?? NSNull()]
    }

    func notifyWater() {
        let c = UNUserNotificationCenter.current()
        c.delegate = self
        c.requestAuthorization(options: [.alert, .sound]) { ok, _ in
            guard ok else { return }
            let n = UNMutableNotificationContent()
            n.title = "💧 Time for some water"
            n.body = "A glass of water, then back to it."
            c.add(UNNotificationRequest(identifier: "water", content: n, trigger: nil))
        }
    }

    // ---- Settings: the tick, "Every [25] minutes", "From [09:00] to [18:00]" and a hint, with the
    // top row at `top` (the window's coordinates, from the bottom).
    func waterSettingsViews(top: CGFloat) -> [NSView] {
        let box = NSButton(checkboxWithTitle: "Remind me to drink water", target: self, action: #selector(toggleWater(_:)))
        box.state = waterOn ? .on : .off
        box.frame = NSRect(x: 20, y: top, width: 350, height: 22)
        waterBox = box

        let every = NSTextField(labelWithString: "Every"); every.frame = NSRect(x: 38, y: top - 30, width: 44, height: 20)
        let num = NSTextField(frame: NSRect(x: 84, y: top - 32, width: 48, height: 22))
        let f = NumberFormatter(); f.allowsFloats = false; f.minimum = WATER_RANGE.lowerBound as NSNumber; f.maximum = WATER_RANGE.upperBound as NSNumber
        num.formatter = f; num.integerValue = waterMinutes; num.alignment = .right
        num.target = self; num.action = #selector(typedWaterMinutes(_:)); num.cell?.sendsActionOnEndEditing = true
        let step = NSStepper(frame: NSRect(x: 134, y: top - 33, width: 19, height: 24))
        step.minValue = Double(WATER_RANGE.lowerBound); step.maxValue = Double(WATER_RANGE.upperBound); step.increment = 5
        step.integerValue = waterMinutes; step.target = self; step.action = #selector(steppedWaterMinutes(_:))
        num.tag = 1; step.tag = 2   // found again by tag to keep the two in step
        let minutes = NSTextField(labelWithString: "minutes"); minutes.frame = NSRect(x: 158, y: top - 30, width: 80, height: 20)

        let from = NSTextField(labelWithString: "From"); from.frame = NSRect(x: 38, y: top - 62, width: 44, height: 20)
        let startP = timePicker(waterStart, x: 84, y: top - 64, action: #selector(pickWaterStart(_:)))
        let to = NSTextField(labelWithString: "to"); to.frame = NSRect(x: 186, y: top - 62, width: 20, height: 20)
        let endP = timePicker(waterEnd, x: 208, y: top - 64, action: #selector(pickWaterEnd(_:)))

        let hint = NSTextField(wrappingLabelWithString: "Off by default. Only between these times on this Mac's clock (overnight when the start is later). The glass on your desk turns it on and off. Done starts the next interval, In 10 min asks again in 10 minutes.")
        hint.frame = NSRect(x: 38, y: top - 112, width: 320, height: 44)
        hint.textColor = .secondaryLabelColor; hint.font = .systemFont(ofSize: 11)
        return [box, every, num, step, minutes, from, startP, to, endP, hint]
    }

    private func timePicker(_ mins: Int, x: CGFloat, y: CGFloat, action: Selector) -> NSDatePicker {
        let p = NSDatePicker(frame: NSRect(x: x, y: y, width: 96, height: 24))
        p.datePickerStyle = .textFieldAndStepper; p.datePickerElements = .hourMinute
        p.dateValue = Calendar.current.date(bySettingHour: mins / 60, minute: mins % 60, second: 0, of: Date()) ?? Date()
        p.target = self; p.action = action
        return p
    }
    private func minutesOf(_ p: NSDatePicker) -> Int {
        let c = Calendar.current.dateComponents([.hour, .minute], from: p.dateValue)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    @objc func toggleWater(_ sender: NSButton) { waterOn = sender.state == .on }
    @objc func typedWaterMinutes(_ sender: NSTextField) {
        waterMinutes = sender.integerValue
        sender.integerValue = waterMinutes
        (sender.superview?.viewWithTag(2) as? NSStepper)?.integerValue = waterMinutes
    }
    @objc func steppedWaterMinutes(_ sender: NSStepper) {
        waterMinutes = sender.integerValue
        (sender.superview?.viewWithTag(1) as? NSTextField)?.integerValue = waterMinutes
    }
    @objc func pickWaterStart(_ sender: NSDatePicker) { waterStart = minutesOf(sender) }
    @objc func pickWaterEnd(_ sender: NSDatePicker) { waterEnd = minutesOf(sender) }
}
