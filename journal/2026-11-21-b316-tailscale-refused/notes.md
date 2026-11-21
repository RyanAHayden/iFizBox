# B316: "refused RemotePairing on every port" is misdiagnosed as a lost pairing

## Diagnosis (written early, for the control session)

Measured 2026-11-21 ~22:40 UTC from the desktop (a tailnet peer, same tailnet user as both phones, no tags) and on
the iPhone 15 Pro (`ui-15.sh`, lock B316), iFizBox 0.19.1 (4070) installed there.

1. **The user's phone refuses every TCP port over Tailscale, not only RemotePairing.** The user's phone is the
   tailnet node `iphone192` (100.123.95.114, iOS, online, key valid to 2027-05-14). From the desktop:
   `100.123.95.114:49152` (RemotePairing) **refused**, `:62078` (lockdownd) **refused**, both at about the round
   trip (40-130 ms), so the refusal comes from the phone's end. `tailscale ping` and a TSMP ping to it answer. The 15
   on the same tailnet: `100.109.186.91:49152` **open**, `:62078` **open**, `:49153` refused (nothing listens
   there). So on the user's phone nothing accepts TCP from the tailnet right now. The pairing can't be the cause:
   lockdownd's 62078 doesn't depend on iFizBox's pairing at all.
2. **What differs: the user's phone is on cellular.** Its tailnet endpoint is 174.252.157.109 (Verizon Wireless);
   the 15 is on home Wi-Fi. Ruled out on the 15:
   - Tailscale's "block incoming connections": the iOS Tailscale app (1.104.7) has no such setting (its Settings:
     Device Name, DNS, Subnet Routing, VPN On Demand, Tailnet Lock, Notifications).
   - The tailnet's access rules: same user, no tags on either phone, and the desktop reaches the 15.
   - A locked screen: with the 15 locked, 49152 and 62078 stayed open for 45 s (the 15 has no passcode, so a locked
     phone with a passcode isn't fully covered).
   Most likely iOS only accepts these services over the network while Wi-Fi is up (lockdownd's and remotepairingd's
   network listeners are Wi-Fi features). **Not proven**: the 15 has no SIM, so it can't be tested off Wi-Fi.
3. **iFizBox can mistake cellular for LocalDevVPN.** `VPNCheck.status()` (native/sideload/idevice/VPNCheck.swift)
   says `localDevVPN: true` when a connect to 10.7.0.1 is *refused*, not only when it connects. Off Wi-Fi with
   Tailscale on, 10.7.0.1 goes out over cellular, where the carrier network can refuse it at once. Then:
   - Pairing shows "LocalDevVPN On" (the user saw that while installing through Tailscale);
   - with iFizBox's Tailscale node signed out (`useForInstall` false), `decideRoute` picks This iPhone because
     `localDevVPN` is true, and the Session connects to 10.7.0.1, where every port is refused:
     `refused: this iPhone refused RemotePairing on port 49152: it no longer has this pairing. Pair again`. That is
     the user's exact error, and why signing Tailscale back in looked like the fix.
   On the 15 (home Wi-Fi) 10.7.0.1 is silent, so idevice.status says `localDevVPN: false, otherVPN: true`, as it
   should.
4. **After signing back in, still refused on every port**: then the Session goes through Tailscale to the phone's
   own tailnet address, and point 1 applies: the phone refuses everything from the tailnet while on cellular. Pair
   Again can't help with that.

The 15 right now: the app is signed out of Tailscale (since R48/R57; signing in needs the owner's tailnet login),
Connect With: Tailscale, the phone's Tailscale VPN on (100.109.186.91), paired (`rp`).

## Which route pairing, verify and installs use (user's question)

- **Pairing doesn't go over either VPN.** `IDevice.pairOnPhone` listens on every interface and advertises the app
  over Bonjour (`_remotepairing-pairable-host._tcp`); iOS (Settings > Privacy & Security > Developer Mode) connects
  to it on the phone itself. The Pairing page waits for "a VPN on" only because verify and installs need one after.
- **Verify (Check Connection) and installs** take Tailscale when `Tailscale.useForInstall()` (iFizBox signed in,
  the Tailscale app's VPN up, Connect With not LocalDevVPN), else LocalDevVPN's 10.7.0.1. That is the rule the user
  asked for. What broke it was the false `localDevVPN: true` (point 3 above): the Pairing page's row names
  `verifyVPN(st)`, which said "LocalDevVPN On" because of it, and with iFizBox signed out the Session went to
  10.7.0.1. Fixed in VPNCheck (below). On the 15 after the fix: `route: "en0"`, `localDevVPN: false`.

## iOS 27's Developer Mode page (user's question)

Followed Pairing's "Where to Type It" steps on the 15 (iOS 27.0.1): Settings > Privacy & Security > Developer Mode.
Shots: `privacy-security.jpg`, `developer-mode.jpg`, `paired-row.jpg`.
- The Developer Mode page now has two groups under the switch: **Paired Devices** (iFizBox listed, already paired)
  and **Other Devices** (a spinner while it browses; "Pair with iFizBox" shows there while the app advertises).
  The walkthrough's third screenshot (`img/pair/3-pair-with-ifizbox.jpg`) shows the Other Devices row, so it still
  matches; no new place for the code was found (the code is typed in iOS's own prompt after tapping the row).
- Tapping the paired **iFizBox** row opens a page iOS 27 has: About (Model Name "Mac17,7", Serial Number
  "AAAAAAAAAAAA": idevice's pairable-host identity), **Last Used** (11/21/26) and **Unpair This Device**. Last Used
  is a cheap hint for a person: it says whether iOS saw iFizBox's pairing used recently. Not added to the walkthrough
  (it's not a step); worth a line in the FAQ if pairing questions come up.
- Settings' root also has a **Developer** row now (the developer disk image is mounted on the 15 by the rig), which
  a user's phone without Xcode won't show. Not something the walkthrough needs.

## What changed

Native (sideload build):
- `native/sideload/idevice/VPNCheck.swift`: a refused 10.7.0.1 counts as LocalDevVPN only when the system routes
  10.7.0.1 into a tunnel interface (`routeInterface()`: a UDP connect, then the source address's interface).
  idevice.status carries `route` (e.g. `en0`, `utun3`) for logs and the page.
- `native/sideload/idevice/IDevice.swift` `findRemotePairingPort(via:probe:)`: when every RemotePairing port is
  refused, lockdownd's 62078 is probed over the same route as a control; refused too means the route refuses
  everything: `route_refused: this iPhone refused every connection through <VPN>, lockdown's port 62078 too, so it
  isn't the pairing`. Only a refusal with lockdownd answering stays `refused` (Pair Again). The Session passes its
  route's name.
- `native/sideload/tailscale/Tailscale.swift`: `signedOutByTailnet()` drops `{name, keyExpiry}` (UserDefaults and
  Keychain; the node's state and machine key stay, as for Sign Out, B301) when the tailnet logged the node out:
  `beginInstall` on NeedsLogin (now code `tailscale_signed_out`), `tailscale.test` when the node starts NeedsLogin or
  expired (answers `needs_login` before probing) or TSTest says expired/needs_login. tailscale.status then says
  `signedIn: false`, so every page says Sign In instead of Ready. `tailscale.test` passes `route_refused` through.

Web:
- `core/installroute.js`: `tailscaleProblem(st)` (Tailscale the way in and iFizBox signed out, or Connect With
  Tailscale and its VPN off); `verifyFailure` checks it first for every connect code (refused, pairing_rejected,
  pair_again, early eof, bad_pairing) and maps the shell's `tailscale_signed_out`/`needs_login`/`expired` and
  `route_refused`; Pair Again only when Tailscale is fine. `routeFailureOf(err, st)` gives {title, message, short,
  fix, button}; `routeFailure` / `rememberRouteFailure` / `clearRouteFailure` keep it in localStorage
  (`ifizbox.routeFailure`, event `ifizbox:route-failure`). `installStatus(..., {failure})` turns Ready to Install into
  the failure (red, its fix as the action row) until a check passes. tailscaleTestResult words needs_login/expired
  as Tailscale Is Signed Out and route_refused.
- `core/signing.js` `deviceError`: the two new shell codes with their fix button.
- `signing/route.js`: a This iPhone install that fails is re-worded with idevice.status read then (`routeWords`) and
  remembered; the alert gets the fix button (`runFix`: Install Apps With for Sign In, Pairing, Open Tailscale, Open
  LocalDevVPN); the install log gets the same message. An install that goes through clears the failure.
- `screens/installroute.js`: Check Connection clears the failure on a pass and remembers it on a fail, with the fix
  button for Tailscale/route failures; `autoCheck` runs a quiet Check Connection when Installation & Signing,
  Pairing (paired) or Install Apps With opens with a failure kept (at most every 15 s; after a pairing at once).
  Install Apps With says the failure in This iPhone's footer with its fix row (in Tailscale's group when that group
  already shows Sign In). A sign-in's pairing check (recheckPairing) or a verified Test Connection clears it.
- `screens/home.js`: the signing slot shows the failure (red "close" tile, "Installs are failing · Fix in Settings")
  for the sideload app on This iPhone; a signing problem that stops every install stays first.
- Glossary: Route Failure.

## On the iPhone 15 Pro (why the phone: the native route detection, the shell's codes and the real WebKit page)

Build 4074 from this branch, `ui-15.sh install` (pairing and identity kept). App signed out of Tailscale, Connect
With Tailscale, the phone's Tailscale on, paired:
- idevice.status: `localDevVPN: false, otherVPN: true, route: "en0"`.
- Pairing > Check Connection: "Tailscale Is Signed Out … Sign In" (`check-signedout.jpg`); before this it said
  "Turn On Tailscale" although Tailscale was on. The x stays on the button.
- Sign In opened Install Apps With: This iPhone's group with the failure footer and a Sign In row
  (`with-failure.jpg`; that build still had the second Sign In row, fixed after: one row, footer in Tailscale's group,
  covered by `installroute-b316.test.js`, not re-run on the phone).
- Home: red "Tailscale Is Signed Out · Installs are failing · Fix in Settings" tile (`home-failure.jpg`); a tap
  opens Installation & Signing, whose status says Sign In to Tailscale (`main-failure.jpg`).

## Tests

`node --test web/app`: 3102 pass. New: `web/app/core/installroute-b316.test.js` (refused + signed out → Sign In;
refused + Tailscale fine → Pair Again; the shell's codes; kept until a check passes; status override),
`web/app/screens/home-b316.test.js` (Home's slot after a failed install, cleared after a pass),
`web/app/screens/installroute-b316.test.js` (automatic check, Install Apps With groups). `native/sideload/*`
unit tests pass; the IPA built (`make -C native package`).

## Not verified

- **The user's exact case** (iFizBox signed in, phone on cellular, every port refused through Tailscale →
  route_refused "Tailscale Refused"): needs the owner's tailnet login on the 15 (signed out since R48/R57) and a phone
  off Wi-Fi with cellular (the 15 has no SIM). Filed R71 (on the 15 after a login) and R70 (prove the Wi-Fi vs
  cellular cause on the user's phone from the desktop when it's on Wi-Fi).
- **The cellular cause itself** is inferred, not proven (point 2 above): R70.
- **VPNCheck's tunnel-route rule with LocalDevVPN on**: LocalDevVPN isn't set up on the 15 (it's on Tailscale), so
  `route` for a real LocalDevVPN tunnel (expected `utunN`) wasn't seen. A connect that succeeds still counts as on
  whatever the route, so a working LocalDevVPN reads the same as before.
- **An install's alert and log with a route failure** on the phone: with iFizBox signed out, decideRoute already
  sends installs to the Signing Server (its Sign In to Tailscale alert), so no This iPhone install could fail there;
  covered by `home-b316.test.js` (routeWords) only.
- **The automatic check on the phone**: it runs on page open with a failure kept; the shots show the pages after it,
  but no log line was read to confirm when it ran (Web Inspector shows no network for bridge calls).
- **signedOutByTailnet** (the tailnet logging the node out): needs a signed-in node to expire; R71.

## Log

- Tried Tailscale's "block incoming connections" as the cause: the iOS app has no such setting.
- Tried a locked screen as the cause: the 15 stayed reachable locked (no passcode on it).
- Used `sed -i` once on a test file (a limit 56 → 70 to match installstatus.test.js's 70-character rule); the rules
  ask for the edit tool. No harm, noted.
