// The built-in VPN for This iPhone installs (sideload build only): the app's side of PlugIns/iFizBoxVPN.appex
// (../Extension/PacketTunnelProvider.swift, the phone at 10.7.0.1). IDevice.Session turns it on just before it
// connects to iOS and off a moment after the last connection ends (`linger`, so a queue of installs or a reconnect
// keeps it), so the user's own VPN (Tailscale) is paused only while an app installs; iOS brings it back through its
// VPN On Demand.
// On cellular (cellular in use, no Wi-Fi), with the user's two Shortcuts added (Settings > Installation & Signing >
// This iPhone > Cellular Shortcuts), "Cellular Data Off" runs just before the connect and "Cellular Data On" once it
// is connected, as SideStore's Cellular Refresh: iOS refuses these connections while cellular data is in use
// (journal/2026-11-21-r72-cellular-this-iphone). They run through Shortcuts' x-callback-url, which comes back to the
// app (ifizbox://vpn-shortcut, App.swift's Incoming hands it here).
// F386: with the Install Switch added instead (one Shortcut, tools/shortcuts/install-switch.plist), the first connect
// of a queue runs it once with {"start":1}: it remembers the VPN that is on (Tailscale) and connects this VPN with
// Shortcuts' Set VPN, which iOS does without a prompt (R76). B375: on cellular it runs once more with {"dataOff":1}
// once up() has this VPN connected: iOS starts no VPN without a network, and a VPN that is up stays up when data goes
// off. Once the VPN has gone off after the last connect (`linger`), it runs with {"end":1[,"cellular":1]}: Cellular
// Data back on and the remembered VPN connected again. One hop to Shortcuts each way per queue (two at the start on
// cellular), not per app. An end that finds the app in the background waits until it is in front again.
// F388: the start runs only when it is needed (switchNeeded): on cellular, or with another VPN up (Tailscale). On
// Wi-Fi with no other VPN, an install never opens Shortcuts: this VPN comes on and goes off by itself.
// F389: a VPN that is selected in Settings > VPN but idle (On Demand, no tunnel address) counts too: ours not enabled
// means another one is (otherVPNSelected). The run gets "selected":1, remembers the On Demand one, and turns its On
// Demand on again at the end, which selects it without connecting it.
// B381: the end runs only once the queue is over (switchEndDue) and only for what it has to put back (switchEndNeeded).
// B395: Shortcuts opens a bounded number of times whatever it does (SwitchOpens, native/sign): per queue one trip and an
//   end, or an older one's start, dataOff and end, each once, and no start after one that failed. A queue holds through
//   an install's reconnects (installBegan). On Wi-Fi the install then goes on without it; on cellular it stops
//   (switch_failed). What stays off is said in words (vpn.leftOff).
//   vpn.status          {available, bundled, entitled, tested, on, cellular, wifi, shortcuts: {off, on, switch, trip, idle}, otherVPN, otherVPNSelected}; also in
//                       idevice.status as `vpn`
//   vpn.test            the VPN on, one connect to iOS with the pairing (idevice.verify), the VPN off: {ok, ms, kind};
//                       a pass marks This iPhone tested (set up)
//   vpn.openShortcuts   {which, url, link?}: Shortcuts' Add Shortcut on our iCloud link (F392), or without one our signed
//                       Shortcut in a share sheet ({opened, via})
//   vpn.checkShortcut   {which}: runs it with a text input (it then does nothing) and marks it added only when it
//                       ran: {ok, error, status}
//   vpn.leftOff         B395: answers {vpn, cellular} once something stayed off after a queue, however long that takes
//   vpn.testSwitch      F386: runs the Install Switch's start, then its end: {ok, start: {ok, error}, end: {ok, error},
//                       cellular, wentOff, vpnOn (this VPN was connected after the start)}; a pass marks it added
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Network
import NetworkExtension
import UIKit

enum LocalVPN {
    static let peer = "10.7.0.1"
    static var name: String { "\(Brand.name) VPN" }
    static let testedKey = "ifizbox.vpn.tested"
    static let shortcutKeys = ["off": "ifizbox.vpn.shortcut.off", "on": "ifizbox.vpn.shortcut.on", "switch": "ifizbox.vpn.shortcut.switch"]
    /// The Shortcuts' names, as the user names them (the page says these words). F386: "switch" is the Install
    /// Switch, the one Shortcut that replaces the two Cellular Shortcuts (kept for phones that added them before).
    static let shortcutNames = ["off": "Cellular Data Off", "on": "Cellular Data On", "switch": "Install Switch"]
    /// How long the VPN stays on after the last connection ends: the next install of a queue, or a reconnect, finds it on.
    static let linger: TimeInterval = 3
    static let startLimit: TimeInterval = 10 // from startVPNTunnel to connected
    static let saveLimit: TimeInterval = 90 // the first save waits for the user's Allow on iOS's "Add VPN Configurations"
    static let shortcutLimit: TimeInterval = 25 // a Shortcut's run, until Shortcuts comes back to the app
    static let dataOffLimit: TimeInterval = 5 // after Cellular Data Off, for the path to leave cellular

    static func log(_ s: String) { IDevice.ilog("vpn: \(s)") }

    // ---- What this build has

    /// The extension's CFBundleIdentifier, as signed (a signer may have renamed it), or nil when the bundle has none.
    static let providerID: String? = {
        guard let dir = Bundle.main.builtInPlugInsURL?.appendingPathComponent("\(Brand.name)VPN.appex"),
              let info = NSDictionary(contentsOf: dir.appendingPathComponent("Info.plist")) as? [String: Any] else { return nil }
        return info["CFBundleIdentifier"] as? String
    }()

