// B48: a click that ends a drag or a scroll is not a tap. iOS can still send click after a short drag (the tap
// recogniser allows more movement than the pan's start), or after the pane scrolled under a resting finger, and a
// scroll that started on Install then installed the app (user 2026-11-18). This follows each touch from its
// pointerdown: how far it moved, whether anything scrolled while it was down, whether iOS cancelled it. Install and
// destructive actions wrap their handler in guarded(), which drops a click that ends such a gesture.
//
//   row.onClick = guarded(() => install())   // ignores the click when the touch moved > MOVE px, scrolled or was cancelled
//   tapGuard().endsDrag(clickEvent)          // the same test, for a handler of your own
//
// A click with no touch behind it (keyboard, el.click(): detail 0, or a call with no event) always runs.

export const MOVE = 10;     // px a tap may wander, as longPress's
const STALE = 1000;         // ms after the lift that the gesture still speaks for a click

export function createTapGuard(doc, { now = () => (globalThis.performance ?? Date).now() } = {}) {
  let g = null; // { id, x, y, moved, scrolled, cancelled, down, upAt }
  const opts = { capture: true, passive: true };
  const moveTo = (x, y) => { if (g && Number.isFinite(x) && Number.isFinite(y)) g.moved = Math.max(g.moved, Math.hypot(x - g.x, y - g.y)); };
  const on = {
    pointerdown(e) {
      if (e.isPrimary === false) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, scrolled: false, cancelled: false, down: true, upAt: 0 };
    },
    pointermove(e) { if (g?.down && e.pointerId === g.id) moveTo(e.clientX, e.clientY); },
    // iOS stops pointermove once it pans; the touch's own moves still come.
    touchmove(e) { const t = e.touches?.[0]; if (g?.down && t) moveTo(t.clientX, t.clientY); },
    pointerup(e) { if (g?.down && e.pointerId === g.id) { moveTo(e.clientX, e.clientY); g.down = false; g.upAt = now(); } },
    pointercancel(e) { if (g?.down && e.pointerId === g.id) { g.cancelled = true; g.down = false; g.upAt = now(); } },
    // Any pane: the page body, a data-scroller, the screenshot strip. Only while the finger is down.
    scroll() { if (g?.down) g.scrolled = true; },
  };
  for (const [t, f] of Object.entries(on)) doc.addEventListener(t, f, opts);
  return {
    endsDrag(e) {
      if (!e || e.detail === 0 || !g) return false;
      if (!g.down && now() - g.upAt > STALE) return false;
      return g.cancelled || g.scrolled || g.moved > MOVE;
    },
    destroy() { for (const [t, f] of Object.entries(on)) doc.removeEventListener(t, f, opts); },
  };
}

let shared = null;
export function tapGuard(doc = globalThis.document) {
  if (!shared && doc?.addEventListener) shared = createTapGuard(doc);
  return shared;
}

// `fn` as a click handler that ignores a click ending a drag or scroll. The guard starts listening now (when the row
// is built), so it has seen the touch by the time the click comes.
export function guarded(fn, guard = tapGuard()) {
  return function (e, ...rest) {
    if (guard?.endsDrag(e)) { e.preventDefault?.(); e.stopPropagation?.(); return undefined; }
    return fn.call(this, e, ...rest);
  };
}

// B466: a drag is never a tap, for every click on the page, as UIKit. A touch that moved past MOVE, scrolled the
// list under it, was cancelled, or went down while that list was still gliding (a momentum scroll: the touch only
// stops it) never clicks what it started on, even when it ends on the same row. cancelDragTaps eats such a click
// before any handler (window, capture phase); app.js also drops the pressed look the moment a touch turns into a
// drag (onDrag) and never presses during a glide (dragging()). Lives here, not in a module of its own, to keep the
// startup closure under its cap (module-graph.test.js).
//
//   const st = cancelDragTaps(document, { onDrag: () => unpress() })
//   st.dragging()          // the touch now down is a drag (or a glide-stopping touch)
//   st.endsDrag(clickEvent)
//
// Only touch and pen: a mouse click after a drag or a wheel scroll is the browser's to keep. Controls that follow the
// finger themselves and want the click that ends their own drag (a switch's knob, a banner pulled up) are left
// alone: OWN_DRAG. A click with no touch behind it (keyboard, el.click(): detail 0) always runs.
export const GLIDE_MS = 100; // a scroll event this recent under the finger means the list is still moving
export const OWN_DRAG = ".switch, [role='switch'], .banner, input, textarea, select";

const holds = (outer, node) => outer === node || outer?.nodeType === 9 || (typeof outer?.contains === "function" && outer.contains(node));

export function cancelDragTaps(doc, { win = doc?.defaultView ?? globalThis.window, now = () => (globalThis.performance ?? Date).now(), onDrag = () => {} } = {}) {
  let t = null;        // the touch: { id, x, y, target, drag, down, upAt }
  let glide = null;    // the last scroll: { target, at }
  const opts = { capture: true, passive: true };
  const mark = () => { if (t && !t.drag) { t.drag = true; onDrag(); } };
  const moveTo = (x, y) => { if (t?.down && Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x - t.x, y - t.y) > MOVE) mark(); };
  const on = {
    pointerdown(e) {
      if (e.isPrimary === false) return;
      if (e.pointerType === "mouse") { t = null; return; }
      t = { id: e.pointerId, x: e.clientX, y: e.clientY, target: e.target, drag: false, down: true, upAt: 0 };
      if (glide && now() - glide.at < GLIDE_MS && holds(glide.target, e.target)) mark();
    },
    pointermove(e) { if (t && e.pointerId === t.id) moveTo(e.clientX, e.clientY); },
    // iOS stops pointermove once it pans; the touch's own moves still come.
    // One finger only: with a second one down, touches[0] may not be the tracked touch (its own pointermove counts).
    touchmove(e) { const p = e.touches?.length === 1 ? e.touches[0] : null; if (p) moveTo(p.clientX, p.clientY); },
    pointerup(e) { if (t?.down && e.pointerId === t.id) { moveTo(e.clientX, e.clientY); t.down = false; t.upAt = now(); } },
    pointercancel(e) { if (t?.down && e.pointerId === t.id) { mark(); t.down = false; t.upAt = now(); } },
    // Only a pane holding the touch's target: a carousel elsewhere moving on its own is not this touch's scroll.
    scroll(e) {
      glide = { target: e.target, at: now() };
      if (t?.down && holds(e.target, t.target)) mark();
    },
  };
  for (const [type, f] of Object.entries(on)) doc.addEventListener(type, f, opts);
  const endsDrag = (e) => {
    if (!e || e.detail === 0 || !t?.drag) return false;
    if (!t.down && now() - t.upAt > STALE) return false;
    return !e.target?.closest?.(OWN_DRAG);
  };
  const click = (e) => { if (endsDrag(e)) { e.preventDefault(); e.stopImmediatePropagation(); } };
  const host = win?.addEventListener ? win : doc;
  host.addEventListener("click", click, true);
  return {
    dragging: () => !!(t?.down && t.drag),
    endsDrag,
    destroy() {
      for (const [type, f] of Object.entries(on)) doc.removeEventListener(type, f, opts);
      host.removeEventListener("click", click, true);
    },
  };
}
