# R96: "Unable to Verify App" on the first launch

## Question
On 2026-11-24 the user saw this on the first launch of a just-installed app (screenshot
`.runner/uploads/20261124-131614-IMG_2358.png`):

> Unable to Verify App: An Internet connection is required to verify trust of the developer
> Apple Distribution: Ian Smith (S8NFX3A2LT)

Tapping Cancel and launching again worked. Why does the first launch need the internet, and what should the
install tell the user?

## What I did
- **Rig:** iPhone 15 Pro on iOS 27, Wi-Fi only, our VPN on, Tailscale on. Driven by `tools/ui-15.sh`, with
  `ios syslog` written to a scratch file.
- **Test apps:** the tiny-ifizbox fixture with its Info.plist rewritten to `com.ryha.ifizbox.r96a` and
  `com.ryha.ifizbox.r96b`. Each was signed and installed by `tools/ui-15.sh install` with the RSideload ad hoc
  profile (UUID `69d9e535-…`, app ID `S8NFX3A2LT.com.ryha.sideload`, ADHOC, created 2026-11-20, expires
  2027-11-19).
- **Network changes:** Airplane Mode toggled from Control Center.
- **Profile round trip:** removed and re-installed the same RSideload profile file with
  `pymobiledevice3 provision remove` / `install`. The UUID did not change. The backup is in the scratchpad.

## Findings
- **r96a, first launch on Wi-Fi:** no dialog. The syslog shows SpringBoard asking trustd to evaluate the chain.
  The leaf's OCSP answer was `revoked=(null) definitive=(null) fetchFailed=0`. The intermediate's was
  `revoked=0 definitive=1`, which is a cached answer. misagent then copied the profiles for the cert and sent
  four (RSideload and three "sidedrop adhoc"). libmis picked one for validation, and amfid logged a
  `Trust evaluate failure` notice (harmless). libmis reported `Authoritative`, and the app launched. No
  online-auth-agent line appeared at all.
- **r96b, a fresh install, first launch in Airplane Mode:** no dialog. Same path, and the app launched.
- **After the profile re-install, r96b launched again in Airplane Mode:** still no dialog. Re-installing the same
  profile does not reset the validation.
- **So:** on this phone the profile and its cert are already validated and cached. A new bundle ID under a
  validated profile does not need the online check. Network state does not matter once validated.
- **The dialog needs an un-validated profile:** a new profile UUID, or an expired validation cache, on the
  user's phone. SideDrop-style signing regenerates profiles (an App ID change invalidates the profile), so the
  first launch after a regenerated or newly installed profile is the one that asks Apple. If the network is down
  or changing at that moment (Airplane Mode, VPN reconnecting, our VPN's 3 s linger), iOS shows this dialog. A
  second launch works once the check can run.

## Cause (best explanation, unproven)
iOS checks a new or regenerated provisioning profile online on its first launch. The check fails when the
network is down or changing at that moment, so the first launch shows "Unable to Verify App". Once the check
has succeeded, iOS caches it, and later launches work offline. This fits every result above but was not
reproduced with an un-validated profile.

## Fix to file
After an install finishes, the install's result text should add a short hint, in `web/app/screens/installroute.js`
next to the Installation done / next-step text:

> If it says Unable to Verify App, turn Airplane Mode off and make sure you're online, tap Cancel and open the
> app again.

Check the wording against GLOSSARY.md. Filed as a plan task (see below). An app cannot pre-verify trust itself,
since nothing can launch another app's trust check, so the hint is the only fix available from our side.

## Not verified
- (b) Launching within 3 s after our VPN goes off, (c) 30 s after, and (e) while Tailscale reconnects after
  Restore My VPN. Each needs an un-validated profile. Making one means regenerating a profile on the SideDrop
  host or the Apple team account, which changes the user's team and every app using it, so this research did not do it.
- The failing path itself. No syslog of a failure was captured (online-auth-agent, no DNS, no network, or our
  utun), so we do not know which of those fails.
- The user's own phone, and the Install-through-This-iPhone path. The 15 launched via WDA/testmanagerd, not a
  Home Screen tap.

## Cleanup
Test apps uninstalled. Airplane Mode off. Profiles unchanged (8 remain). UI lock released by the runner.
