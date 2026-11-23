// F394: the Install Switch's own actions (tools/shortcuts/install-switch.plist), in the sideload IPA's metadata only:
// Connect VPN, Open for Install and Wait for Install. What they do is LocalVPN's (../../sideload/vpn/App). None returns
// anything: a Shortcut whose last action has output makes iOS ask over the app (R78a).
// SPDX-License-Identifier: GPL-3.0-or-later
import AppIntents
import Foundation

@available(iOS 16.0, *)
struct ConnectVPNIntent: AppIntent {
    static let title: LocalizedStringResource = "Connect VPN"
    static let description = IntentDescription("Used by Install Switch: connects the built-in VPN while an app installs on this iPhone.")

    func perform() async throws -> some IntentResult {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            DispatchQueue.global(qos: .userInitiated).async {
                do { try LocalVPN.tripConnect(); c.resume() } catch { c.resume(throwing: IntentFailure((error as? IDevice.Failure)?.text ?? error.localizedDescription)) }
            }
        }
        return .result()
    }
}

@available(iOS 16.0, *)
struct OpenForInstallIntent: AppIntent {
    static let title: LocalizedStringResource = "Open for Install"
    static let description = IntentDescription("Used by Install Switch: opens the app so the install goes on.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LocalVPN.tripOpened()
        return .result()
    }
}

@available(iOS 16.0, *)
struct WaitForInstallIntent: AppIntent {
    static let title: LocalizedStringResource = "Wait for Install"
    static let description = IntentDescription("Used by Install Switch: waits until apps are done installing, 20 seconds at most.")

    func perform() async throws -> some IntentResult {
        let t0 = Date()
        while LocalVPN.tripWaiting(), Date().timeIntervalSince(t0) < LocalVPN.waitStep {
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        return .result()
    }
}
