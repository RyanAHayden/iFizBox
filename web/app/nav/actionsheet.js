// UIActionSheet as iOS 6 draws it (F29; Cydia's Modify and Downgrade sheets, ref/4s/screens/cydia-package-modify.png
// and -downgrade.png): a translucent grey-blue panel slides up from the bottom over a dimmed screen, with a
// stack of white glossy buttons and a dark Cancel button below a wider gap. Styles: packages.css (.action-sheet),
// colours sampled from the 4S's UIAlertSheet* art. Slides by transform only.
//
//   const i = await showActionSheet({ title, buttons: ["Reinstall", "Remove"], destructive: 1 });
//   // i: the tapped button's index, or -1 for Cancel (also a tap on the dimmed screen and Escape)
//   // destructive: one index or a list of them (red buttons)
//
// All text goes in through textContent.
//
// F345c: in the app under the native controls hook (<html data-controls="native">) the sheet is the shell's own
// UIAlertController (.actionSheet, bridge call ui.actionSheet, native/Sources/NativeMenus.swift): same options, same
// answer. Its popover (iPad) points at `anchor`, or else at the element the last touch went down on. A shell without
// ui.actionSheet, the site and every other style get the CSS sheet.
import { EASE, DURATION } from "./motion.js";
import { nativeBridge, hasNativeCall } from "../native.js";

export function showActionSheet(opts = {}) {
  const native = nativeBridge();
  if (!wantsNativeControls(native)) return cssSheet(opts);
  const { title = "", buttons = [], cancel = "Cancel", destructive = -1, anchor = null } = opts;
  const labels = buttons.map((b) => String(b));
  const params = { title: String(title ?? ""), buttons: labels, cancel: cancel ? String(cancel) : "",
    destructive: [].concat(destructive).filter((i) => Number.isInteger(i) && i >= 0 && i < labels.length) };
  const rect = tapRect(anchor);
  if (rect) params.rect = rect;
  return native.call("ui.actionSheet", params).then((r) => {
    const i = r?.index;
    return Number.isInteger(i) && i >= 0 && i < labels.length ? i : -1;
  }, () => cssSheet(opts)); // an older shell ("unknown method ui.actionSheet") or no window to show it in
}

// F345c: the native sheets and menus only in the app (the bridge takes calls) under the native controls hook.
export function wantsNativeControls(native = nativeBridge(), doc = globalThis.document) {
  return hasNativeCall(native) && doc?.documentElement?.getAttribute?.("data-controls") === "native";
}

// The element the last touch went down on (a capture listener added on first use), for the popover's arrow.
let lastTap = null;
let watching = null;
export function watchTaps(doc = globalThis.document) {
  if (!doc?.addEventListener || watching === doc) return;
  watching = doc;
  doc.addEventListener("pointerdown", (e) => { lastTap = e.target; }, true);
}
watchTaps();

// {x, y, width, height} in CSS px from the viewport's top left (the web view's own points: the page isn't zoomed), of
// `anchor` or the button/row the last touch went down on; null when there is none on screen.
export function tapRect(anchor = null) {
  let el = anchor ?? lastTap;
  if (!anchor) el = el?.closest?.("button, a, .cell, li, [role=button]") ?? el;
  if (!el?.getBoundingClientRect || el.isConnected === false) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
}

// The CSS sheet: iOS 6's UIActionSheet, restyled by each era's stylesheet.
function cssSheet({ title = "", buttons = [], cancel = "Cancel", destructive = -1 } = {}) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "action-scrim";
    const dim = document.createElement("div"); // its own layer, so the dimming fades by opacity alone
    dim.className = "action-dim";
    const sheet = document.createElement("div");
    sheet.className = "action-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    if (title) {
      sheet.setAttribute("aria-label", title);
      sheet.append(Object.assign(document.createElement("p"), { className: "action-title", textContent: title }));
    }
    // The choices scroll in their own list; the title and Cancel stay put, so Cancel is always a tap away.
    const list = document.createElement("div");
    list.className = "action-list";
    list.dataset.scroller = ""; // nav/scroller.js draws its iOS 6 indicator in the list's box
    sheet.append(list);
    const make = (label, cls, index, parent = list) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `action-button${cls ? ` ${cls}` : ""}`;
      b.textContent = label;
      b.addEventListener("click", (e) => { e.stopPropagation(); close(index); });
      parent.append(b);
      return b;
    };
    buttons.forEach((label, i) => make(label, [].concat(destructive).includes(i) ? "destructive" : "", i));
    const cancelButton = cancel ? make(cancel, "cancel", -1, sheet) : null;
    dim.addEventListener("click", () => close(-1));
    scrim.append(dim, sheet);
    document.body.append(scrim);

    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(-1); } };
    document.addEventListener("keydown", onKey);
    dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: "ease-out" });
    sheet.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: DURATION, easing: EASE });
    (cancelButton || sheet.querySelector(".action-button"))?.focus({ preventScroll: true });

    let done = false;
    function close(index) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      scrim.style.pointerEvents = "none";
      // B202: the answer and the sheet's removal never hang on the slide-out. A throw in it (C26's undefined `ease`
      // until B201) left the sheet drawn with dead buttons and the caller never answered: View Repo froze the app.
      resolve(index);
      let timer = 0;
      const end = () => { clearTimeout(timer); scrim.remove(); };
      try {
        dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: "ease-in", fill: "forwards" });
        const a = sheet.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 250, easing: EASE, fill: "forwards" });
        timer = setTimeout(end, 250 + 300); // an animation iOS drops (the app went to the background) still ends
        a.finished.then(end, end);
      } catch {
        end();
      }
    }
  });
}
