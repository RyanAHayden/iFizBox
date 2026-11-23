// iFizBox's jailbreak shell: one window, one WKWebView showing web/app/ from the bundle (docs/native.md, R3 (a)).
// Navigation, push/pop and the edge swipe back are web/app/'s own JS stack; the shell adds nothing on top.
import UIKit
import WebKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        application.applicationSupportsShakeToEdit = false // no "Undo Typing" alert on an accidental shake
        Notifications.shared.start() // F65: permission for N5's daemon, and notification taps (Notifications.swift)
        // The new iFizBox is open: the "iFizBox Updated, tap to open" notices have done their job.
        // and one still waiting to arrive (it's sent 8 s after the old iFizBox closed) never comes once this one is open
        let notices = ["ifizbox.updating", "ifizbox.updated"]
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: notices)
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: notices)
        SignBridge.importBundled() // F75: the certificate the website put inside iFizBox's own IPA (bring, F93)
        BackgroundCheck.register() // I3: before launch ends, as BGTaskScheduler requires (sideload build)
        return true
    }

    // F280: the APNs device token push.register waits for (Notifications.swift Push).
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Push.received(deviceToken, nil)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Push.received(nil, error)
    }

    // B166: iOS only calls this when the app runs without scenes (Info.plist's UIApplicationSceneManifest missing);
    // with the manifest, URLs come through SceneDelegate. Kept so a build without one still takes files and links.
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        OpenLog.hop("AppDelegate open URL: \(OpenLog.url(url)) (open in place: \(options[.openInPlace] as? Bool ?? false))")
        Incoming.receive(url)
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: "Default", sessionRole: session.role)
        c.delegateClass = SceneDelegate.self
        return c
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        // N10: the pinstripes, not black, behind everything: nothing dark shows between the launch screen and the page.
        // F198: unless the page last said dark: then its palette's ground (black for OLED Black), so a dark launch
        // shows no light or grey before the page paints.
        let ground = Theme.launchGround(systemDark: ws.traitCollection.userInterfaceStyle == .dark)
        w.backgroundColor = ground.pattern
        w.rootViewController = WebController()
        // The style the page last asked for (Settings > Appearance, Light by default and until the page has said):
        // Automatic lets the window follow iOS, dark included (Theme.apply). Info.plist has no UIUserInterfaceStyle,
        // which would pin it to light.
        w.overrideUserInterfaceStyle = Theme.style(Theme.saved.style)
        w.makeKeyAndVisible()
        window = w
        (w.rootViewController as? WebController)?.showCover(in: w) // B180: the launch screen until the page draws
        // F75: launched by a ifizbox:// link; B166: or a file another app handed over (Open in iFizBox). Every one,
        // logged (OpenLog), and a launch with none says so too: the trail then shows whether iOS handed anything over.
        OpenLog.scene("launched: \(options.urlContexts.count) URL(s), \(options.userActivities.count) activity(ies)\(options.sourceApplication.map { ", from \($0)" } ?? "")")
        for c in options.urlContexts {
            OpenLog.hop("SceneDelegate willConnectTo: \(OpenLog.url(c.url)) (open in place: \(c.options.openInPlace), from \(c.options.sourceApplication ?? "?"))")
            Incoming.receive(c.url)
        }
        if let item = options.shortcutItem { Shortcut.perform(item.type) } // launched from the icon's Upgrade All
        Replaced.watch()
    }

    // F75: a ifizbox:// link while iFizBox runs (Open in iFizBox App and Open in iFizBox on the website).
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        Shortcut.perform(shortcutItem.type)
        completionHandler(true)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for c in URLContexts {
            OpenLog.hop("SceneDelegate openURLContexts: \(OpenLog.url(c.url)) (open in place: \(c.options.openInPlace), from \(c.options.sourceApplication ?? "?"))")
            Incoming.receive(c.url)
        }
    }

    // B166: context for the trail: iFizBox came forward (a hand-off that never arrives shows as this line alone).
    func sceneWillEnterForeground(_ scene: UIScene) { OpenLog.scene("came forward") }

    // B166: a hand-off as a user activity (none expected for files; logged so a report would show one).
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        OpenLog.hop("SceneDelegate continue: activity \(userActivity.activityType)\(userActivity.webpageURL.map { " " + OpenLog.url($0) } ?? "")")
    }
}

