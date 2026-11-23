// F77: My IPAs, the bridge for web/app/screens/myipas.js (sideload build). The library itself (where files live,
// what counts as signed) is native/sign/Library.swift; this file adds the phone's parts: the Files picker, the share
// sheet, downloads, and installing a signed copy through Sideload's install server and the Signing Server's manifest.
//
//   library.list                    -> {ipas: [entry], identity: bool}   (entry: IPALibrary.json)
//   library.add {url} (stream: {phase: "downloading", progress})  -> {file, ipas}
//   library.pick                    the iOS Files picker (.ipa, several at once) -> {files: [name], ipas} ([] on Cancel)
//   library.options {file, name?, bundleId?, icon?, removeExtensions?, fixArm64e?, keepBundleId?}  Sign Options -> entry
//   library.sign {file} (stream: {phase: "signing", progress})   signs offline into the signed copy -> entry
//   F243: every call takes keepBundleId (Settings > Signing's Keep Bundle IDs, false when off): an IPA without Sign
//   Options of its own signs, and counts as signed, that way (IPALibrary.options(_:keep:)); one with them, its own way.
//   library.install {file, manifestServer} (stream as signing.install)  signs if needed, then installs
//                                   -> signing.install's reply + {file}; the signed copy stays either way
//   library.export {file}           the share sheet (Save to Files, AirDrop...) for the signed copy -> {shared: bool}
//   library.delete {file}           the IPA, its signed copy and options -> {ipas}
//   library.unsign {file}           F224: only the signed copy (the IPA and its options stay) -> {ipas}
//   library.helperInstall {file, stream}   F212, jailbreak only: ifizbox-helper installs the file as it is
//                                   -> {code: 0, stdout, stderr, bundleId, name, version} (share.ipaInstall's reply)
// F212: list, add, pick, delete and helperInstall work in the jailbreak app too (its Documents is
// /var/mobile/Documents); options, sign, install and export stay the sideload build's (they sign).
// F196: signing.cancel (Sideload.cancel) stops library.sign and library.install too: the signer at its next step
// (the earlier signed copy, if any, stays), and an install's serving to iOS.
//
// Other apps' .ipa (Open in iFizBox, AirDrop, Files: the document type in Info-sideload.plist) land in the library
// too: MyIPAs.receive copies the file in and hands the page ifizbox://myipas?file=<name> (web/app/incoming.js).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import UIKit
import UniformTypeIdentifiers

enum MyIPAs {
    static let library: IPALibrary = {
        let fm = FileManager.default
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("MyIPAs", isDirectory: true)
        var lib = IPALibrary(root: docs, store: support)
        lib.iconFix = smallPNG
        return lib
    }()

    static func register(_ b: Bridge) {
        b.on("library.list") { c in anyMode(c) { list(keep(c)) } } // F212: list, add, pick, delete in the jailbreak app too
        b.on("library.add") { c in add(c) }
        b.on("library.pick") { c in pick(c) }
        b.on("library.options") { c in
            SignBridge.run(c) {
                let file = c.params["file"] as? String ?? ""
                var o = try SignOptions(json: c.params)
                // F288: a page that doesn't send tweaks (an older one) keeps the saved ones; null or {} clears them
                if c.params["tweaks"] == nil { o.tweaks = library.options(file).tweaks }
                try library.setOptions(file, o)
                return library.json(file, certificate: certificate())
            }
        }
        b.on("library.sign") { c in
            guard let (id, profile) = Sideload.ready(c) else { return }
            let emit = emitter(c)
            let job = SignJob.begin() // F196
            SignBridge.queue.async {
                defer { job.end() }
                do {
                    let file = c.params["file"] as? String ?? ""
                    _ = try signIfNeeded(file, id: id, profile: profile, emit: emit, job: job, keep: keep(c),
                                         log: { c.emitOnMain([["log": $0]]) }) // B340: Sign's run log too
                    Apt.reply(c, library.json(file, certificate: certificate(), keep: keep(c)), nil)
                } catch { Apt.reply(c, nil, SignBridge.text(job.cancelled ? SignJob.cancelledError : error)) }
            }
        }
        b.on("library.install") { c in install(c) }
        // F224: Install IPAs' Unsign: drops the signed copy, keeps the IPA and its options (sideload build only).
        b.on("library.unsign") { c in
            SignBridge.run(c) {
                let file = c.params["file"] as? String ?? ""
                _ = try library.url(file)
                library.dropSigned(file)
                return list(keep(c))
            }
        }
        b.on("library.helperInstall") { c in helperInstall(c) } // F212
        b.on("library.export") { c in export(c) }
        b.on("library.delete") { c in
            anyMode(c) {
                try library.delete(c.params["file"] as? String ?? "")
                return list(keep(c))
            }
        }
    }

