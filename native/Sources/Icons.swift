// B58: net.icon {url} -> {type, body}: a source's icon (CydiaIcon.png, an AltStore iconURL) fetched by the shell, for
// web/app/source-icon.js to cache and show. Why the shell: the page is ifizbox://app, and App Transport Security
// keeps both the WKWebView and URLSession off plain http, so http repos (BigBoss: no working https) showed no icon.
// ATS stays on app-wide (no NSAllowsArbitraryLoads): only these bytes are fetched without it, over Network.framework's
// plain TCP (which ATS doesn't govern) for http, URLSession for https.
//
// Safety, as the bytes come from any repo over plain http: PNG or JPEG only, checked by magic bytes (no SVG, nothing
// else; the type is ours, never the server's Content-Type), at most 256 KB, 10 s per request, 3 redirects. The page
// shows them as a blob: URL in an <img> only.
//
// Errors are the bridge's "<code>: <message>": not_found (404/410), upstream (any other HTTP error), bad_type (not
// PNG/JPEG), too_large: the repo answered and has no usable icon. network, timeout: it didn't answer.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Network

enum SourceIcon {
    static let maxBytes = 256 << 10
    static let timeout: TimeInterval = 10
    static let maxRedirects = 3
    static var userAgent: String { "\(Brand.name)/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "")" }

    typealias Done = (Result<(String, Data), BridgeError>) -> Void
    // An HTTP answer: status, Location (for 3xx), body.
    typealias Answer = (Int, String?, Data)

    static func register(_ b: Bridge) {
        b.on("net.icon") { c in
            guard let url = Apt.httpURL(c.params["url"]) else { return Apt.reply(c, nil, "bad_url: not an http(s) URL") }
            fetch(url, redirects: maxRedirects) { res in
                switch res {
                case .failure(let e): Apt.reply(c, nil, e.text)
                case .success(let (type, data)): Apt.reply(c, ["type": type, "body": data.base64EncodedString()], nil)
                }
            }
        }
    }

    // The picture type by its first bytes, or nil: PNG's 8-byte signature, JPEG's SOI marker.
    static func imageType(_ d: Data) -> String? {
        let b = [UInt8](d.prefix(8))
        if b == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] { return "image/png" }
        if b.count >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF { return "image/jpeg" }
        return nil
    }

    static func fetch(_ url: URL, redirects: Int, done: @escaping Done) {
        let answered: (Result<Answer, BridgeError>) -> Void = { res in
            switch res {
            case .failure(let e): done(.failure(e))
            case .success(let (status, location, body)):
                if (300..<400).contains(status), let loc = location {
                    guard redirects > 0 else { return done(.failure(BridgeError("upstream", "too many redirects"))) }
                    guard let next = URL(string: loc, relativeTo: url)?.absoluteURL, let n = Apt.httpURL(next.absoluteString) else {
                        return done(.failure(BridgeError("upstream", "a redirect to a non-http(s) URL")))
                    }
                    return fetch(n, redirects: redirects - 1, done: done)
                }
                if status == 404 || status == 410 { return done(.failure(BridgeError("not_found", "HTTP \(status)"))) }
                if status < 200 || status >= 300 { return done(.failure(BridgeError("upstream", "the repo answered HTTP \(status)"))) }
                if body.count > maxBytes { return done(.failure(BridgeError("too_large", "more than 256 KB"))) }
                guard let type = imageType(body) else { return done(.failure(BridgeError("bad_type", "not a PNG or JPEG"))) }
                done(.success((type, body)))
            }
        }
        if url.scheme?.lowercased() == "https" { HTTPSGet(url, done: answered).start() } else { PlainGet(url, done: answered).start() }
    }
}

