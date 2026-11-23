# B410: apt's refusal on a shared .deb shows each reason whole, and a copy failure is said in plain words

## What the sheet does now (web/app/screens/sharedeb.js, openDebConfirm)

- When apt refuses, each sentence (apt's problems, the essential-package line, "apt refused …") is a wrapping
  `.pkg-description` cell in one red block. It used to be a one-line row cut with an ellipsis. The block comes from
  `refusedBlock` (screens/queue.js), which now takes a third parameter, `header` (default "Couldn't Ask apt"; this sheet
  passes "Can't Do This Yet").
- All the sentences share one block. queue.js's drawIssues makes one group per sentence because its rows have actions;
  this sheet has none.
- Exit 74 (policy.h's HELPER_EX_IOERR: paid.c couldn't copy the .deb, so apt never ran) is now said too. ShareRun's
  simulateDeb throws only for 64, 77 and 126, so 74 arrives as an answer, not an error. The sheet takes the reason from
  the last "ifizbox-helper: " line of the output, passes it through debRefusal, and shows it under "Couldn't Ask apt"
  with "Nothing was changed." There is no apt's Output block for this case.
- findLast and .at are avoided (iOS 15.4+); the code uses filter and pop.

## Checks

- `web/app/screens/sharedeb.test.js` (node --test): 3 new tests, for apt refusing, an essential package and exit 74.
- `journal/2026-11-23-b410-shared-deb-apt-refusal/shots.mjs`: Chromium with a fake bridge, states apt, essential and io,
  iOS 6 and 26, light and dark. Nothing is cut off and there are no page errors.

## Not verified

- On the real iPhone 7. Chromium can check the sheet, so the phone was not used (phone rule).
- The real helper's exit 74. The fake bridge supplied the answers.
- iOS 7 and 13 looks were not shot.
