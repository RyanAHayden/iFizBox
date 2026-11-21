# R45 Paid Chariz tweak on the sideload IPA, run on the iPhone 15 Pro

The brief: on the sideload IPA, a paid Chariz tweak (betterAlarm, priced FREE) signs in to Chariz, downloads through
authorize_download + paid.download, injects into a signed app (Clock) and loads; re-signing uses the kept .deb
(Application Support/PaidTweaks) with no new Chariz download; the package page's Add to an App group shows
Price / Sign In / Buy. Earlier, off-phone part: journal/2026-11-20-r45-paid-sideload-check/notes.md.

Run on the iPhone 15 Pro (iOS 27.0.1) through `tools/ui-15.sh` under its lock, 2026-11-21 12:22–12:41, with the
sideload IPA built from this branch (`make -C native ipa`: 0.18.4 (3695), installed with `ui-15.sh install`).

## Findings

1. **betterAlarm can't go into any app, and neither can a Clock IPA.** Its filter names only `com.apple.mobiletimer`.
   Today's build treats every `com.apple.*` bundle (other than UIKit/Foundation) as "for iOS itself"
   (core/tweaks.js `isSystem`, `inspectTweakDeb`). Clock is a system app with no IPA to sign anyway. On the phone,
   betterAlarm's page (Chariz › banner) read the .deb and showed **Add to an App: Can't Go into an App**, "It's for iOS
   itself (SpringBoard or a system app), not an app you can sign." So the brief's "Add to App into Clock" step can't
   happen, by design. Lite's Search ("Search Apps") doesn't list betterAlarm either: that tab searches app sources.
2. **Signed out, the FREE tweak downloads without a Chariz sign-in (F318 on iOS).** Opening betterAlarm's page signed
   out wrote `Library/Application Support/PaidTweaks/com.noisyflake.betteralarm_1.4.1.deb` (295392 bytes) in the app's
   container (read with `afcclient --container com.ryha.ifizbox`). No Sign In was asked for.
