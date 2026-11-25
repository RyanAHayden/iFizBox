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

- [ ] **F438a** (follow-up, normal) Second part, after F438's own change (the back run just before iFizBox closes for its own This iPhone update): if F438 built it, repeated This iPhone own updates on the iPhone 15 Pro (10, final build), with another VPN up before, setting on and VPN remembered, in front, each ends with the new version installed with no swipe or reopen and that VPN up, and the new copy does not run or ask again; also runs with the setting off showing B440's behaviour unchanged, runs with no owed back run (no VPN up before), and a run where the app was left (not in front: must not run the Shortcut; still owed, asked at return). Then the release note (release-notes/F438a.md, one plain sentence, only once the runs pass). If any run fails, fix it or turn the change off again and write why. If F438 wrote that it cannot be made reliable and changed nothing, close this with nothing to do. Rig: journal/2026-11-24-b440-own-update-unaided/notes.md. | files: release-notes/F438a.md, journal/2026-11-25-f438a-own-update-restore-runs/** | test: native/test_selfupdate_here.py
- [ ] **V26** Release: bump the version where the project keeps it, per its versioning rules (agent-runner's: docs/SETUP.md#versions), move CHANGELOG.md's Unreleased entries under the new version heading, commit to main so the release workflow tags and publishes it. Check: the release workflow passed (gh run list) and gh release view shows the new tag | after: all | moved: yes
- [ ] **T84a** (follow-up, normal) Lock button (the phone's screen lock, not the UI lock) for all three test phones (user 2026-11-25): on the 15 and 4S cards in runner.toml (the 7 has one) and on every remote page. ui-15.sh and ui-7.sh have lock-button; add it to ui-4s.sh with activator's sleepbutton, as its tidy does. Check: test_remote_15.py per phone; press once on each phone. | files: runner.toml, tools/remote-15.py, tools/ui-4s.sh, tools/test_remote_15.py | model: sonnet
- [ ] **T84b** (follow-up, normal) Stopping a phone's remote locks its screen (user 2026-11-25). stop() in tools/remote-15.py only unlocks (tidies) when USER holds the phone, so a free phone stays on; the Tools page kills the process group 4 s after SIGTERM (device_page.py TERM) while the 15's tidy takes up to 180 s, so do it in a detached process with a timeout. Free or USER-held: lock the screen, release the UI lock. Task-held: never touch it. The side button toggles: an already dark phone ends dark. Unreachable: Stop still ends and the UI lock is freed. Check: test_remote_15.py with stub scripts for those cases; on each phone, stop with the screen on and off. | files: tools/remote-15.py, tools/ui-15.sh, tools/ui-7.sh, tools/ui-4s.sh, tools/test_remote_15.py | after: T84a

### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
- [ ] **C31** (follow-up, later) Storage keys and module-private exports (audit 2026-11-20): one module naming the 55 ifizbox.* storage keys, used by their readers and writers; drop export from module-private exports (164 are used only inside their own module) where no test imports them, or note why in docs/audit.md. Check: node --test; a test that every ifizbox.* string literal comes from the key module. | files: web/app/core/storagekeys.js, docs/audit.md
- [ ] **T84** (follow-up, later) Tools page and phone remotes: a Lock button for all three test phones, and the phone's screen locks when its remote is stopped (user 2026-11-25: 'our tools need a lock button for the devices, and they could auto lock when you stop them'). 'Lock' is the phone's screen lock, not the USER/agent UI lock. 1. Lock button everywhere: the 15 and 4S cards in runner.toml lack one (the 7 has it), and no remote page has one. ui-15.sh and ui-7.sh already have lock-button; add it to ui-4s.sh (activator's sleepbutton, as its tidy uses). 2. Stop locks the screen: tools/remote-15.py stop() today only runs unlock (whose tidy locks the screen) when USER holds the phone, so a free phone left awake stays on. Take the free lock as USER, lock the screen, release it. Never touch a phone a task holds. The side button toggles, so check the screen state or wake first: an already dark phone must end dark. It must finish before the runner's Stop kills the process (TERM in agent-runner's device_page.py; the 15's tidy may take up to 180 s); an unreachable phone must not hang Stop. Check: test_remote_15.py with stub ui scripts (free, USER-held, task-held, unreachable; the new command per phone); on each phone once, stop with the screen on and with it off, both end dark. | files: runner.toml, tools/remote-15.py, tools/ui-15.sh, tools/ui-7.sh, tools/ui-4s.sh, tools/test_remote_15.py
