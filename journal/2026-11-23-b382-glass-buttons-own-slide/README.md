# B382: glass buttons keep their own slide

## What
- Reproduced on the iPhone 15 Pro (iOS 27, 0.25.0 HEAD build). The phone, not Chromium: Chromium has no UIKit glass.
- Before: on Settings' Back tap (`before-tap.jpg`) the CSS look-alike About and Reload slide in. At about 0.27 s, when the
  slide is done, the glass swaps in and flashes brighter, still reading "Home" (the old page's title). UIKit then
  dissolves Home into About over about 0.2 s. The same happens on Sources and on the back swipe. Both suspects were
  confirmed: the glass appears only after the slide, and it keeps the old title.
- Fix: the shell keeps the buttons through the whole slide.
  - `web/app/app.js` `slide()` dispatches `ifizbox:slide` with `{item, ms}`.
  - `web/app/nav/glass.js` `slideGlass` sends the coming page's buttons once, with `slide: ms`. Both pages' look-alikes stay
    see-through from the first frame.
  - `native/Sources/NativeGlass.swift`: each UIButton's glass configuration is set once and never retitled. The title or
    glyph is an own overlay (`GlassFace`) that cross-fades while the capsule moves to its new rect, on the page slide's
    curve. Buttons that come, go or change glass kind fade by alpha.
  - Under a finger (edge swipe) the glass stays as it was. A cancelled swipe sends nothing.
  - A real UINavigationBar wasn't needed.
- A popup closing into a slide: the glass comes back as the slide starts, already with the coming page's buttons. Glass
  that one of the page's sheets or pages covered when the slide starts stays away until it ends (look-alikes slide).
- The swipe's end slides on another curve (EASE_OUT), sent along, so buttons and page keep step.

## Failed attempts
- The first build re-measured the coming page's rects during the slide. WebKit's rects under a running animation move
  between two reads, so Reload sat 5 px (1.7 pt) off and snapped back at the end. Now the rects are measured once,
  before the first frame.

## Checked on the phone
- Rest frames have nothing changing except the press glow and spring UIKit plays on the tapped Back button as it is
  released.
- Dark and light; Home and Settings; Sources (Refresh, Add, Manage) and More Sources; a source page (share glyph) and
  Details (check glyph and Install); push; back tap; back swipe; cancelled swipe; tab switch.
- Modify's anchored menu (B383) still opens out of its glass button.
- In swipes the buttons cross-fade when the finger lifts, not with the finger. That is deliberate: no per-frame bridge
  traffic.
- A label the coming page changes mid-slide shows when the slide ends.

## Recordings
- `before.mp4`, `after.mp4`, `after-light.mp4` (`rec.sh`: Home/Settings and Sources/More Sources) and
  `before-icons.mp4`, `after-icons.mp4` (`rec2.sh`: Details, Back to a source page, Back to Sources: different Back
  titles and right buttons). `strip.sh` cuts the frame strips: `*-tap.jpg` and `*-swipe.jpg`.
- Method, worth keeping: WebDriverAgent `POST /session/<id>/wda/video/start` with `{"fps":60,"codec":0}`, then
  `POST /session/<id>/wda/video/stop`. Pull the file with
  `ios file pull --app=com.apple.testmanagerd --remote=/Attachments/<uuid> --local=x.mp4` from the rig folder. Frames
  come out with `ffmpeg -fps_mode passthrough`, at 60 fps.

## Not verified
- The prominent (Done) kind changing to or from plain across a slide: no pushed page with one was recorded.
- The Reduce Motion path (the change happens at once): not exercised on the phone.
- A tweak or jailbreak build on iOS 26 and later: there is no such phone.
- The popup-closing-into-a-slide path: in `glass.test.js` only, not recorded on the phone.
- Modify's menu and Installed were checked one build before the last (the curve, popup and same-face changes came after).

## Seen, filed
- Installed's "Wish…" truncation (B386). Already in 0.25.0; not part of this change.
