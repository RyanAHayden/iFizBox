# F449 Filter panel Source rows show each source's icon

**Did:** `web/app/screens/filterpanel.js`: `sourceChoices` options carry their `source`; `choiceGroup` gives such a row the
source's letter tile and appends `sourceIconImage` (the Sources tab's icon loader). All Sources keeps a generic folder
(`.filter-all-icon`, `web/app/packages.css`, same art as the Sections folder).

**Checked:** Chromium shot of the open panel (headless, 390x844, fake sources): folder on All Sources, letter tiles on the
source rows. The picture loading over the letter is the same `sourceIconImage` path as the Sources tab; my fake sources
had no real icon URL, so I did not see a picture land.

**Not verified:** a real icon picture in the panel (no network sources in the headless run); the iOS 6 theme on a phone
(web changes are checked in Chromium only).
