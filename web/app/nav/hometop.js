// Home always starts at the top (user 2026-11-18). Home's root page keeps its own scroller (.page-body) like every
// page, so switching tabs, popping and the app going to the background all leave it where it was scrolled. Three
// cases put it back at the top; everything else (other tabs, Back to Home from a page pushed on it) keeps the place:
//   opened()     the app opens on Home: cold launch, back from the background (including Settings' Return to Home
//                After, which routes there itself), a Home Screen web app restored from the back/forward cache.
//                Not while something is up (alert, sheet, install progress): that stays as the user left it.
//   tabTapped()  a tap on the Home tab from another tab, or from a page pushed on Home (which pops to the root):
//                the root jumps to its top while hidden, so it shows at the top. A tap on Home's root itself is
//                tabbar.js tapTab's slide to the top (F148), not this.
// No DOM here beyond a scroller's scrollTop: homeRoot() returns Home's root .page-body (or null before it exists),
// current() the route on screen, overlayUp() whether an alert, sheet or HUD is showing.

export const isHomeRoot = (route) => !!route && route.tab === "home" && route.path.length === 0;

export function createHomeTop({ homeRoot, current, overlayUp = () => false, touched = () => false }) {
  const jump = () => {
    const body = homeRoot();
    if (!body || body.scrollTop <= 0) return false;
    body.scrollTop = 0;
    return true;
  };
  return {
    // The app came to the front (or launched). True when Home was moved to the top. Not once the user has touched it
    // (B406): the visible event can come after the first swipe.
    opened() {
      if (touched() || !isHomeRoot(current()) || overlayUp()) return false;
      return jump();
    },
    // Called in the tab bar's click handler before tapTab: `tab` was tapped while current() is on screen.
    tabTapped(tab) {
      if (tab !== "home" || isHomeRoot(current())) return false;
      return jump();
    },
  };
}

// Home's root .page-body from the app's stacks (nav/stack.js): the entry of Home's stack whose path is [].
export const homeRootOf = (stacks) => () => stacks.stack("home").find((e) => e.path.length === 0)?.page.body ?? null;

// B406: once the user has touched anything since the app opened or came back, nothing the app does on its own may move
// them (tab, page, scroll, keyboard). touched() is true from the first touch, click (the shell's glass tabs send only
// that), key, typing or newly focused text field until the app next goes hidden. iOS can send the visible event after
// the first tap, so a touch while still "hidden" counts. A field iOS focuses again on the return, focused when the app
// went hidden, is not the user's.
//   untilAway()      resolves when the app next goes hidden (at once when nothing was touched)
const EDITABLE = "input, textarea, select, [contenteditable]";
export function createUserTouch(doc = globalThis.document) {
  let touched = false;
  let kept = null; // the element focused when the app went hidden
  let waiting = [];
  const opts = { capture: true, passive: true };
  const touch = () => { touched = true; };
  for (const t of ["pointerdown", "touchstart", "click", "keydown", "input", "wheel"]) doc?.addEventListener?.(t, touch, opts);
  doc?.addEventListener?.("focusin", (e) => { if (e.target !== kept && e.target?.matches?.(EDITABLE)) touched = true; }, opts);
  doc?.addEventListener?.("visibilitychange", () => {
    if (doc.visibilityState !== "hidden") return;
    touched = false;
    kept = doc.activeElement ?? null;
    for (const f of waiting.splice(0)) f();
  }, opts);
  return {
    touched: () => touched,
    untilAway: () => (touched ? new Promise((r) => waiting.push(r)) : Promise.resolve()),
  };
}
export const userTouch = createUserTouch(); // the page's one, from startup on

// Whether the user is in a text field (its keyboard up).
export const typing = (doc = globalThis.document) => Boolean(doc?.activeElement?.matches?.(EDITABLE));
// Resolves once no text field has the focus. Polled: a field taken off the page may send no focusout.
export function untilNotTyping(doc = globalThis.document) {
  if (!typing(doc)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (typing(doc)) return;
      clearInterval(timer);
      resolve();
    }, 300);
  });
}

// Settings' Return to Home After: back after that long, the app shows Home, at once (goHome moves synchronously) or not
// at all. Every return uses up the time away, so no later event moves the user. A touch before the visible event keeps
// the user where they are; `refresh` still runs, in the background. blocked(): an alert, sheet or hand-off is up.
export function createReturnHome({ afterMs, touched, blocked = () => false, goHome, refresh, now = Date.now }) {
  let hiddenAt = 0;
  return {
    hidden() { hiddenAt = now(); },
    // -> "home" | "kept" (touched: only the refresh) | null (not away long enough, or blocked)
    visible() {
      const at = hiddenAt;
      hiddenAt = 0;
      const after = afterMs();
      if (!at || !after || now() - at < after || blocked()) return null;
      const keep = touched();
      if (!keep) goHome();
      refresh();
      return keep ? "kept" : "home";
    },
  };
}
