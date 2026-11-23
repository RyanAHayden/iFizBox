// F390: the panes under a segmented control (the Details / Reviews / Related tabs, screens/storepage.js storeTabs)
// slide sideways by themselves when a tab is tapped. (No swiping between them: F403.)
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   tabPager({ panes, mark, fill })   -> { select(i), selected(), attach(scroller) }: one control's panes
//
// At rest the chosen pane is in the page's flow and the others are hidden. While it moves, the chosen one stays in
// the flow (so the page's height is always its own) and the one beside it is absolutely placed over the same spot, both
// moved by transform alone. Layout is read when a slide begins and when a neighbour comes in, never per frame.
// The neighbour may be shorter than the page is scrolled: it is shown where it will be once chosen, and the page's
// scroll is set as it is chosen while the header above slides from where it was (FLIP), so nothing jumps.
import { bezier, stillChange } from "./slide.js";
import { DURATION, EASE } from "./motion.js";
import { EASE_OUT } from "./transition.js";

const CURVES = { [EASE]: bezier(.25, .1, .25, 1), [EASE_OUT]: bezier(.2, .8, .4, 1) };

const reduced = () => Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

export function tabPager({ panes, mark = () => {}, fill = () => {} }) {
  let now = 0;
  let scroller = null;
  let attached = false;
  const pos = new Map(); // pane index -> { x, y } where it shows, px from its place; empty at rest
  let headY = 0;         // the same for everything above the panes
  let run = null;        // the slide in progress: { steps: [{ set, from, to }], anims, easing, duration }

  const has = (j) => j >= 0 && j < panes.length;
  const transform = ({ x, y }) => `translate3d(${x}px,${y}px,0)`;
  const heads = () => { const out = []; for (const c of scroller.children) { if (c === panes[0]) break; out.push(c); } return out; };
  const live = () => Boolean(scroller && attached && panes[0].parentElement === scroller && scroller.isConnected);

  const paint = (j) => { panes[j].style.transform = transform(pos.get(j)); };
  function paintHead(y) {
    headY = y;
    for (const h of heads()) h.style.transform = y ? transform({ x: 0, y }) : "";
  }
  function clearStyle(j) {
    const s = panes[j].style;
    for (const k of ["position", "top", "left", "width", "height", "overflow", "pointerEvents", "transform", "willChange"]) s[k] = "";
  }
  // Out of the flow, over the chosen pane's spot and cut at the screen's bottom, so it never makes the page longer.
  function lift(j, box, y) {
    const s = panes[j].style;
    Object.assign(s, { position: "absolute", top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`,
      overflow: "hidden", pointerEvents: "none", willChange: "transform",
      height: `${Math.max(0, scroller.clientHeight - (box.top - scroller.scrollTop + y))}px` });
  }
  const boxNow = () => ({ top: panes[now].offsetTop, left: panes[now].offsetLeft, width: panes[now].offsetWidth });
  // The scroll the page would have with a pane `height` tall in the chosen one's place.
  function scrollWith(height) {
    const under = scroller.scrollHeight - panes[now].offsetTop - panes[now].offsetHeight;
    const most = Math.max(0, panes[now].offsetTop + height + under - scroller.clientHeight);
    return Math.min(scroller.scrollTop, most);
  }
  // Pane j comes in beside the chosen one, at the place it will have once chosen.
  function bringIn(j, x) {
    fill(j);
    const box = boxNow();
    const p = panes[j];
    Object.assign(p.style, { position: "absolute", top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, transform: transform({ x, y: 0 }) });
    p.hidden = false;
    const y = scroller.scrollTop - scrollWith(p.offsetHeight);
    lift(j, box, y);
    pos.set(j, { x, y });
    paint(j);
  }
  function putAway(j) {
    pos.delete(j);
    panes[j].hidden = true;
    clearStyle(j);
  }
  function rest() {
    for (const j of [...pos.keys()]) if (j !== now) putAway(j);
    pos.clear();
    clearStyle(now);
    if (headY) paintHead(0);
  }

  // ---- slides -------------------------------------------------------------------------------------------------
  const at = (s, p) => ({ x: s.from.x + (s.to.x - s.from.x) * p, y: s.from.y + (s.to.y - s.from.y) * p });
  function stop(p) { // the slide ends here, at progress p
    const r = run;
    run = null;
    r.anims[0].onfinish = r.anims[0].oncancel = null;
    for (const s of r.steps) s.set(at(s, p));
    for (const a of r.anims) a.cancel();
  }
  function finish() {
    if (!run) return;
    stop(1);
    rest();
  }
  // A finger or another tap takes over a slide where it is.
  function take() {
    if (!run) return;
    const t = Number(run.anims[0].currentTime) || 0;
    stop(CURVES[run.easing](Math.min(1, t / run.duration)));
  }
  // Every pane to its place beside the chosen one.
  function slideHome(width, { duration, easing }) {
    const steps = [];
    const anims = [];
    const step = (els, set, from, to) => {
      steps.push({ set, from, to });
      set(to); // inline, so there is nothing to hand over when the animations end
      for (const e of els) anims.push(e.animate([{ transform: transform(from) }, { transform: transform(to) }], { duration, easing }));
    };
    for (const [j, from] of [...pos]) step([panes[j]], (v) => { pos.set(j, v); paint(j); }, from, { x: (j - now) * width, y: j === now ? 0 : from.y });
    if (headY) step(heads(), (v) => paintHead(v.y), { x: 0, y: headY }, { x: 0, y: 0 });
    run = { steps, anims, easing, duration };
    const mine = run;
    anims[0].onfinish = anims[0].oncancel = () => { if (run === mine) finish(); };
  }

  // The panes swapped in the flow, the scroll set for the new one, and everything kept where it showed.
  function choose(j) {
    const old = now;
    const before = scroller.scrollTop;
    const box = boxNow();
    const to = scrollWith(naturalHeight(j));
    stillChange(panes[old], () => {
      now = j;
      clearStyle(j);
      lift(old, box, pos.get(old).y);
      scroller.scrollTop = to;
    });
    mark(j);
    const d = before - scroller.scrollTop;
    for (const [k, p] of pos) pos.set(k, { x: p.x, y: p.y - d });
    for (const [k, p] of pos) if (k !== j) lift(k, box, p.y);
    panes[j].style.willChange = "transform";
    for (const k of pos.keys()) paint(k);
    if (d || headY) paintHead(headY - d);
  }
  function naturalHeight(j) { // a lifted pane is cut at the screen's bottom
    const s = panes[j].style;
    const h = s.height;
    s.height = "";
    const full = panes[j].offsetHeight;
    s.height = h;
    return full;
  }
  function switchNow(j) { // no slide
    finish();
    fill(j);
    now = j;
    mark(j);
    panes.forEach((p, k) => { p.hidden = k !== j; });
  }

  function select(j) {
    if (!has(j)) return;
    if (j === now) { if (!run) switchNow(j); return; }
    if (!live() || reduced() || typeof panes[j].animate !== "function") { switchNow(j); return; }
    const from = now;
    take();
    const width = scroller.clientWidth;
    if (!pos.has(from)) pos.set(from, { x: 0, y: 0 });
    const x = pos.get(from).x;
    // Across two tabs the one between passes by.
    const dir = Math.sign(j - from);
    for (let k = from + dir; k !== j + dir; k += dir) if (!pos.has(k)) bringIn(k, x + (k - from) * width);
    choose(j);
    slideHome(width, { duration: DURATION, easing: EASE });
  }

  const api = {
    select, selected: () => now, live,
    attach(body) { scroller = body; attached = true; },
  };
  return api;
}
