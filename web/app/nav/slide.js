// Sliding layout (user 2026-11-20: nothing teleports). When anything on a page grows, shrinks, appears or goes, the
// things around it slide to their new place, the way the screenshot gallery opens on an app's page (altstore.css
// .preview-slot): iOS 6's .3s ease. One watcher does it for every screen, so a screen only changes its DOM:
//
//   installSlides()            once, at start (nav/scroller.js initScroller): watches every slide root below
//   slideChange(node, change)  run change() now and slide what it moved at once (for code that measures right after)
//   stillChange(node, change)  run change() now and slide nothing (the caller animates it itself)
//   isWatched(node)            whether node sits in a watched root
//
// A slide root is a scroller whose content flows (ROOT: a page's .page-body, a sheet's body, the pinned Search
// results, an alert's scrim). After each change in one (a MutationObserver batch, or a ResizeObserver report: a row
// whose text wraps to a second line, a body shown with `hidden`), its block boxes are measured again and compared
// with the last measure, FLIP style:
//   - a box that moved starts at its old place (a translateY) and eases to the new one;
//   - a box that is new fades in where it is; a box that went fades out where it was (a copy, laid over the page);
//     a loading skeleton (.ph) goes at once, and a page still in its push slide fades nothing (B195);
//   - a screen that redraws its page whole (el.replaceChildren(page)) is matched to the old one by structure: the same
//     tag and first class among the same siblings, the same text first, so a redraw slides like an edit.
// Only transform and opacity animate (docs/native.md "Feel": 120 Hz); measuring reads layout once per change, never
// per frame. A box nested in a moving box moves by the difference, so the animations add up to the right place.
// Not slid: virtualised lists (.vlist: rows are recycled while scrolling), the install console (.progress-body),
// anything absolutely placed, inline, or animated by its own code, and anything marked data-noslide.

export { DURATION, EASE } from "./motion.js";      // .preview-slot's .3s and its curve (CSS `ease`, iOS 6's default)
import { DURATION, EASE } from "./motion.js";
const ROOT = ".page-body, .sheet-body, .sheet-scroll, .search-results, .alert-scrim";
const NOT_ROOT = ".progress-body";
const SKIP = ".vlist, .progress-body, .pull-clip, .scroll-indicator, [data-noslide], [data-slide-ghost]";
const LEAF = ".preview-slot, .ph";                 // measured as one box, not inside (the slot's content changes whole, faded in by altstore.js)
const STAND_IN = ".ph";                            // B195: a loading skeleton goes at once (no fading copy over the content it stood for)
const PUSHING = ".page.is-moving";                 // B195: a page in the navigation push (app.js)
const MAX_BOXES = 600;                            // a page with more boxes than this changes without sliding
const MAX_DEPTH = 8;
const FLOW = new Set(["block", "flex", "grid", "list-item", "flow-root", "table"]);
const NO_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "IMG", "SVG", "CANVAS", "VIDEO", "IFRAME", "INPUT", "TEXTAREA", "SELECT", "BR"]);

// ---- the curve -----------------------------------------------------------------------------------------------
// cubic-bezier(x1,y1,x2,y2) as a function of linear progress 0..1, to know where a running slide is now.
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (t) => ((ax * t + bx) * t + cx) * t;
  const y = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) { // Newton, then bisection if the slope is flat
      const e = x(t) - p;
      if (Math.abs(e) < 1e-6) return y(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = p;
    for (let i = 0; i < 30; i++) { const v = x(t); if (Math.abs(v - p) < 1e-6) break; if (v < p) lo = t; else hi = t; t = (lo + hi) / 2; }
    return y(t);
  };
}
export const ease = bezier(0.25, 0.1, 0.25, 1);

