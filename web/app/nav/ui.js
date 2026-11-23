// Table views as iOS 6 draws them (styles in ios6.css). Screens describe sections as data and get DOM back:
//
//   grouped([{ header, footer, rows: [{ label, detail, subtitle, href, onClick, chevron, checked, icon, cls }] }])
//   icon: { text, color, src } (src: a picture over the letter, dropped if it fails to load); cls: a class on the cell
//   plain([{ header, rows: [...] }])   white list, sticky gradient section headers
//
// A row with an href is a link (pushes when it points deeper into the tab); `chevron` defaults to on for links.
// All text goes in through textContent.
// `live`: () => detail (or a promise of it): the detail is filled from it now and again each time its page comes back
// into view (B148, nav/pagestate.js liveText), so a sub-page's change shows on the page below after Back.

import { liveText } from "./pagestate.js";
import { slideChange } from "./slide.js";
import { nativeBridge, hasNativeCall } from "../native.js";

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// The grey centred note a list shows in place of rows ("No packages.", a load error): ios6.css p.empty.
export const note = (text) => el("p", "empty", text);

// A navigation bar button (ios6.css .bar-button); cls adds a variant class.
export function barButton(label, cls = "") {
  const b = el("button", `bar-button${cls ? ` ${cls}` : ""}`, label);
  b.type = "button";
  return b;
}

function cell(row) {
  const li = el("li", "cell");
  if (row.cls) li.classList.add(row.cls);
  const inner = row.href || row.onClick ? el(row.href ? "a" : "button", "cell-inner") : el("div", "cell-inner");
  if (row.href) inner.href = row.href;
  if (row.onClick) { if (!row.href) inner.type = "button"; inner.addEventListener("click", row.onClick); }
  if (row.icon) {
    const icon = el("span", row.icon.cls ? `cell-icon ${row.icon.cls}` : "cell-icon", row.icon.text || "");
    // The row's own colour or gradient (data): ios6.css .cell-icon paints it through --cell-icon-tint.
    if (row.icon.color) icon.style.setProperty("--cell-icon-tint", row.icon.color);
    if (row.icon.src) {
      const img = el("img");
      img.alt = "";
      img.onload = () => img.classList.add("loaded");
      img.onerror = () => img.remove();
      img.src = row.icon.src;
      icon.append(img);
    }
    inner.append(icon);
  }
  const text = el("span", "cell-text");
  text.append(el("span", "cell-label", row.label));
  if (row.subtitle) text.append(el("span", "cell-subtitle", row.subtitle));
  inner.append(text);
  if (row.detail != null || row.live) {
    const detail = el("span", "cell-detail", row.detail ?? "");
    inner.append(detail);
    if (row.live) liveText(detail, row.live); // B148: follows its state each time its page comes back (nav/pagestate.js)
  }
  if (row.badge != null) inner.append(el("span", "cell-count", row.badge));
  if (row.checked) inner.append(el("span", "cell-check"));
  if (row.chevron ?? Boolean(row.href)) inner.classList.add("chevron");
  li.append(inner);
  return li;
}

export function grouped(sections) {
  const frag = document.createDocumentFragment();
  for (const s of sections) {
    const g = el("div", "group");
    if (s.header) g.append(el("h2", "group-header", s.header));
    if (s.rows && s.rows.length) {
      const ul = el("ul", "table grouped");
      for (const r of s.rows) ul.append(cell(r));
      g.append(ul);
    }
    if (s.footer) g.append(el("p", "group-footer", s.footer));
    frag.append(g);
  }
  return frag;
}

export function plain(sections) {
  const ul = el("ul", "table plain");
  for (const s of sections) {
    if (s.header) ul.append(el("li", "section-header", s.header));
    for (const r of s.rows || []) ul.append(cell(r));
  }
  return ul;
}

// UITableView's delete: the row goes and everything under it slides up into its place. nav/slide.js's watcher does
// the slide (and fades the row out as it goes), measured right around the removal.
export function collapse(li) {
  slideChange(li, () => li.remove());
}

