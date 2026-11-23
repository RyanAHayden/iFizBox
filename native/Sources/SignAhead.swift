// F235: the IPA queue's run signs every app first and hands them to iOS one at a time (web/app/core/apprun.js,
// screens/apprun.js). signing.install does both in one call, so the queue uses these two halves instead:
//
//   signing.prepare {url, name?, bundleId?, icon?, removeExtensions?, fixArm64e?, tag}   an app from its IPA's url, or
//   signing.prepare {record: bundleId, tag}       an app iFizBox signed before, from its record (Re-sign: its url or
//                                                 My IPAs file, its stored edits; iFizBox's own: its running bundle)
//   signing.prepare {library: file, edits?, tag}  a My IPAs file
//        (stream: {phase: "downloading" | "reading" | "signing", progress}, {log})
//        -> {token, bundleId, originalBundleId, name, version, expires?, device}: the signed IPA is kept for `life`;
//        KeepAlive is held from the call to its answer (B257), so it signs with the app in the background
//   signing.open {token, manifestServer, host?, tag}   serves the kept IPA and opens iOS's Install prompt (host: iFizBox's
//        own, uploaded to the Signing Server as signing.install's) -> signing.install's reply; records the app
//        route: "idevice" (This iPhone): installd installs it, no prompt (stream: {phase: "copying" | "installing",
//        progress}); the reply comes once it is installed and says installed: true
//   signing.discard {token}                       forgets a kept IPA that will not be installed -> {discarded}
//   F380: signing.prepare {url, keepInLibrary: true} (a custom install) keeps the downloaded IPA for My IPAs too
//        (IPALibrary.hold, native/sign/KeptDownload.swift); signing.open moves it into the library once it has gone
//        through and its reply adds {libraryFile}. Discarded, failed or forgotten, the held IPA goes with the kept one.
//
// `tag` is the app's (one per try): signing.cancel {tag} stops that app's download, signing or serving only
// (SignJob.cancel(tag:)), and signing.progress {bundleId, tag} ends its watch. The kept IPAs live in SignBridge.work
// (emptied at launch) and go once opened, discarded or after `life`; one whose This iPhone install failed is kept again
// under its token (B337), so the Signing Server Fallback opens it without signing again.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum SignAhead {
    // F380: `mine`, the download held for My IPAs (keepInLibrary), moved into the library once opened
    private struct Kept { let output: URL; let app: SignedApp; let record: SignedRecord; var mine: URL? = nil }
    private static var kept = [String: Kept]() // on SignBridge.queue
    // B263: the signer's own lane (one app at a time, as before), off SignBridge.queue so signing.open isn't held by it
    private static let signer = DispatchQueue(label: "ifizbox.sign.ahead", qos: .userInitiated)
    static let life: TimeInterval = 30 * 60

    static func register(_ b: Bridge) {
        b.on("signing.prepare") { c in prepare(c) }
        b.on("signing.open") { c in open(c) }
        b.on("signing.discard") { c in
            guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
            let tok = c.params["token"] as? String ?? ""
            SignBridge.queue.async { Apt.reply(c, ["discarded": forget(tok)], nil) }
        }
    }

    // B337: a second name for a kept IPA (a hard link: no copy, same folder) that outlives the first one's removal
    private static func spareLink(_ u: URL) -> URL? {
        let to = u.deletingLastPathComponent().appendingPathComponent("\(SignBridge.token())-spare.ipa")
        do { try FileManager.default.linkItem(at: u, to: to); return to } catch { return nil }
    }

    @discardableResult
    private static func forget(_ tok: String) -> Bool {
        guard let k = kept.removeValue(forKey: tok) else { return false }
        try? FileManager.default.removeItem(at: k.output)
        if let m = k.mine { try? FileManager.default.removeItem(at: m) } // F380: never installed, not saved
        Sideload.dropOriginal(k.app.bundleID, sha256: k.record.sha256) // F343: never installed
        return true
    }

    static func prepare(_ c: Bridge.Call) {
        guard let (id, profile) = Sideload.ready(c) else { return }
        let tag = (c.params["tag"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? SignBridge.token()
        let job = SignJob.begin(tag: tag)
        // B257: KeepAlive from the call to its answer (as Sideload.install's), so the signing after the download's own
        // hold ends goes on with the app in the background; every answer below goes through `answer`, which lets go
        let released = Sideload.holdUntilAnswer()
        let answer = { (j: [String: Any]?, e: String?) in
            released()
            Apt.reply(c, j, e)
        }
        let throttle = Throttle()
        let emit = { (phase: String, p: Double) in
            if throttle.pass(phase, p) { c.emitOnMain([["phase": phase, "progress": p]]) }
        }
        let log = { (s: String) in c.emitOnMain([["log": s]]) }
        let fail = { (e: Error) in
            job.end()
            answer(nil, job.cancelled ? SignBridge.text(SignJob.cancelledError) : (e as? Sideload.Failed)?.text ?? SignBridge.text(e))
        }
        SignBridge.queue.async {
            // where the IPA comes from, and the edits it is signed with
            let source: String, options: SignOptions
            var record: SignedRecord? = nil // F343: Re-sign's, whose kept IPA it signs from when it can
            if let bid = c.params["record"] as? String, !bid.isEmpty {
                guard let r = SignedRecords.only(Sideload.records(), bundleID: bid).first else {
                    job.end()
                    return answer(nil, "not_signed: \(Brand.name) has no record of signing \(bid)")
                }
                record = r
                source = r.url
                var o = SignOptions(r.options)
                // F302a: a tweak update re-signs from the record with the tweaks the page sends (the newer .deb)
                if let t = c.params["tweaks"] {
                    do { o.tweaks = try SignOptions(json: ["tweaks": t]).tweaks } catch { return fail(error) }
                }
                options = o
            } else {
                var o: SignOptions
                do { o = try SignOptions(json: c.params) } catch { return fail(error) }
                // a My IPAs file (library: its name) signs from the library, and its record says so for Re-sign
                if let f = c.params["library"] as? String, !f.isEmpty {
                    source = MyIPAs.libraryURL(f)
                    if c.params["tweaks"] == nil { o.tweaks = MyIPAs.library.options(f).tweaks } // F288: its Sign Options' tweaks
                }
                else { source = c.params["url"] as? String ?? "" }
                options = o
            }
            // B263: the hash and the signer run on `signer`, not SignBridge.queue, so another app's signing.open (the
            // queue's next install) never waits for this one's signing; the kept copy and the answer go back there
            // F380: `mine`, the download held for My IPAs (keepInLibrary), deleted when this doesn't sign
            let signHeld = { (file: URL, mine: URL?) in
                signer.async {
                    let signed: (SignedApp, SignedRecord, URL, String?)
                    let unsigned = { (e: Error) in
                        if let m = mine { try? FileManager.default.removeItem(at: m) }
                        fail(e)
                    }
                    do {
                        // F292: the IPA's hash before signing; a known-malware one stops here
                        let sha: String?
                        do { sha = try IPAHash.check(file, refuse: IPAHash.refuse(c.params), log: log) } catch {
                            try? FileManager.default.removeItem(at: file)
                            throw error
                        }
                        let (app, record, output) = try sign(file, url: source, id: id, profile: profile, options: options, emit: emit, log: log, job: job,
                                                             sha256: sha) // F343
                        signed = (app, record, output, sha)
                    } catch { return unsigned(error) }
                    SignBridge.queue.async {
                        let (app, record, output, sha) = signed
                        keepInLibrary(c, output: output, app: app, record: record, options: options, id: id, log: log) // B229
                        let tok = SignBridge.token()
                        kept[tok] = Kept(output: output, app: app, record: record, mine: mine)
                        SignBridge.queue.asyncAfter(deadline: .now() + life) { forget(tok) }
                        job.end()
                        var j: [String: Any] = ["token": tok, "bundleId": app.bundleID, "originalBundleId": app.originalBundleID,
                                                "name": options.shownName(app.name), "version": app.version] // B247
                        if let x = record.expires { j["expires"] = ISO8601DateFormatter().string(from: x) }
                        j["device"] = PhoneID.check(profile).json
                        if let s = sha { j["sha256"] = s } // F292
                        answer(j, nil)
                    }
                }
            }
            let signThat = { (file: URL) in signHeld(file, nil) }
            // B275: iFizBox's own record (signed from its own bundle) signs from the running bundle, as signing.resign does
            if source == SelfIPA.url {
                let out = SignBridge.work.appendingPathComponent("\(SignBridge.token())-self.ipa")
                do { try SelfIPA.make(app: Bundle.main.bundleURL, to: out) { job.cancelled }; return signThat(out) } catch {
                    try? FileManager.default.removeItem(at: out)
                    return fail(error)
                }
            }
            // F77: an app recorded from My IPAs signs from the library's file
            if MyIPAs.fileOf(source) != nil {
                do {
                    if let file = try MyIPAs.copyForResign(source) { return signThat(file) }
                } catch { return fail(Sideload.Failed(text: "gone: that app isn't in My IPAs any more")) }
            }
            guard let url = Apt.httpURL(source) else { job.end(); return answer(nil, "bad_url: not an http(s) URL") }
            if let r = record, let file = Sideload.takeOriginal(r, log: log) { return signThat(file) } // F343
            log("Downloading \(url.absoluteString)")
            // B104: a recorded app's http link was let through at install; a new one follows the page's insecure
            let http: Sideload.HTTPPolicy = (c.params["record"] as? String ?? "").isEmpty ? Sideload.httpPolicy(c) : .fallback
            let started = Date()
            let keepIt = record == nil && MyIPAs.wantsKeep(c) // F380: not a Re-sign's download
            let d = Sideload.download(url, http: http, emit: emit, // B262: the Log's line and the row's MB/s once a second
                                      bytes: Sideload.downloadTicks(log: log, event: { c.emitOnMain([$0]) })) { res in
                switch res {
                case .failure(let e): fail(e)
                case .success(let file):
                    log(Sideload.downloaded(file, since: started))
                    // F380: a custom install (keepInLibrary) keeps this download for My IPAs: a second name now, as
                    // the signer deletes the first; it moves into the library once signing.open has gone through
                    signHeld(file, keepIt ? IPALibrary.hold(file, in: SignBridge.work, token: SignBridge.token()) : nil)
                }
            }
            job.onCancel { d.cancel() }
        }
    }

    // B229: a My IPAs file signed for the queue ({library}) keeps that signed copy in My IPAs too, as library.sign
    // would (IPALibrary.keepSigned: only when it was signed with the IPA's own Sign Options), so its row reads Signed.
    private static func keepInLibrary(_ c: Bridge.Call, output: URL, app: SignedApp, record: SignedRecord, options: SignOptions,
                                      id: SecIdentity, log: (String) -> Void) {
        guard let f = c.params["library"] as? String, !f.isEmpty, let cert = try? KeychainIdentity(id).certificate else { return }
        do {
            if try MyIPAs.library.keepSigned(f, from: output, app: app, options: options, certificate: cert, signed: record.signed,
                                             expires: record.expires, keep: MyIPAs.keep(c)) {
                log("Kept the signed copy in My IPAs")
            }
        } catch { log("Couldn't keep the signed copy in My IPAs: \(error.localizedDescription)") }
    }

    // signAndOpen's first half (Sideload.swift): the same checks, logs and signer. `input` is deleted after.
    private static func sign(_ input: URL, url: String, id: SecIdentity, profile: Profile, options: SignOptions,
                             emit: @escaping (String, Double) -> Void, log: @escaping (String) -> Void,
                             job: SignJob, sha256: String? = nil) throws -> (SignedApp, SignedRecord, URL) {
        let output = SignBridge.work.appendingPathComponent("\(SignBridge.token())-ahead.ipa")
        defer { try? FileManager.default.removeItem(at: input) }
        do {
            try job.check()
            let identity = try KeychainIdentity(id)
            let cert = try? Certificate(der: identity.certificate)
            log("Certificate: \(cert?.commonName ?? "?") (team \(cert?.team ?? profile.team))")
            if let p = profile.problem(with: identity.certificate) { throw p }
            let device = PhoneID.check(profile)
            if let p = DeviceCheck.problem(device) { throw p }
            let signer = IPASigner(profile: profile, identity: identity)
            signer.options = options
            signer.stop = { job.cancelled }
            let nslog = signer.log
            signer.log = { nslog($0); log($0) }
            signer.installedAppID = { Sideload.installedAppID($0, log: log) } // B280: an update keeps its App ID (B138)
            let app = try signer.sign(input, to: output) { emit($0, $1) }
            log("Signed \(options.shownName(app.name)) \(app.version) as \(app.bundleID), \(Sideload.size(output))")
            try job.check()
            let record = SignedRecord(bundleID: app.bundleID, originalBundleID: app.originalBundleID, name: app.name,
                                      version: app.version, url: url, signed: Date(),
                                      expires: profile.signatureExpiry(certificate: identity.certificate), options: options.stored,
                                      appID: app.appID, signer: app.stamp, // B259; B280: appID as signAndOpen's record
                                      sha256: Sideload.keepOriginal(input, app: app, source: url, sha256: sha256, log: log)) // F343
            return (app, record, output)
        } catch {
            try? FileManager.default.removeItem(at: output)
            throw error
        }
    }

    static func open(_ c: Bridge.Call) {
        guard Sideload.ready(c) != nil else { return }
        guard let servers = Sideload.servers(c) else { return Apt.reply(c, nil, Sideload.noServer) }
        let tag = (c.params["tag"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? SignBridge.token()
        let tok = c.params["token"] as? String ?? ""
        let log = { (s: String) in c.emitOnMain([["log": s]]) }
        SignBridge.queue.async {
            guard let k = kept.removeValue(forKey: tok) else {
                return Apt.reply(c, nil, "gone: the signed copy is gone (kept 30 minutes); sign it again")
            }
            let job = SignJob.begin(tag: tag) // until iOS has fetched the IPA (serveAndOpen ends it)
            if job.cancelled {
                try? FileManager.default.removeItem(at: k.output)
                if let m = k.mine { try? FileManager.default.removeItem(at: m) } // F380
                job.end()
                return Apt.reply(c, nil, SignBridge.text(SignJob.cancelledError))
            }
            // B337: This iPhone's install deletes the IPA it is given, and its failure offers the Signing Server
            // Fallback, which opens the same token again (screens/apprun.js offerServer, run.installAgain): a hard
            // link of the kept IPA goes back into `kept` on a failure that wasn't a cancel, forgotten after `life`
            let spare = servers.local ? spareLink(k.output) : nil
            let keepAgain = { () -> Bool in
                guard let s = spare else { return false }
                guard !job.cancelled, FileManager.default.fileExists(atPath: s.path) else {
                    try? FileManager.default.removeItem(at: s)
                    return false
                }
                kept[tok] = Kept(output: s, app: k.app, record: k.record, mine: k.mine) // F380: still to be saved
                SignBridge.queue.asyncAfter(deadline: .now() + life) { _ = forget(tok) }
                return true
            }
            let opened = { (r: Result<(SignedApp, SignedRecord), Error>) in
                switch r {
                case .failure(let e):
                    job.end()
                    SignBridge.queue.async {
                        if !keepAgain() {
                            Sideload.dropOriginal(k.app.bundleID, sha256: k.record.sha256) // F343
                            if let m = k.mine { try? FileManager.default.removeItem(at: m) } // F380: not installed, not saved
                        }
                    }
                    Apt.reply(c, nil, job.cancelled ? SignBridge.text(SignJob.cancelledError) : (e as? Sideload.Failed)?.text ?? SignBridge.text(e))
                case .success(let (app, rec)):
                    if let s = spare { try? FileManager.default.removeItem(at: s) } // B337: nothing opens it again
                    var j: [String: Any] = ["bundleId": app.bundleID, "originalBundleId": app.originalBundleID, "name": app.name,
                                            "version": app.version, "removed": app.removed, "fixedArm64e": app.fixedArm64e]
                    if let x = rec.expires { j["expires"] = ISO8601DateFormatter().string(from: x) }
                    if servers.local { j["installed"] = true } // B111: installd has it, no iOS prompt to wait for
                    guard let m = k.mine, let u = URL(string: k.record.url) else { return Apt.reply(c, j, nil) }
                    // F380: the held download into My IPAs, so the page's save doesn't download it again
                    let answer = j
                    SignBridge.queue.async {
                        var out = answer
                        if let f = MyIPAs.keepDownload(m, url: u, log: log) { out["libraryFile"] = f }
                        Apt.reply(c, out, nil)
                    }
                }
            }
            if servers.local {
                // B111: {phase: "copying" | "installing", progress} as installHere goes (the run's row and bar)
                let throttle = Throttle()
                let step = { (phase: String, p: Double) in
                    if throttle.pass(phase, p) { c.emitOnMain([["phase": phase, "progress": p]]) }
                }
                Sideload.installHere(k.output, app: k.app, record: k.record, emit: nil, log: log, job: job, opened: opened, served: nil, step: step)
                return
            }
            if let host = servers.host {
                log("Uploading to \(host)/sign/host (\(k.app.name) replaces this app, so iOS installs it from the server)")
                Sideload.hostAndOpen(k.output, server: host, app: k.app, record: k.record, job: job, opened: opened, served: nil)
                return
            }
            Sideload.serveAndOpen(k.output, server: servers.manifest, app: k.app, record: k.record, log: log, job: job, opened: opened, served: nil)
        }
    }
}