// ---- matching an old measure to a new one (pure) ---------------------------------------------------------------
// A measure is a tree of boxes: { el, key, text(), top, left, width, height, parent, kids, old }. `key` is the tag and
// first class ("LI.cell"); text() the first characters of its text.
//
// pairUp(olds, news): sets n.old on the new boxes of one level that stand for an old box of the same level. Boxes
// already paired (the same element) are anchors; between two anchors, the same key with the same text pairs first,
// then the same key alone, both in order. So a row whose text changed is still that row, and a row added between two
// others pairs with nothing (it fades in) instead of taking its neighbour's place.
export function pairUp(olds, news) {
  const at = new Map(olds.map((o, i) => [o, i]));
  const taken = new Set();
  let anchors = [];
  let last = -1;
  news.forEach((n, j) => {
    if (!n.old) return;
    taken.add(n.old);
    const i = at.get(n.old);
    if (i != null && i > last) { anchors.push([i, j]); last = i; }
  });
  const same = (o, n) => o.key === n.key && o.text() === n.text();
  const kin = (o, n) => o.key === n.key;
  for (const eq of [same, kin]) {
    const bounds = [[-1, -1], ...anchors, [olds.length, news.length]];
    const found = [];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const [i0, j0] = bounds[k];
      const [i1, j1] = bounds[k + 1];
      let p = i0 + 1;
      for (let j = j0 + 1; j < j1; j++) {
        const n = news[j];
        if (n.old) continue;
        for (let i = p; i < i1; i++) {
          const o = olds[i];
          if (taken.has(o) || !eq(o, n)) continue;
          n.old = o;
          taken.add(o);
          found.push([i, j]);
          p = i + 1;
          break;
        }
      }
    }
    anchors = [...anchors, ...found].sort((a, b) => a[1] - b[1]);
  }
}

// plan(prev, next, own): what to animate going from measure prev to measure next. prev/next: { kids, list } (list:
// every box, parents before children). own(el): how far el's running slide has it from its place now (px, 0 if none).
// Pairs the same elements first, then each level by pairUp. -> {
//   moves:  [{ box, from }]  every paired box: start `from` px from its place (relative to its moving parent box)
//   enters: [box]            new boxes whose parent stayed (or that sit at the top): fade in
//   leaves: [{ box, top }]   old boxes whose parent stayed: fade a copy out at `top` (where it showed)
// }
export function plan(prev, next, own = () => 0) {
  const byEl = new Map(prev.list.map((o) => [o.el, o]));
  for (const n of next.list) n.old = byEl.get(n.el) ?? null;
  const walk = (olds, news) => {
    pairUp(olds, news);
    for (const n of news) walk(n.old ? n.old.kids : [], n.kids);
  };
  walk(prev.kids, next.kids);

  const shown = new Map(); // old box -> where it showed: its place plus the running slides of it and its parents
  const shownAt = (o) => {
    if (shown.has(o)) return shown.get(o);
    const v = (o.parent ? shownAt(o.parent) - o.parent.top : 0) + o.top + own(o.el);
    shown.set(o, v);
    return v;
  };
  const paired = new Set();
  const moves = [], enters = [];
  const delta = new Map();
  for (const n of next.list) {
    const up = n.parent ? delta.get(n.parent) : 0;
    if (n.old) {
      paired.add(n.old);
      const d = shownAt(n.old) - n.top;
      delta.set(n, d);
      moves.push({ box: n, from: d - up });
    } else {
      delta.set(n, up);
      if (!n.parent || n.parent.old) enters.push(n);
    }
  }
  const leaves = [];
  for (const o of prev.list) {
    if (paired.has(o)) continue;
    if (!o.parent || paired.has(o.parent)) leaves.push({ box: o, top: shownAt(o) });
  }
  return { moves, enters, leaves };
}

// B195: which of plan()'s enters and leaves fade. A loading skeleton (.ph) is swapped for its content at once, both
// ways: a fading copy of it over the content is a half-faded skeleton, and content fading in where it went would
// blink the place empty first. A page in a navigation slide (`pushing`: app.js marks both pages .is-moving for a push,
// a pop and an edge swipe) fades nothing and takes its content at once, so the slide carries no half-faded layer.
export function fadesOf({ enters, leaves }, pushing = false) {
  if (pushing) return { enters: [], leaves: [] };
  const standIn = ({ box }) => Boolean(box.el?.matches?.(STAND_IN));
  if (leaves.some(standIn)) return { enters: [], leaves: leaves.filter((l) => !standIn(l)) };
  return { enters, leaves };
}

