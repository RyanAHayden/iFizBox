// F65: the app side of N5's upgrade daemon (native/daemon/). The daemon posts "3 Upgrades" and sets the icon badge
// under iFizBox's bundle id, and iOS drops both until iFizBox itself has notification permission: so the jailbreak
// build asks once (alert, badge and sound) at its first launch. A tap on a notification whose userInfo has a
// "url" route ("#/changes", main.m's post) opens that route in the web view, and the page clears the badge
// through app.badge once the Changes tab shows no upgrades (web/app/settings.js).
//
//   app.badge {count}   the icon badge to count (0 clears it and takes N5's delivered notification away)
//
// The delegate is also what lets a notification show while iFizBox is open (the sideload build's re-sign reminder,
// Sideload.swift, too); its taps carry no route and do nothing here.
import UIKit
import BackgroundTasks
import UserNotifications
import WebKit

final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()
    static let upgradesID = "ifizbox-upgrades" // native/daemon/main.m NOTE_ID

    // From application(_:didFinishLaunchingWithOptions:), before it returns, so a tap that launched the app arrives.
    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        guard AppMode.current == .jailbreak else { return } // the sideload build asks when a reminder is set
        center.getNotificationSettings { s in
            // Once: iOS shows its alert only while undecided, and a "no" stays the user's (Settings > Notifications).
            guard s.authorizationStatus == .notDetermined else { return }
            center.requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound, .badge])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
           let route = Notifications.route(response.notification.request.content.userInfo["url"]) {
            DispatchQueue.main.async { Notifications.open(route, tries: 50) }
        }
        completionHandler()
    }

    // Only one of web/app/router.js's routes: "#/" then [A-Za-z0-9/%._~-], at most 200 characters.
    static func route(_ value: Any?) -> String? {
        guard let s = value as? String, s.hasPrefix("#/"), s.count <= 200 else { return nil }
        let ok = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/%._~-")
        return s.dropFirst(2).unicodeScalars.allSatisfy { ok.contains($0) } ? s : nil
    }

    // Set the page's hash (the router follows hashchange). A tap that launched the app comes before the page has
    // loaded: try again every 0.2 s, for up to `tries` times, until the web view has finished loading.
    static func open(_ route: String, tries: Int) {
        let web = UIApplication.shared.connectedScenes
            .compactMap { (($0 as? UIWindowScene)?.windows.first?.rootViewController as? WebController)?.webView }.first
        guard let web, !web.isLoading, web.url != nil else {
            if tries > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { open(route, tries: tries - 1) } }
            return
        }
        // B399: an update alert (Changes) refreshes the sources too (app.js), or Changes can lack what it told of.
        web.callAsyncJavaScript("location.hash = route; if (route === '#/changes') dispatchEvent(new Event('ifizbox:update-alert'))", arguments: ["route": route], in: nil, in: .page,
                                completionHandler: nil)
    }

    static func register(_ b: Bridge) {
        Push.register(b) // F280: push.status, push.register, push.unregister (below)
        // What iOS allows iFizBox (Settings > Notifications > iFizBox, Background App Refresh) and when the background
        // check last ran: Settings shows it, so a badge that never comes has a reason on screen.
        b.on("app.notifyStatus") { c in
            UNUserNotificationCenter.current().getNotificationSettings { st in
                DispatchQueue.main.async {
                    let name: [UNAuthorizationStatus: String] = [.notDetermined: "notDetermined", .denied: "denied",
                                                                 .authorized: "authorized", .provisional: "provisional"]
                    let last = UserDefaults.standard.double(forKey: BackgroundCheck.lastRunKey)
                    c.reply(["status": name[st.authorizationStatus] ?? "other", "badges": st.badgeSetting == .enabled,
                             "alerts": st.alertSetting == .enabled,
                             "backgroundRefresh": UIApplication.shared.backgroundRefreshStatus == .available,
                             "backgroundOn": !UserDefaults.standard.bool(forKey: BackgroundCheck.offKey),
                             "lastCheck": last > 0 ? ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: last)) as Any : NSNull()], nil)
                }
            }
        }
        // The Home Screen icon's long-press menu: "Upgrade All (N)" while N upgrades wait (none: no item).
        b.on("app.shortcuts") { c in
            let n = max(0, (c.params["upgrades"] as? NSNumber)?.intValue ?? 0)
            DispatchQueue.main.async {
                UIApplication.shared.shortcutItems = n > 0 ? [UIApplicationShortcutItem(type: Shortcut.upgrade,
                    localizedTitle: "Upgrade All", localizedSubtitle: n == 1 ? "1 upgrade" : "\(n) upgrades",
                    icon: UIApplicationShortcutIcon(systemImageName: "arrow.down.circle"), userInfo: nil)] : []
                c.reply(nil, nil)
            }
        }
        // Settings > Update Alerts > Check in the Background (on unless turned off): off cancels the scheduled check.
        b.on("updates.background") { c in
            let on = c.params["on"] as? Bool ?? true
            UserDefaults.standard.set(!on, forKey: BackgroundCheck.offKey)
            if on { BackgroundCheck.schedule() } else { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: BackgroundCheck.taskID) }
            c.reply(["on": on], nil)
        }
        // iFizBox's page in iOS Settings (notifications, badges, Background App Refresh live there).
        b.on("app.openSettings") { c in
            DispatchQueue.main.async {
                var s = UIApplication.openSettingsURLString
                if #available(iOS 16.0, *) { s = UIApplication.openNotificationSettingsURLString }
                let url = URL(string: s)!
                UIApplication.shared.open(url)
                c.reply(nil, nil)
            }
        }
        b.on("app.badge") { c in
            let n = max(0, (c.params["count"] as? NSNumber)?.intValue ?? 0)
            WidgetStore.save(count: n, names: []) // N8: the Home Screen widget shows the same count
            UserDefaults.standard.set(n, forKey: BackgroundCheck.pageCountKey) // B47: the background check's badge starts here
            UserDefaults.standard.removeObject(forKey: BackgroundCheck.foundKey) // B124: the page's count stands for all now
            DispatchQueue.main.async {
                if n == 0 { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [upgradesID]) }
                setIcon(n, ask: true) { e in c.reply(nil, e.map { "badge: \($0)" }) }
            }
        }
    }

    // B158: every icon badge iFizBox sets goes through here (app.badge, BackgroundCheck's run and selfHandedOff), so
    // the counts land in the order they were asked for: the latest wins (UpdateCheck.BadgeSync, tested on Linux).
    // Main thread or not; `ask`: iOS shows an icon badge only with permission for badges, so ask once, the first time
    // there's a count (only where iOS can show the alert: not from a background run). `replied` gets nil or iOS's
    // error, on the main thread, once the latest count is set.
    private static var badgeSync = UpdateCheck.BadgeSync() // main thread only
    private static var badgeReplies = [(String?) -> Void]()
    private static var lastIcon = 0 // the latest count asked for
    static func setIcon(_ n: Int, ask: Bool = false, _ replied: ((String?) -> Void)? = nil) {
        guard Thread.isMainThread else { return DispatchQueue.main.async { setIcon(n, ask: ask, replied) } }
        badgeSync.want(n)
        lastIcon = max(0, n)
        if let replied { badgeReplies.append(replied) }
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { st in
            if ask && n > 0 && st.authorizationStatus == .notDetermined {
                // a count set meanwhile (before the answer) didn't show: set the latest again now
                center.requestAuthorization(options: [.badge, .alert, .sound]) { _, _ in
                    DispatchQueue.main.async { badgeSync.want(lastIcon); pumpIcon() }
                }
            } else {
                DispatchQueue.main.async(execute: pumpIcon)
            }
        }
    }

    private static func pumpIcon() {
        if let n = badgeSync.start() { applyIcon(n) }
    }

    private static func applyIcon(_ n: Int) {
        let finished: (String?) -> Void = { e in
            DispatchQueue.main.async {
                if let next = badgeSync.done() { return applyIcon(next) }
                let rs = badgeReplies
                badgeReplies = []
                rs.forEach { $0(e) }
            }
        }
        if #available(iOS 16.0, *) {
            UNUserNotificationCenter.current().setBadgeCount(n) { e in finished(e?.localizedDescription) }
        } else {
            UIApplication.shared.applicationIconBadgeNumber = n
            finished(nil)
        }
    }
}

