# B498c: sign-in claims and anisette identities

## What I did
- `web/app/core/gsa.js` signs in with exactly the client_info and user_agent the anisette server advertises (UA `akd/1.0 CFNetwork/808.1.4` if it advertises none).
- `AppleIdSession.login` tries each server x claim: the advertised claim first, then the current Mac claim. The current stored pair is tried first.
- A 503 (at SRP init or complete, or MidService during provisioning) or -23782 moves on to the next pair. Every other Apple error (-20101, -20970, -22406, -36607, ...) stops. Anisette-side failures move on.
- The current Mac claim is only tried through a server whose advertised client info names a Mac, as BariStore does.
- B498's one retry of a MidService 503 on the same server is removed: move on instead of retrying.
- One anisette identity per (server, client info). The current one sits at the top of the stored state and the others under `others`. Old saved state counts as the advertised one's.
- Email is trimmed and lowercased.
- Tests in `web/app/core/gsa.test.js` use a mocked GSA.
- Probe script copied verbatim as `claims.mjs` in this folder.

## Spec review
- Nothing missing. Fixed a lost space in `gsa.js`. Kept as is: no Mac claim through a non-Mac server (BariStore's rule); the sign-in after a 2FA code rotates like any other, so a 503 there can land on another machine and Apple asks for a code again (the screen handles that step).

## Not done on purpose
- No rotation on o=apptokens or the 2FA endpoints: the token belongs to the identity that signed in.
- No BariStore rule of skipping a claim after two 503s (not asked), so the worst case is every server x claim (8 servers x 2).

## Spelling evidence
- BariStore's current main (`src/apple/anisette.rs`) spells the current Mac `<Mac OS X;26.6;25F84>` and says `<macOS;` gets 503 since 2026-11-19. The task spells `<macOS;26.6;25F84>`, which is what was implemented.
- Live probe 2026-11-27 (`claims.mjs`): SRP init with made-up addresses only (no password, no real account), direct from Linux with Apple's root CA in `NODE_EXTRA_CA_CERTS`.
  - First run: `<macOS;` got HTTP 503 through new.ani.sidestore.io, mac-ani.jkcoxson.com and ani.iloader.app, while `<Mac OS X;` and the advertised claim got -20970 (accepted).
  - Next run: ani3.stikstore.app accepted `<macOS;`. ani.jkcoxson.com, ani2.stikstore.app and anisette.lillq.me returned -20209 for all three variants, because the one made-up address had been reused about ten times.
  - A rerun minutes later with a fresh address per request got -20970 for all variants on new.ani, mac-ani, iloader and ani3.
  - So the 503 comes and goes. win.ani.sidestore.io answered 502.
  - Lesson: use a fresh made-up address per probe request.

## Not verified
- A real Apple ID sign-in (none used). So -23782, 2FA after a claim switch and the password step are only tested against the mock.
- The website through the deployed relay in a browser.
- The jailbreak/sideload app on a phone.
- The Windows-library server.
