# B463: Pull area shows outside the gap

## Done
- `web/app/style.css`: the spinner's visibility and animation now apply only under `.pull-clip.on > .pull-refresh.refreshing .pull-spinner`. Before, a child's `visibility: visible` overrode the clip's hidden state, so the spinner was drawn and spun while the clip was hidden. The `:root` spinner-turns hook (F381) uses the same selector, so it still wins.
- `web/app/nav/pullrefresh.js`: `show(false)` parks the area at `translateY(-480px)`, wholly above the clip's top. The scroll listener re-measures the clip (`ensure()`) whenever the area comes on from a fling, not only when the clip was detached.
- `web/app/nav/pullrefresh.test.js`: three tests. The area is parked after a bounce whose last event was -50. A fling re-measures the clip at the list's new `offsetTop`. No CSS rule shows or turns a pull child outside `.pull-clip.on`.

## Causes
1. The spinner's own `visibility: visible` beat the clip's hidden state during a refresh.
2. On the native rubber band, the area follows `scrollTop` only in scroll events under 0. The last event of a bounce could leave the area tens of points down the list once the list was back at 0. Hidden, it stayed there.
3. The clip's top and height were measured only on a touch at the top. A fling's overshoot reused the old box, so after the list's top moved (a strip, header or the reload bar came or went), the clip started above the list, over the nav bar or pinned headers.

## Tests
- `node --test web/app/nav/pullrefresh.test.js web/app/nav/spinner.test.js`: 39 pass; `node --test web/app/`: 3750 pass.

## Not verified
- Not checked on the iPhone 7. The fix comes from reading the CSS and JS and from the unit tests. A phone test needs a fresh .deb built with this change.
- Not checked in Chromium. Chromium has no native rubber band, so causes 2 and 3 do not happen there.
- Not confirmed whether iOS WebKit also failed to clip the composited area layer under a hidden clip. The fix removes every visible part outside the gap either way.
