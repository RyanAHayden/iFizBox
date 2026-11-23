// F167: a tap on the status bar scrolls to the top, as in native iOS apps. iOS sends the tap to the WKWebView's own
// scroll view, which never scrolls (every page scrolls inside its .page-body), so the native shell refuses it
// (scrollViewShouldScrollToTop -> false) and calls globalThis.ifizboxScrollToTop() instead. Safari never sends it.
//
// What scrolls is the list on top: an open sheet's (the last [role=dialog] on the page), else the top page's. Inside
// that layer, the scroller that is scrolled down (Search's results under its field, a sheet's list), the innermost
// one when several are, so the tap moves what the user sees.
import { scrollToTop } from "./tabbar.js";

export const SCROLLERS = ".page-body, [data-scroller], .sheet-scroll, .sheet-body, .progress-scroll, "
  + ".search-results, .filter-drop-inner, .action-list";

const shown = (el) => !el.getClientRects || el.getClientRects().length > 0;

// The scroller the status bar tap should move, or null when nothing on top is scrolled down.
export function statusBarTarget(doc, pageBody) {
  const dialogs = [...doc.querySelectorAll('[role="dialog"]')].filter(shown);
  const layer = dialogs.at(-1) || pageBody;
  if (!layer) return null;
  const all = [layer, ...layer.querySelectorAll(SCROLLERS)];
  return all.filter((el) => el.scrollTop > 0 && shown(el)).at(-1) || null;
}

// B401: what is under the status bar while something dark covers it: the black run page, a photo full screen, Move and
// Scale, and the black ground around a card sheet. The theme's dark status-bar text (screens/settings.js
// DARK_TEXT_BARS) would be black on black there, so the shell is told light until the last cover goes.
//   const cover = coverDark()   covered from now on; cover(false) ends it, cover(true) starts it again (a page that
//                               hides and comes back); the same answer twice does nothing
//   darkCovered() / onDarkCover(fn)   fn() runs when the first cover comes and when the last one goes
const covers = new Set();
const coverWatchers = new Set();
export const darkCovered = () => covers.size > 0;
export function onDarkCover(fn) { coverWatchers.add(fn); }
export function coverDark() {
  const mine = {};
  const cover = (on) => {
    const was = darkCovered();
    if (on) covers.add(mine); else covers.delete(mine);
    if (was !== darkCovered()) for (const f of coverWatchers) f();
  };
  cover(true);
  return cover;
}

// globalThis.ifizboxScrollToTop: true when something scrolled.
export function makeScrollToTop(doc, topBody, win = globalThis) {
  return () => scrollToTop(statusBarTarget(doc, topBody()), win);
}
