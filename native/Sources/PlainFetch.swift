// net.fetch and net.packages (Apt.get) for a plain http repo. App Transport Security keeps URLSession off http
// ("requires the use of a secure connection"), so BigBoss and the other http-only repos couldn't be added or
// refreshed in either build. ATS stays on app-wide (no NSAllowsArbitraryLoads): an http URL is fetched here as one
// HTTP/1.1 GET over Network.framework's plain TCP, which ATS doesn't govern, decoded by share/HTTPStream.swift.
//
// Same answer as Apt.get's URLSession path: (status, lower-cased headers, body), redirects followed (up to 5; one
// to https goes back to Apt.get), the body capped at Apt.maxBody, 30 s without a byte or 120 s in all a timeout.
// Errors are BridgeError: network, timeout, too_large, upstream (not an HTTP answer).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Network

final class PlainFetch {
    typealias Done = (Result<(Int, [String: String], Data), BridgeError>) -> Void
    static let idle: TimeInterval = 30
    static let total: TimeInterval = 120
    static let maxRedirects = 5

    private let url: URL, redirects: Int, head: Bool // head: F400, a HEAD: the status and headers, no body
    private var done: Done?
    private let queue = DispatchQueue(label: "ifizbox.fetch.http")
    private var conn: NWConnection?
    private let stream = HTTPStream()
    private var body = Data()
    private var lastByte = Date()
    private let started = Date()
    private var timer: DispatchSourceTimer?
    private var keep: PlainFetch? // itself until done: the connection's handlers hold it weakly

    private init(_ url: URL, _ redirects: Int, _ head: Bool, _ done: @escaping Done) {
        self.url = url; self.redirects = redirects; self.head = head; self.done = done
    }

    // With `head`, a redirect to https is answered as it is (its 3xx and Location) for the caller to follow.
    static func get(_ url: URL, redirects: Int = maxRedirects, head: Bool = false, done: @escaping Done) {
        let f = PlainFetch(url, redirects, head, done)
        f.keep = f
        f.queue.async { f.begin() }
    }

    private func begin() {
        guard let host = url.host, !host.isEmpty, let port = NWEndpoint.Port(rawValue: UInt16(clamping: url.port ?? 80)) else {
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
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 1, repeating: 1)
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            let now = Date()
            if now.timeIntervalSince(self.lastByte) > PlainFetch.idle || now.timeIntervalSince(self.started) > PlainFetch.total {
                self.finish(.failure(BridgeError("timeout", "no answer from \(host) in time")))
            }
        }
        timer = t
        t.resume()
        c.start(queue: queue)
    }

    // Once: the connection and timer stop, `done` (when still there) hears the outcome.
    private func finish(_ r: Result<(Int, [String: String], Data), BridgeError>) {
        timer?.cancel()
        timer = nil
        conn?.stateUpdateHandler = nil
        conn?.cancel()
        conn = nil
        let d = done
        done = nil
        keep = nil
        d?(r)
    }

    private func send() {
        guard let host = url.host else { return }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var path = comps?.percentEncodedPath ?? "/"
        if path.isEmpty { path = "/" }
        if let q = comps?.percentEncodedQuery { path += "?" + q }
        let hostHeader = url.port.map { "\(host):\($0)" } ?? host
        let ua = Apt.session.configuration.httpAdditionalHeaders?["User-Agent"] as? String ?? SourceIcon.userAgent
        let req = "\(head ? "HEAD" : "GET") \(path) HTTP/1.1\r\nHost: \(hostHeader)\r\nUser-Agent: \(ua)\r\n"
            + "Accept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n"
        conn?.send(content: Data(req.utf8), completion: .contentProcessed { [weak self] e in
            guard let self = self else { return }
            if let e = e { return self.finish(.failure(BridgeError("network", e.localizedDescription))) }
            self.receive()
        })
    }

    private func receive() {
        conn?.receive(minimumIncompleteLength: 1, maximumLength: 256 << 10) { [weak self] data, _, isComplete, error in
            guard let self = self, self.done != nil else { return }
            self.lastByte = Date()
            do {
                if let data = data, !data.isEmpty {
                    self.body.append(try self.stream.feed(data))
                    if self.body.count > Apt.maxBody {
                        return self.finish(.failure(BridgeError("too_large", "more than \(Apt.maxBody >> 20) MB")))
                    }
                }
                if self.stream.finished || (self.head && self.stream.headed) { return self.answered() }
                if let e = error { return self.finish(.failure(BridgeError("network", e.localizedDescription))) }
                if isComplete {
                    try self.stream.end()
                    return self.answered()
                }
                self.receive()
            } catch let e as HTTPStreamError {
                let parts = e.text.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                self.finish(.failure(BridgeError(parts.first ?? "network", parts.count > 1 ? parts[1] : e.text)))
            } catch {
                self.finish(.failure(BridgeError("network", error.localizedDescription)))
            }
        }
    }

    // The whole answer is in: a redirect is followed (as URLSession does), anything else handed back.
    private func answered() {
        let st = stream.status
        if (300..<400).contains(st), st != 304, let loc = stream.headers["location"] {
            guard redirects > 0 else { return finish(.failure(BridgeError("network", "too many redirects"))) }
            guard let n = URL(string: loc, relativeTo: url)?.absoluteURL, let to = Apt.httpURL(n.absoluteString) else {
                return finish(.failure(BridgeError("network", "a redirect to a non-http(s) URL")))
            }
            if head, to.scheme?.lowercased() == "https" { return finish(.success((st, stream.headers, Data()))) }
            guard let d = done else { return }
            done = nil
            finish(.success((0, [:], Data()))) // stops the connection and timer; nobody hears it (done taken)
            if to.scheme?.lowercased() == "https" { Apt.get(to, done: d) } else { PlainFetch.get(to, redirects: redirects - 1, head: head, done: d) }
            return
        }
        finish(.success((st, stream.headers, body)))
    }
}

// Apt.get's URLSession task delegate: a redirect to http is stopped (ATS would fail it) and kept in `to`, for Apt.get
// to fetch through PlainFetch; any other redirect goes on as URLSession does.
final class PlainRedirect: NSObject, URLSessionTaskDelegate {
    private(set) var to: URL?

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard request.url?.scheme?.lowercased() == "http" else { return completionHandler(request) }
        to = request.url
        completionHandler(nil)
    }
}
