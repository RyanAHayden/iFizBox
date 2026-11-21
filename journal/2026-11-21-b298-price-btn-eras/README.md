# B298: the price button in the iOS 7 and iOS 13 styles

## What changed

- `web/app/ios7.css` and `web/app/ios13.css`: the era rules for More Sources' ADD (`.rec-add`) now target
  `.price-btn` itself, so every price button gets them: My IPAs' SIGN / INSTALL / OPEN, the confirm tap's INSTALL
  (`.go`), and ADD / ADDED (which wear `.price-btn rec-add`, so they share the rules; no `.rec-add` look rule is
  left in the era sheets, only `.added` / `.adding`, written on `.price-btn`).
  - iOS 7: 1pt tinted outline, tinted text on nothing, tint fill with white text while held. `.go` is the tint fill
    with white text (a 20–30% black inset shadow while held).
  - iOS 13: the GET capsule, bold tinted text on the grey pill, darker pill while held. `.go` is the tint capsule
    with white text.
  - `:disabled` (and `.added`) greys out; busy (`.busy`, which is also disabled) keeps its tinted label and its fill,
    now a pale tint (`--i7-get-fill` / `--i13-get-fill`) in place of iOS 6's pale-blue gradient or dark mode's bar
    fill. The disabled rule is `:disabled:not(.busy):not(.adding)` so busy and Find More's spinner don't grey.
  - All at `html[data-style=…][data-theme]` weight, above myipas.css's `html[data-theme="dark"] .price-btn…` rules,
    whatever order the lazy sheet loads in.
- `web/app/price-btn-eras.test.js`: collects every class a price button is built with (`price-btn` plus the classes
  in the screens' className strings that hold it: `rec-add`, `find-add`), every look-setting variant any other
  sheet gives them (`.go`, `:active`, `:disabled`, `.busy::before`, `.added`, `.go:active`…), and the state
  classes `paintPrice` (myipas.js) and `setButton` (findmore.js) toggle, and fails when ios7.css or ios13.css has no
  `html[data-style=era][data-theme] .price-btn` rule for one. A sanity test makes sure the scan still finds the
  known variants. It also checks the base is flat and tinted, `.go` the tint with white text, disabled grey with
  busy excluded, and the busy fill in the era's tint. Run against main's era sheets it fails (no `.go` rule), as
  it should.

## Shots

Headless Chromium, the sideload app's fake shell (`capture.mjs`, from the B164 journal, with a five-IPA
`library.list` and `ERA` / `TONE` env placeholders in eval steps; `myipas.json` repaints rows 2–5 with
`paintPrice` into confirm / busy 45% / open, and disables the last). Served with `python3 -m http.server` from
`web/app`. Columns left to right: iOS 7 White, iOS 7 OLED Black, iOS 13 light, iOS 13 dark, iOS 6 (unchanged).

- `myipas-all.png`: My IPAs' rows (SIGN, confirm INSTALL, SIGNING with fill, OPEN, disabled SIGN).
- `find-all.png`: Find More (ADD).
- `more-all.png`: More Sources > App Sources (ADD).

- `states-all.png` (`states.json`, iOS 7 White / OLED, iOS 13 light / dark, after the spec review asked for them):
  top band SIGN held (a `press` step: CDP mouse down, shot, then move away and release so no click fires), middle
  band the confirm INSTALL held (darker; the page also dims there, from the long hold, not the button), bottom band
  Find More's ADDED and the spinner (`.adding`, set by an eval as findmore.js setButton does).

Review notes kept on purpose: `.go:active` has its own rule because without it a held confirm INSTALL in iOS 13
would fall to the base held rule (the grey pill); `:not(.adding)` keeps Find More's spinner tinted. The test reads
state classes from `paintPrice` / `setButton` and look variants from every other sheet; a future button built on
`.price-btn` gets the base era rule automatically, and any variant another sheet styles fails the test until the
eras style it too.

## Not verified
- Real devices (iPhone 15 Pro, iPhone 7): not run; the change is CSS only and the Chromium shots cover the four
  era/tone pairs. WebKit-specific risk is low (rgba tokens, inset box-shadow, no new syntax).
