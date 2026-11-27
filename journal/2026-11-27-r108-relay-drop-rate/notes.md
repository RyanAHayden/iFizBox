# R108 Relay drop rate

Measures how often the provisioning WebSocket drops, per listed anisette server, through ifizbox.com's /apple relay. Not measured yet.

Why not yet: the latest tag, v1.0.5, has neither 9ad631bd (B498, new server list) nor ccdedd8b (B498b, forwarding relay). The next release is V35, still waiting.

Live check on 2026-11-27 at 01:27 -05:00:

- /apple/status answers {"on":true}.
- /apple/mac-ani.jkcoxson.com/v3/client_info answers 403 not_allowed.
- /apple/new.ani.sidestore.io/v3/client_info answers 200.

Dry run of measure.mjs against the deployed relay (still the old pass-through), with 3 rounds on new.ani.sidestore.io: 3 of 3 get() OK, every leg including gsa.apple.com through ifizbox.com, 3 sockets, 0 dropped, close code 1005 (the client closes after ProvisioningSuccess). That is too few to give a drop rate. Earlier B498 data had 3 of 12 dropped. The dry run only shows that the script works.

measure.mjs: each round is one get() with a new machine. No Apple ID is used. A socket counts as dropped when it talked and the other end closed it before ProvisioningSuccess, whatever its close code. A socket the client gave up on (Apple's call or the server's reply failed) is not a drop; its failure is in the printed log. The forwarding relay closes with 1011 where the pass-through gave 1006, so counting 1006 alone would miss drops.

After the release:

1. Check that /apple/mac-ani.jkcoxson.com/v3/client_info answers 200, and that the release tag contains ccdedd8b.
2. Run `node <repo>/journal/2026-11-27-r108-relay-drop-rate/measure.mjs <repo> 20` for all listed servers. The script stops nothing early. About 8 servers x 20 rounds takes a while, so run it in the background or one server at a time.
3. Read the TOTAL line for each server: sockets, dropped, stalled, ok, and the close codes. The drop rate is dropped / sockets, not ok (ok includes gsa.js's one retry). `stalled` counts provisioning that hit the 60 s time limit: a relay that stops forwarding without closing shows there, not in `dropped`. No stall has been seen, so that count is untested.

The forward-or-not decision is already made.

## Not verified

- Drop rate of the forwarding relay through Cloudflare for every server (not deployed yet).
- get() through the deployed relay for the seven hosts it refuses today.
- Browser behaviour (the script uses Node's WebSocket).
- Real Apple ID sign-in.
