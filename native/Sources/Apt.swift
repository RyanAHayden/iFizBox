// The bridge calls behind web/app/backend-native.js (N3): apt's sources and lists, dpkg's status, network fetches
// (the page's origin is ifizbox://app, so repos without CORS headers are fetched here), ifizbox-helper and the haptic
// tick. Every reply is plain JSON types; errors are "<code>: <message>" strings that native/bridge.js turns into
// errors with a `code` (the proxy's codes: bad_url, network, timeout, too_large, not_found, helper).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import UIKit
import WebKit

enum Jailbreak {
    // Where the jailbreak's files are (docs/native.md, "The /var/jb prefix"): roothide's jbroot("/") when
    // libroothide is loaded, else /var/jb (Dopamine, palera1n rootless), else "" (rootful: paths from /).
    static let prefix: String = {
        typealias JBRoot = @convention(c) (UnsafePointer<CChar>) -> UnsafePointer<CChar>?
        if let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "jbroot") { // RTLD_DEFAULT
            let f = unsafeBitCast(sym, to: JBRoot.self)
            if let p = f("/") { return String(cString: p).replacingOccurrences(of: "/+$", with: "", options: .regularExpression) }
        }
        return FileManager.default.fileExists(atPath: "/var/jb") ? "/var/jb" : ""
    }()

    static func path(_ p: String) -> String { prefix + p }
    // F40: what native/bridge.js tells the page as ifizboxNative.jailbreak. A prefix (/var/jb, or roothide's
    // jbroot) is rootless; none is rootful.
    static var kind: String { prefix.isEmpty ? "rootful" : "rootless" }
    static var helper: String { path("/usr/libexec/ifizbox/ifizbox-helper") }
}

enum Apt {
    static let maxBody = 64 << 20 // the proxy's cap is smaller; BigBoss' plain Packages is ~20 MB

    // native/bridge.js, before any page script runs: it defines ifizboxNative, which modules read as they load.
    // Its @JAILBREAK@ becomes the detected jailbreak type (F40), @MODE@ the build's mode (I2, Mode.swift).
    static func installScript(_ ucc: WKUserContentController) {
        guard let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
              let raw = try? String(contentsOf: url, encoding: .utf8) else { return }
        let src = raw.replacingOccurrences(of: "@JAILBREAK@", with: Jailbreak.kind)
            .replacingOccurrences(of: "@MODE@", with: AppMode.current.rawValue)
        ucc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    }

