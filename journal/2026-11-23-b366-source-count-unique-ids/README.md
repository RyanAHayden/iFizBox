# B366: Sources page count is unique packages, not stanzas

## What changed

- The Sources tab's count for an APT source counted `Packages` stanzas for the arch, one per version. Havoc on the
  site (Device: Jailbroken (Rootless)) showed 1,801, but its index holds 377 rootless packages.
- `web/app/core/apt.js`: new `countPackages(text, arch)` counts unique Package ids whose Architecture is the arch
  or `all`.
- `web/app/core/sources.js`: `countInline` (the fallback counter) now calls `countPackages`. New `COUNT_BY` constant
  (`"id"`) is saved with each count by `verifySource` and `refreshSource`. `refreshSource` reuses a stored count only
  when its `countBy` is `"id"`.
- `web/app/core/worker.js`: the worker's `"count"` message now calls `countPackages` too. This is the counter the
  site and the jailbreak app use, through `core/parser.js`, so the fallback alone would not have fixed the number.
- `web/app/core/sources.test.js`: new test. A `Packages` file with 3 versions of one arm64 package, 2 of an `all`
  package and 2 of a rootful package counts 2 for arm64 and 2 for arm. It is checked inline, through the worker
  parser (`createParser` with `Worker` null), and for a dist repo through `refreshSource`. A stored count without
  `countBy` is recounted even when the Release hash is unchanged. A stored count with `countBy: "id"` is reused
  (`unchanged: true`).
- `worker.js` and `apt.js` were not in the task's file list, but the fix needs them, since the worker is the counter
  in use.

Stored counts are reused while a source's Release is unchanged (F19), so an old stanza count would never be replaced
on its own. Every count saved before this change has no `countBy`, so each one is recounted once on the next refresh.

A dist repo's components are counted as one list (their Packages texts joined), so a package two components carry
counts once; before, each component's count was added up. `countBy` is saved only beside a count, so a failed
refresh saves none. Both came from the spec review and are in the node test.

## Checks

- `node --test` on the sources, sourcetools, apt, health and github tests: 70 pass, 0 fail.
- Real Havoc index (`https://havoc.app/Packages.bz2`, fetched on 2026-11-23): 1801 arm64 stanzas, 377 unique ids.
- Chromium: `worker/node.mjs` served the site on `127.0.0.1:8853`. `journal/2026-11-23-b366-source-count-unique-ids/sources-shot.mjs`
  set Device to Jailbroken (Rootless), added `https://havoc.app/` through `getBackend().addSource`, and opened the
  Sources tab. The Havoc row shows 377 (`site-sources-havoc.png`, same folder).
- `tools/check.sh` runs through `agent-runner done`.

## What failed / tried

- Nothing failed.
- The Procursus row shows Not Responding in the screenshot. That is a fetch from the local server, not this change.

## Not verified

- The jailbreak app on a phone. It runs the same `core/worker.js` path as the site, which was checked in Chromium.
  A phone check was not needed, since Chromium can run this check.
- The one-time recount of an existing user's stored Havoc count. The node test covers it, but it was not run on a real
  stored list.
