# s1 glossary

The words for each thing in s1: what the person says, what the app shows and what the code calls it, with
a plain definition and the words to avoid. Kept by `agent-runner glossary` (add, show, forget); no implementation
detail. (Format after mattpocock/skills domain-modeling, MIT.)

## Language

**Tweak Index**:
ifizbox.com's list of which app each tweak of a Tweak Source works in, read from the tweak's own files before anyone opens it
_Said_: shared tweak index
_On screen_: Works in: <app>
_In code_: core/tweakindex.js, worker/src/tweakindex.js, GET /api/tweaks, loadTweakIndex
_Avoid_: tweak database, tweak cache

**Details**:
The page for one package or app: its header, then Details, Reviews and Related, with the Details pane in Cydia's style
_Said_: package page, app page, details page
_On screen_: Details
_In code_: screens/details.js, renderPackage, renderApp, DETAILS_TITLE
_Avoid_: package page, app page, info page

**Preview**:
The sideways strip of pictures on a Details page: screenshots, banners or a repo's pictures
_Said_: screenshots, gallery
_On screen_: Preview
_In code_: PREVIEW_HEADER, previewSlot, galleryGroup
_Avoid_: Screenshots

**Add Tweaks**:
The page under an app's Details that lists the tweaks from your Tweak Sources that work in that app, each with ADD, and More Tweaks for the rest
_Said_: add tweaks page, add tweaks sheet
_On screen_: Add Tweaks
_In code_: renderAddTweaks, addtweaks:<bundle id>, addTweaksItems, addTweakButton, addTweaksGroup
_Avoid_: tweak picker, inject tweaks page

**Console Log**:
The kept output of one install, re-sign or queue run, saved on the iPhone line by line from its start; one cut off by closing the app reads Stopped
_Said_: install log, run log
_On screen_: Console Logs, Console Log; Running…, Completed, Failed, Cancelled, Stopped
_In code_: runLogs, createRunLog, start(), runStatusText, loggedBridge
_Avoid_: history, transcript

**Status-bar strip**:
The band at the top of the screen behind iOS's clock and battery, above the nav bar; plain black in the iOS 6 style
_Said_: status-bar strip
_On screen_: (none)
_In code_: --site-strip, --top-inset, LaunchStatusStrip
_Avoid_: status bar area, notch strip

**Native controls**:
In the iOS 26 style, on phones whose browser draws iOS 26's own form controls, the page uses those (switch, search field, menus, progress bar) instead of its drawn copies
_Said_: the actual native input boxes
_On screen_: (none: the iOS 26 style draws them)
_In code_: data-controls="native", native-controls.js, drawsIos26Controls
_Avoid_: real controls, system controls

**Report an Issue**:
A row under Console Logs that opens a new GitHub issue filled in with the app's version, iOS, the device and a Console Log
_Said_: report a bug, file an issue
_On screen_: Report an Issue
_In code_: core/report-issue.js, issueUrl, reportIssue, reportLog
_Avoid_: bug report, feedback

**Scope bar**:
The row of segments under a search bar that picks which kind of item a list shows
_Said_: scope bar, segments
_On screen_: All | Tweaks | Themes | Apps
_In code_: segments(), .scope-segments, ui.segments, NativeSegments
_Avoid_: tab bar, filter tabs

**Route Failure**:
The last check or install on This iPhone couldn't reach the phone; it is shown as the broken state, with its fix, until a check passes
_Said_: installs being refused, pairing broken
_On screen_: Tailscale Is Signed Out / Tailscale Refused / Pair Again (red status, Home tile: Installs are failing · Fix in Settings)
_In code_: routeFailure, rememberRouteFailure, clearRouteFailure, routeFailureOf, ifizbox.routeFailure
_Avoid_: pairing error, connection error

**Signing Server Fallback**:
After a This iPhone install couldn't reach the phone, the same install or failed apps go again through the default Signing Server, for that install or run only
_Said_: use the signing server instead, fall back to ifizbox.com
_On screen_: Use the Signing Server
_In code_: serverFallback, USE_SERVER, useServer, server: true (installOnDevice, openPrepared)
_Avoid_: server retry, fallback route

**Pairing Advertisement**:
How the app offers itself to iOS for pairing while the Pairing page runs; iOS lists it as one Pair with row, and its code is the one on the page
_Said_: Pair with iFizBox row
_On screen_: Settings > Privacy & Security > Developer Mode > Other Devices: Pair with iFizBox
_In code_: pairOnPhone, DNSServiceRegister, advertKey, pairable_host_set_alt_irk
_Avoid_: pairing offer, broadcast
