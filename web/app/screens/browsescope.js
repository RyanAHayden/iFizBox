// Browse's own bar and its two lists' rows (F426d, browse.js renderBrowseHome): what New and Top 25 ask the catalog
// with the Filter panel's choices, and the slide as the Filter button comes and goes beside the segments.
import { DURATION, EASE } from "../nav/motion.js";
import { refineOptions } from "./listfilter.js";
import { searchFilters } from "./searchscope.js";

// New's rows: -> { rows(filters), total(), all() }. The list is asked for once; `all()` is it unfiltered.
export function newRows({ fresh, refine }) {
  let all = null;
  return {
    rows: async (f = {}) => {
      all ??= await fresh("new");
      const opts = refineOptions(f);
      return opts ? refine(all, opts) : all;
    },
    total: () => all?.length ?? 0,
    all: () => all ?? [],
  };
}

// Top 25's: the filters first, then the first `limit` in Popular's order, then the sort of those. Every package is
// asked for (once) only when a filter is on.
export function topRows({ popular, refine }, limit) {
  let all = null, total = 0;
  return {
    rows: async (f = {}) => {
      const filters = searchFilters(f);
      let rows;
      if (filters) {
        all ??= await popular({ limit: Number.MAX_SAFE_INTEGER });
        rows = await refine(all, filters);
        total = all.length;
      } else {
        rows = await popular({ limit });
        total = rows.length;
      }
      rows = rows.slice(0, limit);
      return f.sort ? refine(rows, { sort: f.sort }) : rows;
    },
    total: () => total,
  };
}

const still = () => Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

// Measures `bar` before it is swapped; call the answer with the bar in its place: the segments stretch from their old
// places, and the Filter button slides in from the right edge, or out to it.
export function slideBar(bar) {
  if (!bar?.isConnected || !bar.animate || still()) return () => {};
  const segs = (b) => [...b.querySelectorAll(".scope-segment")].map((el) => ({ el, r: el.getBoundingClientRect() }));
  const was = segs(bar), button = bar.querySelector(".scope-filter:not(.scope-ghost)");
  const gone = button && { el: button, r: button.getBoundingClientRect(), top: bar.getBoundingClientRect() };
  return (next) => {
    const timing = { duration: DURATION, easing: EASE };
    segs(next).forEach(({ el, r }, i) => {
      const from = was[i]?.r;
      if (!from?.width || !r.width || (from.left === r.left && from.width === r.width)) return;
      el.animate([{ transformOrigin: "0 0", transform: `translateX(${from.left - r.left}px) scaleX(${from.width / r.width})` },
        { transformOrigin: "0 0", transform: "none" }], timing);
    });
    const off = (r) => `translateX(${Math.max(0, next.getBoundingClientRect().right - r.left)}px)`;
    const now = next.querySelector(".scope-filter");
    if (now && !gone) now.animate([{ transform: off(now.getBoundingClientRect()) }, { transform: "none" }], timing);
    if (gone && !now) {
      const ghost = gone.el.cloneNode(true);
      ghost.setAttribute("aria-hidden", "true");
      ghost.tabIndex = -1;
      ghost.classList.add("scope-ghost");
      Object.assign(ghost.style, { left: `${gone.r.left - gone.top.left}px`, top: `${gone.r.top - gone.top.top}px` });
      next.append(ghost);
      const done = () => ghost.remove();
      ghost.animate([{ transform: "none" }, { transform: off(gone.r) }], { ...timing, fill: "forwards" }).finished.then(done, done);
    }
  };
}