    // F212: SignBridge.run without its jailbreak refusal, for the calls the jailbreak app's My IPAs makes too.
    static func anyMode(_ c: Bridge.Call, _ f: @escaping () throws -> Any?) {
        SignBridge.queue.async {
            do { Apt.reply(c, try f(), nil) } catch { Apt.reply(c, nil, SignBridge.text(error)) }
        }
    }

    // F212: the jailbreak app's Install for a library file: a copy staged where ifizbox-helper takes IPAs, then
    // share.ipaInstall's run (ShareRun.installIPA); the library keeps its file. Replies and errors as share.ipaInstall's.
    static func helperInstall(_ c: Bridge.Call) {
        guard AppMode.current == .jailbreak else {
            return Apt.reply(c, nil, "sideload: the sideload build installs My IPAs with library.install")
        }
        let emit = ShareBridge.emitter(c)
        SharedInbox.queue.async {
            var staged: String?
            defer { if let p = staged { try? FileManager.default.removeItem(atPath: p) } }
            do {
                let src = try library.url(c.params["file"] as? String ?? "")
                staged = try ShareInbox.stage(src, kind: .ipa, dirs: SharedInbox.dirs)
                let app = try ShareRun.installIPA(staged!, PhoneShareHost(), emit: emit)
                Apt.reply(c, ["code": 0, "stdout": "", "stderr": "", "bundleId": app.bundleID, "name": app.name,
                              "version": app.version], nil)
            } catch let e as SignError { Apt.reply(c, nil, SignBridge.text(e)) }
            catch { Apt.reply(c, nil, ShareBridge.text(error)) }
        }
    }

    static func certificate() -> Data? { SignStore.identity().flatMap(SignStore.certificateDER) }

    // F243: `keep`, Settings > Signing's Keep Bundle IDs as the page sends it (keepBundleId: false when off, absent
    // when on), for IPAs without Sign Options of their own (IPALibrary.options(_:keep:)).
    static func keep(_ c: Bridge.Call) -> Bool? { c.params["keepBundleId"] as? Bool }

    static func list(_ keep: Bool? = nil) -> [String: Any] {
        library.sweep()
        let cert = certificate()
        return ["ipas": library.files().map { library.json($0, certificate: cert, keep: keep) }, "identity": cert != nil]
    }

    static func emitter(_ c: Bridge.Call) -> (String, Double) -> Void {
        let throttle = Throttle()
        return { phase, p in if throttle.pass(phase, p) { c.emitOnMain([["phase": phase, "progress": p]]) } }
    }

