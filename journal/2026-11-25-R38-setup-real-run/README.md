# R38: run the setup command for real

## What I did

Checked whether the run can start. It cannot yet.

- F254f (the website's "Download for a Computer Install" and the code the setup command needs) was dropped from the run app, so the page that shows a code does not exist on main. The F258 command has no code to take, so there is nothing to run against the iPhone 15.
- The first 'setup' release (`tools/setup/release.sh`) publishes outside git and needs the user's OK.
- The Mac (Apple silicon and Intel via `arch -x86_64`) and Windows 11 x64 / ARM64 runs need those machines with the user.

No code changed.

## Not verified

- Install, pairing file written, app reads it (F254g) on the iPhone 15: no code source (F254f dropped).
- Universal macOS build, ad hoc signature accepted: no Mac run.
- Windows 11 x64 and ARM64 (Apple Devices driver on 27015, Store link 9NP83LWLPZ9K, no window closing under `iex`): no Windows machine.
- The first setup release: needs the user's OK to publish.

## Update (answer: Re-queue the page)

The person chose to re-queue the website's computer-install code page. Filed as F436 (replaces the dropped F254f). R38 now waits for F436; the real run (release, iPhone 15, Mac, Windows) starts after it lands. No code changed.

## Update 2 (F436 landed)

F436 is on main, so the code page exists. The real run still starts with the first 'setup' release (`tools/setup/release.sh`), which publishes outside git and needs the user's OK; the iPhone 15 run, the Mac and the Windows 11 x64 / ARM64 runs follow it and need the user at those machines. Blocked on the release OK. No code changed.

## Update 3 (release OK given: Publish it)

Probed the builds with `tools/setup/release.sh --probe`: Linux x86_64/arm64 and Windows x64 can build. Fetched llvm-mingw
(`tools/setup/llvm-mingw.sh`), so the Windows ARM64 build has its compiler now. The macOS build still has no
MacOSX.sdk: it comes from the MBA (`tools/setup/macos-sdk.sh`) and `ssh mba` times out (host mbas-macbook-air, port 22).
I did not publish: a release without the universal macOS build would send Mac users an install script line saying
"no build" and R38's Mac check would have nothing to run. Waiting for the MBA to be reachable.

Release state: no `setup` release exists on GitHub yet.

## Not verified (update 3)

- Everything in the first Not verified list, plus: the Windows ARM64 and macOS builds were not made here (macOS: no SDK, MBA unreachable).
