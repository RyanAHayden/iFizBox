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

**Status-bar strip**:
The band at the top of the screen behind iOS's clock and battery, above the nav bar; plain black in the iOS 6 style
_Said_: status-bar strip
_On screen_: (none)
_In code_: --site-strip, --top-inset, LaunchStatusStrip
_Avoid_: status bar area, notch strip
