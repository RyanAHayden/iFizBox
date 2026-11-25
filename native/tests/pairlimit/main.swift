// B436: stand-ins for what native/sideload/idevice/IDeviceBridge.swift uses, so the real file runs on Linux: a fake
// clock (test_pair_limit.py points the file's asyncAfter calls at it), a pairing that waits until it is canceled or
// paired, and counts of the KeepAlive holds and the code notification. Then the checks.
import Foundation

struct Bridge {
    struct Call {
        let params: [String: Any]
        let emit: ([[String: Any]]) -> Void
        let reply: (Any?, String?) -> Void
    }
}
enum Table { nonisolated(unsafe) static var on: [String: (Bridge.Call) -> Void] = [:] }
extension Bridge { func on(_ name: String, _ f: @escaping (Call) -> Void) { Table.on[name] = f } }
enum Apt { static func reply(_ c: Bridge.Call, _ v: Any?, _ e: String?) { c.reply(v, e) } }
enum AppMode { case jailbreak, sideload; static let current = AppMode.sideload }
enum Brand { static let name = "App" }
enum VPNCheck { static func status() -> [String: Any] { [:] } }
enum LocalVPN { static func status() -> [String: Any] { [:] } }

final class Guarded<T>: @unchecked Sendable {
    private let lock = NSLock(); private var v: T
    init(_ v: T) { self.v = v }
    func with<R>(_ f: (inout T) -> R) -> R { lock.lock(); defer { lock.unlock() }; return f(&v) }
    var value: T { with { $0 } }
}

/// The fake clock: a timer runs on the thread that advances it.
enum Clock {
    static let state = Guarded<(now: Double, due: [(Double, () -> Void)])>((0, []))
    static func after(_ s: Double, _ f: @escaping () -> Void) { state.with { $0.due.append(($0.now + s, f)) } }
    static func advance(_ s: Double) {
        let run = state.with { st -> [() -> Void] in
            st.now += s
            let due = st.due.filter { $0.0 <= st.now }
            st.due.removeAll { $0.0 <= st.now }
            return due.map { $0.1 }
        }
        run.forEach { $0() }
    }
}

final class KeepAlive: Sendable {
    static let shared = KeepAlive()
    let holds = Guarded(0)
    func begin() { holds.with { $0 += 1 } }
    func end() { holds.with { $0 -= 1 } }
}

/// The notification: `shown` is its body; with `late` set the permission alert waits for `grant`.
enum Notes {
    static let shown = Guarded<String?>(nil)
    static let late = Guarded(false)
    static let grant = Guarded<(() -> Void)?>(nil)
}
final class UNMutableNotificationContent { var title = "", body = ""; var sound = Sound.def; enum Sound { case def; static let `default` = Sound.def } }
struct UNNotificationRequest { let identifier: String, content: UNMutableNotificationContent, trigger: Any? }
final class UNUserNotificationCenter {
    enum Opt { case alert, sound }
    static func current() -> UNUserNotificationCenter { UNUserNotificationCenter() }
    func requestAuthorization(options: [Opt], _ f: @escaping (Bool, Error?) -> Void) {
        if Notes.late.value { Notes.grant.with { $0 = { f(true, nil) } } } else { f(true, nil) }
    }
    func add(_ r: UNNotificationRequest, _ f: @escaping (Error?) -> Void) { Notes.shown.with { $0 = r.content.body }; f(nil) }
    func removePendingNotificationRequests(withIdentifiers: [String]) {}
    func removeDeliveredNotifications(withIdentifiers: [String]) { Notes.shown.with { $0 = nil } }
}

enum IDevice {
    struct Failure: LocalizedError { let code: String, text: String; var errorDescription: String? { "\(code): \(text)" } }
    final class PairCancel: Sendable {
        private let canceled = Guarded(false)
        var isCanceled: Bool { canceled.value }
        func signal() { canceled.with { $0 = true } }
    }
    enum PairEvent { case step(String, String), failed(String, String), pin(String) }
    enum Kind: String { case remotePairing = "rp", lockdown }
    static let queue = DispatchQueue(label: "t")
    static let made = Guarded(0)
    static let running = Guarded(0)
    static let paired = Guarded(false) // the next look of the running pairing ends it as paired
    static let stuck = Guarded(false)  // a canceled pairing that hasn't noticed yet
    static func log(_ s: String) {}
    static func newPairingCode() -> String { String(format: "%06d", made.with { $0 += 1; return $0 }) }
    static func pairOnPhone(code: String, cancel: PairCancel, event: @escaping (PairEvent) -> Void) throws {
        running.with { $0 += 1 }
        defer { running.with { $0 -= 1 } }
        event(.step("advertised", "Waiting"))
        while true {
            if paired.value { paired.with { $0 = false }; return }
            if cancel.isCanceled && !stuck.value { throw Failure(code: "canceled", text: "pairing stopped") }
            usleep(2000)
        }
    }
    static func importPairing(_ d: Data) throws -> Kind { .lockdown }
    static func verify() throws -> Kind { .remotePairing }
    static func deletePairing(_ k: Kind) {}
    static func pairing() -> (kind: Kind, data: Data)? { nil }
}

