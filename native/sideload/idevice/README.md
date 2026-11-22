# idevice install route ("Install on this iPhone, no server")

The sideload build installs a signed IPA by talking to this phone's own installd through
[idevice](https://github.com/jkcoxson/idevice) (MIT), the way a computer on USB would. No itms-services manifest,
so nothing reaches the Signing Server, there's no install sheet to keep alive, and the app can update itself.

| File | What it does |
| --- | --- |
| `pin.env` | the idevice commit and the cargo features built (`tools/setup/cli/Cargo.toml` pins the same commit) |
| `LICENSE` | idevice's MIT licence, from that commit |
| `patches/*.patch` | our changes on top of that commit (MIT): `pairable_host_set_pin`, a setup code the app picks and shows before the phone connects; `tunnel_set_port_map`, so the tunnel's port can go through a local relay (Tailscale, `../tailscale/`); `pairable_host_set_alt_irk`, a kept advertisement key, so every pairing advertises the same host and Developer Mode lists one "Pair with" row |
| `build.sh` | builds `libidevice_ffi.a` + `idevice.h` for arm64 iOS 15 from that commit plus `patches/` on Linux (`--probe`: is the toolchain there) |
| `module.modulemap` | `import IDeviceFFI` for the Swift files |
| `IDevice.swift` | pairing (Keychain), connecting over LocalDevVPN, AFC upload, installation_proxy with progress |
| `VPNCheck.swift` | is LocalDevVPN on (10.7.0.1 answers), is another VPN on instead (tunnel interfaces up) |
| `IDeviceBridge.swift` | the `idevice.*` bridge calls (listed at the top of the file) |
| `test_idevice.py` | the gate's checks that need no phone |

## Routes

- **iOS 17.4+ / iOS 27**: RemotePairing on 10.7.0.1 (port below), an RPPairing tunnel and RSD
  (`tunnel_create_rppairing`, `afc_client_connect_rsd`, `installation_proxy_connect_rsd`). The pairing is made on
  the phone on iOS 27 (Developer Mode > Pair with <app>, a 6-digit code; the app is idevice's pairable host).
  Lockdown's 62078 is refused over loopback on iOS 27.
- **Older iOS**: TCP lockdown on 10.7.0.1:62078 with a pairing record made on a computer (`idevice_pair`,
  jitterbugpair) and imported; a heartbeat runs while connected.

RemotePairing's port isn't fixed: 49152 is the first of iOS's dynamic ports, which remotepairingd usually gets, but
after a restart it can listen elsewhere. A connect probes the port that answered last in this run, then 49152, then
every port `_remotepairing._tcp` is advertised on over mDNS (listed in `NSBonjourServices`), over the route in use
(10.7.0.1, or the phone's Tailscale address). When every port refuses, nothing serves this pairing any more: the
connect fails with `refused` (a turned-down pairing with `pairing_rejected`), and the page pairs again.

Pair-setup isn't allowed over loopback, Wi-Fi or Tailscale (`allowsPairSetup` false), so a connection only ever
verifies an existing pairing. LocalDevVPN must be on while installing; iOS lets no app switch another app's VPN.

## When the connection drops mid-install

Leaving the app, a tunnel reset or Tailscale's node going quiet can drop the connection to iOS (idevice's
`Socket(Kind(UnexpectedEof))`, or the watchdog's timeout). That is not iOS refusing the app, so `IDevice.install`
connects again, up to 4 times with a growing pause (`../../sign/HereRecheck.swift` holds the rules), always over the
route the install started on (Automatic would pick LocalDevVPN while Tailscale's VPN is still coming back); a connect
that fails while it is connecting again counts as one of the tries:

- **During the copy**: it carries on from the end of iOS's file in `PublicStaging` (a whole 1 MB chunk back).
- **After the install was sent**: installd goes on without us, so it asks installation_proxy (Browse by bundle ID:
  versions and `Path`) for up to 3 minutes and reports installed when iOS lists the new copy: a new app, a new
  version, or the same version in a new bundle folder. The same version with nothing to tell it from the earlier
  copy counts once it has held for 30 s. Still the earlier copy at the end (one 3-minute deadline per install, however
  often it connects again): it fails and says iOS may still be installing it.

Only installd's own error codes fail an install. A wait that ran far past its 0.5 s tick means iOS suspended the
app; the step's time limit then starts again. The copy's speed in front and in the background goes to the log
(`AFC: copied 351.5 MB in 20.1 s: 18.2 MB/s in front, 17.3 MB/s in the background`, measured on an iPhone 15 Pro
over Tailscale).

## Building

`native/build.sh` runs `build.sh` on every build. It needs `rustup target add aarch64-apple-ios`, clang, `IOS_SDK`
and ld64.lld. The source and cargo's `target/` live in `~/.cache/ifizbox/idevice` (or `IFIZBOX_IDEVICE_CACHE`),
shared by all checkouts under a lock. The first build needs the network (git + crates.io, `--locked`).
It uses `ring`, not upstream's default `aws-lc`, which needs cmake and a Mac toolchain to cross-build.