    static func register(_ b: Bridge) {
        b.on("apt.sources") { c in work(c) { () throws -> Any? in sourceFiles() } }
        b.on("apt.list") { c in
            work(c) { () throws -> Any? in
                guard let name = c.params["name"] as? String, !name.isEmpty, !name.contains("/"), !name.hasPrefix(".")
                else { throw BridgeError("bad_url", "bad list name") }
                return readText(Jailbreak.path("/var/lib/apt/lists/" + name))
            }
        }
        b.on("apt.dpkgStatus") { c in work(c) { () throws -> Any? in readText(Jailbreak.path("/var/lib/dpkg/status")) } }
        // F350: apt.files { id } -> [path] | null, an installed package's Filesystem Content (its Details page).
        b.on("apt.files") { c in
            work(c) { () throws -> Any? in
                guard let id = c.params["id"] as? String, !id.isEmpty, !id.contains("/"), !id.hasPrefix(".")
                else { throw BridgeError("bad_url", "bad package id") }
                return packageFiles(id)
            }
        }
        // F104: when each package was installed or last upgraded, as Installed's Recent sort needs it.
        b.on("apt.installDates") { c in work(c) { () throws -> Any? in installDates() } }
        // F130: the packages apt marked as installed only to satisfy another's dependency, for Installed's User mode.
        b.on("apt.autoInstalled") { c in work(c) { () throws -> Any? in autoInstalled() } }
        // F228: malware.scan {files, packages} (web/app/core/known-malware.js scanRequest): which of those package IDs
        // dpkg has installed, and which of those file names sit in the Substrate or TweakInject folders, with the
        // package that owns each file. Reads only; nothing leaves the phone. The sideload build has no dpkg: empty.
        b.on("malware.scan") { c in
            work(c) { () throws -> Any? in
                let files = (c.params["files"] as? [String] ?? []).filter { !$0.isEmpty && !$0.contains("/") && !$0.hasPrefix(".") }
                let ids = Set(c.params["packages"] as? [String] ?? [])
                guard AppMode.current == .jailbreak else { return ["packages": [], "files": []] }
                return malwareScan(files: files, ids: ids)
            }
        }
        b.on("net.fetch") { c in
            guard let url = httpURL(c.params["url"]) else { return reply(c, nil, "bad_url: not an http(s) URL") }
            get(url) { res in
                switch res {
                case .failure(let e): reply(c, nil, e.text)
                case .success(let (status, headers, data)):
                    reply(c, ["status": status, "headers": headers, "body": data.base64EncodedString()], nil)
                }
            }
        }
        b.on("net.packages") { c in
            guard let dir = c.params["dir"] as? String, dir.hasSuffix("/"), httpURL(dir) != nil else {
                return reply(c, nil, "bad_url: not an http(s) directory URL")
            }
            // The site's proxy's order (backend-http.js): BigBoss serves Packages.bz2 alone.
            packages(dir, ["Packages.xz", "Packages.bz2", "Packages.gz", "Packages"]) { reply(c, $0, $1) }
        }
        b.on("helper.run") { c in
            guard let words = c.params["words"] as? [String], !words.isEmpty else {
                return reply(c, nil, "helper: no words")
            }
            let stream = (c.params["stream"] as? Bool) ?? false
            DispatchQueue.global(qos: .userInitiated).async {
                do { reply(c, try Helper.run(words, emit: stream ? { c.emitOnMain($0) } : nil), nil) }
                catch let e as BridgeError { reply(c, nil, e.text) }
                catch { reply(c, nil, "helper: \(error.localizedDescription)") }
            }
        }
        // F63: helper.answer {answer: "keep" | "new"} answers the running apply-ask's Configuration Upgrade question.
        b.on("helper.answer") { c in
            work(c) { () throws -> Any? in try Helper.answer(c.params["answer"] as? String ?? ""); return true }
        }
        // F64: helper.cancel stops the running apply-ask while apt still downloads (Cydia's Cancel on the progress
        // page); an error once dpkg has started (apt's first pmstatus: line), or when nothing runs.
        b.on("helper.cancel") { c in
            work(c) { () throws -> Any? in try Helper.cancel(); return true }
        }
        // F59: ipa.install {url} (stream: helper lines as helper.run's, after a "dlstatus:ipa:0:Downloading" one).
        b.on("ipa.install") { c in
            guard AppMode.current == .jailbreak else {
                return reply(c, nil, "sideload: the sideload build installs IPAs through signing.install")
            }
            guard let url = httpURL(c.params["url"]) else { return reply(c, nil, "bad_url: not an http(s) URL") }
            let stream = (c.params["stream"] as? Bool) ?? false
            // B113: insecure: true is the page's Install Anyway (web/app/ipa-install.js): plain http, no https twin
            let insecure = c.params["insecure"] as? Bool == true
            IPAInstall.run(url, insecure: insecure, keep: MyIPAs.wantsKeep(c), // F380
                           emit: stream ? { c.emitOnMain($0) } : nil) { reply(c, $0, $1) }
        }
        // F196: ipa.cancel, the IPA install page's Cancel (web/app/screens/ipa-install.js): stops ipa.install's download,
        // or keeps ifizbox-helper from starting; an error once the helper runs (it can't be stopped halfway) or when
        // no IPA install runs. ipa.install then answers "cancelled: Cancelled".
        b.on("ipa.cancel") { c in
            work(c) { () throws -> Any? in try IPAInstall.cancel(); return true }
        }
        b.on("haptic.tap") { c in
            DispatchQueue.main.async {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                c.reply(nil, nil)
            }
        }
        // B197: the smallest tick (pull to refresh arming, web/app/nav/haptic.js hapticTick)
        b.on("haptic.tick") { c in
            DispatchQueue.main.async {
                UISelectionFeedbackGenerator().selectionChanged()
                c.reply(nil, nil)
            }
        }
    }

    // ---- files

    // F350: the paths dpkg's info/<id>.list (info/<id>:<arch>.list on multiarch) names, as dpkg -L prints them, minus
    // "/." ; nil when dpkg has no list for it (not installed, or the sideload build).
    static func packageFiles(_ id: String) -> [String]? {
        let dir = Jailbreak.path("/var/lib/dpkg/info")
        var text = readText(dir + "/" + id + ".list")
        if text == nil, let names = try? FileManager.default.contentsOfDirectory(atPath: dir) {
            if let name = names.first(where: { $0.hasPrefix(id + ":") && $0.hasSuffix(".list") }) { text = readText(dir + "/" + name) }
        }
        guard let text else { return nil }
        return text.split(separator: "\n").map(String.init).filter { !$0.isEmpty && $0 != "/." }
    }