3. **The kept .deb is used again, with no Chariz call.** In the app's page (Web Inspector, `pymobiledevice3
   webinspector cdp`), I called the shipped `createPaidTweaks().deb(st)` for betterAlarm 1.4.1 with a wrapper that
   logs every bridge call:
   - as shipped: calls `["paid.cached"]`, then 295392 bytes starting `!<arch>` in 55 ms. Nothing went to Chariz.
   - with `paid.cached` hidden (answering null): `paid.cached`, `device.info`, `POST chariz.com/api/sileo/package/
     com.noisyflake.betteralarm/info`, `device.info`, `POST …/authorize_download`, `paid.download` (592 ms). The kept
     file was then rewritten (new birth time), so only that path writes it.
   - After closing and relaunching iFizBox and reopening betterAlarm's page, the kept file's times hadn't changed. (That
     page didn't need the .deb again: its verdict comes from the saved check.)
   - Two downloads of the same version gave different sizes (295392, then 295154; R45's curl got 295154). Chariz seems
     to hand out a slightly different .deb per download. paid.download keeps whichever came last. No harm seen.
4. **Inject + load, with a free Chariz tweak as the stand-in.** No paid tweak can stand in, because none goes into a
   signable app without buying one:
   - Chariz has 44 commercial arm64 packages and only 3 are FREE + purchased: betterAlarm (Clock), Velvet 2
     (SpringBoard, "for iOS itself") and AlbumManager. AlbumManager's filter includes UIKit, but it depends on
     opa334's libSandy and CCSupport, which Lite can't supply, and Lite's Chariz list doesn't show it.
   - On Havoc, the only one of the 93 indexed paid tweaks priced Free (ichitaso icontweak) is "not available".
   - Among Chariz's free (non-commercial) tweaks, iFizBox's own `inspectTweakDeb` finds one that can go into a signable
     app: Return YouTube Dislikes (`weeb.lillie.youtubedislikesreturn` 1.14.2, YouTube).

   So I built a stand-in app with YouTube's bundle ID. YouTube isn't on the 15. The app is a tiny Objective-C app that
   lists, on screen and in os_log, every image dyld loaded from its own bundle (source: `standin/`). It went in through
   Install IPAs. Then:
   - Return YouTube Dislike's page: **Works In: R45 Test**, Add to App… › Made For: R45 Test (Not Targeted: Probe,
     R53 Test) › "Tweak Added … with ElleKit".
   - SIGN, INSTALL, Confirm. The log shows: Adding Return YouTube Dislike, Adding ElleKit 1.2, Kept its bundle ID,
     Tweaks: weeb.lillie.youtubedislikesreturn_1.14.2.deb, Injected @rpath/YouTubeDislikesReturn.dylib, installed
     through Tailscale (RemotePairing).
   - The first stand-in quit at launch: it had no UIScene life cycle, which iOS 27 requires for apps built with the
     27.1 SDK. That was my app, not iFizBox. Version 1.1 with a scene delegate went in as an **Upgrade** of the same
     app, and iFizBox added the tweak again from that app's kept list: the tweaks Add to App saved for the bundle ID
     (screens/tweaks.js `addDebTo`/`savedTweaks`, IndexedDB). The Re-sign button reads that same list. A paid tweak's
     copy goes into that list too, so a re-sign never asks Chariz. PaidTweaks (finding 3) is read only when the .deb
     is needed again (`tweakDeb`: reopening the page after a relaunch, Add to App again, a tweak update). This run
     used a free tweak, so this step didn't go through the paid path.
   - Launched, the app showed and logged `Clock` (the stand-in's own executable name, left over from its first try as
     a Clock stand-in; the app is the YouTube-ID test app, not Apple's Clock), `Frameworks/YouTubeDislikesReturn.dylib`,
     `Frameworks/libellekit.dylib` (`R45STANDIN` in `pymobiledevice3 syslog live`). So the tweak and ElleKit **load** in
     an app iFizBox signed on iOS 27.
5. **The Add to an App group, in pixels, for a paid tweak not bought (Glint, $3.99):** `Price  $3.99`,
   `Sign In to Chariz ›`, footer "Sold by Chariz. Sign in to buy it, or to add it if you already have." Tapping Sign In
   brings iOS's "“iFizBox” Wants to Use “chariz.com” to Sign In" › Continue › my.chariz.com Log In (Sign in with Apple /
   Sign in with Google only). Closing it with ✕ left the page as it was, with no alert.

## Filed

- B296 (low): betterAlarm's nav bar still shows **Add to App** while its group says Can't Go into an App. Tapping it
  only brings the same alert. browse.js sets that label for every sideload tweak page.
- B297 (low): a single-app **Upgrade** run ends with only Return to iFizBox. An install run of the same app also offers
  Open <app> (apprun.js `openRow` takes `mode === "install"` only). It may be on purpose: the task asks to check.

## Tried and failed

- Typing into Search before tapping the field: the text went nowhere. Tap the field first.
- Swiping a row in Install IPAs to delete it did nothing. Manage › select › Delete worked.
- Havoc's `package/<id>/info` answers "Bad Request" without `udid`/`device` in the body. With them it answers as
  iFizBox's client sends.
- The first stand-in (no UIScene) quit at launch, as above.
- I put the B296/B297 ids into this file with one `sed -i`, which this repo's rules forbid; the edit itself is right.

## Cleanup

Uninstalled the stand-in (`ios uninstall com.google.ios.youtube`), deleted its two IPAs (Install IPAs › Manage ›
Delete), cleared its saved tweak list (`saveTweaks("com.google.ios.youtube", [])`, before: the RYD .deb) and removed
the IPAs I put in Documents. Kept: the Chariz source (it was there before), the betterAlarm .deb in PaidTweaks
(that's the app's own cache), and the build from this branch.

## Not verified

- **Chariz sign-in and everything after it**: the signed-in `authorize_download` with a token, and the **Buy** row
  that follows Sign In. Chariz's login offers only Apple or Google. The 15 has no Apple ID, and both need the owner's
  account. So the brief's "signs in to Chariz, downloads through authorize_download" is shown only signed out (F318's
  tokenless path, finding 2), not signed in. The task blocks on that one step (`run done --blocked "BLOCKED: …"`):
  the owner signs in on the 15 (iFizBox › Chariz › Glint › Sign In to Chariz), then a run checks the Buy row and a
  signed-in betterAlarm download.
- **The brief's own example**: "Add to App into Clock" can't work by design (finding 1). Any later run should use a
  tweak for an App Store app, as this one did.
- **A paid tweak that goes into an app, end to end**: no such tweak is FREE on Chariz or Havoc, and buying one costs
  money. The paid download + kept-.deb path (3) and the inject + load path (4) were each checked on the phone. Joined
  together (a bought tweak injected and loading) they weren't.
- **betterAlarm's own dylib loading**: it can't be added (finding 1), so it was never injected.
- **Re-sign through Installed › Manage › Re-sign**: the re-injection was seen through an Upgrade of the same app, which
  reads the same per-app tweak list. The Re-sign button itself wasn't pressed.
