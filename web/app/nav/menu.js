// UIMenuController as iOS 6 draws it: the black glossy callout with an arrow (Copy, Select All…), shown above a
// held item. Styles: ios6.css (.menu). Any touch outside, a scroll or Escape puts it away.
//
//   showMenu(element, [{ label: "Copy URL", onClick }])
//   longPress(element, selector, (target, e) => ...)  a HOLD_MS hold that doesn't move or scroll; the click ending it is eaten
import { haptic } from "./haptic.js";
import { guarded } from "./tapguard.js";
import { nativeBridge, hasNativeCall } from "../native.js";

// The native controls hook, read inline as nav/alert.js does: importing actionsheet.js's wantsNativeControls would
// load it at startup (module-graph.test.js's budget).
const wantsNativeControls = (native, doc = globalThis.document) =>
  hasNativeCall(native) && doc?.documentElement?.getAttribute?.("data-style") === "ios26";

export const HOLD_MS = 550; // B48: a little longer than 500, nearer iOS's own, so a finger resting before a slow scroll doesn't hold
export const HOLD_SLOP = 10;

let open = null; // the menu on screen: { close() }

// F345c: in the app under the native controls hook the menu is the shell's own UIMenu at the anchor's rect (bridge call
// ui.menu, native/Sources/NativeMenus.swift), answering the chosen item's index (-1: put away). A shell without ui.menu,
// the site and every other style get the CSS callout. Returns close(): it stops a native menu's answer from running
// anything (the menu itself goes with the next touch).
export function showMenu(anchor, items, opts = {}) {
  const native = nativeBridge();
  if (!wantsNativeControls(native)) return cssMenu(anchor, items, opts);
  open?.close();
  const r = anchor.getBoundingClientRect();
  const params = { items: items.map((it) => String(it.label)),
    rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } };
  if (Number.isFinite(opts.x)) params.x = Math.round(opts.x);
  anchor.classList.add("is-held");
  const close = () => {
    if (open !== ctl) return;
    open = null;
    anchor.classList.remove("is-held");
  };
  const ctl = { close };
  open = ctl;
  native.call("ui.menu", params).then((res) => {
    if (open !== ctl) return;
    close();
    const i = res?.index;
    if (globalThis.Event) anchor.dispatchEvent?.(new Event("menupick", { bubbles: true })); // an item's sheet opens from the row (actionsheet.js)
    if (Number.isInteger(i) && i >= 0 && i < items.length) items[i].onClick();
  }, () => {
    if (open !== ctl) return;
    close();
    cssMenu(anchor, items, opts); // no menu opened (the concept frame has no shell)
  });
  return close;
}

function cssMenu(anchor, items, { x = null } = {}) {
  open?.close();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  const row = document.createElement("div");
  row.className = "menu-items";
  // B48: an item is chosen only by a touch that began on the menu. The finger that held a row to open it is still
  // down when the menu appears (often right where it lands), and its lift or drift must not pick Install.
  let touched = false;
  menu.addEventListener("pointerdown", () => { touched = true; });
  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-item";
    b.setAttribute("role", "menuitem");
    b.textContent = it.label;
    b.addEventListener("click", guarded((e) => {
      if (!touched && e?.detail !== 0) return; // the opening touch's click (detail 0: the keyboard, el.click())
      close();
      it.onClick();
    }));
    row.append(b);
  }
  const arrow = document.createElement("span");
  arrow.className = "menu-arrow";
  menu.append(row, arrow);
  document.body.append(menu);

  // Above the item, centred on the finger (or the item), kept on screen; below it when there's no room above.
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const cx = x ?? r.left + r.width / 2;
  const left = Math.max(6, Math.min(innerWidth - w - 6, cx - w / 2));
  const below = r.top - h - 4 < 60;
  menu.classList.toggle("below", below);
  menu.style.left = left + "px";
  menu.style.top = (below ? r.bottom + 4 : r.top - h - 4) + "px";
  arrow.style.left = Math.max(14, Math.min(w - 14, cx - left)) + "px";
  menu.animate([{ opacity: 0, transform: "scale(.8)" }, { opacity: 1, transform: "none" }], { duration: 150, easing: "ease-out" });
  anchor.classList.add("is-held");

  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  setTimeout(() => {
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", onKey);
  });
  function close() {
    if (open !== ctl) return;
    open = null;
    anchor.classList.remove("is-held");
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("scroll", close, true);
    document.removeEventListener("keydown", onKey);
    const a = menu.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" });
    a.finished.then(() => menu.remove(), () => menu.remove());
  }
  const ctl = { close };
  open = ctl;
  return close;
}

