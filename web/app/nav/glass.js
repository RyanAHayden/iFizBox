// F367/F369: the iOS 26 style's glass bars. In the app on iOS 26 and later, under the native controls hook
// (<html data-controls="native">, native-controls.js) with the floating tab bar (data-tabbar="float"), the shell
// draws the tab bar as a real UITabBar (one tab per page tab, Search as its search tab, our glyphs from
// icons/rowicons.js, the badges; iOS draws the glass, the press-and-drag lens and the shrink on scroll) and the nav
// bar's buttons as UIKit glass buttons at the rects of the page's own (bridge call ui.glass,
// native/Sources/NativeGlass.swift). The screens already scroll under both bars, so the glass refracts the page.
//
// The CSS bars stay in the page underneath. While the shell's bars are up, <html data-glass="native"> is set, and each
// look-alike the glass bars cover right now carries data-glass-shown, which ios26.css hides. Whenever the glass
// can't follow the page it hides and the look-alike shows at once: the buttons while their nav item slides (a push, a
// pop, the edge swipe), either part while a popup is up or one of the page's own sheets or pages covers it. A tap on
// the glass comes back as {tap} and clicks the look-alike, so tabs and buttons run their own handlers (a tab's
// reselect, Back, a button's action).
//
// No per-frame traffic: one watcher (page changes outside the scrollers, resizes, the theme) sends an update only when
// what the bars show changed, at most once a frame, and scrolling changes nothing. The site, every other style, phones
// below iOS 26 and a shell without ui.glass keep the CSS bars and send nothing more.

import { nativeBridge, hasNativeCall } from "../native.js";
import { icon } from "../icons/rowicons.js";
import { FLOAT_OWN_TAB } from "./tabbar.js";

export const GLASS_KEY = "bars";
const POPUP = '[aria-modal="true"], [role="dialog"], [role="alertdialog"]'; // nav/popups.js POPUPS, inline (startup modules)

const st = { open: false, ready: false, failed: false, retryAt: 0, sent: null, iconsSent: new Set(), byId: new Map() };
let ids = new WeakMap(); // a button element -> its id, kept while it lives
let nextId = 0;
let watching = false;
let queued = false;

// The hook's precondition: the app, the native controls (iOS 26+ under ios26) and the floating tab bar.
export function glassWanted(doc = globalThis.document, native = nativeBridge()) {
  const root = doc?.documentElement;
  return hasNativeCall(native) && root?.getAttribute?.("data-controls") === "native" && root.getAttribute("data-tabbar") === "float";
}

const round = (n) => Math.round(n * 2) / 2;
function rectOf(el, win) {
  const r = el.getBoundingClientRect();
  const vv = win.visualViewport;
  return { x: round(r.left - (vv?.offsetLeft ?? 0)), y: round(r.top - (vv?.offsetTop ?? 0)), width: round(r.width), height: round(r.height) };
}
const shows = (el) => !!el && !el.hidden && (!el.getClientRects || el.getClientRects().length > 0);

// ---- icons: the page's own CSS glyphs, drawn once into PNGs for the shell -----------------------------------------

const icons = new Map(); // key -> data URL, or null while it draws (or after it failed)
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h.toString(36); };
const urlOf = (v) => /^url\((['"]?)([\s\S]*)\1\)$/.exec(v?.trim() ?? "")?.[2]?.replace(/\\(["'])/g, "$1") ?? null;

