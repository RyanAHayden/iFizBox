# B501: spelling of the current Mac claim

## What I did
- Task B501: decide how to spell the free Apple ID sign-in's current Mac claim.
- Re-probed with `journal/2026-11-27-b498c-signin-claims/claims.mjs` (SRP init, made-up addresses, no password), from Linux with `NODE_EXTRA_CA_CERTS=~/.local/share/ifizbox-rig/ca-bundle.pem`, 2026-11-27.
- Two rounds through new.ani.sidestore.io, mac-ani.jkcoxson.com, ani.iloader.app, ani3.stikstore.app, ani.jkcoxson.com, ani2.stikstore.app and anisette.lillq.me:
  - `<macOS;26.6;` got HTTP 503, 14 of 14 times.
  - `<Mac OS X;26.6;` and the advertised claim got -20970 (Apple took the claim), 14 of 14 times.
- win.ani.sidestore.io answered 502 itself (round 1 only).
- Switched `CURRENT_MAC` in `web/app/core/gsa.js` to `<Mac OS X;26.6;25F84>`. The user_agent is unchanged. The test constant in `web/app/core/gsa.test.js` is updated. `node --test gsa.test.js` passes 26/26.
- After the change, ran the script again on new.ani.sidestore.io and ani.iloader.app. The row labelled `mac <macOS;` now sends the shipped constant (its label is stale) and got -20970.
- A saved anisette identity provisioned under the old spelling is kept under `others`. The new spelling gets its own identity, by the existing per (server, client info) rule (read from the code, not tested separately).
- Spec review skipped: small diff, no long brief.

## Not verified
- No real Apple ID sign-in (none used), so the password step and 2FA under the new spelling are untested.
- The Windows-library server (502).
- The deployed website relay and the app on a phone (only the claim string changed; the probe went direct).
- Whether Apple keeps accepting this spelling: B498c saw the 503 come and go.