// Placeholders while a page loads (user 2026-11-17: show loading as little as possible): the shape of what's coming
// with pulsing grey bars (ios6.css .ph-*), swapped for the real content in place, instead of a spinner.
//   placeholder("list")  rows like a package list: an icon box, a name bar and a description bar
//   placeholder("page")  a package or source page: a header card, then rows
export function placeholder(kind = "list", rows = kind === "list" ? 9 : 4) {
  const wrap = el("div", `ph ph-${kind}`);
  wrap.setAttribute("aria-busy", "true");
  wrap.setAttribute("aria-label", "Loading");
  if (kind === "page") {
    const head = el("div", "ph-head");
    head.append(el("span", "ph-box ph-icon-lg"), el("span", "ph-lines"));
    head.lastChild.append(el("span", "ph-bar ph-w60"), el("span", "ph-bar ph-w40"), el("span", "ph-bar ph-w30"));
    wrap.append(head);
  }
  const ul = el("ul", kind === "list" ? "table plain" : "table grouped");
  for (let i = 0; i < rows; i++) {
    const li = el("li", "cell");
    const inner = el("div", "cell-inner");
    if (kind === "list") inner.append(el("span", "ph-box ph-icon"));
    const lines = el("span", "ph-lines");
    lines.append(el("span", `ph-bar ${["ph-w50", "ph-w35", "ph-w60", "ph-w40"][i % 4]}`));
    if (kind === "list") lines.append(el("span", "ph-bar ph-sub ph-w70"));
    inner.append(lines);
    li.append(inner);
    ul.append(li);
  }
  wrap.append(ul);
  return wrap;
}

// F157: one grouped/plain cell on its own, for a screen that builds its own table (screens/guides.js).
export const row = (r) => cell(r);

// The blue scope bar's segmented control (packages.css .scope-segments): Search, Changes, Browse, Installed.
// labels -> onPick(value) when another is tapped. The returned element also carries:
//   seg.buttons        the segment buttons, in `values` order
//   seg.select(v)      mark v selected (null or a value not in the bar: none), without calling onPick
//   seg.show(shown)    hide the segments whose value isn't in `shown` (Search's Jailbroken-only Tweaks/Themes)
// A trailing button (Search's Filter) goes beside it in the scope row, not inside it.
export function segments(values, labels, current, onPick) {
  const seg = Object.assign(document.createElement("div"), { className: "scope-segments" });
  seg.setAttribute("role", "tablist");
  const select = (v) => buttons.forEach((o, i) => {
    const on = values[i] === v;
    o.classList.toggle("selected", on);
    o.setAttribute("aria-selected", String(on));
  });
  const buttons = values.map((v) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "scope-segment", textContent: labels[v] ?? v });
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => {
      if (b.classList.contains("selected")) return;
      select(v);
      onPick(v);
    });
    return b;
  });
  select(current);
  seg.append(...buttons);
  seg.buttons = buttons;
  seg.select = (v) => { select(v); scheduleSegmentsSync(); };
  seg.show = (shown) => { buttons.forEach((b, i) => { b.hidden = !shown.includes(values[i]); }); scheduleSegmentsSync(); };
  nativeSegments(seg, (i) => {
    const b = buttons[i];
    if (b && !b.classList.contains("selected")) { select(values[i]); onPick(values[i]); }
  });
  return seg;
}

// F345d: in the app under the iOS 26 style (<html data-style="ios26">), a scope bar pinned under the
// search bar (nav/searchbar.js pinned: inside .search-root, not in its .search-results scroller) is drawn by the
// shell as a real UISegmentedControl laid over this element's rect (bridge call ui.segments,
// native/Sources/NativeSegments.swift). The CSS bar stays in the page underneath, see-through while the native one
// shows, and is what shows whenever the native one can't: while a push or a sheet moves, while one of the page's own
// sheets, alerts or pages covers the bar, and on a shell without ui.segments (it stays the CSS bar from then on).
// A scope bar inside a scroller, the site and every other style keep the CSS bar. One watcher (scroll-free page
// changes, resizes, the keyboard) keeps every native bar's place, items and selection in step, once per frame.
let segmentKeys = 0;
const openSegments = new Set(); // bars the shell has open, to close the ones that left the page
let segmentsWatch = null;
let segmentsQueued = false;

function nativeSegments(seg, pick) {
  if (!hasNativeCall()) return;
  seg.dataset.nativeSegments = "";
  seg.nativeBar = { key: `scope-${++segmentKeys}`, pick, open: false, ready: false, failed: false, sent: null };
  watchSegments();
  scheduleSegmentsSync();
}

