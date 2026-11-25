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
