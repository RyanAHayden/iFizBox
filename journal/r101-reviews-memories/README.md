# R101c reviews.db and memories

## reviews.db: decision
Removed from git (`git rm reviews.db`, a 0-byte file added by F332's commit by accident).
Nothing reads the tracked file: `git grep reviews.db` hits only
- `worker/node.mjs:85` default for `REVIEWS_DB` (a runtime path; node:sqlite creates the file when it is missing, and a 0-byte file is a new database to SQLite, so nothing depends on it existing),
- `worker/src/d1-sqlite.js:2` (a comment), `worker/README.md`, `worker/Dockerfile` (`/data/reviews.db`, inside the image volume),
- journal/plan text.
`worker/test.mjs`, `tools/` and `package.json` never name it.
Follow-up: running `node worker/node.mjs` from a checkout recreates it untracked (F187 noted this), so a `.gitignore` line is queued.

## Memories that hold only for the removed Tailscale route
Memory folder: ~/.claude/projects/-home-ryha-repos-iFizBox/memory. Nothing deleted; the person decides.

Likely stale (about the in-app Tailscale route, removed with C64):
- `iphone15-tailscale-login-needs-owner`: Lite app's Tailscale Sign In, pairing and ad hoc identity for that route.
- `tailscale-open-by-bundle-id`: opening the Tailscale app from our app via signing.openApp; the route that did it is gone.
- `tailnet-probe-phones-from-desktop`: probing a phone's RemotePairing/lockdownd over the tailnet; only mattered for iOS opening pairings over Tailscale (R70).

Partly stale (a section or sentence mentions the route; the rest holds):
- `iphone15-lockdown-over-wifi`: the Wi-Fi LAN probe holds; the "Tailscale path is refused" line is route history.
- `iphone15-ui-gotchas-r53`: the Settings VPN-switch tap and its link to the Tailscale login memory go; Camera/Install tips hold.
- `vpn-needs-network-to-start`, `test-on-15-not-user`, `MEMORY.md` index lines: only mention Tailscale in passing.

Still valid (Tailscale is only the desktop's dev transport, not the removed route):
- `test-ipa-via-tailscale-page`, `iphone15-local-source-via-tailscale-serve`: serve a test IPA or source from the desktop; ATS needs https. Keep unless the desktop stops using Tailscale.

Decision (D31, 2026-11-24): the person chose "delete 3, trim 3". Deleted the three "Likely stale" memories and their index lines. Trimmed `iphone15-lockdown-over-wifi`, `iphone15-ui-gotchas-r53` and `test-on-15-not-user` (and their index lines), plus the dead links to the deleted memories in `iphone15-local-source-via-tailscale-serve`. `vpn-needs-network-to-start` kept as is: its Tailscale lines describe the test phone's other VPN, which still holds. The two desktop-transport memories are kept.

Not verified: whether the route's removal also dropped the Lite app's pairing over Tailscale beyond what R101a lists; I did not re-test any memory on a phone.