    // F104: { package: seconds since 1970 } from the mtime of dpkg's info/<pkg>.list (info/<pkg>:<arch>.list on
    // multiarch), which dpkg rewrites on every install or upgrade of the package.
    static func installDates() -> [String: Double] {
        let dir = Jailbreak.path("/var/lib/dpkg/info")
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir) else { return [:] }
        var out: [String: Double] = [:]
        for name in names where name.hasSuffix(".list") {
            var pkg = String(name.dropLast(5))
            if let colon = pkg.firstIndex(of: ":") { pkg = String(pkg[..<colon]) }
            guard !pkg.isEmpty,
                  let date = (try? fm.attributesOfItem(atPath: dir + "/" + name))?[.modificationDate] as? Date else { continue }
            out[pkg] = max(out[pkg] ?? 0, date.timeIntervalSince1970.rounded())
        }
        return out
    }

    // F130: the names /var/lib/apt/extended_states marks `Auto-Installed: 1` (apt-mark auto), sorted; nil when the
    // file can't be read (apt never marked anything), so the page keeps its dependency guess.
    static func autoInstalled() -> [String]? {
        guard let text = readText(Jailbreak.path("/var/lib/apt/extended_states")) else { return nil }
        var out = Set<String>()
        for stanza in text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n") {
            var pkg = "", auto = false
            for line in stanza.split(separator: "\n") {
                guard let colon = line.firstIndex(of: ":") else { continue }
                let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
                let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                if key == "package" { pkg = value } else if key == "auto-installed" { auto = value == "1" }
            }
            if auto && !pkg.isEmpty { out.insert(pkg) }
        }
        return out.sorted()
    }

    // F228: the folders tweaks are loaded from, rootless first (TweakInject is ElleKit's/libhooker's name for it).
    static let tweakDirs = ["/Library/MobileSubstrate/DynamicLibraries", "/usr/lib/TweakInject"]

    static func malwareScan(files: [String], ids: Set<String>) -> [String: Any] {
        var pkgs: [[String: Any]] = []
        if !ids.isEmpty, let text = readText(Jailbreak.path("/var/lib/dpkg/status")) {
            for stanza in text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n") {
                var pkg = "", version = "", installed = false
                for line in stanza.split(separator: "\n") {
                    guard let colon = line.firstIndex(of: ":"), !line.hasPrefix(" ") else { continue }
                    let key = line[..<colon].lowercased()
                    let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                    if key == "package" { pkg = value }
                    else if key == "version" { version = value }
                    else if key == "status" { installed = value.hasSuffix(" installed") }
                }
                if installed && ids.contains(pkg) { pkgs.append(["id": pkg, "version": version]) }
            }
        }
        let fm = FileManager.default
        var found: [String] = []
        for dir in Set(tweakDirs.map(Jailbreak.path) + tweakDirs).sorted() {
            for name in files {
                let p = dir + "/" + name
                if (try? fm.attributesOfItem(atPath: p)) != nil { found.append(p) } // a dangling link counts too
            }
        }
        let owners = dpkgOwners(Set(found))
        let out: [[String: Any]] = found.map { p in
            var f: [String: Any] = ["path": p, "name": (p as NSString).lastPathComponent, "owner": NSNull()]
            if let o = owners[p] { f["owner"] = o }
            return f
        }
        return ["packages": pkgs, "files": out]
    }

    // `dpkg -S` for a few paths without running it: the package whose info/<pkg>.list names each path (dpkg writes
    // the path as installed, /var/jb/... on rootless; the prefix-less form is tried too).
    static func dpkgOwners(_ paths: Set<String>) -> [String: String] {
        guard !paths.isEmpty else { return [:] }
        let dir = Jailbreak.path("/var/lib/dpkg/info")
        let pre = Jailbreak.prefix
        var want: [String: String] = [:]
        for p in paths {
            want[p] = p
            if !pre.isEmpty && p.hasPrefix(pre + "/") { want[String(p.dropFirst(pre.count))] = p }
        }
        var out: [String: String] = [:]
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? []
        for name in names where name.hasSuffix(".list") {
            guard let text = readText(dir + "/" + name) else { continue }
            var pkg = String(name.dropLast(5))
            if let colon = pkg.firstIndex(of: ":") { pkg = String(pkg[..<colon]) }
            for line in text.split(separator: "\n") {
                if let p = want[String(line)], out[p] == nil { out[p] = pkg }
            }
            if out.count == paths.count { break }
        }
        return out
    }

    static func readText(_ path: String) -> String? {
        guard let d = FileManager.default.contents(atPath: path) else { return nil }
        return String(decoding: d, as: UTF8.self)
    }

    static func sourceFiles() -> [[String: String]] {
        let etc = Jailbreak.path("/etc/apt")
        var out: [[String: String]] = []
        if let t = readText(etc + "/sources.list") { out.append(["path": etc + "/sources.list", "text": t]) }
        let d = etc + "/sources.list.d"
        let names = ((try? FileManager.default.contentsOfDirectory(atPath: d)) ?? []).sorted()
        for n in names where n.hasSuffix(".list") || n.hasSuffix(".sources") {
            if let t = readText(d + "/" + n) { out.append(["path": d + "/" + n, "text": t]) }
        }
        return out
    }

    // ---- network

    static func httpURL(_ v: Any?) -> URL? {
        // B149: a raw space (and the like) is percent-encoded first: URL(string:) refuses it before iOS 17.
        guard let raw = v as? String, case let s = URLText.encoded(raw), let u = URL(string: s), let scheme = u.scheme?.lowercased(),
              scheme == "http" || scheme == "https", u.host != nil else { return nil }
        return u
    }

    static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 30
        cfg.timeoutIntervalForResource = 120
        cfg.httpAdditionalHeaders = ["User-Agent": "\(Brand.name)/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "")"]
        return URLSession(configuration: cfg)
    }()

    static func get(_ url: URL, done: @escaping (Result<(Int, [String: String], Data), BridgeError>) -> Void) {
        // B261: plain http (BigBoss) outside ATS, which refuses it in URLSession (Sources/PlainFetch.swift).
        if url.scheme?.lowercased() == "http" { return PlainFetch.get(url, done: done) }
        let toHTTP = PlainRedirect() // an https URL redirecting to http carries on in PlainFetch, which ATS would refuse
        let task = session.dataTask(with: url) { data, resp, err in
            if let to = toHTTP.to { return PlainFetch.get(to, redirects: PlainFetch.maxRedirects - 1, done: done) }
            if let e = err as? URLError {
                return done(.failure(BridgeError(e.code == .timedOut ? "timeout" : "network", e.localizedDescription)))
            }
            if let e = err { return done(.failure(BridgeError("network", e.localizedDescription))) }
            guard let http = resp as? HTTPURLResponse else { return done(.failure(BridgeError("network", "no HTTP answer"))) }
            let body = data ?? Data()
            if body.count > maxBody { return done(.failure(BridgeError("too_large", "more than \(maxBody >> 20) MB"))) }
            var headers: [String: String] = [:]
            for (k, v) in http.allHeaderFields { headers["\(k)".lowercased()] = "\(v)" }
            done(.success((http.statusCode, headers, body)))
        }
        task.delegate = toHTTP
        task.resume()
    }

    // The first of names in dir that the repo serves, decompressed. Missing ones (HTTP >= 400, or a body that
    // doesn't decompress) move on to the next; a network failure ends it.
    static func packages(_ dir: String, _ names: [String], _ done: @escaping (Any?, String?) -> Void) {
        guard let name = names.first else { return done(nil, "not_found: no Packages index in \(dir)") }
        get(URL(string: dir + name)!) { res in
            switch res {
            case .failure(let e): done(nil, e.text)
            case .success(let (status, _, data)):
                if status < 400, let plain = decompress(data, name) {
                    return done(["text": String(decoding: plain, as: UTF8.self), "source": dir + name], nil)
                }
                packages(dir, Array(names.dropFirst()), done)
            }
        }
    }

    static func decompress(_ data: Data, _ name: String) -> Data? {
        if name.hasSuffix(".xz") {
            guard data.starts(with: [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00]) else { return nil }
            return try? (data as NSData).decompressed(using: .lzma) as Data
        }
        if name.hasSuffix(".gz") { return gunzip(data) }
        if name.hasSuffix(".bz2") { return PackagesIndex.bunzip2(data) }
        // A plain index, not an HTML page some hosts send for every path (BigBoss's starts with blank lines).
        return PackagesIndex.looksLikeHTML(data) ? nil : data
    }

    // gzip (RFC 1952) = header + raw deflate + crc32/size; NSData's .zlib is raw deflate.
    static func gunzip(_ d: Data) -> Data? {
        let b = [UInt8](d)
        guard b.count > 18, b[0] == 0x1F, b[1] == 0x8B, b[2] == 8 else { return nil }
        let flags = b[3]
        var i = 10
        if flags & 4 != 0 { guard i + 2 <= b.count else { return nil }; i += 2 + Int(b[i]) + Int(b[i + 1]) << 8 }
        if flags & 8 != 0 { while i < b.count && b[i] != 0 { i += 1 }; i += 1 }
        if flags & 16 != 0 { while i < b.count && b[i] != 0 { i += 1 }; i += 1 }
        if flags & 2 != 0 { i += 2 }
        guard i < b.count - 8 else { return nil }
        return try? (Data(b[i..<(b.count - 8)]) as NSData).decompressed(using: .zlib) as Data
    }

    // ---- replies (WebKit wants them on the main thread)

    static func reply(_ c: Bridge.Call, _ value: Any?, _ error: String?) {
        DispatchQueue.main.async { c.reply(value, error) }
    }

    static func work(_ c: Bridge.Call, _ f: @escaping () throws -> Any?) {
        DispatchQueue.global(qos: .userInitiated).async {
            do { reply(c, try f(), nil) }
            catch let e as BridgeError { reply(c, nil, e.text) }
            catch { reply(c, nil, "network: \(error.localizedDescription)") }
        }
    }
}

