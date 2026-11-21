// Is LocalDevVPN on, and is another VPN on instead? iOS gives an app no way to switch another app's VPN, so the
// install route only detects it and tells the user what to do (turn the other VPN off, turn LocalDevVPN on).
//   localDevVPN: 10.7.0.1 answers on the RemotePairing or lockdown port (connected, or refused: either way the
//                address is routed to this phone)
//   otherVPN:    a tunnel interface (utun, ipsec, ppp) is up with an IPv4 address while 10.7.0.1 doesn't answer
//                (Tailscale, WireGuard, a commercial VPN; generic on purpose)
import Darwin
import Foundation

enum VPNCheck {
    static let tunnelPrefixes = ["utun", "ipsec", "ppp"]

    /// The names of the tunnel interfaces that are up and have an IPv4 address.
    static func tunnels() -> [String] {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0 else { return [] }
        defer { freeifaddrs(head) }
        var out = Set<String>()
        var p = head
        while let i = p {
            let flags = Int32(i.pointee.ifa_flags)
            let name = String(cString: i.pointee.ifa_name)
            if flags & IFF_UP != 0, i.pointee.ifa_addr?.pointee.sa_family == sa_family_t(AF_INET),
               tunnelPrefixes.contains(where: name.hasPrefix) {
                out.insert(name)
            }
            p = i.pointee.ifa_next
        }
        return out.sorted()
    }

    enum Probe { case connected, refused, silent }

    /// A TCP connect to 10.7.0.1:port with a deadline. Blocking.
    static func probe(_ port: UInt16, timeout: TimeInterval = 1.5) -> Probe {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return .silent }
        defer { close(fd) }
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK)
        var a = IDevice.sockaddr4(port)
        let rc = withUnsafePointer(to: &a) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        if rc == 0 { return .connected }
        if errno == ECONNREFUSED { return .refused }
        guard errno == EINPROGRESS else { return .silent }
        var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        guard poll(&pfd, 1, Int32(timeout * 1000)) == 1 else { return .silent }
        var soErr: Int32 = 0
        var len = socklen_t(MemoryLayout<Int32>.size)
        getsockopt(fd, SOL_SOCKET, SO_ERROR, &soErr, &len)
        if soErr == 0 { return .connected }
        return soErr == ECONNREFUSED ? .refused : .silent
    }

    /// F301: a probe's deadline. 10.7.0.1 is this phone through LocalDevVPN, so an answer (connected or refused) comes
    /// in milliseconds; only a silent address waits it out.
    static let probeTimeout: TimeInterval = 0.75

    /// F301: idevice.status is read on every visit of Settings > Installation & Signing and every 2 s while the Pairing
    /// page waits for the VPN, so it must be quick. LocalDevVPN is a tunnel interface with an IPv4 address (utun):
    /// with none up it can't be on, and nothing is probed (the probes' deadline was the whole wait with the VPN off).
    /// Otherwise both ports are probed at once (they were one after the other: 3 s with LocalDevVPN off and another
    /// VPN on, 0.75 s now).
    static func status() -> [String: Any] {
        let up = tunnels()
        guard !up.isEmpty else { return ["localDevVPN": false, "otherVPN": false, "tunnels": up] }
        let ports = [IDevice.remotePairingPort, IDevice.lockdownPort]
        var answers = [Probe](repeating: .silent, count: ports.count)
        let lock = NSLock()
        DispatchQueue.concurrentPerform(iterations: ports.count) { i in
            let a = probe(ports[i], timeout: probeTimeout)
            lock.lock(); answers[i] = a; lock.unlock()
        }
        // B316: a refusal proves LocalDevVPN only when 10.7.0.1 is routed into a tunnel. Off Wi-Fi with Tailscale on,
        // it goes out over cellular, where the carrier's network can refuse it at once: that read as LocalDevVPN on,
        // and every pairing check and install went to 10.7.0.1 ("refused on every port: pair again").
        let via = routeInterface()
        let tunnelRoute = via.map { n in tunnelPrefixes.contains(where: n.hasPrefix) } ?? false
        let local = answers.contains(.connected) || (tunnelRoute && answers.contains(.refused))
        return ["localDevVPN": local, "otherVPN": !local, "tunnels": up, "route": via ?? NSNull()]
    }

    /// B316: the interface the system sends `host` (10.7.0.1) through: a UDP connect sends nothing, and the source
    /// address it picks names the interface. nil when there's no route.
    static func routeInterface(_ host: String = IDevice.address) -> String? {
        let fd = socket(AF_INET, SOCK_DGRAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        var a = IDevice.sockaddr4(IDevice.lockdownPort, host: host)
        let rc = withUnsafePointer(to: &a) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard rc == 0 else { return nil }
        var local = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let got = withUnsafeMutablePointer(to: &local) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) } }
        guard got == 0 else { return nil }
        let want = local.sin_addr.s_addr
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0 else { return nil }
        defer { freeifaddrs(head) }
        var p = head
        while let i = p {
            defer { p = i.pointee.ifa_next }
            guard let addr = i.pointee.ifa_addr, addr.pointee.sa_family == sa_family_t(AF_INET) else { continue }
            let s = addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr.s_addr }
            if s == want { return String(cString: i.pointee.ifa_name) }
        }
        return nil
    }
}
