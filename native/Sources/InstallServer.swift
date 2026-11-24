// The sideload build's install server (I6, docs/signing.md "Installing"): plain HTTP on the loopback interface only,
// serving one signed IPA to iOS's installer while the Signing Server hands iOS the manifest pointing at it
// (Sideload.swift, GET /sign/manifest). F75: no HTTPS server any more: iOS's installer ignores a hand-trusted CA, so
// the old local mode with the phone's own certificate never worked. Nothing listens on Wi-Fi or cellular, and every
// path has a random token.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Network
import UIKit

final class InstallServer {
    enum Body { case data(Data), file(URL) }
    struct Route {
        let type: String
        let body: Body
        // B29: the install console's log (Sideload.serveAndOpen): each request iOS makes and the bytes it got.
        let log: ((String) -> Void)?
        // Once iOS has every byte of the body, over however many requests (ByteCoverage), once.
        let onServed: (() -> Void)?
        // B89: the server's own lines (iFizBox frozen, back in front, the listener re-created), not iOS's requests, and
        // the call when iOS froze iFizBox while this body wasn't served in full yet.
        var note: ((String) -> Void)? = nil
        var onFrozen: ((Freeze) -> Void)? = nil
        init(type: String, body: Body, log: ((String) -> Void)? = nil, onServed: (() -> Void)?) {
            self.type = type; self.body = body; self.log = log; self.onServed = onServed
        }
    }

    // B89: a stretch when iOS had iFizBox frozen (suspended) while it served: the heartbeat found a gap.
    struct Freeze {
        let from: Date, to: Date
        var seconds: Int { Int(to.timeIntervalSince(from).rounded()) }
        var text: String { "\(seconds) s, \(InstallServer.clock(from)) to \(InstallServer.clock(to))" }
    }

    private let queue = DispatchQueue(label: "ifizbox.install-server")
    private var listener: NWListener?
    private var routes = [String: Route]()
    private(set) var port: UInt16 = 0
    private var idle: DispatchWorkItem?
    private var task: UIBackgroundTaskIdentifier = .invalid

    static let plain = InstallServer()

    private init() {}

    // Starts listening if it isn't (a random free port), then calls back with the port. Each install (every item
    // of a queue run) comes through here, so each one checks the listener (B128, ListenerStart in sign/HTTP.swift).
    func start(_ done: @escaping (Result<UInt16, Error>) -> Void) {
        queue.async {
            let since = Date().timeIntervalSince(self.lastBeat)
            switch ListenerStart.decide(has: self.listener != nil, ready: self.listener?.state == .ready, serving: !self.routes.isEmpty,
                                        sinceBeat: self.beat == nil ? 0 : since, gap: InstallServer.freezeGap) {
            case .reuse: return done(.success(self.port))
            case .revive:
                // routes still served name this port: re-create it there (B89), the freeze noted if there was one
                if self.beat != nil && since >= InstallServer.freezeGap { self.tick() } else { self.revive("a new install found it not ready") }
                return done(.success(self.port))
            case .fresh:
                // B128: an idle listener may say .ready while iOS shut its socket during a suspension: never reuse it
                let old = self.listener
                self.listener = nil
                old?.cancel()
                self.port = 0
            }
            do {
                let params = NWParameters.tcp
                params.requiredInterfaceType = .loopback
                params.acceptLocalOnly = true
                params.allowLocalEndpointReuse = true
                // Bound to 127.0.0.1 itself: the install links say 127.0.0.1, and "any address on loopback" could
                // listen on ::1 only, so iOS's installer got "Cannot connect to 127.0.0.1" on every install.
                params.requiredLocalEndpoint = NWEndpoint.hostPort(host: NWEndpoint.Host("127.0.0.1"), port: .any)
                let l = try NWListener(using: params)
                var answered = false
                l.stateUpdateHandler = { st in // the server lives as long as the app
                    switch st {
                    case .ready:
                        guard self.listener === l else { break } // B128: one a later start() replaced
                        self.port = l.port?.rawValue ?? 0
                        if !answered { answered = true; done(.success(self.port)) }
                    case .cancelled: // B128: a later start() replaced it before it was ready: that caller isn't left waiting
                        if !answered { answered = true; done(.failure(NWError.posix(.ECANCELED))) }
                    case .failed(let e):
                        guard self.listener === l else { break } // B89: one revive() replaced
                        self.listener = nil
                        if !answered { answered = true; done(.failure(e)) }
                        else { self.revive("it failed: \(e.localizedDescription)") } // B89: an IPA may still wait
                    default: break
                    }
                }
                l.newConnectionHandler = { c in self.accept(c) }
                self.listener = l
                l.start(queue: self.queue)
            } catch { done(.failure(error)) }
        }
    }

