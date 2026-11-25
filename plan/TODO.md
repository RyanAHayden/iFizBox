# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs in three places:
the public site, the jailbreak app (a native shell around a WKWebView that installs `.deb`s through a root helper,
docs/native.md) and the sideload IPA, the same shell without the helper, for AltStore sources and signing,
installing and re-signing apps on the phone (docs/sideload.md). It has to feel native: 120 Hz, real swipe-back.
Push notifications for updates; Shortcuts recipes in docs/shortcuts.md. Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [~] **T83** Tools page: the three phones get Start, Use, Stop for F431's remote, and custom buttons: in runner.toml give [run.tools.iphone15], iphone7 and iphone4s page (':PORT', its remote's port) and start, and buttons where the ui scripts have a fitting one-shot action (Home; Wake or Lock; Reboot with a confirm on the 15 only), each taking and freeing the lock as USER. Needs agent-runner's F428a to F428d in the installed release, else runner.toml is refused whole: check the installed release's docs/REFERENCE.md for [run.tools] page and buttons first; when they are not in it, change nothing and block again (plan block ID --until version:<the next one>). Check: run's own config check, Start and Use on one free phone. | files: runner.toml, tools/test_ui_state.py | after: F431 BLOCKED: (until version:0.68.0) waits for the agent-runner release with F428 (tool pages and buttons)
### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

- [ ] **F438a** (follow-up, normal) Second part, after F438's own change (the back run just before iFizBox closes for its own This iPhone update): if F438 built it, repeated This iPhone own updates on the iPhone 15 Pro (10, final build), with another VPN up before, setting on and VPN remembered, in front, each ends with the new version installed with no swipe or reopen and that VPN up, and the new copy does not run or ask again; also runs with the setting off showing B440's behaviour unchanged, runs with no owed back run (no VPN up before), and a run where the app was left (not in front: must not run the Shortcut; still owed, asked at return). Then the release note (release-notes/F438a.md, one plain sentence, only once the runs pass). If any run fails, fix it or turn the change off again and write why. If F438 wrote that it cannot be made reliable and changed nothing, close this with nothing to do. Rig: journal/2026-11-24-b440-own-update-unaided/notes.md. | files: release-notes/F438a.md, journal/2026-11-25-f438a-own-update-restore-runs/** | test: native/test_selfupdate_here.py
- [ ] **V26** Release: bump the version where the project keeps it, per its versioning rules (agent-runner's: docs/SETUP.md#versions), move CHANGELOG.md's Unreleased entries under the new version heading, commit to main so the release workflow tags and publishes it. Check: the release workflow passed (gh run list) and gh release view shows the new tag | after: all | held: yes | moved: yes

### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
- [ ] **C31** (follow-up, later) Storage keys and module-private exports (audit 2026-11-20): one module naming the 55 ifizbox.* storage keys, used by their readers and writers; drop export from module-private exports (164 are used only inside their own module) where no test imports them, or note why in docs/audit.md. Check: node --test; a test that every ifizbox.* string literal comes from the key module. | files: web/app/core/storagekeys.js, docs/audit.md
