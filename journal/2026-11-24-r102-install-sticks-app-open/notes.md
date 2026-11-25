# This iPhone install sticks when the app being replaced is open

## Question
An update installed from This iPhone sometimes never finishes while the app it replaces is open (YouMod was the
report; the user's row words are not known). Why does installd wait, does it go on once the app is closed, can
iFizBox tell the app is running, and do Cancel and Install Again recover it?

## What I did
- Built a test app, bundle `com.ryha.ifizbox.r102test` (app name R102Test, never iFizBox's ID). It plays a silent
  AVAudioEngine buffer and has `UIBackgroundModes` audio. Built on this machine with swiftc 6.4.2 and the iOS 27.1 SDK,
  the same recipe as `native/build.sh`. iOS 27 aborts a UIKit app with no scene lifecycle
  (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`), so the app needed a `UIWindowSceneDelegate` and a
  `UIApplicationSceneManifest`; the first build crashed on that. Source and plist are in `test-app/`.
- A desktop-installed copy (signed by the rig) refused an in-app update with `MismatchedApplicationIdentifierEntitlement`
  (appid_mismatch), because the App ID differs from iFizBox's signing. The app was uninstalled, and the first install
  was done through iFizBox itself.
- Reproduction on the iPhone 15 Pro (iOS 27.0.1), locked with `tools/ui-15.sh`: a 150 MB padded IPA installed from
  This iPhone, iFizBox in front, R102Test running and playing in the background. Syslog captured live with
  `pymobiledevice3 syslog live`; the evidence is in `evidence-stall.txt`.
- Route comparison with the desktop's own installs, same app states, and an end-the-app test (below).
- Cleanup: R102Test uninstalled, the test IPA removed from iFizBox's Documents, phone unlocked from the rig lock.

Rebuilding the test app: `swiftc -parse-as-library -O -wmo -swift-version 5 -runtime-compatibility-version none
-target arm64-apple-ios15.0 -sdk $IOS_SDK` with `-resource-dir` set to a copy of the toolchain's `usr/lib/swift/shims`
and a clang link, plus `-I` on the shims. Then `clang -fuse-ld=lld --ld-path=<rustup ld64.lld>` with `availability.o`
built from `native/Sources/availability.c`, and `Info.plist` from `test-app/`. Zip as `Payload/R102Test.app`. Run with
`LD_LIBRARY_PATH` pointing at a `libncurses.so.6` link to `libncursesw.so.6`.

## Findings
**The stall.** The copy took 143 MB in 6.3 s (22 MB/s). installd staged the update at 19:46:12.049 ("Staging update
successful"). Then installcoordinationd sent a terminate request at 19:46:12.057 with `maxTerminationResistance:
NonInteractive`, and runningboardd refused it at 19:46:12.069: "Target process has a higher termination resistance than
the termination context" (RBSRequestErrorDomain Code=4). installd logged nothing more. The page stayed on "Copied R102Test
to iPhone, waiting for iOS (1 of 1)" with the bar part-filled. iFizBox's own "installd quiet for 30/60/90/120 s" lines
ran every 30 s, and each said sameAsBefore (iOS still listed 1.0 (3)). iFizBox was not suspended and the VPN was up (a
second connection looked connected in 0.2 s), so this is installd waiting, not iFizBox losing its connection. Bringing
R102Test to the front at 19:46:36 changed nothing, and no second terminate request was sent. No watchdog ended it:
the install limit is 180 s without an installd percentage, and I ended the app by hand at 129 s.

**(a) Does installd go on once the app is closed?** Yes, on its own. At 19:48:19.038 I ended R102Test (ios kill, from
the desktop's DVT). installd went on within 0.05 s: placeholder, apply the staged update, 90% and 100% at 129.3 s after
the request, Complete at 129.4 s, "install: done in 136.0 s". Pausing the audio was not tried (the test app has no pause
control), so the resistance follows the process's state, not the audio alone. If the connection is dropped before the
app exits (the pymobiledevice3 timeout killed the client), installcoordinationd logs "Canceled coordinator with intent
IXCoordinatorIntentUpdating by client", the staged update is dropped, and the old app keeps running.

**Which route decides.** The same stall happened with each plain route from the desktop:
- `pymobiledevice3 apps install`, no flags (installation_proxy): NonInteractive, Error 4, hung until killed.
- `--streaming` (streaming_zip_conduit, no developer flag): NonInteractive, Error 4, hung.
- `--developer` (installation_proxy with `PackageType=Developer`): `maxTerminationResistance:Absolute`, terminate
  Success, installed in 2 s with the app playing in the background.

go-ios's own `ios install` (streaming_zip_conduit) and `ui-15.sh install` also ask with Absolute, which is why the
desktop installs at the start (foreground playing at 19:42:11, background playing at 19:42:34) went through in 1-2 s.
iFizBox's install passes nil options at the installation_proxy_install_with_callback call (`IDevice.swift`, about line
1097), so it gets the plain NonInteractive behaviour.

App state against a plain installation_proxy install (what iFizBox does):

| App state | Result |
|---|---|
| Background, no audio (suspended) | terminate Success, 2 s |
| Background, playing audio | refused, hangs |
| Foreground, playing audio | refused, hangs |
| Foreground, no audio (build 7, no background modes in its plist) | refused, hangs |

So a background-suspended app is fine, which is why most updates work. An app that plays audio or is in front is
refused.

**(b) Ending the app through our tunnel.** This phone's RSD lists 85 services with Developer Mode on and the personalised
DDI mounted, which is also how `ui-15.sh` kills apps. The list includes com.apple.coredevice.appservice,
com.apple.instruments.dtservicehub, com.apple.coredevice.debugserverproxy, com.apple.streaming_zip_conduit.shim.remote,
com.apple.remote.installcoordination_proxy and com.apple.mobile.installation_proxy.shim.remote, plus afc, amfi,
fileservice and devicecontrol. iFizBox's own handshake on this phone also reports 85. Journals from 2026-11-21 show 76
services for this same phone, so the list grows with the phone's developer state. Which 9 are missing, and whether the
user's phone has the same set, is not known. DVT process control (ios kill) works here but needs Developer Mode and
the developer disk image or cryptex. It was not tried from iFizBox: our idevice build leaves those features out, and the
task forbids code changes. The `PackageType=Developer` option makes all of this unnecessary for the stall, so that is
the chosen fix (B433).

**(c) Can iFizBox tell the app is running?** Not found. installation_proxy Browse and Lookup list no running state,
`applicationIsInstalled` is unreliable on iOS 27, and DVT process listing needs Developer Mode. RunningBoard's
RBSProcessHandle from inside the app was not tried (private framework, entitlement unknown). The only signal iFizBox
has is silence after the copy, which it already measures. So F424 words the wait as advice after about 15 s of silence,
not as a fact.

**(d) Cancel and Install Again.** Tested at the installation_proxy level only. Dropping the connection cancels the
stalled install (coordinator canceled by client) and leaves the app running. Installing again through the same route
stalls the same way while the app still runs. A second client's install while the first stalled one still holds the
coordinator failed with "Coordinator ... was process-scoped, but not for client streaming_zip_conduit". It recovers only
if the app is closed first, or if the install goes with `PackageType=Developer` (a developer install sent after two
stalled plain ones succeeded in 1 s). iFizBox's own Cancel button on the run page was not pressed during this stall.

## Follow-ups
- **B433**: pass `PackageType` Developer in the install options. Check Developer Mode off and enterprise-signed IPAs,
  and fall back to a plain install once if the device refuses the option.
- **F424**: after about 15 s of silence on This iPhone, say "Close <App> to finish installing" (the wording is advice,
  since the running state cannot be read). Filed after B433.

## Not verified
- PiP: no video layer in the test app. Resistance follows the process state, and a PiP window keeps the app in the
  foreground class, so I expect the same as audio. Unverified.
- Pausing audio instead of ending the app.
- The user's phone: Developer Mode state, DVT and appservice reach, and 76 versus 85 services.
- iFizBox's own Cancel and Install Again during the stall.
- `PackageType=Developer` from inside iFizBox with the on-device signer, with Developer Mode off, and with an
  enterprise IPA.
- The user's actual YouMod row words (not known).
- A suspended-by-iOS iFizBox during the copy: it was not the cause here, but it was not forced either.
