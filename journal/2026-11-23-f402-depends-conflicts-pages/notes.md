# F402: Depends and Conflicts are one row each, opening their list

The task changed while it was being worked on: the first text (a Conflicts group with Show More) was built and dropped;
nothing of it is left.

Done
- `details.js` packageRows: a Conflicts row after Depends (`pkgConflicts`, a red bolt tile), each only with names.
- `browse.js`: `depends:<id>` and `conflicts:<id>` pages (`renderRelations`, `relationsOf`, `relationRows`). One row per
  group; the first alternative a source has, or that is installed, gives the row its name, icon and link, with the
  group's text (versions, alternatives) under the name. Everything else is plain text.
- A package in another source than the page's gets `package:<id>@<key>`, since a plain token below a source's route
  only looks in that source. The Depends / Conflicts tokens carry the key the same way.
- `shoot.mjs`: the Details page, both lists and a package opened from one, every era, light and dark (the fake shell
  reports iOS 26 for that era, which needs it).

Checked in Chromium: values stay on one line with an ellipsis and a chevron, both lists and the opened page are right
in all four eras, light and dark; long groups wrap (the spec review found them cut off). The gate ran in `done`.

**Not verified**
- On a phone: web pages only, so Chromium was used (AGENTS.md).
