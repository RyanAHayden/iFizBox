# iOS 13 hold menu: flat grey callout

The iOS 13 era loaded no menu rules of its own, so the hold menu (nav/menu.js `.menu`) kept ios6.css's glossy
black bar (gradient, shine, emboss, drop shadow, bold text).

Done, in `web/app/ios13.css` right under the queue hint's block: the `--menu-*` tokens set to the hint's flat
callout (#2c2c2e, #48484a in OLED Black), no drop shadow, shine or emboss; items 14px regular, 36px tall, split by
a half-pixel white hairline (22% / 28%); 8px corners, no border; pressed is the next grey up (#48484a / #636366).
The arrow takes the bar's fill both above and below. Same shape as ios7.css's menu block, scoped to ios13.

Check: a scratch page loading every stylesheet in index.html's order with `data-style="ios13"`, a menu above, a
menu below (arrow up), one item drawn with the pressed fill, and the queue hint beside them; headless Chromium at
2x. Shots: `menu-light.png`, `menu-dark.png`. The menu and the hint share the same grey, corners and height.

Failed attempts: none.

**Not verified**
- The real pressed state (`:active`) under a finger: the shot paints the pressed fill inline instead.
- The menu inside the running app (opened by a real hold) in Chromium: the scratch page builds the same DOM
  cssMenu() builds, which is enough for a look-only CSS change. No phone: Chromium covers a CSS change (AGENTS.md).
- In the app under the native controls hook the shell draws its own UIMenu, so this CSS never shows there.
