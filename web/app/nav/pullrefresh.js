// Pull to refresh, the classic way (Tweetie's): pulling a list down past its top shows an area attached to the top of
// the list, a down arrow at its left, bold "Pull down to refresh..." and "Last Updated: Today 3:14 PM" under it.
// Past TRIGGER points of pull the arrow turns over and the text reads "Release to refresh...". Letting go there runs
// the page's own refresh, exactly as its nav button does (the reload bar shows it), and the list springs straight
// back to its top: nothing is held open, so no row moves while the refresh runs (B209, user 2026-11-20). The hidden
// area switches to iOS 6's grey spinner and "Refreshing..." (Last Updated stays); it is seen only by pulling down
// again while the refresh runs, and letting go of that pull springs back too and runs nothing (no second refresh).
// When the refresh ends (its onRefresh promise has settled and nothing is refreshing any more: the ifizbox:refreshing
// count back at 0, no reload bar, the page's busy() false; refreshEnd() decides) the area goes back to the arrow and
// "Pull down to refresh...", once it is out of sight. Letting go under the trigger springs back and runs nothing.
// A pull while some other refresh runs (the nav button, the launch refresh) shows the spinner the same way.
// States (pullTracker): idle -> pull -> armed -> (release) refreshing -> (refresh ended) closing -> (hidden) idle.
//
//   pullToRefresh(scroller, { onRefresh: () => refresh(ctx), busy: () => state.busy, settings });
//
// `scroller` is the element the list scrolls in: the .page-body, or the .search-results of a page with the pinned
// search bar (nav/searchbar.js pinned). Calling it again for the same scroller only takes the new options.
//
// The area is not inside the scroller: WebKit paints nothing of a scroller's content above its top, so an area placed
// there stayed blank in the rubber band (iPhone 7). It sits beside the scroller, over it, in a box clipped to where
// the list starts (.pull-clip), and moves by transform so its foot is always on the content's top edge: it covers
// exactly the gap the pull opens.
// Two ways a pull happens:
//  - native: iOS rubber-bands the scroller itself (scrollTop goes below 0); a passive scroll listener reads it.
//  - script: a browser without the rubber band (Chromium, Android) keeps scrollTop at 0. Then a finger pulling down at
//    the top moves the scroller's children by transform (rubber() damping) and they spring back on release.
// On the native path nothing but the area is ever moved by script (moving the list too fought iOS's own scroll and
// bounce: B188's hold jittered), and on the script path the scroller pans nothing while the children are moved.
// Either way only transform changes per frame (the area is its own layer: will-change in ios6.css), no layout is
// read per frame (the scroller's size is read once per touch), and every listener is passive: 120 Hz holds.
//
// The Last Updated time is settings.lastRefresh (core/settings.js): set when a source refresh ends (the
// ifizbox:refreshing count from screens/sources.js falls back to 0: Sources' Refresh, Home's Reload, the launch
// refresh) and by Changes' Refresh, which refreshes without that count.

import { haptic, hapticTick, bridgeHaptics } from "./haptic.js";

export const TRIGGER = 60;  // points of pull where it arms (the 4S's Twitter: about the area's own height)
export const AREA_H = 480;   // the area is this tall, its contents at its foot, so a long pull still shows its colour
const DECIDE = 10;           // px of finger travel at the top before a browser without the rubber band is assumed
const SPRING_MS = 340;
export const MIN_HOLD_MS = 600;     // the area stays "Refreshing..." at least this long, and a refresh gets this long to announce itself
export const MAX_HOLD_MS = 120000;  // a refresh that never says it ended can't keep the spinner for ever
const CHECK_MS = 250;               // how often a running refresh's end is checked (pages' own busy flags send no event)

// ---- The logic, without the DOM (pullrefresh.test.js) ----------------------------------------------------------

// While pulling: "idle" (nothing pulled, or a refresh runs), "pull" (under the trigger) or "armed" (release runs the
// refresh). pullTracker adds "refreshing" and "closing" after an armed release.
export function pullState(pull, { busy = false, threshold = TRIGGER } = {}) {
  if (busy || !(pull > 0)) return "idle";
  return pull >= threshold ? "armed" : "pull";
}