// https through URLSession (ATS is happy), redirects handed back to SourceIcon.fetch (an https -> http one would
// otherwise fail under ATS), stopped past the size cap.
final class HTTPSGet: NSObject, URLSessionDataDelegate {
    let url: URL
    var done: ((Result<SourceIcon.Answer, BridgeError>) -> Void)?
    var body = Data()
    var status = 0
    var location: String?
    var session: URLSession?

    init(_ url: URL, done: @escaping (Result<SourceIcon.Answer, BridgeError>) -> Void) { self.url = url; self.done = done }

    func start() {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = SourceIcon.timeout
        cfg.timeoutIntervalForResource = SourceIcon.timeout
        cfg.httpAdditionalHeaders = ["User-Agent": SourceIcon.userAgent, "Accept": "image/png, image/jpeg"]
        let s = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
        session = s
        s.dataTask(with: url).resume()
    }

    private func finish(_ r: Result<SourceIcon.Answer, BridgeError>) {
        guard let d = done else { return }
        done = nil
        session?.invalidateAndCancel() // also releases the session's hold on this delegate
        session = nil
        d(r)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.success((response.statusCode, request.url?.absoluteString ?? response.value(forHTTPHeaderField: "Location"), Data())))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let http = response as? HTTPURLResponse
        status = http?.statusCode ?? 0
        location = http?.value(forHTTPHeaderField: "Location")
        if response.expectedContentLength > Int64(SourceIcon.maxBytes) {
            completionHandler(.cancel)
            return finish(.failure(BridgeError("too_large", "more than 256 KB")))
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        body.append(data)
        if body.count > SourceIcon.maxBytes { finish(.failure(BridgeError("too_large", "more than 256 KB"))) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let e = error as? URLError {
            return finish(.failure(BridgeError(e.code == .timedOut ? "timeout" : "network", e.localizedDescription)))
        }
        if let e = error { return finish(.failure(BridgeError("network", e.localizedDescription))) }
        finish(.success((status, location, body)))
    }
}

// Plain http as one HTTP/1.1 GET over a TCP connection (Network.framework: not under ATS). Connection: close, so the
// body ends where the server closes; a Content-Length or chunked body may end it sooner. No Accept-Encoding: the
// body comes as is.
final class PlainGet {
    let url: URL
    let queue = DispatchQueue(label: "ifizbox.icon.http")
    var conn: NWConnection?
    var done: ((Result<SourceIcon.Answer, BridgeError>) -> Void)?
    var buf = Data()
    let cap = SourceIcon.maxBytes + (32 << 10) // the icon and its headers

    init(_ url: URL, done: @escaping (Result<SourceIcon.Answer, BridgeError>) -> Void) { self.url = url; self.done = done }

    func start() {
        guard let host = url.host, let port = NWEndpoint.Port(rawValue: UInt16(clamping: url.port ?? 80)) else {
            return finish(.failure(BridgeError("bad_url", "no host")))
        }
        let c = NWConnection(host: NWEndpoint.Host(host), port: port, using: .tcp)
        conn = c
        c.stateUpdateHandler = { [weak self] st in
            guard let self = self else { return }
            switch st {
            case .ready: self.send()
            case .failed(let e), .waiting(let e): self.finish(.failure(BridgeError("network", e.localizedDescription)))
            default: break
            }
        }
        c.start(queue: queue)
        queue.asyncAfter(deadline: .now() + SourceIcon.timeout) { [self] in
            finish(.failure(BridgeError("timeout", "no answer in \(Int(SourceIcon.timeout)) s")))
        }
    }

    private func finish(_ r: Result<SourceIcon.Answer, BridgeError>) {
        guard let d = done else { return }
        done = nil
        conn?.stateUpdateHandler = nil
        conn?.cancel()
        conn = nil
        d(r)
    }

