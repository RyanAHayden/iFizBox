# B334: a tapped .ipa in Files opens the app but not the IPA's page

## What was wrong (found on the iPhone 15 Pro)

Reproduced first with the current main build (0.22.0, 4420) installed through `ui-15.sh install`: a test IPA in
On My iPhone > iFizBox > B334, tapped in Files. Cold launch and warm (app running) both came up on Home.

The open trail (`Library/Caches/com.ryha.ifizbox/open.log`, read with `afcclient --container`) had only
`launched: 0 URL(s)` and `came forward`: the scene delegate never got the URL. SpringBoard's log showed it sending
`UIOpenURLAction` with `url = file:///…/Documents/B334/Tiny334.ipa` and `RequireOpenInPlace = 1`, and iFizBox's own
log (`pymobiledevice3 syslog live -pn iFizBox`) showed UIKit then failing:

    UIKitCore <ERROR>: Error resolving bookmark; bookmark: fp:/…/com.apple.FileProvider.LocalStorage//did=…;
    error: … Code=257 "The file couldn't be opened because you don't have permission to view it."

fileproviderd's log gave the reason: `containing bundle … for consumer … has surprising bundle identifier`. The rig's
builds (and anyone's build signed with an explicit profile for another App ID, keeping the bundle ID) carry
`application-identifier` `S8NFX3A2LT.com.ryha.sideload` while the bundle ID is `com.ryha.ifizbox`; fileproviderd
won't resolve the bookmark for that mismatch, and UIKit drops the whole open: no `scene(_:openURLContexts:)`, no
launch URL context. So everything after the delegate (SharedInbox, MyIPAs, the page's `ifizbox://shared` route,
B174's fixes) never ran. Links (`ifizbox://search`) were fine: they carry no bookmark.

## The fix

`native/Sources/OpenRescue.swift` (sideload build only). A runtime dump of UIKit's classes showed the open action
(`UIOpenURLAction`, its `url` on `UISOpenURLAction`) is read by UIKit once while it handles the action, before the
bookmark step. OpenRescue swaps that getter's implementation (as FocusKeyboard.swift does for WebKit): it returns
UIKit's own value and notes any file URL. If no file reaches `Incoming.receive` from the delegate within 1.5 s, it
calls `Incoming.receive` with that URL itself, and logs an `OpenRescue:` line in the trail. When the delegate does
deliver (a build whose App ID matches), the rescue stands down: any file delivered since the action counts, so the
two never both run.

A file in iFizBox's own folder is readable from the plain URL and takes the usual route to its page. A file anywhere
else (On My iPhone > Downloads, tried with a 43 MB IPA there) can't be read without the refused bookmark. Before the
picker step it ended in SharedInbox's "Couldn't Open" alert, which told the person to "Save it to Files first",
and the file was already in Files. So an unreadable .ipa now goes to the page as
`ifizbox://shared?route=pick-ipa&name=…&dir=…`: "Choose the IPA" (Cancel / Choose), then `library.pick` (now with
`dir` and `single`), then the picked copy's page in My IPAs.

## Checked on the iPhone 15 Pro (iOS 27, rig build of this branch)

- Cold: iFizBox not running, tap Tiny334.ipa in Files > On My iPhone > iFizBox > B334: opens on the IPA's page
  (screenshot `ref/15/screens/fixcold.png`, trail: `OpenRescue: …` → `SharedInbox: took Tiny334.ipa` →
  `the page took ifizbox://shared?route=sign-ipa…`).
- Warm: back to Home in iFizBox, Files, tap it again: the IPA's page (`fixwarm.png`; trail entry
  "Open in iFizBox: Tiny334.ipa" at 23:49:55, kept as `Tiny334 2.ipa`, page hash `…/ipa%3ATiny334%202.ipa`).
- Downloads (outside iFizBox's folder): "Choose the IPA" → Choose → the Files picker → Downloads → the file → the
  OpenTennis IPA's page (`pick2.png`…`pick5.png`). The picker started at On My iPhone, not Downloads: iOS 27 ignored
  `directoryURL` for that folder. One extra tap; left as is.
- Test files removed from iFizBox's Documents afterwards (`probe.ipa` and another task's `R75` folder left alone).

Why the phone: the bug is in iOS's hand-off to the native shell (UIKit, fileproviderd); Chromium has no Files app.

## Tests

- `native/test_open_rescue.py`: the wiring as text (started at launch, sideload only, the hook returns UIKit's value,
  delivered files stop the rescue, the pick link's shape, `library.pick`'s `dir`/`single`).
- `web/app/share-pick.test.js`: `parseShared` for `pick-ipa`, Choose → `library.pick {dir, single}` → the IPA page,
  Cancel, an empty pick, a failing picker, and the route through `handleIncoming`.

## Tried and dropped

- A probe build (a throwaway `B334Probe.swift`, deleted before commit) dumped `UIOpenURLAction`'s methods and logged
  callers of `url`. That's how I found the hook point.
- Turning off `LSSupportsOpeningDocumentsInPlace` (copy-into-Inbox instead of a bookmark) would avoid the bookmark,
  but it also takes iFizBox's folder out of Files (F77 needs both keys). Not done.

## Spec review

A fresh reviewer flagged as extra the pick route and a docs/iphone15.md note. I kept the pick route: for an .ipa
outside iFizBox's folder it's the only way to reach the IPA's page, which is what the task asks for. I took out the
docs note; this journal keeps the finding. The reviewer also said the "no double open" rule is time-based (any file
the delegate delivers counts) and that the hook covers the parent class's `url`. Both are on purpose: the delegate
delivers synchronously, and the hook only notes file URLs and returns UIKit's value unchanged. The jailbreak build
and share-from-another-app are under Not verified.

## Not verified

- **The jailbreak build**: not changed (OpenRescue is sideload only). It opens .ipa files by copy into
  Documents/Inbox, with no bookmark, so this failure shouldn't happen there. Not tried on the iPhone 7, since this
  task changed nothing there.
- **A build whose App ID matches its bundle ID** (an ASC-made or wildcard profile): there the delegate gets the file
  and the rescue should stand down. The rig only signs with `com.ryha.sideload`, so I couldn't install such a build
  here. The no-double-open rule is in code and in test_open_rescue.py only.
- **iCloud Drive files and Share > Open in iFizBox from another app** (Safari's download preview, Mail). The 15 has
  no iCloud Drive file to try, and I didn't drive another app's share sheet. Both go through the same open action;
  an unreadable one should get the Choose alert.
- **iOS versions before 27**: UIKit's private `UIOpenURLAction`/`url` might be missing. Then OpenRescue logs "no
  UIOpenURLAction in this iOS" and does nothing, and the old behaviour stays.
- A second open of the same file adds another copy (`Tiny334 2.ipa`). That's SharedInbox's existing keep-a-copy
  behaviour, not changed here.
