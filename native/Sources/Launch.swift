import UIKit
import ImageIO

// B203: the splash never shows another theme (docs/native.md, "Launch screen"). native/launch/make.py ships every
// theme's empty frame in the bundle as LaunchThemes/<key>/ (that theme's launch images and a LaunchScreen.storyboardc
// with its colours), keyed by Settings' palette values.
//
// - Jailbreak build: iOS draws the splash from the bundle's own launch files at every launch (the iPhone 7 keeps no
//   SplashBoard snapshot for it), so on a theme change the root helper copies the theme's set over them
//   (ifizbox-helper launch-theme, native/helper/launch.h) and the next launch opens on that theme. A .deb upgrade
//   puts Classic's back; the check at the page's first app.theme puts the theme's back.
//   F330: only on iOS 15; from iOS 16 the jailbreak build writes the theme into its SplashBoard snapshots (Snapshot).
// - Sideload IPA: its signed bundle can't change, so its splash is neutral (Info-sideload.plist: an empty
//   UILaunchScreen, iOS's own background with no bars) and nothing is copied. F330: once the app has run, it writes
//   the theme's frame into its SplashBoard snapshots (Snapshot), so later launches open on the theme.
// - Both: the in-app cover (WebController.showCover) is the theme's frame, loaded from LaunchThemes/<key>/ as a
//   bundle of its own, so the hand-over to the page shows the right bars whatever the splash was.
//
// Automatic follows the page's resolved theme at the last change: an iPhone that switches appearance while the app
// isn't running opens once on the other tone's frame (the jailbreak splash is one set of files, not two).
enum Splash {
    static let themesDir = "LaunchThemes"
    static let viewNib = "LaunchScreen.storyboardc/Lvc-00-000-view-Lrt-00-000.nib"
    // What the helper copies (launch.h's helper_launch_files; native/test_launch_grounds.py keeps them in step).
    static let files: [String] = ["LaunchStripes", "LaunchNavTop", "LaunchNavBottom", "LaunchTabGloss",
                                  "LaunchNavShadow", "LaunchTabShadow", "LaunchStatusStrip"].flatMap { ["\($0)@2x.png", "\($0)@3x.png"] }
                                 + [viewNib]
    private static let queue = DispatchQueue(label: "ifizbox.splash")

    static func dir(_ key: String) -> String { Bundle.main.bundlePath + "/\(themesDir)/\(key)" }

    // The theme a tone and its palettes open on; nil when this build has no set for it (a newer page's palette):
    // then nothing is copied and there is no cover, never another theme's frame.
    static func key(dark: Bool, palette: String, lightPalette: String) -> String? {
        let k = dark ? palette : lightPalette
        let ok = !k.isEmpty && k.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) }
        return ok && FileManager.default.fileExists(atPath: dir(k) + "/" + viewNib) ? k : nil
    }

    // The key this launch opens on: Theme.saved as Theme.launchGround reads it.
    static func launchKey(systemDark: Bool) -> String? {
        let s = Theme.saved
        return key(dark: s.style == "dark" || (s.style == "auto" && systemDark), palette: s.darkPalette,
                   lightPalette: s.lightPalette)
    }

    // B180's cover in the theme's colours: LaunchThemes/<key>/LaunchScreen.storyboardc with its own images. nil when
    // that set is missing (then the window's ground shows until the page draws), never another theme's bars.
    static func cover(systemDark: Bool) -> UIView? {
        guard let k = launchKey(systemDark: systemDark), let b = Bundle(path: dir(k)),
              b.path(forResource: "LaunchScreen", ofType: "storyboardc") != nil,
              let v = UIStoryboard(name: "LaunchScreen", bundle: b).instantiateInitialViewController()?.view
        else { return nil }
        v.isUserInteractionEnabled = false
        return v
    }

    // Theme.apply's: make the next launch open on this theme. Jailbreak build only; off the main thread, one at a
    // time, and only when the bundle's files aren't that theme's already (a byte compare of 13 small files).
    // F330: the IPA, and the jailbreak build on iOS 16+, write the theme's frame into this app's SplashBoard snapshots
    // instead (Snapshot.follow); only the jailbreak build on iOS 15 copies the bundle's files.
    static func follow(dark: Bool, palette: String, lightPalette: String) {
        if Snapshot.used {
            Snapshot.follow(systemDark: UIScreen.main.traitCollection.userInterfaceStyle == .dark)
            return
        }
        guard AppMode.current == .jailbreak else { return }
        guard let k = key(dark: dark, palette: palette, lightPalette: lightPalette) else { return }
        queue.async {
            guard !installed(k) else { return }
            do {
                let out = try Helper.run(["launch-theme", k], emit: nil)
                if out["code"] as? Int == 0 {
                    clearSnapshots()
                } else {
                    NSLog("\(Brand.name): launch-theme \(k) failed: \(out["stderr"] as? String ?? "")")
                }
            } catch {
                NSLog("\(Brand.name): launch-theme \(k): \(error)")
            }
        }
    }

    static func installed(_ key: String) -> Bool {
        let fm = FileManager.default
        let root = Bundle.main.bundlePath, src = dir(key)
        return files.allSatisfy { f in
            guard let a = fm.contents(atPath: root + "/" + f), let b = fm.contents(atPath: src + "/" + f) else { return false }
            return a == b
        }
    }

    // A cached splash would keep the old theme: drop this app's own SplashBoard snapshots, if iOS keeps any (an app
    // with a container: Library/SplashBoard/Snapshots/sceneID:<id>-default; a jailbreak app shares mobile's Library,
    // so only the entries named for this bundle ID, never the folder). The iPhone 7 (iOS 15) keeps none for the
    // jailbreak app; newer iOS may.
    static func clearSnapshots() {
        guard let id = Bundle.main.bundleIdentifier else { return }
        let dir = NSHomeDirectory() + "/Library/SplashBoard/Snapshots"
        let fm = FileManager.default
        for name in (try? fm.contentsOfDirectory(atPath: dir)) ?? []
        where name == id || name.hasPrefix("sceneID:\(id)-") || name.hasPrefix("\(id) - ") {
            try? fm.removeItem(atPath: dir + "/" + name)
        }
    }
}