// UIScrollView's rubber band: the farther the finger goes, the less the list follows. `dim` is the scroller's height.
export function rubber(dy, dim = AREA_H) {
  if (!(dy > 0)) return 0;
  return (1 - 1 / (dy * 0.55 / dim + 1)) * dim;
}

// One gesture's decisions: start() on touch-down, move(pull) as the list moves, end() on lift. end() runs onRefresh
// (and returns true) only when the pull is armed at the lift and no refresh was running at the start or runs now;
// the state is then "refreshing" (the list is back at its top; the hidden area shows the spinner) until done() (the
// refresh ended: "closing", still the spinner while the area may be on screen) and hidden() (the area is out of sight:
// "idle", the arrow and "Pull down to refresh..." again).
// A gesture that starts while a refresh runs is blocked: it is never stopped (the pull still shows the area), but it
// never arms, never changes the state and never runs anything; `spinning` says the area shows the spinner for it.
// B197: onHaptic("tick") each time the pull arms (the arrow turns over), onHaptic("tap") when a release starts the
// refresh; nothing on a release that runs nothing.
export function pullTracker({ threshold = TRIGGER, busy = () => false, onRefresh = () => {}, onState = () => {},
  onHaptic = () => {} } = {}) {
  let state = "idle";
  let active = false;
  let blocked = false;
  const buzz = (kind) => { try { onHaptic(kind); } catch { /* a haptic never stops the pull */ } };
  const set = (s) => {
    if (s === state) return;
    state = s;
    if (s === "armed") buzz("tick");
    else if (s === "refreshing") buzz("tap");
    onState(s);
  };
  const refreshing = () => state === "refreshing" || state === "closing";
  return {
    get state() { return state; },
    get active() { return active; },
    get blocked() { return blocked; },
    get refreshing() { return refreshing(); },
    // The area shows the spinner and "Refreshing...": this pull's refresh runs, or the gesture began during another.
    get spinning() { return refreshing() || blocked; },
    start() { active = true; blocked = refreshing() || Boolean(busy()); if (!refreshing()) set("idle"); },
    move(pull) { if (active && !blocked) set(pullState(pull, { threshold })); },
    end() {
      if (!active) return false;
      active = false;
      if (refreshing()) return false;
      const go = !blocked && state === "armed" && !busy();
      set(go ? "refreshing" : "idle");
      if (go) onRefresh();
      return go;
    },
    done() { if (state === "refreshing") set("closing"); },
    hidden() { if (state === "closing") { if (!active) blocked = false; set("idle"); } },
    cancel() { active = false; if (!refreshing()) set("idle"); },
  };
}

