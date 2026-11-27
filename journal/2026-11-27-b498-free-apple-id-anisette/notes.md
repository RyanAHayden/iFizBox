# B498: free Apple ID sign-in fails with "No anisette server could provision"

**Did.**
- Server lists: the old SideStore v3 servers that answered reported the stock client info `<MacBookPro13,2> <macOS;13.1;22C65>` (or the `MacBookPro15,1` one). BariStore's skip rule (`src/apple/anisette.rs`) treats those, and any client info containing `<Android;`, as Android-library servers. They were removed from the app's list and the relay's list. A saved machine on a removed server is provisioned again on a listed one.
- Listed and provisioning in the checks: new.ani.sidestore.io, mac-ani.jkcoxson.com, anisette.lillq.me, ani.iloader.app, ani3.stikstore.app, ani.jkcoxson.com, ani2.stikstore.app.
- Direct probe failed at finishMachineProvisioning with HTTP 401: ani.846969.xyz, ani.sidestore.zip, ani.npeg.us. ani.sidestore.io and ani.sidestore.app returned 502 on client_info at probe time. win.ani.sidestore.io returned 502 (never verified further).
- `web/app/core/gsa.js`: the fallback client info is the macOS 10.12.6 string the good servers advertise, not the stock Android-library string.
- Relay WebSocket: the client (gsa.js) tries the same server once more when a provisioning socket that had already talked breaks. Re-provisioning the same identifier worked on three servers. The Worker's pass-through (`worker/src/apple-relay.js`) is unchanged.
- A MidService 503 gets one retry, then the next server. No claim rotation.

**Drop data.** Through ifizbox.com, new.ani.sidestore.io dropped 3 of 12 sockets (twice) with close 1006 at the moment the server sends its last message and closes. Direct: 0 of 12. Local `wrangler dev`: 0 of 16. ani.846969.xyz through the deployed relay: 0 of 12. Idle time is not the cause, since servers hold the socket 20 s or more. The likely cause is Cloudflare's WebSocket pass-through losing the last frame. That is inference, not proven.

**Considered, not done.** Forwarding the frames inside the Worker through a WebSocketPair. It can't be checked without deploying to Cloudflare, so it waits for a follow-up (`plan add R`, which names this folder).

**Split.** The task was split mid-session into B498a (server lists, Android-library skip), B498b (relay WebSocket), B498c (sign-in client info claims, 503 rotation) and B498d (new connection per GSA request, hsc 434 resync, SRP check). Done here: a; b as the client-side retry; from c only the fallback string and the 503 retry. Nothing of d. No -23782 Mac claim and no claim rotation on 503.

**End-to-end check.** `wrangler dev` cannot do the Apple leg: gsa.apple.com answers 403 (HTML) to local workerd even with NODE_EXTRA_CA_CERTS. So `check.mjs` sent the anisette hosts (HTTP and WebSocket) through local `wrangler dev -c wrangler.preview.toml` with this branch's allow-list, and gsa.apple.com through the deployed ifizbox.com relay: 7 of 8 provisioned and `get()` returned headers. win.ani.sidestore.io gave 502.

**Not verified.**
- The new relay hosts on the deployed ifizbox.com relay. They are allowed only after the next deploy, which is not this task.
- The whole path through one single relay in a browser.
- The socket drop rate of servers other than new.ani and 846969, through Cloudflare.
- A real Apple ID sign-in (no Apple ID was used).
- win.ani.sidestore.io.
- The iPhone app (direct transport) on a device: not needed for this list change, not run.

**Probe scripts** (copied from the scratchpad of the session that ran them; paths and ports are the ones used that day):
- Node needs Apple's root CA to call gsa.apple.com directly. Convert https://www.apple.com/appleca/AppleIncRootCertificate.cer to PEM and set `NODE_EXTRA_CA_CERTS` to it.
- `probe.mjs <repo> <direct|relayBase> server...`: `repo` was `/home/ryha/runs/iFizBox/s1`.
- `ws.mjs <host> <relay|direct|local> <seconds>`: `local` used `ws://localhost:18498`; `relay` used `wss://ifizbox.com`.
- `check.mjs`: hard-codes repo `/home/ryha/runs/iFizBox/s1` and local relay `http://localhost:28611`. As copied it runs one round; an earlier run with two rounds, on the first three servers, showed that the same identifier provisions again.
- Spec review: no code change. The review noted that the Android-library rule matches only the two stock strings and `<Android;`, as BariStore's does.
- Follow-up filed: R108 (drop rate through the deployed relay).