// F75: ifizbox://import?d=…, ifizbox://install?url=… (F89) and the rest of IncomingLink's hosts for the page (web/app/incoming.js). The shell keeps the
// latest one and tells the page there is one ("ifizbox:url" on window); the page takes it with app.takeURL, also
// once at start, so a link that launched iFizBox before the page loaded isn't lost. Only IncomingLink's hosts pass.
//   app.takeURL            -> {url} | null (and forgets it)
//   app.gunzip {data}      base64 gzip -> {text}: ifizbox://import's payload where WebKit has no DecompressionStream
enum Incoming {
    private static var pending: String?

    static func receive(_ url: URL) {
        OpenLog.hop("Incoming: \(OpenLog.url(url))")
        if LocalVPN.receive(url) { return } // F372: Shortcuts coming back from a Cellular Shortcut's run
        if SharedInbox.receive(url) { return } // N9: shared .ipa/.deb files and the share extension's links
        if MyIPAs.receive(url) { return } // F77: an .ipa file goes into My IPAs, which then sends ifizbox://myipas
        if url.isFileURL {
            // B166: a file nothing above took: say so, never silence.
            OpenLog.hop("Incoming: error: no handler for the file \(url.lastPathComponent)")
            return SharedInbox.refuse(OpenTrail.unhandled(url.lastPathComponent))
        }
        guard IncomingLink.accepts(url) || OtherLink.accepts(url) else { // F83: other sideloaders' links too
            OpenLog.hop("Incoming: error: not a link \(Brand.name) takes; dropped")
            return openLogReady()
        }
        pending = url.absoluteString
        OpenLog.hop("Incoming: waiting for the page to take it")
        notify(tries: 50)
    }

    // B166: a hand-off ended without a link for the page: tell it to take the trail (app.takeOpenLog) now.
    static func openLogReady() {
        DispatchQueue.main.async {
            let web = UIApplication.shared.connectedScenes
                .compactMap { (($0 as? UIWindowScene)?.windows.first?.rootViewController as? WebController)?.webView }.first
            guard let web, !web.isLoading, web.url != nil else { return } // the page takes it at start
            web.callAsyncJavaScript("window.dispatchEvent(new Event('ifizbox:openlog'))", arguments: [:], in: nil, in: .page,
                                    completionHandler: nil)
        }
    }

