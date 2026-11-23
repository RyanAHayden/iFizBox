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
// F345c, B383: in the app under the iOS 26 style (<html data-style="ios26">) a sheet with a source (the
// button, or the row, it was opened from) is the shell's own UIMenu out of that source (bridge call ui.menu with sheet:
// true, native/Sources/NativeMenus.swift), opened by the glass nav bar button itself where the shell draws one: the
// title, the red buttons and the icons with it, no Cancel (a tap outside is -1). One way for every sheet; a call while
// a menu is up (a fast repeat tap) answers -1 and the menu stays. Only a sheet with no source (a timer, a slow answer)
// is the shell's UIAlertController (.actionSheet, ui.actionSheet). The concept frame (no shell) and every other style
// get the bottom sheet.
//
// The source button: `from` (an element, or a rect {x, y, width, height}) names the button that opened the sheet;
// without it, the button the last tap or click landed on, while that was recent (sourceRect). A tap on a sheet's own
// button (Modify > Downgrade) keeps the button that opened the first sheet.
// C70: the iOS 26 style has no sheet of its own to draw: it is the shell's UIMenu and UIAlertController. The bottom
// sheet below is iOS 6's, 7's and 13's, and what the concept frame (Chromium, no shell) shows under iOS 26.
// F387: icons and onPick, for the share sheet in the iOS 7, 13 and 26 eras (nav/sharesheet.js):
//   showActionSheet({ buttons, icons: [el | null, …], onPick: (i) => … })
// icons puts an element in front of each button's label (.action-button.has-icon: .action-icon + .action-label,
// laid out by style.css's share hooks). The native menu draws nativeIcons instead, one per button: null, {symbol} (an SF
// Symbol's name), {image} (a data: URL) or {letter, color}; a sheet with icons but no nativeIcons, or no source, is the
// CSS sheet. onPick(i) runs inside the tap, before the answer (clipboard writes and app links need the gesture; after a
// native menu's answer copyText falls back to the shell's clipboard); i is -1 for Cancel, a tap on the dim or Escape.
import { EASE, DURATION } from "./motion.js";
import { nativeBridge, hasNativeCall } from "../native.js";

// A button's label, with its icon in front when it has one.
function fillButton(b, label, icon) {
  if (!icon) { b.textContent = label; return; }
  b.classList.add("has-icon");
  icon.classList?.add("action-icon");
  icon.setAttribute?.("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "action-label";
  text.textContent = label;
  b.append(icon, text);
}

// onPick inside the tap; a throw in it never holds the answer.
function picked(opts, index) {
  try { opts.onPick?.(index); } catch (e) { console.error(e); }
}

export function showActionSheet(opts = {}) {
  const native = nativeBridge();
  const hasIcons = Boolean(opts.icons?.some(Boolean));
  if (!wantsNativeControls(native)) return bottomSheet(opts);
  const rect = sourceRect(opts.from) ?? tapRect();
  if (hasIcons && !(rect && opts.nativeIcons)) return bottomSheet(opts);
  const { title = "", buttons = [], cancel = "Cancel", destructive = -1 } = opts;
  const labels = buttons.map((b) => String(b));
  const red = [].concat(destructive).filter((i) => Number.isInteger(i) && i >= 0 && i < labels.length);
  const answer = (r) => {
    const i = Number.isInteger(r?.index) && r.index >= 0 && r.index < labels.length ? r.index : -1;
    if (lastTap) lastTapAt = Date.now(); // a sheet this answer opens (Modify > Downgrade) has the same source
    picked(opts, i);
    return i;
  };
  const alone = () => native.call("ui.actionSheet", { title: String(title ?? ""), buttons: labels,
    cancel: cancel ? String(cancel) : "", destructive: red, ...(rect ? { rect } : {}) })
    .then(answer, () => bottomSheet(opts)); // an older shell ("unknown method ui.actionSheet") or no window to show it in
  if (!rect || !labels.length) return alone();
  const params = { sheet: true, title: String(title ?? ""), items: labels, destructive: red, rect };
  if (hasIcons) params.icons = labels.map((_, i) => opts.nativeIcons[i] ?? null);
  return native.call("ui.menu", params).then(answer, () => (hasIcons ? bottomSheet(opts) : alone())); // no menu showed
}

// F345c: the native sheets and menus only in the app (the bridge takes calls) under the native controls hook.
export function wantsNativeControls(native = nativeBridge(), doc = globalThis.document) {
  return hasNativeCall(native) && doc?.documentElement?.getAttribute?.("data-style") === "ios26";
}

// The element the last touch went down on and when (a capture listener on the document), for the popover's arrow.
export const TAP_FRESH_MS = 3000; // a sheet later than this after the touch (a timer, a slow answer) points at no row
let lastTap = null;
let lastTapAt = 0;
let lastRect = null; // where it was, for a row redrawn before its sheet opens
let watching = null;
export function watchTaps(doc = globalThis.document) {
  if (!doc?.addEventListener || watching === doc) return;
  watching = doc;
  const seen = (e) => {
    // A tap on an open sheet's own button keeps the element that opened it (the next sheet grows from it too).
    if (!e.target?.closest?.(".action-scrim")) { lastTap = e.target; lastRect = rectOf(tapped(lastTap)); }
    lastTapAt = Date.now();
  };
  doc.addEventListener("pointerdown", seen, true);
  doc.addEventListener("click", seen, true); // a click with no touch first: the native glass bar buttons, the keyboard
  doc.addEventListener("menupick", seen, true); // nav/menu.js: a held row's native menu chose an item
}
watchTaps();

const rectOf = (el) => {
  if (!el?.getBoundingClientRect || el.isConnected === false) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
};

// The source button's rect: `from` (an element or a rect), else the button the last recent tap or click landed on
// (a button only: a row's tap gives no source button). null when there is none.
export function sourceRect(from = null, now = Date.now()) {
  if (from && Number.isFinite(from.x) && Number.isFinite(from.y) && from.width > 0 && from.height > 0) {
    return { x: from.x, y: from.y, width: from.width, height: from.height };
  }
  if (from) return rectOf(from);
  if (!lastTap || now - lastTapAt > TAP_FRESH_MS) return null;
  return rectOf(lastTap.closest?.("button, [role=button]"));
}

// The button or row a touch on `el` belongs to.
const tapped = (el) => el?.closest?.("button, a, .cell, li, [role=button]") ?? el;

// {x, y, width, height} in CSS px from the viewport's top left (the web view's own points: the page isn't zoomed), of
// the button/row the last touch went down on (where it was then, if it has left the page); null when there was none in
// the last TAP_FRESH_MS.
export function tapRect(now = Date.now()) {
  if (!lastTap || now - lastTapAt > TAP_FRESH_MS) return null;
  return rectOf(tapped(lastTap)) ?? lastRect;
}

// The bottom sheet: iOS 6's UIActionSheet, restyled by each era's stylesheet.
function bottomSheet(opts = {}) {
  const { title = "", buttons = [], cancel = "Cancel", destructive = -1, icons = [] } = opts;
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
      fillButton(b, label, index >= 0 ? icons[index] : null);
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
      picked(opts, index);
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
