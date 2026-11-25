# F431: phone remote for the 7 and 4S

## What I did
- `tools/remote-15.py` takes a phone argument: `15|7|4s` and an optional port. The 15 stays the default on 8098; the 7 is on 8099, the 4S on 8101 (8100 is WDA's).
- Each phone has its own lock, with the same rules: free -> `USER`, "Use it anyway" for a task's holder, SIGTERM frees only a `USER` hold.
- The page offers only what that phone's ui script does. 15: tap, swipe, Home, type, Wake. 7 and 4S: tap, swipe, Home (Home wakes the 7).
- 7 screen: one ssh running `phonectl shot` to stdout in a loop, only while someone watches (~2.5 fps). Nothing kept on the phone, no lock.
- 4S screen: Veency over ssh through `tools/veency.py`, only after "Show screen". It takes the lock or needs "Use it anyway", wakes and unlocks the 4S, and presses Veency's Accept prompt itself. Keeps nothing; Camera Roll untouched. About half a second per change. Ends when the lock changes hands or nobody has watched for 60 s.
- Veency gotchas handled in the tool: a prompt left behind the lock screen blocks later connections until answered (the tool wakes first and answers leftovers); the arrow it leaves on the phone after disconnect is parked in the bottom right corner.
- "Already serving" is checked per phone, so another phone's page does not block a start.
- Docs: `docs/iphone15.md`, "Remote control for a person", now covers the phone argument, ports, per-phone features and screens.

## Alternatives rejected for the 4S screen
- Activator screenshots: they go in the Camera Roll, and the 4S has no rm to clean them up.
- Own armv7 capture tool: no armv7 linker on this machine.

## Tried and failed
- Connecting with the 4S asleep: a tap on the screen-off phone does nothing, the Accept prompt queued behind the lock screen, and Veency stopped answering. Four prompts were then accepted by hand under the lock.
- Colour depth: 32-bit colour was 1 MB and 1.2 s a frame. RGB565 with zlib gives 0.35 MB and 0.5 s a frame, so the tool uses that.
- Veency's arrow stayed on screen until it was parked.

## Checked
- Live: the 7 and the 4S on their default ports (home, swipe; the 7 got a tap over the page, the 4S's taps were exercised by Accept). The 15 on spare port 8103, because a person's own page was serving 8098 (wake, home, swipe). All three locks were free afterwards.
- Pages for all three phones in Chromium: only the right buttons show.
- The 4S Camera Roll count was 118 before and after a remote session. My own test shots from `ui-4s.sh` added about 7, and those stay.
- `tools/test_remote_15.py`: 10 tests, using fakes.

## Not verified
- The Tools page's own entries for the 7 and 4S (not in this repo's task).
- The 4S in landscape (Accept would be elsewhere).
- The page on a real iPhone browser with the 7 or the 4S.
- Tap and typing on the 15 through the page this time: their code path is unchanged; only Wake, Home and swipe were tried live.
