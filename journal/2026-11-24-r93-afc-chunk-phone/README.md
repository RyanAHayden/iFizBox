# R93: AFC chunk size on the phone itself

## What I did
- Built the app on this Linux desktop with `native/build.sh`. No MBA is needed; the earlier notes saying MBA were wrong.
- The T79 switch is read only under `#if DEBUG`, and build.sh has no `-DDEBUG`. I built a debug IPA from a throwaway
  copy of build.sh with `-DDEBUG` added to the swiftc line. The copy is deleted; nothing is committed.
- Installed the debug build on the iPhone 15 Pro with `tools/ui-15.sh` (phone locked for R93). Variants were set with
  launch arguments: `ios launch com.ryha.ifizbox --kill-existing --arg=-afcChunkMB --arg=N`, plus
  `--arg=-afcPipelined --arg=YES` for pipelined runs.
- Test IPA: a stub app `com.ryha.ifizbox.r93test` (iFizBox's executable renamed, plus a 330 MB random file; 318.1 MB
  to send after signing), put into iFizBox's Documents with afcclient so it shows under Install IPAs.
- Each run: Install IPAs > R93 Test > Install > Confirm (This iPhone). The app signs the IPA, copies it over AFC through
  the built-in VPN, and installd installs it. Speed came from the Console Log line "AFC: copied ... (this run X MB/s ...)",
  read live with pymobiledevice3 syslog. The phone was in front for every run.
- Cleanup: uninstalled the test app and removed the IPA from Documents. The debug build stays on the 15 Pro in place
  of the release build.

## Result
Every run moved 318.1 MB in about 13 s. Speeds (MB/s):
- 1 MB, one at a time (baseline): 24.3, 24.4
- 4 MB, one at a time: 24.2; 8 MB, one at a time: 24.4
- 1 MB pipelined: 24.3; 4 MB pipelined: 24.3; 8 MB pipelined: 24.6, 24.5

All runs fall within 24.2 to 24.6, which is noise (about 1%). Bigger chunks and pipelined reads do not help. The limit
is the route (phone to phone through the built-in VPN) or iOS's AFC side, not the app's send loop. No variant helps,
so no follow-up tasks were filed.

R55 saw 17 to 18 MB/s on the same route with a 340 MB IPA. Today's 24.3 is a little faster, probably a different day or
network state; the 1 MB baseline is the direct comparison. If this is picked up later, the lever is the route itself
(for example Tailscale direct versus the built-in VPN), which was not measured.

## Not verified
- Background or locked copy speed with the variants (every run was in front).
- Other phones (iPhone 7 and others); runs over a slow or relayed network.
- The signed test IPA the app keeps in My IPAs (about 333 MB) was not found or removed; it may still sit in the app's
  storage on the 15 Pro.
- A release build was not measured. It always uses 1 MB one at a time, so it matches the baseline row.