struct BridgeError: Error {
    let code: String, message: String
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
    var text: String { "\(code): \(message)" }
}

extension Bridge.Call {
    func emitOnMain(_ events: [[String: Any]]) {
        DispatchQueue.main.async { self.emit(events) }
    }
}

// ifizbox-helper as root through native/helper/spawn.c (the persona spawn attributes, allowed by the
// com.apple.private.persona-mgmt entitlement). Its fds 1, 2 and 3 (apt's status lines) are read to the end on
// three threads; with `emit`, every finished line goes to the page as { fd: "out" | "err" | "status", line }.
// stdin is /dev/null, except for apply-ask (F63): a pipe that helper.answer writes into until the helper ends.
// F64: helper.cancel writes "C" into the same pipe. The helper runs as root, so the app (mobile) can't signal it or
// apt-get itself (kill is EPERM across users); the helper turns the line into SIGINT for apt-get.
enum Helper {
    // F63: the stdin of the running apply-ask (one console runs at a time), or -1.
    static var answerFd: Int32 = -1
    static let answerLock = NSLock()
    // F64: the running apply-ask has had a pmstatus:/pmconffile:/pmerror: line on fd 3: dpkg is at work, so Cancel
    // is refused (Cydia's Cancel goes away there too). Guarded by answerLock.
    static var dpkgStarted = false

