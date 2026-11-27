# What looks redundant but stays

Things a cleanup pass will find in web/app, worker/, native/ and tools/ that look unused or duplicated, and why
they stay. Check here before removing or merging one.

## How to find unused or duplicated code

- **Unused exports**: grep every `export` in web/app, worker/ and native/ JS (whole words) across every JS, HTML,
  Swift, C and Python file. None of web/app's modules is reached by a computed name except the screens'
  `title`/`nav`/`render`/`init`/`reselect`/`refreshInBackground` (app.js `SCREENS[tab]`).
- **Duplicates**: top-level functions with the same body in more than one file.
- **Unused files**: every tracked file under web/app, tools/ and native/ whose name nothing mentions; then check
  each hit by hand, since section icons, step pictures and the glossy icon sizes are built from names at runtime.
- **Unused CSS classes**: every class in web/app's and native/'s CSS against the JS, HTML and Swift. Many are built
  at runtime (`glyph-${kind}`, `ph-${kind}`, `sig-row-${state}`, `is-${kind}`).

## Shared helpers

- `el(tag, cls, text)` and `barButton`: `nav/ui.js`. `liveHUD(text)`: `nav/hud.js`.
- Sizes: core/appqueue.js `sizeText`.
- `str`/`httpUrl`: core/altstore.js. `missing`/`verificationError`: core/sources.js.
- The jailbreak arch map: compat.js's `JAILBREAK_ARCH`.
- Storage keys (`ifizbox.*`) are named in core/storagekeys.js (`KEYS`, `KEY_PREFIXES`, `PREFIX`); readers and writers
  import them, and worker/src/udid.js does too. theme-boot.js is a classic script that spells its four keys itself;
  core/storagekeys.test.js checks both rules.

## Kept on purpose

- **Small one-line helpers repeated in unrelated modules** (`decode`/`safeDecode`, `isObj`, `isFlat`, `plural`,
  `note`, `alertOK`, `hexToken`, `esc`, `num`, previews.js's own `str`/`httpUrl`): importing them would tie
  unrelated modules together (and worker/ to web/app) for a line each.
- **Exports used only by tests** (~280): they are the tested surface of core/; most are also used inside their
  module.
- **native/spike/**: the measurement spikes, still tested (test_spike.py) and cited by docs/native.md.
- **tools/themecmp.py, tools/kitmatch.py**: local reference tools (Pillow/numpy), referenced by journals and
  still used.
- **tools/spinnercmp.py**: local reference tool (Pillow, needs ref/) that compares nav/spinner.js's spinners with
  the 4S's frames; rerun it whenever the spinner drawing changes. Nothing in the gate calls it.
- **tools/gsa-spike.html**: the dev-only free Apple ID sign-in page; `worker/wrangler.preview.toml` copies it into
  the preview Worker's assets. The site never links to it.
- **tools/ipa-plist-probe.py**: the standalone proof of reading an IPA's minimum iOS with range requests;
  worker/src/ipainfo.js's header points to it as the reference it was ported from.
- **web/fixtures/ beside web/app/core/fixtures/**: moving the apt fixtures under web/app would put them in the
  static assets and the app bundle; the two folders stay.
- **app.js's service-worker unregister**: returning browsers may still hold an old push worker.
- **No `__init__.py` in native/ or native/spike/**: with one, `unittest discover -s native` finds the spike tests
  too, and the gate runs them twice.
- **The row-state lists `APP_STATES` (core/apprun.js) and `STATES` (core/installrun.js)**: nothing reads them, but
  each is the only full list of the states a run's rows go through; they stay as the modules' vocabulary.
- **native/spike/web/meter.js `getPhase`**: unused, but part of a spike (see native/spike/ above).
- **Exports used only inside their own module** (about 220 exports in about 80 web/app modules, found by whole-word
  name search; none imported by a test or another file): they stay. The app is plain ES modules with no build step,
  so the `export` word changes nothing at run time, and removing it would touch some 80 files for no behaviour
  change. Some are there for tests to reach (e.g. guides.js's text constants); worker/src/index.js's TTLs are the
  same kind. Before deleting a name, check how often it appears in its own file.
- **`.console`, `.console .navbar.sheet-bar`, `.console .bar-button` and `.console-log` in queue.css**: the
  console page is nav/progress.js's (`cls: "console progress-page"`) and a saved run's log uses `console-log`
  (screens/queue.js); the rest of that page's look is progress.css's `progress-*`.
- **Speed**: nothing in core/ looks slow enough to change without a phone to measure on; the gate's slow parts are
  the Swift builds (test_sign, test_sideload, the native package), which need the compile.
