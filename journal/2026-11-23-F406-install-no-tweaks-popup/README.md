# F406: Install goes straight to the queue screen

Removed `installTweaksChoice` and `pushAddTweaksUntilBack` (screens/tweaks.js) with their header lines, the `tweaks`
option of `appPageAction` and its import in altstore.js. `addFresh` now goes to the original-app question
(`queueOriginalCheck`) and queues. Kept tweaks still go in through `keptTweakParams` at signing time; the Add Tweaks
row is unchanged. Version History rows use the same `addFresh`, so they follow.

Tests: the two popup tests in tweaks-app.test.js are replaced by one: Install on an app with kept tweaks queues at once,
asks nothing, and `keptTweakParams` still carries the tweak. `node --test web/app/`: 3490 pass.

I ran one `sed -i` by mistake (an unused import in tweaks.js); the result was checked by the test run.

**Not verified**: the Chromium shot of Install landing on Confirm was not taken; the queue-and-open path is covered by
queueinstall.test.js and the new test.
