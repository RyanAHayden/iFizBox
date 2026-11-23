# B386: Wish List button name under the iOS 26 style

**Cause.** The shell's title in the Glass bars (native/Sources/NativeGlass.swift, GlassFace) leaves 12pt on each side.
`.bar-button.wish-button` in packages.css had `padding: 0 7px`, so the glass rect was about 78pt where the title needs
88pt. Its `letter-spacing: -.01em` also made the CSS text about 1.4px narrower than UIKit's.

**Fix.** The sizes are hooks (`--wish-btn-pad`, `--nav-seg2-w`: used in packages.css with their defaults, set in
ios26.css), since the gate refuses layout in an era stylesheet (the first try put it there):
- The Wish List button under the iOS 26 style: `padding: 0 12px` and `letter-spacing: 0`.
- The two-choice nav segments (User | Recent) are 120px, not 167px, so the count fits beside the title.
- installed.js: the count is written as " (n)", with a leading space. The glass title is the button's textContent,
  so it reads "Wish List (1)". The CSS look-alike drops the space and keeps its margin.

**Measured** in Chromium (measure.mjs) at 375, 393 and 402pt:
- Sideload and site: the title is whole with 0 and 1 wished. With 12 wished it is whole at 393 and 402 and cut at 375.
  The segments stay centred and uncut.
- Jailbreak, User | Expert | Recent (167px, not narrowed): whole with no count at any width. With a count the name
  still ends in "…", as before.

**Failed.** A stray `cat` on stdin hung the first edit command for 2 min. It was ended by pid and changed nothing.

**Not verified.**
- On the iPhone 15 Pro with real glass. The UI lock was held by R78a from before 12:00 to after 12:20, and about
  20 minutes of tries got no lock.
- Chromium has no SF font and no UIKit glass. The margin is 2pt: the rect is text + 26, and the glass needs text + 24.
- The jailbreak build on iOS 26+: no phone.