    /// The app's own profile allows a packet tunnel (the App ID has Network Extensions). Without it iOS refuses to
    /// save the configuration, and This iPhone uses the other ways in.
    static let entitled: Bool = {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url), let p = try? Profile(data) else { return false }
        let kinds = p.entitlements["com.apple.developer.networking.networkextension"] as? [String] ?? []
        return kinds.contains("packet-tunnel-provider")
    }()

    static var available: Bool { AppMode.current != .jailbreak && providerID != nil && entitled }
    static var tested: Bool { UserDefaults.standard.bool(forKey: testedKey) }

    static func status() -> [String: Any] {
        let path = Path.now()
        var sc: [String: Bool] = [:]
        for (k, key) in shortcutKeys { sc[k] = UserDefaults.standard.bool(forKey: key) }
        sc["trip"] = tripReady() // F394: the added Install Switch does it in one trip
        sc["idle"] = UserDefaults.standard.bool(forKey: idleKey) // F389: ... and brings an idle On Demand VPN back
        lock.lock(); let on = cached?.connection.status == .connected; lock.unlock()
        return ["available": available, "bundled": providerID != nil, "entitled": entitled, "tested": tested, "on": on,
                "cellular": path.cellular, "wifi": path.wifi, "shortcuts": sc, "trips": tripAvailable, "otherVPN": otherVPNUp(), "otherVPNSelected": otherVPNSelected(), "name": name]
    }

    // ---- The network path (cellular or Wi-Fi)

    enum Path {
        private static let monitor = NWPathMonitor()
        private static let queue = DispatchQueue(label: "ifizbox.vpn.path")
        private static var started = false
        private static var path: Network.NWPath?
        private static let plock = NSLock()

        static func start() {
            plock.lock(); defer { plock.unlock() }
            guard !started else { return }
            started = true
            monitor.pathUpdateHandler = { p in plock.lock(); path = p; plock.unlock() }
            monitor.start(queue: queue)
        }

        /// cellular: cellular data is in use and Wi-Fi isn't (Wi-Fi switched on but not joined counts as no Wi-Fi).
        static func now() -> (cellular: Bool, wifi: Bool) {
            start()
            plock.lock(); let p = path; plock.unlock()
            guard let p = p, p.status == .satisfied else { return (false, false) }
            let wifi = p.usesInterfaceType(.wifi)
            return (p.usesInterfaceType(.cellular) && !wifi, wifi)
        }

        /// B375: some network is up (Wi-Fi, cellular data, wired), so iOS can start a VPN. True before the first
        /// path update arrives (not known yet: up() tries as before).
        static func online() -> Bool {
            start()
            plock.lock(); let p = path; plock.unlock()
            guard let p = p else { return true }
            return p.status == .satisfied
        }
    }

    // ---- The tunnel

    private static let lock = NSLock()
    private static var cached: NETunnelProviderManager? // guarded by lock
    private static var holds = 0 // guarded by lock
    private static var stopGen = 0 // guarded by lock: a scheduled stop runs only if nothing came after it
    private static var installs = 0 // guarded by lock: installs going on (installBegan): a reconnect stays in its queue
    private static var opens = SwitchOpens() // guarded by lock: B395: this queue's Shortcuts opens
    private static var lost = Set<String>() // guarded by lock: the other VPNs' addresses not put back, to be said (sayLost)
    private static var lostData = false // guarded by lock: cellular data too
    private static var lastFailure: Date? // guarded by lock: begin() couldn't turn it on

    /// begin() failed less than a minute ago: a reconnect or the next install of a queue goes the other ways in
    /// instead of waiting on it again. vpn.test always tries.
    static func failedNow() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return lastFailure.map { Date().timeIntervalSince($0) < 60 } ?? false
    }

    /// Blocking, never on the main thread: our configuration, saved and enabled, loaded again (iOS wants a load after
    /// a save before the tunnel starts). The first save shows iOS's "Add VPN Configurations" and waits for Allow.
    static func manager() throws -> NETunnelProviderManager {
        guard let id = providerID else { throw IDevice.Failure(code: "vpn_failed", text: "this build has no \(name)") }
        guard entitled else { throw IDevice.Failure(code: "vpn_failed", text: "the profile this app is signed with has no Network Extensions capability") }
        lock.lock(); let have = cached; lock.unlock()
        if let m = have, m.isEnabled { return m }
        let found: NETunnelProviderManager? = try wait("reading the VPN configuration", 10) { done in
            NETunnelProviderManager.loadAllFromPreferences { ms, err in
                done(err, ms?.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == id })
            }
        }
        let m = found ?? NETunnelProviderManager()
        let p = (m.protocolConfiguration as? NETunnelProviderProtocol) ?? NETunnelProviderProtocol()
        p.providerBundleIdentifier = id
        p.serverAddress = peer
        p.disconnectOnSleep = false
        m.protocolConfiguration = p
        m.localizedDescription = name
        m.isOnDemandEnabled = false
        m.isEnabled = true
        log(found == nil ? "saving a new configuration (iOS asks to allow it)" : "enabling the configuration")
        let _: Bool? = try wait("saving the VPN configuration", saveLimit) { done in m.saveToPreferences { done($0, true) } }
        let _: Bool? = try wait("loading the VPN configuration", 10) { done in m.loadFromPreferences { done($0, true) } }
        lock.lock(); cached = m; lock.unlock()
        return m
    }

    /// Runs `start` and waits for it to call `done(error, value)`, at most `limit` seconds. Blocking.
    private static func wait<T>(_ what: String, _ limit: TimeInterval, _ start: (@escaping (Error?, T?) -> Void) -> Void) throws -> T? {
        let sem = DispatchSemaphore(value: 0)
        var out: T?, failure: Error?
        start { e, v in failure = e; out = v; sem.signal() }
        guard sem.wait(timeout: .now() + limit) == .success else {
            throw IDevice.Failure(code: "vpn_failed", text: "\(what) took over \(Int(limit)) s")
        }
        if let e = failure {
            let ns = e as NSError
            // NEVPNError.configurationReadWriteFailed with "permission denied": the user tapped Don't Allow
            let text = ns.domain == NEVPNErrorDomain && ns.code == NEVPNError.configurationReadWriteFailed.rawValue
                ? "iOS didn't save the VPN configuration (\(ns.localizedDescription)). Allow it when iOS asks"
                : "\(what): \(ns.localizedDescription)"
            throw IDevice.Failure(code: "vpn_failed", text: text)
        }
        return out
    }

    /// The tunnel up (blocking): started if it isn't, then until iOS says connected.
    static func up(_ step: (String) -> Void = { _ in }) throws {
        // B375: iOS starts no VPN without a network: it goes connecting then disconnected ("No network available")
        // faster than the loop below can see, which then waited out startLimit. F394: asked before manager(), whose
        // save takes the user's own VPN's place
        if !Path.online() {
            if connectedNow() { return }
            throw IDevice.Failure(code: "vpn_failed", text: "\(name) can't start without a network: iOS starts a VPN only with Wi-Fi or cellular data on")
        }
        lock.lock(); let on = cached?.connection.status == .connected; lock.unlock()
        if on { return }
        // F394: another VPN set since (the Install Switch's Set VPN back) disabled ours, which the kept copy doesn't
        // say: its start gives no error and never connects. Read it again (manager() enables and saves it when off)
        lock.lock(); cached = nil; lock.unlock()
        let m = try manager()
        if m.connection.status == .connected { return }
        step("turning on \(name)")
        let t0 = Date()
        do { try m.connection.startVPNTunnel() } catch {
            // a configuration another app's VPN took over since: enable and save it again, then try once more
            lock.lock(); cached = nil; lock.unlock()
            let again = try manager()
            do { try again.connection.startVPNTunnel() } catch { throw IDevice.Failure(code: "vpn_failed", text: "\(name) didn't start: \(error.localizedDescription)") }
        }
        let conn = try manager().connection
        var seenConnecting = false
        while Date().timeIntervalSince(t0) < startLimit {
            switch conn.status {
            case .connected:
                log("on in \(String(format: "%.2f", Date().timeIntervalSince(t0))) s")
                return
            case .connecting, .reasserting: seenConnecting = true
            case .disconnected, .invalid:
                if seenConnecting { throw IDevice.Failure(code: "vpn_failed", text: "\(name) turned off as it started") }
            default: break
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
        throw IDevice.Failure(code: "vpn_failed", text: "\(name) didn't connect in \(Int(startLimit)) s")
    }

    /// The tunnel down now. The configuration stays saved (never removed): a new one would make iOS ask Allow on
    /// "Add VPN Configurations" again at the next install, so iOS asks once, at setup's test (user, B357).
    static func down() {
        lock.lock(); let m = cached; lock.unlock()
        guard let m = m else { return }
        if m.connection.status != .disconnected { m.connection.stopVPNTunnel(); log("off") }
    }

    /// Before a connect to iOS (blocking, on IDevice.queue): the VPN on, held until end(). F386: with the Install
    /// Switch added, the first begin of a queue runs its start (end() runs its end). Otherwise, on cellular with both
    /// Cellular Shortcuts added, Cellular Data Off runs: the answer says so, and connected(dataOff:) turns it back on.
    static func begin(cellular: Bool = true, forced: Bool = false, _ step: (String) -> Void = { _ in }) throws -> Bool {
        waitForPutBack(step) // F394: an Install Switch run still putting things back would cut this connect off
        let tunnels = tunnelAddresses() // F388: read before the lock (getifaddrs)
        let onCellular = cellular && Path.now().cellular, before = otherVPNAddresses(tunnels)
        let selected = otherVPNSelected() // F389: before up() takes its place
        let other = !before.isEmpty || selected
        lock.lock()
        if holds == 0 && !busy && !switchedOn { opens.newQueue() } // B395
        holds += 1; stopGen += 1; switchEndDue = false // B381: the queue goes on
        busy = true
        // F386: the first connect of a queue runs the Install Switch's start. F388: only when it is needed, so an
        // install doesn't flip to Shortcuts and back: on cellular (Cellular Data Off has no app API), or with another
        // VPN up (Tailscale), which only its Set VPN brings back. On Wi-Fi with no other VPN, up() alone does it all.
        // F394: not without a network: up() below fails then (B375), so Shortcuts would open for nothing.
        let want = Path.online() && !switchedOn && (forced || switchAdded() && switchNeeded(cellular: onCellular, otherVPN: other))
        let ready = tripReady()
        let start = want && opens.take(ready ? .trip : .start) // B395: not again in this queue, nor after one that failed
        let deciding = !switchedOn && holds == 1
        if start { switchedOn = true; switchDataOff = false; switchVPNBefore = before; switchSelectedBefore = selected }
        else if want { lose(before) }
        let skipped = !want && !switchedOn && holds == 1 && switchAdded() // said once per queue
        lock.unlock()
        // T77: what the start decided from, for a phone where a carrier's ipsec tunnel may count as another VPN
        if deciding || start { log("Install Switch: start \(start), added \(switchAdded()), cellular \(onCellular), another VPN \(other), selected \(selected); up tunnels: \(tunnelList(tunnels))") }
        if skipped { log("Install Switch: not needed (not on cellular, no other VPN up or selected)") }
        if want && !start { log("Install Switch: not run again after it failed") }
        if start { savePending(cellular: false, vpn: before, selected: selected) }
        var ran = start || !want // B395: the Install Switch did its part, or wasn't needed
        var trip = false, why: String?
        if start && ready { // F394: one trip for the whole queue, when the added Install Switch can
            let t = takeTrip(cellular: onCellular, selected: selected, step)
            trip = t.ran
            ran = t.ran && t.error == nil
            why = t.error
            if !t.ran { dropStart(.trip, error: t.error, older: t.older) }
        } else if start {
            step("running the Shortcut \(shortcutNames["switch"]!)")
            // B375: never with "cellular": iOS starts no VPN without a network ("No network available"), so Cellular
            // Data goes off only once up() below has this VPN connected (dataOff), as SideStore's docs order it
            let r = runShortcut("switch", input: switchInput("start", selected: selected))
            // Set VPN's error 2 is no failure: up() below connects this VPN itself (iOS was still enabling our
            // configuration: seen on the 15 Pro)
            ran = switchEnded(r).ok
            why = r.error
            log(ran ? "Install Switch: start ran" : "Install Switch: start didn't run: \(r.error ?? "?")")
            if !ran { dropStart(.start, error: r.error) }
        }
        // B395: on cellular nothing else turns data off, so iOS would refuse the connect: stop before this VPN takes
        // another one's place. On Wi-Fi the install goes on without it.
        if !ran && onCellular && Path.now().cellular {
            log("Install Switch: cellular data is on and the Install Switch didn't run: stopping")
            end()
            throw IDevice.Failure(code: "switch_failed", text: why ?? "it didn't run a moment ago")
        }
        do { try up(step) } catch {
            lock.lock(); lastFailure = Date(); lock.unlock()
            end()
            if !ran { throw IDevice.Failure(code: "switch_failed", text: "\(why ?? "it didn't run a moment ago"), and \((error as? IDevice.Failure)?.text ?? error.localizedDescription)") } // B395
            throw error
        }
        lock.lock(); lastFailure = nil; let switching = switchedOn, dataOff = start && !trip && switchedOn && onCellular && opens.take(.dataOff); lock.unlock()
        if dataOff { // B375: this VPN is up, so cellular data can go off now; the end turns it back on
            step("running the Shortcut \(shortcutNames["switch"]!) (Cellular Data Off)")
            savePending(cellular: true, vpn: before, selected: selected)
            let r = runShortcut("switch", input: switchInput("dataOff"))
            log(r.ok ? "Install Switch: data off ran" : "Install Switch: data off didn't run: \(r.error ?? "?"); connecting anyway")
            // B381: the end puts data back only when this run may have turned it off
            if !notOpened(r.error) { lock.lock(); switchDataOff = true; lock.unlock() }
            if !r.ok { lock.lock(); opens.fail(); lock.unlock() }
            if r.ok { waitOffCellular() }
        }
        // F386: the Install Switch turns data back on at its end; the two Cellular Shortcuts only without it
        guard !switching, cellular, Path.now().cellular, shortcutsAdded() else { return false }
        step("running the Shortcut \(shortcutNames["off"]!)")
        let r = runShortcut("off")
        guard r.ok else { log("Cellular Data Off didn't run: \(r.error ?? "?"); connecting anyway"); return false }
        waitOffCellular()
        return true
    }

    /// B395: a start (or trip) that didn't run. Nothing in it ran: no end is due either, and what up() takes is said at
    /// the queue's end. Anything else may have run part of the way: the end tries once to put it back.
    private static func dropStart(_ run: SwitchOpens.Run, error: String?, older: Bool = false) {
        lock.lock()
        if notOpened(error) { opens.untake(run) } else { opens.fail(rest: !older) }
        let nothing = older || notOpened(error) || SwitchOpens.notFound(error)
        if nothing {
            lose(switchVPNBefore)
            switchedOn = false; switchVPNBefore = []; switchSelectedBefore = false
        }
        lock.unlock()
        if nothing { clearPending() }
    }

    /// After a Shortcut set Cellular Data to Off: until the path leaves cellular, at most dataOffLimit. Blocking.
    static func waitOffCellular() {
        let t0 = Date()
        while Path.now().cellular && Date().timeIntervalSince(t0) < dataOffLimit { Thread.sleep(forTimeInterval: 0.1) }
        log(Path.now().cellular ? "cellular still in use after Cellular Data Off" : "cellular data off")
    }

    /// Once connected (or when the connect failed): Cellular Data On, when begin() turned it off. Not waited for.
    static func connected(dataOff: Bool) {
        guard dataOff else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let r = runShortcut("on")
            log(r.ok ? "cellular data on again" : "Cellular Data On didn't run: \(r.error ?? "?")")
        }
    }

    /// A connection ended: the VPN goes off `linger` seconds after the last one, unless another begins first.
    static func end() {
        lock.lock()
        holds = max(0, holds - 1)
        stopGen += 1
        lock.unlock()
        stopLater()
    }

    /// B395: an install, its reconnects and the pauses between them (up to 15 s, HereRecheck.pause) are one queue:
    /// without this each drop longer than `linger` ended the queue, and the reconnect ran the Install Switch again.
    static func installBegan() { lock.lock(); installs += 1; lock.unlock() }
    static func installEnded() {
        lock.lock(); installs = max(0, installs - 1); lock.unlock()
        stopLater()
    }

    private static func stopLater() {
        lock.lock(); let gen = stopGen, idle = holds == 0 && installs == 0; lock.unlock()
        guard idle else { return }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + linger) {
            lock.lock(); let stop = holds == 0 && installs == 0 && stopGen == gen; if stop { switchEndDue = switchedOn && !tripOn; if tripOn { tailing = true } }; lock.unlock()
            if stop { down(); endTrip(gen); endSwitch(); sayLost() }
        }
    }

    // ---- F386: the Install Switch

    private static var switchedOn = false // guarded by lock: its start ran (or was tried) and its end hasn't yet
    private static var switchDataOff = false // guarded by lock: Cellular Data Off ran (or may have) after the start
    private static var switchVPNBefore = Set<String>() // guarded by lock: the other VPNs' addresses before the start
    private static var switchSelectedBefore = false // guarded by lock: another VPN was selected before the start (F389)
    private static var switchEndDue = false // guarded by lock: the queue is over (linger passed), so the end may run

    /// runShortcut's error for a run that never reached Shortcuts (nothing in it ran).
    static func notOpened(_ error: String?) -> Bool {
        guard let e = error else { return false }
        return e.hasSuffix("wasn't in front, so iOS wouldn't open Shortcuts") || e == "Shortcuts didn't open" || e == "bad Shortcut link"
    }

    static func switchAdded() -> Bool { UserDefaults.standard.bool(forKey: shortcutKeys["switch"]!) }

    /// F388: a queue's start runs the Install Switch only when the app can't do without it: on cellular (Cellular
    /// Data Off/On has no app API), or with another VPN up (F389: or selected and idle), which stays off after unless Set VPN puts it back
    /// (journal/2026-11-22-f372-builtin-vpn: our configuration keeps Settings > VPN's checkmark, so On Demand
    /// never brings Tailscale back by itself).
    static func switchNeeded(cellular: Bool, otherVPN: Bool) -> Bool { cellular || otherVPN }

    /// B381: the end opens Shortcuts only for something to put back: Cellular Data, when the run turned it off and it
    /// isn't on again (`dataBack`), or another VPN, when one was up before the start and isn't again (`vpnBack`: every
    /// address it had is there; a carrier's ipsec tunnel, which stays up throughout, doesn't stand in for Tailscale).
    static func switchEndNeeded(dataOff: Bool, vpnBefore: Bool, dataBack: Bool, vpnBack: Bool) -> Bool { (dataOff && !dataBack) || (vpnBefore && !vpnBack) }

    /// F388: another app's VPN is up now: a tunnel interface (utun, ipsec, ppp) that is up with an IPv4 address that
    /// isn't ours (10.7.0.x). iOS's own utun interfaces carry IPv6 only.
    static func otherVPNUp() -> Bool { !otherVPNAddresses().isEmpty }
    static func otherVPNAddresses(_ tunnels: [TunnelAddress] = tunnelAddresses()) -> Set<String> {
        Set(tunnels.filter { $0.family == AF_INET && !$0.address.hasPrefix("10.7.0.") }.map(\.address))
    }

    /// F389: another app's VPN is the selected one in Settings > VPN, up or not. An On Demand VPN that is idle has no
    /// tunnel address, and iOS tells an app nothing of another app's VPN, but only one configuration is enabled at a
    /// time: ours saved and not enabled means another one is. Ours taking its place stops its On Demand, so the Install
    /// Switch has to put it back too. False without a saved configuration of ours (nothing to tell it by). Blocking.
    static func otherVPNSelected() -> Bool {
        guard available, let id = providerID else { return false }
        var enabled: Bool? // written before done() signals the wait
        let _: Bool? = try? wait("reading the VPN configuration", 5) { done in
            NETunnelProviderManager.loadAllFromPreferences { ms, err in
                enabled = ms?.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == id }?.isEnabled
                done(err, true)
            }
        }
        return enabled == false
    }

    /// F389: what was there before the start is back: every address, and the place in Settings > VPN.
    static func otherVPNBack(_ before: Set<String>, selected: Bool) -> Bool {
        before.isSubset(of: otherVPNAddresses()) && (!selected || otherVPNSelected())
    }

    /// One address entry of a tunnel interface that is up; `address` is empty for a family other than IPv4 and IPv6.
    struct TunnelAddress { let name: String, family: Int32, address: String }

    /// Every address entry of the tunnel interfaces that are up, ours and iOS's own too.
    static func tunnelAddresses() -> [TunnelAddress] {
        var out: [TunnelAddress] = []
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0 else { return out }
        defer { freeifaddrs(head) }
        var p = head
        while let i = p {
            defer { p = i.pointee.ifa_next }
            let name = String(cString: i.pointee.ifa_name)
            guard Int32(i.pointee.ifa_flags) & IFF_UP != 0, ["utun", "ipsec", "ppp"].contains(where: name.hasPrefix) else { continue }
            let family = i.pointee.ifa_addr.map { Int32($0.pointee.sa_family) } ?? AF_UNSPEC
            var buf = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
            if let a = i.pointee.ifa_addr, family == AF_INET {
                var sin = a.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr }
                guard inet_ntop(family, &sin, &buf, socklen_t(buf.count)) != nil else { continue }
            } else if let a = i.pointee.ifa_addr, family == AF_INET6 {
                var sin6 = a.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { $0.pointee.sin6_addr }
                guard inet_ntop(family, &sin6, &buf, socklen_t(buf.count)) != nil else { continue }
            }
            out.append(TunnelAddress(name: name, family: family, address: String(cString: buf)))
        }
        return out
    }

    /// T77: the log's list of them, such as "utun3 IPv4 100.64.0.1, ipsec1 IPv6 fe80::1".
    static func tunnelList(_ tunnels: [TunnelAddress]) -> String {
        if tunnels.isEmpty { return "none" }
        return tunnels.map { t in
            switch t.family {
            case AF_INET: return "\(t.name) IPv4 \(t.address)"
            case AF_INET6: return "\(t.name) IPv6 \(t.address)"
            case AF_LINK: return "\(t.name) link"
            default: return "\(t.name) family \(t.family)"
            }
        }.joined(separator: ", ")
    }

    /// The Install Switch's input: a JSON dictionary of flags, as tools/shortcuts/install-switch.plist reads them.
    static func switchInput(_ verb: String, cellular: Bool = false, actions: Bool = false, selected: Bool = false) -> String {
        let flags = [verb] + (actions ? ["actions"] : []) + (cellular ? ["cellular"] : []) + (selected ? ["selected"] : [])
        return "{" + flags.map { "\"\($0)\":1" }.joined(separator: ",") + "}"
    }

    /// Once the VPN is off after a queue: the Install Switch's end (data back on, the user's VPN connected again).
    /// Shortcuts opens only from the front, so with the app in the background it waits for the app's next
    /// didBecomeActive (LocalVPNBridge.register). Blocking: runs on a background queue.
    static func endSwitch() {
        let active = DispatchQueue.main.sync { UIApplication.shared.applicationState == .active }
        lock.lock()
        // B381: switchEndDue: coming to the front between two installs of a queue ends nothing
        guard switchedOn, switchEndDue, holds == 0, installs == 0, active else {
            if switchedOn && switchEndDue && holds == 0 { log("Install Switch: end waits until \(Brand.name) is in front") }
            lock.unlock(); return
        }
        switchedOn = false; switchEndDue = false; tailing = true
        let dataOff = switchDataOff, before = switchVPNBefore, selected = switchSelectedBefore, launch = restored
        restored = false
        lock.unlock()
        defer { lock.lock(); tailing = false; lock.unlock() }
        // F394: after a launch, the Shortcut of the run before may still be putting things back, and the path is new
        if dataOff || launch { Thread.sleep(forTimeInterval: launch ? 4 : 1) } // the path may be an old one just after a suspension
        let vpnBefore = !before.isEmpty || selected, dataBack = Path.now().cellular, vpnBack = otherVPNBack(before, selected: selected)
        guard switchEndNeeded(dataOff: dataOff, vpnBefore: vpnBefore, dataBack: dataBack, vpnBack: vpnBack) else {
            clearPending()
            return log("Install Switch: end not needed (data off \(dataOff), on again \(dataBack); another VPN before \(vpnBefore), now \(vpnBack))")
        }
        log("Install Switch: end (data off \(dataOff), on again \(dataBack); another VPN before \(vpnBefore), now \(vpnBack))")
        lock.lock(); let may = opens.take(.end); lock.unlock()
        let r = may ? switchEnded(runShortcut("switch", input: switchInput("end", cellular: dataOff))) : (ok: false, error: "it ran already")
        // B395: once, whatever it answered (a run that never opened Shortcuts is tried at the next launch)
        if !notOpened(r.error) { clearPending() }
        log(r.ok ? "Install Switch: end ran" : "Install Switch: end didn't run: \(r.error ?? "?")")
        if !notOpened(r.error) { lock.lock(); lose(before, data: dataOff); lock.unlock(); sayLost() }
    }

    // ---- B395: what stayed off, in words

    private static let lostKey = "ifizbox.vpn.lost"
    private static let leftOffKey = "ifizbox.vpn.leftOff"
    static let leftOffLimit: TimeInterval = 8 // a VPN needs a moment to have its address
    private static var leftOffCall: Bridge.Call? // guarded by lock: the page's vpn.leftOff, waiting

    /// Under lock: to be said at the queue's end. Kept, so a launch after a kill (iFizBox's own update) says it too.
    private static func lose(_ vpn: Set<String>, data: Bool = false) {
        lost.formUnion(vpn); lostData = lostData || data
        if !lost.isEmpty || lostData { UserDefaults.standard.set(["vpn": Array(lost), "cellular": lostData] as [String: Any], forKey: lostKey) }
    }

    /// At launch (restorePending).
    private static func restoreLost() {
        guard let p = UserDefaults.standard.dictionary(forKey: lostKey) else { return }
        lock.lock(); lose(Set(p["vpn"] as? [String] ?? []), data: p["cellular"] as? Bool ?? false); lock.unlock()
    }

    /// In front again with no queue going on: what a killed app couldn't say.
    static func sayKept() {
        lock.lock(); let idle = holds == 0 && installs == 0 && !busy && !switchedOn && !tailing; lock.unlock()
        if idle { sayLost() }
    }

    /// After a queue that went on without the Install Switch, or whose end ran.
    private static func sayLost() {
        lock.lock(); let vpn = lost, data = lostData, gen = stopGen; lost = []; lostData = false; lock.unlock()
        if !vpn.isEmpty || data { sayLeftOff(vpn: vpn, dataOff: data, gen) }
    }

    /// Looks for a while, and tells the page what isn't back on (its alert; kept until the page was told). An idle VPN
    /// has no address to look for, so nothing is said of it. When another connect began meanwhile, its own end looks.
    private static func sayLeftOff(vpn: Set<String>, dataOff: Bool, _ gen: Int) {
        DispatchQueue.global(qos: .utility).async {
            let t0 = Date()
            var vpnOff = true, dataStill = true
            while Date().timeIntervalSince(t0) < leftOffLimit {
                lock.lock(); let same = stopGen == gen; lock.unlock()
                guard same else {
                    lock.lock(); lose(vpn, data: dataOff); lock.unlock()
                    return
                }
                let path = Path.now()
                vpnOff = !vpn.isEmpty && !vpn.isSubset(of: otherVPNAddresses())
                dataStill = dataOff && !path.cellular && !path.wifi
                if !vpnOff && !dataStill { return forgetLost() }
                Thread.sleep(forTimeInterval: 0.5)
            }
            log("still off after the queue: VPN \(vpnOff), cellular data \(dataStill)")
            UserDefaults.standard.set(["vpn": vpnOff, "cellular": dataStill], forKey: leftOffKey)
            forgetLost()
            answerLeftOff()
        }
    }

    /// What was looked at is back, or the page is told of it (not what a queue took meanwhile).
    private static func forgetLost() {
        lock.lock(); if lost.isEmpty && !lostData { UserDefaults.standard.removeObject(forKey: lostKey) }; lock.unlock()
    }

    /// vpn.leftOff: answers once something stayed off; the page asks again after its alert. The latest page's call waits.
    static func waitLeftOff(_ c: Bridge.Call) {
        lock.lock(); leftOffCall = c; lock.unlock()
        answerLeftOff()
    }
    private static func answerLeftOff() {
        lock.lock()
        let off = UserDefaults.standard.dictionary(forKey: leftOffKey)
        let c = off == nil ? nil : leftOffCall
        if c != nil { leftOffCall = nil; UserDefaults.standard.removeObject(forKey: leftOffKey) }
        lock.unlock()
        if let c, let off { Apt.reply(c, off, nil) }
    }

    /// B395: a connect now would open Shortcuts (begin's rule). Blocking.
    static func switchWouldRun() -> Bool {
        guard available, switchAdded() else { return false }
        waitForPutBack { _ in }
        return switchNeeded(cellular: Path.now().cellular, otherVPN: otherVPNUp() || otherVPNSelected())
    }

    // ---- F394: the Install Switch in one trip to Shortcuts per queue

    // The run ({"trip":1[,"cellular":1]}) remembers the VPN that is on, connects ours with Connect VPN (tripConnect, in
    // this process behind Shortcuts), turns Cellular Data off, opens the app again (tripOpened) and goes on behind it:
    // Wait for Install (tripWait) until the queue is over, then data on and the remembered VPN back. The waits are a
    // bounded loop of short ones: Shortcuts cuts a single action off at about 30 s (R78a). A killed app ends the run
    // before it puts anything back, so what is out is kept (pendingKey) and endSwitch puts it back at the next launch.
    private static let tripKey = "ifizbox.vpn.shortcut.trip" // the added Install Switch reached our actions in its check
    private static let idleKey = "ifizbox.vpn.shortcut.idle" // F389: ... and it looks for an idle On Demand VPN (its second Wait)
    private static let pendingKey = "ifizbox.vpn.switch.pending"
    static let waitStep: TimeInterval = 20 // one Wait for Install
    static let waitTurns = 45 // the Shortcut's Repeat: after them it puts things back, whatever the queue does
    static let callbackGrace: TimeInterval = 3 // after Shortcuts' callback, for our own actions to say it runs
    static let putBackLimit: TimeInterval = 25 // from the queue's end until the Shortcut put things back
    static let nothingLimit: TimeInterval = 9 // ... with an Install Switch that can't put an idle VPN back, until the app stops waiting for it
    private static var busy = false // guarded by lock: from a begin until the VPN goes off after the last connection
    private static var tripOn = false // guarded by lock: a one-trip run goes on in the background
    private static var tripOpen = false // guarded by lock: its Open ran
    private static var tripSeen = false // guarded by lock: its Connect VPN began
    private static var tripError: String? // guarded by lock: its Connect VPN failed (the run ended there)
    private static var tripWhy: String? // guarded by lock: why it didn't come back (testTrip's words)
    private static var tripWaits = 0 // guarded by lock: its Wait for Install turns that ended
    private static var tripBack = false // guarded by lock: the last one put everything back (testTrip)
    private static var tripGo: DispatchSemaphore? // guarded by lock: takeTrip waits on it
    private static var tailing = false // guarded by lock: things are being put back; begin waits
    private static var restored = false // guarded by lock: switchedOn came from the run before (killed)
    private static var waitsSeen = 0 // guarded by lock: Wait for Install turns that began (the check's proof)

    /// The actions are in this build under the ID the signed Shortcut names (a signer may have renamed the app).
    static var tripAvailable: Bool {
        guard #available(iOS 16.0, *) else { return false }
        return Bundle.main.bundleIdentifier == "com.ryha.ifizbox"
    }
    static func tripReady() -> Bool { tripAvailable && UserDefaults.standard.bool(forKey: tripKey) }

    static func savePending(cellular: Bool, vpn: Set<String>, selected: Bool) {
        UserDefaults.standard.set(["cellular": cellular, "vpn": Array(vpn), "selected": selected] as [String: Any], forKey: pendingKey)
    }
    static func clearPending() { UserDefaults.standard.removeObject(forKey: pendingKey) }

    /// At launch: what a run left out when the app was killed is due; the first didBecomeActive puts it back (endSwitch).
    static func restorePending() {
        restoreLost()
        guard let p = UserDefaults.standard.dictionary(forKey: pendingKey) else { return }
        lock.lock()
        switchedOn = true; switchEndDue = true; restored = true
        switchDataOff = p["cellular"] as? Bool ?? false
        switchVPNBefore = Set(p["vpn"] as? [String] ?? [])
        switchSelectedBefore = p["selected"] as? Bool ?? false
        lock.unlock()
        log("Install Switch: the app ended before its end ran")
    }

    private static func waitForPutBack(_ step: (String) -> Void) {
        let t0 = Date()
        while Date().timeIntervalSince(t0) < putBackLimit + shortcutLimit {
            lock.lock(); let t = tailing; lock.unlock()
            if !t { return }
            step("waiting for the Shortcut \(shortcutNames["switch"]!) to end")
            Thread.sleep(forTimeInterval: 0.2)
        }
    }

    /// The trip up to the app being in front again (blocking). `ran` false: it never began (`older`: an Install Switch
    /// that ignores it). An `error` with `ran`: it began and didn't come back; the end puts back what it took.
    /// Shortcuts' callback decides nothing once our actions ran: on the 15 Pro (iOS 27) a new run gets the error of the
    /// one before, when that ended behind the app (Set VPN's error 2).
    private static func takeTrip(cellular: Bool, selected: Bool, _ step: (String) -> Void) -> (ran: Bool, error: String?, older: Bool) {
        step("running the Shortcut \(shortcutNames["switch"]!)")
        let sem = DispatchSemaphore(value: 0)
        lock.lock()
        tripOpen = false; tripSeen = false; tripError = nil; tripWhy = nil; tripWaits = 0; tripBack = false; tripGo = sem; switchDataOff = cellular
        let before = switchVPNBefore
        lock.unlock()
        savePending(cellular: cellular, vpn: before, selected: selected)
        var called: (at: Date, ok: Bool, error: String?)? // guarded by lock
        openShortcut("switch", text: switchInput("trip", cellular: cellular, selected: selected)) { ok, err in
            lock.lock(); called = (Date(), ok, err); lock.unlock()
        }
        let t0 = Date()
        while Date().timeIntervalSince(t0) < shortcutLimit {
            if sem.wait(timeout: .now() + 0.2) == .success { break }
            lock.lock(); let seen = tripSeen, c = called; lock.unlock()
            if let c, !seen, Date().timeIntervalSince(c.at) > callbackGrace || notOpened(c.error) { break }
        }
        lock.lock()
        let open = tripOpen, seen = tripSeen, failed = tripError, c = called
        if !open { switchDataOff = false } // data goes off only after Connect VPN, just before Open
        lock.unlock()
        if open {
            log("Install Switch: one trip, \(Brand.name) is in front again")
            if cellular { waitOffCellular() }
            return (true, nil, false)
        }
        let older = !seen && c?.ok == true
        if older { // an older Install Switch ignores "trip": its own runs, from the next queue on
            UserDefaults.standard.set(false, forKey: tripKey)
            log("Install Switch: the added one can't do it in one trip")
        } else { log("Install Switch: the trip didn't come back: \(failed ?? c?.error ?? "no answer in \(Int(shortcutLimit)) s")") }
        if seen && cellular && failed == nil { // between data off and Open: the end must turn it on
            lock.lock(); switchDataOff = true; lock.unlock()
        } else { savePending(cellular: false, vpn: before, selected: selected) }
        let error = failed ?? c?.error ?? (older ? "the added one is an older one" : "Shortcuts didn't come back in \(Int(shortcutLimit)) s")
        lock.lock(); tripWhy = error; lock.unlock()
        let began = seen || !(older || notOpened(c?.error) || SwitchOpens.notFound(c?.error))
        if began { lock.lock(); opens.fail(); lock.unlock() }
        return (began, error, older)
    }

    /// After a trip's queue, the VPN off: lets the Shortcut go on and waits until it put things back. What it didn't
    /// put back is left to endSwitch (switchEndDue).
    private static func endTrip(_ gen: Int) {
        lock.lock()
        let waits = tripWaits, canIdle = UserDefaults.standard.bool(forKey: idleKey)
        if stopGen == gen { busy = false }
        guard tripOn else { lock.unlock(); return }
        guard stopGen == gen else { tailing = false; lock.unlock(); return } // another connect began: the trip goes on
        let dataOff = switchDataOff, before = switchVPNBefore, selected = switchSelectedBefore
        lock.unlock()
        let t0 = Date()
        var back = false, ranOut: Date?, nothing = false
        while !back && Date().timeIntervalSince(t0) < putBackLimit {
            Thread.sleep(forTimeInterval: 0.3)
            back = !switchEndNeeded(dataOff: dataOff, vpnBefore: !before.isEmpty || selected, dataBack: Path.now().cellular, vpnBack: otherVPNBack(before, selected: selected))
            lock.lock(); let over = tripWaits >= waitTurns, past = tripWaits > waits, told = canIdle && tripWaits > waitTurns; lock.unlock()
            // F389: data and addresses are back, and no VPN took the place in Settings: the selected one had no On Demand
            // (off, not idle), which the Shortcut says with one more Wait. An older one never puts it back
            if !back && selected && (told || !canIdle && past && Date().timeIntervalSince(t0) > nothingLimit) && !switchEndNeeded(dataOff: dataOff, vpnBefore: !before.isEmpty, dataBack: Path.now().cellular, vpnBack: otherVPNBack(before, selected: false)) {
                nothing = true; back = true
            }
            if over && ranOut == nil { ranOut = Date() }
            if let e = ranOut, Date().timeIntervalSince(e) > 10 { break } // a VPN needs a moment to have its address
        }
        lock.lock()
        let done = back // not back: endSwitch runs the end (the trip keeps the remembered VPN for it)
        tripOn = false; tripGo = nil; tripBack = done
        if done { switchedOn = false } else { switchEndDue = switchedOn }
        tailing = false
        lock.unlock()
        if done { clearPending() }
        log("Install Switch: after the trip, \(back ? nothing ? "nothing to put back" : "everything is back" : "not everything is")")
    }

    /// Connect VPN (blocking): our VPN for the trip's queue. Outside one nothing would turn it off again.
    static func tripConnect() throws {
        lock.lock(); let on = busy; lock.unlock()
        guard on else { throw IDevice.Failure(code: "vpn_failed", text: "\(Brand.name) isn't installing an app") }
        lock.lock(); tripSeen = true; lock.unlock()
        do { try up() } catch {
            lock.lock(); tripError = (error as? IDevice.Failure)?.text ?? error.localizedDescription; let go = tripGo; lock.unlock()
            go?.signal()
            throw error
        }
    }

    /// Open (the app is in front): the install goes on.
    static func tripOpened() {
        lock.lock()
        tripOpen = true
        if busy && switchedOn { tripOn = true } // also one that came late
        let go = tripGo
        lock.unlock()
        go?.signal()
    }

    /// Wait for Install, one turn: true while the queue is still going.
    static func tripWaiting() -> Bool {
        lock.lock(); defer { lock.unlock() }
        waitsSeen += 1
        return busy
    }

    /// A Wait for Install turn ended. The last one with the queue still going (a 15 min install): the Shortcut puts
    /// everything back now, and endSwitch looks again once the queue is over.
    static func tripWaited() {
        lock.lock()
        tripWaits += 1
        let out = tripWaits == waitTurns && tripOn && busy
        if out { tripOn = false }
        lock.unlock()
        if out { log("Install Switch: the trip's waits ran out before the install") }
    }

    /// The Install Switch's check run: with our actions when this build has them (that proves the one trip, and iOS
    /// asks its Allow here and not over an install).
    static func checkSwitch() -> (ok: Bool, error: String?) {
        guard tripAvailable else { return runShortcut("switch", check: true) }
        lock.lock(); waitsSeen = 0; lock.unlock()
        let r = runShortcut("switch", input: switchInput("check", actions: true, selected: true))
        var waits = 0
        for i in 0..<10 { // F389: an earlier run's callback can come before this run's second Wait
            lock.lock(); waits = waitsSeen; lock.unlock()
            if waits == 0 || waits > 1 || i == 9 { break }
            Thread.sleep(forTimeInterval: 0.2)
        }
        let seen = waits > 0
        UserDefaults.standard.set(seen, forKey: tripKey)
        UserDefaults.standard.set(waits > 1, forKey: idleKey)
        log("Install Switch: one trip \(seen ? "works" : "doesn't work (\(r.error ?? "an older Install Switch"))")")
        return seen ? (true, nil) : r // seen: our action ran, whatever callback an earlier run left behind (takeTrip)
    }

    /// vpn.checkShortcut's runs (blocking), SwitchOpens.checkLimit at most: B395: it ran up to five times, each a hop to
    /// Shortcuts and back, when Shortcuts couldn't find it (Replace leaves two, and neither runs by name).
    static func checkShortcut(_ which: String) -> (ok: Bool, error: String?) {
        var r = which == "switch" ? checkSwitch() : runShortcut(which, check: true)
        if !r.ok, let again = SwitchOpens.again(0, error: r.error, actions: which == "switch" && tripAvailable && !notOpened(r.error)) {
            log("Shortcut \(which): \(r.error ?? "failed"), once more")
            switch again {
            case .same: // just after Add Shortcut's Replace, Shortcuts can't find it for some seconds
                Thread.sleep(forTimeInterval: SwitchOpens.checkWait)
                r = which == "switch" ? checkSwitch() : runShortcut(which, check: true)
            case .plain: // F394: with our actions refused (Don't Allow), it still works as before: the plain check says so
                r = runShortcut(which, check: true)
            }
        }
        if r.ok { lock.lock(); opens.forgive(); lock.unlock() }
        return r
    }

    /// The end's run, with Set VPN's last word forgiven: on the 15 Pro (iOS 27) Set VPN on the remembered VPN switches
    /// back to it (Settings shows it selected and connected) and then reports NEVPNErrorDomain error 2
    /// (configuration disabled), which ends the run. Through x-callback-url iOS shows no alert for it.
    static func switchEnded(_ r: (ok: Bool, error: String?)) -> (ok: Bool, error: String?) {
        if !r.ok, let e = r.error, e.contains("NEVPNErrorDomain error 2") {
            log("Install Switch: Set VPN said \(e); the VPN switched back regardless")
            return (true, nil)
        }
        return r
    }

    /// vpn.testSwitch (blocking): the start, then (whatever it did) the end, as around one install, without an install.
    /// `vpnOn`: this VPN was connected after the start, so Set VPN found it. A run that passed marks it added.
    static func testSwitch() -> [String: Any] {
        let cellular = Path.now().cellular
        lock.lock(); opens.forgive(); lock.unlock() // B395: the user's own tap
        if tripReady() { return testTrip(cellular) }
        let start = runShortcut("switch", input: switchInput("start", selected: otherVPNSelected())) // B375: data off only once the VPN is up
        var wentOff = false, vpnOn = false
        if start.ok {
            let t0 = Date()
            while Date().timeIntervalSince(t0) < startLimit && !vpnOn {
                vpnOn = connectedNow()
                if !vpnOn { Thread.sleep(forTimeInterval: 0.2) }
            }
            if cellular && vpnOn && runShortcut("switch", input: switchInput("dataOff")).ok {
                let t1 = Date()
                while Date().timeIntervalSince(t1) < dataOffLimit && !wentOff {
                    wentOff = !Path.now().cellular
                    if !wentOff { Thread.sleep(forTimeInterval: 0.2) }
                }
            }
        }
        // B395: not found: an end would open Shortcuts for nothing
        let end = SwitchOpens.notFound(start.error) ? start : switchEnded(runShortcut("switch", input: switchInput("end", cellular: cellular)))
        UserDefaults.standard.set(start.ok && end.ok, forKey: shortcutKeys["switch"]!)
        return ["ok": start.ok && end.ok, "cellular": cellular, "wentOff": wentOff, "vpnOn": vpnOn,
                "start": ["ok": start.ok, "error": (start.error as Any?) ?? NSNull()],
                "end": ["ok": end.ok, "error": (end.error as Any?) ?? NSNull()]]
    }

    /// testSwitch in one trip, as a queue takes it.
    private static func testTrip(_ cellular: Bool) -> [String: Any] {
        var failure: String?
        do { _ = try begin(forced: true) } catch { failure = error.localizedDescription }
        lock.lock(); let open = tripOpen, why = tripError ?? tripWhy; lock.unlock()
        let vpnOn = connectedNow(), wentOff = cellular && !Path.now().cellular
        if failure == nil { end() } // begin() ended its own hold when it threw
        let t0 = Date()
        while Date().timeIntervalSince(t0) < linger + putBackLimit + shortcutLimit {
            Thread.sleep(forTimeInterval: 0.3)
            lock.lock(); let going = busy || tripOn || tailing; lock.unlock()
            if !going { break }
        }
        lock.lock(); let back = tripBack; lock.unlock()
        let startErr = open ? nil : why ?? failure ?? "\(Brand.name) wasn't opened again"
        let endErr = open && !back ? "it didn't put your VPN back" : nil
        UserDefaults.standard.set(open && endErr == nil, forKey: shortcutKeys["switch"]!)
        return ["ok": open && endErr == nil, "cellular": cellular, "wentOff": wentOff, "vpnOn": vpnOn,
                "start": ["ok": open, "error": (startErr as Any?) ?? NSNull()],
                "end": ["ok": endErr == nil, "error": (endErr as Any?) ?? NSNull()]]
    }

    /// This VPN's configuration is connected now (read only: nothing saved, so iOS asks nothing). Blocking.
    static func connectedNow() -> Bool {
        guard let id = providerID else { return false }
        var status = NEVPNStatus.invalid // written before done() signals the wait
        let _: Bool? = try? wait("reading the VPN configuration", 5) { done in
            NETunnelProviderManager.loadAllFromPreferences { ms, err in
                let m = ms?.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == id }
                status = m?.connection.status ?? .invalid
                done(err, true)
            }
        }
        return status == .connected
    }

    // ---- Cellular Shortcuts

    static func shortcutsAdded() -> Bool { ["off", "on"].allSatisfy { UserDefaults.standard.bool(forKey: shortcutKeys[$0]!) } }

    private static var waiting: [String: (Bool, String?) -> Void] = [:] // callback id -> its run; guarded by lock

    /// Runs the Shortcut `which` ("off"/"on") through Shortcuts' x-callback-url and waits until Shortcuts comes back
    /// (blocking, never on the main thread). iOS opens another app only from the front, so a run from the background
    /// fails at once.
    /// B359: `check` runs it with a text input, which our Shortcuts (tools/shortcuts/) take as "do nothing": it proves
    /// the Shortcut is there under its name and runs, without turning cellular data off.
    /// F386: `input` is the text the Shortcut gets (the Install Switch's flags); a check run of the Install Switch
    /// sends {"check":1}, which it takes as "do nothing".
    static func runShortcut(_ which: String, check: Bool = false, input: String? = nil) -> (ok: Bool, error: String?) {
        guard shortcutNames[which] != nil else { return (false, "no Shortcut \(which)") }
        let sem = DispatchSemaphore(value: 0)
        var out: (Bool, String?) = (false, nil)
        let text = check ? (which == "switch" ? switchInput("check") : "check") : input
        let id = openShortcut(which, text: text) { ok, err in out = (ok, err); sem.signal() }
        if sem.wait(timeout: .now() + shortcutLimit) != .success {
            finish(id, false, "Shortcuts didn't come back in \(Int(shortcutLimit)) s")
            sem.wait()
        }
        return out
    }

    /// Opens Shortcuts on the Shortcut `which` with the input `text`; `done` gets its callback, or why it didn't open.
    /// Answers the run's callback id. Blocking for up to 3 s.
    @discardableResult
    private static func openShortcut(_ which: String, text: String?, _ done: @escaping (Bool, String?) -> Void) -> String {
        let id = UUID().uuidString
        lock.lock(); waiting[id] = done; lock.unlock()
        let back = { (r: String) in "ifizbox://vpn-shortcut?id=\(id)&r=\(r)" }
        var c = URLComponents()
        c.scheme = "shortcuts"; c.host = "x-callback-url"; c.path = "/run-shortcut"
        c.queryItems = [URLQueryItem(name: "name", value: shortcutNames[which]), URLQueryItem(name: "x-success", value: back("ok")),
                        URLQueryItem(name: "x-error", value: back("error")), URLQueryItem(name: "x-cancel", value: back("cancel"))]
        if let text { c.queryItems! += [URLQueryItem(name: "input", value: "text"), URLQueryItem(name: "text", value: text)] }
        // B359: the page sees itself visible again, and Shortcuts' callback for the run before arrives, a moment before
        // iOS calls the app active: wait for it a little, or the open below is refused
        let t0 = Date()
        while !DispatchQueue.main.sync(execute: { UIApplication.shared.applicationState == .active }) && Date().timeIntervalSince(t0) < 3 {
            Thread.sleep(forTimeInterval: 0.1)
        }
        guard let url = c.url else { finish(id, false, "bad Shortcut link"); return id }
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState == .active else {
                return finish(id, false, "\(Brand.name) wasn't in front, so iOS wouldn't open Shortcuts")
            }
            UIApplication.shared.open(url, options: [:]) { ok in if !ok { finish(id, false, "Shortcuts didn't open") } }
        }
        return id
    }

    private static func finish(_ id: String, _ ok: Bool, _ err: String?) {
        lock.lock(); let f = waiting.removeValue(forKey: id); lock.unlock()
        f?(ok, err)
    }

    /// B359: vpn.openShortcuts {which, url}: our signed Shortcut (web/shortcuts/<name>.shortcut in the app, signed by
    /// tools/shortcuts/sign.sh) in a share sheet, where Shortcuts opens it on its Add Shortcut sheet (shortcuts://
    /// import-shortcut takes only iCloud links). Without the bundled file, `url` (the same file on the site) opens in
    /// Safari. F392: with `link`, our Shortcut's iCloud link, Shortcuts opens on its Add Shortcut at once, no share
    /// sheet. Replies {opened, via: "shortcuts"|"share"|"site"} when the sheet closes; Shortcuts never says it was added, so the
    /// page runs vpn.checkShortcut once the user is back.
    static func importShortcut(_ c: Bridge.Call) {
        let w = c.params["which"] as? String ?? ""
        guard let name = shortcutNames[w] else { return c.reply(nil, "no Shortcut \(w)") }
        DispatchQueue.main.async {
            if let s = c.params["link"] as? String { // F392
                let host = URL(string: s)?.host
                var u = URLComponents(string: "shortcuts://import-shortcut")
                u?.queryItems = [URLQueryItem(name: "url", value: s), URLQueryItem(name: "name", value: name)]
                guard host == "www.icloud.com" || host == "icloud.com", let url = u?.url else { return c.reply(nil, "not an iCloud link") }
                return UIApplication.shared.open(url, options: [:]) { ok in
                    log("Shortcut \(name): Shortcuts \(ok ? "opened" : "didn't open") on its link")
                    if ok { c.reply(["opened": true, "via": "shortcuts"], nil) } else { c.reply(nil, "Shortcuts didn't open") }
                }
            }
            let file = Bundle.main.url(forResource: name, withExtension: "shortcut", subdirectory: "web/shortcuts")
            guard let file, let top = MyIPAs.topController() else {
                guard let s = c.params["url"] as? String, let u = URL(string: s) else { return c.reply(["opened": false], nil) }
                return UIApplication.shared.open(u, options: [:]) { ok in c.reply(["opened": ok, "via": "site"], nil) }
            }
            let vc = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            vc.completionWithItemsHandler = { type, done, _, _ in
                log("Shortcut \(name): share sheet \(done ? "sent to \(type?.rawValue ?? "?")" : "closed")")
                c.reply(["opened": done, "via": "share"], nil)
            }
            if let pop = vc.popoverPresentationController {
                pop.sourceView = top.view
                pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY, width: 1, height: 1)
            }
            top.present(vc, animated: true)
        }
    }

    /// ifizbox://vpn-shortcut?id=…&r=ok|error|cancel[&errorMessage=…], Shortcuts coming back. True when it was one.
    static func receive(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "ifizbox", url.host == "vpn-shortcut" else { return false }
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let v = { (k: String) in q.first { $0.name == k }?.value }
        let r = v("r") ?? "error"
        let err = r == "ok" ? nil : (v("errorMessage") ?? (r == "cancel" ? "the Shortcut was canceled" : "the Shortcut failed"))
        if let id = v("id") { finish(id, r == "ok", err) }
        return true
    }
}

