// A modal sheet, as iOS 6 presents one (presentModalViewController): it slides up over everything with its own
// blue nav bar, a title and a Done button, and slides back down on Done or Escape. Transform only.
// Styles: packages.css (.sheet). The one sheet scaffold: the Confirm sheets (screens/queue.js modal), Write a Review
// (screens/reviews.js), the progress page (nav/progress.js) and the Install sheet (signing-sheet.js) are built on it.
//
//   const close = showSheet({ title: "Depiction", body: element, onClose });
//   close()                      slides it down, removes it, runs onClose; a promise that settles once it is gone
//                                (the same promise on every later call)
//   close.sheet / .h1 / .left / .right / .content   its nodes (.content is the .sheet-body the body goes in)
//   close.setTitle(t)            the title and the dialog's label
//   close.closed()               true once close() ran
//   close.cover(on)              B401: a black sheet slid away without closing (nav/progress.js hide) and back
//
// Options beyond title/body/onClose:
//   left                         a node (or array) at the left of the bar (empty by default)
//   right                        a node (or array) at the right in place of Done; null for nothing there
//   cls                          more classes on the .sheet ("confirm-sheet", "console progress-page")
//   bodyCls                      more classes on the .sheet-body
//   escape                       false: Escape does nothing (sheets whose close has more to do than slide down)
//
// Card sheets, a nav hook for eras (docs/eras.md, iOS 13 and later): with <html data-sheet="card"> the sheet stops a
// gap below the status bar as a card with rounded top corners (packages.css's sheet hooks), and the page behind it
// (the nav bar, the screens and the tab bar) scales back about the screen's centre and dims onto the black ground,
// then comes back as the last card sheet goes. Transform and opacity only. Its numbers are custom properties on
// <html>: --sheet-behind-scale, --sheet-behind-shift (px down) and --sheet-behind-opacity. Off (iOS 6) nothing
// behind the sheet moves.
import { EASE, DURATION, SHEET_IN } from "./motion.js";
import { coverDark } from "./statusbar.js";

const PAGE = ["navbar", "screens", "tabbar"];  // index.html's page, under every sheet
let behind = null;                            // the page's open card animations, while a card sheet is up
let cards = 0;                                // card sheets up

const cardSheets =(doc = globalThis.document) => doc?.documentElement?.getAttribute?.("data-sheet") === "card";

// The page behind scales about the viewport's centre: each fixed piece gets the translate that, with its own centre
// as the origin, lands it where scaling about the screen's centre would.
function pushBack(doc) {
  const root = doc.documentElement;
  const css = globalThis.getComputedStyle?.(root);
  const num = (name, dflt) => { const v = parseFloat(css?.getPropertyValue(name)); return Number.isFinite(v) ? v : dflt; };
  const s = num("--sheet-behind-scale", 0.92), dy = num("--sheet-behind-shift", 0), op = num("--sheet-behind-opacity", 0.75);
  const cx = (globalThis.innerWidth ?? 0) / 2, cy = (globalThis.innerHeight ?? 0) / 2;
  const anims = [];
  for (const id of PAGE) {
    const el = doc.getElementById?.(id);
    if (!el?.animate) continue;
    const r = el.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
    const tx = (cx - (r.left + r.width / 2)) * (1 - s), ty = (cy - (r.top + r.height / 2)) * (1 - s) + dy;
    const to = { transform: `translate(${+tx.toFixed(2)}px, ${+ty.toFixed(2)}px) scale(${s})`, opacity: op };
    anims.push({ el, to, a: el.animate([{ transform: "none", opacity: 1 }, to], { duration: SHEET_IN, easing: EASE, fill: "forwards" }) });
  }
  return anims;
}

// Back from wherever the page is now (a sheet closed mid push-back must not jump to the end first).
function bringForward(anims) {
  for (const { el, to, a } of anims) {
    const cs = globalThis.getComputedStyle?.(el);
    const now = cs?.transform ? { transform: cs.transform, opacity: Number(cs.opacity) } : to;
    const back = el.animate([now, { transform: "none", opacity: 1 }], { duration: DURATION, easing: EASE, fill: "forwards" });
    const end = () => { a.cancel?.(); back.cancel?.(); };
    if (back?.finished) back.finished.then(end, end); else end();
  }
}

export function showSheet({ title = "", body = null, onClose = () => {}, left = null, right, cls = "", bodyCls = "", escape = true } = {}) {
  const doc = globalThis.document;
  const make = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };
  const put = (box, nodes) => { for (const n of [nodes].flat()) if (n) box.append(n); };

  const sheet = make("div", `sheet ${cls}`.trim());
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", title);

  const bar = make("header", "navbar sheet-bar");
  const h1 = make("h1", "nav-title", title);
  const l = make("div", "sheet-left");
  const r = make("div", "sheet-right");
  let done = null;
  if (right === undefined) {
    done = make("button", "bar-button done", "Done");
    done.type = "button";
    r.append(done);
  } else put(r, right);
  put(l, left);
  const row = make("div", "sheet-bar-row");
  row.append(l, h1, r);
  bar.append(row);

  const content = make("div", `sheet-body ${bodyCls}`.trim());
  put(content, body);
  sheet.append(bar, content);
  doc.body.append(sheet);

  sheet.animate?.([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: SHEET_IN, easing: EASE });
  const card = cardSheets(doc);
  if (card && cards++ === 0) behind = pushBack(doc);
  // B401: light status-bar text over the black page (.console), and over the black ground a card's page sinks onto
  const cover = card || cls.split(" ").includes("console") ? coverDark() : () => {};

  let gone = null;
  const onKey = (e) => { if (e.key === "Escape") close(); };
  function close() {
    if (gone) return gone;
    doc.removeEventListener?.("keydown", onKey);
    cover(false); // as it starts down: its top edge leaves the status bar first
    if (card && --cards === 0 && behind) { bringForward(behind); behind = null; }
    gone = new Promise((resolve) => {
      const end = () => {
        sheet.remove();
        try { onClose(); } finally { resolve(); }
      };
      const a = sheet.animate?.([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: DURATION, easing: EASE, fill: "forwards" });
      if (a?.finished) a.finished.then(end, end); else end();
    });
    return gone;
  }
  if (escape) doc.addEventListener?.("keydown", onKey);
  if (done) {
    done.addEventListener("click", () => close());
    done.focus?.({ preventScroll: true });
  }
  return Object.assign(close, {
    sheet, h1, left: l, right: r, content,
    setTitle(t) { h1.textContent = t; sheet.setAttribute("aria-label", t); },
    closed: () => gone !== null,
    cover(on) { if (!gone && !card) cover(on); }, // a card's page stays sunk on the black ground until close()
  });
}
