// Tunnel interfaces and the probe of the phone's own address, for the built-in VPN (native/sideload/vpn).
//   otherVPN: a tunnel interface (utun, ipsec, ppp) of another app is up with an IPv4 address
//   tunnels:  the tunnel interfaces that are up
// iOS gives an app no way to switch another app's VPN; the built-in VPN's Install Switch pauses and restores it.
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

    /// idevice.status's part of it: read on every visit of Settings > Installation & Signing, so it must be quick
    /// (no probe).
    static func status() -> [String: Any] {
        ["otherVPN": LocalVPN.otherVPNUp(), "tunnels": tunnels()]
    }
}
