// Interactive edge-swipe back: a touch that starts at the left edge and moves right drags the top screen with the
// finger, revealing the one below; letting go finishes or cancels the pop (swipeCommits). The caller does the
// drawing: begin() returns the width, move(dx) runs at most once per animation frame, end(dx, vx) on release.
// root is the edge strip (app.js), which has `touch-action: none`: the browser leaves every move to us. A move that
// is mostly vertical gives up, so nothing is dragged by accident. A touch iOS takes away without a pointerup or
// pointercancel (a notification coming down mid-swipe, user 2026-11-18) left the screen half dragged and every later
// swipe ignored: losing capture, the page losing focus or a new touch now cancel it.

const EDGE = 24;    // px from the left edge where a swipe may start (UIKit's is about 20pt)
const SLOP = 10;    // px before we decide between a swipe and a scroll

export function attachEdgeSwipe(root, { canStart, begin, move, end }, win = globalThis) {
  let t = null; // the tracked touch: { id, x0, y0, started, width, dx, samples, frame }
  const drop = () => { if (t) release({ pointerId: t.id, timeStamp: performance.now() }, true); }; // slides back

  root.addEventListener("pointerdown", (e) => {
    if (t && e.pointerId !== t.id) drop(); // the last touch never ended
    if (t || !e.isPrimary || e.button > 0 || e.clientX > EDGE || !canStart()) return;
    t = { id: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, dx: 0, samples: [], frame: 0 };
  });

  root.addEventListener("pointermove", (e) => {
    if (!t || e.pointerId !== t.id) return;
    const dx = e.clientX - t.x0;
    const dy = e.clientY - t.y0;
    if (!t.started) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) { t = null; return; } // a scroll
      if (dx <= SLOP || dx <= Math.abs(dy)) return;
      t.started = true;
      root.setPointerCapture(t.id);
      t.width = begin();
      t.x0 = e.clientX; // start from here, so the screen doesn't jump by the slop
    }
    t.dx = Math.max(0, e.clientX - t.x0);
    t.samples.push([e.timeStamp, e.clientX]);
    if (t.samples.length > 6) t.samples.shift();
    if (!t.frame) {
      const tt = t;
      t.frame = requestAnimationFrame(() => { tt.frame = 0; if (t === tt) move(tt.dx); });
    }
  });

  const release = (e, cancelled) => {
    if (!t || e.pointerId !== t.id) return;
    const tt = t;
    t = null;
    if (!tt.started) return;
    if (tt.frame) cancelAnimationFrame(tt.frame);
    end(tt.dx, cancelled ? -1 : velocity(tt.samples, e.timeStamp));
  };
  root.addEventListener("pointerup", (e) => release(e, false));
  root.addEventListener("pointercancel", (e) => release(e, true));
  root.addEventListener("lostpointercapture", (e) => release(e, true)); // after a pointerup there's nothing left to drop
  win.addEventListener?.("blur", drop);
  win.document?.addEventListener("visibilitychange", () => { if (win.document.visibilityState === "hidden") drop(); });
  return { drop };
}

// B387: while a swipe back is under way neither page scrolls up or down, as on iOS (the pop's pan takes the touch).
// The touch listeners stay passive, so the scrollers themselves are held: `overflow-y: hidden`, which also stops a
// fling at once and keeps the scroll place. pages: the two pages' elements. Returns the release (once).
// A scroller something else holds (the pull to refresh, the A-Z index) is left to it.
export function lockScroll(pages) {
  const held = [];
  for (const page of pages) {
    for (const el of page.querySelectorAll(".page-body, [data-scroller]")) {
      if (el.style.overflowY) continue;
      el.style.overflowY = "hidden";
      held.push(el);
    }
  }
  return () => { for (const el of held.splice(0)) el.style.overflowY = ""; };
}

// px/ms over the last ~80 ms of moves; 0 if the finger stopped before letting go.
function velocity(samples, now) {
  const recent = samples.filter(([ts]) => now - ts < 80);
  if (recent.length < 2) return 0;
  const [t0, x0] = recent[0];
  const [t1, x1] = recent[recent.length - 1];
  return t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;
}

