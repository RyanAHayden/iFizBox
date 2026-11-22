// The bridge calls for the "no server" install route (IDevice.swift), sideload build only:
//   idevice.status        {paired: "rp"|"lockdown"|null, ios, pairOnPhone, localDevVPN, otherVPN, tunnels, tailscale}
//   idevice.import        {data: base64 pairing file} -> status; a lockdown pairing record or a RemotePairing one
//   idevice.pair          makes the 6-digit code first and emits [{pin}] at once (also posted as a notification, for
//                         the Settings app), then [{step, text}] as it goes (listening, advertised, connected) and
//                         [{step: "failed", error}] when a try fails (it keeps listening: Pair can be tapped again);
//                         replies status when paired (iOS 27+). No timeout: it waits until paired or canceled.
//                         B320: on a queue of its own (connects never wait behind it), and called while one still
//                         runs it joins that one (the same code; the earlier call replies "canceled: ...")
//   idevice.pairState     {active, pin, step, text, error}: the pairing now, for a page that was in the background
//   idevice.pairCancel    ends a waiting idevice.pair (it replies "canceled: ..."); B320: its advertisement stays up
//                         leaveGrace (90 s) more, so a page that comes back within it gets the same code
//   idevice.verify        connects once: {ok: true, kind} or "not_paired:/connect_failed:/bad_pairing: ..."
//   idevice.forget        deletes the pairing -> status
//   idevice.openLocalDevVPN  opens the LocalDevVPN app ({opened: false} when it isn't installed)
//   idevice.vpnApps       {localdevvpn: bool, tailscale: bool}: which VPN apps are installed (canOpenURL on their
//                         schemes, listed in Info-sideload.plist LSApplicationQueriesSchemes); the page picks the
//                         way to connect from it (web/app/core/installroute.js vpnRoute)
// Installing through this route is IDevice.install(_:progress:), called by the install run.
import Foundation
import UIKit
import UserNotifications

enum IDeviceBridge {
    /// B320: the pairing that runs: its cancel and the call its events and answer go to (a later idevice.pair joins
    /// it and takes the call over). Guarded by lock.
    private final class PairSession {
        let cancel: IDevice.PairCancel
        let code: String // the 6-digit code every try of this pairing uses
        var call: Bridge.Call? // nil once the page left (idevice.pairCancel), until a page joins again
        var leaving = 0 // bumped by every leave and join: a scheduled stop runs only if nothing came after it
        init(cancel: IDevice.PairCancel, code: String, call: Bridge.Call) { self.cancel = cancel; self.code = code; self.call = call }
    }
    /// B320: how long a left pairing keeps advertising before it stops. iOS's Developer Mode page (Preferences) keeps a
    /// row for every advertisement that came and went while it was open or in the background ("Pair with <app>" three
    /// times on the iPhone 15 Pro, only the last one alive): coming back to Pairing within this rejoins the same one.
    static let leaveGrace: TimeInterval = 90
    private static var pairing: PairSession? // guarded by lock
    private static let lock = NSLock()
    private static let pairQueue = DispatchQueue(label: "ifizbox.idevice.pair", qos: .userInitiated) // one pairing at a time
    static let localDevVPNScheme = "localdevvpn://" // LocalDevVPN's URL scheme, to open it
    // The Tailscale app's URL scheme: Tailscale's own deep links use it (tailscale/tailscale tka/deeplink.go,
    // DeeplinkTailscaleURLScheme = "tailscale").
    static let tailscaleScheme = "tailscale://"
    static let codeNoteID = "ifizbox-pairing-code"
    private static var now: [String: Any] = ["active": false] // idevice.pairState; guarded by lock

