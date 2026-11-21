// Every page a link opens slides in as a push (user 2026-11-20): Home's Install IPAs and What's New tiles too, also
// right after a visit to the page they open in its own tab, which the router used to take for a Back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { format, createRouter, BAR_TABS, rootOn, mounted, prefixes, parent } from "./router.js";
import { createStacks } from "./nav/stack.js";
import { ipasTile, MORE_SOURCES_TILE } from "./screens/home.js";

// Changes as its root on Home's stack (rootOn), as Help and the guides link to a tab's root.
const CHANGES_HREF = format(rootOn("changes"));
const SOURCES_HREF = format(rootOn("sources"));

// A window-like stub with a browser-like history: location.hash adds an entry (state null), replaceState swaps the
// current one's hash and state, history.back() walks to the one before with its state. hashchange fires synchronously
// (async in a browser).
function fakeWindow(hash) {
  const listeners = new Set();
  const fire = () => listeners.forEach((f) => f());
  const entries = [{ hash, state: null }];
  let at = 0;
  const location = {
    get hash() { return entries[at].hash; },
    set hash(h) {
      const n = h.startsWith("#") ? h : "#" + h;
      if (n === entries[at].hash) return;
      entries.splice(at + 1, Infinity, { hash: n, state: null });
      at++;
      fire();
    },
  };
  return {
    location,
    history: {
      get state() { return entries[at].state; },
      replaceState(state, _t, url) { entries[at] = { hash: url, state: state == null ? null : structuredClone(state) }; },
      back() { if (at > 0) { at--; fire(); } },
      forward() { if (at < entries.length - 1) { at++; fire(); } },
    },
    addEventListener(type, f) { if (type === "hashchange") listeners.add(f); },
    removeEventListener(type, f) { if (type === "hashchange") listeners.delete(f); },
  };
}

function setup(start = "#/home") {
  const win = fakeWindow(start);
  const stacks = createStacks({ tabs: BAR_TABS, create: (tab, path) => ({ tab, path }) });
  const results = [];
  const router = createRouter({ win, onRoute: (r) => results.push(stacks.sync(r)) });
  router.start();
  // a tapped link: the browser sets the hash to the link's href
  const tap = (href) => { win.location.hash = href; return results.at(-1); };
  return { win, router, stacks, results, tap };
}

test("B169: Home's Install IPAs tile pushes the page onto Home's stack, and Back pops it", () => {
  const { win, tap, results } = setup();
  const r = tap(ipasTile().href);
  assert.equal(r.kind, "push");
  assert.equal(win.location.hash, "#/home/~installed/myipas");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home");
});

test("B169: Install IPAs from Home still pushes after a visit to Installed > Install IPAs (not taken for a Back)", () => {
  const { win, router, tap, results } = setup();
  router.selectTab("installed");
  router.go({ tab: "installed", path: ["myipas"] });
  router.selectTab("home");
  assert.equal(win.location.hash, "#/home");
  const r = tap(ipasTile().href); // the hash before Home's is #/installed/myipas: same text, but a new link
  assert.equal(r.kind, "push");
  assert.equal(r.tab, "home");
  assert.equal(win.location.hash, "#/home/~installed/myipas");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home");
});

test("B169: a link to Changes' root pushes it onto Home's stack, and Back pops it", () => {
  const { win, tap, results, stacks } = setup();
  assert.equal(CHANGES_HREF, "#/home/~changes");
  const r = tap(CHANGES_HREF);
  assert.equal(r.kind, "push");
  assert.equal(win.location.hash, "#/home/~changes");
  assert.deepEqual(r.to.page, { tab: "home", path: ["~changes"] });
  assert.deepEqual(mounted({ tab: "home", path: ["~changes"] }), { tab: "changes", path: [] }); // Changes draws it
  assert.deepEqual(stacks.stack("home").map((e) => e.path.join("/")), ["", "~changes"]);
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home");
});

test("B295: Home's More Sources tile pushes Sources > More onto Home's stack, and Back pops it", () => {
  const tile = MORE_SOURCES_TILE;
  const { win, tap, results, stacks } = setup();
  const r = tap(tile.href);
  assert.equal(r.kind, "push", tile.label);
  assert.equal(win.location.hash, "#/home/~sources/more");
  assert.deepEqual(mounted({ tab: "home", path: ["~sources", "more"] }), { tab: "sources", path: ["more"] });
  assert.deepEqual(stacks.stack("home").map((e) => e.path.join("/")), ["", "~sources/more"]);
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home");
});

test("B169: What's New pushes even right after a visit to the Changes tab, and a package from it pushes too", () => {
  const { win, router, tap, results } = setup();
  router.selectTab("changes");
  router.selectTab("home");
  const r = tap(CHANGES_HREF);
  assert.equal(r.kind, "push");
  assert.equal(win.location.hash, "#/home/~changes");
  // a Changes row links in Changes' own terms (#/changes/<pkg>): it stays on Home's stack, above Changes
  assert.equal(tap("#/changes/com.example.tweak").kind, "push");
  assert.equal(win.location.hash, "#/home/~changes/com.example.tweak");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home/~changes");
  win.history.forward(); // forward walks to an entry already seen: no new push, the page comes back
  assert.equal(results.at(-1).kind, "push");
  assert.equal(win.location.hash, "#/home/~changes/com.example.tweak");
});

test("B169: Help's Check for Changes pushes Changes above Help", () => {
  const { win, tap } = setup("#/home/help");
  assert.equal(tap(format(rootOn("changes", { tab: "home", path: ["help"] }))).kind, "push");
  assert.equal(win.location.hash, "#/home/help/~changes");
});