    private func send() {
        guard let host = url.host else { return }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var path = comps?.percentEncodedPath ?? "/"
        if path.isEmpty { path = "/" }
        if let q = comps?.percentEncodedQuery { path += "?" + q }
        let hostHeader = url.port.map { "\(host):\($0)" } ?? host
        let req = "GET \(path) HTTP/1.1\r\nHost: \(hostHeader)\r\nUser-Agent: \(SourceIcon.userAgent)\r\n"
            + "Accept: image/png, image/jpeg\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n"
        conn?.send(content: Data(req.utf8), completion: .contentProcessed { [weak self] e in
            guard let self = self else { return }
            if let e = e { return self.finish(.failure(BridgeError("network", e.localizedDescription))) }
            self.receive()
        })
    }

    private func receive() {
        conn?.receive(minimumIncompleteLength: 1, maximumLength: 64 << 10) { [weak self] data, _, isComplete, error in
            guard let self = self, self.done != nil else { return }
            if let data = data { self.buf.append(data) }
            if self.buf.count > self.cap { return self.finish(.failure(BridgeError("too_large", "more than 256 KB"))) }
            if let r = PlainGet.parse(self.buf, ended: isComplete || error != nil) { return self.finish(r) }
            if let e = error { return self.finish(.failure(BridgeError("network", e.localizedDescription))) }
            if isComplete { return self.finish(.failure(BridgeError("network", "the connection closed early"))) }
            self.receive()
        }
    }

    // The answer in buf once it is whole (or the connection ended), else nil to read on.
    static func parse(_ buf: Data, ended: Bool) -> Result<SourceIcon.Answer, BridgeError>? {
        let b = [UInt8](buf)
        guard let headEnd = find(b, [13, 10, 13, 10], from: 0) else {
            return ended ? .failure(BridgeError("upstream", "not an HTTP answer")) : nil
        }
        let head = String(decoding: b[0..<headEnd], as: UTF8.self).components(separatedBy: "\r\n")
        let parts = head.first?.split(separator: " ") ?? []
        guard parts.count >= 2, parts[0].hasPrefix("HTTP/"), let status = Int(parts[1]) else {
            return .failure(BridgeError("upstream", "not an HTTP answer"))
        }
        var headers: [String: String] = [:]
        for line in head.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        if (300..<400).contains(status), let loc = headers["location"] { return .success((status, loc, Data())) }
        if status == 100 { return ended ? .failure(BridgeError("upstream", "no final answer")) : nil }
        let body = Array(b[(headEnd + 4)...])
        if headers["transfer-encoding"]?.lowercased().contains("chunked") == true {
            if let d = dechunk(body) { return .success((status, nil, Data(d))) }
            return ended ? .failure(BridgeError("upstream", "a broken chunked body")) : nil
        }
        if let cl = headers["content-length"].flatMap({ Int($0) }) {
            if body.count >= cl { return .success((status, nil, Data(body.prefix(cl)))) }
            return ended ? .failure(BridgeError("network", "the connection closed early")) : nil
        }
        return ended ? .success((status, nil, Data(body))) : nil
    }

    // A chunked body decoded, or nil while its last (zero) chunk hasn't come.
    static func dechunk(_ b: [UInt8]) -> [UInt8]? {
        var out: [UInt8] = []
        var i = 0
        while true {
            guard let eol = find(b, [13, 10], from: i) else { return nil }
            let line = String(decoding: b[i..<eol], as: UTF8.self)
            let hex = line.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
            guard let n = Int(hex, radix: 16), n >= 0 else { return nil }
            if n == 0 { return out }
            let start = eol + 2
            guard b.count >= start + n + 2 else { return nil }
            out.append(contentsOf: b[start..<(start + n)])
            if out.count > SourceIcon.maxBytes { return out } // SourceIcon.fetch says too_large
            i = start + n + 2
        }
    }

