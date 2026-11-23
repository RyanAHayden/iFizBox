// F193: swipe a package row left to queue it (Spotify's add-to-queue, mirrored, drawn with iOS 6 parts). The row's
// content (.cell-inner) follows the finger; behind it the pinstripes, sunk in, with UITableView's editing control on
// the right. Past ARM of the width the control scales up (armed) and the drag rubber-bands; letting go armed runs the
// action, letting go before does nothing, and either way the row springs back. A right swipe does nothing (it is the
// back-swipe side), and a touch that starts within EDGE of the left edge is left to the edge swipe (nav/swipe.js).
// Transform and opacity only (120 Hz). Styles: packages.css (.row-swipe).
//
//   const s = attachRowSwipe(listEl, {
//     rowSelector: ".pkg-row",
//     canStart(row) -> bool,          // checked at the touch
//     prepare(row) -> Promise<action | null>,  // what a swipe of this row does (null: nothing; the row doesn't move)
//     commit(row, action),            // let go armed
//     kindOf(action) -> "add" | "remove" | "cancel",  // the control drawn
//     full(row, action) -> bool,      // B332, optional: a full-row swipe (Mail's delete) instead of the spring back
//   });
//
// B332: a full-row swipe follows the finger 1:1 with no rubber band; past FULL_ARM of the width it is armed, and
// letting go armed slides the content off the row's left edge and runs commit(row, action), which may return (or
// resolve to) false when nothing went (a sheet's Cancel, an error): the row then springs back. Removing the row is
// commit's job (nav/ui.js collapse). The strip says it with data-full="1" (packages.css).
//   s.reset(row)                      // a recycled row (vlist.js rebinds it): drop any drag at once
//   playHint(row, { distance, duration })  // the first-run hint: eases left once and back (WAAPI, transform only)
import { haptic } from "./haptic.js";
import { EASE } from "./motion.js";

export const EDGE = 30;   // px from the left edge where the back swipe owns the touch
export const SLOP = 10;   // px before deciding between a swipe and a scroll
export const ARM = 0.3;   // of the row's width: past this, letting go runs the action
const BAND = 0.5;         // of the width: how far past ARM the rubber band can ever stretch
const SPRING = `transform .32s ${EASE}`;

// What a move of (dx, dy) from the touch means so far: "wait" (inside the slop or not clear yet), "scroll" (mostly
// vertical: the list's), "none" (rightward: the back-swipe side, never ours) or "swipe" (clearly leftward).
export function swipeDecide(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ay > SLOP && ay >= ax) return "scroll";
  if (dx > SLOP && dx > ay) return "none";
  if (-dx > SLOP && ax > ay * 1.5) return "swipe";
  return "wait";
}

// Where the content sits for a finger dx from where the swipe started (<= 0): with the finger up to ARM, then a
// rubber band (UIScrollView's curve) that never passes ARM + BAND of the width. Never right of 0.
export function swipeOffset(dx, width) {
  const d = Math.max(0, -dx);
  const t = width * ARM;
  if (d <= t) return -d;
  const band = width * BAND;
  const over = d - t;
  return -(t + (1 - 1 / (over * 0.55 / band + 1)) * band);
}

export const swipeArmed = (dx, width) => width > 0 && -dx >= width * ARM;

// B332: a full-row swipe's offset (the finger, 1:1, between the row's left edge and rest) and its armed point.
export const FULL_ARM = 0.5;
export const swipeOffsetFull = (dx, width) => -Math.min(Math.max(0, -dx), Math.max(0, width));
export const swipeArmedFull = (dx, width) => width > 0 && -dx >= width * FULL_ARM;
const OFF = `transform .25s ${EASE}`;

// B332: whether the page's era deletes a row with a full-row swipe. iOS 6 keeps its swipe-then-red-Delete (iOS 6
// Mail's own: the kit's "Email Delete" button); iOS 7, 13 and 26 (<html data-style>) swipe the row off.
export const FULL_SWIPE_ERAS = ["ios7", "ios13", "ios26"];
export const fullSwipeEra = (doc = globalThis.document) => FULL_SWIPE_ERAS.includes(doc?.documentElement?.getAttribute?.("data-style"));

