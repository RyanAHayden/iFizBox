# F375: What's New at the top of Details when an upgrade is out

## What I did

- `web/app/screens/browse.js`: `upgradeNewsSlot(st, inst, sileoJson)` (exported, with `NO_RELEASE_NOTES`). When
  the installed version is older than the source's (`compareVersions(st.version, inst.version) > 0`) it returns a
  slot holding storepage.js `whatsNewGroup({ version: <new>, date: "Installed: <old>", notes })`, drawn at once
  with "No release notes for this version." and swapped (through `slideChange`) to `sileoWhatsNew(json).text` when
  the page's one Sileo JSON fetch answers with a changelog entry. No `history` row. `null` when not installed, same
  version or installed newer, so those pages are unchanged.
- `renderPackage` appends it right after the piracy banner, before Change Package Settings and everything else.
  AltStore apps return earlier in renderPackage, so they never reach it (out of scope, as the task says).
- `web/app/screens/browse.test.js`: four tests: card with fallback then notes and the Installed line (no Version
  History); fallback stays for no depiction / no changelog tab / failed fetch; no card for same / newer / not
  installed; wiring order (after piracy, before the options group) and that it uses the page's `sileoJson`.
- The task's correction says the concept branch held no commit; built from the task text alone. Nothing from a
  CONCEPT_NOTES sample map exists here.

## Concept check

`tools/concept/build.py --app web/app --mode jailbreak --start '#/search/package%3Acom.example.tweak' --standalone`,
then `tools/concept/check.mjs` (all clean, light classic + dark gunmetal, iPhone SE and 17 Pro Max). The stock
check shoots Home after its tab re-tap, so I ran a scratchpad copy that also shoots right after opening the route:
the fixture's Example Tweak (installed 1.0, Havoc 1.1, no Sileo depiction) shows "What's New in 1.1" with
"Installed: 1.0" on the right and the fallback line, first in Details, in both themes.

## Not verified

- The notes swap on a real page with a Sileo depiction in Chromium: the concept fixtures have no Sileo depiction
  for an upgradable package; the swap is covered by the node test only.
- No phone check: plain web/app change, Chromium and node cover it (AGENTS.md: phone only when Chromium can't).
