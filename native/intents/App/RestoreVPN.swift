// The Restore My VPN Shortcut's own actions (tools/shortcuts/restore-vpn.plist), in the sideload IPA's metadata only.
// What they report goes to RestoreShortcut (../../sideload/vpn/App). None returns anything: a Shortcut whose last action
// has output makes iOS ask over the app. None opens the app: Shortcuts' callback does, also when Set VPN ends the run.
// SPDX-License-Identifier: GPL-3.0-or-later
import AppIntents
import Foundation

@available(iOS 16.0, *)
struct RememberedVPNIntent: AppIntent {
    static let title: LocalizedStringResource = "Remembered VPN"
    static let description = IntentDescription("Used by Restore My VPN: tells the app your VPN is remembered.")

    func perform() async throws -> some IntentResult {
        // one action for both kinds, so iOS asks for it once; each counts only in its own kind of run
        RestoreShortcut.remembered()
        RestoreShortcut.restoring()
        return .result()
    }
}

@available(iOS 16.0, *)
struct FinishRestoreIntent: AppIntent {
    static let title: LocalizedStringResource = "Finish Restore My VPN"
    static let description = IntentDescription("Used by Restore My VPN: tells the app the Shortcut got to its end.")

    func perform() async throws -> some IntentResult {
        RestoreShortcut.finished()
        return .result()
    }
}