    // The page's hash-style wake-up, as Notifications.open does: wait for the web view to finish loading.
    private static func notify(tries: Int) {
        let web = UIApplication.shared.connectedScenes
            .compactMap { (($0 as? UIWindowScene)?.windows.first?.rootViewController as? WebController)?.webView }.first
        guard let web, !web.isLoading, web.url != nil else {
            if tries > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { notify(tries: tries - 1) } }
            else {
                // B174: the page may have started (and taken nothing) while the file was still being copied, so
                // "it takes the link when it starts" can be never: keep asking, every second, while the link waits.
                OpenLog.hop("Incoming: the page wasn't ready in 10 s; still trying while the link waits")
                slowNotify(left: 120)
            }
            return
        }
        web.callAsyncJavaScript("window.dispatchEvent(new Event('ifizbox:url'))", arguments: [:], in: nil, in: .page,
                                completionHandler: nil)
    }

    // B174: after notify's 10 s: once a second until the page took the link (pending gone) or left more than 2 minutes.
    private static func slowNotify(left: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            guard pending != nil else { return }
            let web = UIApplication.shared.connectedScenes
                .compactMap { (($0 as? UIWindowScene)?.windows.first?.rootViewController as? WebController)?.webView }.first
            guard let web, !web.isLoading, web.url != nil else {
                if left > 0 { slowNotify(left: left - 1) }
                else { OpenLog.hop("Incoming: error: the page never took the link") }
                return
            }
            OpenLog.hop("Incoming: the page is ready; telling it")
            web.callAsyncJavaScript("window.dispatchEvent(new Event('ifizbox:url'))", arguments: [:], in: nil, in: .page,
                                    completionHandler: nil)
        }
    }

    // B163: a handed-over file being copied in (SharedInbox.keep): "ifizbox:receiving" on window with {name, progress}
    // (0...1) for the page's "Copying" HUD (web/app/incoming.js), and progress null once it's done or failed. Any
    // thread; nothing when the page isn't there yet (the HUD is a nicety, the link that follows is what counts).
    static func receiving(_ name: String, progress: Double?) {
        DispatchQueue.main.async {
            let web = UIApplication.shared.connectedScenes
                .compactMap { (($0 as? UIWindowScene)?.windows.first?.rootViewController as? WebController)?.webView }.first
            guard let web, !web.isLoading, web.url != nil else { return }
            let p: Any = progress ?? NSNull()
            web.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('ifizbox:receiving', { detail: { name, progress } }))",
                                    arguments: ["name": name, "progress": p], in: nil, in: .page, completionHandler: nil)
        }
    }

    static func register(_ b: Bridge) {
        b.on("app.takeURL") { c in
            DispatchQueue.main.async {
                let u = pending
                pending = nil
                if let u, let url = URL(string: u) { OpenLog.hop("Incoming: the page took \(OpenLog.url(url))") }
                c.reply(u.map { ["url": $0] }, nil)
            }
        }
        // B166: the hand-off trail for Settings > Console Logs (web/app/incoming.js openLog).
        b.on("app.takeOpenLog") { c in
            Apt.work(c) { ["lines": OpenLog.trail.take()] } // not SharedInbox.queue: a big copy holds that one
        }
        b.on("app.gunzip") { c in
            guard let d = (c.params["data"] as? String).flatMap({ Data(base64Encoded: $0) }) else {
                return c.reply(nil, "bad_request: data")
            }
            do { c.reply(["text": String(decoding: try gunzip(d), as: UTF8.self)], nil) } catch {
                c.reply(nil, "bad_data: \(error)")
            }
        }
    }
}

// F83: other sideloaders' schemes, claimed by the sideload build (native/Info-sideload.plist; the jailbreak build
// claims none, so it never gets them). The page decides what each becomes, and whether Settings > Sideloading > Open
// Other Apps' Links lets iFizBox take it (web/app/core/otherlinks.js OTHER_SCHEMES holds the same list; a test checks).
enum OtherLink {
    static let schemes: Set<String> = ["altstore", "altstore-classic", "sidestore", "feather", "ksign", "esign", "scarlet",
                                       "gbox", "trollapps", "stikstore"]
    static let maxLength = 8192

    static func accepts(_ url: URL) -> Bool {
        guard let s = url.scheme?.lowercased(), schemes.contains(s) else { return false }
        return url.absoluteString.utf8.count <= maxLength
    }
}

