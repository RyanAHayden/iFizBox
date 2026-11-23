// F400: the one way an install gets its IPA from a URL: the one already on the phone from an install that failed
// (native/sign/OriginalIPA.swift WaitingIPA), else a download (Sideload.download), kept until it is installed.
// signing.install, signing.prepare, signing.inspect and Re-sign use run(); the jailbreak app's ipa.install has its own
// download and uses waiting(). A waiting IPA is asked about first with a HEAD (IPAHead): the server's ETag,
// Last-Modified or length saying it is another file, it is downloaded again; offline or no answer, it is used.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum IPAFetch {
    static let queue = DispatchQueue(label: "ifizbox.ipa.waiting", qos: .userInitiated) // hashing, off SignBridge.queue
    static let headTimeout: TimeInterval = 5

    static func usingLine(_ file: URL) -> String { "Using the IPA already downloaded (\(Sideload.size(file)))" }

    static func headers(_ r: URLResponse?) -> [String: String] {
        var out = [String: String]()
        for (k, v) in (r as? HTTPURLResponse)?.allHeaderFields ?? [:] {
            if let k = k as? String, let v = v as? String { out[k.lowercased()] = v }
        }
        return out
    }

    // The IPA of `url`; `done` on SignBridge.queue with a file of the caller's own (deleted by it), as Sideload.download.
    @discardableResult
    static func run(_ url: URL, listed: WaitingIPA.Listed, http: Sideload.HTTPPolicy, emit: @escaping (String, Double) -> Void,
                    log: ((String) -> Void)? = nil, bytes: ((Int64, Int64) -> Void)? = nil,
                    done: @escaping (Result<URL, Error>) -> Void) -> DebFetch {
        let chain = Sideload.HTTPChain()
        let held = Sideload.holdUntilAnswer()
        let to = SignBridge.work.appendingPathComponent("\(SignBridge.token())-waiting.ipa")
        waiting(url, listed: listed, plain: http != .ask, to: to, began: { chain.set($0) }, log: log) { found in
            if chain.cancelled {
                held()
                try? FileManager.default.removeItem(at: to)
                return SignBridge.queue.async { done(.failure(SignJob.cancelledError)) }
            }
            if let file = found {
                held()
                log?(usingLine(file))
                emit("reading", 0) // no downloading phase
                return SignBridge.queue.async { done(.success(file)) }
            }
            log?("Downloading \(url.absoluteString)")
            let started = Date()
            var answer = WaitingIPA.Answer()
            chain.set(Sideload.download(url, http: http, emit: emit, bytes: bytes, answer: { answer = $0 }) { res in
                held()
                guard case .success(let file) = res else { return done(res) }
                log?(Sideload.downloaded(file, since: started))
                queue.async {
                    WaitingIPA.keep(file, url: url.absoluteString, listed: listed, answer: answer, hash: IPAHash.of)
                    SignBridge.queue.async { done(res) }
                }
            })
        }
        return chain
    }

    // The IPA waiting for `url`, at `to` (nil: download it). `plain`: one that came over plain http may be used.
    // `began` gets the server's check before it runs (the caller's Cancel stops it: found(nil)).
    static func waiting(_ url: URL, listed: WaitingIPA.Listed, plain: Bool, to: URL, link: Bool = true, began: (DebFetch) -> Void,
                        log: ((String) -> Void)? = nil, found: @escaping (URL?) -> Void) {
        guard let w = WaitingIPA.find(url.absoluteString, listed: listed, plain: plain) else {
            return found(nil)
        }
        // the address it was downloaded from: an http link's https twin, unless it came over plain http
        let asked = w.plain ? url : Sideload.httpsTwin(url) ?? url
        let head = IPAHead()
        began(head)
        head.ask(asked, timeout: headTimeout) { status, headers in
            if w.changed(status: status, headers: headers) {
                log?("The server has another copy of the IPA now: downloading it again")
                WaitingIPA.remove(w.url)
                return found(nil)
            }
            if head.cancelled { return found(nil) }
            queue.async {
                let file = w.take(to: to, link: link, hash: IPAHash.of)
                if file == nil { log?("The IPA already downloaded is gone or damaged: downloading it again") }
                found(file)
            }
        }
    }

    // The install of `r` went through: nothing to keep for a retry.
    static func installed(_ r: SignedRecord) { forget(r.url) }

    // The signer failed with `e`: an IPA that is itself damaged isn't kept, so the next try downloads it again.
    static func damaged(_ e: Error, source: String, log: ((String) -> Void)? = nil) {
        guard WaitingIPA.damaged(e), Apt.httpURL(source) != nil else { return }
        forget(source)
        log?("The IPA is damaged: the next try downloads it again")
    }

    private static func forget(_ source: String) {
        guard let u = Apt.httpURL(source) else { return } // My IPAs' and iFizBox's own sources keep none
        WaitingIPA.remove(u.absoluteString)
    }

    // At launch, before any install (once: a second web view registers its bridge again).
    static func sweep() { _ = swept }
    private static let swept: Void = {
        queue.async {
            let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
            WaitingIPA.sweep(own: (Bundle.main.bundleIdentifier ?? SignOptions.selfBundleID, v))
        }
        // the jailbreak app has no container (its Caches are every app's) and stages nothing
        if AppMode.current != .jailbreak { SignBridge.queue.async { OriginalIPA.sweepPending() } }
    }()
}

// A HEAD for a waiting IPA: `done` once, with the final answer's status and lower-cased headers, or (0, [:]) when there
// is none in `timeout` or it was cancelled. http goes over PlainFetch (ATS keeps URLSession off it).
final class IPAHead: DebFetch {
    private let lock = NSLock()
    private var done: ((Int, [String: String]) -> Void)?
    private var task: URLSessionTask?
    private var stopped = false
    var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return stopped }

    func ask(_ url: URL, timeout: TimeInterval, done: @escaping (Int, [String: String]) -> Void) {
        lock.lock(); self.done = done; lock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { self.finish(0, [:]) }
        if url.scheme?.lowercased() == "http" {
            PlainFetch.get(url, head: true) { r in
                guard case .success(let (st, hs, _)) = r else { return self.finish(0, [:]) }
                if (300..<400).contains(st), let next = hs["location"].flatMap({ URL(string: $0, relativeTo: url)?.absoluteURL }) {
                    return self.https(next, timeout)
                }
                self.finish(st, hs)
            }
        } else { https(url, timeout) }
    }

    private func https(_ url: URL, _ timeout: TimeInterval) {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: timeout)
        req.httpMethod = "HEAD"
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForResource = timeout
        let session = URLSession(configuration: cfg)
        let t = session.dataTask(with: req) { _, resp, _ in
            session.finishTasksAndInvalidate()
            self.finish((resp as? HTTPURLResponse)?.statusCode ?? 0, IPAFetch.headers(resp))
        }
        lock.lock(); task = t; let over = done == nil; lock.unlock()
        if over { t.cancel() } else { t.resume() }
    }

    func cancel() {
        lock.lock(); stopped = true; lock.unlock()
        finish(0, [:])
    }

    private func finish(_ status: Int, _ headers: [String: String]) {
        lock.lock(); let d = done, t = task; done = nil; lock.unlock()
        guard let d = d else { return }
        t?.cancel()
        d(status, headers)
    }
}
