// UIActivityViewController as iOS 6 draws it on the iPhone (F76; the Teehan+Lax kit's "Share" layer, sheet.svg
// x 131-771 y 2104-2938): a translucent black panel slides up over the dimmed screen, a grid of 57 pt rounded-square
// icons three to a row (pitch 100 x 101 pt) with white bold 12 pt labels under them, nine to a page (more pages
// swipe sideways, with page dots), and a wide black Cancel button at the bottom. Styles: ios6.css (.share-*).
// Slides and fades by transform and opacity only.
//
//   const i = await showShareSheet({ items: [
//     { label: "Copy Link", glyph: "copy", onSelect: () => … },          // a system activity: white glyph, grey rim
//     { label: "Sileo", letter: "S", color: "#6a5bd8", onSelect: … },    // an app: its initial on its colour,
//     { label: "Sileo", image: "data:image/png;…", onSelect: … },        // or its icon (app-icons.js, a data: URL)
//   ] });
//   // i: the tapped item's index (its onSelect has run), or -1 for Cancel, a tap on the dim or Escape
//
// The nav bar's Share button (the iOS 6 action icon, drawn in CSS): setShare(body, () => …) from a screen's render,
// once it knows what to share, puts it left of the page's own right button; setShare(body, null) hides it.
// All text goes in through textContent.

import { el } from "./ui.js";
import { EASE, DURATION } from "./motion.js";
import { navItemOf } from "./navbar.js";
import { showActionSheet } from "./actionsheet.js";

const PER_PAGE = 9;

// The system activities' glyphs. Their art is ios6.css's --share-glyph-<name> tokens (.share-glyph.glyph-<name>), so
// a style can swap it: Copy (UIActivityCopy's page with a folded corner and a plus) and QR (a QR code's corners).
const GLYPHS = ["copy", "qr"];

function iconOf(item) {
  const box = el("span", "share-icon");
  if (GLYPHS.includes(item.glyph)) {
    box.classList.add("system");
    const glyph = el("span", `share-glyph glyph-${item.glyph}`);
    glyph.setAttribute("aria-hidden", "true");
    box.append(glyph);
  } else if (/^data:image\//.test(item.image ?? "")) {
    box.classList.add("app", "has-image");
    box.append(Object.assign(new Image(), { src: item.image, alt: "", className: "share-image" }));
  } else {
    box.classList.add("app");
    // The app's own colour (data, not art): ios6.css paints it through --share-tint.
    if (/^#[0-9a-f]{3,8}$/i.test(item.color ?? "")) box.style.setProperty("--share-tint", item.color);
    box.append(el("span", "share-letter", String(item.letter ?? item.label ?? "?").slice(0, 2)));
  }
  return box;
}

// F387: the era's share layout, style.css's --share-layout hook. "grid" (iOS 6) is the activity sheet below; "action"
// (iOS 7, 13 and 26) hands the items to the action sheet (nav/actionsheet.js), each with its icon (iconOf, painted
// smaller by the era's --share-* tokens) in front of its label, Cancel under them; the iOS 26 era's sheet is its
// anchored menu, grown out of the Share button.
export function shareLayout(doc = globalThis.document) {
  const root = doc?.documentElement;
  const v = root ? globalThis.getComputedStyle?.(root)?.getPropertyValue?.("--share-layout") : "";
  return String(v ?? "").trim() === "action" ? "action" : "grid";
}

function actionShare(items, cancel) {
  return showActionSheet({
    buttons: items.map((item) => String(item.label ?? "")),
    icons: items.map(iconOf),
    cancel,
    // inside the tap, as the grid's close() does: clipboard writes and app links need the user's gesture
    onPick: (i) => { if (i >= 0) try { items[i]?.onSelect?.(); } catch (e) { console.error(e); } },
  });
}

export function showShareSheet({ items = [], cancel = "Cancel", title = "Share" } = {}) {
  if (shareLayout() === "action") return actionShare(items, cancel);
  return new Promise((resolve) => {
    const scrim = el("div", "share-scrim");
    const dim = el("div", "share-dim"); // its own layer, so the dimming fades by opacity alone
    const sheet = el("div", "share-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", title);

    const pages = el("div", "share-pages");
    for (let p = 0; p < Math.max(1, Math.ceil(items.length / PER_PAGE)); p++) {
      const grid = el("div", "share-grid");
      items.slice(p * PER_PAGE, (p + 1) * PER_PAGE).forEach((item, j) => {
        const index = p * PER_PAGE + j;
        const b = el("button", "share-item");
        b.type = "button";
        b.append(iconOf(item), el("span", "share-label", item.label));
        b.addEventListener("click", (e) => { e.stopPropagation(); close(index); });
        grid.append(b);
      });
      pages.append(grid);
    }
    sheet.append(pages);

    // UIPageControl under the grid when there is more than one page.
    let dots = null;
    if (pages.children.length > 1) {
      dots = el("div", "share-dots");
      dots.setAttribute("aria-hidden", "true");
      for (let i = 0; i < pages.children.length; i++) dots.append(el("span", i ? "" : "on"));
      sheet.append(dots);
      pages.addEventListener("scroll", () => {
        const at = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth));
        [...dots.children].forEach((d, i) => d.classList.toggle("on", i === at));
      }, { passive: true });
    }

    const cancelButton = el("button", "share-cancel", cancel);
    cancelButton.type = "button";
    cancelButton.addEventListener("click", (e) => { e.stopPropagation(); close(-1); });
    sheet.append(cancelButton);
    dim.addEventListener("click", () => close(-1));
    scrim.append(dim, sheet);
    document.body.append(scrim);

    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(-1); } };
    document.addEventListener("keydown", onKey);
    dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: "ease-out" });
    sheet.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: DURATION, easing: EASE });
    cancelButton.focus({ preventScroll: true });

    let done = false;
    function close(index) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      scrim.style.pointerEvents = "none";
      dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: "ease-in", fill: "forwards" });
      const a = sheet.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 250, easing: EASE, fill: "forwards" });
      const end = () => scrim.remove();
      a.finished.then(end, end);
      // Run the item's action inside the tap (clipboard writes and app links need the user's gesture).
      if (index >= 0) {
        try { items[index]?.onSelect?.(); } catch (e) { console.error(e); }
      }
      resolve(index);
    }
  });
}

// ---- the nav bar's Share button ---------------------------------------------------------------------------------

const handlers = new WeakMap();

// open: called on a tap; null hides the button. The button goes in front of the page's own right button (Edit,
// Install), made on first use so no screen's nav() has to know about it.
export function setShare(body, open, label = "Share") {
  const right = navItemOf(body)?.querySelector(".nav-right");
  if (!right) return;
  let b = right.querySelector(".share-button");
  if (!b && !open) return;
  if (!b) {
    b = document.createElement("button");
    b.type = "button";
    b.className = "bar-button bar-icon share-button";
    b.setAttribute("aria-label", label);
    b.addEventListener("click", () => handlers.get(b)?.());
    right.prepend(b);
  }
  if (open) handlers.set(b, open);
  else handlers.delete(b);
  b.hidden = !open;
}