enum LocalVPNBridge {
    static func register(_ b: Bridge) {
        LocalVPN.Path.start()
        if AppMode.current != .jailbreak { LocalVPN.restorePending() } // F394: before the first didBecomeActive
        b.on("vpn.status") { c in quick(c) { LocalVPN.status() } }
        b.on("vpn.test") { c in
            IDeviceBridge.run(c) {
                guard LocalVPN.available else { throw IDevice.Failure(code: "vpn_failed", text: "this app can't run \(LocalVPN.name): its profile has no Network Extensions capability") }
                // on first, so a VPN that doesn't start is this test's error (an install would go another way in)
                _ = try LocalVPN.begin(cellular: false) // the connect below runs the Cellular Shortcuts when needed
                defer { LocalVPN.end() }
                let t0 = Date() // the connect alone, not iOS's Allow on the first save
                let kind = try IDevice.verify()
                let ms = Int(Date().timeIntervalSince(t0) * 1000)
                UserDefaults.standard.set(true, forKey: LocalVPN.testedKey)
                return ["ok": true, "ms": ms, "kind": kind.rawValue]
            }
        }
        b.on("vpn.openShortcuts") { c in LocalVPN.importShortcut(c) }
        b.on("vpn.checkShortcut") { c in
            guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: Cellular Shortcuts are for the sideload app's This iPhone installs") }
            guard let w = c.params["which"] as? String, let key = LocalVPN.shortcutKeys[w] else { return Apt.reply(c, nil, "no Shortcut given") }
            DispatchQueue.global(qos: .userInitiated).async {
                let r = LocalVPN.checkShortcut(w)
                UserDefaults.standard.set(r.ok, forKey: key) // Added only once it ran
                Apt.reply(c, ["ok": r.ok, "error": (r.error as Any?) ?? NSNull(), "status": LocalVPN.status()], nil)
            }
        }
        b.on("vpn.leftOff") { c in LocalVPN.waitLeftOff(c) }
        b.on("vpn.testSwitch") { c in
            guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
            DispatchQueue.global(qos: .userInitiated).async { Apt.reply(c, LocalVPN.testSwitch(), nil) }
        }
        // F386: an Install Switch end that found the app in the background runs once it is in front again
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { _ in
            DispatchQueue.global(qos: .utility).async { LocalVPN.endSwitch(); LocalVPN.sayKept() }
        }
    }

    static func quick(_ c: Bridge.Call, _ f: @escaping () -> Any?) { IDeviceBridge.quick(c, f) }
}
