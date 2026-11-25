// Restore My VPN, on: after the last install or check, once our tunnel is down, the Restore My VPN Shortcut's back run
// sets the VPN ours took the place of, once per queue. With no other VPN up before, or none remembered, nothing runs.
// Unasked only while the app stayed in front: once it was left or killed, the page is told (restore.due) and the back
// run waits for the person's answer (restore.answer). RestoreDue has the rules, RestoreShortcutBridge opens the Shortcut
// and judges it by the other VPN being up, not by Set VPN's error.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import UIKit

enum RestoreBack {
    // a file, not UserDefaults: after iFizBox's own update the new copy sometimes read UserDefaults' value from before
    // the close (F438a, iOS 27), and asked again for a VPN already brought back
    private static let owedFile = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("ifizbox.vpn.backOwed")
    private static let rememberedKey = "ifizbox.vpn.remembered"
    private static let neverKey = "ifizbox.vpn.backNever"
    static let again: TimeInterval = 2 // how often a look that must wait, also for an answer, looks again, the app in front

    private static let lock = NSLock()
    private static var looking = false // guarded by lock: a look, or its wait for the next one, goes on
    private static var saidWaiting = false // guarded by lock: one line per wait
    private static var left = true // guarded by lock: the app was left since it was owed; at launch, it was killed
    private static var asking = false // guarded by lock: what the page was last told

