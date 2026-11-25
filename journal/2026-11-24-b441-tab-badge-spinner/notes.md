# B441 Tab badge spinner (iOS 26 style, glass tab bar)

## What changed

- Page: glass.js sends badge "spinner" for the Sources tab while sources refresh (it was "", which the glass bars draw as a plain dot).
- Shell: native/Sources/TabBadgeSpinner.swift. The tab's badge gets a figure space, and a UIActivityIndicatorView goes into each badge found by that text. A 0.1 s timer runs only while a badge spins.
- Source rows' spinner: already there in this style, so ios26.css is unchanged.

## Phone and build

- iPhone 15 Pro, iOS 27.0.1, Lite build of this branch. Chromium can't draw the glass bars, so the badge needs the phone.
- The installed app's theme: iOS 26 style, appearance auto. The phone's appearance was set to dark as found, and is put back to dark.
- The phone was busy (B439) once; waited for it.

## Shots

- shots/bars.jpg: the glass tab bar with the spinning badge.
- shots/refresh-and-rows.jpg: the Sources refresh and the source rows' spinner.

## Checked on the phone

- A real Sources > Refresh in light and in dark: the white spinner shows in the red badge, then the badge goes when the refresh ends with no failures.
- Badge forced to spinning over Web Inspector (a real refresh is only about 2 s):
  - it turns (two shots 0.4 s apart differ);
  - it still turns after Home and reopening;
  - Sources is the chosen tab;
  - the bar shrunk on scroll: the badge sits on the circle, turning;
  - light and dark;
  - the bar's layout doesn't move;
  - spinning, then set to "2": the badge shows 2 and the spinner is gone.
- Source rows' spinner: seen in a real refresh on one row, and with the rows' loading class set by hand in light and dark.
- Nothing tried failed.

## Not verified

- A real refresh that ends with failures on the phone (count set by hand; glass.test.js covers what is sent).
- Coming back during a real refresh (forced badge only).
- VoiceOver's reading of the blank badge.
- iOS 26 itself (only the iOS 27 phone here). A different badge view would leave a blank red badge, as the spinner goes into the label's superview holding the blank.

## After the spec review

The layout pass on each tick is gone (it could disturb the shrink animation): it runs only as the spinning starts.
Rebuilt and checked again on the phone in dark: unselected, chosen, shrunk, and shrunk after Home and back, all turning.
A badge UIKit makes anew can be blank for up to 0.1 s; no frame-by-frame recording of the shrink was made.