// ---- F373: the page swipe back --------------------------------------------------------------------------------
// As on iOS 26, a rightward drag that starts anywhere on a pushed page (not only on the edge strip) runs the same
// interactive pop: the caller's begin/move/end are the edge swipe's. It never takes the touch over: it listens to
// passive touch events on the screens (no non-passive touchmove, no touch-action change, so vertical scrolling is
// the browser's as before) and decides only after SLOP px of movement: clearly rightward and more sideways than
// down (pageSwipeDecide). Touch events, not pointer events: the browser keeps sending touchmoves after it has taken a
// drag for its own pan (a sideways gallery at its start), where a pointer stream would end in pointercancel.
// It steps aside for a touch that starts where a drag means something else (pageSwipeBlocked).

// What a move of (dx, dy) from the touch means so far: "wait" (inside the slop or not clear yet), "swipe" (rightward
// and more sideways than vertical) or "none" (a scroll or a leftward drag: never ours, for the rest of this touch).
export function pageSwipeDecide(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ay > SLOP && ay >= ax) return "none";
  if (-dx > SLOP && ax > ay) return "none";
  if (dx > SLOP && dx > ay) return "swipe";
  return "wait";
}

// Places whose drags are their own: text fields and sliders, the custom drag handlers (switch knob, roulette wheel,
// section index, Settings' theme split, the icon crop), the edge strip, and full-screen layers (zoomed screenshots,
// popups). Most of them also have `touch-action: none`, which pageSwipeBlocked checks too.
export const PAGE_SWIPE_SKIP = [
  "input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=file])",
  "textarea", "select", "[contenteditable]:not([contenteditable=false])",
  ".edge-swipe", ".switch", ".roulette-wheel", ".section-index", ".theme-preview-grip", ".theme-preview-top",
  ".crop-stage", ".shot-zoom", '[aria-modal="true"]', '[role="dialog"]', '[role="alertdialog"]',
].join(", ");

const sideways = (o) => o === "auto" || o === "scroll";