const POPUP = '[aria-modal="true"], [role="dialog"], [role="alertdialog"]'; // nav/popups.js POPUPS, inline (startup modules)

// What the native bar should show now, or null when it should be closed: { items, selected, rect, hidden }.
export function segmentsSnapshot(seg, doc = globalThis.document, win = globalThis) {
  if (doc?.documentElement?.getAttribute?.("data-style") !== "ios26") return null;
  if (!seg.isConnected || !seg.closest?.(".search-root") || seg.closest(".search-results")) return null;
  const shown = seg.buttons.map((b, i) => [b, i]).filter(([b]) => !b.hidden);
  const items = shown.map(([b]) => b.textContent);
  const selected = shown.findIndex(([b]) => b.classList.contains("selected"));
  const r = seg.getBoundingClientRect();
  const vv = win.visualViewport;
  const round = (n) => Math.round(n * 2) / 2;
  const rect = { x: round(r.left - (vv?.offsetLeft ?? 0)), y: round(r.top - (vv?.offsetTop ?? 0)), width: round(r.width), height: round(r.height) };
  const hidden = !items.length || r.width <= 0 || r.height <= 0 || popupUp(doc) || moving(seg, doc) || covered(seg, r, doc);
  return { items, selected, rect, hidden };
}

function popupUp(doc) {
  return [...(doc.querySelectorAll?.(POPUP) ?? [])].some((el) => !el.getClientRects || el.getClientRects().length > 0);
}

// The bar's page in flight (nav/transition.js runs Web Animations on transform for a push or pop; the edge swipe sets
// an inline transform on the page each frame): the native bar can't follow it, so the CSS bar shows meanwhile. Only
// a slide that moves the bar counts; one elsewhere that comes over it is caught by covered() or the popup check.
const sliding = (a, seg) => a.playState === "running" && a.effect?.getTiming?.().iterations !== Infinity &&
  a.effect?.target?.contains?.(seg) && (a.effect.getKeyframes?.() ?? []).some((k) => k.transform != null);
const awaited = new WeakSet(); // slides a re-check already waits on
function moving(seg, doc) {
  for (let p = seg; p && p !== doc.body; p = p.parentElement) if (p.style?.transform) return true;
  const anims = (doc.getAnimations?.() ?? []).filter((a) => sliding(a, seg));
  for (const a of anims) {
    if (awaited.has(a)) continue;
    awaited.add(a);
    Promise.resolve(a.finished).catch(() => {}).then(scheduleSegmentsSync);
  }
  return anims.length > 0;
}

// Something of the page's own over the bar (a pushed page, a sheet): the bar's middle and both ends hit-test elsewhere.
function covered(seg, r, doc) {
  if (!doc.elementFromPoint) return false;
  const y = r.top + r.height / 2;
  return [r.left + 6, r.left + r.width / 2, r.right - 6].some((x) => {
    const hit = doc.elementFromPoint(x, y);
    return !hit || !seg.contains(hit);
  });
}

// Brings every native bar in step with its element: opens, updates, hides and closes. Exported for the tests.
export function syncSegments(doc = globalThis.document, native = nativeBridge(), win = globalThis) {
  if (!hasNativeCall(native)) return;
  const live = new Set(doc?.querySelectorAll?.("[data-native-segments]") ?? []);
  for (const seg of [...openSegments]) if (!live.has(seg)) closeSegments(seg, native);
  for (const seg of live) {
    const st = seg.nativeBar;
    if (!st || st.failed || st.retryAt > Date.now()) continue;
    const snap = segmentsSnapshot(seg, doc, win);
    if (!snap) { if (st.open) closeSegments(seg, native); continue; }
    // While hidden its place doesn't matter: a slide moving it sends nothing until it shows again.
    const key = JSON.stringify(snap.hidden ? { ...snap, rect: null } : snap);
    if (key === st.sent) continue;
    const wasShown = st.sent && !JSON.parse(st.sent).hidden;
    st.sent = key;
    if (snap.hidden || !wasShown) seethrough(seg, false); // the CSS bar shows at once; the native one on its answer
    if (!st.open) {
      st.open = true;
      st.ready = false;
      openSegments.add(seg);
      native.call("ui.segments", { op: "open", key: st.key, ...snap }, (e) => {
        if (e?.ready) { st.ready = true; seethrough(seg, st.sent && !JSON.parse(st.sent).hidden); }
        else if (Number.isInteger(e?.pick) && st.sent) {
          const shown = seg.buttons.map((b, i) => [b, i]).filter(([b]) => !b.hidden);
          if (shown[e.pick]) st.pick(shown[e.pick][1]);
        }
      }).then(() => { /* closed */ }, (e) => {
        // An older shell ("unknown method ui.segments"): the CSS bar from now on. Anything else (no window while the
        // app is in the background): the CSS bar, and another try a second later at the next change.
        if (/unknown method/.test(e?.message ?? "")) st.failed = true;
        else st.retryAt = Date.now() + 1000;
        lost(seg);
      });
    } else {
      native.call("ui.segments", { op: "update", key: st.key, ...snap }).then(() => {
        if (st.sent === key && st.ready) seethrough(seg, !snap.hidden);
      }, () => { lost(seg); scheduleSegmentsSync(); }); // the shell no longer has it (a page load closed it): open again
    }
  }
}

