# B460 Installed's A–Z index top

Cause: the index letters (A–Z) ran up beside the search field and kinds row. Search's rule (`.list-scope`) put its index
below them; Installed's `.installed-scope`/`.installed-search` had none. Added both rules in packages.css (88px with
the kinds row, 44px with the bar alone, the apps list) and a test in installed.test.js.

**Not verified**: not seen on a phone or in Chromium; checked by the CSS text test only (same offsets as Search's rule).