// Why a touch on `target` must not become a page swipe ("" when it may), walking up to `root` (the screens):
//   "control"   in a text field, slider or custom drag area (PAGE_SWIPE_SKIP)
//   "drag"      in something with `touch-action: none` (it handles every move itself)
//   "scroller"  in something that scrolls sideways and isn't at its left end (the swipe would fight its scroll)
//   "armed"     in a list showing a row's Delete: a right swipe there puts the Delete away (sources.js & co.)
//   "selection" text is selected: the drag is the selection's
// `ends` (F390, the tabs): a sideways scroller steps aside wherever it stands, its left end included.
export function pageSwipeBlocked(target, root, win = globalThis, { ends = false } = {}) {
  const sel = win.getSelection?.();
  if (sel && !sel.isCollapsed && String(sel)) return "selection";
  for (let el = target; el && el !== root; el = el.parentElement) {
    if (el.nodeType !== undefined && el.nodeType !== 1) continue;
    if (el.matches?.(PAGE_SWIPE_SKIP)) return "control";
    const cs = win.getComputedStyle?.(el);
    if (cs?.touchAction === "none") return "drag";
    if (cs && sideways(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && (ends || el.scrollLeft > 0)) return "scroller";
    if (el.querySelector?.(":scope > .armed")) return "armed";
  }
  return "";
}

// root: the screens. canStart() at the touch (nothing else moving, a page to go back to); blocked(target) -> truthy
// to step aside (the caller adds its own reasons to pageSwipeBlocked's). begin/move/end as attachEdgeSwipe's.
// held() -> true when a swipe must ask first (the pairing page's running step): once the drag is a swipe, onHeld()
// runs instead of begin, and nothing is dragged. blocked also gets the touch's point and begin the dx that started it.
// `decide` and `clamp` (F390, attachTabSwipe) are for swipes that go both ways; end's third argument: it was cancelled.
export function attachPageSwipe(root, { canStart, blocked = () => false, decide = pageSwipeDecide, clamp = (dx) => Math.max(0, dx), held = () => false, onHeld = () => {}, begin, move, end }, win = globalThis) {
  let t = null; // { id, x0, y0, started, width, dx, samples, frame }
  const find = (list, id) => { for (const x of list ?? []) if (x.identifier === id) return x; return null; };
  const finish = (cancelled, ts) => {
    const tt = t;
    t = null;
    if (!tt?.started) return;
    if (tt.frame) cancelAnimationFrame(tt.frame);
    end(tt.dx, cancelled ? -1 : velocity(tt.samples, ts), cancelled);
  };
  const drop = () => finish(true, performance.now()); // slides back

  root.addEventListener("touchstart", (e) => {
    if (t) drop(); // a second finger (a pinch: no swipe) or a touch that never ended
    if (e.touches.length !== 1) return;
    const p = e.changedTouches[0];
    if (!p || !canStart() || blocked(e.target, p)) return;
    t = { id: p.identifier, x0: p.clientX, y0: p.clientY, started: false, dx: 0, samples: [], frame: 0 };
  }, { passive: true });

  root.addEventListener("touchmove", (e) => {
    if (!t) return;
    const p = find(e.changedTouches, t.id);
    if (!p) return;
    if (!t.started) {
      // A handler under the finger that took the move for itself (preventDefault) keeps it.
      const d = e.defaultPrevented ? "none" : decide(p.clientX - t.x0, p.clientY - t.y0);
      if (d === "wait") return;
      if (d === "none" || !canStart()) { t = null; return; }
      if (held()) { t = null; onHeld(); return; }
      t.started = true;
      t.width = begin(p.clientX - t.x0);
      t.x0 = p.clientX; // start from here, so the screen doesn't jump by the slop
    }
    t.dx = clamp(p.clientX - t.x0);
    t.samples.push([e.timeStamp, p.clientX]);
    if (t.samples.length > 6) t.samples.shift();
    if (!t.frame) {
      const tt = t;
      t.frame = requestAnimationFrame(() => { tt.frame = 0; if (t === tt) move(tt.dx); });
    }
  }, { passive: true });

  root.addEventListener("touchend", (e) => { if (t && find(e.changedTouches, t.id)) finish(false, e.timeStamp); }, { passive: true });
  root.addEventListener("touchcancel", (e) => { if (t && find(e.changedTouches, t.id)) finish(true, e.timeStamp); }, { passive: true });
  win.addEventListener?.("blur", drop);
  win.document?.addEventListener("visibilitychange", () => { if (win.document.visibilityState === "hidden") drop(); });
  return { drop };
}

// ---- F390: swipes between a page's tabs ---------------------------------------------------------------------------
// The touch side of nav/tabswipe.js (the Details / Reviews / Related panes): the same passive touch stream as the page
// swipe, both ways. One touch is never both: rightward it is the tabs' only with a tab before (tabSwipeTakesBack keeps
// swipe back out), leftward it is never swipe back's.
const STRIP = 20; // px, the edge strip's width (style.css .edge-swipe)
export const tabPagers = new WeakMap(); // page body -> the pager it shows

// Rows with swipe actions and a depiction's own tab bar, besides pageSwipeBlocked's list.
export const TAB_SWIPE_SKIP = ".pkg-row, .source-row, .dep-tabs > .store-segmented";

// Leftward is always the tabs' (the last one rubber-bands); rightward only with a tab before, else it is swipe back's.
export function tabSwipeDecide(dx, dy, hasPrev) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ay > SLOP && ay >= ax) return "none";
  if (ax <= SLOP || ax <= ay) return "wait";
  return dx < 0 || hasPrev ? "swipe" : "none";
}

// The live pager under a touch, or null.
function pagerAt(target) {
  const p = tabPagers.get(target?.closest?.(".page-body"));
  return p?.live() ? p : null;
}

export const tabSwipeTakesBack = (target) => (pagerAt(target)?.selected() ?? 0) > 0;

// root: the screens. onBegin() as a drag becomes a swipe.
export function attachTabSwipe(root, { canStart, blocked = () => false, onBegin = () => {} }, win = globalThis) {
  let pager = null; // the touched page's
  return attachPageSwipe(root, {
    canStart,
    blocked(target, point) {
      pager = pagerAt(target);
      return !pager || point.clientX < STRIP || Boolean(target.closest(TAB_SWIPE_SKIP))
        || Boolean(pageSwipeBlocked(target, pager.scroller, win, { ends: true })) || blocked(target);
    },
    decide: (dx, dy) => (pager.live() ? tabSwipeDecide(dx, dy, pager.selected() > 0) : "none"),
    clamp: (dx) => dx,
    begin(dx) { onBegin(); return pager.begin(dx); },
    move: (dx) => pager.move(dx),
    end: (dx, vx, cancelled) => pager.end(dx, vx, cancelled),
  }, win);
}