final class WebController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let bridge = Bridge()
    private lazy var web = Web.make(bridge: bridge)
    private var cover: UIView?
    var webView: WKWebView { web }

    // F369: the root view holds the web view (full size) rather than being it, so the iOS 26 glass bars can put the
    // web view inside their UITabBarController's tab (NativeGlass.swift) and give it back. Clear: the window's ground
    // shows behind the page's edges as before.
    override func loadView() {
        let root = UIView()
        root.backgroundColor = .clear
        web.frame = root.bounds
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.addSubview(web)
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        web.navigationDelegate = self
        web.uiDelegate = self // B8: window.open goes out of the app (LinkOut)
        if let top = TopInset.now(UIApplication.shared.connectedScenes.first as? UIWindowScene) {
            sentTop = top
            web.configuration.userContentController.addUserScript(WKUserScript(
                source: TopInset.script(top), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        }
        web.load(URLRequest(url: AppScheme.url("index.html")))
    }

    // The nav bar's top (TopInset) follows rotation and status bar changes.
    private var sentTop: CGFloat?
    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        sendTop()
    }
    private func sendTop(force: Bool = false) {
        guard let top = TopInset.now(view.window?.windowScene), force || top != sentTop else { return }
        sentTop = top
        web.evaluateJavaScript(TopInset.script(top))
    }

    // B180: the launch screen (Launch.cover) on the window, over the web view, until the page has drawn #boot under
    // the same bars, so the hand-over from iOS's splash shows no jump and no bare pinstripes in between. On the
    // window, not in the web view: a WKWebView's subviews get no safe area, so the bars came out 44 pt and 0 pt there.
    func showCover(in window: UIWindow) {
        // B203: in the theme the page last set (Splash.cover), never another theme's bars
        guard cover == nil,
              let c = Splash.cover(systemDark: UIScreen.main.traitCollection.userInterfaceStyle == .dark) else { return }
        c.frame = window.bounds
        c.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(c)
        cover = c
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { dropCover() }
    // F287: a page that loads again (a reload, WebKit's content process restarting) holds no job yet; on commit,
    // before its scripts run, so a job the new page starts keeps its hold
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        KeepAwake.reset()
        sendTop(force: true) // a page loaded again: the document-start value may be from another orientation
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { dropCover() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        dropCover()
    }

    // B8 (docs/native.md, "Links out of the app"): iFizBox's own pages (ifizbox:, about:, blob:, data:) load in the
    // web view, and so does anything inside a subframe. Any other main-frame navigation (location.href to https,
    // itms-services, feather://, altstore://, cydia://, sileo://, a target=_blank link) goes to iOS and is cancelled,
    // so iFizBox's UI stays where it was. Going straight to iOS also means an itms-services install link shows only
    // iOS's "Install …?" prompt, not WebKit's "Open in iTunes?" first.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true // nil: a new window (target=_blank)
        if !mainFrame || LinkOut.staysInside(url) { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        if let url { LinkOut.open(url) }
    }

    // B8: window.open(url) has no second web view to open into: hand the URL to iOS and return nil (window.open
    // then returns null, as before, but the link opens).
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, !LinkOut.staysInside(url) { LinkOut.open(url) }
        return nil
    }

    // The load event has fired; give WebKit a moment to put #boot on screen, then fade out (opacity only).
    private func dropCover() {
        guard let c = cover else { return }
        cover = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            UIView.animate(withDuration: 0.2, animations: { c.alpha = 0 }, completion: { _ in c.removeFromSuperview() })
        }
    }

    // Light text: the iOS 6 era's status-bar strip is black in every theme (web/app/ios6.css), and the other eras'
    // bars are blue or dark too; B221: dark text on a light bar (iOS 7's White), as the page's app.theme says
    // (Theme.darkText).
    override var preferredStatusBarStyle: UIStatusBarStyle { Theme.darkText ? .darkContent : .lightContent }
}

// Where the nav bar starts, for the iOS 6 and iOS 26 eras (web/app/style.css --top-inset, from --status-bar-bottom on
// <html>; iOS 26's strip is the page's ground, its --site-strip):
// the bottom of iOS's status bar, with its black strip above the bar, when that leaves at least `margin` under the
// resting Dynamic Island (room for it to grow when touched, and for compact Live Activities); otherwise, and on
// every phone whose status bar is the safe area (notch, Home button), the safe area's top. iOS puts the safe area
// 32/3 pt under the resting island. On the iPhone 15 Pro the status bar ends at 54 pt and the island at 48.33, 5.67 pt
// apart, so the bar stays at the safe area (59 pt); a 16 Pro's island sits lower still.
enum TopInset {
    static let islandBelowSafe: CGFloat = 32.0 / 3
    static let margin: CGFloat = 6

