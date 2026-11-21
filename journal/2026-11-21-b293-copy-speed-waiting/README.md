# B293: the copy's speed summary counts stalls as waiting

R53 showed the This iPhone route's "AFC: copied …" summary hiding or blending in dead time: run 2 stalled 40 s and
the summary had no background figure, run 8 counted 15 s with the VPN off as copying.

## What changed

- `HereRecheck.CopySpeed` (native/sign/HereRecheck.swift) now splits each chunk's gap into moving and waiting time.
  Once 4 chunks have landed, the part of a gap beyond 4x the median of the last 16 moving gaps (never under 1 s) is
  waiting. Only moving time counts toward the front/background speeds; waiting is its own figure:
  "17.5 MB/s in front, 14.2 MB/s in the background, 42 s waiting for the connection". Waiting under half a second
  isn't shown. Stalls are capped before joining the pace, so one stall doesn't raise the limit for the next.
- IDevice.upload keeps `HereRun.lastLanded` across reconnects, so the first chunk after a drop carries the stall,
  the reconnect pauses and the new connection as its gap (before, each upload call started its clock afresh, so
  the stall and the reconnect were counted nowhere: run 2's case).
- Tests in native/sign/tests/sideload/main.swift: R53 run 8 and run 2 shapes, a slow but steady route (no waiting),
  no pace yet (gap counts whole), the stall not raising the limit.

Why a median and not the slowest gap (as B292's CopyQuiet): the summary wants a chunk's normal time, and a single
slow chunk shouldn't let the next stall pass as copying.

## Not verified

- Not run on a phone: a Tailscale path loss can't be forced, and a VPN-off run on the 15 Pro needs the rig plus a
  Lite build; the accounting is pure and tested on Linux, and the IDevice change is two lines.
- The jailbreak/sideload builds in tools/check.sh are run by `done`.
- If a copy drops and never resumes (the second look finds the app installed), no summary is logged at all — same
  as before this change.