// The strip behind a row, made once per pooled row: the pinstripes and the control.
function backOf(row) {
  if (row._swipeBack) return row._swipeBack;
  const back = document.createElement("span");
  back.className = "row-swipe";
  back.setAttribute("aria-hidden", "true");
  const ctl = document.createElement("span");
  ctl.className = "row-swipe-control";
  back.append(ctl);
  row.prepend(back);
  row._swipeBack = back;
  return back;
}

const innerOf = (row) => row.querySelector(":scope > .cell-inner");

function show(row, kind, full = false) {
  const back = backOf(row);
  back.dataset.kind = kind || "";
  back.dataset.full = full ? "1" : "";
  back.classList.remove("armed");
  row.classList.add("swiping");
  return back;
}

function hide(row) {
  row.classList.remove("swiping");
  row._swipeBack?.classList.remove("armed");
  const inner = innerOf(row);
  if (inner) { inner.style.transition = ""; inner.style.transform = ""; }
}

export function attachRowSwipe(listEl, { rowSelector = ".pkg-row", canStart = () => true, prepare, commit, kindOf, full = null }) {
  let t = null;        // { row, id, x0, y0, state: "wait" | "drag", width, dx, action, pending, armed, frame }
  let eatClick = false;

  const kindFor = (tt) => (tt.action ? kindOf(tt.action) : "");
  const fullFor = (tt) => !!(full && tt.action && full(tt.row, tt.action));
  const offsetFor = (tt, dx) => (fullFor(tt) ? swipeOffsetFull : swipeOffset)(dx, tt.width);
  const armedFor = (tt, dx) => (fullFor(tt) ? swipeArmedFull : swipeArmed)(dx, tt.width);

  listEl.addEventListener("pointerdown", (e) => {
    if (t) cancel(); // the last touch never ended
    eatClick = false;
    if (!e.isPrimary || e.button > 0 || e.clientX < EDGE) return;
    const row = e.target.closest?.(rowSelector);
    if (!row || !listEl.contains(row) || !canStart(row)) return;
    row._hint?.cancel(); // touched mid-hint: the finger has it now
    const tt = { row, id: e.pointerId, x0: e.clientX, y0: e.clientY, state: "wait", width: 0, dx: 0, action: undefined, armed: false, frame: 0 };
    t = tt;
    // Ask now: the answer is usually in before the finger has moved past the slop.
    tt.pending = Promise.resolve(prepare(row)).catch(() => null).then((a) => {
      tt.action = a ?? null;
      if (t === tt && tt.state === "drag") paint(tt);
      return tt.action;
    });
  });

  listEl.addEventListener("pointermove", (e) => {
    if (!t || e.pointerId !== t.id) return;
    const dx = e.clientX - t.x0, dy = e.clientY - t.y0;
    if (t.state === "wait") {
      const d = swipeDecide(dx, dy);
      if (d === "wait") return;
      if (d !== "swipe" || t.action === null) { t = null; return; } // a scroll, the back side, or nothing to do
      t.state = "drag";
      t.width = t.row.clientWidth || listEl.clientWidth || 320;
      t.x0 = e.clientX; // start from here, so the row doesn't jump by the slop
      const inner = innerOf(t.row);
      if (inner) { inner.style.transition = "none"; inner.classList.remove("is-pressed"); } // a swipe isn't a tap: no blue
      show(t.row, kindFor(t), fullFor(t));
    }
    t.dx = Math.min(0, e.clientX - t.x0);
    if (!t.frame) {
      const tt = t;
      tt.frame = requestAnimationFrame(() => { tt.frame = 0; if (t === tt) paint(tt); });
    }
  });

  function paint(tt) {
    const inner = innerOf(tt.row);
    if (inner) inner.style.transform = `translate3d(${offsetFor(tt, tt.dx)}px,0,0)`;
    const back = tt.row._swipeBack;
    if (!back) return;
    const kind = kindFor(tt);
    if (back.dataset.kind !== kind) back.dataset.kind = kind;
    const isFull = fullFor(tt) ? "1" : "";
    if (back.dataset.full !== isFull) back.dataset.full = isFull;
    const armed = !!tt.action && armedFor(tt, tt.dx);
    if (armed !== tt.armed) {
      tt.armed = armed;
      back.classList.toggle("armed", armed);
      if (armed) haptic();
    }
  }

  // Back to rest, animated; cleaned up when the spring ends.
  function springBack(row) {
    const inner = innerOf(row);
    if (!inner) return hide(row);
    inner.style.transition = SPRING;
    inner.style.transform = "translate3d(0,0,0)";
    row._swipeBack?.classList.remove("armed");
    const done = () => { inner.removeEventListener("transitionend", done); clearTimeout(timer); if (t?.row !== row) hide(row); };
    const timer = setTimeout(done, 400);
    inner.addEventListener("transitionend", done);
  }

  function end(e, cancelled) {
    if (!t || e.pointerId !== t.id) return;
    const tt = t;
    t = null;
    if (tt.state !== "drag") return;
    if (tt.frame) cancelAnimationFrame(tt.frame);
    eatClick = true; // the lift that ends a drag isn't a tap on the row
    setTimeout(() => { eatClick = false; }, 400);
    const x = e.clientX ?? tt.x0 + tt.dx;
    const armed = !cancelled && armedFor(tt, Math.min(0, x - tt.x0));
    if (armed && fullFor(tt)) return slideOff(tt);
    springBack(tt.row);
    if (!armed) return;
    const item = tt.row._item;
    tt.pending.then((a) => { if (a && tt.row._item === item) commit(tt.row, a); });
  }

  // B332: the full-row swipe's lift: the content goes off the left edge, then commit; false back from it springs back.
  function slideOff(tt) {
    const { row } = tt;
    const inner = innerOf(row);
    const item = row._item;
    // commit once the content is off (transitionend, or OFF's time if that never comes), so the slide shows first
    const off = new Promise((resolve) => {
      if (!inner) return resolve();
      const done = () => { inner.removeEventListener("transitionend", done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 300);
      inner.addEventListener("transitionend", done);
      inner.style.transition = OFF;
      inner.style.transform = `translate3d(${-tt.width}px,0,0)`;
    });
    off.then(() => (tt.action && row._item === item ? commit(row, tt.action) : false))
      .catch(() => false)
      .then((ok) => { if (ok === false && t?.row !== row) springBack(row); });
  }

  function cancel() {
    if (!t) return;
    const tt = t;
    t = null;
    if (tt.frame) cancelAnimationFrame(tt.frame);
    if (tt.state === "drag") springBack(tt.row);
  }

  listEl.addEventListener("pointerup", (e) => end(e, false));
  listEl.addEventListener("pointercancel", (e) => end(e, true));
  // No setPointerCapture: a touch is already captured by the element it started on, so its moves keep coming here
  // (bubbling). Capturing to the list made WebKit drop that implicit capture at once, and its lostpointercapture,
  // bubbling up from the row, ended every drag as it began (iPhone 7). That event alone (no pointerup) still means
  // iOS took the touch away.
  listEl.addEventListener("lostpointercapture", (e) => end(e, true));
  listEl.addEventListener("click", (e) => {
    if (!eatClick) return;
    eatClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  return {
    reset(row) {
      if (t?.row === row) { if (t.frame) cancelAnimationFrame(t.frame); t = null; }
      row._hint?.cancel();
      if (row.classList.contains("swiping")) hide(row);
    },
    get active() { return t?.state === "drag" ? t.row : null; },
  };
}

// F193's first-run hint: the row eases left by `distance` and back once (one movement, no bounce), showing part of
// the green control. Resolves when it ends (or is cancelled by a recycle or a touch).
// `fade` (Reduce Motion): nothing moves; the row's content dims to show the control behind it, then comes back.
export function playHint(row, { distance = 44, duration = 1100, kind = "add", fade = false } = {}) {
  const inner = innerOf(row);
  if (!inner?.animate) return Promise.resolve(false);
  show(row, kind);
  row._swipeBack.classList.add("hint");
  const a = inner.animate(
    fade
      ? [{ opacity: 1, easing: "ease-in-out" }, { opacity: 0.25, offset: 0.35 }, { opacity: 0.25, offset: 0.65, easing: "ease-in-out" }, { opacity: 1 }]
      // Eased into and out of each end, so it slows to the turn instead of bouncing off it.
      : [{ transform: "translate3d(0,0,0)", easing: "ease-in-out" }, { transform: `translate3d(${-distance}px,0,0)`, easing: "ease-in-out" },
        { transform: "translate3d(0,0,0)" }],
    { duration: fade ? duration * 1.6 : duration },
  );
  row._hint = a;
  const done = (ok) => { if (row._hint === a) row._hint = null; row._swipeBack?.classList.remove("hint"); hide(row); return ok; };
  return a.finished.then(() => done(true), () => done(false));
}