    static func value(statusBar: CGFloat, safe: CGFloat) -> CGFloat {
        guard statusBar > 0, statusBar < safe else { return safe }
        return statusBar - (safe - islandBelowSafe) >= margin ? statusBar : safe
    }

    static func now(_ scene: UIWindowScene?) -> CGFloat? {
        guard let scene, let w = scene.windows.first else { return nil }
        let safe = w.safeAreaInsets.top
        let bar = scene.statusBarManager?.statusBarFrame.height ?? 0
        guard safe > 0 || scene.interfaceOrientation.isLandscape else { return nil } // not laid out yet
        return value(statusBar: bar, safe: safe)
    }

    static func script(_ top: CGFloat) -> String {
        "document.documentElement.style.setProperty('--status-bar-bottom', '\(top)px')"
    }
}

// F369: the app's web view. While the iOS 26 glass bars hold it inside their tab (NativeGlass.swift), UIKit adds the
// tab bar to its safe area; the page lays out with env(safe-area-inset-*) and draws its own room for the bar, so the
// glass bars pin its safe area to the screen's (pinnedSafeArea) and the page sees no change.
final class PageWebView: WKWebView {
    var pinnedSafeArea: UIEdgeInsets? {
        didSet { if pinnedSafeArea != oldValue { safeAreaInsetsDidChange() } }
    }
    override var safeAreaInsets: UIEdgeInsets { pinnedSafeArea ?? super.safeAreaInsets }
}

enum Web {
    static func make(bridge: Bridge) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.setURLSchemeHandler(AppScheme(), forURLScheme: AppScheme.scheme)
        c.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "ifizbox")
        Apt.installScript(c.userContentController) // ifizboxNative, before any page script (native/bridge.js)
        // The app's look where it differs from the website's, before first paint: in the iOS 7 and iOS 13 eras
        // ios6.css draws the nav bar's art through the status-bar strip here, and the iOS 6 era's nav bar starts at
        // TopInset's line. Both builds.
        c.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.setAttribute('data-shell', 'app')",
            injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        // WebKit holds requestAnimationFrame near 60 Hz by default on iOS; the JS edge swipe needs 120 (R3).
        WebKitFeature.set({ $0 == "PreferPageRenderingUpdatesNear60FPSEnabled" }, false, c.preferences)
        let w = PageWebView(frame: .zero, configuration: c)
        FocusKeyboard.enable() // F248: a focus from script brings up the keyboard too
        // Back is web/app/'s JS swipe; WebKit's history gesture would fight it.
        w.allowsBackForwardNavigationGestures = false
        w.allowsLinkPreview = false
        // N10: transparent until the page paints, over the window's pinstripes; the same behind the page's edges.
        w.isOpaque = false
        let systemDark = UIScreen.main.traitCollection.userInterfaceStyle == .dark
        Launch.paint(w, Theme.launchGround(systemDark: systemDark)) // F198: the dark palette's ground after a dark run
        // The page lays itself out with env(safe-area-inset-*) (viewport-fit=cover) and scrolls inside its own boxes.
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.scrollView.bounces = false
        if #available(iOS 16.4, *) { w.isInspectable = true }
        StatusBarTap.attach(to: w) // F167: a status bar tap scrolls the page on top to the top
        return w
    }
}

// B8: links out of the app. What loads inside the web view, and how the rest is handed to iOS.
enum LinkOut {
    // Schemes the web view keeps: the bundle (AppScheme) and the page's own documents and objects.
    static let inside: Set<String> = [AppScheme.scheme, "about", "blob", "data"]
    // Schemes never handed to iOS (app.openURL too): they would mean nothing outside, or reach the file system.
    static let never: Set<String> = inside.union(["javascript", "file"])

    static func staysInside(_ url: URL?) -> Bool {
        guard let s = url?.scheme?.lowercased() else { return true } // no URL, no scheme: nothing to open
        return inside.contains(s)
    }

