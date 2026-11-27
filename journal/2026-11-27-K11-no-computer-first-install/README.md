# K11: a first install with no computer, free Apple ID

## Question
Can the first install of the app on a free Apple ID (the Computer Install) happen without a computer? Before iOS 27 the
pairing needs one, so the options below only help from iOS 27 on.

## Options
Published as an Artifact: https://claude.ai/artifact/6J7GRX46eVeks3q9cVQgLC

- **A (recommended):** a setup command run in Open Minis, with a proof on the iPhone 15 Pro first.
- **B:** the whole device layer as a lasting service in Open Minis.
- **C:** no program of our own; optionally document BariStore as a route.

## Findings
- **BariStore** (github.com/barismd/BariStore, MIT, Rust, created 2026-10-14): a static aarch64-musl binary that runs
  in Open Minis (iOS 27+). Its page is served on 127.0.0.1 under a 128-bit random path with a Host check (`src/web.rs`),
  and is opened inside Minis. It keeps Minis alive during pairing with silent speech audio; its AGENTS.md says that is
  untested on a device. Uploads took about a minute for 160 MB on the emulated CPU (its AGENTS.md). Its owner reports a
  device-verified run: the LocalDevVPN check, pairing, sign-in and install. These claims come from its own docs.
- **Open Minis:** App Store id6759188481, GPL-3.0 source at OpenMinis/OpenMinis, 387 MB, rated 17+, iOS 16+.
- **WebKit bug 171934** (loopback treated as mixed content) is still NEW. An https page on ifizbox.com therefore cannot
  fetch http://127.0.0.1 in Safari. So the concept hands over with a pasted code, not a localhost API.
- **Reuse:**
  - `tools/setup/core` (the steps, and the Ui, Net and Device traits) and `tools/setup/release.sh` already build
    aarch64-unknown-linux-musl.
  - The idevice pin, with `pairable_host_set_pin` patched, comes from `native/sideload/idevice`.
  - Not reusable: the Swift in `IDevice.swift` (Bonjour DNSServiceRegister, port finding, upload, retries).
  - idevice's all-in-one `pairable_host_accept` (its own mDNS responder) stalled on the iPhone 15 Pro (comment near
    `IDevice.swift:99-101`).
- **Before iOS 27,** pairing needs a computer, so none of the options helps there.
- **Aside, a gap:** the computer setup writes `Documents/pairingFile.plist`, but nothing in `native/` reads it. The same
  is noted in journal/2026-11-25-F436-computer-install. `docs/sideload.md` says the free route's pairing comes from that
  setup, and only a manual import (`idevice.import`) exists. Filed as R109 (low), on `docs/sideload.md`.

## Tried that did not work
- `agent-runner plan list` is not a command.
- `tools/ui-15.sh` state said the iPhone 15 Pro was locked by another task, so no phone check was made.

## Not verified
- The Safari mixed-content block was not tried on a phone. The iPhone 15 Pro was locked by another task; the claim
  rests on WebKit bug 171934.
- Nothing about Open Minis was run: advertising the pairable host, reaching 10.7.0.1 from Minis, background survival,
  and installing over RSD from Linux.
- The idevice features `remote_pairing`, `rsd` and `tunnel_tcp_stack` were not built for aarch64 musl.
- BariStore's claims come from its own docs and its owner's report, not from a run here.
- Option C (installing the iFizBox IPA with BariStore) is untried.