// Calls onEnd() once the refresh a release started has ended: `result` (onRefresh's return, a promise for Changes and
// Sources) has settled, busy() is false, and at least minMs has gone by (Home's Reload button says it's busy only once
// its click has run, and the spinner should be seen). Checked when the promise settles, on ifizbox:refreshing, and
// every CHECK_MS; after maxMs it ends anyway. -> stop(), which cancels it without calling onEnd.
export function refreshEnd(result, { busy = () => false, onEnd = () => {}, minMs = MIN_HOLD_MS, maxMs = MAX_HOLD_MS,
  timers = globalThis, now = () => Date.now(), target = globalThis } = {}) {
  const t0 = now();
  let settled = false;
  let over = false;
  const stop = () => {
    if (over) return;
    over = true;
    timers.clearInterval(poll);
    timers.clearTimeout(cap);
    timers.clearTimeout(soon);
    target.removeEventListener?.("ifizbox:refreshing", check);
  };
  const finish = () => { if (!over) { stop(); onEnd(); } };
  function check() {
    if (over || !settled || now() - t0 < minMs) return;
    let b = true;
    try { b = Boolean(busy()); } catch { b = false; }
    if (!b) finish();
  }
  const poll = timers.setInterval(check, CHECK_MS);
  const cap = timers.setTimeout(finish, maxMs);
  const soon = timers.setTimeout(check, minMs);
  target.addEventListener?.("ifizbox:refreshing", check);
  Promise.resolve(result).then(() => {}, () => {}).then(() => { settled = true; check(); });
  return stop;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clock = (d) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// "Last Updated: Today 3:14 PM", "Yesterday 9:05 AM", "Nov 3 3:14 PM" (another year: "Nov 3, 2025"), "Never".
export function lastUpdatedText(ms, now = new Date()) {
  if (!(ms > 0)) return "Last Updated: Never";
  const d = new Date(ms);
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  let day;
  if (days === 0) day = "Today";
  else if (days === 1) day = "Yesterday";
  else if (d.getFullYear() === now.getFullYear()) day = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  else return `Last Updated: ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `Last Updated: ${day} ${clock(d)}`;
}

export const TEXT = Object.freeze({ pull: "Pull down to refresh...", armed: "Release to refresh...", refreshing: "Refreshing..." });

// The title line for a pullTracker state: "Refreshing..." stays up until the area is out of sight ("closing").
export function titleFor(state) {
  if (state === "refreshing" || state === "closing") return TEXT.refreshing;
  return state === "armed" ? TEXT.armed : TEXT.pull;
}

// B197: pull to refresh's haptics, only where the app's bridge plays them (as screens/roulette.js): a pull arms in a
// scroll event, not a gesture start, where Safari's fallbacks stay silent. "tick" is the smallest there is
// (haptic.tick), "tap" the regular light one (haptic.tap).
export function pullHaptic(kind, { bridge = bridgeHaptics, tick = hapticTick, tap = haptic } = {}) {
  if (!bridge()) return;
  if (kind === "tick") tick();
  else if (kind === "tap") tap();
}

// ---- Last Updated bookkeeping ----------------------------------------------------------------------------------

let watching = null;
function watchRefreshes(settings) {
  if (watching || !settings?.lastRefresh || typeof globalThis.addEventListener !== "function") return;
  watching = settings;
  let was = globalThis.ifizboxRefreshing > 0;
  globalThis.addEventListener("ifizbox:refreshing", () => {
    const now = globalThis.ifizboxRefreshing > 0;
    if (was && !now) settings.lastRefresh.set(Date.now());
    was = now;
  });
}

// A refresh is running somewhere: the Sources count (screens/sources.js announce) or the reload bar is up.
export function refreshRunning(doc = globalThis.document) {
  return globalThis.ifizboxRefreshing > 0 || Boolean(doc?.documentElement?.classList?.contains("has-reload"));
}

// ---- The DOM side --------------------------------------------------------------------------------------------

const attached = new WeakMap(); // scroller -> its options (live: a second call replaces them)
// This browser rubber-bands its scrollers (never move them by script): iOS's WebKit (the only one with
// -webkit-touch-callout), or any browser seen taking a scroller below 0.
let nativeBounce = Boolean(globalThis.CSS?.supports?.("-webkit-touch-callout: none"));

export function pullToRefresh(scroller, opts = {}) {
  if (!scroller?.addEventListener || typeof document === "undefined") return null;
  watchRefreshes(opts.settings);
  const known = attached.get(scroller);
  if (known) { Object.assign(known, opts); return known; }
  const o = { ...opts };
  attached.set(scroller, o);

  const clip = document.createElement("div");
  clip.className = "pull-clip";
  clip.setAttribute("aria-hidden", "true");
  clip.innerHTML = '<div class="pull-refresh"><div class="pull-inner"><span class="pull-arrow"></span>'
    + '<span class="pull-spinner"></span>'
    + '<span class="pull-text"><b class="pull-title"></b><span class="pull-time"></span></span></div></div>';
  const area = clip.querySelector(".pull-refresh");
  const title = area.querySelector(".pull-title");
  const time = area.querySelector(".pull-time");
  title.textContent = TEXT.pull;

  const busy = () => refreshRunning() || Boolean(o.busy?.());
  let pending = 0; // a release's refresh waiting for the spring back to end
  let stopWatch = null; // refreshEnd()'s stop, while a pull's refresh runs
  const runNow = () => {
    clearTimeout(pending);
    pending = 0;
    const result = Promise.resolve().then(() => o.onRefresh?.()); // after the lift's own work
    result.catch(() => {});
    stopWatch?.();
    stopWatch = refreshEnd(result, { busy, onEnd: () => { stopWatch = null; tracker.done(); } });
  };
  const tracker = pullTracker({
    busy,
    onHaptic: (kind) => pullHaptic(kind),
    onRefresh: () => {
      // Once the list is back at its top: iOS's own spring still runs after the lift, and a refresh that put Sources'
      // strip up mid-spring left the list scrolled down by the strip's height (iPhone 7).
      if (scroller.scrollTop < 0) { pending = setTimeout(runNow, 900); return; }
      runNow();
    },
    onState: (s) => {
      paint();
      if (s === "closing" && !shown) tracker.hidden(); // already out of sight: the arrow again now
    },
  });
  // The area's look: the arrow (turned over when armed), or the spinner and "Refreshing..." while a refresh runs.
  // "armed" goes before "refreshing" comes: the arrow is hidden (and its turn not animated) when it turns back.
  // While an armed release springs back the area keeps its look ("Release to refresh..."): the spinner is first seen
  // on a pull after it went out of sight (frozen until show(false), or until a touch catches it on the way up).
  let frozen = false;
  function paint() {
    if (frozen) return;
    const spin = tracker.spinning;
    area.classList.toggle("armed", !spin && tracker.state === "armed");
    area.classList.toggle("refreshing", spin);
    title.textContent = titleFor(spin ? "refreshing" : tracker.state);
  }

  // Puts the clip box back beside the scroller (a redraw that empties the page takes it away) over the list's box,
  // from where its content starts. Layout is read here, once per touch at the top, never per frame.
  const ensure = () => {
    if (clip.parentNode !== scroller.parentNode || clip.previousSibling !== scroller) scroller.after(clip);
    const pad = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    dim = scroller.clientHeight || AREA_H; // the rubber band's box, kept for the gesture: no layout read per move
    clip.style.top = `${scroller.offsetTop + pad}px`;
    clip.style.height = `${Math.max(0, scroller.clientHeight - pad)}px`;
    // The area wears the page's own background: white on a plain list, the pinstripe on a grouped page (ios6.css).
    clip.classList.toggle("grouped", scroller.classList.contains("grouped"));
    time.textContent = lastUpdatedText(o.settings?.lastRefresh?.get?.() ?? null);
  };
  let dim = AREA_H;
  let shown = false;
  // Out of sight once a refresh has ended: the area goes back to the arrow (tracker "closing" -> "idle").
  const show = (on) => {
    if (on === shown) return; // a scroll event per frame: no class write when nothing changes
    shown = on;
    clip.classList.toggle("on", on);
    if (!on && frozen) { frozen = false; paint(); }
    if (!on && tracker.state === "closing") tracker.hidden();
  };
  const k = () => globalThis.devicePixelRatio || 1; // whole device pixels: a fractional offset smeared the rows' edges
  const px = (v) => Math.round(v * k()) / k();
  // The area's foot on the content's top edge, `pull` below where the list starts.
  const follow = (pull) => { area.style.transform = `translateY(${px(Math.max(0, pull)) - AREA_H}px)`; };

  // The script way: the scroller's children follow the finger by transform, and the area with them.
  let g = null; // the gesture: { y, base, mode: "?" | "native" | "script", pull }
  const moved = () => [...scroller.children];
  const place = (pull) => {
    const t = pull > 0 ? `translateY(${px(pull)}px)` : "";
    for (const c of moved()) c.style.transform = t;
    follow(pull);
  };
  const springBack = (from) => {
    place(0);
    if (!(from > 0)) { show(false); return; }
    const opts = { duration: SPRING_MS, easing: "cubic-bezier(.25,.6,.3,1)" };
    for (const c of moved()) c.animate?.([{ transform: `translateY(${px(from)}px)` }, { transform: "none" }], opts);
    const last = area.animate?.([{ transform: `translateY(${px(from) - AREA_H}px)` }, { transform: `translateY(${-AREA_H}px)` }], opts);
    if (last?.finished) last.finished.then(() => { if (!g) show(false); }, () => {});
    else show(false);
  };
  const release = () => { if (g?.mode === "script") scroller.style.overflowY = ""; };

  scroller.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) {
      if (g) { tracker.cancel(); release(); if (g.mode === "script") springBack(g.pull); g = null; }
      return;
    }
    const y = e.touches[0].clientY;
    const top = scroller.scrollTop;
    g = { y, base: top <= 0 ? y : null, mode: nativeBounce ? "native" : "?", pull: 0, ready: false };
    if (top <= 1) { ensure(); g.ready = true; } // style is read here, never per frame
    tracker.start();
    frozen = false;
    paint(); // a pull that starts while a refresh runs shows the spinner, never the arrow
    if (top < 0) { follow(-top); show(true); } // caught while springing back
  }, { passive: true });

  // A pull while a refresh runs is never stopped: it shows the spinner, and the tracker keeps it from arming.
  scroller.addEventListener("touchmove", (e) => {
    if (!g || g.mode === "native") return;
    const y = e.touches[0]?.clientY;
    if (y == null) return;
    // The browser's own rubber band after all: drop the transform at once, so script and scroll never both move the list.
    if (g.mode !== "script" && scroller.scrollTop < 0) { g.mode = "native"; nativeBounce = true; place(0); return; }
    if (g.mode === "?") {
      if (scroller.scrollTop > 0) { g.base = null; return; }
      g.base ??= y;
      const dy = y - g.base;
      if (dy < 0) { g.base = y; return; }
      if (dy < DECIDE) return;
      g.mode = "script";
      g.base += DECIDE; // the pull starts from here, without a jump
      if (!g.ready) { ensure(); g.ready = true; }
      scroller.style.overflowY = "hidden"; // the browser pans nothing while the list is pulled by hand
    }
    if (y <= g.base) { // pushed back past the start: an ordinary scroll again
      release(); g.mode = "?"; g.base = y; g.pull = 0;
      place(0); show(false); tracker.move(0);
      return;
    }
    g.pull = rubber(y - g.base, dim); // follows the finger every move: no snapping, no layout read
    place(g.pull);
    show(g.pull > 0);
    tracker.move(g.pull);
  }, { passive: true });

  // The native way: scrollTop under 0 is the rubber band. Only the area moves (follow), with iOS's own scroll.
  scroller.addEventListener("scroll", () => {
    const top = scroller.scrollTop;
    if (top < 0) {
      nativeBounce = true;
      if (g?.mode === "script") return;
      if (g) {
        if (!g.ready) { ensure(); g.ready = true; } // scrolled up to the top and on past it in one gesture
        g.mode = "native"; g.pull = -top; tracker.move(-top);
      } else if (clip.parentNode !== scroller.parentNode) ensure(); // a fling's overshoot
      follow(-top);
      show(true); // also during the bounce after an armed release: the area slides up, its look frozen
    } else {
      if (!g || g.mode === "native") show(false);
      if (pending) runNow(); // the spring is over
    }
  }, { passive: true });

  // Every lift springs the list straight back to its top, armed or not, refreshing or not: nothing is held open.
  const end = (e) => {
    if (!g) return;
    const was = g;
    // An armed release: freeze the look before end() turns the tracker to "refreshing" (the area is still on screen).
    if (e.type === "touchcancel") tracker.cancel();
    else if (tracker.state === "armed" && shown) { frozen = true; if (!tracker.end()) { frozen = false; paint(); } }
    else tracker.end();
    release();
    g = null;
    if (was.mode === "script") springBack(was.pull);
    else if (scroller.scrollTop >= 0) show(false); // native: iOS bounces it back; the scroll listener hides it then
  };
  scroller.addEventListener("touchend", end, { passive: true });
  scroller.addEventListener("touchcancel", end, { passive: true });
  return o;
}