    static func canOpen(_ url: URL) -> Bool {
        guard let s = url.scheme?.lowercased(), !s.isEmpty else { return false }
        return !never.contains(s)
    }

    // UIApplication.open: the app that claims an https link (a universal link: X, Discord, GitHub...), asked for
    // first so the link never stops in Safari when its app is there; then Safari. The app for its scheme, iOS's
    // install prompt for itms-services. An unclaimed scheme just reports false.
    static func open(_ url: URL, done: ((Bool) -> Void)? = nil) {
        guard canOpen(url) else { done?(false); return }
        DispatchQueue.main.async {
            guard ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                UIApplication.shared.open(url, options: [:]) { done?($0) }
                return
            }
            UIApplication.shared.open(url, options: [.universalLinksOnly: true]) { inApp in
                if inApp { done?(true) } else { UIApplication.shared.open(url, options: [:]) { done?($0) } }
            }
        }
    }
}

// N10: the launch screen's look, for the native side (docs/native.md, "Launch screen").
enum Launch {
    // web/app/ios6.css --pin-dark / --pin-light: 2.5 pt dark, 5.5 pt light, an 8 pt period.
    static let pinDark = UIColor(red: 0xcb / 255.0, green: 0xd0 / 255.0, blue: 0xda / 255.0, alpha: 1)
    static let pinLight = UIColor(red: 0xce / 255.0, green: 0xd3 / 255.0, blue: 0xdc / 255.0, alpha: 1)
    static let pinstripes: UIColor = {
        let tile = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 1)).image { ctx in
            pinLight.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 8, height: 1))
            pinDark.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 2.5, height: 1))
        }
        return UIColor(patternImage: tile)
    }()

    // F198: what each palette paints behind the page (web/app/ios6.css): the pattern for the window and web view,
    // and a plain colour for underPageBackgroundColor (the overscroll). OLED Black is black, no pinstripe;
    // Gunmetal is its dark pinstripes (--pin-dark #2b2e33, --pin-light #303338).
    struct Ground { let pattern: UIColor; let plain: UIColor }
    static let light = Ground(pattern: pinstripes, plain: pinLight)
    static let oled = Ground(pattern: .black, plain: .black)
    static let gunmetal: Ground = {
        let dark = UIColor(red: 0x2b / 255.0, green: 0x2e / 255.0, blue: 0x33 / 255.0, alpha: 1)
        let light = UIColor(red: 0x30 / 255.0, green: 0x33 / 255.0, blue: 0x38 / 255.0, alpha: 1)
        let tile = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 1)).image { ctx in
            light.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 8, height: 1))
            dark.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 2.5, height: 1))
        }
        return Ground(pattern: UIColor(patternImage: tile), plain: light)
    }()
    // F214: F200's palettes (web/app/palettes.css): their --pin-dark/--pin-light pinstripes, the overscroll their
    // --pin-light, except Linen's, which is the base of its --weave (#36383d) the grouped pages show.
    static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat(hex >> 16 & 0xff) / 255, green: CGFloat(hex >> 8 & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
    }
    static func striped(_ dark: UInt32, _ light: UInt32, plain: UInt32? = nil) -> Ground {
        let d = rgb(dark), l = rgb(light)
        let tile = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 1)).image { ctx in
            l.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 8, height: 1))
            d.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 2.5, height: 1))
        }
        return Ground(pattern: UIColor(patternImage: tile), plain: plain.map(rgb) ?? l)
    }
    static let midnight = striped(0x0a1424, 0x0c172a)
    static let linen = striped(0x34363b, 0x383a3f, plain: 0x36383d)
    static let nord = striped(0x2e3440, 0x313744)
    static let dracula = striped(0x282a36, 0x2b2d3a)
    static let sepia = striped(0xe6d9bd, 0xebdfc5)
    static let solarized = striped(0xe9e2cd, 0xeee8d5)
    // F325: the textured palettes, their --pin-* (the texture's own colours, as near as two stripes get)
    static let leather = striped(0x382617, 0x3b2819)
    static let felt = striped(0x2a6432, 0x2c6834)
    static let wood = striped(0x633e21, 0x66401f)
    static let legalpad = striped(0xf3e397, 0xf9eba0)
    static let metal = striped(0xc6cbd2, 0xcbd0d6)
    // B221: iOS 7's White (F201), plain #f7f7f7 like its bar, no pinstripe
    static let white = Ground(pattern: rgb(0xf7f7f7), plain: rgb(0xf7f7f7))
    // B237: iOS 13's White (launch set white13), plain #f9f9f9 like its bar
    static let white13 = Ground(pattern: rgb(0xf9f9f9), plain: rgb(0xf9f9f9))

    // The ground for a tone and its palette: the light one (F214: Classic, Sepia or Solarized Light) or the dark
    // one; a name this build doesn't know takes the tone's default (Classic, OLED Black).
    static func ground(dark: Bool, palette: String, lightPalette: String = "classic") -> Ground {
        guard dark else {
            switch lightPalette {
            case "sepia": return sepia
            case "solarized": return solarized
            case "legalpad": return legalpad
            case "metal": return metal
            case "white": return white
            case "white13": return white13
            default: return light
            }
        }
        switch palette {
        case "gunmetal": return gunmetal
        case "midnight": return midnight
        case "linen": return linen
        case "nord": return nord
        case "dracula": return dracula
        case "leather": return leather
        case "felt": return felt
        case "wood": return wood
        case "oled7", "oled13": return oled // B235: iOS 7's and iOS 13's OLED Black (own launch sets), black too
        default: return oled
        }
    }

    // The web view's backgrounds: behind a page that hasn't painted yet, and behind its edges.
    static func paint(_ w: WKWebView, _ g: Ground) {
        w.backgroundColor = g.pattern
        w.scrollView.backgroundColor = g.pattern
        if #available(iOS 15.0, *) { w.underPageBackgroundColor = g.plain }
    }

    // B180: the launch screen itself (LaunchScreen.storyboardc, from native/launch/LaunchScreen.storyboard): the
    // bars laid out against the safe area of whatever it is put in, as iOS lays out the splash. Touches pass through.
    // nil if the bundle has no storyboard (UIStoryboard would throw).
    static func cover() -> UIView? {
        guard Bundle.main.path(forResource: "LaunchScreen", ofType: "storyboardc") != nil,
              let v = UIStoryboard(name: "LaunchScreen", bundle: .main).instantiateInitialViewController()?.view
        else { return nil }
        v.isUserInteractionEnabled = false
        return v
    }
}