    static func find(_ b: [UInt8], _ needle: [UInt8], from: Int) -> Int? {
        guard b.count >= needle.count, from <= b.count - needle.count else { return nil }
        var i = from
        while i <= b.count - needle.count {
            if b[i] == needle[0] && Array(b[i..<(i + needle.count)]) == needle { return i }
            i += 1
        }
        return nil
    }
}

// F238: a .deb from a plain http repo (BigBoss and friends) streamed to a file over Network.framework, for
// share.debFetch (native/share/App/ShareBridge.swift): URLSession's Download can't, as ATS keeps it off http. Same
// shape as Download (SignBridge.swift): progress 0...1 when the server sends a Content-Length, the size cap, cancel()
// ending in "cancelled: Cancelled", `done` called once with nil or "<code>: <message>". The answer is decoded by
// native/share/HTTPStream.swift (Content-Length, chunked or close-delimited). Up to 5 redirects: to http it carries
// on here, to https it hands over to Download. 60 s without a byte is a timeout, as Download's request timeout.
final class PlainDownload: DebFetch {
    static let idle: TimeInterval = 60
    static let maxRedirects = 5

    private let url: URL, dest: URL, max: Int64, redirects: Int
    private let progress: (Double) -> Void
    private var bytes: ((Int64, Int64) -> Void)? // B262: as Download's (written, expected; 0 when unknown)
    private var answer: (([String: String]) -> Void)? // F400: as Download's
    private var done: ((String?) -> Void)?
    private let queue = DispatchQueue(label: "ifizbox.deb.http")
    private var conn: NWConnection?
    private var stream = HTTPStream()
    private var file: FileHandle?
    private var next: DebFetch? // the redirect's download, which cancel() stops too
    private var lastByte = Date()
    private var timer: DispatchSourceTimer?
    private var keep: PlainDownload? // itself until done: the connection's handlers hold it weakly

    private init(_ url: URL, _ dest: URL, _ max: Int64, _ redirects: Int, _ progress: @escaping (Double) -> Void,
                 _ done: @escaping (String?) -> Void) {
        self.url = url; self.dest = dest; self.max = max; self.redirects = redirects; self.progress = progress; self.done = done
    }

    @discardableResult
    static func start(_ url: URL, to dest: URL, max: Int64, redirects: Int = maxRedirects,
                      progress: @escaping (Double) -> Void, bytes: ((Int64, Int64) -> Void)? = nil,
                      answer: (([String: String]) -> Void)? = nil,
                      done: @escaping (String?) -> Void) -> PlainDownload {
        let d = PlainDownload(url, dest, max, redirects, progress, done)
        d.bytes = bytes
        d.answer = answer
        d.keep = d
        d.queue.async { d.begin() }
        return d
    }

    func cancel() {
        queue.async { [self] in
            next?.cancel()
            finish("cancelled: Cancelled")
        }
    }