    // The signed copy, signed now when there is none that fits. Runs on SignBridge.queue.
    // F196: `job` stops the signer at its next step (SignJob).
    static func signIfNeeded(_ file: String, id: SecIdentity, profile: Profile, emit: @escaping (String, Double) -> Void,
                             job: SignJob? = nil, keep: Bool? = nil, log: ((String) -> Void)? = nil) throws -> IPALibrary.Signed {
        let identity = try KeychainIdentity(id)
        if let p = DeviceCheck.problem(PhoneID.check(profile)) { throw p } // F236: before iOS's "integrity" alert
        if let s = library.signed(file, certificate: identity.certificate, keep: keep) {
            // A copy signed under another App ID than the installed app's (or one from before copies kept it) would be
            // refused by iOS (installd error 15): signed again below, where the signer keeps the installed one.
            guard let have = Sideload.installedAppID(s.bundleID, log: log), have != s.appID else { return s }
            log?("The signed copy of \(file) has App ID \(s.appID ?? "(not kept)"), the installed app \(have): signing again")
            library.dropSigned(file)
        }
        if let p = profile.problem(with: identity.certificate) { throw p }
        if let why = try library.details(file).error { throw SignError("bad_ipa", why) }
        try job?.check()
        let signer = IPASigner(profile: profile, identity: identity)
        if let job = job { signer.stop = { job.cancelled } }
        if let log = log { let nslog = signer.log; signer.log = { nslog($0); log($0) } } // B327: Keychain:/Group fix: lines in the run's log
        signer.installedAppID = { Sideload.installedAppID($0, log: log) } // B340: an update keeps its App ID, as SignAhead.sign (B280)
        return try library.sign(file, signer: signer, certificate: identity.certificate,
                                expires: profile.signatureExpiry(certificate: identity.certificate), work: SignBridge.work,
                                progress: { emit($0, $1) }, keep: keep)
    }

    // ---- adding

    static func add(_ c: Bridge.Call) {
        guard let url = Apt.httpURL(c.params["url"]) else { return Apt.reply(c, nil, "bad_url: not an http(s) URL") }
        let emit = emitter(c)
        // B104: Sideload.download's http rules (the https twin, or "insecure" for the page to ask)
        Sideload.download(url, http: Sideload.httpPolicy(c), emit: emit) { res in
            let tmp: URL
            switch res {
            case .failure(let e): return Apt.reply(c, nil, (e as? Sideload.Failed)?.text ?? SignBridge.text(e))
            case .success(let f): tmp = f
            }
            SignBridge.queue.async {
                // What came back must be an IPA (a zip with one Payload/<App>.app/Info.plist): a web page or any
                // other file is refused and deleted, never kept under the link's name or "App".
                let d: AppDetails
                do { d = try Inspect.ipa(tmp) } catch {
                    try? FileManager.default.removeItem(at: tmp)
                    return Apt.reply(c, nil, "not_ipa: That link didn't give an IPA (it may be a web page or another kind of file).")
                }
                do {
                    // A link that doesn't end in .ipa (a redirect, ?download=1): named after the app inside.
                    var name = url.lastPathComponent
                    if !name.lowercased().hasSuffix(".ipa") {
                        let n = [d.name.isEmpty ? d.bundleID : d.name, d.version].filter { !$0.isEmpty }.joined(separator: " ")
                        name = n + ".ipa"
                    }
                    let file = try library.add(tmp, name: name, move: true)
                    var out = list(keep(c))
                    out["file"] = file
                    Apt.reply(c, out, nil)
                } catch {
                    try? FileManager.default.removeItem(at: tmp)
                    Apt.reply(c, nil, "internal: \(error.localizedDescription)")
                }
            }
        }
    }

    static func pick(_ c: Bridge.Call) {
        DispatchQueue.main.async {
            guard let top = topController() else { return c.reply(nil, "internal: no window to show the picker in") }
            let types = [UTType("com.apple.itunes.ipa"), UTType(filenameExtension: "ipa")].compactMap { $0 }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types.isEmpty ? [.data] : types, asCopy: true)
            picker.allowsMultipleSelection = true
            let d = PickDelegate { urls in
                SignBridge.queue.async {
                    var files = [String]()
                    for u in urls where u.pathExtension.lowercased() == "ipa" {
                        if let f = try? library.add(u, name: u.lastPathComponent, move: true) { files.append(f) }
                    }
                    var out = list(keep(c))
                    out["files"] = files
                    Apt.reply(c, out, nil)
                }
            }
            picker.delegate = d
            objc_setAssociatedObject(picker, &PickDelegate.key, d, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            top.present(picker, animated: true)
        }
    }

