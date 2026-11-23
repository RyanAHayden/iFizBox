// SPDX-License-Identifier: GPL-3.0-or-later
// The queue's hint: while the tab bar shows the Q'd badge, a small callout over the Installed tab says "Hold
// Installed to see the queue", and a hold on the tab opens the queue (the Confirm sheet screens/queue.js already has).
// Drawn as iOS 6's callout bar (UIMenuController's black glossy bar with its arrow; ios6.css .queue-hint), faded in
// and out by opacity only. It never takes a touch.
//
// When it shows (nextHint, pure): only on a tap of the Installed tab, never when something is queued (it would cover
// the "added to queue" toast), and then only while the badge is up, the user has never held the tab (settings'
// queueHint, kept on the device), and it has not shown yet in this queued run. A run starts when something is queued
// and ends when the queue is empty again (Confirm run or Cancel); a closed Confirm sheet ("Continue Queuing") is still
// the same run. Never in the iOS 26 era (Theme > Style, <html data-style>): the app draws its own tab bar there, so
// the hold can't reach the web tab; such a tap doesn't count as the run's showing. Each other era draws its own
// callout (ios6.css .queue-hint tokens, restyled by ios7.css and ios13.css).
//
//   const hint = createQueueHint({ bar: tabbarEl, store: settings.queueHint });
//   hint.update({ queued: true, badge: true, open: () => openConfirm() });  // on every badge change: never shows it
//   // a click on the bar's Installed tab shows it (the hint listens on `bar` itself; tests call hint.tapped())
import { longPress } from "./menu.js";

export const HINT_TEXT = "Hold Installed to see the queue";
export const HINT_TAB = "installed";
export const SHOW_MS = 5000; // on screen this long, then it fades
export const FADE_IN_MS = 200;
export const FADE_OUT_MS = 300;
const ARROW_H = 10; // ios6.css .queue-hint-arrow's height
export const NO_HINT_ERAS = ["ios26"]; // eras (html[data-style]) where it never shows
const HOLDABLE = "hold-queue"; // the tab's class while a hold opens the queue (the badge is up)

// The rules. `state` { shown } is what this run has done so far; `held` whether the tab was ever held; `tapped`
// whether this is a tap on the Installed tab (a badge change alone never shows it).
// -> { state, show }: show the hint now or not.
export function nextHint(state, { queued = false, badge = false, held = false, tapped = false } = {}) {
  const shown = queued ? Boolean(state?.shown) : false; // an empty queue ends the run
  const show = Boolean(tapped && queued && badge && !held && !shown);
  return { state: { shown: shown || show }, show };
}

// `bar`: the tab bar element (its a.tab[data-tab=installed] gets the hold). `store`: { held(), markHeld() }.
export function createQueueHint({ bar, store, doc = globalThis.document, win = globalThis, showMs = SHOW_MS } = {}) {
  let state = { shown: false };
  let last = { queued: false, badge: false }; // the last update, for a tap
  let open = null; // what a hold opens, from the last update
  let toast = null, timer = 0;
  const noHintEra = () => NO_HINT_ERAS.includes(doc?.documentElement?.getAttribute?.("data-style"));
  const tab = () => bar?.querySelector?.(`a.tab[data-tab="${HINT_TAB}"]`) ?? null;

  if (bar) longPress(bar, `a.tab.${HOLDABLE}`, () => {
    store?.markHeld?.();
    hide();
    open?.();
  }, { doc });

  // A tap on Installed (a hold's click is eaten before it gets here, menu.js swallowNextClick).
  bar?.addEventListener?.("click", (e) => {
    const a = e?.target?.closest?.("a.tab");
    if (a && a === tab()) tapped();
  });

  function tapped() {
    if (noHintEra()) return false;
    const next = nextHint(state, { ...last, held: Boolean(store?.held?.()), tapped: true });
    state = next.state;
    if (next.show) show();
    return next.show;
  }

  function show() {
    const t = tab();
    if (!t || !doc?.createElement) return;
    hide(true);
    const el = doc.createElement("div");
    el.className = "queue-hint";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    const text = doc.createElement("span");
    text.className = "queue-hint-text";
    text.textContent = HINT_TEXT;
    const arrow = doc.createElement("span");
    arrow.className = "queue-hint-arrow";
    arrow.setAttribute("aria-hidden", "true");
    el.append(text, arrow);
    doc.body.append(el);
    place(el, arrow, t);
    el.replace = () => place(el, arrow, t); // a rotation while it shows moves the tab
    win.addEventListener?.("resize", el.replace);
    // Theme > Style switched to iOS 26 while it shows: it goes at once.
    const MO = win.MutationObserver ?? globalThis.MutationObserver;
    if (MO && doc.documentElement) {
      el.eraWatch = new MO(() => { if (noHintEra()) hide(true); });
      el.eraWatch.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-style"] });
    }
    el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, easing: "ease-out" });
    toast = el;
    timer = setTimeout(() => hide(), showMs);
  }

  // Centred over the tab, kept 6px inside the screen; the arrow stays on the tab's middle, its tip just above the bar.
  function place(el, arrow, t) {
    const r = t.getBoundingClientRect();
    const w = el.offsetWidth;
    const vw = win.innerWidth ?? 320, vh = win.innerHeight ?? 480;
    const cx = r.left + r.width / 2;
    const left = Math.max(6, Math.min(vw - w - 6, cx - w / 2));
    el.style.left = left + "px";
    el.style.bottom = (vh - r.top + ARROW_H + 1) + "px";
    arrow.style.left = Math.max(12, Math.min(w - 12, cx - left)) + "px";
  }

  // `now`: drop it without the fade (a new one replaces it).
  function hide(now = false) {
    clearTimeout(timer);
    const el = toast;
    if (!el) return;
    toast = null;
    win.removeEventListener?.("resize", el.replace);
    el.eraWatch?.disconnect();
    if (now || !el.animate) { el.remove(); return; }
    const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_OUT_MS, easing: "ease-in", fill: "forwards" });
    a.finished.then(() => el.remove(), () => el.remove());
  }

  // Every badge change: keeps the run's state and the hold, hides the hint when the badge goes; never shows it.
  // `open`: what a hold on the tab opens now.
  function update({ queued = false, badge = false, open: o = null } = {}) {
    if (o) open = o;
    last = { queued: Boolean(queued), badge: Boolean(badge) };
    tab()?.classList?.toggle(HOLDABLE, Boolean(badge && queued));
    state = nextHint(state, { queued, badge, held: Boolean(store?.held?.()) }).state;
    if (!badge) hide();
    return false;
  }

  return { update, tapped, hide: () => hide(), get shown() { return state.shown; }, get toast() { return toast; } };
}
