# B498d: GrandSlam transport

Three details from BariStore (`AGENTS.md` "Apple sign-in", `src/apple/gsa.rs`, `src/srp.rs`) checked against ours.

## What I did
- **SRP M1 and the 434 resync: no code change.** `web/app/core/gsa.js` (`AppleIdSession.init`) already hashed M1 as H(N) xor H(PAD(g)) and already resynced on 434. Added tests in `web/app/core/gsa.test.js`:
  - a known-answer test with BariStore's GrandSlam vector (M1 and the premaster prefix match);
  - a 434 resync through `anisetteV3`: the resync data is taken as `<data>` or as a string, `get_headers` gets `sim`, `device_id` and `md_lu`, and the second init and the complete use the new cpd.
- **Fresh connection per request to gsa.apple.com.** Apple answers a reused connection with 5xx.
  - Relay (`worker/src/apple-relay.js`): sends `Connection: close` to gsa.apple.com. Node's fetch in `worker/node.mjs` honours it, so the self-hosted relay opens a new connection each time.
  - Native app (`native/Sources/Paid.swift`, `net.request`): a one-off `URLSession` for gsa.apple.com, invalidated after its task finishes. Other hosts keep the shared session.
  - The browser-to-relay hop is unchanged: the browser can't choose it, and it isn't Apple's connection.
- A test in `gsa.test.js` covers the relay header and checks `Paid.swift` by its source pattern, because the gate has no iOS runtime to run it.

## Measured
- Local server logging source ports, Node 26 `fetch`: with `Connection: close`, each request opens a new connection; without it, they reuse one.
- Local workerd 1.20261127.1: drops the `Connection` header and reuses one socket for 3 requests, with and without it.
- So on ifizbox.com (Cloudflare) the relay cannot force fresh connections through `fetch()`. The only way found is `cloudflare:sockets` with hand-written HTTP/1.1. Not done: no 5xx has been tied to reuse on the hosted relay.

## Not verified
- No live sign-in against Apple (needs an account and 2FA). The 434 resync was tested only against a fake, not a real Windows-library server.
- Cloudflare production egress connection reuse: only local workerd was measured.
- The native one-off session on a device: compiled by the gate's native build only.
- Whether URLSession opens a new TCP connection per session on iOS: documented behaviour (each session has its own connection pool), not measured.
