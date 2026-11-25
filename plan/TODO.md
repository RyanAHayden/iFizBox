# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs in three places:
the public site, the jailbreak app (a native shell around a WKWebView that installs `.deb`s through a root helper,
docs/native.md) and the sideload IPA, the same shell without the helper, for AltStore sources and signing,
installing and re-signing apps on the phone (docs/sideload.md). It has to feel native: 120 Hz, real swipe-back.
Push notifications for updates; Shortcuts recipes in docs/shortcuts.md. Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [ ] **F439** (follow-up, high) Cleaner release notes, rewritten before every release. Recent ones say everything twice (summary lines, then the same as bullets: 0.34.0), paste raw task sentences (0.35.0) and end with a footer about the download files. (1) One list, no summary block: 1-6 bullets, most important first, each one short sentence of at most 100 characters, one topic per bullet, related changes merged, small fixes together in one "Smaller fixes" bullet; update the format and example in docs/release.md. (2) No download text or links: drop the IPA/.deb footer from release.sh's default notes and the "Release notes: <url>" line altsource.py's note_text adds to new versions (old entries stay as they are). (3) A required simplify step: with any release-notes/*.md waiting, publish.sh needs --notes (a real release refuses without it, --dry-run still prints the raw list as a draft), and publish.sh refuses, before its version commit, a notes file that breaks (1) or (2), or repeats a bullet, naming the line. The release session reads the waiting notes, merges and shortens them, re-reads the result once as a user would (what is said twice? what can go?), then publishes. With none waiting the notes stay "Smaller fixes and improvements." Say so in docs/release.md and in one AGENTS.md line, so the release task finds it. Check that the app's noteLines (web/app/core/selfupdate.js) still shows the first 4 bullets. Check: tests for the footer and link gone, for publish.sh refusing missing, long, repeated and linked notes, and for a good file passing; tools/check.sh. Do not edit published releases. | files: tools/publish.sh, tools/release.sh, tools/altsource.py, tools/test_release.py, tools/test_altsource.py, docs/release.md, release-notes/README.md, AGENTS.md | split-by: 2026-11-25T19:07:13Z
### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
- [ ] **C31** (follow-up, later) Storage keys and module-private exports (audit 2026-11-20): one module naming the 55 ifizbox.* storage keys, used by their readers and writers; drop export from module-private exports (164 are used only inside their own module) where no test imports them, or note why in docs/audit.md. Check: node --test; a test that every ifizbox.* string literal comes from the key module. | files: web/app/core/storagekeys.js, docs/audit.md
