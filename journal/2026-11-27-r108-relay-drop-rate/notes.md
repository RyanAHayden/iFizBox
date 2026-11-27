# R108 Relay drop rate

Measures how often the provisioning WebSocket drops, per listed anisette server, through ifizbox.com's /apple relay.

Measured 2026-11-27 about 02:00 -05:00, after release v1.0.6 (V35) deployed the site. v1.0.6 contains 9ad631bd (B498 server list) and ccdedd8b (B498b forwarding relay). web/app/core/gsa.js and worker/ are identical between v1.0.6 and this branch. mac-ani.jkcoxson.com/v3/client_info now answers 200 through the relay (it was 403 before the deploy).

## How measure.mjs counts

Each round is one get() with a new machine. No Apple ID is used. A socket counts as dropped when it talked and the other end closed it before ProvisioningSuccess, whatever its close code. A socket the client gave up on (Apple's call or the server's reply failed) is not a drop; its failure is in the printed log. The forwarding relay closes with 1011 where the pass-through gave 1006, so counting 1006 alone would miss drops.

`stalled` counts provisioning that hit the 60 s time limit: a relay that stops forwarding without closing shows there, not in `dropped`. The drop rate is dropped / sockets, not ok (ok includes gsa.js's one retry).

## Results

Node run: `measure.mjs <repo> 20` (Node v26.12.0), every leg including gsa.apple.com through ifizbox.com. 20 rounds per server.

- new.ani.sidestore.io, mac-ani.jkcoxson.com, ani.iloader.app, ani3.stikstore.app, ani.jkcoxson.com, ani2.stikstore.app, anisette.lillq.me: 20 sockets each, 0 dropped, 0 stalled, 20/20 get() OK, all close code 1000.
- win.ani.sidestore.io: 0/20 OK, no socket opened, HTTP 502 every time. Its client_info also answers 502 when asked directly, so the server itself is down.

Raw log: run-node.txt.

Chromium run: `browser.mjs <empty profile dir> 5`, headless Chromium 155 on ifizbox.com using the deployed core/gsa.js and the browser WebSocket, a new machine each round.

- The same seven servers: 5/5 OK, 5 sockets each, 0 dropped, 0 stalled, close 1000.
- win.ani.sidestore.io: 0/5 OK, HTTP 502.

Raw log: run-browser.txt.

Total: 175 sockets, 0 dropped.

- new.ani.sidestore.io: 0 of 25 dropped. With the old pass-through it was about 1 in 4 (3 of 12, earlier B498 data).
- Pooled, 0 of 175 puts the drop rate under about 2% (95%). Per server, 25 sockets only bounds it at about 11%.

## Conclusion

No drops seen. Keep the forwarding relay as it is; the forward-or-not decision was made in B498b. The website's single retry stays; it is harmless.

No follow-up task is filed for win.ani.sidestore.io. It is seventh of eight in the list, answers 502 quickly, and get() moves to the next server. One day of downtime is not reason to remove it.

All runs were from one network, Cloudflare colo ATL, in one half hour.

## Not verified

- Other networks, Cloudflare locations and times of day.
- Browsers other than headless Chromium (Safari/iOS WebKit not run).
- win.ani.sidestore.io provisioning (server down).
- Real Apple ID sign-in (no Apple ID used).
- The stall counter: it has never seen a stall, so it is untested.
- Whether the old pass-through would still drop today was not re-measured; the comparison is with earlier B498 data.