test("B169: a route ending in a mount is that tab's root page; one in the middle is no page", () => {
  assert.deepEqual(prefixes(["~changes"]), [[], ["~changes"]]);
  assert.deepEqual(prefixes(["~installed", "myipas"]), [[], ["~installed", "myipas"]]);
  assert.deepEqual(prefixes(["help", "~changes"]), [[], ["help"], ["help", "~changes"]]);
  assert.deepEqual(parent({ tab: "home", path: ["~changes"] }), { tab: "home", path: [] });
  assert.deepEqual(rootOn("changes"), { tab: "home", path: ["~changes"] });
});

test("B169: after a reload the entry's step is kept: Back from a later link is still a pop", () => {
  const { win, tap } = setup();
  tap(ipasTile().href);
  // a reload: a new router on the same history, whose entries already carry steps
  const stacks = createStacks({ tabs: BAR_TABS, create: (tab, path) => ({ tab, path }) });
  const results = [];
  const router = createRouter({ win, onRoute: (r) => results.push(stacks.sync(r)) });
  router.start();
  assert.equal(win.location.hash, "#/home/~installed/myipas");
  win.location.hash = "#/installed/myipas/ipa:x.ipa";
  assert.equal(results.at(-1).kind, "push");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home/~installed/myipas");
});

test("B169: replace (Back on a deep link with nothing behind) keeps the entry's step", () => {
  const { win, router, results } = setup("#/home/browse/new");
  router.replace({ tab: "home", path: ["browse"] });
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home/browse");
  assert.equal(win.history.state.ifizboxStep, 1);
});

test("B169: the tab bar still switches tabs (no push), and a tab's root stays where it is", () => {
  const { win, router, results } = setup();
  router.selectTab("changes");
  assert.equal(results.at(-1).kind, "tab");
  assert.equal(win.location.hash, "#/changes");
  router.selectTab("installed");
  assert.equal(results.at(-1).kind, "tab");
  assert.equal(win.location.hash, "#/installed");
  router.selectTab("home");
  assert.equal(results.at(-1).kind, "tab");
  assert.equal(format(router.current()), "#/home");
});

test("B169: a real Back (history.back to the entry before) is still a pop, not a new push", () => {
  const { win, router, results } = setup();
  router.go({ tab: "home", path: ["browse"] });
  assert.equal(results.at(-1).kind, "push");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home");
});

// B172: the other links that open a tab's root push it too: Help's Refresh Sources (Sources), Find Extensions for Applications (Search), the guides' Refresh Sources and Installed.
test("B172: Home's links to Sources and Search push that root onto Home's stack, and Back pops it", async () => {
  const { SEARCH_HREF } = await import("./screens/home.js");
  const cases = [
    [SOURCES_HREF, "#/home/~sources", "sources"],
    [SEARCH_HREF, "#/home/~search", "search"], // Find Extensions for Applications
  ];
  for (const [href, hash, tab] of cases) {
    const { win, router, tap, results } = setup();
    router.selectTab(tab); // a visit to the tab first: the link must still not be taken for a Back
    router.selectTab("home");
    assert.equal(href, hash);
    const r = tap(href);
    assert.equal(r.kind, "push", href);
    assert.equal(win.location.hash, hash);
    assert.deepEqual(mounted(router.current()), { tab, path: [] }); // that tab's screen draws it, at its root
    win.history.back();
    assert.equal(results.at(-1).kind, "pop");
    assert.equal(win.location.hash, "#/home");
  }
});

test("B172: Find Extensions is Home's row to Search's pushed root", async () => {
  const { homeLinks } = await import("./screens/home.js");
  const row = homeLinks().flatMap((g) => g.rows).find((r) => r.label === "Find Extensions for Applications");
  assert.equal(row.href, format(rootOn("search")));
});

test("B172: Help's Refresh Sources pushes Sources above Help", () => {
  assert.equal(format(rootOn("sources", { tab: "home", path: ["help"] })), "#/home/help/~sources"); // home.js renderHelp
  const { win, tap, results } = setup("#/home/help");
  assert.equal(tap("#/home/help/~sources").kind, "push");
  assert.equal(win.location.hash, "#/home/help/~sources");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home/help");
});

test("B172: the guides' Refresh Sources and Installed push those roots above the answer page", async () => {
  const guides = await import("./screens/guides.js");
  const on = { tab: "home", path: ["guides", "faq", "package"] };
  assert.equal(guides.linkRow("refresh", undefined, on).href, "#/home/guides/faq/package/~sources");
  assert.equal(guides.linkRow("installed", undefined, on).href, "#/home/guides/faq/package/~installed");
  assert.equal(guides.linkRow("refresh").href, "#/sources"); // with no page to sit on: a plain link to the tab
  for (const id of ["refresh", "installed"]) {
    const { win, router, tap, results } = setup("#/home/guides/faq/package");
    const href = guides.linkRow(id, undefined, on).href;
    assert.equal(tap(href).kind, "push", id);
    assert.equal(win.location.hash, href);
    assert.deepEqual(mounted(router.current()), { tab: id === "refresh" ? "sources" : "installed", path: [] });
    win.history.back();
    assert.equal(results.at(-1).kind, "pop");
    assert.equal(win.location.hash, "#/home/guides/faq/package");
  }
});

test("B172: a root copy only redraws when it is not the one holding the screen's state", async () => {
  const search = await import("./screens/search.js");
  assert.equal(search.showCopy({}), false); // never drawn by Search's render: nothing to resync
  // C25: Sources, Installed and Changes keep each copy's state on its own view (nav/pageviews.js): no copy to resync
  for (const f of ["sources", "installed", "changes"]) {
    const m = await import(`./screens/${f}.js`);
    assert.equal(m.redrawCopy, undefined, f);
  }
});
