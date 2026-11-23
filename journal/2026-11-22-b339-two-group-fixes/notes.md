# B339: two group fix dylibs in one app

## The bug

An IPA SideDrop signed carries `sidedrop-groupfix.dylib` (at the .app top level, `@executable_path/…`). iFizBox's
signers add `Frameworks/ifizbox-groupfix.dylib` when they sign it again (checked: `sign-web.mjs` on a SideDrop-signed
probe gives both). Both dylibs rebind every image's `SecItem*` symbol pointers except their own, and both called the
keychain through their own symbol pointers, so each one's calls went to the other's fix: the first keychain call
recursed until the stack ran out. SideDrop's `groupfix.m` (~/repos/sidedrop/native/groupfix/groupfix.m) has the same
`rebindImage`, which skips only itself.

## What I did

Not the brief's first idea (skip any `*-groupfix.dylib` image in `rebindImage`). With only that, the SideDrop
dylibs already out there would still point our image's pointers at their fix, so a call would go app → ours → theirs
→ keychain. No loop, but SideDrop's fix runs last and strips `kSecAttrAccessGroup` from every call, which undoes our
B327 password pinning (the app reads and deletes across shared groups again).

Instead our fix never calls the keychain through a symbol pointer that something can rebind:

- `realAdd`/`realCopyMatching`/`realUpdate`/`realDelete` are function pointers in `__data`, set statically to the
  `SecItem*` functions (a plain dyld bind, not in `__got`/`__la_symbol_ptr`, which is all a fishhook-style rebind
  touches) and then from `dlsym` on Security in the constructor (`findRealSecItem`). Every keychain call in
  `groupfix.m` (the four fixes and `copySharedPasswords`) goes through them.
- Checked in the built dylib: `llvm-objdump --macho --indirect-symbols` lists no `SecItem*` at all, and `--bind`
  shows the four as binds in `__DATA,__data`.
- `rebindImage` still rebinds the other fix's image, so its calls end in our fixes. Whatever the load order, the
  chain is app → (SideDrop's fix →) ours → keychain: no loop, and ours (the pinned group) is always what the keychain
  sees. This also holds against a future SideDrop dylib that does the same thing.
- Rebuilt `web/app/vendor/groupfix/ifizbox-groupfix.dylib` (and `.source-sha256`) with `native/groupfix/build.sh`.
  The new hash changes `SignerStamp`, so every app signed with the fix shows Needs Re-sign once:
  `release-notes/B339.md` says so.

Not done: leaving our fix out when the IPA already carries one. SideDrop's fix lacks B327's isolation, and our fix
must still run for the app to keep its groups.

## Phone check (15 Pro)

Scratch script (not committed): build the probe (`tools/resignprobe/build.sh`), sign it SideDrop's way *with* its
group fix (`zsign -l sidedrop-groupfix.dylib`, `sidedrop-groupfix.plist` `{groups, target "", keychain true}` beside it,
as SideDrop's `sign_ipa`) into `build/last-probe.ipa`, install it, then `tools/resignprobe/run.sh B339 web A
--from-last` (our signer adds our fix on top). `run.sh`'s own `sidedrop` signer adds no group fix, so it can't
show this bug on its own.

RESULTS: see below.