    func stop() {
        queue.async {
            self.listener?.cancel()
            self.listener = nil
            self.routes.removeAll()
            self.covered.removeAll()
            self.stopBeat()
            self.endBackground()
        }
    }

    // Serves body at path until `ttl` passes with no request (or stop()).
    func serve(_ path: String, _ route: Route, ttl: TimeInterval = 15 * 60) {
        queue.async {
            self.routes[path] = route
            self.touch(ttl)
            self.startBeat()
        }
    }

    func remove(_ path: String) {
        queue.async {
            if let r = self.routes.removeValue(forKey: path) { self.gone[path] = r.log }
            self.covered.removeValue(forKey: path)
        }
    }

    // F196: the progress page's Cancel: `path` stops being served, a transfer of it under way is cut off, and the
    // listener (with its background task) ends when nothing else is served.
    func cancel(_ path: String) {
        queue.async {
            self.routes.removeValue(forKey: path)
            self.covered.removeValue(forKey: path)
            self.cut.insert(path)
            if self.routes.isEmpty {
                self.idle?.cancel()
                self.idle = nil
                self.listener?.cancel()
                self.listener = nil
                self.stopBeat()
                self.endBackground()
            }
        }
    }
    private var cut = Set<String>() // F196: paths cancelled; their transfers stop at the next chunk
    // B29: per path, the bytes sent in full so far (onServed once they cover the file), and the logs of paths no
    // longer served, so a late request says it got a 404.
    private var covered = [String: ByteCoverage]()
    private var fired = Set<String>()
    private var gone = [String: (String) -> Void]()

    var base: String { "http://127.0.0.1:\(port)" }

    // ---- B89: iOS freezing iFizBox while it serves
    //
    // On iOS 27 (user's iPhone19,2, 27.0.1) iOS suspended iFizBox mid-serve despite KeepAlive's audio ("COSMCtrl
    // evictBackgroundApps"), and Network.framework left the listener's socket suspended ("Resuming inbox socket" only
    // when it was cancelled 10 minutes later): iOS's installer never reached it and said "Unable to Install". A frozen
    // app runs no code, so the server can only see it afterwards: a 1 s heartbeat that finds a gap of `freezeGap` or
    // more. Then it re-creates the listener on the same port (the link names it) and tells each route not yet served
    // (onFrozen), whose install falls back to the Signing Server (Sideload.serveChecked). The app going to the
    // background, the phone locking and coming back go to the routes' notes, so a failing attempt's log says when.

    static let freezeGap: TimeInterval = 5
    private var beat: DispatchSourceTimer?
    private var lastBeat = Date()
    private var asked = [String: Date]() // per path, when iOS last asked for it
    private var observers = [NSObjectProtocol]()

    static func clock(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f.string(from: d)
    }

    // Whether iOS asked for `path` at or after `since` (any queue but the server's).
    func asked(_ path: String, since: Date) -> Bool {
        queue.sync { (asked[path].map { $0 >= since }) ?? false }
    }

    private func noteAll(_ line: String) {
        for r in routes.values { r.note?(line) }
    }