    /// Runs one pairing (blocking, on pairQueue): its events update idevice.pairState and go to the session's call
    /// of the moment. Answers status once paired.
    private static func pair(_ session: PairSession, code: String) throws -> Any? {
        try IDevice.pairOnPhone(code: code, cancel: session.cancel) { ev in
            let e: [String: Any]
            switch ev {
            case .pin(let pin): e = ["pin": pin]
            case .step(let step, let text): e = ["step": step, "text": text]
            case .failed(let step, let error): e = ["step": "failed", "failedAt": step, "error": error]
            }
            lock.lock()
            let to = session.call
            if pairing === session {
                if let p = e["pin"] { now["pin"] = p }
                if let st = e["step"] { now["step"] = st }
                if let t = e["text"] { now["text"] = t; now["error"] = "" }
                if let err = e["error"] { now["error"] = err }
            }
            lock.unlock()
            if let to = to { DispatchQueue.main.async { to.emit([e]) } }
        }
        return status()
    }

    static func register(_ b: Bridge) {
        // Not on IDevice.queue: a connect or a Tailscale sign-in can hold it, and the page asks for these meanwhile.
        b.on("idevice.status") { c in quick(c) { status() } }
        b.on("idevice.pairState") { c in quick(c) { lock.lock(); defer { lock.unlock() }; return now } }
        b.on("idevice.import") { c in
            run(c) {
                guard let s = c.params["data"] as? String, let d = Data(base64Encoded: s) else {
                    throw IDevice.Failure(code: "bad_pairing", text: "no pairing file")
                }
                _ = try IDevice.importPairing(d)
                return status()
            }
        }
        b.on("idevice.pair") { c in
            guard AppMode.current != .jailbreak else { return run(c) { nil } } // run() refuses the jailbreak build
            lock.lock()
            // B320: a pairing that still runs (the page drawn again: its web view reloaded; or left less than
            // leaveGrace ago) is joined, not started again: the same code and the same advertisement, its events and
            // its answer now go to this call. Starting over drew a new code and a new advertisement while the phone's
            // Settings still showed the earlier one, so the code on the page didn't work there.
            if let running = pairing, !running.cancel.isCanceled {
                let code = running.code
                let earlier = running.call
                running.call = c
                running.leaving += 1 // a stop scheduled by a leave doesn't run
                let snapshot = now
                lock.unlock()
                IDevice.log("idevice.pair joined the pairing that runs (same code)")
                if let e = earlier { Apt.reply(e, nil, "canceled: another page took over this pairing") }
                c.emit([["pin": code]])
                if let step = snapshot["step"] as? String, step != "starting" {
                    c.emit([["step": step, "text": snapshot["text"] as? String ?? ""]])
                }
                return
            }
            let cancel = IDevice.PairCancel()
            let code = IDevice.newPairingCode()
            let session = PairSession(cancel: cancel, code: code, call: c)
            pairing?.cancel.signal()
            pairing = session
            now = ["active": true, "pin": code, "step": "starting", "text": "", "error": ""]
            lock.unlock()
            // The code first, before anything listens: the page shows it, and a notification carries it into the
            // Settings app, where it is typed. iFizBox is in the background meanwhile: KeepAlive's silent audio
            // keeps the listener and Bonjour going for as long as the page is in pairing mode.
            c.emit([["pin": code]])
            KeepAlive.shared.begin()
            postCode(code)
            // B320: on its own queue, not IDevice.queue: behind a check, a test or a Tailscale sign-in there, the code
            // showed while nothing listened yet; and every connect waited behind a pairing with no time limit
            pairQueue.async {
                var result: Any? = nil, failure: String? = nil
                do {
                    result = try pair(session, code: code)
                } catch let e as IDevice.Failure { failure = e.errorDescription } catch { failure = "internal: \(error.localizedDescription)" }
                lock.lock()
                let to = session.call
                if pairing === session { pairing = nil; now = ["active": false] }
                lock.unlock()
                KeepAlive.shared.end()
                removeCode()
                if let to = to { Apt.reply(to, result, failure) }
            }
        }
        // B320: the page's call ends at once ("canceled: ..."), the advertisement stops leaveGrace later unless a page
        // joins it again first
        b.on("idevice.pairCancel") { c in
            lock.lock()
            var earlier: Bridge.Call? = nil
            if let s = pairing, !s.cancel.isCanceled {
                earlier = s.call
                s.call = nil
                s.leaving += 1
                let gen = s.leaving
                DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + leaveGrace) {
                    lock.lock(); let stop = pairing === s && s.leaving == gen; lock.unlock()
                    guard stop else { return }
                    IDevice.log("the page left \(Int(leaveGrace)) s ago; pairing stops")
                    s.cancel.signal()
                }
            }
            lock.unlock()
            if let e = earlier { Apt.reply(e, nil, "canceled: pairing stopped") }
            Apt.reply(c, ["ok": true], nil)
        }
        b.on("idevice.verify") { c in run(c) { ["ok": true, "kind": try IDevice.verify().rawValue] } }
        b.on("idevice.forget") { c in
            run(c) {
                IDevice.deletePairing(.remotePairing)
                IDevice.deletePairing(.lockdown)
                return status()
            }
        }
        b.on("idevice.openLocalDevVPN") { c in
            DispatchQueue.main.async {
                guard AppMode.current != .jailbreak, let u = URL(string: localDevVPNScheme) else { return c.reply(["opened": false], nil) }
                UIApplication.shared.open(u, options: [:]) { ok in c.reply(["opened": ok], nil) }
            }
        }
        b.on("idevice.vpnApps") { c in
            DispatchQueue.main.async { // canOpenURL is main-thread UIKit
                guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
                let has = { (s: String) in URL(string: s).map { UIApplication.shared.canOpenURL($0) } ?? false }
                c.reply(["localdevvpn": has(localDevVPNScheme), "tailscale": has(tailscaleScheme)], nil)
            }
        }
    }

    /// Sideload build only (the jailbreak app installs through its helper), on IDevice.queue, which keeps one
    /// connection to the phone at a time. idevice.pair runs on pairQueue instead (B320).
    static func run(_ c: Bridge.Call, _ f: @escaping () throws -> Any?) {
        guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
        IDevice.queue.async {
            do { Apt.reply(c, try f(), nil) } catch let e as IDevice.Failure { Apt.reply(c, nil, e.errorDescription) } catch {
                Apt.reply(c, nil, "internal: \(error.localizedDescription)")
            }
        }
    }

    /// The quick calls, off IDevice.queue (sideload build only, like run).
    static func quick(_ c: Bridge.Call, _ f: @escaping () -> Any?) {
        guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
        DispatchQueue.global(qos: .userInitiated).async { Apt.reply(c, f(), nil) }
    }

    // "iFizBox Pairing Code" / "123 456 — type it in Settings", while pairing waits. Asks for permission the first
    // time; without it there is no notification, and the code is on the page.
    static func postCode(_ code: String) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return IDevice.log("no notification permission; the code is on the page only") }
            let n = UNMutableNotificationContent()
            n.title = "\(Brand.name) Pairing Code"
            n.body = "\(code.prefix(3)) \(code.suffix(3)) — type it in Settings"
            n.sound = .default
            center.add(UNNotificationRequest(identifier: codeNoteID, content: n, trigger: nil)) { err in
                if let err = err { IDevice.log("notification: \(err.localizedDescription)") }
            }
        }
    }

    static func removeCode() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [codeNoteID])
        center.removeDeliveredNotifications(withIdentifiers: [codeNoteID])
    }

    static func status() -> [String: Any] {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        var s = VPNCheck.status()
        s["paired"] = IDevice.pairing().map { $0.kind.rawValue as Any } ?? NSNull()
        s["ios"] = "\(v.majorVersion).\(v.minorVersion)"
        s["pairOnPhone"] = v.majorVersion >= 27 // iOS 27 pairs with the app on the phone; older imports a file
        s["tailscale"] = Tailscale.status() // native/sideload/tailscale: Connect With and the node
        return s
    }
}
