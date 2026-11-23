// F374: Installed Apps (jailbreak build), the bridge for web/app/screens/userapps.js. The list itself is the helper's
// `user-apps` (backend-native.js userApps); this file adds what needs the shell:
//
//   apps.icon {bundleId}            -> {png: base64 | null}   the Home Screen icon (UIKit's own, 60 pt)
//   library.decrypt {bundleId, stream}   ifizbox-helper decrypt-app, then the IPA zipped into My IPAs
//                                   stream: {fd: "out" | "err" | "status", line} as helper.run's (the packing's
//                                   progress as pmstatus lines too) -> {file, name, version, left: [path], ipas}
//   library.addTweaks {file, tweaks}     a copy of a library IPA with the tweaks in -> {file, injected, ipas}
//   library.share {file}            the share sheet (Save to Files, AirDrop...) for a library IPA itself -> {shared}
//
// Decrypt: the helper writes only the decrypted Mach-O files (HELPER_DECRYPT_DIR/<id>/<path in the .app>); the rest
// of the .app is read where installd put it (bundles are readable by mobile) and zipped with them
// (native/sign/DecryptedIPA.swift: SC_Info/ and extensions still encrypted left out). iTunesMetadata.plist, beside the
// .app with the Apple ID's details, is never in it. The jailbreak's install-ipa signs a library IPA again (ldid) when
// it is installed, so no signature is kept or made here.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import UIKit

enum InstalledApps {
    static let dropDir = "/var/mobile/Library/Caches/com.ryha.ifizbox/decrypt" // = native/helper/decrypt.h HELPER_DECRYPT_DIR
    static let queue = DispatchQueue(label: "ifizbox.installedapps", qos: .userInitiated)

    static func register(_ b: Bridge) {
        b.on("apps.icon") { c in icon(c) }
        b.on("library.decrypt") { c in decrypt(c) }
        b.on("library.addTweaks") { c in addTweaks(c) }
        b.on("library.share") { c in share(c) }
    }

    static func jailbreakOnly(_ c: Bridge.Call) -> Bool {
        guard AppMode.current == .jailbreak else { Apt.reply(c, nil, "sideload: Installed Apps is the jailbreak app's"); return false }
        return true
    }

    // ---- icons

    typealias IconFn = @convention(c) (AnyClass, Selector, NSString, Int32, CGFloat) -> UIImage?

    static func icon(_ c: Bridge.Call) {
        guard let id = c.params["bundleId"] as? String, !id.isEmpty else { return Apt.reply(c, nil, "bad_request: no bundleId") }
        DispatchQueue.main.async {
            let sel = NSSelectorFromString("_applicationIconImageForBundleIdentifier:format:scale:")
            var png: String?
            if let m = class_getClassMethod(UIImage.self, sel) {
                let f = unsafeBitCast(method_getImplementation(m), to: IconFn.self)
                // format 2: the Home Screen's 60 pt icon, already masked
                if let img = f(UIImage.self, sel, id as NSString, 2, UIScreen.main.scale), let d = img.pngData() {
                    png = d.base64EncodedString()
                }
            }
            c.reply(["png": png as Any], nil)
        }
    }

    // ---- decrypt