// F330: the next launch's splash in the theme, by writing this app's own SplashBoard snapshots (R46,
// journal/2026-11-20-b203-themed-splash/sim-notes.md). iOS 13+ draws an app's splash from the snapshots it keeps in
// Library/SplashBoard/Snapshots/<bundle ID> - {DEFAULT GROUP}/*.ktx (one per appearance; Apple's ATX texture format,
// full screen at the screen's scale, no status bar), and SpringBoard reads them again at every launch. Writing the
// theme's frame over them (Splash's LaunchThemes/<key>/ storyboard, rendered as the cover draws it, ImageIO's
// com.apple.atx) shows that theme on the next launch, in the same boot. A bundle copy on iOS 26 instead gets the app
// denylisted (black splash) or waits for a respring.
//
// - Which file is light and which dark SplashBoard doesn't say. A file iOS wrote itself is classified by its pixels:
//   the IPA's neutral splash is plain white (light) or plain black (dark). The tone is remembered per file
//   (UserDefaults ifizbox.splashSnapshots, with the file's size and date as written), so it holds once the file is
//   ours. A file whose tone can't be told (the jailbreak build's Classic frame, an unreadable file) gets the theme of
//   the iPhone's appearance now, and again at every later change; for a fixed Light or Dark both tones are the same
//   theme anyway.
// - Nothing is written when the file already holds that theme (same key, size and date as recorded), so the page's
//   app.theme at every launch costs a directory listing. A file iOS rewrote (an install, an update, a reaped
//   snapshot) is classified and written again: the first launch after those shows iOS's own splash.
// - A file whose pixel size isn't the render's (another orientation) is left alone; so is everything when ImageIO
//   can't write com.apple.atx or the theme has no set (Splash.key: never another theme's frame).
enum Snapshot {
    // The IPA on every iOS; the jailbreak build from iOS 16 (on iOS 15 it keeps no snapshot and the bundle copy works).
    static var used: Bool {
        if AppMode.current == .sideload { return true }
        if #available(iOS 16, *) { return true }
        return false
    }

    static let recordKey = "ifizbox.splashSnapshots"
    static let atx = "com.apple.atx"
    private static let queue = DispatchQueue(label: "ifizbox.splash.snapshot")

    // Splash.follow's, on the main thread after Theme.apply saved the theme: the theme each tone now opens on.
    static func follow(systemDark: Bool) {
        let s = Theme.saved
        let now = systemDark ? "dark" : "light"
        func want(_ tone: String) -> String? {
            let dark = s.style == "dark" || (s.style == "auto" && (tone.isEmpty ? now : tone) == "dark")
            return Splash.key(dark: dark, palette: s.darkPalette, lightPalette: s.lightPalette)
        }
        queue.async {
            guard ((CGImageDestinationCopyTypeIdentifiers() as? [String]) ?? []).contains(atx) else { return }
            let rec = record()
            var jobs: [(path: String, key: String, tone: String)] = []
            for p in files() {
                let tone: String
                if let r = rec[p], r["stamp"] as? String == stamp(p) {
                    tone = r["tone"] as? String ?? ""
                    if let k = want(tone), k == r["key"] as? String { continue }
                } else {
                    tone = classify(p)
                }
                if let k = want(tone) { jobs.append((p, k, tone)) }
            }
            guard !jobs.isEmpty else { return }
            DispatchQueue.main.async {
                var images: [String: CGImage] = [:]
                for k in Set(jobs.map { $0.key }) { images[k] = render(k) }
                queue.async { write(jobs, images) }
            }
        }
    }

