# F463d: Free Apple ID App IDs list and forgetting deleted apps

**Task:** On the Free Apple ID page, list the account's App IDs from Apple with the day each expires, and in the app, forget recorded apps that were deleted from the iPhone when that page opens.

**What was done:**
- `web/app/screens/app-ids.js` (new, with `app-ids.test.js`): the App IDs group, first to expire first, filled once Apple answers. Without Apple's session it reads Not Signed In and ends the signed-in state. `forgetDeletedApps` asks `signing.installed`, then `signing.phoneApps`, and calls `signing.forget` for each recorded app that is not on the phone.
- `native/Sources/Sideload.swift`: new bridge call `signing.phoneApps` -> `{apps: [bundleId] | null}`, the user apps installation_proxy lists through the pairing. `null` when unpaired, when it can't be asked, or when a signing or install runs.
- `web/app/screens/free-apple-id.js`: the group is added to the Ready view, and `forgetDeletedApps` runs once per drawn Free Apple ID group.
- Nothing is forgotten while the app queue or a run is busy, or on an empty or unknown list.
- Why not `apps.isInstalled`: iOS 27 answers false for every app, so it cannot tell a deleted app from an installed one.
- Opening the view can turn the built-in VPN on, when there are recorded apps and a pairing. That is the same connection App Refresh uses, so the page does not add a new route.
- The check runs once per drawn Free Apple ID group, not on a timer.

**Not verified:**
- `signing.phoneApps` on a real iPhone: the installation_proxy answer, and a really deleted app being forgotten. No phone test was run. The node tests use a fake shell.
- Apple's real `listAppIds` answer shape on this page. Chromium used a fake bridge and fake data.
- The real Apple sign-in, a real pairing and the slide of the group as it fills were not watched (Chromium stills only).

**Chromium check** (fake sideload bridge, patched sign-in and portal, 390x844): Not Signed In before signing in; the
deleted recorded app was forgotten and the other stayed; after signing in the three App IDs listed, first to expire
first (`listed.png`).

**Tried and failed:** the first Chromium run forgot nothing: the busy check imported `appQueueRunning` from
`signing/queue.js` (it is in `screens/queue.js`), and the catch hid the error, as every node test passed its own
`busy`. Fixed, with a test that uses the default.