    // F64: Cancel while apt is still downloading (only dlstatus: lines so far).
    static func cancel() throws {
        answerLock.lock(); defer { answerLock.unlock() }
        guard answerFd >= 0 else { throw BridgeError("helper", "no install is running") }
        guard !dpkgStarted else { throw BridgeError("helper", "dpkg is already installing; it can't be stopped halfway") }
        let n = "C\n".withCString { write(answerFd, $0, 2) }
        if n != 2 { throw BridgeError("helper", "the install isn't listening: \(String(cString: strerror(errno)))") }
    }

    // F63: the console's answer to dpkg's conffile question (apt's pmconffile: line): keep -> "N" (Keep My Old
    // Copy), new -> "Y" (Accept the New Copy). ifizbox-helper passes on only those two lines.
    static func answer(_ word: String) throws {
        guard let line = ["keep": "N\n", "new": "Y\n"][word] else { throw BridgeError("helper", "answer is keep or new") }
        answerLock.lock(); defer { answerLock.unlock() }
        guard answerFd >= 0 else { throw BridgeError("helper", "no install is waiting for an answer") }
        let n = line.withCString { write(answerFd, $0, 2) }
        if n != 2 { throw BridgeError("helper", "the install isn't listening: \(String(cString: strerror(errno)))") }
    }

