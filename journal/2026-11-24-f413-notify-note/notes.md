# F413: Notify note

## What I did
- core/keepid.js: notifyNote(info, {keep, name}) returns a guide note, or null. It fires when Keep Bundle ID is on, the profile is not a wildcard or development one, it has production Push, the app has a com.apple.usernotifications.service extension, its signature asks for non-empty App Groups and/or Communication Notifications, and the profile has none of them.
- sheetNotes puts that note first in the Keep Bundle ID group of signing-sheet.js, through the existing guide row. Settings knows no app, so screens/settings.js and SignBridge.swift needed no change.
- signing.inspect gained profileGroups: Profile.groups (native/sign/Profile.swift) is sent from native/Sources/Sideload.swift, where inspect lives. signing.inspect's `missing` already covered Communication and an absent App Groups key, but not a present empty list, which is the usual case for a profile made without groups.
- An older shell that doesn't send profileGroups: only the absent key counts.
- Website: no Custom Install, so unchanged.
- docs/signing.md: the Warnings bullet (the Custom Install line) covers the note.
- Tests in web/app/core/keepid.test.js: missing both, missing one, has both, the app doesn't ask, no notification extension, other profile kinds, Keep Bundle ID off.
- release-notes/F413.md: one sentence for the user.

## Not verified
- The note on a real iPhone (RyukGram with the empty-groups profile). The pure logic is covered by the node tests only.
- An extension switched off in the sheet doesn't hide the note.
- Whether a given app really loses its notifications. The note says they may not show.
