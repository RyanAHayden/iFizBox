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

## Log
