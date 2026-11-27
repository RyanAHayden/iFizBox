# F465: Phone Setup, the setup command run inside Open Minis

## What
- K11 approved option A: a setup command in Open Minis, so the free Apple ID's one-time setup needs no computer
  (iOS 27). The concept's first step was a proof, and it passed.
- `tools/setup/core/src/phone.rs` (new): the steps, in order: ready (Open Minis and LocalDevVPN are there), code,
  download (the signed IPA, checked as on a computer), pair, install, hand pairing. The pairing is kept only in
  memory and is handed to the app as Documents/pairingFile.plist. Four tests with fakes.
- `tools/setup/cli/src/minis.rs` (new): the device side. minis-bonjour advertises the service; apple-speak keeps it
  silent in the background; apple-notification shows the pairing code; idevice's PairableHost pairs; an RPPairing
  tunnel and RSD on 10.7.0.1 go through LocalDevVPN; install_package_with_callback_rsd installs; house_arrest writes
  the pairing file into the app's container.
- `tools/setup/cli/src/main.rs`: picks Phone Setup when minis-bonjour is on PATH.
- `tools/setup/install.sh.in`: no longer demands usbmuxd inside Open Minis. `tools/setup/test_setup.py` covers it.
- `tools/setup/cli/Cargo.toml`, `Cargo.lock`, `tools/setup/core/src/lib.rs`: the idevice features remote_pairing,
  rsd and tunnel_tcp_stack, which are Linux-only dependencies.

## Decisions
- No idevice patch: the Rust pin callback hands over the code, and it goes out as a notification over Settings.
  The app, by contrast, shows its code up front.
- Pairing in memory only; the file in the app's container is the one hand-off.
- The Linux-only idevice features built for aarch64 musl on the first try (K11 had left that unverified).
  `cargo check` for x86_64-pc-windows-gnu still passes.

## Checked
- The four `phone.rs` tests with fakes.
- Proof on an iPhone 15 Pro (iOS 27.0.1). The phone, not a desktop, because Open Minis, Bonjour, pairing and
  installing exist only there.
  - Open Minis 1.16 installed from the App Store with Get and Install, no password asked. Left installed on the test
    phone, with Local Network and Notifications allowed.
  - Files got in over USB: `nc -l -p 9000 > f` in Minis Shell, and `ios forward <port> 9000` on the desktop (Open
    Minis has no file sharing).
  - The website was stood in for by busybox httpd inside Minis, serving `/sign/setup/ABCD2345` and the IPA. Run as
    `./setup ABCD-2345 --server http://127.0.0.1:8000`.
  - The test app was a tiny UIKit app signed with the rig profile.
  - Result: the LocalDevVPN check ok; Developer Mode listed "Pair with iFizBox" while Minis was in the background; the
    code arrived as a notification; Paired; Installing 100%; iOS listed the app; Documents/pairingFile.plist was in its
    container; go-ios launched it.
- Failed on the way, both fixed or explained:
  - idevice's service type ends in ".local.", which minis-bonjour refused. Fixed and tested.
  - The test app crashed in UIKit's no-UIScene assertion (an iOS 27 SDK rule). A flaw of the throwaway app, so its
    screen was never seen.
  - Typing into Minis while nc still ran was swallowed. Ctrl-C first.

## Found
- **Pairing under the name iFizBox replaced the installed iFizBox app's own pairing.** The app showed "Pairing Lost";
  Paired Devices still listed one iFizBox row. Restored by re-pairing in the app (Fix), which shows Ready to Install
  again. So a Phone Setup over an installed app (for example after its 7 days) breaks that app's pairing unless the
  app takes the handed pairing. That is follow-up F465a.

## Changed after the proof
- A spec review after the phone proof led to three changes:
  - An "iOS 27 or later" line in the pairing instructions and timeout.
  - A line printed before the fallback port search.
  - A test_setup.py test that cli/Cargo.toml's idevice rev equals native/sideload/idevice/pin.env.

## Cleaned up
- The test app uninstalled; the files and busybox-extras removed from Minis; LocalDevVPN disconnected.

## Not verified
- The website's real code and download over HTTPS from Open Minis (stood in for by busybox httpd).
- A real free Apple ID signed IPA, and its trust step.
- A phone with a passcode.
- A phone with Developer Mode off.
- The `wget | sh` line through install.sh on the phone.
- No release of the setup command was published, so the website and the Install Without a Computer line are not
  offered yet.
- The fallback port scan (49152 answered).
- A large upload (real app size) and how long it takes.
- A locked phone, or Open Minis suspended during a long wait.
- The early notification added after the proof (so iOS asks for permission while Open Minis is in front) was not
  run on the phone.
- An app taking the handed pairing (not built: F465a).
- The two messages added after the proof (the "iOS 27 or later" line and the line before the fallback port search)
  were not run on the phone.
- Older iOS was not tried; the shell can't tell the iOS version.
- The VPN check counts a refused connection to 10.7.0.1 as connected, so another LAN host at that address would pass
  it and fail later.

## Release
- No release note: nothing users see yet (the website doesn't offer it and the command isn't published).