// The glyph an element's ::before draws: its mask (a template the shell tints) or else its background image (drawn as
// is). null when it draws neither. Starts drawing the PNG the first time a glyph is seen.
export function iconOf(el, win = globalThis) {
  const cs = win.getComputedStyle?.(el, "::before");
  if (!cs) return null;
  const mask = cs.webkitMaskImage || cs.maskImage;
  const template = !!mask && mask !== "none";
  const src = urlOf(template ? mask : cs.backgroundImage);
  if (!src) return null;
  const host = el.getBoundingClientRect();
  const w = parseFloat(cs.width) || 0, h = parseFloat(cs.height) || 0;
  if (!(w > 0 && h > 0)) return null;
  // ::before has no rect of its own: centred in its element, as the bar buttons and tab glyphs lay it out
  const rect = { x: round(host.left + (host.width - w) / 2), y: round(host.top + (host.height - h) / 2), width: w, height: h };
  const size = /^([\d.]+)px ([\d.]+)px$/.exec((template ? cs.webkitMaskSize || cs.maskSize : cs.backgroundSize) ?? "");
  const fit = size ? [+size[1], +size[2]] : null;
  const key = hash(`${src}|${w}x${h}|${fit}|${template}`);
  if (!icons.has(key)) { icons.set(key, null); drawIcon(src, w, h, fit, win).then((d) => { icons.set(key, d); scheduleGlassSync(); }, () => {}); }
  return { key, rect, template };
}