    static func run(_ words: [String], emit: (([[String: Any]]) -> Void)?) throws -> [String: Any] {
        let path = Jailbreak.helper
        guard FileManager.default.isExecutableFile(atPath: path) else {
            throw BridgeError("helper", "ifizbox-helper is not installed at \(path)")
        }
        var cargs: [UnsafeMutablePointer<CChar>?] = words.map { strdup($0) }
        cargs.append(nil)
        defer { for p in cargs { free(p) } }
        var pid: pid_t = 0
        var fds: (Int32, Int32, Int32) = (-1, -1, -1)
        // F63: apply-ask gets a pipe on its stdin, which helper.answer writes the console's answers into.
        // F239: install-deb-ask (the queue run's shell-fetched .debs) too.
        let ask = words.first == "apply-ask" || words.first == "install-deb-ask"
        var input: Int32 = -1
        let rc = cargs.withUnsafeBufferPointer { buf -> Int32 in
            buf.baseAddress!.withMemoryRebound(to: UnsafePointer<CChar>?.self, capacity: buf.count) { args in
                ask ? ifizbox_helper_spawn_in(path, args, &pid, &input, &fds.0, &fds.1, &fds.2)
                    : ifizbox_helper_spawn(path, args, &pid, &fds.0, &fds.1, &fds.2)
            }
        }
        if rc != 0 { throw BridgeError("helper", "can't start ifizbox-helper: \(String(cString: strerror(rc)))") }
        if ask {
            _ = fcntl(input, F_SETNOSIGPIPE, 1) // an answer after the helper is gone is EPIPE, not a dead app
            answerLock.lock(); answerFd = input; dpkgStarted = false; answerLock.unlock()
        }
        defer {
            if ask {
                answerLock.lock(); if answerFd == input { answerFd = -1 }; answerLock.unlock()
                close(input)
            }
        }

        let names = ["out", "err", "status"]
        var collected = [Data(), Data(), Data()]
        let lock = NSLock()
        let group = DispatchGroup()
        for (i, fd) in [fds.0, fds.1, fds.2].enumerated() {
            group.enter()
            // F64: apply-ask's status lines are split even without emit, to see when dpkg starts.
            let watch = ask && i == 2
            Thread.detachNewThread {
                var all = Data(), pending = Data()
                var buf = [UInt8](repeating: 0, count: 16384)
                while true {
                    let n = read(fd, &buf, buf.count)
                    if n < 0 && errno == EINTR { continue }
                    if n <= 0 { break }
                    all.append(contentsOf: buf[0..<n])
                    guard emit != nil || watch else { continue }
                    pending.append(contentsOf: buf[0..<n])
                    var lines: [[String: Any]] = []
                    while let nl = pending.firstIndex(of: 0x0A) {
                        let text = String(decoding: pending[pending.startIndex..<nl], as: UTF8.self)
                        if watch && (text.hasPrefix("pmstatus:") || text.hasPrefix("pmconffile:") || text.hasPrefix("pmerror:")) {
                            answerLock.lock(); if answerFd == input { dpkgStarted = true }; answerLock.unlock()
                        }
                        lines.append(["fd": names[i], "line": text])
                        pending = Data(pending[(nl + 1)...])
                    }
                    if let emit = emit, !lines.isEmpty { emit(lines) }
                }
                if let emit = emit, !pending.isEmpty { emit([["fd": names[i], "line": String(decoding: pending, as: UTF8.self)]]) }
                close(fd)
                lock.lock(); collected[i] = all; lock.unlock()
                group.leave()
            }
        }
        group.wait()
        var status: Int32 = 0
        while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
        // WIFEXITED / WEXITSTATUS / WTERMSIG are macros Swift doesn't import.
        let code: Int32 = (status & 0x7F) == 0 ? (status >> 8) & 0xFF : 128 + (status & 0x7F)
        return ["code": Int(code), "stdout": String(decoding: collected[0], as: UTF8.self),
                "stderr": String(decoding: collected[1], as: UTF8.self)]
    }
}