// The shell's bar is gone without a close from here: forget it, so the next sync opens a new one.
function lost(seg) {
  const st = seg.nativeBar;
  st.open = false;
  st.ready = false;
  st.sent = null;
  openSegments.delete(seg);
  seethrough(seg, false);
}

function closeSegments(seg, native) {
  const st = seg.nativeBar;
  openSegments.delete(seg);
  seethrough(seg, false);
  if (!st?.open) return;
  st.open = false;
  st.ready = false;
  st.sent = null;
  native.call("ui.segments", { op: "close", key: st.key }).catch(() => {});
}

// The CSS bar under a native one that shows is see-through (it keeps its box, so its rect stays the native bar's).
function seethrough(seg, on) {
  if (seg.style) seg.style.opacity = on ? "0" : "";
}

export function scheduleSegmentsSync() {
  if (segmentsQueued || !openSegments.size && !segmentsWatch) return;
  segmentsQueued = true;
  const run = () => { segmentsQueued = false; syncSegments(); };
  if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(run);
  else setTimeout(run, 16);
}

// Page changes that can move or cover a bar: nodes added or removed and class/hidden/style/role changes anywhere but
// inside a scroller (a list's rows come and go as it scrolls), the hook itself, resizes (rotation) and the keyboard
// (the visual viewport).
function watchSegments(doc = globalThis.document, win = globalThis) {
  if (segmentsWatch || !doc?.body) return;
  const Observer = win.MutationObserver;
  segmentsWatch = true;
  if (typeof Observer === "function") {
    const inScroller = (n) => (n.nodeType === 1 ? n : n.parentElement)?.closest?.("[data-scroller]");
    const obs = new Observer((records) => { if (records.some((r) => !inScroller(r.target))) scheduleSegmentsSync(); });
    obs.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "style", "role", "aria-modal"] });
    obs.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-style"] });
    segmentsWatch = obs;
  }
  win.addEventListener?.("resize", scheduleSegmentsSync);
  win.visualViewport?.addEventListener?.("resize", scheduleSegmentsSync);
  win.visualViewport?.addEventListener?.("scroll", scheduleSegmentsSync);
}

// iOS 6's plain grey UISegmentedControl (ios6.css .store-segmented, sampled from the 4S's UISegmentButton art): the
// package page's Details / Reviews / Related, depiction tabs, Reviews' This Build | App Store, Settings' Mode, the
// guides. onSelect(i) on every tap; the caller calls mark(i) to move the selection (it may refuse the tap).
//   segmented(labels, { selected, onSelect }) -> { bar, buttons, mark }
export function segmented(labels, { selected = 0, onSelect = () => {} } = {}) {
  const bar = el("div", "store-segmented");
  bar.setAttribute("role", "tablist");
  const buttons = labels.map((label, i) => {
    const b = el("button", "store-segment", label);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => onSelect(i));
    bar.append(b);
    return b;
  });
  const mark = (i) => buttons.forEach((b, j) => {
    b.classList.toggle("selected", j === i);
    b.setAttribute("aria-selected", String(j === i));
  });
  mark(selected);
  return { bar, buttons, mark };
}
