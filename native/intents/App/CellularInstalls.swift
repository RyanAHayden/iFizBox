// The Cellular Installs Shortcut's own actions (tools/shortcuts/cellular-installs.plist), in the sideload IPA's
// metadata only. What they report goes to CellularShortcut (../../sideload/vpn/App). None returns anything: a Shortcut
// whose last action has output makes iOS ask over the app.
// SPDX-License-Identifier: GPL-3.0-or-later
import AppIntents
import Foundation

@available(iOS 16.0, *)
struct OpenForInstallIntent: AppIntent {
    static let title: LocalizedStringResource = "Open for Install"
    static let description = IntentDescription("Used by Cellular Installs: opens the app so the install goes on.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        CellularShortcut.opened()
        return .result()
    }
}

@available(iOS 16.0, *)
struct WaitForInstallIntent: AppIntent {
    static let title: LocalizedStringResource = "Wait for Install"
    static let description = IntentDescription("Used by Cellular Installs: waits until the apps are connected, 20 seconds at most.")

    func perform() async throws -> some IntentResult {
        let t0 = Date()
        while CellularShortcut.waiting(), Date().timeIntervalSince(t0) < CellularShortcut.waitStep {
            try? await Task.sleep(nanoseconds: 200_000_000)
            if Task.isCancelled { break } // then the sleep returns at once
        }
        CellularShortcut.waited()
        return .result()
    }
}

@available(iOS 16.0, *)
struct FinishInstallsIntent: AppIntent {
    static let title: LocalizedStringResource = "Finish Cellular Installs"
    static let description = IntentDescription("Used by Cellular Installs: tells the app the Shortcut got to its end.")

    func perform() async throws -> some IntentResult {
        CellularShortcut.finished()
        return .result()
    }
}
