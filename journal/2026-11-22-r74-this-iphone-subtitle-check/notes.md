# R74: This iPhone subtitle on the iPhone 15 Pro

Follow-up to `journal/2026-11-22-b353-this-iphone-subtitle`: check on the real phone that the This iPhone subtitle
in Install Apps With shows whole in the iOS 26 style.

## What I did

- `ios apps --list`: the 15 Pro runs iFizBox 0.22.0, which has B353's fix and the USE / ACTIVE buttons, so no
  build or install was needed.
- Waited about 30 minutes for the UI lock (held by B334, then R75, then B357), then `tools/ui-15.sh R74 launch`,
  tapped Settings > Installation & Signing and took a screenshot (`ref/15/screens/r74-c.png`, not committed).
  Cropped the Install Apps With group to `install-apps-with.png` (half size).

## Result

"Works offline - no install popup" shows whole on one line, with no "...". In the 3x shot the text ends at about
x=785 and the ACTIVE button starts at about x=837, so about 17pt stays clear. The row has its one-line height,
nothing wraps or touches the divider. "Default - Uses ifizbox.com" under Signing Server also fits. The footer
reads "Tap USE to install that way."

Nothing to change, so no follow-up task.

## Not verified

- Only the dark appearance and the default text size were shot (the phone's current settings). Light mode
  doesn't change the text width; a larger Dynamic Type size wasn't tried, because the page sets its own
  font sizes (B353 measured 13px SF in the web view).
- Signing Server as the active route (USE on This iPhone, which is narrower than ACTIVE) wasn't shot: switching
  the route on the shared test phone would change what other tasks see, and the narrower button only leaves more room.
