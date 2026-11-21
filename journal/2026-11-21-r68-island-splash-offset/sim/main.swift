// R68 check, iOS Simulator only (never shipped). B180's harness (journal/2026-11-20-b180-launch-strips/sim) plus
// what App.swift does for the nav bar's top: TopInset (copied from native/Sources/App.swift) sets --status-bar-bottom
// on <html> at document start and again whenever the safe area changes. Holds the system launch screen for 6 s, then
// shows web/app/index.html (without app.js, so #boot stays). Writes the numbers it used to Documents/r68.txt.
import UIKit
import WebKit

enum TopInset {
    static let islandBelowSafe: CGFloat = 32.0 / 3
    static let margin: CGFloat = 6

    static func value(statusBar: CGFloat, safe: CGFloat) -> CGFloat {
        guard statusBar > 0, statusBar < safe else { return safe }
        return statusBar - (safe - islandBelowSafe) >= margin ? statusBar : safe
    }

    static func parts(_ scene: UIWindowScene?) -> (bar: CGFloat, safe: CGFloat, top: CGFloat)? {
        guard let scene, let w = scene.windows.first else { return nil }
        let safe = w.safeAreaInsets.top
        let bar = scene.statusBarManager?.statusBarFrame.height ?? 0
        guard safe > 0 else { return nil }
        return (bar, safe, value(statusBar: bar, safe: safe))
    }

    static func script(_ top: CGFloat) -> String {
        "document.documentElement.style.setProperty('--status-bar-bottom', '\(top)px')"
    }
}

func note(_ s: String) {
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("r68.txt")
    let old = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    try? (old + s + "\n").write(to: url, atomically: true, encoding: .utf8)
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ app: UIApplication, didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Thread.sleep(forTimeInterval: 6) // the launch screen stays until this returns
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = UIColor(red: 0xce / 255.0, green: 0xd3 / 255.0, blue: 0xdc / 255.0, alpha: 1)
        w.rootViewController = Page()
        w.makeKeyAndVisible()
        window = w
        return true
    }
}

final class Page: UIViewController {
    let web: WKWebView = {
        let c = WKWebViewConfiguration()
        c.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.setAttribute('data-shell', 'app')",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let w = WKWebView(frame: .zero, configuration: c)
        w.isOpaque = false
        w.scrollView.contentInsetAdjustmentBehavior = .never
        return w
    }()
    var sentTop: CGFloat?

    override func loadView() { view = web }

    override func viewDidLoad() {
        super.viewDidLoad()
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        if let p = TopInset.parts(scene) {
            sentTop = p.top
            note("load bar=\(p.bar) safe=\(p.safe) top=\(p.top) scale=\(UIScreen.main.scale)")
            web.configuration.userContentController.addUserScript(WKUserScript(
                source: TopInset.script(p.top), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        } else {
            note("load none")
        }
        let dir = Bundle.main.bundleURL.appendingPathComponent("web")
        web.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        guard let p = TopInset.parts(view.window?.windowScene), p.top != sentTop else { return }
        sentTop = p.top
        note("change bar=\(p.bar) safe=\(p.safe) top=\(p.top) scale=\(UIScreen.main.scale)")
        web.evaluateJavaScript(TopInset.script(p.top))
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}
