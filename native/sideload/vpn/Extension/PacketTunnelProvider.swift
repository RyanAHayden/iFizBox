// The built-in VPN's packet tunnel (sideload build only, PlugIns/iFizBoxVPN.appex): the loopback idea of StosVPN and
// LocalDevVPN, written for iFizBox. The tunnel gives this phone the address 10.7.0.0 and routes only 10.7.0.1 into it
// (no default route: every other connection keeps its own path). Each packet the app sends to 10.7.0.1 is written
// straight back with its source and destination swapped, so it arrives at this phone's own services (RemotePairing,
// lockdownd) as from a peer at 10.7.0.1 on the tunnel, which iOS takes where it refuses its own Wi-Fi or Tailscale
// address. Swapping the two addresses keeps the IPv4 and TCP/UDP checksums as they are (the same words, summed in
// another order), so nothing is recomputed. No internet is needed: nothing leaves the phone.
// The app turns it on only while it connects to iOS and off after (native/sideload/vpn/App/LocalVPN.swift).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import NetworkExtension

final class PacketTunnelProvider: NEPacketTunnelProvider {
    static let deviceAddress = "10.7.0.0"
    static let peerAddress = "10.7.0.1"

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        let s = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: Self.peerAddress)
        let v4 = NEIPv4Settings(addresses: [Self.deviceAddress], subnetMasks: ["255.255.255.255"])
        v4.includedRoutes = [NEIPv4Route(destinationAddress: Self.peerAddress, subnetMask: "255.255.255.255")]
        v4.excludedRoutes = [NEIPv4Route.default()]
        s.ipv4Settings = v4
        s.mtu = 16384 // a loop on the phone: large packets copy faster, nothing on a wire limits them
        setTunnelNetworkSettings(s) { [weak self] err in
            if err == nil { self?.loop() }
            completionHandler(err)
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    /// Reads the tunnel's packets and writes each back with its addresses swapped, for as long as the tunnel runs.
    private func loop() {
        packetFlow.readPackets { [weak self] packets, protocols in
            guard let self = self else { return }
            var out: [Data] = []
            var outProtocols: [NSNumber] = []
            out.reserveCapacity(packets.count)
            for (i, p) in packets.enumerated() {
                guard let back = Self.reflect(p) else { continue }
                out.append(back)
                outProtocols.append(protocols[i])
            }
            if !out.isEmpty { self.packetFlow.writePackets(out, withProtocols: outProtocols) }
            self.loop()
        }
    }

    /// An IPv4 packet with its source (bytes 12-15) and destination (16-19) swapped; nil for anything else.
    static func reflect(_ p: Data) -> Data? {
        guard p.count >= 20, p[p.startIndex] >> 4 == 4 else { return nil }
        var b = p
        b.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) in
            for i in 12..<16 { raw.swapAt(i, i + 4) }
        }
        return b
    }
}
