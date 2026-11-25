# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs in three places:
the public site, the jailbreak app (a native shell around a WKWebView that installs `.deb`s through a root helper,
docs/native.md) and the sideload IPA, the same shell without the helper, for AltStore sources and signing,
installing and re-signing apps on the phone (docs/sideload.md). It has to feel native: 120 Hz, real swipe-back.
Push notifications for updates; Shortcuts recipes in docs/shortcuts.md. Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

- [ ] **F438** (follow-up, normal) Wanted (user 2026-11-25, approved Queue it): on iFizBox's own update by the This iPhone route, run the Restore My VPN Shortcut's back run just before iFizBox closes, so the person's VPN is back without reopening iFizBox. Only when the back run is owed and can run unasked (setting on, VPN remembered, RestoreBack's rules; app in front). Why: the user's 0.32 to 0.34 update closed, then only finished when reopened and the Shortcut ran. That stick is most likely the bug B440 fixed (not proven, no phone log); 0.34 still leaves the VPN off until the app is opened. None of B440's 10 of 10 runs on the 15 ran the Shortcut. Where: Sideload.swift CloseForUpdate.closeWith calls LocalVPN.downToClose() then exits after 6.5 s (vpnAsk; iOS asks again 6 s after finding the VPN extension busy). The Shortcut would run in that window, after our VPN is down. exitBackstop must still exit. Risks to settle on the 15 first: does opening Shortcuts then work and does iOS still replace the app with Complete and no swipe; can the Shortcut's callback reopen the old copy mid-update (an old copy in front keeps iOS waiting; if so leave out the callback or find a way, and the back run may have to count as sent with no verdict); the window may have to grow if opening Shortcuts takes longer; the owed mark must be cleared so the new copy does not run or ask again, but kept if the Shortcut did not open. If it cannot be made reliable, change nothing and write down why. Out of scope: other apps' installs (progress and success come over our VPN, and dropping the connection cancelled an install in a test), and the Signing Server route. Done when: repeated This iPhone own updates on the iPhone 15 Pro, with another VPN up before, end with the new version installed with no swipe or reopen and that VPN up; and B440's behaviour with the setting off is unchanged. Note journal/2026-11-24-b440-own-update-unaided/notes.md (in-app signing profile on the 15 lacks Network Extensions; our VPN takes Tailscale's place) for the rig. Release note. | files: native/Sources/Sideload.swift, native/sideload/vpn/App/VPNClose.swift, native/sideload/vpn/App/RestoreBack.swift, native/sideload/vpn/App/RestoreShortcutBridge.swift, native/test_selfupdate_here.py, native/sideload/vpn/test_restorebridge.py | split-by: 2026-11-25T15:39:03Z
- [ ] **V26** Release: bump the version where the project keeps it, per its versioning rules (agent-runner's: docs/SETUP.md#versions), move CHANGELOG.md's Unreleased entries under the new version heading, commit to main so the release workflow tags and publishes it. Check: the release workflow passed (gh run list) and gh release view shows the new tag | after: all | moved: yes

### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
- [ ] **C31** (follow-up, later) Storage keys and module-private exports (audit 2026-11-20): one module naming the 55 ifizbox.* storage keys, used by their readers and writers; drop export from module-private exports (164 are used only inside their own module) where no test imports them, or note why in docs/audit.md. Check: node --test; a test that every ifizbox.* string literal comes from the key module. | files: web/app/core/storagekeys.js, docs/audit.md