// iFizBox updated over itself (its own IPA from Changes, or a .deb on a jailbroken phone) keeps running the old copy
// until it's closed (user 2026-11-17). Every few seconds it reads its Info.plist on disk: once that is gone or names
// another version, it leaves a "tap to open" notification and closes, so the next open is the new iFizBox.
enum Replaced {
    static let running = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
                          Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "")
    static var timer: Timer?

    static func onDisk() -> (String, String)? {
        let url = Bundle.main.bundleURL.appendingPathComponent("Info.plist")
        guard let d = NSDictionary(contentsOf: url) else { return nil }
        return (d["CFBundleShortVersionString"] as? String ?? "", d["CFBundleVersion"] as? String ?? "")
    }

    static func watch() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { _ in
            let now = onDisk()
            if let now, now == running { return }
            timer?.invalidate()
            close(newVersion: now?.0)
        }
    }

    static func close(newVersion: String?) {
        let c = UNMutableNotificationContent()
        c.title = Brand.name
        c.body = newVersion.map { "Updated to \($0). Tap to open it." } ?? "Updated. Tap to open it."
        let req = UNNotificationRequest(identifier: "ifizbox.updated", content: c,
                                        trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
        UNUserNotificationCenter.current().add(req) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) } // ponytail: a plain exit; iOS allows it here
        }
    }
}