    static func decrypt(_ c: Bridge.Call) {
        guard jailbreakOnly(c) else { return }
        guard let id = c.params["bundleId"] as? String, !id.isEmpty, !id.contains("/"), !id.hasPrefix(".") else {
            return Apt.reply(c, nil, "bad_request: no bundleId")
        }
        let stream = (c.params["stream"] as? Bool) ?? false
        let emit: ([[String: Any]]) -> Void = { if stream { c.emitOnMain($0) } }
        let say: (String) -> Void = { emit([["fd": "out", "line": $0]]) }
        queue.async {
            let drop = URL(fileURLWithPath: dropDir).appendingPathComponent(id, isDirectory: true)
            defer { try? FileManager.default.removeItem(at: drop) }
            do {
                try FileManager.default.createDirectory(atPath: dropDir, withIntermediateDirectories: true)
                try? FileManager.default.removeItem(at: drop) // an earlier run's, cut short
                let r = try Helper.run(["decrypt-app", id], emit: emit)
                guard (r["code"] as? Int) == 0 else {
                    let why = lastHelperLine(r["stderr"] as? String ?? "") ?? "ifizbox-helper exited \(r["code"] ?? "?")"
                    throw SignError("decrypt", why)
                }
                let d = try DecryptedIPA.parse(r["stdout"] as? String ?? "")
                if let f = DecryptedIPA.blocking(d.left).first {
                    throw SignError("decrypt", "\(f) stayed encrypted (FairPlay refused it), so the app couldn't run from this IPA.")
                }
                let plist = NSDictionary(contentsOf: d.app.appendingPathComponent("Info.plist")) as? [String: Any] ?? [:]
                let name = plist["CFBundleDisplayName"] as? String ?? plist["CFBundleName"] as? String ?? d.app.deletingPathExtension().lastPathComponent
                let version = plist["CFBundleShortVersionString"] as? String ?? plist["CFBundleVersion"] as? String ?? ""
                let wanted = [name, version].filter { !$0.isEmpty }.joined(separator: " ") + " (decrypted)"
                let tmp = MyIPAs.library.root.appendingPathComponent(".decrypt-\(SignBridge.token()).ipa")
                defer { try? FileManager.default.removeItem(at: tmp) }
                say("Packing \(IPALibrary.safeName(wanted))")
                let started = Date()
                var shown = -1
                try DecryptedIPA.pack(app: d.app, decrypted: drop, left: d.left, to: tmp, say: say) { f in
                    let pct = Int(f * 100)
                    guard pct != shown else { return }
                    shown = pct
                    emit([["fd": "status", "line": "pmstatus:\(id):\(pct):Packing the IPA"]])
                }
                let file = try MyIPAs.library.add(tmp, name: wanted, move: true)
                say(String(format: "Added %@ to My IPAs (%.1f s)", file, Date().timeIntervalSince(started)))
                var reply = MyIPAs.list()
                reply["file"] = file
                reply["name"] = name
                reply["version"] = version
                reply["left"] = d.left
                Apt.reply(c, reply, nil)
            } catch let e as BridgeError { Apt.reply(c, nil, e.text) }
            catch { Apt.reply(c, nil, SignBridge.text(error)) }
        }
    }

    static func lastHelperLine(_ err: String) -> String? {
        err.split(separator: "\n").last { $0.hasPrefix("ifizbox-helper: ") }.map { String($0.dropFirst(16)) }
    }

    // ---- Build IPA with Tweaks (the Inject Tweaks group's tweaks, prepared by the page)

    static func addTweaks(_ c: Bridge.Call) {
        guard jailbreakOnly(c) else { return }
        let file = c.params["file"] as? String ?? ""
        queue.async {
            do {
                guard let t = try TweakSet(json: c.params["tweaks"]) else { throw SignError("bad_options", "No tweaks to add.") }
                let src = try MyIPAs.library.url(file)
                let tmp = MyIPAs.library.root.appendingPathComponent(".tweaks-\(SignBridge.token()).ipa")
                defer { try? FileManager.default.removeItem(at: tmp) }
                let injected = try DecryptedIPA.withTweaks(src, t, to: tmp)
                let out = try MyIPAs.library.add(tmp, name: DecryptedIPA.tweakedName(file), move: true)
                var reply = MyIPAs.list()
                reply["file"] = out
                reply["injected"] = injected
                Apt.reply(c, reply, nil)
            } catch { Apt.reply(c, nil, SignBridge.text(error)) }
        }
    }

    // ---- Share

    static func share(_ c: Bridge.Call) {
        guard jailbreakOnly(c) else { return }
        let file = c.params["file"] as? String ?? ""
        let src: URL
        do { src = try MyIPAs.library.url(file) } catch { return Apt.reply(c, nil, SignBridge.text(error)) }
        DispatchQueue.main.async {
            guard let top = MyIPAs.topController() else { return c.reply(nil, "internal: no window to show the share sheet in") }
            let vc = UIActivityViewController(activityItems: [src], applicationActivities: nil)
            vc.completionWithItemsHandler = { _, done, _, _ in c.reply(["shared": done], nil) }
            if let pop = vc.popoverPresentationController {
                pop.sourceView = top.view
                pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY, width: 1, height: 1)
            }
            top.present(vc, animated: true)
        }
    }
}
