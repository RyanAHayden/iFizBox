# B441 Tab badge spinner (iOS 26 style, glass tab bar)

- Page: glass.js sends badge "spinner" (was "", which UITabBar draws as a dot).
- Shell: native/Sources/TabBadgeSpinner.swift. The tab's badge gets a figure space, and a UIActivityIndicatorView goes
  into each badge found by that text. A 0.1 s timer runs only while a badge spins.
- Chromium can't draw UITabBar, so the rest needs the iPhone 15 Pro.

## Not verified (in progress: the phone was held by B439)

- Everything on the phone: the spinner at all, its size, light and dark, shrunk bar, after coming back, the end count.
- The source rows' own loading spinner in this style.
