// The tab bar: one item per tab, icon drawn in CSS (ios6.css masks a gradient with an SVG glyph per tab), and a
// red count badge per item. setBadge(tab, n) shows n (a number or short text), "spinner" a spinner (Cydia's
// Sources tab while refreshing); 0, "" or null hides it.

export function createTabbar(el, tabs, titleOf) {
  const items = {};
  for (const tab of tabs) {
    const a = document.createElement("a");
    a.className = "tab";
    a.dataset.tab = tab;
    a.innerHTML = '<span class="tab-icon" aria-hidden="true"></span><span class="tab-label"></span><span class="badge" hidden></span>';
    a.querySelector(".tab-label").textContent = titleOf(tab);
    el.append(a);
    items[tab] = a;
  }
  return {
    items,
    select(tab) {
      for (const [t, a] of Object.entries(items)) {
        a.classList.toggle("active", t === tab);
        if (t === tab) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      }
    },
    setBadge(tab, n) {
      const badge = items[tab] && items[tab].querySelector(".badge");
      if (!badge) return;
      const show = n !== 0 && n != null && n !== "";
      const spin = n === "spinner"; // Cydia's Sources badge while sources refresh: white spokes, no number
      badge.hidden = !show;
      badge.classList.toggle("spinning", spin);
      badge.textContent = show && !spin ? String(n) : "";
      items[tab].setAttribute("aria-label", titleOf(tab) + (show ? `, ${n} new` : ""));
    },
  };
}

// Floating tab bar (era hook, docs/eras.md; iOS 26): with <html data-tabbar="float">, set by the era's JS through
// setFloatingTabbar(true), the bar is a pill inset from the screen's edges and the Search tab (FLOAT_OWN_TAB) its own
// circle beside it; the screens scroll under both. All of it is layout in style.css behind the attribute (--tab-h
// becomes the pill's height plus its gap to the bottom, so every scroller's end room and the bars that sit on the
// tab bar follow); the markup is the same either way. Off (iOS 6, the default) the attribute is absent and nothing
// changes. The app shows this same bar: the shell draws no UITabBar of its own (native/test_web_bars.py).
export const FLOAT_OWN_TAB = "search";

export const floatingTabbarOn = (doc = globalThis.document) =>
  doc?.documentElement?.getAttribute?.("data-tabbar") === "float";

export function setFloatingTabbar(on, doc = globalThis.document) {
  const root = doc?.documentElement;
  if (!root) return;
  if (on) root.setAttribute("data-tabbar", "float");
  else root.removeAttribute("data-tabbar");
}

// A tap on tab `tab` while `current` is the route on screen. As on iOS: another tab -> switch to it (selectTab
// keeps its place); the current tab below its root -> back to the root (selectTab again); the current tab at its
// root -> scrollTop() (the screen's scroller back to the top, like UIKit's status-bar tap, F148) and then the
// screen's reselect(), e.g. Search focuses its field (F36). Everything runs synchronously inside the tap's click
// handler, so iOS counts a focus() there as user-initiated and shows the keyboard.
// B60: while that page's slide to the top is still running (sliding() true), a further tap on the same tab is
// ignored: no restart of the slide and no second reselect(); it returns "busy".
export function tapTab(tab, current, { selectTab, reselect, scrollTop, sliding }) {
  if (current && current.tab === tab && current.path.length === 0) {
    if (sliding && sliding()) return "busy";
    if (scrollTop) scrollTop();
    if (reselect) reselect();
    return "reselect";
  }
  selectTab(tab);
  return "select";
}

// Scroll a page's scroller (.page-body) back to the top, like UIKit's status-bar tap: a quick slide (TOP_MS,
// ease-out), or an instant jump when the user asked for less motion. A fling still coasting would win over the
// scroll on iOS WebKit, so it is stopped first (overflow off for one layout), as UIKit stops the deceleration.
// B57: scrollTo({behavior: "smooth"}) jumped straight to the top on the iPhone 7 (iOS 15.8 WebKit, app and Safari;
// journal/2026-11-18-b57-*), so the slide is our own: scrollTop set on each animation frame. A touch on the list
// ends it where it is; a new call while one runs is ignored (B60: it returns true and the running slide goes on,
// so spamming the tab makes one smooth slide). Only without requestAnimationFrame does it fall back
// to scrollTo. Virtualised lists (nav/vlist.js) re-bind their rows from the scroll events this sends, so the top
// rows are drawn when it lands.
export const TOP_MS = 300;
const slides = new WeakMap(); // body -> stop() of its running slide

// Ease-out cubic: fast at first, settling into the top.
export const easeOut = (p) => 1 - (1 - p) ** 3;

// True while a slide to the top runs on `body` (B60: tapTab ignores reselects then).
export const isSliding = (body) => !!body && slides.has(body);

export function scrollToTop(body, win = globalThis) {
  if (!body) return false;
  if (slides.has(body)) return true; // B60: already on its way up; restarting would stutter
  if (body.scrollTop <= 0) return false;
  body.style.overflowY = "hidden";
  void body.offsetHeight;
  body.style.overflowY = "";
  const reduce = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const raf = win.requestAnimationFrame;
  if (!raf) {
    body.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    return true;
  }
  if (reduce) {
    body.scrollTop = 0;
    return true;
  }
  const from = body.scrollTop;
  let t0 = null, id = 0, done = false;
  const stop = () => {
    if (done) return;
    done = true;
    if (id && win.cancelAnimationFrame) win.cancelAnimationFrame.call(win, id);
    if (body.removeEventListener) body.removeEventListener("touchstart", stop);
    if (slides.get(body) === stop) slides.delete(body);
  };
  const frame = (now) => {
    if (done) return;
    if (t0 === null) t0 = now;
    const p = Math.min(1, Math.max(0, (now - t0) / TOP_MS)); // a frame's time can predate the tap

    body.scrollTop = p >= 1 ? 0 : Math.round(from * (1 - easeOut(p)));
    if (p >= 1) stop();
    else id = raf.call(win, frame);
  };
  slides.set(body, stop);
  if (body.addEventListener) body.addEventListener("touchstart", stop, { passive: true });
  // The first step runs now, inside the tap, so the list moves on the very next frame.
  frame(win.performance?.now?.() ?? Date.now());
  return true;
}
