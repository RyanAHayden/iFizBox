# B447 queued package: Modify

Done: browse.js `buttonLabel` says Modify for a queued apt package (`pageQueued`, paid too); an `installQueue.subscribe`
relabels pages on screen at once; `installNoModify` is false when queued, so the tap opens the sheet; Clear is red
(also in `paidActions`), and a queued, not-installed package's sheet drops Install (Clear gives it back).
Test: installtap.test.js (label on queue/clear, tap opens sheet). Whole web suite passes.

**Not verified**: Chromium with the fake bridge (not run; node tests cover the label and tap logic).
