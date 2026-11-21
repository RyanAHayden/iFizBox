// The one way screens move between pages: go(to) opens a route, back() goes back as the nav bar's Back does. app.js
// hands the router's go and its own goBack in at start (setNavigator); until then (and under `node --test`, where no
// app runs) go writes the hash itself, which the router picks up as a link, and back walks the browser history.
//
// Each page also gets a handle on its own nav bar item (pageHandle), passed to its screen's render(body, route, ctx,
// page) and found again from the page's body (handleOf) by helpers a few calls down that only hold the body.
import { format } from "../router.js";

let current = null; // { go(hash), back() } from app.js

export function setNavigator(nav) { current = nav; }

// "#/sources/x" -> "#/sources/x"; "/sources/x" -> "#/sources/x"; a route object -> its hash.
const hashOf = (to) => (typeof to === "string" ? (to.startsWith("#") ? to : "#" + to) : format(to));

// to: a route ({ tab, path }) or a hash ("#/tab/…"; the leading # may be left out).
export function go(to) {
  const hash = hashOf(to);
  if (current) return current.go(hash);
  if (globalThis.location) globalThis.location.hash = hash.slice(1);
}

export function back() {
  if (current) return current.back();
  globalThis.history?.back?.();
}

// ---- a page's nav bar item ---------------------------------------------------------------------------------------

const pages = new WeakMap(); // page body -> its handle

// item: the page's .nav-item. Its children are drawn again when a lazy screen loads (app.js drawPage), so every call
// looks inside the item afresh.
export function pageHandle(item, body = null) {
  const page = {
    item,
    title: () => item.querySelector(".nav-title")?.textContent ?? "",
    setTitle(text) {
      const h1 = item.querySelector(".nav-title");
      if (h1 && h1.textContent !== text) h1.textContent = text;
    },
    // The right side's button: the first that is the page's own (not B176's pushed copy of a root's button, not F76's
    // Share icon), or the first `match(button)` accepts.
    rightButton(match = null) {
      const all = [...item.querySelectorAll(".nav-right .bar-button")];
      return (match ? all.find(match) : all.find((b) => !b.classList.contains("nav-moved") && !b.classList.contains("share-button"))) ?? null;
    },
    left: () => item.querySelector(".nav-left"),
  };
  if (body) pages.set(body, page);
  return page;
}

// A page's title set after it opened (a package or app page opened by its id, which learns the name once it loads:
// screens/browse.js setTitle) is also the label pages above it show on their back button, unless the screen gave a
// back label of its own (nav()'s `back`). The page right above, already drawn with the old label, takes the new one
// at once. entry: app.js makePage's { item, title, back, handle, backButton }; backButton is the back button app.js
// navParts last drew with this page's label (the page right above; a popped page's item may linger until idle, so
// the next sibling item is not always it).
export function backFollowsTitle(entry) {
  const setTitle = entry.handle.setTitle;
  entry.handle.setTitle = (text) => {
    setTitle(text);
    const old = entry.title;
    if (text === old) return;
    if (entry.back === old) {
      entry.back = text;
      const back = entry.backButton;
      if (back?.isConnected && back.textContent === old) {
        back.textContent = text;
        back.setAttribute("aria-label", "Back to " + text);
      }
    }
    entry.title = text;
  };
}

// The handle of the page `body` belongs to, or null (a body no page holds: a test's stub, a detached sheet).
export const handleOf = (body) => (body && pages.get(body)) || null;
