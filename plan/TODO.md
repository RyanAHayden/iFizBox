# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs in three places:
the public site, the jailbreak app (a native shell around a WKWebView that installs `.deb`s through a root helper,
docs/native.md) and the sideload IPA, the same shell without the helper, for AltStore sources and signing,
installing and re-signing apps on the phone (docs/sideload.md). It has to feel native: 120 Hz, real swipe-back.
Push notifications for updates; Shortcuts recipes in docs/shortcuts.md. Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [ ] **F459** Free Apple ID App IDs, from BariStore (github.com/barismd/BariStore AGENTS.md 'App IDs'). Apps deleted from the phone are forgotten: refresh and the App IDs list drop installed records the phone's app list lacks, but not while a task runs and never on an empty list, so no refresh reinstalls a deleted app. Each extension gets its own App ID under the app's (<appid>.<ext>), reused like the app's. An App ID ends 7 days after it was made; refresh renews profiles, not App IDs, and registers a new App ID only when one is missing or expired. Optional: let the user remove an app's extensions to save App IDs (free limit: 10 per 7 days). Check: freeroute.test.js covers the dropped deleted app, the empty-list guard and the reused extension App ID. | files: web/app/core/freeroute.js, web/app/core/freeroute.test.js | after: B498 — cancelled after 6 min: its work is on wip/F459, go on from there
- [ ] **F458** Free Apple ID refresh without re-signing, as BariStore, AltStore and SideStore do it (github.com/barismd/BariStore AGENTS.md 'Refresh', src/install.rs): for an installed app still signed with the current certificate (keep its cert serial in the installed record), fetch fresh profiles for its App IDs and install them through misagent (com.apple.misagent.shim.remote, Install/Provisioning; idevice has it). Don't re-sign or upload the IPA. Re-sign only apps on an older certificate or an expired App ID. Ask Apple once per run (certificate, device, App IDs, the device's apps) and reuse that for the whole refresh. Check: a native test with a stub misagent shows an app on the current certificate gets a profile install and no installation_proxy upload, and an app on an old certificate is re-signed; then on the iPhone 15 Pro, Refresh renews a free app's expiry without reinstalling it. | files: native/sideload/idevice/IDevice.swift, native/Sources/Sideload.swift, native/sign/tests/sideload/main.swift, web/app/core/freeroute.js, web/app/core/freeroute.test.js | after: B498 — asked to cancel after 0 min: if it was stopped, what was done is on the newest wip/F458 branch, go on from there
- [ ] **K11** No-computer first install on a free Apple ID: today the free route needs Download for a Computer Install once (docs/signing.md 'Free Apple ID'), because iOS refuses free-profile apps from a website (MIInstallerErrorDomain 111). BariStore (github.com/barismd/BariStore) needs no computer: it runs as a static aarch64-musl binary inside Open Minis (an App Store app with a terminal, installed with wget | sh), serves its UI on localhost, pairs on the phone through Settings > Developer Mode > Pair with (iOS 27, a _remotepairing-pairable-host._tcp Bonjour advert), tunnels through LocalDevVPN and installs through installation_proxy. Concept: options for an iFizBox helper that does the same: a minimal pair + tunnel + install helper that ifizbox.com drives over localhost and that first installs the real sideload app; or the whole sideload app's device layer; or no helper. Cover how it reuses native/sideload/idevice, the Open Minis dependency, what it costs to keep up, the security of a localhost API (origin checks, a token), and iOS versions before 27. A concept only: build nothing. | after: all above
- [ ] **V36** Release: bump the version where the project keeps it, per its versioning rules (agent-runner's: docs/SETUP.md#versions), move CHANGELOG.md's Unreleased entries under the new version heading, commit to main so the release workflow tags and publishes it. Check: the release workflow passed (gh run list) and gh release view shows the new tag | after: F458, F459, B498c, B498d — Patch release (1.0.7), user 2026-11-27: ships F458, F459, B498c, B498d. Not K11 (a concept).
### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

- [ ] **C76** (follow-up, low) The other IndexedDB stores still handle an ended transaction their own way: core/myipas.js and signing/identity.js show 'IndexedDB aborted' with no retry, and core/changes.js keeps its own copy of the retry; move all three onto idbRunner in core/cache.js (added by B497). Check: node --test web/app/core web/app/signing | files: web/app/core/cache.js, web/app/core/changes.js, web/app/core/changes.test.js, web/app/core/myipas.js, web/app/signing/identity.js | held: yes — asked to cancel after 6 min: if it was stopped, what was done is on the newest wip/C76 branch, go on from there
### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
