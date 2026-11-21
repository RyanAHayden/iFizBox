# B292: notice a dead route sooner during the AFC copy

R53 run 2 (journal/2026-11-21-r53-user-phone-bg-copy): the Tailscale path to the phone's node dropped mid-copy; the
copy waited its 30 s quiet limit, then 10 s for the stuck call, before reconnecting (42 s lost).

## What I did

- `HereRecheck.CopyQuiet` (native/sign/HereRecheck.swift, pure): the copy's quiet limit from how fast chunks land.
  After 4 chunks, the limit is 4 × the slowest of the last 16 gaps between chunks, clamped to 8…30 s. A copy at its
  usual pace (chunks every 0.06-0.5 s) now counts a stall as a drop after 8 s instead of 30 s; a slow route (DERP, a
  weak network: chunks every 4 s) gets 16 s; nothing ever waits longer than before (30 s).
- A gap that spans the app being suspended is left out of the pace: the watchdog now counts suspensions
  (`Watch.noteSuspended` / `suspensions`), and the copy compares the count per chunk.
- `Watch.setLimit` changes the running step's limit; the copy loop sets it after every chunk and logs
  "AFC: quiet limit N s" when it moves by 5 s or more (so the log shows when the short limit took over).
- installd's 180 s limit, the AFC request limits and the tunnel limits are unchanged.
- Test: native/sign/tests/sideload/main.swift, "the copy's quiet limit follows how fast chunks land (B292)".

## Chosen, and why

- The brief offered tsnet's "stopped hearing back" / path change as a signal too. Not done: that needs a hook out of
  the Go tsnet node into Swift, and in R53 run 2 "stopped hearing back" came at 15 s after the stall began, later
  than the 8 s floor; the phone's node also starts a new handshake about 5 s into every install, so path events alone
  are noisy. The pace-based limit catches the same stall on both routes (Tailscale and LocalDevVPN).
- The 8 s floor: the brief's "~8-10 s". The ×4 factor keeps a route whose chunks vary (background copies run at 82-95 %
  of front speed) far from a false timeout; a false timeout costs only a reconnect and a resume (B246).
- The 10 s grace after closing the tunnel is kept: an earlier return of the stuck call is what keeps its thread from
  touching the run while the reconnect has started; shortening it would make that race likelier. With the new floor
  the R53 stall would cost about 18 s instead of 42 s.

## Not verified

- Not run on the iPhone 15 Pro: a Tailscale path loss mid-copy can't be forced on demand (R53 saw it once in 7
  background runs, by accident), so the shorter limit firing on a real stall is checked only by the unit test and by
  reading the R53 timeline. A normal install's log line "AFC: quiet limit 8 s" was not seen on a device either.
- The sideload/jailbreak app builds were checked only by the gate (tools/check.sh).