    // An .ipa another app handed over (Info-sideload.plist's document type): into the library, then the page opens
    // it. False for anything else. One already in Documents (tapped in Files) just opens.
    static func receive(_ url: URL) -> Bool {
        guard url.isFileURL, url.pathExtension.lowercased() == "ipa", AppMode.current == .sideload else { return false }
        // B163: the security scope from the moment iOS hands the URL over (documents open in place), not later.
        let scoped = url.startAccessingSecurityScopedResource()
        OpenLog.hop("MyIPAs: took \(url.lastPathComponent)")
        SignBridge.queue.async {
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let docs = library.root.standardizedFileURL.resolvingSymlinksInPath().path
            let dir = url.standardizedFileURL.resolvingSymlinksInPath().deletingLastPathComponent().path
            let file: String
            if dir == docs, IPALibrary.validName(url.lastPathComponent) {
                file = url.lastPathComponent
            } else {
                // iOS's Documents/Inbox copy is ours to move; anything else is copied (B163: in pieces, with the
                // page's Copying HUD, and an alert when it fails, never silence).
                do { file = try SharedInbox.keep(url, name: url.lastPathComponent, move: ShareInbox.isOurInbox(url, documents: library.root)) } catch {
                    Incoming.receiving(url.lastPathComponent, progress: nil)
                    OpenLog.hop("MyIPAs: error: couldn't keep it: \(error)")
                    return SharedInbox.refuse((error as? IntentFailure)?.message ?? "\(Brand.name) couldn't keep a copy of \(url.lastPathComponent): \(error.localizedDescription)")
                }
            }
            guard var q = URLComponents(string: "ifizbox://myipas") else { return }
            let f = file
            q.queryItems = [URLQueryItem(name: "file", value: f)]
            guard let link = q.url else { return SharedInbox.refuse("\(Brand.name) couldn't open \(f) in My IPAs.") }
            OpenLog.hop("MyIPAs: handing the page \(OpenLog.url(link))")
            DispatchQueue.main.async { Incoming.receive(link) }
        }
        return true
    }

    // ---- installing

    static func install(_ c: Bridge.Call) {
        guard let (id, profile) = Sideload.ready(c) else { return }
        // B64: this call's own server, never hosted (the phone's 127.0.0.1 install server serves it).
        guard let servers = Sideload.servers(c, allowHost: false) else { return Apt.reply(c, nil, Sideload.noServer) }
        let emit = emitter(c)
        let file = c.params["file"] as? String ?? ""
        let job = SignJob.begin() // F196: until iOS has the IPA (serveAndOpen ends it)
        SignBridge.queue.async {
            let s: IPALibrary.Signed
            do { s = try signIfNeeded(file, id: id, profile: profile, emit: emit, job: job, keep: keep(c), log: { c.emitOnMain([["log": $0]]) }); try job.check() } catch {
                job.end()
                return Apt.reply(c, nil, SignBridge.text(job.cancelled ? SignJob.cancelledError : error))
            }
            // The server deletes what it served: it gets a copy, and the signed copy stays for next time.
            let out = SignBridge.work.appendingPathComponent("\(SignBridge.token())-lib.ipa")
            do { try FileManager.default.copyItem(at: library.signedURL(file), to: out) } catch {
                job.end()
                return Apt.reply(c, nil, "internal: \(error.localizedDescription)")
            }
            let record = SignedRecord(bundleID: s.bundleID, originalBundleID: s.originalBundleID, name: s.name, version: s.version,
                                      url: libraryURL(file), signed: s.signed, expires: s.expires, options: s.options,
                                      appID: s.appID, signer: s.signer) // B259; appID: the next Re-sign reads it, as SignAhead's
            if !servers.local { emit("installing", 0) } // This iPhone: installHere sends its own phase ("here")
            // B29: the progress page's console, as signing.install has it: the bundle ID and what iOS fetched.
            let log = { (line: String) in c.emitOnMain([["log": line]]) }
            log("Installing the signed copy of \(file): \(s.name) \(s.version) as \(s.bundleID)")
            let done = { (r: Result<(SignedApp, SignedRecord), Error>) in
                switch r {
                case .failure(let e):
                    job.end()
                    Apt.reply(c, nil, job.cancelled ? SignBridge.text(SignJob.cancelledError) : (e as? Sideload.Failed)?.text ?? SignBridge.text(e))
                case .success(let (app, rec)):
                    var j: [String: Any] = ["bundleId": app.bundleID, "originalBundleId": app.originalBundleID, "name": app.name,
                                            "version": app.version, "removed": app.removed, "fixedArm64e": app.fixedArm64e, "file": file]
                    if let x = rec.expires { j["expires"] = ISO8601DateFormatter().string(from: x) }
                    Apt.reply(c, j, nil)
                }
            }
            if servers.local { return Sideload.installHere(out, app: s.app, record: record, emit: emit, log: log, job: job, opened: done, served: nil) }
            Sideload.serveAndOpen(out, server: servers.manifest, app: s.app, record: record, log: log, job: job, opened: done)
        }
    }

