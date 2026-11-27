# B498b: the relay forwards the provisioning WebSocket itself

**Seen.** Through the relay, new.ani.sidestore.io reached GiveEndProvisioningData, then "WebSocket error" (B498: `journal/2026-11-27-b498-free-apple-id-anisette/`).

**Did.**
- `worker/src/apple-relay.js`: the Worker no longer hands the anisette server's 101 to the browser. It holds both sockets (WebSocketPair), forwards each message, and closes the other side. Close codes map 1005 to 1000 and 1006 to 1011, since those two can't be sent. binaryType is arraybuffer. A server that won't open a WebSocket gets a 502 JSON with code `upstream`.
- `worker/test.mjs`: end-to-end test. It runs gsa.js anisetteV3 and relayTransport through appleRelay to a mock anisette server that drops the TCP connection, without a close frame, after its last message. Node has no WebSocketPair or 101 Response, so appleRelay takes `Pair` and `upgrade` as options.
- The client-side retry from B498 stays: gsa.js tries the same server once more when a provisioning socket that had already talked breaks.

**Check 1: the servers (local `wrangler dev`).** `check.mjs` with `wrangler dev -c wrangler.preview.toml --port 28712` (wrangler 4.168.0 from the npx cache). 7 of 8 servers provisioned and `get()` returned headers. Each socket closed 1000 clean. win.ani.sidestore.io answered HTTP 502 itself. Anisette HTTP and WebSocket went through local `wrangler dev`. gsa.apple.com went through the deployed ifizbox.com relay, because local workerd doesn't trust Apple's root CA.

**Check 2: the close (real workerd, mock server).** `mock.mjs`, `harness.js` and `client.mjs`: harness `wrangler dev` on port 28715, mock on 28714, 20 sockets each.

| Case | Pass-through (old) | Forwarding (new) |
|---|---|---|
| Server sends a close frame | message, then 1000 | message, then 1000 |
| Server ends or resets TCP with no close frame | message, then 1006 and an error event (40 of 40) | message, then 1011, no error event (40 of 40) |

**Honest limit on the cause.** Locally the pass-through still delivered the last message before the 1006. What was seen through Cloudflare's edge was the last message missing. That the edge loses it in the pass-through is inference, not proven. If the message never reaches the Worker, the page now gets a close ("provisioning socket closed early") and B498's one retry covers it.

**Not verified.**
- The fix on Cloudflare's edge. That needs a deploy, which this task does not do (`wrangler dev --remote` also uploads). So the drop rate through ifizbox.com is unmeasured. R108 (open) measures it after the next release.
- A real browser. The checks used Node's WebSocket.
- A real Apple ID sign-in.
- win.ani.sidestore.io.
