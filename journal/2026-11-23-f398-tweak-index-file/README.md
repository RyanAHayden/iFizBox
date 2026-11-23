# F398: the Tweak Index as one file

## What was done

The Tweak Index (which app each tweak of a Tweak Source works in) is now one file that every phone gets the same way.
The sideload app and the site carry a copy, `web/app/tweak-index.json`, written at each release. The sideload app
reads it on launch and fetches a newer one in the background from `GET /api/tweaks.json`, which the Worker makes from
D1 (cached 30 minutes at the edge). Before, the app asked `GET /api/tweaks?source=…` once per Tweak Source, so every
request named the sources the phone had. Now no request does.

- `web/app/core/tweakindexfile.js`: the format, packing from D1 rows, parsing and checks, and the phone's file
  (`createIndexFile`: the bundled and the kept copy, the background refresh, the change event).
- `web/app/tweak-index.json`: the file itself, 25 KB, 19 sources, 526 free verdicts at first generation.
- `tools/tweak-index.mjs`: reads D1 (`ifizbox-tweaks`) with wrangler and writes the file. `tools/publish.sh` runs it
  and commits the file into the version commit (`docs/release.md`, "Tweak Index file").
- `worker/src/tweakindex.js`, `worker/src/index.js`: `GET /api/tweaks.json`. Without D1, or when D1 fails, the deployed
  copy; `node.mjs` serves its own copy (it has no D1).
- `web/app/core/tweakindex.js`, `web/app/core/sources.js`, `web/app/screens/sources.js`, `web/app/screens/tweaks.js`:
  the apps read the file instead of asking per source; `web/app/core/settings.js` has the new switch.
- Settings > General > Update Tweak Index (`settings-general.png`): sideload only.

The sources in the file are keyed by a prefix of a SHA-256 hash of the source's address, not by the address. The index
holds every address any app asked about (AltStore feeds, private repos), and the file is public and committed, so the
addresses stay out of it.

## Decisions

- Paid tweaks have no verdict in the file: the task says free only. But each source lists its paid tweaks' guessed app
  IDs (`paid`), so hiding a source the file has fully checked doesn't newly hide Havoc-like sources, whose paid tweaks are
  for apps the phone has.
- `checkTweakRows` now skips paid rows, so the app doesn't ask sellers for a verdict.
- Two of the user's sources had the same package@version with different verdicts. The one that works wins.
- `GET /api/tweaks.json` is dynamic from D1 with a 30 minute edge cache, rather than only the copy from the last release,
  so a new source's verdicts reach phones without a release.
- The switch is sideload only. The jailbreak app never reads the index; the website reads its own server's file.
- Refresh every 6 hours, 10 minutes after a failure. A file over 4 MB is refused, and so is one with the wrong shape,
  one dated in the future, or one whose `at` isn't newer than the copy in use (only a newer one replaces it). The kept
  copy is in IndexedDB, `ifizbox-tweakindex`.
- The release tool reads D1 with wrangler directly, because the live site doesn't have the endpoint until the first
  release that carries it.

## Consequences

- Apps no longer ask per source, so a source that no older build asked about isn't added to the index. The cron keeps
  reading the sources already known.
- A source not in the file is "not known" and hides nothing.
- With the switch off, an old file can hide a source that has since gained a tweak that works. Search and Manage still
  show it.

## Tried and failed

- The release tool seemed to hang at first. It was a stray `cat` in the shell, not wrangler.

## Checks

- `node --test web/app`: 3450 pass.
- `worker/test-tweakindex.mjs`: pass.
- `node worker/node.mjs` serves `/api/tweaks.json` from its own copy.
- `tools/tweak-index.mjs` run against the live D1 database.
- `tools/tweak-index.mjs` with an empty answer, and with a failing `npx`: exit 1, the file unchanged.
- Chromium at iPhone size with the fake sideload bridge: the switch shot (`settings-general.png`), the switch toggled off
  and on, and the requests recorded.

## Not verified

- The live `ifizbox.com/api/tweaks.json`: it deploys only on a release.
- A full `publish.sh` run: it publishes, so only `bash -n` was run.
- On a device: there is no device-only code in this change.

## Review fixes

- A verdict a newer file no longer has is taken back from the catalog; a newer file judges the Tweak Sources again at once.
- "Not known hides nothing" holds for a source never hidden before: one hidden by an earlier file stays hidden until a
  file says otherwise (the rule from before this task).
- `checkTweakRows` skips paid rows also for sources the file doesn't have; kept, as B391 removes those checks.
- Chromium also recorded the page's requests: on, only `https://ifizbox.com/api/tweaks.json`, its file used after a
  relaunch with no new request; off (and no kept copy), no request and the bundled file.
