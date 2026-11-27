# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs in three places:
the public site, the jailbreak app (a native shell around a WKWebView that installs `.deb`s through a root helper,
docs/native.md) and the sideload IPA, the same shell without the helper, for AltStore sources and signing,
installing and re-signing apps on the phone (docs/sideload.md). It has to feel native: 120 Hz, real swipe-back.
Push notifications for updates; Shortcuts recipes in docs/shortcuts.md. Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [ ] **F449** Filter panel Source rows show each source's icon (as on the Sources tab), All Sources keeps a generic icon. Check: Chromium shot of the panel. | files: web/app/screens/filterpanel.js, web/app/packages.css | model: sonnet
- [ ] **B486** Browse list Filter panel: picking a Source doesn't filter the list properly (user report). Find why in the Filter panel → catalog.refine path for lists opened from Browse (Featured, New, Popular, Free…); check: pick one source, only its packages remain (node --test case in browse-listfilter.test.js). | files: web/app/screens/listfilter.js, web/app/screens/filterpanel.js, web/app/catalog.js, web/app/screens/browse-listfilter.test.js
- [ ] **T86** Promo clip + posts for sideloaders (split into T86c, T86a) | files: marketing/video/**, journal/**
- [~] **T86a** Sideloader posts artifact (the T86 page, same URL): swap in the new 4:5 and 9:16 videos from T86c (upload + download links), update the X and r/sideloaded text to mention the Free Apple ID option next to your own certificate, Copy button per block. Then block CONFIRM: Sideloader posts ready on <page link>. Reply posted, or what to change. | files: journal/** | after: T86a | model: sonnet — reopened: T86c landed — you said, on CONFIRM Check the Sideloader posts page; reply posted, or what to change.: do this instead: User: the sideload promo is far too sped up; make it normal speed. In marketing/video/promo-sideload.html set every SPEED segment to 1 and FASTER to 1 (real time, as the app really moves). Shorten only by tightening the recording script's own pauses/waits in shots-promo-sideload.json (re-record), never by speeding playback or jump cuts; a longer clip (~60-100 s) is fine. Re-render 4:5 and 9:16, play-check a few seconds against the raw recording to confirm 1x, update the journal and marketing/video/README.md, then re-publish the same page https://claude.ai/artifact/9n5ZYu6bfeZPwHSVXRgnQC with the new clips and block CONFIRM again. BLOCKED: shelved: CONFIRM: Check the Sideloader posts page (real-time clip, 107 s); reply posted, or what to change. https://claude.ai/artifact/9n5ZYu6bfeZPwHSVXRgnQC (asked 2026-11-26 15:45)
### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

- [ ] **B491** (follow-up, normal) Restore My VPN and Cellular Installs Shortcut callbacks (x-success/x-error/x-cancel) use a scheme of their own per bundle ID (ifizbox-<bundle id>, written into Info.plist at signing, read from the bundle ID at run time), so a second installed iFizBox copy that also claims ifizbox:// cannot take the callback. See journal/2026-11-26-R107-callback-scheme-two-copies/README.md. Handlers accept both schemes. | files: native/sideload/vpn/App/CellularShortcutBridge.swift, native/sideload/vpn/App/RestoreShortcutBridge.swift, native/Info-sideload.plist | after: R107
- [~] **R105** (follow-up, low) After a release with B479 (a second computer install's new Free Apple ID certificate replaces the held one): on the iPhone 15 Pro, run a computer install (ifizbox.com Computer Install, setup.sh) over the installed Lite copy with a newly made Free Apple ID certificate, then check signing.status's identity serial and localStorage ifizbox.freeid both carry the new serial, and the log says the certificate inside the app replaced the held one. Making the certificate revokes the spare Apple ID's current 'iFizBox Website' one: check Apple's list first. Not checked in B479: computer installs install the published build. | files: journal/** | after: B479 — Start only once release 1.0.5 (V33) is published with B479 in it: the computer install installs the published build. BLOCKED: (after V33) Waits for a published release that includes B479; v1.0.4 is the latest and the 1.0.5 release task was cancelled
- [ ] **V33** Patch release 1.0.5: what landed since 1.0.4 (B477 Changes' Installed scope by source, R103) — cancelled after 0 min: nothing had been done yet — cancelled after 0 min: nothing had been done yet — cancelled after 5 min: nothing had been done yet | after: all | held: yes
### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
- [ ] **C31** (follow-up, later) Storage keys and module-private exports (audit 2026-11-20): one module naming the 55 ifizbox.* storage keys, used by their readers and writers; drop export from module-private exports (164 are used only inside their own module) where no test imports them, or note why in docs/audit.md. Check: node --test; a test that every ifizbox.* string literal comes from the key module. | files: web/app/core/storagekeys.js, docs/audit.md
- [ ] **R106** (follow-up, later) Restore My VPN by automation (optional): check on the iPhone 15 Pro (iOS 27) whether one of our App Intents ("Restore My VPN if due": sets the remembered VPN back only when no install runs, else leaves it to today's back run/ask on return) can live in a Shortcut, with a plain Shortcuts automation 'iFizBox Is Closed, Run Immediately' that runs that Shortcut. Answer: does Set VPN run silently from the automation (no Shortcuts switch, no Allow prompt); does Is Closed fire on Home, app switch and a kill from the switcher; does our intent run while the app is closed or killed and read the restore state. Record findings and a yes/no for building it (setup walkthrough, the intent) in journal notes; no product change. Today's Restore My VPN stays as the fallback either way. Read docs/iphone15.md; ui-15.sh lock. | files: native/intents/App/RestoreVPN.swift, docs/shortcuts.md