    // Where a signed record says the app came from, so Re-sign All (Sideload.resignAll) signs it from the library again.
    static let scheme = "library:"
    static func libraryURL(_ file: String) -> String { scheme + (file.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? file) }
    static func fileOf(_ recordURL: String) -> String? {
        guard recordURL.hasPrefix(scheme) else { return nil }
        return String(recordURL.dropFirst(scheme.count)).removingPercentEncoding
    }

    // Re-sign All's input for a record made here: a copy of the library's IPA (signAndOpen deletes its input).
    static func copyForResign(_ recordURL: String) throws -> URL? {
        guard let file = fileOf(recordURL) else { return nil }
        let src = try library.url(file)
        let tmp = SignBridge.work.appendingPathComponent("\(SignBridge.token())-in.ipa")
        try FileManager.default.copyItem(at: src, to: tmp)
        return tmp
    }

    // ---- Save Signed IPA

    static func export(_ c: Bridge.Call) {
        guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: not in the jailbreak app") }
        let file = c.params["file"] as? String ?? ""
        SignBridge.queue.async {
            guard let s = library.signed(file, certificate: certificate(), keep: keep(c)) else {
                return Apt.reply(c, nil, "not_signed: sign it first (Sign Now)")
            }
            // Named for the person saving it: "<App> <version> (signed).ipa" in a folder of its own.
            let dir = SignBridge.work.appendingPathComponent("export-\(SignBridge.token())", isDirectory: true)
            let name = IPALibrary.safeName("\([s.name, s.version].filter { !$0.isEmpty }.joined(separator: " ")) (signed)")
            let out = dir.appendingPathComponent(name)
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try FileManager.default.copyItem(at: library.signedURL(file), to: out)
            } catch { return Apt.reply(c, nil, "internal: \(error.localizedDescription)") }
            DispatchQueue.main.async {
                guard let top = topController() else { return c.reply(nil, "internal: no window to show the share sheet in") }
                let vc = UIActivityViewController(activityItems: [out], applicationActivities: nil)
                vc.completionWithItemsHandler = { _, done, _, _ in
                    SignBridge.queue.asyncAfter(deadline: .now() + 60) { try? FileManager.default.removeItem(at: dir) }
                    c.reply(["shared": done], nil)
                }
                if let pop = vc.popoverPresentationController { pop.sourceView = top.view; pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY, width: 1, height: 1) }
                top.present(vc, animated: true)
            }
        }
    }

    // ---- helpers

    static func topController() -> UIViewController? {
        let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.windows.first(where: \.isKeyWindow) ?? ($0 as? UIWindowScene)?.windows.first }
            .first?.rootViewController
        var top = root
        while let p = top?.presentedViewController { top = p }
        return top
    }

    // Any PNG UIKit reads (Apple's CgBI form too) as a plain 120x120 PNG for the list; nil when it doesn't read.
    static func smallPNG(_ data: Data) -> Data? {
        guard let img = UIImage(data: data), img.size.width > 0, img.size.height > 0 else { return nil }
        let side: CGFloat = 120
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).pngData { _ in
            img.draw(in: CGRect(x: 0, y: 0, width: side, height: side))
        }
    }
}

final class PickDelegate: NSObject, UIDocumentPickerDelegate {
    static var key = 0
    private let done: ([URL]) -> Void
    private var finished = false
    init(_ done: @escaping ([URL]) -> Void) { self.done = done }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish(urls) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish([]) }
    private func finish(_ urls: [URL]) {
        guard !finished else { return }
        finished = true
        done(urls)
    }
}
