# F366: Use the Signing Server after a This iPhone failure

## What I did
- `core/installroute.js`: `serverFallback(err, route)`, which returns the route failure (`routeFailureOf`) only for a This
  iPhone install (`route: "idevice"`), never after a cancel; also `USE_SERVER`, `USE_SERVER_LINE`, `serverStep`.
- Single install (`signing/route.js` installOnDevice): a new `server` option skips `chooseRoute` and sends
  `manifestServer: defaultServer()` (the brief says the default ifizbox.com server, so not a custom one the user set).
  When This iPhone fails with a route failure, the alert's buttons are OK, the fix (B316's), Use the Signing Server.
  The progress page's log also gets a help line with the same button. Either one runs once (`serverRetry`). Picking it
  from the alert reruns inline, so the one-install-at-a-time lock stays held, and the alert returns the rerun's result.
- The queue run (sideload app's black page):
  - `signing/queue.js` openPrepared takes `server` the same way. A This iPhone failure's error carries `fallback`.
  - `screens/apprun.js` phoneLanes keeps `fallbacks` (row id → failure) and `useServer()`/`serverRoute()` for that run.
  - At the run's end, `offerServer` adds a help line to the Log for each failed app ("A: <short>" [Pair Again / Sign
    In …], using runFix, which closes the page first for fixes that open Settings), then "ifizbox.com can install it
    instead, this time only." [Use the Signing Server]. The bottom's `also` button gets the same choice. The run's
    rows show on Apps by default, so a Log-only offer would be hidden in multi-app runs.
  - Tapping it reruns only those failed rows (`run.retry`) through the server.
  - `screens/queue.js`: lanes.local is false once the run switched, so the rows say Tap Install again and the prompt
    rows go one at a time (no F359 parallel installs).
- `signing-client.js` re-exports `runFix` for the lanes' fix line.
- Install Apps With (stored route) is never written. Tests check it stays "iphone". The Route Failure stays kept: a
  server install doesn't clear it (the route is still broken).
- Test: `web/app/install-server-fallback-f366.test.js`.
- Docs: docs/sideload.md (This iPhone paragraph). Glossary: Signing Server Fallback.

## Tried and failed
- A `get server()` getter on the lanes: heldLanes copies the lanes with a spread, which would freeze it. Replaced it
  with a `serverRoute()` function before testing.

## Not verified
- On a real phone (the iPhone 15 Pro): not done. Breaking the pairing or Tailscale on the 15 to get a real refusal and
  then watching iOS's prompt via the server needs the owner's Tailscale login state (memory: logins need the owner)
  and would leave the test phone's pairing broken. The logic is all in web/app and covered by node tests with the
  bridge stood in.
- Chromium look of the help lines with the long "Use the Signing Server" bar button at 320 pt: not shot. The help line
  layout is F252's (text left, button right), and a long label may squeeze the text to two lines.