// ---- measuring (DOM) -------------------------------------------------------------------------------------------
function placeIn(el, root) {
  let x = 0, y = 0, n = el;
  while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
  if (n === root) return { x, y };
  // root isn't positioned: both from the page, less root's border
  let rx = 0, ry = 0;
  for (let r = root; r; r = r.offsetParent) { rx += r.offsetLeft; ry += r.offsetTop; }
  return { x: x - rx - (root.clientLeft || 0), y: y - ry - (root.clientTop || 0) };
}

const firstClass = (el) => String(el.getAttribute?.("class") ?? "").trim().split(/\s+/)[0] || "";

// The block boxes under root, as plan() wants them. null when there are too many to slide.
export function measure(root, cs = globalThis.getComputedStyle) {
  const list = [];
  const kids = [];
  let over = false;
  const walk = (el, parent, out, depth) => {
    for (const c of el.children) {
      if (over) return;
      if (NO_TAGS.has(String(c.tagName).toUpperCase())) continue;
      if (c.matches?.(SKIP) || (c.matches?.(ROOT) && !c.matches(NOT_ROOT))) continue;
      if (c.offsetParent === null) continue; // display: none (or fixed)
      const s = cs(c);
      if (!FLOW.has(s.display) || (s.position !== "static" && s.position !== "relative")) continue;
      if (list.length >= MAX_BOXES) { over = true; return; }
      const at = placeIn(c, root);
      let text;
      const box = {
        el: c, key: `${c.tagName}.${firstClass(c)}`, top: at.y, left: at.x, width: c.offsetWidth, height: c.offsetHeight,
        parent, kids: [], old: null,
        text: () => (text ??= String(c.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80)),
      };
      list.push(box);
      out.push(box);
      if (depth + 1 < MAX_DEPTH && !c.matches?.(LEAF)) walk(c, box, box.kids, depth + 1);
    }
  };
  walk(root, null, kids, 0);
  if (over) return null;
  return { list, kids, width: root.clientWidth };
}

// ---- the watcher -----------------------------------------------------------------------------------------------
const measures = new WeakMap();  // root -> its last measure
const slides = new WeakMap();    // el -> { anim, from } its running slide
const ours = new WeakSet();      // our Animation objects
const rootOf = new WeakMap();    // observed box -> its root
const firstSeen = new WeakMap(); // observed, its first ResizeObserver report not in yet -> its measured height
const live = new Set();          // roots with a measure
let ro = null;
// A box first measured inside a ResizeObserver report (a viewport resize, a rotation) is observed on the next frame:
// observed in the report, its first report would land shallower in the same broadcast and Chromium would raise
// "ResizeObserver loop completed with undelivered notifications".
let reporting = false;
const pending = new Set();       // boxes waiting for that frame
let flushQueued = false;
let installed = false;

const motionOk = () => !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  && globalThis.document?.visibilityState !== "hidden";

const own = (el) => {
  const s = slides.get(el);
  if (!s || s.anim.playState === "finished" || s.anim.playState === "idle") return 0;
  const t = Number(s.anim.currentTime) || 0;
  return s.from * (1 - ease(Math.min(1, t / DURATION)));
};

// Animated by someone else (a CSS transition, a screen's own fade), or placed by a transform of its own.
function busy(el, moving) {
  const foreign = el.getAnimations?.().some((a) => !ours.has(a));
  if (foreign) return true;
  if (moving && !slides.has(el)) {
    const t = globalThis.getComputedStyle?.(el).transform;
    if (t && t !== "none") return true;
  }
  return false;
}