// ---- the checks ----
final class Pairing: @unchecked Sendable {
    let pin = Guarded<String?>(nil), answer = Guarded<String?>(nil)
    init() {
        Table.on["idevice.pair"]!(Bridge.Call(params: [:], emit: { ev in for e in ev { if let p = e["pin"] as? String { self.pin.with { $0 = p } } } },
                                              reply: { _, e in self.answer.with { $0 = e ?? "ok" } }))
    }
}
func state() -> [String: Any] {
    let got = Guarded<[String: Any]?>(nil)
    Table.on["idevice.pairState"]!(Bridge.Call(params: [:], emit: { _ in }, reply: { v, _ in got.with { $0 = v as? [String: Any] } }))
    wait("pairState") { got.value != nil }
    return got.value ?? [:]
}
func leavePage() { Table.on["idevice.pairCancel"]!(Bridge.Call(params: [:], emit: { _ in }, reply: { _, _ in })) }
nonisolated(unsafe) var bad = 0
func check(_ name: String, _ ok: Bool) { print(ok ? "ok   \(name)" : "FAIL \(name)"); if !ok { bad += 1 } }
func wait(_ what: String, _ f: () -> Bool) {
    let end = Date().addingTimeInterval(30)
    while !f() { if Date() > end { print("FAIL \(what): waited 30 s"); exit(1) }; usleep(2000) }
}
func idle() { wait("the pairing to end") { KeepAlive.shared.holds.value == 0 && IDevice.running.value == 0 } }
func stays(_ p: Pairing) -> Bool { usleep(50_000); return p.answer.value == nil && KeepAlive.shared.holds.value == 1 }

IDeviceBridge.register(Bridge())
check("the limit is 10 minutes", IDeviceBridge.pairLimit == 600)

do { // left open
    let p = Pairing()
    wait("start") { IDevice.running.value == 1 }
    check("the code shows and is posted", p.pin.value == "000001" && Notes.shown.value?.contains("000 001") == true)
    Clock.advance(599)
    check("still pairing at 9:59", stays(p))
    Clock.advance(1)
    wait("expiry") { p.answer.value != nil }
    idle()
    check("at 10:00 it answers expired", p.answer.value!.hasPrefix("expired: "))
    check("the hold is given back", KeepAlive.shared.holds.value == 0)
    check("the code notification is gone", Notes.shown.value == nil)
    check("pairState is inactive", state()["active"] as? Bool == false)
}
do { // joined: the original deadline
    let a = Pairing()
    wait("start") { IDevice.running.value == 1 }
    Clock.advance(300)
    let b = Pairing()
    check("a page joining takes the call over, same code", a.answer.value?.hasPrefix("canceled") == true && b.pin.value == a.pin.value)
    Clock.advance(299)
    check("still pairing before the original deadline", stays(b))
    Clock.advance(1)
    wait("expiry") { b.answer.value != nil }
    idle()
    check("a join keeps the original deadline", b.answer.value!.hasPrefix("expired: "))
}
do { // left and rejoined within leaveGrace: the original deadline too
    _ = Pairing()
    wait("start") { IDevice.running.value == 1 }
    Clock.advance(560)
    leavePage()
    let b = Pairing()
    Clock.advance(40)
    wait("expiry") { b.answer.value != nil }
    idle()
    check("leaving and coming back keeps the original deadline", b.answer.value!.hasPrefix("expired: "))
    Clock.advance(1000)
}
do { // paired, then a later pairing: the stale timer leaves both alone
    let a = Pairing()
    wait("start") { IDevice.running.value == 1 }
    Clock.advance(500)
    IDevice.paired.with { $0 = true }
    wait("paired") { a.answer.value != nil }
    idle()
    check("paired answers status", a.answer.value == "ok")
    let b = Pairing()
    wait("start") { IDevice.running.value == 1 }
    Clock.advance(150)
    check("a stale timer leaves the later pairing alone", stays(b) && Notes.shown.value != nil)
    leavePage()
    check("a left pairing answers canceled", b.answer.value?.hasPrefix("canceled") == true)
    Clock.advance(89)
    check("leaveGrace keeps it 90 s", IDevice.running.value == 1)
    Clock.advance(1)
    idle()
    let c = Pairing()
    wait("start") { IDevice.running.value == 1 }
    Clock.advance(400) // past b's deadline
    check("a canceled pairing's timer leaves the later one alone", stays(c))
    Clock.advance(200)
    wait("expiry") { c.answer.value != nil }
    idle()
    check("the later one has its own 10 minutes", c.answer.value!.hasPrefix("expired: "))
}
do { // paired in the moment the limit ran out
    IDevice.stuck.with { $0 = true }
    let a = Pairing()
    wait("start") { IDevice.running.value == 1 }
    Clock.advance(600)
    IDevice.paired.with { $0 = true }
    wait("paired") { a.answer.value != nil }
    idle()
    check("a pairing that finished at the deadline is paired", a.answer.value == "ok")
    // expired but not noticed yet, and a new code asked for: its notification stays
    let b = Pairing()
    wait("start") { IDevice.running.value == 1 }
    Clock.advance(600)
    let c = Pairing()
    check("after the deadline a new code is drawn, not the expired one joined", c.pin.value != b.pin.value)
    IDevice.stuck.with { $0 = false }
    wait("expiry") { b.answer.value != nil }
    wait("the new one") { KeepAlive.shared.holds.value == 1 && IDevice.running.value == 1 }
    check("the expired one's end leaves the new code's notification", Notes.shown.value?.contains(c.pin.value!.suffix(3)) == true && stays(c))
    Clock.advance(600)
    wait("expiry") { c.answer.value != nil }
    idle()
}
do { // the permission alert answered after the limit
    Notes.late.with { $0 = true }
    let a = Pairing()
    wait("start") { IDevice.running.value == 1 }
    Clock.advance(600)
    wait("expiry") { a.answer.value != nil }
    idle()
    Notes.grant.value?()
    check("notifications allowed too late post no expired code", Notes.shown.value == nil)
}
print(bad == 0 ? "all passed" : "\(bad) failed")
exit(bad == 0 ? 0 : 1)