    private func begin() {
        guard done != nil else { return } // cancelled before it began
        guard let host = url.host, !host.isEmpty, let port = NWEndpoint.Port(rawValue: UInt16(clamping: url.port ?? 80)) else {
            return finish("bad_url: no host")
        }
        let c = NWConnection(host: NWEndpoint.Host(host), port: port, using: .tcp)
        conn = c
        c.stateUpdateHandler = { [weak self] st in
            guard let self = self else { return }
            switch st {
            case .ready: self.send()
            case .failed(let e), .waiting(let e): self.finish("network: \(e.localizedDescription)")
            default: break
            }
        }
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 5, repeating: 5)
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            if Date().timeIntervalSince(self.lastByte) > PlainDownload.idle {
                self.finish("timeout: no answer from \(host) in \(Int(PlainDownload.idle)) s")
            }
        }
        timer = t
        t.resume()
        lastByte = Date()
        c.start(queue: queue)
    }

    // Once: the connection and timer stop, the file closes, `done` hears the outcome.
    private func finish(_ err: String?) {
        timer?.cancel()
        timer = nil
        conn?.stateUpdateHandler = nil
        conn?.cancel()
        conn = nil
        try? file?.close()
        file = nil
        next = nil
        guard let d = done else { return }
        done = nil
        d(err)
        keep = nil
    }

    private func send() {
        guard let host = url.host else { return }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var path = comps?.percentEncodedPath ?? "/"
        if path.isEmpty { path = "/" }
        if let q = comps?.percentEncodedQuery { path += "?" + q }
        let hostHeader = url.port.map { "\(host):\($0)" } ?? host
        let req = "GET \(path) HTTP/1.1\r\nHost: \(hostHeader)\r\nUser-Agent: \(SourceIcon.userAgent)\r\n"
            + "Accept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n"
        conn?.send(content: Data(req.utf8), completion: .contentProcessed { [weak self] e in
            guard let self = self else { return }
            if let e = e { return self.finish("network: \(e.localizedDescription)") }
            self.receive()
        })
    }

    private func receive() {
        conn?.receive(minimumIncompleteLength: 1, maximumLength: 256 << 10) { [weak self] data, _, isComplete, error in
            guard let self = self, self.done != nil, self.next == nil else { return }
            self.lastByte = Date()
            do {
                if let data = data, !data.isEmpty {
                    let wasHeaded = self.stream.headed
                    let body = try self.stream.feed(data)
                    if !wasHeaded && self.stream.headed, try self.answered() { return }
                    if !body.isEmpty { try self.write(body) }
                }
                if self.stream.finished { return self.finish(nil) }
                if let e = error { return self.finish("network: \(e.localizedDescription)") }
                if isComplete {
                    try self.stream.end()
                    return self.finish(nil)
                }
                self.receive()
            } catch let e as HTTPStreamError {
                self.finish(e.text)
            } catch {
                self.finish("network: \(error.localizedDescription)")
            }
        }
    }

    // The head is in: true when this download is over (a redirect handed on, an error said), else the file is open.
    private func answered() throws -> Bool {
        let st = stream.status
        if (300..<400).contains(st), let loc = stream.headers["location"] {
            guard redirects > 0 else { finish("network: too many redirects"); return true }
            guard let n = URL(string: loc, relativeTo: url)?.absoluteURL, let to = Apt.httpURL(n.absoluteString) else {
                finish("network: a redirect to a non-http(s) URL"); return true
            }
            conn?.stateUpdateHandler = nil
            conn?.cancel()
            conn = nil
            timer?.cancel()
            timer = nil
            let pass: (String?) -> Void = { [self] err in queue.async { self.finish(err) } }
            if to.scheme?.lowercased() == "https" {
                next = Download.start(to, to: dest, max: max, progress: progress, bytes: bytes, answer: answer, done: pass)
            } else {
                next = PlainDownload.start(to, to: dest, max: max, redirects: redirects - 1, progress: progress, bytes: bytes, answer: answer, done: pass)
            }
            return true
        }
        if st >= 400 || !(200..<300).contains(st) { finish("network: the server answered \(st)"); return true }
        if let n = stream.length, n > max { finish("too_large: the package is bigger than \(max >> 20) MB"); return true }
        try? FileManager.default.removeItem(at: dest)
        guard FileManager.default.createFile(atPath: dest.path, contents: nil) else {
            throw HTTPStreamError("internal", "couldn't create \(dest.lastPathComponent)")
        }
        file = try FileHandle(forWritingTo: dest)
        answer?(stream.headers)
        return false
    }

    private func write(_ body: Data) throws {
        if stream.received > max { throw HTTPStreamError("too_large", "the package is bigger than \(max >> 20) MB") }
        guard let f = file else { return }
        try f.write(contentsOf: body)
        if let n = stream.length, n > 0 { progress(Double(stream.received) / Double(n)) }
        bytes?(Int64(stream.received), Int64(stream.length ?? 0))
    }
}

// F238: a running .deb download share.debCancel can stop: Download (https) or PlainDownload (http).
protocol DebFetch: AnyObject { func cancel() }
extension Download: DebFetch {}
