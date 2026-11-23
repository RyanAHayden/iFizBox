# B399: source refreshes read the phone's HTTP cache

Report: a push told of OpenTennis 1.9.2 (pushed 16:00:27, source changed 16:00:21); Changes, refreshes and a relaunch
showed none. The push server was right. `fizl0.github.io/apps/source.json` answers `max-age=600`.

Reproduced on the MBA (macOS URLSession; `repro.swift` against `srv.py`, `max-age=600`, a new body each answer):

| requestCachePolicy | second fetch | after a relaunch |
|---|---|---|
| default (as net.fetch had) | old body, server not asked | old body, server not asked |
| reloadRevalidatingCacheData | new body | new body |
| reloadIgnoringLocalCacheData | new body | new body |

Chosen: no cache (`urlCache = nil`, reloadIgnoringLocalCacheData), as the user asked unless caching saves a lot. It
doesn't: over nine real sources, 304s would save under 1 MB a refresh, 0.76 MB of it apptesters.org's, and no time
that shows. Set on `Apt.session`: net.fetch, net.packages and Paid's calls. The app's own catalog store (catalog.js
altText, what Changes shows before and without a refresh) stays: a refresh rewrites it.

A tapped update alert only set the route: from the background nothing refreshed. It now also runs the quiet source
refresh (`refreshInBackground`, which does nothing while one runs).

## Not verified

- The user's phone's cache was not read: the cause fits the times and the reproduction. GitHub's edge can also hold an
  old copy up to 10 minutes; asking the server does not change that (a query did not seem to pass it either).
- A real push tapped on a phone: the 15 Pro was left alone; the two halves are checked by test_notifications.py.
- refreshInBackground skips while another refresh runs, so one begun before the tap is not repeated.
