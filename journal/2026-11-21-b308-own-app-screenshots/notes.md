# B308: iFizBox's own app page shows only the phone-framed shots

## What I did
- `tools/altsource.py`: `app_entry` now adds `screenshots`, built by `screenshots()`: every `docs/img/web-*.png`
  and `jb-*.png` the README shows, in README order (first appearance, each once), as
  `{imageURL, width, height}` with the PNG's own size, at
  `https://raw.githubusercontent.com/RyanAHayden/iFizBox/HEAD/docs/img/<name>`. The site doesn't serve `docs/`,
  so raw.githubusercontent.com is the address (`curl -I` of jb-home.png: 200). No crop-* picture is listed. Since
  the source lists screenshots, the app page (screens/altstore.js F122) no longer falls back to the README's
  images.
- `build` and `rebrand` both go through `app_entry`, so `release.sh`'s `update` and `native/brand.py sync` keep the
  list. Ran `brand.py sync` to regenerate `web/app/source.json` (the one built-in copy; the IPA and .deb bundle
  it from `web/app/`, `native/build/...` copies are build output).
- Order: README order (jailbreak shots first, since the README's hero row is jailbreak ones); the brief allowed it.
- `tools/test_altsource.py`: the source lists exactly the web-*/jb-* files in docs/img, no crop-*, no repeats, all
  from raw.githubusercontent.com; `build` carries the list.
- Checked `parseAltSource` (core/altstore.js) on the new source.json: 16 screenshots, URL and size read.

## Not verified
- The live page on a phone: ifizbox.com/repo/source.json serves the latest release's source.json, so the new list
  reaches the app only with the next release; not checked on the 15 Pro for that reason.