function slideBox(el, from) {
  const s = slides.get(el);
  if (Math.abs(from) < 0.5) { if (s) { s.anim.cancel(); slides.delete(el); } return; }
  if (s && s.anim.playState === "running" && Math.abs(own(el) - from) < 0.5) return; // already on its way there
  if (busy(el, true)) return;
  s?.anim.cancel();
  const anim = el.animate([{ transform: `translateY(${from}px)` }, { transform: "none" }], { duration: DURATION, easing: EASE });
  ours.add(anim);
  const rec = { anim, from };
  slides.set(el, rec);
  anim.onfinish = anim.oncancel = () => { if (slides.get(el) === rec) slides.delete(el); };
}

function fadeIn(el) {
  if (busy(el, false)) return;
  ours.add(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: EASE }));
}

// A copy of a box that went, faded out where it showed. Its old parents go along as display: contents copies, so
// the stylesheet's rules for it (.table.grouped > .cell) still match.
function fadeOut(root, box, top) {
  const doc = root.ownerDocument;
  const ghost = doc.createElement("div");
  ghost.setAttribute("data-slide-ghost", "");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, { position: "absolute", left: `${box.left}px`, top: `${top}px`, width: `${box.width}px`,
    margin: "0", pointerEvents: "none" });
  let inner = ghost;
  const chain = [];
  for (let p = box.el.parentElement; p && p !== root && !p.matches?.(ROOT); p = p.parentElement) chain.unshift(p);
  for (const p of chain) {
    const c = p.cloneNode(false);
    c.removeAttribute?.("id");
    c.style.display = "contents";
    inner.append(c);
    inner = c;
  }
  const copy = box.el.cloneNode(true);
  copy.removeAttribute?.("id");
  Object.assign(copy.style, { margin: "0", width: "100%", boxSizing: "border-box", height: `${box.height}px` });
  inner.append(copy);
  root.append(ghost);
  const anim = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION, easing: EASE });
  ours.add(anim);
  const end = () => ghost.remove();
  anim.onfinish = end;
  anim.oncancel = end;
}

function flushPending() {
  flushQueued = false;
  for (const el of pending) if (rootOf.has(el) && el.isConnected !== false) ro.observe(el);
  pending.clear();
}

function unwatch(el) {
  pending.delete(el);
  rootOf.delete(el); // so it is observed again if it comes back
  firstSeen.delete(el);
  ro.unobserve(el);
}

function watchBoxes(root, prev, next) {
  if (!ro) return;
  const keep = new Set(next?.list.map((b) => b.el) ?? []);
  for (const b of prev?.list ?? []) if (!keep.has(b.el)) unwatch(b.el);
  for (const b of next?.list ?? []) {
    if (rootOf.get(b.el) === root) continue;
    rootOf.set(b.el, root);
    firstSeen.set(b.el, b.height);
    if (!reporting) { ro.observe(b.el); continue; }
    pending.add(b.el);
    if (flushQueued) continue;
    flushQueued = true;
    (globalThis.requestAnimationFrame ?? ((f) => setTimeout(f, 16)))(flushPending);
  }
}

// The first report of a box: skipped, unless it changed size since it was measured (a box observed a frame late).
function firstReport(e) {
  const h = firstSeen.get(e.target);
  firstSeen.delete(e.target);
  const now = e.borderBoxSize?.[0]?.blockSize;
  return typeof now === "number" && Math.abs(now - h) >= 1;
}

function forget(root) {
  const m = measures.get(root);
  if (ro) for (const b of m?.list ?? []) unwatch(b.el);
  measures.delete(root);
  live.delete(root);
}