    // This app's launch snapshots: the *.ktx under "<bundle ID> - {DEFAULT GROUP}" (SplashBoard's launch group, its
    // GeneratedDefault images; a jailbreak app shares mobile's Library, so never another app's). Not
    // "sceneID:<id>-default": that holds the app switcher's pictures of the last screen (SceneContent), which iOS
    // replaces and reaps on its own (seen on the iPhone 15 Pro, iOS 27).
    static func files() -> [String] {
        guard let id = Bundle.main.bundleIdentifier else { return [] }
        let root = NSHomeDirectory() + "/Library/SplashBoard/Snapshots"
        let fm = FileManager.default
        var out: [String] = []
        for name in (try? fm.contentsOfDirectory(atPath: root)) ?? [] where name.hasPrefix("\(id) - ") {
            for p in (fm.enumerator(atPath: root + "/" + name)?.allObjects as? [String]) ?? [] where p.hasSuffix(".ktx") {
                out.append(root + "/" + name + "/" + p)
            }
        }
        return out.sorted()
    }

    // Path -> {tone, key, stamp} of the files this app wrote.
    static func record() -> [String: [String: Any]] {
        UserDefaults.standard.dictionary(forKey: recordKey) as? [String: [String: Any]] ?? [:]
    }

    // Size and modification date: a file iOS rewrote no longer matches what was recorded.
    static func stamp(_ p: String) -> String {
        guard let a = try? FileManager.default.attributesOfItem(atPath: p) else { return "" }
        let size = (a[.size] as? NSNumber)?.int64Value ?? -1
        let date = (a[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        return "\(size):\(date)"
    }

    // A snapshot iOS drew: "light" for a plain white frame, "dark" for a plain black one, "" for anything else (bars,
    // pinstripes) or a file ImageIO can't read.
    static func classify(_ p: String) -> String {
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: p) as CFURL, nil),
              let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return "" }
        let n = 8
        var px = [UInt8](repeating: 0, count: n * n * 4)
        let drawn: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(img, in: CGRect(x: 0, y: 0, width: n, height: n))
            return true
        }
        guard drawn else { return "" }
        let luma = (0..<(n * n)).map { i in
            (0.299 * Double(px[i * 4]) + 0.587 * Double(px[i * 4 + 1]) + 0.114 * Double(px[i * 4 + 2])) / 255
        }
        let lo = luma.min() ?? 0, hi = luma.max() ?? 1
        guard hi - lo < 0.08 else { return "" }
        return lo > 0.9 ? "light" : hi < 0.1 ? "dark" : ""
    }

    // The theme's frame as the cover draws it, at the screen's scale: LaunchThemes/<key>/'s storyboard laid out on the
    // app's window (its safe areas), under everything, and taken off again before the frame is committed, so it never
    // shows. Main thread.
    static func render(_ key: String) -> CGImage? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
        guard let w = windows.first(where: { $0.isKeyWindow }) ?? windows.first, w.bounds.width > 0,
              let b = Bundle(path: Splash.dir(key)),
              let vc = UIStoryboard(name: "LaunchScreen", bundle: b).instantiateInitialViewController(),
              let v = vc.view else { return nil }
        v.frame = w.bounds
        v.isUserInteractionEnabled = false
        w.insertSubview(v, at: 0)
        defer { v.removeFromSuperview() }
        v.setNeedsLayout()
        v.layoutIfNeeded()
        let f = UIGraphicsImageRendererFormat()
        f.scale = UIScreen.main.scale
        f.opaque = true
        return UIGraphicsImageRenderer(bounds: v.bounds, format: f).image { v.layer.render(in: $0.cgContext) }.cgImage
    }

    static func write(_ jobs: [(path: String, key: String, tone: String)], _ images: [String: CGImage]) {
        var rec = record()
        let live = Set(files())
        for p in rec.keys where !live.contains(p) { rec[p] = nil } // snapshots iOS dropped
        for j in jobs {
            guard let img = images[j.key] else { continue }
            let url = URL(fileURLWithPath: j.path) as CFURL
            if let src = CGImageSourceCreateWithURL(url, nil),
               let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
               let pw = props[kCGImagePropertyPixelWidth] as? Int, let ph = props[kCGImagePropertyPixelHeight] as? Int,
               pw != img.width || ph != img.height {
                NSLog("\(Brand.name): splash snapshot \(j.path): \(pw)x\(ph), not \(img.width)x\(img.height); left alone")
                continue
            }
            guard let d = CGImageDestinationCreateWithURL(url, atx as CFString, 1, nil) else { continue }
            CGImageDestinationAddImage(d, img, nil)
            let ok = CGImageDestinationFinalize(d)
            NSLog("\(Brand.name): splash snapshot \((j.path as NSString).lastPathComponent): \(j.key) (\(j.tone.isEmpty ? "tone unknown" : j.tone))\(ok ? "" : " failed")")
            rec[j.path] = ok ? ["tone": j.tone, "key": j.key, "stamp": stamp(j.path)] : nil
        }
        UserDefaults.standard.set(rec, forKey: recordKey)
    }
}