function drawIcon(src, w, h, fit, win) {
  return new Promise((resolve, reject) => {
    const Img = win.Image;
    if (!Img || !win.document?.createElement) return reject(new Error("no canvas"));
    const img = new Img();
    img.onload = () => {
      try {
        const scale = win.devicePixelRatio || 3;
        const c = win.document.createElement("canvas");
        c.width = Math.ceil(w * scale);
        c.height = Math.ceil(h * scale);
        const g = c.getContext("2d");
        // contain (the tab glyphs' mask size) unless the CSS gives the glyph its own px size
        let [dw, dh] = fit ?? [w, h];
        if (!fit && img.naturalWidth && img.naturalHeight) {
          const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
          dw = img.naturalWidth * k; dh = img.naturalHeight * k;
        }
        g.drawImage(img, ((w - dw) / 2) * scale, ((h - dh) / 2) * scale, dw * scale, dh * scale);
        resolve(c.toDataURL("image/png"));
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = src;
  });
}

// ---- what the bars show ---------------------------------------------------------------------------------------------

function popupUp(doc) {
  return [...(doc.querySelectorAll?.(POPUP) ?? [])].some((el) => !el.getClientRects || el.getClientRects().length > 0);
}

// One of the page's own boxes over `el` at its middle: a sheet, a pushed page.
function covered(el, doc) {
  if (!doc.elementFromPoint) return false;
  const r = el.getBoundingClientRect();
  const hit = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !hit || !el.contains(hit);
}

// A slide moving `el` (nav/transition.js and the sheets run Web Animations on transform; the edge swipe and app.js mark
// the pair .is-moving and set inline transforms).
const awaited = new WeakSet();
const STILL = /^(|none|translate(X|Y|3d)?\(0(px)?(, ?0(px)?)*\))$/; // no inline transform, or one a slide left at rest
function moving(el, doc) {
  for (let p = el; p && p !== doc.body; p = p.parentElement) {
    if (STILL.test(p.style?.transform ?? "") === false || p.classList?.contains("is-moving")) return true;
  }
  const anims = (doc.getAnimations?.() ?? []).filter((a) => a.playState === "running" && a.effect?.getTiming?.().iterations !== Infinity &&
    a.effect?.target?.contains?.(el) && (a.effect.getKeyframes?.() ?? []).some((k) => k.transform != null));
  for (const a of anims) {
    if (awaited.has(a)) continue;
    awaited.add(a);
    Promise.resolve(a.finished).catch(() => {}).then(scheduleGlassSync);
  }
  return anims.length > 0;
}

const weightOf = (cs) => parseInt(cs?.fontWeight, 10) || (cs?.fontWeight === "bold" ? 700 : 400);

// F369: the tab bar as the shell's real UITabBar shows it: each tab's id, title, glyphs (icons/rowicons.js: the era's
// outline glyph, its filled one for the chosen tab), badge ("" for the refreshing spinner: a dot), and which tab is
// chosen. Search is the UITabBar's search tab. Hidden while a popup is up, one of the page's sheets covers the bar, or
// the page moves it (a card sheet scales the page behind it back, the tab bar too).
function tabbarSnapshot(doc, win, popup) {
  const bar = barOf(doc);
  if (!shows(bar)) return null;
  const style = doc.documentElement.getAttribute("data-style") || "ios26";
  const tabs = [...bar.querySelectorAll("a.tab")].filter((a) => !a.hidden);
  const items = tabs.map((a) => {
    const id = a.dataset.tab;
    const badge = a.querySelector(".badge");
    const title = (a.querySelector(".tab-label")?.textContent || a.getAttribute("aria-label")?.split(",")[0]
      || id.charAt(0).toUpperCase() + id.slice(1)).trim();
    return {
      id, title, selected: a.classList.contains("active"), search: id === FLOAT_OWN_TAB,
      icon: tabIcon(icon("tabsOutline", id, style), win), selectedIcon: tabIcon(icon("tabsSelected", id, style), win),
      badge: shows(badge) ? (badge.classList.contains("spinning") ? "" : badge.textContent) : null,
    };
  });
  return { hidden: popup || moving(bar, doc) || covered(bar, doc), items };
}

// One tab glyph (an SVG from icons/rowicons.js) drawn once into a TAB_ICON_PT square PNG for the shell: its key.
export const TAB_ICON_PT = 26;
function tabIcon(svg, win) {
  if (!svg) return null;
  const key = "tab-" + hash(svg);
  if (!icons.has(key)) {
    icons.set(key, null);
    const src = "data:image/svg+xml," + encodeURIComponent(svg);
    drawIcon(src, TAB_ICON_PT, TAB_ICON_PT, [TAB_ICON_PT, TAB_ICON_PT], win).then((d) => { icons.set(key, d); scheduleGlassSync(); }, () => {});
  }
  return key;
}

function buttonId(b) {
  let id = ids.get(b);
  if (!id) { id = `b${++nextId}`; ids.set(b, id); }
  return id;
}

function buttonsSnapshot(doc, win, popup) {
  const tops = [...(doc.querySelectorAll?.(".nav-stack.is-active > .nav-item.is-top") ?? [])];
  const item = tops.length === 1 ? tops[0] : null;
  const els = item ? [...item.querySelectorAll(".nav-left .bar-button, .nav-right .bar-button")].filter((b) => shows(b) && b.getBoundingClientRect().width > 0) : [];
  const buttons = els.map((b) => {
    const cs = win.getComputedStyle(b);
    const kind = b.classList.contains("back") ? "back" : b.classList.contains("done") ? "done" : "plain";
    const bg = cs.backgroundColor;
    return {
      id: buttonId(b), rect: rectOf(b, win), kind, title: b.classList.contains("bar-icon") ? "" : b.textContent.trim(),
      label: b.getAttribute("aria-label") ?? "", size: parseFloat(cs.fontSize) || 15, weight: weightOf(cs), color: cs.color,
      tint: kind === "done" && bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg) ? bg : null,
      disabled: b.disabled === true || b.getAttribute("aria-disabled") === "true",
      icon: b.classList.contains("bar-icon") ? iconOf(b, win) : null,
    };
  });
  const hidden = !item || popup || moving(item, doc) || els.some((b) => covered(b, doc));
  return { buttons, buttonsHidden: hidden, els };
}

function colorsOf(doc, win) {
  const bar = barOf(doc);
  const tabs = [...(bar?.querySelectorAll("a.tab") ?? [])];
  const plain = tabs.find((a) => !a.classList.contains("active"));
  const active = tabs.find((a) => a.classList.contains("active"));
  return {
    text: plain ? win.getComputedStyle(plain).color : null,
    active: active ? win.getComputedStyle(active).color : null,
  };
}

// What the glass should show now, or null when it should be closed. Exported for the tests.
export function glassSnapshot(doc = globalThis.document, win = globalThis, native = nativeBridge()) {
  if (!glassWanted(doc, native)) return null;
  const popup = popupUp(doc);
  const tabbar = tabbarSnapshot(doc, win, popup);
  const { buttons, buttonsHidden, els } = buttonsSnapshot(doc, win, popup);
  const root = doc.documentElement;
  const dark = root.getAttribute("data-theme") === "dark";
  return { snap: { scale: win.devicePixelRatio || 3, dark, colors: colorsOf(doc, win), tabbar, buttons, buttonsHidden }, els };
}

// ---- keeping the shell in step --------------------------------------------------------------------------------------

function pendingIcons(snap) {
  const keys = [...(snap.tabbar?.items ?? []).flatMap((i) => [i.icon, i.selectedIcon]), ...snap.buttons.map((b) => b.icon?.key)].filter(Boolean);
  const out = {};
  for (const k of keys) if (!st.iconsSent.has(k) && icons.get(k)) out[k] = icons.get(k);
  return out;
}

// The look-alikes the glass covers go see-through; the rest show. `parts` is null (glass down: every look-alike shows)
// or {tabbar, buttons: [el]}.
function seethrough(doc, parts) {
  const root = doc?.documentElement;
  if (!root) return;
  if (parts) root.setAttribute("data-glass", "native");
  else root.removeAttribute("data-glass");
  uncover(doc, parts ?? { tabbar: null, buttons: [] });
  if (parts) for (const el of [parts.tabbar, ...parts.buttons]) if (el && el.dataset.glassShown == null) el.dataset.glassShown = "";
  if (parts?.tabbar) inertTabs(parts.tabbar, true);
}

// Only takes data-glass-shown off what `parts` no longer holds: those look-alikes show at once.
function uncover(doc, parts) {
  const want = new Set([parts.tabbar, ...parts.buttons].filter(Boolean));
  for (const el of [...(doc.querySelectorAll?.("[data-glass-shown]") ?? [])]) {
    if (want.has(el)) continue;
    delete el.dataset.glassShown;
    inertTabs(el, false);
  }
}

// F369: the UITabBar isn't laid over the hidden look-alike's rects, so its tabs take no touches while it shows (the bar
// itself stays hit-testable: covered() reads it). Taps from the UITabBar still click them (tapped()).
function inertTabs(el, on) {
  for (const a of el.querySelectorAll?.("a.tab") ?? []) a.inert = on;
}

const barOf = (doc) => doc.getElementById?.("tabbar") ?? doc.querySelector?.(".tabbar");

function partsShown(snap, els, doc) {
  return { tabbar: snap.tabbar && !snap.tabbar.hidden ? barOf(doc) : null, buttons: snap.buttonsHidden ? [] : els };
}

// Brings the shell's glass in step with the page: opens, updates and closes it. Exported for the tests.
export function syncGlass(doc = globalThis.document, native = nativeBridge(), win = globalThis) {
  if (!hasNativeCall(native) || st.failed || st.retryAt > Date.now()) return;
  const got = glassSnapshot(doc, win, native);
  if (!got) { closeGlass(doc, native); return; }
  const { snap, els } = got;
  st.byId = new Map(els.map((b) => [ids.get(b), b]));
  const icons = pendingIcons(snap);
  const key = JSON.stringify(snap);
  if (key === st.sent && !Object.keys(icons).length) return;
  st.sent = key;
  for (const k of Object.keys(icons)) st.iconsSent.add(k);
  const parts = partsShown(snap, els, doc);
  uncover(doc, parts); // what the glass stops covering shows at once; what it starts covering waits for the answer
  const answered = () => { if (st.sent === key && st.ready) seethrough(doc, parts); };
  if (!st.open) {
    st.open = true;
    st.ready = false;
    native.call("ui.glass", { op: "open", key: GLASS_KEY, ...snap, icons }, (e) => {
      if (e?.ready) { st.ready = true; answered(); }
      else if (typeof e?.tap === "string") tapped(e.tap, doc);
    }).then(() => { /* closed */ }, (e) => {
      // A shell without ui.glass or a phone below iOS 26: the CSS bars from now on. Anything else (no window while the
      // app is in the background): the CSS bars, and another try a second later at the next change.
      if (/unknown method|unsupported/.test(e?.message ?? "") || e?.code === "unsupported") st.failed = true;
      else { st.retryAt = Date.now() + 1000; setTimeout(scheduleGlassSync, 1050); }
      lost(doc);
    });
  } else {
    native.call("ui.glass", { op: "update", key: GLASS_KEY, ...snap, icons }).then(answered, () => { lost(doc); scheduleGlassSync(); });
  }
}

// A tap on a glass bars' tab or button: the look-alike's own click, so its handlers run as for a finger on it (a tab
// through tapTab: switch, back to its root, or to the top). The tab bar has already moved its selection: the next
// sync sends the page's choice even when nothing changed here (a tab the page didn't switch to), so it goes back.
function tapped(id, doc) {
  const [kind, name] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
  const el = kind === "tab" ? [...(barOf(doc)?.querySelectorAll("a.tab") ?? [])].find((a) => a.dataset.tab === name) : st.byId.get(name);
  if (kind === "tab") { st.sent = null; scheduleGlassSync(); }
  el?.click?.();
}

// The shell's glass is gone without a close from here: forget it, so the next sync opens it again.
function lost(doc) {
  st.open = false;
  st.ready = false;
  st.sent = null;
  st.iconsSent.clear();
  seethrough(doc, null);
}

function closeGlass(doc, native) {
  const was = st.open;
  lost(doc);
  if (was) native.call("ui.glass", { op: "close", key: GLASS_KEY }).catch(() => {});
}

export function scheduleGlassSync() {
  if (queued || !watching) return;
  queued = true;
  const run = () => { queued = false; syncGlass(); };
  if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(run);
  else setTimeout(run, 16);
}

// Page changes that can change the bars: nodes and class/hidden/style/disabled/role changes outside the scrollers (a
// list's rows come and go as it scrolls; the large title's opacity is written each frame of a scroll), the hooks and
// theme on <html>, resizes, the keyboard and the system's light or dark. Started once, from nav/tabbar.js; it costs
// nothing where the shell takes no calls.
export function watchGlass(doc = globalThis.document, win = globalThis, native = nativeBridge()) {
  if (watching || !doc?.body || !hasNativeCall(native)) return;
  watching = true;
  const Observer = win.MutationObserver;
  if (typeof Observer === "function") {
    const quiet = (r) => {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!el?.closest) return false;
      if (el.closest(".page-body, [data-scroller]")) return true;
      // the large title's fade, and the edge swipe's per-frame transforms on a pair already marked .is-moving (its
      // class change, at the start and the end, is what hides and shows the buttons)
      return r.type === "attributes" && r.attributeName === "style" && !!el.matches?.(".nav-title, .large-title, .is-moving");
    };
    const obs = new Observer((records) => { if (records.some((r) => !quiet(r))) scheduleGlassSync(); });
    obs.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ["class", "hidden", "style", "role", "aria-modal", "disabled", "aria-label"] });
    obs.observe(doc.documentElement, { attributes: true, attributeFilter: ["class", "data-controls", "data-tabbar", "data-style", "data-theme", "data-palette"] });
  }
  win.addEventListener?.("resize", scheduleGlassSync);
  win.visualViewport?.addEventListener?.("resize", scheduleGlassSync);
  win.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", scheduleGlassSync);
  scheduleGlassSync();
}

// For the tests: forget everything between cases.
export function resetGlass() {
  Object.assign(st, { open: false, ready: false, failed: false, retryAt: 0, sent: null, byId: new Map() });
  st.iconsSent.clear();
  icons.clear();
  ids = new WeakMap();
  watching = false;
  queued = false;
}
