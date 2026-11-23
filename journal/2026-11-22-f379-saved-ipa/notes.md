# F379: a custom IPA install saves its IPA in My IPAs

## What was done

- `core/myipas.js`: `savedIpa(entries, {bundleId, version})` (same bundle ID, its own or the one its Sign Options
  sign as, and same version; both must be known), `savedIpaOptions(file, edits)` (the install's edits as
  `library.options` params) and `saveInstalledIpa({url, bundleId, version, edits}, {call})`: `library.list`, then
  `library.add {url}` and `library.options` unless that app and version is saved already. When the install didn't
  say its version (the jailbreak helper's answer has none), the new copy's own version decides: a duplicate is
  deleted again (`library.delete`).
- `core/appqueue.js`: `customInstallSave(job)` (only a Custom Install job: options and a url; never a source's plain
  Install, a My IPAs file, iFizBox itself or a Remove), `savedResignJob(job, entries)` / `withSavedIpa(job, {call})`
  (a Re-sign with no url of its own becomes a library re-sign when My IPAs has the app at the installed version), and
  the queue now keeps `library` + options on a resign job.
- Wiring (small additions outside the task's file list, needed to hook the flows):
  - `screens/queue.js` `recordApp` → `saveCustomIpa(job)` (not awaited) after a sideload install lands.
  - `signing/queue.js` `prepareOnDevice` → `withSavedIpa` first, so the sign-ahead run's Re-sign signs
    `signing.prepare {library, ...saved options}` instead of `{record}`; the kept tweaks (`keptTweakParams`) still
    go with it, so tweak changes sign the saved IPA too.
  - `screens/ipa-install.js` (jailbreak): `runIpaConsole` hands `onInstalled` the url; `rememberIpa` (Install from URL,
    a tapped .ipa link, an ifizbox://install link via incoming.js) starts `saveIpaCopy` (not awaited).
- Test: `web/app/screens/myipas-autosave.test.js` (the brief's check: an install adds a My IPAs entry with its
  options, then a Re-sign through `prepareOnDevice` sends `signing.prepare {library}` and nothing is downloaded again).

## Decisions (unattended)

- "Custom IPA install" = Custom Install (sheet with options), a URL, a link. A source's plain Install is not saved
  (it has a source to download from); a file opened in iFizBox already lands in My IPAs in the sideload app.
- The shell's `library.add` only takes a url, so saving downloads the IPA once more after the install (the native
  side can't move the already-downloaded file into the library without a native change, outside this task). Later
  re-signs and tweak changes then sign the saved IPA with no download. A follow-up could make signing.prepare /
  ipa.install keep their download in the library.
- An http link with no https twin: the save is sent without `insecure`, so the shell refuses it and nothing is saved
  (no second "Not Secure" alert in the background).
- The website path (`runAppQueue` → `resignApp` → `signing.resign`) is unchanged: the website has no shell library.

## Spec review

- Fixed: when the app and version were saved already, the install's Sign Options were dropped; now they are written to
  the saved IPA (`library.options`), so a Re-sign signs it the way it was installed (tested).
- Not changed: "url only when not `native`" in `runIpaConsole`: `native` is only share.js's stand-in (a staged file,
  no url), so there is nothing to save there.
- Filed F380: keep the install's own download in the library instead of downloading again for the save.

## Not verified

- On a phone (iPhone 15 Pro / iPhone 7): not run. The change is page JS over existing bridge calls
  (`library.list/add/options/delete`, `signing.prepare {library}`), all checked with a fake shell under node.
  Real-device check left out: it needs a Custom Install + re-sign on the 15 and a URL install on the 7.
- A Re-sign of an app signed with Keep Bundle IDs off (its ID gets the team's suffix) doesn't match the saved IPA by
  bundle ID, so it re-signs from the shell's record as before (no download either way).
- The jailbreak `share.ipaInstall` route (a file shared into the app) has no url: nothing is saved there.
