# F441: a splash opens the showcase video

## Result
- The splash, then one move: the icon grows into the no-jailbreak phone, as an app opens (2.4 s in, 0.9 s long). The two
  phones, their labels and the code only they used are gone. The rest of the cut is unchanged, 0.3 s later.
- The splash is whole on frame 0, so that frame is the poster.
- `stills/opening.jpg`: the opening in both sizes. `stills/360-wide.jpg`: the poster frame of each at 360 px wide.
- Both MP4s are in `ref/f441/` (gitignored) and on the run page's /concept/F441.

## Decisions
- The plain icon, not the Lite one with its sash: it is the same icon as the end card's.
- `icon-glossy.svg`, as the largest glossy PNG is 228 px.
- The recordings are F440a's, copied from slot 1's output: not captured again.
- The phone's height grows, rather than a clip over the whole phone: clipping left its bottom edge undrawn.

## Checked
- Stills of the opening in both sizes; the splash's text reads at 360 px wide.

## Not verified
- How it plays on X or other sites: nothing posted.
- Smoothness: judged from stills, not watched in real time. Whether a person likes it: asked by CONFIRM.

## Failed
- Rendering both sizes at once: the two `render.mjs` met on one Chromium port, which broke 4:5 and cropped 9:16.
  Rendered again one after the other, as `make.sh` does, both are 4299 frames, 71.65 s, h264, 60 fps.
- `publish-page` could not put the page (7.7 MB) on claude.ai; the run page has it at /concept/F441.
