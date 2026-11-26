# B472: Pull to refresh area moves with the list

## Done
- `web/app/nav/pullrefresh.js`: the `.pull-clip` is now a zero-height anchor appended inside the scroller, its top set to the scroller's top padding. Home's page-body pads under the nav bar; Sources and Changes' `.search-results` have none. The area's foot therefore sits on the list's top.
- `web/app/nav/pullrefresh.js`: nothing follows `scrollTop` any more. `follow()` and the area's own spring animation are gone. On the script path (Chromium) the anchor is one of the scroller's children that `place()` moves, so the area moves with the rows. A touch at the top, or a fling's overshoot, puts the anchor back if a redraw took it away. While nothing is pulled the anchor stays `visibility: hidden` (on Home its foot would otherwise show through a translucent nav bar).
- `web/app/style.css`: `.pull-clip` is height 0 with no overflow clip. `.pull-refresh` sits at `bottom: 0` of it, 480pt tall, on its own layer (`will-change: transform`), with no `translateY`.
- `web/app/nav/pullrefresh.test.js`: the anchor is inside the scroller; nothing writes a transform on the native path; the anchor's top is the padding and it comes back after a redraw; CSS shape (zero-height anchor, own layer, no clip box from the list).

## Cause
Since F270 the area was not inside the scroller. It sat in a clip box (`.pull-clip`) next to it, measured from the list (`offsetTop` plus padding), and a script transform moved it to follow `scrollTop` in scroll events. iOS sends those events only now and then during the rubber band, so the area lagged and chased the rows. The box was measured at touch time, so it went stale when the list's top moved (B463).

## Tried
- F270 first put the area inside the scroller at a negative top. The iPhone 7 showed a blank gap: WebKit does not paint content above a scroller's scroll origin on the scroller's own layer.
- The fix here keeps the area in the scroller as a layer of its own (`will-change: transform`). WebKit does paint that in the rubber-band gap (checked on the iPhone 7).

## Decisions
- The anchor sits below the scroller's top padding (`.page-body` pads every page by the nav bar's height), so when pulled the area also covers that padding, under the nav bar. That is how UIKit treats content inset under a bar: the refresh area sits above the content's top, not above the inset. Anchoring at the padding box's top instead would let the plain padding slide down first and keep the arrow under the bar until the pull passed the bar's height. Under an opaque iOS 6 bar it cannot be seen. Under a translucent bar (other eras) the area's ground shows through the bar only while a pull is held. The spec review raised this; kept on purpose.

## Checks
- `node --test web/app/`: 3785 pass.
- Fresh .deb built from this branch (`native/build.sh deb`, com.ryha.ifizbox 1.0.3-6014) installed on the iPhone 7. No screen recording tool exists for the 7, so bursts of screenshots taken during `tools/ui-7.sh` swipes stood in for it (8-10 frames per gesture):
  - Sources, slow pull and a long pull past the trigger: the arrow turns over, "Release to refresh..." shows, the area moves with the rows and is cut off under the search bar.
  - Sources, fling past the top during a refresh: the spinner and "Refreshing..." sit in the gap, it springs back, nothing is left at rest.
  - Changes, a pull with its pinned date headers: "Today" moves down with the rows, the area stays above it.
  - Home, slow pull: the area fills the space under the nav bar on the pinstripe ground, never over the nav bar.
- Chromium (B161's `capture.mjs`, website mode, CDP touches): held script pulls on Home and Sources. The area's bottom edge equals the first row's top (175.3 and 217.7 CSS px), and the anchor is hidden and untransformed after the spring back.

## Not verified
- True 60 fps video. The screenshot bursts show only 8-10 frames a gesture, so a one-frame lag between scroll events and the visibility switch at the very start of a pull cannot be ruled out. It would show the page ground for that frame, the same colour as the area.
- Changes' pinned headers were checked on a list too short to scroll, so a header held pinned mid-list during a fling's overshoot was not seen there. Sources' pinned "Tweak Sources" header was seen pinned before the fling and was fine.
- iOS 7/13/26 era looks with translucent bars were not checked on the phone.
- The iPhone 15 (Lite build) was not checked. It runs the same web code.
