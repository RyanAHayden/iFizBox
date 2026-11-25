// B433: how the This iPhone route (IDevice.install) asks installd to install. Before replacing an app, iOS ends the
// running copy, and a plain install only asks politely (RunningBoard's NonInteractive): an app in front or playing
// audio refuses, and installd waits for it to be closed. PackageType=Developer, what Xcode sends, asks with Absolute,
// so the app is ended and the install goes on. Pure, no UIKit or idevice: native/sign/tests/sideload/main.swift tests
// it on Linux.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum HerePackage {
    static let type = "Developer"

    /// Every install goes as a Developer package but iFizBox's own update: that one closes iFizBox itself once installd
    /// accepted it (SelfCloseClock), and must not be ended before then (the connection goes with it).
    static func developer(bundleID: String?, own: String?) -> Bool { bundleID == nil || bundleID != own }

    /// Whether to install once more without the Developer type after this failure: iOS answered and refused (a drop
    /// connects again instead, HereRecheck), and not for something a plain install can't change (`never`, idevice's
    /// CanceledByUser 27). installd deletes the staged IPA when it refuses, so the retry costs another copy.
    static func retryPlain(code: String, lib: Int32?, text: String) -> Bool {
        guard code == "install_failed", let lib = lib, lib != 27 else { return false }
        return !HereRecheck.isDropped(code: code, lib: lib) && !never.contains { text.contains($0) }
    }

    /// installd's names for refusals about the IPA or the phone, the same whatever the package type.
    private static let never = ["MismatchedApplicationIdentifierEntitlement", "DeviceOSVersionTooLow", "DeviceFamilyNotSupported",
                                "IncorrectArchitecture", "PackageExtractionFailed", "MissingPackagePath"]
}