    private func startBeat() {
        guard beat == nil else { return }
        lastBeat = Date()
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(250))
        t.setEventHandler { [weak self] in self?.tick() }
        beat = t
        t.resume()
        guard observers.isEmpty else { return }
        let nc = NotificationCenter.default
        let watch = { [unowned self] (name: Notification.Name, line: String, check: Bool) in
            self.observers.append(nc.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in
                self?.queue.async {
                    guard let self = self, !self.routes.isEmpty else { return }
                    self.noteAll(line)
                    if check { self.checkListener() }
                }
            })
        }
        watch(UIApplication.didEnterBackgroundNotification, "\(Brand.name) went to the background; still serving", false)
        watch(UIApplication.willEnterForegroundNotification, "\(Brand.name) came back to the front", true)
        watch(UIApplication.protectedDataWillBecomeUnavailableNotification, "The phone locked", false)
        watch(UIApplication.protectedDataDidBecomeAvailableNotification, "The phone unlocked", true)
    }

    private func stopBeat() {
        beat?.cancel()
        beat = nil
    }

    private func tick() {
        let now = Date()
        let from = lastBeat
        lastBeat = now
        guard now.timeIntervalSince(from) >= InstallServer.freezeGap, !routes.isEmpty else { return }
        let f = Freeze(from: from, to: now)
        noteAll("iOS froze \(Brand.name) for \(f.text); its listening socket may have stayed shut")
        revive("after the freeze")
        for (path, r) in routes where !fired.contains(path) { r.onFrozen?(f) }
    }

    // Back in front, or unlocked: a listener that isn't ready is made again.
    private func checkListener() {
        let st = listener.map { "\($0.state)" } ?? "none"
        guard listener?.state != .ready else { return noteAll("The install server is listening on 127.0.0.1:\(port)") }
        revive("its state was \(st)")
    }

    // A new listener on the same port, in place of the old (cancelled first, which also frees a suspended socket).
    // The port may not be free at once after the cancel: up to `tries` goes, half a second apart.
    private func revive(_ why: String, tries: Int = 5) {
        guard !routes.isEmpty, port != 0, let p = NWEndpoint.Port(rawValue: port) else { return }
        let old = listener
        listener = nil
        old?.cancel()
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback
        params.acceptLocalOnly = true
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: NWEndpoint.Host("127.0.0.1"), port: p)
        let again = { (e: String) in
            self.noteAll("Couldn't listen again on 127.0.0.1:\(self.port) (\(e))" + (tries > 1 ? "; trying again" : ""))
            if tries > 1 { self.queue.asyncAfter(deadline: .now() + 0.5) { self.revive(why, tries: tries - 1) } }
        }
        do {
            let l = try NWListener(using: params)
            l.stateUpdateHandler = { [weak self, weak l] st in
                guard let self = self, let l = l, self.listener === l else { return }
                switch st {
                case .ready: self.noteAll("The install server listens again on 127.0.0.1:\(self.port) (\(why))")
                case .waiting(let e): self.noteAll("The install server is waiting to listen: \(e.localizedDescription)")
                case .failed(let e):
                    self.listener = nil
                    l.cancel()
                    again(e.localizedDescription)
                default: break
                }
            }
            l.newConnectionHandler = { [weak self] c in self?.accept(c) }
            listener = l
            l.start(queue: queue)
        } catch { again(error.localizedDescription) }
    }

    // ---- connections

    private func touch(_ ttl: TimeInterval = 15 * 60) {
        idle?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.stop() }
        idle = w
        queue.asyncAfter(deadline: .now() + ttl, execute: w)
        DispatchQueue.main.async {
            // iOS's install sheet can send iFizBox to the background mid-download; ask for the time to finish.
            if self.task == .invalid {
                self.task = UIApplication.shared.beginBackgroundTask(withName: "ifizbox.install") { self.endBackground() }
            }
        }
    }

    private func endBackground() {
        DispatchQueue.main.async {
            if self.task != .invalid { UIApplication.shared.endBackgroundTask(self.task); self.task = .invalid }
        }
    }

    private func accept(_ c: NWConnection) {
        c.start(queue: queue)
        read(c, Data())
    }

    private func read(_ c: NWConnection, _ buf: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, complete, err in
            guard let self = self else { return c.cancel() }
            var b = buf
            if let d = data { b.append(d) }
            do {
                if let req = try HTTPRequest.parse(b) { return self.answer(c, req) }
            } catch { return self.send(c, HTTPResponse.head(400, [("Content-Length", "0")]), close: true) }
            if complete || err != nil { return c.cancel() }
            self.read(c, b)
        }
    }

    private func answer(_ c: NWConnection, _ req: HTTPRequest) {
        touch()
        guard req.method == "GET" || req.method == "HEAD" else {
            return send(c, HTTPResponse.head(405, [("Content-Length", "0")]), close: true)
        }
        asked[req.path] = Date() // B89
        guard let route = routes[req.path] else {
            gone[req.path]?("iOS asked again for \(req.method) \(req.headers["range"] ?? "the whole file") after it stopped being served: 404")
            return send(c, HTTPResponse.head(404, [("Content-Length", "0")]), close: true)
        }
        let size: UInt64
        switch route.body {
        case .data(let d): size = UInt64(d.count)
        case .file(let u): size = (try? FileManager.default.attributesOfItem(atPath: u.path)[.size] as? NSNumber)??.uint64Value ?? 0
        }
        guard let range = req.range(size: size) else {
            return send(c, HTTPResponse.head(416, [("Content-Range", "bytes */\(size)"), ("Content-Length", "0")]), close: true)
        }
        let r = range ?? (size == 0 ? nil : 0...size - 1)
        var headers = [("Content-Type", route.type), ("Content-Length", "\(r.map { $0.upperBound - $0.lowerBound + 1 } ?? 0)"),
                       ("Accept-Ranges", "bytes")]
        if let rr = range { headers.append(("Content-Range", "bytes \(rr.lowerBound)-\(rr.upperBound)/\(size)")) }
        let head = HTTPResponse.head(range == nil ? 200 : 206, headers)
        let asked = req.headers["range"].map { "Range: \($0)" } ?? "the whole file"
        route.log?("iOS: \(req.method) \(asked) -> \(range == nil ? 200 : 206)"
                   + (r.map { ", bytes \($0.lowerBound)-\($0.upperBound) of \(size)" } ?? ", \(size) bytes"))
        if req.method == "HEAD" || r == nil {
            if size == 0 && req.method == "GET" { sent(req.path, nil, size: size, route) }
            return send(c, head, close: true)
        }
        let path = req.path
        // B29: onServed only once every byte went out (iOS's installer may ask for the end first, or resume).
        let finished = { self.sent(path, r!, size: size, route) }
        switch route.body {
        case .data(let d):
            send(c, head + d.subdata(in: Int(r!.lowerBound)..<Int(r!.upperBound) + 1), close: true, then: finished)
        case .file(let u):
            guard let fh = try? FileHandle(forReadingFrom: u) else { return send(c, HTTPResponse.head(404, [("Content-Length", "0")]), close: true) }
            fh.seek(toFileOffset: r!.lowerBound)
            let total = r!.upperBound - r!.lowerBound + 1
            let cutShort: (UInt64) -> Void = { left in route.log?("iOS: the connection ended after \(total - left) of \(total) bytes") }
            send(c, head, close: false) { self.stream(c, fh, left: total, path: path, cutShort: cutShort, then: finished) }
        }
    }

    // B29: a request's bytes all went out: counted for its path, logged, and onServed once the whole file has.
    private func sent(_ path: String, _ r: ClosedRange<UInt64>?, size: UInt64, _ route: Route) {
        var cov = covered[path] ?? ByteCoverage()
        if let r = r { cov.add(r) }
        covered[path] = cov
        let whole = cov.covers(size: size)
        route.log?("Sent \(r.map { "bytes \($0.lowerBound)-\($0.upperBound)" } ?? "nothing"); \(cov.count) of \(size) bytes sent to iOS"
                   + (whole ? " (all of it)" : ""))
        if whole && !fired.contains(path) {
            fired.insert(path)
            route.onServed?()
        }
    }

    private func stream(_ c: NWConnection, _ fh: FileHandle, left: UInt64, path: String = "", cutShort: ((UInt64) -> Void)? = nil,
                        then: (() -> Void)?) {
        if cut.contains(path) { fh.closeFile(); return c.cancel() } // F196: cancelled
        if left == 0 { fh.closeFile(); return send(c, Data(), close: true, then: then) }
        let d = fh.readData(ofLength: Int(min(left, 1 << 20)))
        if d.isEmpty { fh.closeFile(); cutShort?(left); return c.cancel() }
        c.send(content: d, completion: .contentProcessed { [weak self] err in
            if err != nil { fh.closeFile(); cutShort?(left); return c.cancel() }
            self?.touch()
            self?.stream(c, fh, left: left - UInt64(d.count), path: path, cutShort: cutShort, then: then)
        })
    }

    private func send(_ c: NWConnection, _ d: Data, close: Bool, then: (() -> Void)? = nil) {
        c.send(content: d, isComplete: close, completion: .contentProcessed { err in
            if close { c.cancel() }
            if err == nil { then?() }
        })
    }
}