// F59: ipa.install, the jailbreak build's IPA install (the sideload build signs and installs with signing.install,
// SignBridge.swift). Downloads the IPA into the one directory ifizbox-helper takes IPAs from (native/helper/policy.h
// HELPER_IPA_DIR: this no-container app's own Caches) as <UUID>.ipa, runs `ifizbox-helper install-ipa <path>` (as
// AppSync's appinst does; ad hoc signed with ldid first when AppSync Unified isn't there, native/helper/ipa.c) and
// removes the download. Replies {code: 0, stdout, stderr, bundleId}, or an error:
//   bad_url, network, timeout, not_found (HTTP >= 400)          the download
//   bad_ipa   (helper exit 64) not an IPA, or not the app's own file
//   no_adhoc  (exit 69) the jailbreak can't install ad hoc apps: no AppSync Unified and no ldid, or installd
//             refused the ad hoc signed app. The message says what to install.
//   install   (exit 1 or 74) installd refused it, or the helper couldn't copy or unpack it
//   helper    no helper, or it refused the caller (exit 77)
// The message is the helper's own last "ifizbox-helper: " line.
enum IPAInstall {
    static let dir = "/var/mobile/Library/Caches/com.ryha.ifizbox/ipa" // = HELPER_IPA_DIR

    static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 60 * 60 // an IPA can be a few GB
        cfg.httpAdditionalHeaders = Apt.session.configuration.httpAdditionalHeaders
        return URLSession(configuration: cfg)
    }()

    // F196: the running ipa.install, for ipa.cancel. Guarded by runLock.
    final class Run { var task: URLSessionTask?; var fetch: DebFetch?; var cancelled = false; var helper = false }
    static let runLock = NSLock()
    static var running: Run?

    static func cancel() throws {
        runLock.lock(); defer { runLock.unlock() }
        guard let r = running, !r.cancelled else { throw BridgeError("helper", "no IPA install is running") }
        guard !r.helper else { throw BridgeError("helper", "ifizbox-helper is already installing the IPA; it can't be stopped halfway") }
        r.cancelled = true
        r.task?.cancel()
        r.fetch?.cancel()
    }

    // B113: an http:// link, as Sideload.download does for the sideload app (B104): IPAInstall.session is URLSession,
    // which ATS keeps off plain http. Without `insecure` the https twin (Sideload.httpsTwin, 20 s idle limit) is
    // downloaded instead; when it has none, the call answers "insecure: …" and the page asks (web/app/ipa-install.js,
    // core/insecureipa.js INSECURE_IPA_ALERT). With `insecure` (Install Anyway) the link itself comes over plain http
    // through F238's PlainDownload (Network.framework; no ATS exception). The file lands at `path` (in `dir`, where
    // the helper takes IPAs from); progress goes out as dlstatus lines. -> the running download, for ipa.cancel.
    static func fetchHTTP(_ url: URL, twin: URL, insecure: Bool, to path: String, emit: (([[String: Any]]) -> Void)?,
                          done: @escaping (String?) -> Void) -> DebFetch {
        let dest = URL(fileURLWithPath: path)
        var shown = -1
        let progress = { (p: Double) in
            let pct = Int((min(max(p, 0), 1) * 100).rounded(.down))
            guard pct != shown else { return }
            shown = pct
            emit?([["fd": "status", "line": "dlstatus:ipa:\(pct):Downloading"]])
        }
        // Download's and PlainDownload's "the server answered 404" is ipa.install's not_found, as for https links.
        let finished = { (err: String?) in
            if let e = err, let r = e.range(of: "network: the server answered 4"), r.lowerBound == e.startIndex {
                return done("not_found: HTTP \(e.dropFirst("network: the server answered ".count)) for \(url.absoluteString)")
            }
            done(err)
        }
        if insecure {
            NSLog("[ipa.install] plain http download (Install Anyway): %@", url.absoluteString)
            return PlainDownload.start(url, to: dest, max: SignBridge.maxIPA, progress: progress, done: finished)
        }
        return Download.start(twin, to: dest, max: SignBridge.maxIPA, timeout: Sideload.twinTimeout, progress: progress) { err in
            guard let e = err else { return finished(nil) }
            if !Sideload.twinMissing(e) { return finished(e) }
            NSLog("[ipa.install] no https twin for %@ (%@)", url.absoluteString, e)
            finished("insecure: \(url.host ?? url.absoluteString) offers this IPA only over plain http, without encryption")
        }
    }

    // F380: `keep` (keepInLibrary: true, a custom install) moves the download into My IPAs once the helper installed
    // it (it installs from a copy of its own), instead of removing it; the reply adds {libraryFile}.
    static func run(_ url: URL, insecure: Bool = false, keep: Bool = false, emit: (([[String: Any]]) -> Void)?,
                    done finished: @escaping (Any?, String?) -> Void) {
        let job = Run()
        runLock.lock(); running = job; runLock.unlock()
        let done = { (v: Any?, e: String?) in
            runLock.lock(); if running === job { running = nil }; let stopped = job.cancelled; runLock.unlock()
            finished(stopped && e != nil ? nil : v, stopped && e != nil ? "cancelled: Cancelled" : e)
        }
        let fm = FileManager.default
        do {
            try fm.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        } catch { return done(nil, "install: can't make \(dir): \(error.localizedDescription)") }
        emit?([["fd": "status", "line": "dlstatus:ipa:0:Downloading"]])
        // The downloaded IPA at `path` (in dir) to the helper, then removed.
        let install = { (path: String) in
            DispatchQueue.global(qos: .userInitiated).async {
                defer { try? FileManager.default.removeItem(atPath: path) }
                // F196: Cancel after the download: the helper never starts; from here on ipa.cancel refuses.
                runLock.lock(); let stop = job.cancelled; if !stop { job.helper = true }; runLock.unlock()
                if stop { return done(nil, "cancelled: Cancelled") }
                do {
                    let r = try Helper.run(["install-ipa", path], emit: emit)
                    let code = r["code"] as? Int ?? 1
                    let out = r["stdout"] as? String ?? "", errText = r["stderr"] as? String ?? ""
                    if code == 0 {
                        let id = out.split(separator: "\n").last { $0.hasPrefix("Installed ") }.map { String($0.dropFirst(10)) }
                        var ok: [String: Any] = ["code": 0, "stdout": out, "stderr": errText, "bundleId": id ?? ""]
                        if keep, let f = SignBridge.queue.sync(execute: { MyIPAs.keepDownload(URL(fileURLWithPath: path), url: url) }) {
                            ok["libraryFile"] = f // F380
                        }
                        return done(ok, nil)
                    }
                    let why = errText.split(separator: "\n").last { $0.hasPrefix("ifizbox-helper: ") }
                        .map { String($0.dropFirst(16)) } ?? "ifizbox-helper exited with \(code)"
                    let kind = code == 64 ? "bad_ipa" : code == 69 ? "no_adhoc" : code == 77 ? "helper" : "install"
                    done(nil, "\(kind): \(why)")
                } catch let e as BridgeError { done(nil, e.text) }
                catch { done(nil, "helper: \(error.localizedDescription)") }
            }
        }
        // B113: http links: the https twin, or "insecure" for the page to ask, or plain http after Install Anyway.
        if let twin = Sideload.httpsTwin(url) {
            let path = dir + "/" + UUID().uuidString + ".ipa"
            let fetch = fetchHTTP(url, twin: twin, insecure: insecure, to: path, emit: emit) { err in
                if let e = err { try? fm.removeItem(atPath: path); return done(nil, e) }
                install(path)
            }
            runLock.lock(); job.fetch = fetch; let stop = job.cancelled; runLock.unlock()
            if stop { fetch.cancel() }
            return
        }
        let task = session.downloadTask(with: url) { tmp, resp, err in
            // B104: an https link sent on to plain http: our words (core/insecureipa.js atsText), never iOS's
            if let e = err as? URLError, e.code == .appTransportSecurityRequiresSecureConnection {
                return done(nil, "ats: the link leads to a plain http address\((e.failingURL?.host).map { " (\($0))" } ?? ""), which iOS blocks here")
            }
            if let e = err as? URLError { return done(nil, "\(e.code == .timedOut ? "timeout" : "network"): \(e.localizedDescription)") }
            if let e = err { return done(nil, "network: \(e.localizedDescription)") }
            guard let tmp = tmp, let http = resp as? HTTPURLResponse else { return done(nil, "network: no HTTP answer") }
            if http.statusCode >= 400 { return done(nil, "not_found: HTTP \(http.statusCode) for \(url.absoluteString)") }
            let path = dir + "/" + UUID().uuidString + ".ipa"
            do { try FileManager.default.moveItem(atPath: tmp.path, toPath: path) }
            catch { return done(nil, "install: can't keep the download: \(error.localizedDescription)") }
            install(path)
        }
        runLock.lock(); job.task = task; let early = job.cancelled; runLock.unlock()
        if early { task.cancel() }
        task.resume()
    }
}
