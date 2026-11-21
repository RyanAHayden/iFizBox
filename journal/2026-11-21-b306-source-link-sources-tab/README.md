# B306: a source link lands on the Sources tab

## What changed

- `web/app/incoming.js`: another sideloader's source link (`handleOtherLink`) and `ifizbox://add` both go through
  `addFromLink`: open `SOURCES_ROOT` (`#/sources`, a plain tab switch: the router's `mountLink` leaves a tab root
  alone, so the stacks report a `tab` change and the tab bar selects Sources), then Add Source's alert filled in
  over the list. No Manage page. `ifizbox://add` opened nothing before; now it opens the Sources tab too.
- `web/app/screens/manage.js` `addSource`: a ctx with `fromLink` (the link's ctx holds only `showHUD`) sends the
  change notice with no ctx. Before, the link's `{ showHUD }` reached `sources.js`'s `onSourcesChanged`, which set
  `state.ctx` to it: the new source's load ran without the reload bar or badge (no `reloadBar`, `setBadge`,
  `loadData`), and every later load of the tab kept that bare ctx. With no ctx, sources.js uses the tab's own (app.js
  `useContext`).
- Tests: `web/app/incoming-sources-tab.test.js` (hash is the Sources root and Sources is the stacks' active tab from
  five starting routes; `ifizbox://add` the same; Manage's pages from the Sources tab keep Sources; the added source
  loads under the tab's reload bar with the spinning badge and lands in the list). `incoming-other.test.js` now
  expects `#/sources`.

## Findings

- "No tab selected" on Manage did not reproduce in Chromium: the link from Home, Installed, Search or a Settings
  page mounted Manage on that tab (`#/home/~sources/manage/sources`, …) and that tab stayed selected. Manage opened
  from the Sources tab keeps Sources selected. The route that showed no selection on the phone is unknown; with the
  link no longer opening Manage it no longer applies. I kept the mount design for other links to Manage (Guides'
  Add a Source): changing it would undo the "a link keeps the current page and slides the new one in" rule.
- Checked in headless Chromium (smoke.mjs's setup, a throwaway probe): from `#/installed`, the real
  `handleIncoming('altstore://source?url=…', { on: () => true })` lands on `#/sources`, Sources selected, the
  Enter APT URL alert over the Sources list, no page errors.

## Follow-up

- B307: the website's `/add?url=…` path (app.js, not in this task's files) still opens Manage > Sources.

## Not verified

- Tapping Add Source in Chromium and watching the new row spin in the drawn list: the fake bridge answers every call
  with null, so no real add happens there. The node test covers the load (reload bar, badge, refresh of the new key)
  with sources.js and a fake backend.
- The phone (iPhone 15 / 7): a real altstore:// link from Safari. Chromium covers the web change; the native side
  (the URL reaching `startIncoming`) is unchanged.
