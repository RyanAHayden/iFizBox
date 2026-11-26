# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs in three places:
the public site, the jailbreak app (a native shell around a WKWebView that installs `.deb`s through a root helper,
docs/native.md) and the sideload IPA, the same shell without the helper, for AltStore sources and signing,
installing and re-signing apps on the phone (docs/sideload.md). It has to feel native: 120 Hz, real swipe-back.
Push notifications for updates; Shortcuts recipes in docs/shortcuts.md. Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [ ] **T86** Promo clip + posts for sideloaders (split into T86c, T86a) | files: marketing/video/**, journal/**
- [~] **R103** (follow-up, low) On the iPhone 15 Pro, after a real computer setup with the spare free Apple ID (website with B474 published): Settings > Installation & Signing shows the Free Apple ID group; Sign In Again then Refresh Profile makes a new profile and imports it; Home's 'Profile Expires Soon ... Renew in Signing' tile opens that page; its days left match the profile's (7 right after setup). Needs the release with B474 live on the website. | files: journal/** | after: B474 BLOCKED: (after V32) Waits for the next release (V32) to put B474 on the website
- [~] **T86a** Sideloader posts artifact (the T86 page, same URL): swap in the new 4:5 and 9:16 videos from T86c (upload + download links), update the X and r/sideloaded text to mention the Free Apple ID option next to your own certificate, Copy button per block. Then block CONFIRM: Sideloader posts ready on <page link>. Reply posted, or what to change. | files: journal/** | after: T86a | model: sonnet — reopened: T86c landed — you said, on CONFIRM Check the Sideloader posts page; reply posted, or what to change.: do this instead: User: the sideload promo is far too sped up; make it normal speed. In marketing/video/promo-sideload.html set every SPEED segment to 1 and FASTER to 1 (real time, as the app really moves). Shorten only by tightening the recording script's own pauses/waits in shots-promo-sideload.json (re-record), never by speeding playback or jump cuts; a longer clip (~60-100 s) is fine. Re-render 4:5 and 9:16, play-check a few seconds against the raw recording to confirm 1x, update the journal and marketing/video/README.md, then re-publish the same page https://claude.ai/artifact/9n5ZYu6bfeZPwHSVXRgnQC with the new clips and block CONFIRM again. BLOCKED: CONFIRM: Check the Sideloader posts page (real-time clip, 107 s); reply posted, or what to change. https://claude.ai/artifact/9n5ZYu6bfeZPwHSVXRgnQC (asked 2026-11-26 15:45)
- [ ] **V32** Release: bump the version where the project keeps it, per its versioning rules (agent-runner's: docs/SETUP.md#versions), move CHANGELOG.md's Unreleased entries under the new version heading, commit to main so the release workflow tags and publishes it. Check: the release workflow passed (gh run list) and gh release view shows the new tag | after: all | held: yes
### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

- [ ] **F446** (follow-up, normal) Free Apple ID profile: make This iPhone work through the LocalDevVPN app (App Store loopback VPN, Device IP 10.7.0.1) instead of the built-in VPN. A build without Network Extensions skips LocalVPN.begin and connects to 10.7.0.1 when a tunnel is up (VPNCheck.tunnels), Set Up step 2 becomes Turn on LocalDevVPN with its App Store link and a Test Connection probe, install failures say Turn on LocalDevVPN, Restore My VPN and the Quiet Pairing Check's VPN branches are skipped. Check on the iPhone 15 Pro with a free-profile build: an install and a re-sign with no computer. See journal/2026-11-26-R104-free-route-loopback-vpn. | files: native/sideload/vpn/App/LocalVPN.swift, native/sideload/idevice/IDevice.swift, native/sideload/idevice/VPNCheck.swift
### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
- [ ] **C31** (follow-up, later) Storage keys and module-private exports (audit 2026-11-20): one module naming the 55 ifizbox.* storage keys, used by their readers and writers; drop export from module-private exports (164 are used only inside their own module) where no test imports them, or note why in docs/audit.md. Check: node --test; a test that every ifizbox.* string literal comes from the key module. | files: web/app/core/storagekeys.js, docs/audit.md
- [ ] **V31** (follow-up, later) Release: bump the version where the project keeps it, per its versioning rules (agent-runner's: docs/SETUP.md#versions), move CHANGELOG.md's Unreleased entries under the new version heading, commit to main so the release workflow tags and publishes it. Check: the release workflow passed (gh run list) and gh release view shows the new tag | after: all | moved: yes — cancelled after 0 min: nothing had been done yet
