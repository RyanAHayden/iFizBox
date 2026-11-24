# R93: AFC chunk size on the phone itself

## What I did
- Read the upload in `native/sideload/idevice/IDevice.swift` (the copy loop, 1 MB `chunk`, one `afc_file_write` at a
  time, then the speed log every 8 chunks).
- Looked for a way to measure on the iPhone 15 Pro through the app. It needs a build with a switch, and the app builds
  only on the MBA: `ssh mba` timed out (mbas-macbook-air port 22). A research task may not change code, so the switch
  cannot be part of this branch either.
- Filed the two steps instead: T79 (the test switch: chunk 1/4/8 MB and pipelined, logging MB/s, default unchanged)
  and a new R task after it that does the measuring.

## Result
No MB/s measured. Nothing new beyond R91: desktop USB 150 MB/s, the phone's own route 17-18 MB/s (R55).

## Not verified
- Every variant (4 MB, 8 MB, pipelined) on the phone: no build possible (MBA unreachable, and no switch exists yet).
