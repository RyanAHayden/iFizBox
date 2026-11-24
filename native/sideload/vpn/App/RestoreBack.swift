// Restore My VPN, on: after the last install or check, once our tunnel is down and the app is in front, the Restore My
// VPN Shortcut's back run sets the VPN ours took the place of, once per queue. With no other VPN up before, or none
// remembered, nothing runs. The app left meanwhile, or killed: at its return or next launch. RestoreDue has the rules,
// RestoreShortcutBridge opens the Shortcut and judges it by the other VPN being up, not by Set VPN's error.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum RestoreBack {
    private static let owedKey = "ifizbox.vpn.backOwed"
    private static let rememberedKey = "ifizbox.vpn.remembered"
    static let again: TimeInterval = 2 // how often a look that must wait looks again, the app in front

    private static let lock = NSLock()
    private static var looking = false // guarded by lock: a look, or its wait for the next one, goes on
    private static var saidWaiting = false // guarded by lock: one line per wait

    /// Ours took another VPN's place, and it wasn't brought back yet. Kept, for an app killed before it was.
    private static var owed: Bool {
        get { UserDefaults.standard.bool(forKey: owedKey) }
        set { UserDefaults.standard.set(newValue, forKey: owedKey) }
    }

    /// A store run passed: the Shortcut has a VPN to set.
    static var remembered: Bool { UserDefaults.standard.bool(forKey: rememberedKey) }

    static func stored() { UserDefaults.standard.set(true, forKey: rememberedKey) }
    static func notStored() { UserDefaults.standard.set(false, forKey: rememberedKey) }

    private static func log(_ s: String) { LocalVPN.log("\(RestoreShortcut.shortcutName): \(s)") }

    /// Under LocalVPN's startLock, before ours is enabled or started: what is up then is what it takes the place of.
    static func note() {
        guard LocalVPN.restore, !owed, LocalVPN.otherVPNUp() else { return }
        guard remembered else { return log("another VPN is on, none is remembered: nothing brings it back") }
        owed = true
        log("another VPN is on: it is brought back after the queue")
    }

    /// The setting was turned off.
    static func forget() { owed = false }

    /// After a stop, at launch and on coming back. Never blocks.
    static func look() {
        guard owed, LocalVPN.restore else { return }
        lock.lock(); let already = looking; looking = true; lock.unlock()
        guard !already else { return }
        DispatchQueue.global(qos: .utility).async { turn() }
    }

    private static func turn() {
        let step = owed && LocalVPN.restore ? RestoreDue.step(now()) : .drop
        switch step {
        case .drop:
            // looked at again with no start going on: one may just have taken that VPN's place once more
            LocalVPN.withNoStart {
                guard owed, RestoreDue.step(now()) == .drop else { return }
                owed = false
                log("nothing to bring back; up tunnels: \(LocalVPN.tunnelList(LocalVPN.tunnelAddresses()))")
            }
            done()
            if owed { DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + again) { look() } }
        case .onReturn:
            say("the app was left: at its return")
            done()
            if IDevice.AppFront.now { look() } // it came back while this looked
        case .later:
            say("waits; path: \(LocalVPN.Path.described())")
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + again) { turn() }
        case .back:
            // under startLock: an install that starts now waits, so Set VPN never takes ours down
            let ran = LocalVPN.withNoStart { () -> Bool in
                guard RestoreDue.step(now()) == .back else { return false } // the next app began, or the app was left, meanwhile
                owed = false // before Shortcuts opens: an app killed meanwhile doesn't open it again
                let error = RestoreShortcutBridge.back()
                let active = CellularShortcutBridge.active()
                if LocalVPN.restore, RestoreDue.stillDue(error, active: active) { owed = true; return false }
                return true
            }
            if ran { return done() }
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + again) { turn() }
        }
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
                              online: LocalVPN.Path.online(), otherVPN: LocalVPN.otherVPNUp(), down: ours?.down, replaced: ours?.replaced ?? false)
    }
}
