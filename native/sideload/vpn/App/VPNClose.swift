// B440: the built-in VPN off before iFizBox closes for its own update. iOS doesn't replace an app while its VPN extension
// runs ("plugins are busy"): it asks again every 6 s, and the extension would run on for up to a minute after the exit
// (PacketTunnelProvider.quietLimit). An old copy opened in that minute then kept iOS waiting until it was swiped away.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import NetworkExtension

extension LocalVPN {
    /// Down now, whatever holds it, and no start after it (up()). Blocking, downWait at most. True when it was up.
    static func downToClose() -> Bool {
        lock.lock(); closing = true; let m = cached; lock.unlock()
        guard let m = m, ![.disconnected, .invalid].contains(m.connection.status) else { return false }
        m.connection.stopVPNTunnel()
        let t0 = Date()
        while ![.disconnected, .invalid].contains(m.connection.status), Date().timeIntervalSince(t0) < downWait {
            Thread.sleep(forTimeInterval: 0.05)
        }
        log("off (closing for the update) in \(String(format: "%.2f", Date().timeIntervalSince(t0))) s")
        return true
    }
}