// Copy text, with the old execCommand path where the async clipboard isn't allowed.
// F345c: in the app a refused write goes to the shell's clipboard.write (UIPasteboard) before that: a native menu's
// Copy runs after the shell's answer, outside the touch WebKit wants for a clipboard write.
export async function copyText(text, native = nativeBridge()) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    if (native?.call) try { await native.call("clipboard.write", { text: String(text ?? "") }); return; } catch { /* older shell */ }
    const t = Object.assign(document.createElement("textarea"), { value: text });
    t.style.cssText = "position:fixed;opacity:0";
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

// The app's clipboard straight from UIPasteboard (Bridge.swift clipboard.read: no WebKit Paste bubble), "" when
// there's no text. null on the website, or a shell from before clipboard.read: those use navigator.clipboard.
// F146: `params.auto` (Sources' Add filling its field by itself) lets the sideload build skip the read when iOS says
// no URL was copied or the user refused Allow Paste before; without it (a tap on Paste) it always reads.
export async function nativePaste(native = nativeBridge(), params = {}) {
  if (!native?.call) return null;
  try { return String((await native.call("clipboard.read", params)) ?? ""); } catch { return null; }
}

// B171: whether the app's clipboard holds a URL, asked without reading it (Bridge.swift clipboard.peek: hasURLs and
// detectPatterns, which never show iOS's Allow Paste). true/false, or null on the website or a shell from before
// clipboard.peek (unknown: callers then offer Paste as before).
export async function nativeHasUrl(native = nativeBridge()) {
  if (!native?.call) return null;
  try {
    const r = await native.call("clipboard.peek", {});
    return typeof r?.url === "boolean" ? r.url : null;
  } catch { return null; }
}

// A hold on `el` (or a descendant matching `selector`): HOLD_MS without moving more than HOLD_SLOP px. `onHold(target, e)`
// runs at the hold; the click that ends it is swallowed so the item doesn't open.
// B48: any scroll while the finger is down (the pane under it, listened for on the document since the pointermoves
// stop once iOS pans), or a pointercancel, ends the hold. Once it fired, the click ending that touch is swallowed
// wherever it lands (the menu or sheet the hold opened may sit under the finger), until a new touch starts.
export function longPress(el, selector, onHold, { doc = globalThis.document, hold = HOLD_MS } = {}) {
  let timer = 0, start = null, fired = false;
  const cancel = () => {
    clearTimeout(timer);
    if (start) doc?.removeEventListener?.("scroll", cancel, true);
    start = null;
  };
  el.addEventListener("pointerdown", (e) => {
    cancel();
    const target = e.target.closest(selector);
    fired = false;
    if (!target || !el.contains(target)) return;
    start = { x: e.clientX, y: e.clientY };
    doc?.addEventListener?.("scroll", cancel, true);
    timer = setTimeout(() => { cancel(); fired = true; swallowNextClick(doc); haptic(); onHold(target, e); }, hold);
  });
  el.addEventListener("pointermove", (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > HOLD_SLOP) cancel();
  });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("click", (e) => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
  el.addEventListener("contextmenu", (e) => { if (e.target.closest(selector)) e.preventDefault(); });
}

// F346: a hold on one button (the nav bar's Install): `onHold(button)` after HOLD_MS, the tap's click eaten, no
// callout. A tap still clicks. The pressed look while the finger is down is app.js's .is-pressed, as for any tap.
export function holdButton(button, onHold, opts = {}) {
  longPress(button, "button", (b) => onHold(b), opts);
}

// The touch that is down now has done its job (a hold): its click, wherever it lands, is eaten. A new touch (its
// pointerdown) or 2 s without a click ends this.
function swallowNextClick(doc) {
  if (!doc?.addEventListener) return;
  let timer = 0;
  const stop = () => {
    clearTimeout(timer);
    doc.removeEventListener("click", eat, true);
    doc.removeEventListener("pointerdown", stop, true);
  };
  const eat = (e) => { stop(); e.preventDefault(); e.stopPropagation(); };
  doc.addEventListener("click", eat, true);
  doc.addEventListener("pointerdown", stop, true);
  timer = setTimeout(stop, 2000);
}
