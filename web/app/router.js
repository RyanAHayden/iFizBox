// Client-side navigation: the route lives in the URL hash (`#/sources/…`), so changing screens never loads a
// page, and it works the same from the site and from the app bundle (file:// or a custom scheme). No DOM here:
// the router gets a window-like object, which keeps it testable under `node --test`.

export const ALL_TABS = ["home", "sources", "changes", "installed", "search", "settings"];
// The tabs this build shows: every build (site, jailbreak, sideload) shows every tab (user 2026-11-17).
export const TABS = ALL_TABS;
const DEFAULT_TAB = "home";
// F123: Settings is no tab of its own any more, as in Cydia: the tab bar shows the other five, and Settings' pages
// open on Home's stack (Home's Settings row), as #/home/settings/<…>. Its screen stays in TABS: it draws those pages.
export const BAR_TABS = TABS.filter((t) => t !== "settings");
const IN_HOME = "settings"; // Home's path segment that holds the Settings screen's pages
// The route to a Settings page (path below Settings' root): on Home's stack.
export const settingsRoute = (path = []) => ({ tab: "home", path: [IN_HOME, ...path] });
const inHome = (route) => route.tab === "home" && route.path[0] === IN_HOME;

// "#/sources/a%20b/c" -> { tab: "sources", path: ["a b", "c"] }. Anything unknown lands on the default tab.
export function parse(hash) {
  const parts = String(hash || "").replace(/^#/, "").split("/").filter(Boolean).map(safeDecode);
  const [tab, ...path] = parts;
  if (tab === IN_HOME) return settingsRoute(path); // links made before F123 (#/settings/signing) and format({ tab: "settings" })
  return TABS.includes(tab) ? { tab, path } : { tab: DEFAULT_TAB, path: [] };
}

export function format({ tab, path = [] }) {
  return "#/" + [tab, ...path].map(encodeURIComponent).join("/");
}

// The pages a route stands on, root first: ["a", "b"] -> [[], ["a"], ["a", "b"]]. Each one is a screen in its tab's
// navigation stack, so a deep link builds the whole stack and back walks it.
export function prefixes(path) {
  // A "~tab" segment only opens another tab's pages inside this one (see mounted): it is no page of its own, except
  // at the end of the route, where it stands for that tab's root page (B169: Home's What's New, #/home/~changes).
  return Array.from({ length: path.length + 1 }, (_, i) => path.slice(0, i))
    .filter((p) => p.length === path.length || !isMount(p.at(-1)));
}

// Another tab's pages opened inside this tab (user 2026-11-17: a link keeps the current page and slides the new one
// in; Back comes back): #/home/~installed/myipas is Installed's myipas page on Home's stack.
const MOUNT = "~";
const isMount = (seg) => typeof seg === "string" && seg.startsWith(MOUNT) && TABS.includes(seg.slice(1));
// B169: a tab's root page pushed on another tab's stack (Home's What's New tile: Changes slides in, Back returns), for
// links that open a page; a plain format({ tab }) link switches tabs without a slide, like the tab bar. `on` is the
// route the link sits on (Home's root by default).
export const rootOn = (tab, on = { tab: "home", path: [] }) => ({ tab: on.tab, path: [...on.path, MOUNT + tab] });
// The screen a route shows: its innermost "~tab" and the path after it, or the route itself; Home's settings/… is
// the Settings screen's (F123).
export function mounted(route) {
  let r = route;
  for (let i = route.path.length - 1; i >= 0; i--) {
    if (isMount(route.path[i])) { r = { tab: route.path[i].slice(1), path: route.path.slice(i + 1) }; break; }
  }
  return inHome(r) ? { tab: IN_HOME, path: r.path.slice(1) } : r;
}
// A link from `from` to another tab's page, as a push on from's own stack: back to from's page, inside the same
// mount when from already shows that tab. Null when `to` stays in from's tab (or is a tab's root: a plain switch).
// A Settings page (Home's settings/…) linked from another tab mounts as "~settings"; Settings' root switches to Home.
// F143: a link that leaves the pages it is on for another branch of their tab (Manage's More Sources > a source,
// #/sources/manage/… -> #/sources/<key>) is a push too: it mounts the tab again on top (#/sources/manage/…/~sources/
// <key>), so Back returns to Manage instead of the tab's root (or Home, when Manage is mounted there). The innermost
// mount is the one a link stays in. A link up to a page the route stands on stays a pop.
// B300: a link from another tab's pages mounted on a tab (Home's Install IPAs tile, #/home/~installed/myipas) to a page
// of that tab's own that the route doesn't stand on is a push too, so it slides in: on Home a Settings page mounts as
// "~settings" (Install's Set Up Signing: #/home/~installed/myipas/~settings/signing; Settings' root as a final
// "~settings"), any other page as "~<tab>" again. Left as a plain route, the stack swapped the mounted page for the new
// one without a slide.
export function mountLink(from, to) {
  if (from && from.tab !== "home" && inHome(to)) to = { tab: IN_HOME, path: to.path.slice(1) };
  else if (from && from.path.some(isMount) && inHome(to)) {
    to = { tab: IN_HOME, path: to.path.slice(1) };
    if (!to.path.length) { // Settings' root: its own mount's root page, or that mount's (a pop when the route stands on it)
      const at = from.path.lastIndexOf(MOUNT + IN_HOME);
      return { tab: from.tab, path: [...(at >= 0 ? from.path.slice(0, at) : from.path), MOUNT + IN_HOME] };
    }
  }
  if (!from || !to.path.length) return null;
  if (to.tab === from.tab && to.path.length <= from.path.length && to.path.every((s, i) => s === from.path[i])) return null;
  const k = from.path.lastIndexOf(MOUNT + to.tab);
  if (to.tab === from.tab && k < 0 && from.path.some(isMount)) return { tab: from.tab, path: [...from.path, MOUNT + to.tab, ...to.path] };
  const inner = k >= 0 ? from.path.slice(k + 1) : to.tab === from.tab ? from.path : null;
  const branches = inner && inner.length && inner[0] !== to.path[0] && !inner.some(isMount);
  if (branches) return { tab: from.tab, path: [...from.path, MOUNT + to.tab, ...to.path] };
  if (to.tab === from.tab && k < 0) return null; // within the tab: a plain push, pop or sibling
  const base = k >= 0 ? from.path.slice(0, k) : from.path;
  return { tab: from.tab, path: [...base, MOUNT + to.tab, ...to.path] };
}

// The route one level up, or null at a tab's root.
export function parent(route) {
  if (!route.path.length) return null;
  const path = route.path.slice(0, -1);
  while (isMount(path.at(-1))) path.pop();
  return { tab: route.tab, path };
}

// F313: each tab's name in the tab bar and on its root page, here so the tab bar draws before the tabs' screens load
// (every screen's own `title` says the same: module-graph.test.js).
export const TAB_TITLES = { home: "Home", sources: "Sources", changes: "Changes", installed: "Installed", search: "Search", settings: "Settings" };

// F313: the modules lazy.js loads on demand that a route's pages draw with, for app.js to load before it shows the
// route (and ahead of a press on a link to it). By the screen each page belongs to (mounted), root first:
//   a tab other than Home and Settings: that tab's screen (it imports its own pages);
//   a Settings page: Settings' parts that only its pages draw;
//   Home's Browse and Wish List pages: Browse, Tweak Roulette and the featured lists.
// Home's root and its other pages draw with what app.js loads at startup. A page this misses is drawn again once its
// module is in (app.js), so the list only has to be right to keep a push's first frame drawn.
export const LAZY_TABS = ["sources", "changes", "installed", "search"];
export const SETTINGS_PARTS = ["account", "devaccount", "freeAppleId", "importlink", "signedApps", "websiteSettings",
  "pushSettings", "queue", "ipaInstall"];
export const BROWSE_PARTS = ["browse", "roulette", "extras"];
export function lazyFor(route) {
  const out = new Set();
  for (const path of prefixes(route.path)) {
    const r = mounted({ tab: route.tab, path });
    if (LAZY_TABS.includes(r.tab)) out.add(r.tab);
    else if (r.tab === IN_HOME) for (const n of SETTINGS_PARTS) out.add(n);
    else if (r.tab === "home" && (r.path[0] === "browse" || r.path[0] === "wishlist")) for (const n of BROWSE_PARTS) out.add(n);
    else if (r.tab === "home" && r.path[0] === "guides") out.add("guides"); // C32
  }
  return [...out];
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

const STEP = "ifizboxStep"; // history.state's key for an entry's step (createRouter)

// onRoute(route, previous) runs on start and on every change (links, back/forward, go(), selectTab()).
export function createRouter({ win, onRoute }) {
  let current = null;
  const lastPath = Object.fromEntries(TABS.map((t) => [t, []])); // each tab keeps its own stack, as on iOS

  const seen = []; // the hashes walked, to tell a back (to the one before) from a link
  let switching = false; // the tab bar's own switch: never a mounted link
  // B169: every history entry the router lands on carries its step in history.state ({ ifizboxStep: n }, rising), so
  // a back (or forward) to an entry it already saw is told from a new link by the entry itself. Comparing the hash
  // with the one before took a link for a back when its text matched: Installed > Install IPAs, the Home tab, then
  // Home's Install IPAs tile (#/installed/myipas again) jumped to the Installed tab instead of sliding in on Home.
  // A window without history.state (tests' stubs) keeps that comparison.
  const tracks = Boolean(win.history) && "state" in win.history;
  let step = 0; // the step of the entry on screen
  let lastStep = 0; // the highest step handed out
  let replacing = false; // replace(): the same entry, another route
  const stepOf = () => {
    let s;
    try { s = win.history.state?.[STEP]; } catch { s = undefined; }
    return Number.isInteger(s) ? s : null;
  };
  function sync() {
    let route = parse(win.location.hash);
    const known = tracks && !replacing ? stepOf() : null; // a step: an entry walked to again; null: a new one
    const back = known != null ? Boolean(current) && known < step
      : (!tracks || replacing) && seen.length > 1 && seen.at(-2) === format(route);
    // An entry walked to again already holds the route the router gave it: only a new one can be a mounted link.
    const link = !switching && !back && known == null ? mountLink(current, route) : null;
    switching = false;
    if (link) route = link;
    const canonical = format(route);
    if (tracks) {
      const s = known ?? (replacing && step ? step : ++lastStep);
      lastStep = Math.max(lastStep, s);
      step = s;
      // Normalise without adding a history entry (e.g. "" or "#/bogus" -> "#/home"), and stamp the entry's step.
      if (win.location.hash !== canonical || known !== s) win.history.replaceState({ [STEP]: s }, "", canonical);
    } else {
      if (link) win.history.replaceState(null, "", canonical);
      // Normalise without adding a history entry (e.g. "" or "#/bogus" -> "#/home").
      if (win.location.hash !== canonical) win.history.replaceState(null, "", canonical);
    }
    if (current && format(current) === canonical) return;
    if (back) seen.pop(); else seen.push(canonical);
    if (seen.length > 200) seen.splice(0, seen.length - 200);
    const previous = current;
    current = route;
    lastPath[route.tab] = route.path;
    onRoute(route, previous);
  }

  return {
    start() { win.addEventListener("hashchange", sync); sync(); },
    stop() { win.removeEventListener("hashchange", sync); },
    current: () => current,
    go(route) {
      const hash = format(route);
      if (win.location.hash === hash) return;
      win.location.hash = hash; // fires hashchange -> sync
    },
    // Like go, but without a history entry (the back button on a deep link that has no history behind it).
    replace(route) {
      const hash = format(route);
      if (win.location.hash === hash) return;
      win.history.replaceState(null, "", hash);
      replacing = true;
      try { sync(); } finally { replacing = false; }
    },
    // Tab bar tap: switch to the tab where the user left it; tapping the tab you are on pops it to its root.
    selectTab(tab) {
      if (!TABS.includes(tab)) return;
      const path = current && current.tab === tab ? [] : lastPath[tab];
      // hashchange comes later: sync clears the flag (go does nothing when the hash is already there)
      switching = win.location.hash !== format({ tab, path });
      this.go({ tab, path });
    },
  };
}