// Measure root again and slide what moved since the last measure. still: only take the new measure.
function update(root, still = false) {
  if (!root?.isConnected) { forget(root); return; }
  const prev = measures.get(root);
  const next = measure(root);
  if (next) { measures.set(root, next); live.add(root); } else forget(root);
  watchBoxes(root, prev, next);
  if (!prev || !next || still || prev.width !== next.width || !motionOk()) return;
  if (globalThis.getComputedStyle?.(root).visibility === "hidden") return; // a covered page: nothing to see
  const { moves, enters, leaves } = plan(prev, next, own);
  // Only what can be seen: the root's window, with a screen's margin.
  const top = (root.scrollTop || 0) - root.clientHeight, bottom = (root.scrollTop || 0) + 2 * root.clientHeight;
  const seen = (y, h) => y + h > top && y < bottom;
  for (const { box, from } of moves) {
    if (seen(box.top, box.height) || seen(box.top + from, box.height) || slides.has(box.el)) slideBox(box.el, from);
  }
  const fades = fadesOf({ enters, leaves }, Boolean(root.closest?.(PUSHING)));
  for (const box of fades.enters) if (seen(box.top, box.height)) fadeIn(box.el);
  for (const { box, top: y } of fades.leaves) if (seen(y, box.height)) fadeOut(root, box, y);
}

const rootFor = (node) => {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  if (!el || el.closest?.(SKIP)) return null;
  const r = el.closest?.(ROOT);
  return r && !r.matches(NOT_ROOT) ? r : null;
};

export const isWatched = (node) => installed && Boolean(rootFor(node) && measures.has(rootFor(node)));

export function slideChange(node, change) {
  const root = installed ? rootFor(node) : null;
  if (root) update(root, !measures.has(root));
  change();
  if (root) update(root);
}

// The same change without a slide: whoever makes it moves things itself (F390, nav/tabswipe.js). What was pending
// before it still slides.
export function stillChange(node, change) {
  const root = installed ? rootFor(node) : null;
  if (root) update(root, !measures.has(root));
  change();
  if (root) update(root, true);
}

// A change of text alone (a ticking label, a count, a percentage): no box comes or goes, so nothing can move unless a
// box changes size, and every measured box is under the ResizeObserver, which reports exactly that. Measuring the
// whole root on every tick instead cost up to 600 boxes a frame (R44, journal/2026-11-20-r44-slide-watcher-trace).
const textOnly = (r) => Boolean(ro) && (r.type === "characterData"
  || (r.type === "childList" && [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 3)));

export function installSlides(doc = globalThis.document) {
  if (installed || !doc?.body || typeof MutationObserver !== "function" || typeof Element === "undefined"
    || typeof Element.prototype.animate !== "function") return false;
  installed = true;
  if (typeof ResizeObserver === "function") {
    ro = new ResizeObserver((entries) => {
      const roots = new Map(); // root -> still
      for (const e of entries) {
        const root = rootOf.get(e.target);
        if (!root) continue;
        if (firstSeen.has(e.target) && !firstReport(e)) continue;
        // A box in a CSS height transition reports every frame: follow it without sliding against it.
        const still = Boolean(e.target.getAnimations?.().some((a) => !ours.has(a)));
        roots.set(root, (roots.get(root) ?? still) && still);
      }
      reporting = true;
      try { for (const [root, still] of roots) update(root, still); } finally { reporting = false; }
    });
  }
  new MutationObserver((records) => {
    const roots = new Set();
    let gone = false;
    for (const r of records) {
      if (textOnly(r)) continue;
      const ghostOnly = [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 1 && n.hasAttribute("data-slide-ghost"));
      if (r.type === "childList" && ghostOnly) continue;
      if (r.removedNodes.length) gone = true;
      const root = rootFor(r.target);
      if (root) roots.add(root);
      for (const n of r.addedNodes) { // a page, sheet or alert built before it was put in: measure it as it starts
        if (n.nodeType !== 1 || n.closest?.(SKIP)) continue;
        if (n.matches?.(ROOT)) roots.add(n);
        for (const inner of n.querySelectorAll?.(ROOT) ?? []) roots.add(inner);
      }
    }
    if (gone) for (const root of [...live]) if (!root.isConnected) forget(root);
    for (const root of roots) if (!root.matches(NOT_ROOT)) update(root);
  }).observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
  return true;
}
