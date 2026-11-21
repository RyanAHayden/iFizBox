# F353: Tailscale machine name by phone model

Code and the table check are done. Tailscale's own naming on the 15 Pro is not checked yet.

## What was done

- `native/sideload/tailscale/Tailscale.swift`:
  - New `Tailscale.modelNames`: a table from the hardware identifier to the model name, for every iPhone from the
    6s (`iPhone8,1`) to the 17 line and Air (`iPhone18,x`).
  - New `machineName(deviceName:model:machine:)`, which picks the name in this order:
    1. `UIDevice.current.name`, when it differs from `UIDevice.current.model` (the phone is entitled, or runs iOS
       15 or older).
    2. The table's name for the model.
    3. The bare identifier.
  - New `machineIdentifier`: utsname machine, or the model the Simulator stands in for
    (`SIMULATOR_MODEL_IDENTIFIER`).
  - `TailscaleBridge.register` sets `Tailscale.deviceName` from these at launch. `hostname` stays
    `"<name> on <deviceName>"`, so the 15 Pro becomes "… on iPhone 15 Pro", which Tailscale turns into
    `ifizbox-on-iphone-15-pro`.
- `test_tailscale.py`, class `MachineName`:
  - Reads the table out of the Swift source.
  - Checks that each identifier appears once and that the names and identifiers have the right form.
  - Checks key entries: 15 Pro = `iPhone16,1`, 7 = `iPhone9,1`/`iPhone9,3`, and so on.
  - Checks that every iPhone that runs iOS 15+ is listed.
  - Runs the selection rules (in Python, mirroring the Swift) and the label Tailscale would make from the name.
  - Checks that the Swift calls them.
- The SE models are written "iPhone SE 2" / "iPhone SE 3", not Apple's "(2nd generation)", so the machine name
  stays short.

`tailscale status` on the desktop before the change showed the bug: `ifizbox-on-iphone`, `-1` … `-5`.

## Tried and failed

- No Swift toolchain on Linux to unit-test the Swift itself, so the table check parses the source. The gate's
  native build compiles it.

## Not verified

- On the 15 Pro, after Sign In, `tailscale status` listing `ifizbox-on-iphone-15-pro`. This needs:
  - a build with this change installed on the 15, and
  - a new Tailscale Sign In there, which needs the owner's login (see the memory note "iPhone 15 Lite state +
    Tailscale login").

  It also stays open whether an already-registered node is renamed when its hostname changes: Tailscale keeps a
  name that was set by hand in the admin console. For an old node, Sign Out and Sign In again, or rename it in
  the console.