// F280: push notifications (APNs), the sideload build. The page (web/app/core/push.js) sends the token this hands it
// to the signing server (worker/src/push.js), which pushes update alerts; a tap's "url" route opens Changes through
// userNotificationCenter(_:didReceive:) above. APNs delivers by topic = this copy's Info.plist bundle ID, whichever
// team signed it, so the page checks the ID; and only when the embedded profile has aps-environment does iOS hand
// out a token, its value (production / development) picking the APNs host.
//
//   push.status     {mode, bundleId, team, environment (aps-environment | null), authorization, registered,
//                    profileExpires (ISO | null), version, ios}
//   push.register   iOS's permission (asked once), then the device token -> {token (hex)}; errors "denied: ...",
//                    "no_push: ..." (no aps-environment, or the jailbreak build), "apns: ..." (iOS's own error)
//   push.unregister stops the token (the page has the server forget it first)
// The token is never logged.
enum Push {
    private static var waiting: [Int: (String?, String?) -> Void] = [:] // main thread only
    private static var next = 0

    static var profile: Profile? {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? Profile(data)
    }

    // From AppDelegate's didRegisterForRemoteNotificationsWithDeviceToken / didFailToRegister... (App.swift).
    static func received(_ token: Data?, _ error: Error?) {
        let hex = token.map { $0.map { String(format: "%02x", $0) }.joined() }
        DispatchQueue.main.async {
            let list = waiting.values
            waiting = [:]
            for done in list { done(hex, hex == nil ? (error?.localizedDescription ?? "no token") : nil) }
        }
    }

