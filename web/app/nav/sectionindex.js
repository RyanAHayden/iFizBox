// UITableView's section index, as Cydia's package lists have it: # and A–Z down the right edge between the bars.
// Touch or drag along it and the list jumps to that letter's section (or the next one there is); while held it
// gets iOS 6's grey rounded backing. The iOS 6 scroll indicator stays off on a list that has one, as in Cydia.
// Styles: packages.css (.section-index).
import { haptic } from "./haptic.js";

const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

export function createSectionIndex(scroller, list) {
  const page = scroller.parentElement;
  const el = document.createElement("div");
  el.className = "section-index";
  el.setAttribute("aria-hidden", "true");
  for (const l of LETTERS) el.append(Object.assign(document.createElement("span"), { textContent: l }));
  page.append(el);
  scroller.dataset.sectionIndex = ""; // nav/scroller.js leaves this scroller without its indicator

  let last = null;
  const jump = (y) => {
    const r = el.getBoundingClientRect();
    const i = Math.max(0, Math.min(LETTERS.length - 1, Math.floor((y - r.top) / r.height * LETTERS.length)));
    if (LETTERS[i] === last) return;
    last = LETTERS[i];
    const heads = list.headerTops();
    if (!heads.length) return;
    // that letter's section, else the next one after it, else the last
    const want = LETTERS.indexOf(last);
    const h = heads.find((x) => LETTERS.indexOf(x.text) >= want) ?? heads[heads.length - 1];
    // # and the first section are the page's top: whatever is above the list (Browse's bar) shows again
    const to = want === 0 || h === heads[0] ? 0 : Math.min(h.top, scroller.scrollHeight - scroller.clientHeight);
    if (to !== scroller.scrollTop) haptic(); // a tick for each new letter the list lands on
    scroller.scrollTop = to;
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    // A fling still running would keep gliding the list under the jumps (iOS keeps its momentum while scrollTop is
    // set): overflow hidden ends it at once, and scrollTop still works while it's hidden.
    scroller.style.overflowY = "hidden";
    el.classList.add("held");
    last = null;
    jump(e.clientY);
  });
  el.addEventListener("pointermove", (e) => { if (el.classList.contains("held")) jump(e.clientY); });
  const end = () => { el.classList.remove("held"); last = null; scroller.style.overflowY = ""; };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  return { el, destroy: () => { el.remove(); delete scroller.dataset.sectionIndex; } };
}
