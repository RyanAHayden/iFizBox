# D25 Launch-screen strip caveat: theoretical on current iPhones

Reworded the paragraph under the launch-screen table in docs/native.md. It read like a visible jump on Dynamic
Island phones; R68 (journal/2026-11-21-r68-island-splash-offset) measured on the iOS 26.3 Simulator that every
Dynamic Island model has a 54 pt status bar and a 59/62/68 pt safe area, so `TopInset`'s island margin is at most
5.67 pt (< 6) and it always returns the safe area, the same line the storyboard pins to. The paragraph now says the
strips meet on every current iPhone, gives those numbers, and keeps one sentence for a future phone that clears the
island by 6 pt. No task IDs in the doc (docs describe the current state only).

## Not verified

- No new measurement: the numbers are R68's, from the Simulator only (iOS 26.3, the only runtime on the MBA), not
  real devices.
