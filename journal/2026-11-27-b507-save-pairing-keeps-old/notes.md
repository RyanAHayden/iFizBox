# B507: a refused save keeps the old pairing

`IDevice.savePairing` (native/sideload/idevice/IDevice.swift) deleted both kept pairings (remote pairing and lockdown)
before `SecItemAdd`. When the Keychain refused the write, the app was left with no pairing at all, so it showed
Route Failure as Pairing Lost.

Now `savePairing` does this:

- `SecItemUpdate` on the same kind's item (same service and account), with the data and the accessibility class.
- `SecItemAdd` only when the update finds no item (`errSecItemNotFound`).
- Throws as before when neither write succeeds. Nothing is deleted on that path.
- Deletes the other kind only after the save succeeded, so there is still one pairing at a time.

Test: `SavePairing` in native/sideload/idevice/test_idevice.py compiles the real slice from `enum Kind` to
`isLockdownRecord` in IDevice.swift on Linux, with a stand-in Keychain (a dictionary, one item per account, and a
`refuse` switch that makes a write fail). It covers all four kind pairs (remote then lockdown, and the reverse, and
the two same-kind cases): a refused save throws and leaves the old pairing, then a normal save leaves only the new
one. It passed with the fix (`SWIFT_TOOLCHAIN` set to the ubuntu 24.04 Swift 6.4.2 root). It was seen to fail when
the old delete-first line was put back.

What failed on the way:

- The test skips unless `SWIFT_TOOLCHAIN` is set or `swiftc` is on PATH. The variable must be the toolchain root
  (the folder that holds `usr/bin/swiftc`), not the `swiftc` file.
- With the ubuntu toolchain on Arch it needed the libncurses.so.6 shim: Arch has only the wide `libncursesw.so.6`.
  The test links a shim folder into its temporary directory and sets `LD_LIBRARY_PATH`, the same as test_sign.py.

Not changed: if deleting the other kind fails after a successful save, the result is still ignored, as before.

## Not verified

- The real iOS Keychain was not run on a phone: `SecItemUpdate` and `SecItemAdd` on the device, including updating
  `kSecAttrAccessible` on an existing item. A refused write can't be provoked on a phone, and the task asked for a
  Swift or source test.
