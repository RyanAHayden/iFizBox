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
// answer. Its popover (iOS 26+ shows one on the iPhone too) points at the element the last touch went down on, when
// that touch was recent. A shell without ui.actionSheet, the site and every other style get the CSS sheet.
//
// The source button: `from` (an element, or a rect {x, y, width, height}) names the button that opened the sheet;
// without it, the button the last tap or click landed on, while that was recent (sourceRect). A tap on a sheet's own
// button (Modify > Downgrade) keeps the button that opened the first sheet. The native sheet's popover points at it.
// In the iOS 26 era (<html data-style="ios26">) a CSS sheet with a source button is an anchored menu (UIMenu-style,
// .action-menu): a rounded glass list that grows out of the button's rect, the button's corner pinned, and goes back
// into it on dismiss; no Cancel (a tap outside or Escape is -1). Transform and opacity only. A sheet with no source
// button, and every other era, keeps the bottom sheet.
import { EASE, DURATION } from "./motion.js";
import { nativeBridge, hasNativeCall } from "../native.js";

export function showActionSheet(opts = {}) {
  const native = nativeBridge();
  if (!wantsNativeControls(native)) return cssSheet(opts);
  const { title = "", buttons = [], cancel = "Cancel", destructive = -1 } = opts;
  const labels = buttons.map((b) => String(b));
  const params = { title: String(title ?? ""), buttons: labels, cancel: cancel ? String(cancel) : "",
    destructive: [].concat(destructive).filter((i) => Number.isInteger(i) && i >= 0 && i < labels.length) };
  const rect = sourceRect(opts.from) ?? tapRect();
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

// The element the last touch went down on and when (a capture listener on the document), for the popover's arrow.
export const TAP_FRESH_MS = 3000; // a sheet later than this after the touch (a timer, a slow answer) points at no row
let lastTap = null;
let lastTapAt = 0;
let watching = null;
export function watchTaps(doc = globalThis.document) {
  if (!doc?.addEventListener || watching === doc) return;
  watching = doc;
  const seen = (e) => {
    // A tap on an open sheet's own button keeps the element that opened it (the next sheet grows from it too).
    if (!e.target?.closest?.(".action-scrim")) lastTap = e.target;
    lastTapAt = Date.now();
  };
  doc.addEventListener("pointerdown", seen, true);
  doc.addEventListener("click", seen, true); // a click with no touch first: the native glass bar buttons, the keyboard
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

// The anchored menu: the iOS 26 era, with a source button.
const menuEra = (doc = globalThis.document) => doc?.documentElement?.getAttribute?.("data-style") === "ios26";

// {x, y, width, height} in CSS px from the viewport's top left (the web view's own points: the page isn't zoomed), of
// the button/row the last touch went down on; null when there was none in the last TAP_FRESH_MS or it left the page.
export function tapRect(now = Date.now()) {
  if (!lastTap || now - lastTapAt > TAP_FRESH_MS) return null;
  return rectOf(lastTap.closest?.("button, a, .cell, li, [role=button]") ?? lastTap);
}

// The CSS sheet: iOS 6's UIActionSheet, restyled by each era's stylesheet; the iOS 26 era's anchored menu.
function cssSheet(opts = {}) {
  const anchor = menuEra() ? sourceRect(opts.from) : null;
  return anchor ? menuSheet(opts, anchor) : bottomSheet(opts);
}

// The menu's spring as it grows out of the button (a little overshoot, as iOS 26's), and its way back.
export const MENU_IN = 380, MENU_OUT = 220;
export const MENU_EASE_IN = "cubic-bezier(.3,1.2,.5,1)", MENU_EASE_OUT = "cubic-bezier(.4,0,.8,.6)";
const MENU_GAP = 8; // px kept clear of the screen's edges and safe areas (the room probe's inset)

// Where the menu goes: `size` {width, height} beside `a` (the source button, {x, y, width, height}) inside `room`
// {left, top, right, bottom}. It covers the button, the button's corner pinned: its top at the button's top and
// growing down, or (with more room above) its bottom at the button's bottom growing up; its left edge at the
// button's left, or its right edge at the button's right for a button on the right half. Clamped into the room;
// `maxHeight` is set when the menu is taller than the room on its side. -> { left, top, maxHeight, down, right }.
export function placeMenu(a, size, room, viewWidth = room.right + room.left) {
  // measured from the button's edges clamped into the room (a button partly outside it still keeps the menu in)
  const start = Math.max(a.y, room.top), end = Math.min(a.y + a.height, room.bottom);
  const below = room.bottom - start, above = end - room.top;
  const down = below >= size.height || below >= above;
  const fits = down ? below : above;
  const height = Math.min(size.height, fits);
  const top = down ? start : end - height;
  const right = a.x + a.width / 2 > viewWidth / 2;
  let left = right ? a.x + a.width - size.width : a.x;
  left = Math.max(room.left, Math.min(left, room.right - size.width));
  return { left: Math.round(left), top: Math.round(Math.max(room.top, top)), maxHeight: height < size.height ? Math.floor(height) : null, down, right };
}

// The iOS 26 era's anchored menu over the source button `a`.
function menuSheet({ title = "", buttons = [], destructive = -1 } = {}, a) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "action-scrim action-menu-scrim";
    const dim = document.createElement("div");
    dim.className = "action-dim";
    const room = document.createElement("div"); // the safe room, measured: inset by the safe areas and MENU_GAP
    room.className = "action-menu-room";
    room.setAttribute("aria-hidden", "true");
    const menu = document.createElement("div");
    menu.className = "action-sheet action-menu";
    menu.setAttribute("role", "menu");
    if (title) {
      menu.setAttribute("aria-label", title);
      menu.append(Object.assign(document.createElement("p"), { className: "action-title", textContent: title }));
    }
    const list = document.createElement("div");
    list.className = "action-list";
    list.dataset.scroller = "";
    menu.append(list);
    buttons.forEach((label, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `action-button${[].concat(destructive).includes(i) ? " destructive" : ""}`;
      b.setAttribute("role", "menuitem");
      b.textContent = label;
      b.addEventListener("click", (e) => { e.stopPropagation(); close(i); });
      list.append(b);
    });
    dim.addEventListener("click", () => close(-1));
    scrim.append(dim, room, menu);
    document.body.append(scrim);

    // Place it: the menu's own size and the room, measured now that both are in the page.
    const box = (el, dflt) => el.getBoundingClientRect?.() ?? dflt;
    const vw = globalThis.innerWidth ?? 390, vh = globalThis.innerHeight ?? 844;
    const r = box(room, { left: MENU_GAP, top: MENU_GAP, right: vw - MENU_GAP, bottom: vh - MENU_GAP });
    const m = box(menu, { width: 250, height: 44 * buttons.length });
    const size = { width: m.width || 250, height: m.height || 44 * buttons.length };
    const at = placeMenu(a, size, r, vw);
    Object.assign(menu.style, { left: `${at.left}px`, top: `${at.top}px`, right: "auto", bottom: "auto" });
    if (at.maxHeight != null) { menu.style.maxHeight = `${at.maxHeight}px`; size.height = at.maxHeight; }
    menu.dataset.grow = at.down ? "down" : "up";
    // The button's rect, as a transform of the menu (origin: its top left): where it grows from and goes back to.
    const sx = Math.max(a.width / size.width, 0.05), sy = Math.max(a.height / size.height, 0.05);
    const asButton = `translate(${+(a.x - at.left).toFixed(2)}px, ${+(a.y - at.top).toFixed(2)}px) scale(${+sx.toFixed(4)}, ${+sy.toFixed(4)})`;
    menu.style.transformOrigin = "0 0";

    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(-1); } };
    document.addEventListener("keydown", onKey);
    dim.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: MENU_IN, easing: "ease-out" });
    menu.animate?.([{ transform: asButton, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: MENU_IN, easing: MENU_EASE_IN });
    list.querySelector(".action-button")?.focus?.({ preventScroll: true });

    let done = false;
    function close(index) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      scrim.style.pointerEvents = "none";
      resolve(index); // B202: answered before the animation, which can't hold it
      let timer = 0;
      const end = () => { clearTimeout(timer); scrim.remove(); };
      try {
        dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MENU_OUT, easing: "ease-in", fill: "forwards" });
        const out = menu.animate([{ transform: "none", opacity: 1 }, { transform: asButton, opacity: 0 }],
          { duration: MENU_OUT, easing: MENU_EASE_OUT, fill: "forwards" });
        timer = setTimeout(end, MENU_OUT + 300);
        out.finished.then(end, end);
      } catch {
        end();
      }
    }
  });
}

// The bottom sheet: iOS 6's UIActionSheet, restyled by each era's stylesheet.
function bottomSheet({ title = "", buttons = [], cancel = "Cancel", destructive = -1 } = {}) {
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