    /// Ours took another VPN's place, and it wasn't brought back yet. Kept, for an app killed before it was.
    private static var owed: Bool {
        get { (try? Data(contentsOf: owedFile)) == Data("1".utf8) }
        set {
            try? FileManager.default.createDirectory(at: owedFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            do { try Data((newValue ? "1" : "0").utf8).write(to: owedFile, options: .atomic) } catch { log("owed not kept: \(error)") }
        }
    }
    private static var held: Bool { lock.lock(); defer { lock.unlock() }; return left }
    private static func setLeft(_ on: Bool) { lock.lock(); left = on; lock.unlock() }

    /// A store run passed: the Shortcut has a VPN to set.
    static var remembered: Bool { UserDefaults.standard.bool(forKey: rememberedKey) }
    /// The person said never: no return asks or runs. Right after an install it still runs.
    static var never: Bool { UserDefaults.standard.bool(forKey: neverKey) }

    static func stored() { UserDefaults.standard.set(true, forKey: rememberedKey) }
    static func notStored() { UserDefaults.standard.set(false, forKey: rememberedKey) }

    private static func log(_ s: String) { LocalVPN.log("\(RestoreShortcut.shortcutName): \(s)") }

    /// Follows the app being left; on the main thread, once, before AppFront's: its return looks.
    static func watch() {
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { _ in
            wentAt = Date()
            if away() { setLeft(true) }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { _ in
            if let t = wentAt, RestoreDue.leftOnTrip(Date().timeIntervalSince(t)) { setLeft(true) }
        }
    }
    private static var wentAt: Date? // on the main thread
    /// The person left; a Cellular Installs run still going on went to Shortcuts by itself.
    private static func away() -> Bool { !CellularShortcut.running }

    /// Under LocalVPN's startLock, before ours is enabled or started: what is up then is what it takes the place of.
    /// One still held from before begins anew: that VPN came up since.
    static func note() {
        guard LocalVPN.restore, !owed || held, LocalVPN.otherVPNUp() else { return }
        guard remembered else { return log("another VPN is on, none is remembered: nothing brings it back") }
        setLeft(!IDevice.AppFront.now && away())
        owed = true
        tell(false)
        log("another VPN is on: it is brought back after the queue")
    }

    /// The setting was turned off: turned on again, it asks again too.
    static func forget() {
        owed = false
        UserDefaults.standard.set(false, forKey: neverKey)
        tell(false)
    }

    /// After a stop, at launch and on coming back. Never blocks.
    static func look() {
        guard owed, LocalVPN.restore else { return }
        if isClosing { return }
        lock.lock(); let already = looking; looking = true; lock.unlock()
        guard !already else { return }
        DispatchQueue.global(qos: .utility).async { turn() }
    }

    private static func turn() {
        if isClosing { return done() }
        let n = now()
        let step = owed && LocalVPN.restore ? RestoreDue.step(n) : .drop
        switch step {
        case .drop:
            // looked at again with no start going on: one may just have taken that VPN's place once more
            LocalVPN.withNoStart {
                guard owed, RestoreDue.step(now()) == .drop else { return }
                owed = false
                log("\(never && held ? "the app was left: not asked any more" : "nothing to bring back"); up tunnels: \(LocalVPN.tunnelList(LocalVPN.tunnelAddresses()))")
            }
            done()
            if !owed { tell(false) } else { DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + again) { look() } }
        case .onReturn:
            if away() { setLeft(true) }
            say("the app was left: asks at its return")
            done()
            if IDevice.AppFront.now { look() } // it came back while this looked
        case .later:
            if n.going { tell(false) } // not for a menu over the app
            say("waits; path: \(LocalVPN.Path.described())")
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + again) { turn() }
        case .ask:
            tell(true)
            // goes on looking: another VPN may come up meanwhile
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + again) { turn() }
        case .back:
            // under startLock: an install that starts now waits, so Set VPN never takes ours down
            let ran = LocalVPN.withNoStart { () -> Bool in
                // the next app began, or the app was left, meanwhile
                guard owed, LocalVPN.restore, RestoreDue.step(now()) == .back else { return false }
                return !run().due
            }
            if ran { return done() }
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + again) { turn() }
        }
    }

    // ---- iFizBox's own update (CloseForUpdate, the This iPhone route): the back run before it closes

    /// The most closing() adds to the close: the exit doesn't wait longer for it.
    static let closeLimit: TimeInterval = 15
    /// Read before the close begins: a back run may be due.
    static var mayClose: Bool { owed && LocalVPN.restore && remembered && !held }
    private static var closingRun = false // guarded by lock: looks stop, the close has the owed run
    static var isClosing: Bool { lock.lock(); defer { lock.unlock() }; return closingRun }

    /// Blocking, never on the main thread, ours just taken down for good (LocalVPN.downToClose): the back run, when it
    /// can run unasked, and Shortcuts' way back here: iOS lets an old copy opened after the exit keep it waiting. What
    /// uses ours still (the update's own connection) is over with it. Owed still when Shortcuts wasn't opened.
    static func closing() {
        guard mayClose else { return }
        lock.lock(); closingRun = true; lock.unlock()
        let t0 = Date()
        // a short wait, a look may be in a back run of its own: with the run's 3 s for the app and 10 s for Shortcuts to
        // open it stays under closeLimit, so a run that didn't open is owed again before the exit
        LocalVPN.withNoStart(before: t0.addingTimeInterval(1)) {
            var n = now()
            n.waiting = false // the update itself
            guard mayClose, RestoreDue.step(n) == .back else { return log("not run before the close; owed \(owed)") }
            let r = run()
            log("before the close: \(r.error ?? "done") in \(String(format: "%.1f", Date().timeIntervalSince(t0))) s")
            while !r.due, !CellularShortcutBridge.active(), Date().timeIntervalSince(t0) < closeLimit { Thread.sleep(forTimeInterval: 0.1) }
            log("before the close: \(CellularShortcutBridge.active() ? "back in front" : "not back in front")")
        }
    }

    /// Under startLock: the back run. due: Shortcuts wasn't opened, so it is owed still.
    private static func run() -> (error: String?, text: String?, due: Bool) {
        owed = false // before Shortcuts opens: an app killed meanwhile doesn't open it again
        let r = RestoreShortcutBridge.back()
        let active = CellularShortcutBridge.active()
        let due = LocalVPN.restore && RestoreDue.stillDue(r.error, active: active)
        if due { owed = true }
        return (r.error, r.text, due)
    }

    // ---- The question (restore.due, restore.answer)

    /// Told on every change: a held back run waits for an answer, or no longer. Set on the main thread.
    static var onAsking: ((Bool) -> Void)?
    static var isAsking: Bool { lock.lock(); defer { lock.unlock() }; return asking }

    private static func tell(_ on: Bool) {
        lock.lock()
        let now = on && left && owed, changed = now != asking // an answer may have come since the look
        asking = now
        lock.unlock()
        guard changed else { return }
        log(now ? "the app was left: asks first" : "asks no more")
        DispatchQueue.main.async { onAsking?(isAsking) }
    }

    /// Blocking, never on the main thread. The error: not_due, later (an install goes on or there is no network: it runs
    /// after that, the app in front until then), on_already, or the back run's.
    static func answer(_ a: RestoreDue.Answer) -> (error: String?, text: String?) {
        log("answer: \(a.rawValue)")
        if a == .never { UserDefaults.standard.set(true, forKey: neverKey) }
        let r = LocalVPN.withNoStart { () -> (error: String?, text: String?) in
            guard owed, held, LocalVPN.restore else { return (a == .on ? "not_due" : nil, nil) }
            switch RestoreDue.outcome(a, RestoreDue.step(now())) {
            case .drop:
                owed = false
                tell(false)
                return (a == .on ? "on_already" : nil, nil)
            case .keep:
                return ("not_opened", nil)
            case .approve:
                setLeft(false) // left once more, it asks again
                tell(false)
                return ("later", nil)
            case .run:
                setLeft(false)
                tell(false)
                let r = run()
                return (r.due ? "later" : r.error, r.text)
            }
        }
        look()
        return r
    }

    private static func done() { lock.lock(); looking = false; saidWaiting = false; lock.unlock() }
    private static func say(_ s: String) {
        lock.lock(); let said = saidWaiting; saidWaiting = true; lock.unlock()
        if !said { log(s) }
    }

    /// Blocking, never on the main thread.
    private static func now() -> RestoreDue.Now {
        let ours = LocalVPN.state()
        return RestoreDue.Now(front: IDevice.AppFront.now, active: CellularShortcutBridge.active(), waiting: LocalVPN.waiting(),
                              online: LocalVPN.Path.online(), otherVPN: LocalVPN.otherVPNUp(), down: ours?.down, replaced: ours?.replaced ?? false,
                              left: held, never: never)
    }
}
