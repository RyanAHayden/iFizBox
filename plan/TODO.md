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

- [ ] **F437** (follow-up, normal) Control session 2 asked the person: "Queue the own-update part: run Restore My VPN just before iFizBox closes, tested on the 15? [Queue it (recommended) / Leave it as is]" Carry on from their answer (the session, closed while it waited: resume it with `claude --resume 58be5257-3f4e-46fa-8958-b842e1c63068`). When the answer is to queue work in another project the question names, run `plan add` in that project's own checkout: the answer allows that one command there — your answer (DECIDE Queue the own-update part: run Restore My VPN just before iFizBox closes, tested on the 15? [Queue it (recommended) / Leave it as is]): Queue it
- [ ] **R38** (follow-up, low) Run the F258 setup command for real, with the user: a first 'setup' release (tools/setup/release.sh, needs the user's OK to publish), then with the iPhone 15 by USB once F254f shows a code: install + pairing file written + the app reads it (F254g); on a Mac (universal build: Apple silicon and Intel via arch -x86_64; LLD's ad hoc signature accepted) and on real Windows 11 x64 and ARM64 (Apple Devices app driver on 27015, the Store link 9NP83LWLPZ9K, no window closing under iex). F258 only ran find/trust/Developer Mode reads (Linux x86_64, arm64 under qemu, Windows x64 under wine via a socat bridge). tools/setup/core tools/setup/install.ps1.in tools/setup/install.sh.in tools/setup/__pycache__ tools/setup/release.sh tools/setup/test_setup.py | files: tools/setup/cli | after: F254f — your answer (DECIDE Re-queue the website's computer-install code page that was dropped, or run setup another way? [Re-queue the page / Run without the page / Drop this check]): Re-queue the page — reopened: F436 landed — your answer (DECIDE Publish the first 'setup' release so the setup command can be run for real? [Publish it / Not yet]): Publish it — your answer (BLOCKED Switch on the MacBook Air so it answers ssh; the macOS SDK for the setup release comes from it (ssh mba times out)): Done: it’s up for a moment, we should stop needing it for release and stuff though
- [ ] **V26** Release: bump the version where the project keeps it, per its versioning rules (agent-runner's: docs/SETUP.md#versions), move CHANGELOG.md's Unreleased entries under the new version heading, commit to main so the release workflow tags and publishes it. Check: the release workflow passed (gh run list) and gh release view shows the new tag | after: all | held: yes | moved: yes

### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
- [ ] **C31** (follow-up, later) Storage keys and module-private exports (audit 2026-11-20): one module naming the 55 ifizbox.* storage keys, used by their readers and writers; drop export from module-private exports (164 are used only inside their own module) where no test imports them, or note why in docs/audit.md. Check: node --test; a test that every ifizbox.* string literal comes from the key module. | files: web/app/core/storagekeys.js, docs/audit.md
