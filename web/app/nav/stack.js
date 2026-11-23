// Per-tab navigation stacks, as UINavigationController keeps them: every tab holds the screens from its root to
// the one on top, so a push leaves the previous screen in place (for the slide and the edge-swipe back to reveal)
// and a pop removes only the top. No DOM here: `create(tab, path)` makes whatever a page is (a DOM element in the
// app, a plain object in tests), and sync() tells the caller what changed so it can animate and clean up.

import { prefixes } from "../router.js";

const isPrefix = (a, b) => a.length <= b.length && a.every((s, i) => s === b[i]);

export function createStacks({ tabs, create }) {
  const stacks = Object.fromEntries(tabs.map((t) => [t, []])); // entries: { tab, path, page, pushed }
  let activeTab = null;

  return {
    activeTab: () => activeTab,
    stack: (tab) => stacks[tab].slice(),
    // Where Back goes from the top: the entry below it (a jump's origin), else the route's parent.
    below: (tab = activeTab) => (tab && stacks[tab].length > 1 ? stacks[tab][stacks[tab].length - 2] : null),
    top: (tab = activeTab) => (tab && stacks[tab].length ? stacks[tab][stacks[tab].length - 1] : null),

    // Bring the stacks in line with a route. Returns
    //   { kind, tab, from, to, added, removed }
    // kind: "tab" (another tab came to the front, or the first route), "push" (one screen on top),
    // "pop" (one or more screens off the top), "replace" (anything else within the tab), "none".
    // from/to: the top entry before and after (from is null on the first route). removed: entries taken off,
    // top first; the caller removes their pages once any animation is done.
    // linked: the route came from a link, not from walking the history back (router.js linked).
    sync(route, { linked = false } = {}) {
      const stack = stacks[route.tab];
      const want = prefixes(route.path);
      const before = activeTab;
      const from = this.top();
      // Entries stay while they lead to the route. A jump may have left levels out, so match by prefix, not index.
      let keep = 0;
      while (keep < stack.length && isPrefix(stack[keep].path, route.path)) keep++;
      const removed = stack.splice(keep).reverse();
      const have = stack.length ? stack[stack.length - 1].path.length : -1;
      let levels = want.filter((p) => p.length > have);
      // A link that jumps several levels in the tab on screen (Home's Featured: Browse > Popular) adds only its
      // page, so Back returns to where the link was, as UINavigationController's pushViewController does. A deep
      // link or another tab's route still builds every level: there is no page it came from.
      if (before === route.tab && from && levels.length > 1) levels = levels.slice(-1);
      const added = [];
      for (const path of levels) {
        const entry = { tab: route.tab, path, page: create(route.tab, path), pushed: false };
        stack.push(entry);
        added.push(entry);
      }
      activeTab = route.tab;
      const to = this.top();
      let kind;
      if (before !== route.tab) kind = "tab";
      else if (!added.length && !removed.length) kind = "none";
      else if (added.length && !removed.length) kind = "push";
      else if (!added.length) kind = "pop";
      else kind = "replace";
      // A pushed entry has its parent right behind it in the browser history, so back can be history.back().
      // Switching tabs adds history entries in between, so after one no entry can trust history any more: the back
      // button then goes straight to the parent (Sources > BigBoss, Search, Sources, Back went to Search).
      if (kind === "push") to.pushed = added.length === 1;
      // A link up to a page below (B380) adds an entry too: the one right behind it is the page it left, not the parent.
      if (kind === "tab" || (kind === "pop" && linked)) for (const t of tabs) for (const e of stacks[t]) e.pushed = false;
      return { kind, tab: route.tab, from, to, added, removed };
    },
  };
}

// Edge-swipe back: does letting go here finish the pop? Past half the width, or flicked rightwards; a flick back
// to the left cancels even past half, as on iOS. dx in px, vx in px/ms, width in px.
export function swipeCommits(dx, vx, width) {
  if (vx > 0.3) return true;
  if (vx < -0.3) return false;
  return dx > width / 2;
}