    // Main thread. iOS answers through the app delegate, or not at all (no network to APNs): 30 s, then an error.
    private static func requestToken(_ done: @escaping (String?, String?) -> Void) {
        next += 1
        let id = next
        waiting[id] = done
        UIApplication.shared.registerForRemoteNotifications()
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
            guard let d = waiting.removeValue(forKey: id) else { return }
            d(nil, "iOS gave no push token within 30 seconds (is this iPhone online?)")
        }
    }

    static func register(_ b: Bridge) {
        b.on("push.status") { c in
            UNUserNotificationCenter.current().getNotificationSettings { st in
                DispatchQueue.main.async {
                    let name: [UNAuthorizationStatus: String] = [.notDetermined: "notDetermined", .denied: "denied",
                                                                 .authorized: "authorized", .provisional: "provisional"]
                    let p = AppMode.current == .sideload ? profile : nil
                    let info = Bundle.main.infoDictionary ?? [:]
                    c.reply(["mode": AppMode.current.rawValue, "bundleId": Bundle.main.bundleIdentifier ?? "",
                             "team": p?.team ?? "", "environment": (p?.pushEnvironment).map { $0 as Any } ?? NSNull(),
                             "authorization": name[st.authorizationStatus] ?? "other",
                             "registered": UIApplication.shared.isRegisteredForRemoteNotifications,
                             "profileExpires": (p?.expires).map { ISO8601DateFormatter().string(from: $0) as Any } ?? NSNull(),
                             "version": info["CFBundleShortVersionString"] ?? "", "ios": UIDevice.current.systemVersion], nil)
                }
            }
        }
        b.on("push.register") { c in
            guard AppMode.current == .sideload else { return c.reply(nil, "no_push: the jailbreak build's alerts come from its daemon") }
            guard profile?.pushEnvironment != nil else {
                return c.reply(nil, "no_push: this copy's provisioning profile has no aps-environment")
            }
            let center = UNUserNotificationCenter.current()
            let go = {
                DispatchQueue.main.async {
                    requestToken { token, error in
                        if let token { c.reply(["token": token], nil) } else { c.reply(nil, "apns: \(error ?? "no token")") }
                    }
                }
            }
            center.getNotificationSettings { st in
                switch st.authorizationStatus {
                case .denied: c.reply(nil, "denied: notifications are off for this app in iOS Settings")
                case .notDetermined:
                    center.requestAuthorization(options: [.alert, .badge, .sound]) { ok, _ in
                        if ok { go() } else { c.reply(nil, "denied: notifications were not allowed") }
                    }
                default: go()
                }
            }
        }
        b.on("push.unregister") { c in
            DispatchQueue.main.async {
                UIApplication.shared.unregisterForRemoteNotifications()
                c.reply(nil, nil)
            }
        }
    }
}

// The Home Screen icon's quick action (app.shortcuts sets it): the page queues every upgrade and opens Confirm
// (app.js ifizboxShortcut). A tap that launched iFizBox waits for the page as a notification tap does.
enum Shortcut {
    static let upgrade = "com.ryha.ifizbox.upgrade"
    static func perform(_ type: String, tries: Int = 50) {
        let web = UIApplication.shared.connectedScenes
            .compactMap { (($0 as? UIWindowScene)?.windows.first?.rootViewController as? WebController)?.webView }.first
        guard let web, !web.isLoading, web.url != nil else {
            if tries > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { perform(type, tries: tries - 1) } }
            return
        }
        // the page's own scripts may still be starting: it calls this once it can (app.js)
        web.callAsyncJavaScript("globalThis.ifizboxShortcut ? globalThis.ifizboxShortcut(t) : (globalThis.ifizboxPendingShortcut = t)",
                                arguments: ["t": type == upgrade ? "upgrade" : type], in: nil, in: .page, completionHandler: nil)
    }
}
