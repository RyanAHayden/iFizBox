import { test } from "node:test";
import assert from "node:assert/strict";
import { TABS, parse, format, createRouter, prefixes, parent } from "./router.js";
import { createStacks, swipeCommits } from "./nav/stack.js";

// A window-like stub: location.hash assignment fires hashchange synchronously, like a browser does (async there).
function fakeWindow(hash = "") {
  const listeners = new Set();
  const fire = () => listeners.forEach((f) => f());
  const location = {
    _hash: hash,
    get hash() { return this._hash; },
    set hash(h) { const n = h.startsWith("#") ? h : "#" + h; if (n !== this._hash) { this._hash = n; fire(); } },
  };
  return {
    location,
    replaces: 0,
    history: { replaceState(_s, _t, url) { location._hash = url; this.owner.replaces++; } },
    addEventListener(type, f) { if (type === "hashchange") listeners.add(f); },
    removeEventListener(type, f) { if (type === "hashchange") listeners.delete(f); },
    back(h) { location.hash = h; }, // what the back button amounts to
    init() { this.history.owner = this; return this; },
  }.init();
}

test("tabs are the five iOS 6 tabs in order, then Settings", () => {
  assert.deepEqual(TABS, ["home", "sources", "changes", "installed", "search", "settings"]);
});

test("F123: the tab bar is Cydia's five, Settings' pages are on Home's stack", async () => {
  const { BAR_TABS, settingsRoute, mounted, mountLink } = await import("./router.js");
  assert.deepEqual(BAR_TABS, ["home", "sources", "changes", "installed", "search"]);
  assert.deepEqual(settingsRoute(), { tab: "home", path: ["settings"] });
  assert.equal(format(settingsRoute(["signing"])), "#/home/settings/signing");
  // links made before (#/settings/…, format({ tab: "settings" })) land on Home's Settings
  assert.deepEqual(parse("#/settings"), { tab: "home", path: ["settings"] });
  assert.deepEqual(parse("#/settings/signing"), { tab: "home", path: ["settings", "signing"] });
  assert.deepEqual(parse(format({ tab: "settings", path: ["device"] })), settingsRoute(["device"]));
  // the Settings screen draws them: Home's settings/… and a ~settings mount
  assert.deepEqual(mounted(settingsRoute()), { tab: "settings", path: [] });
  assert.deepEqual(mounted(settingsRoute(["logs", "7"])), { tab: "settings", path: ["logs", "7"] });
  assert.deepEqual(mounted({ tab: "sources", path: ["pkg", "~settings", "iosVersion"] }), { tab: "settings", path: ["iosVersion"] });
  assert.deepEqual(prefixes(settingsRoute(["signing"]).path), [[], ["settings"], ["settings", "signing"]]);
  assert.deepEqual(parent(settingsRoute(["signing"])), settingsRoute());
  // from Home: a plain push; from another tab: a Settings page mounts there (Back returns), Settings' root goes Home
  assert.equal(mountLink({ tab: "home", path: [] }, settingsRoute(["signing"])), null);
  assert.deepEqual(mountLink({ tab: "sources", path: ["pkg"] }, settingsRoute(["iosVersion"])),
    { tab: "sources", path: ["pkg", "~settings", "iosVersion"] });
  assert.deepEqual(mountLink({ tab: "sources", path: ["pkg", "~settings", "logs"] }, settingsRoute(["logs", "7"])),
    { tab: "sources", path: ["pkg", "~settings", "logs", "7"] });
  // F143: a link to another branch of Settings is a push on top, so Back returns to the page it came from
  assert.deepEqual(mountLink({ tab: "sources", path: ["pkg", "~settings", "iosVersion"] }, settingsRoute(["device"])),
    { tab: "sources", path: ["pkg", "~settings", "iosVersion", "~settings", "device"] });
  assert.equal(mountLink({ tab: "sources", path: ["pkg"] }, settingsRoute()), null);
});

test("F123: the router walks Home > Settings > Signing, and an old #/settings link is rewritten in place", () => {
  const win = fakeWindow("#/settings/signing");
  const seen = [];
  const router = createRouter({ win, onRoute: (r) => seen.push(format(r)) });
  router.start();
  assert.equal(win.location.hash, "#/home/settings/signing");
  router.go({ tab: "home", path: [] });
  router.go({ tab: "home", path: ["settings"] });
  router.go({ tab: "settings", path: ["device"] }); // format({ tab: "settings" }): still Home's stack
  router.selectTab("search");
  router.go({ tab: "settings", path: ["iosVersion"] }); // from another tab: mounted there
  router.selectTab("settings"); // no such tab button any more; a stray call opens Home's Settings
  assert.deepEqual(seen, ["#/home/settings/signing", "#/home", "#/home/settings", "#/home/settings/device", "#/search",
    "#/search/~settings/iosVersion", "#/home/settings"]);
});

test("F123: the stacks hold only the tab-bar tabs; Settings pages build on Home's", async () => {
  const { BAR_TABS } = await import("./router.js");
  const win = fakeWindow("#/home");
  const stacks = createStacks({ tabs: BAR_TABS, create: (tab, path) => ({ tab, path }) });
  const results = [];
  const router = createRouter({ win, onRoute: (r) => results.push(stacks.sync(r)) });
  router.start();
  router.go({ tab: "home", path: ["settings"] });
  assert.equal(results.at(-1).kind, "push");
  router.go({ tab: "settings", path: ["signing"] });
  assert.equal(results.at(-1).kind, "push");
  assert.deepEqual(stacks.stack("home").map((e) => e.path.join("/")), ["", "settings", "settings/signing"]);
});

test("parse and format", () => {
  assert.deepEqual(parse(""), { tab: "home", path: [] });
  assert.deepEqual(parse("#/"), { tab: "home", path: [] });
  assert.deepEqual(parse("#/bogus/x"), { tab: "home", path: [] });
  assert.deepEqual(parse("#/sources"), { tab: "sources", path: [] });
  assert.deepEqual(parse("#/sources/a%20b/c/"), { tab: "sources", path: ["a b", "c"] });
  assert.deepEqual(parse("#/search/%E0%A4%A"), { tab: "search", path: ["%E0%A4%A"] }); // bad escape kept as is
  assert.equal(format({ tab: "sources", path: ["https://repo.example/", "pkg"] }),
    "#/sources/https%3A%2F%2Frepo.example%2F/pkg");
  const r = { tab: "installed", path: ["a/b", "ü"] };
  assert.deepEqual(parse(format(r)), r);
});

test("start normalises the hash without a history entry and routes once", () => {
  const win = fakeWindow("");
  const seen = [];
  const router = createRouter({ win, onRoute: (r, prev) => seen.push([r, prev]) });
  router.start();
  assert.equal(win.location.hash, "#/home");
  assert.equal(win.replaces, 1);
  assert.deepEqual(seen, [[{ tab: "home", path: [] }, null]]);
});

test("go, back and repeated routes", () => {
  const win = fakeWindow("#/changes");
  const seen = [];
  const router = createRouter({ win, onRoute: (r) => seen.push(format(r)) });
  router.start();
  router.go({ tab: "sources", path: ["repo"] });
  router.go({ tab: "sources", path: ["repo"] }); // same route: nothing
  win.back("#/changes");
  // a link into another tab's page opens it on this tab's stack (user 2026-11-17); back returns here
  assert.deepEqual(seen, ["#/changes", "#/changes/~sources/repo", "#/changes"]);
  assert.deepEqual(router.current(), { tab: "changes", path: [] });
  router.stop();
  win.location.hash = "#/search";
  assert.equal(seen.length, 3);
});

test("selectTab restores each tab's place and pops the current tab to its root", () => {
  const win = fakeWindow("#/sources/repo/pkg");
  const seen = [];
  const router = createRouter({ win, onRoute: (r) => seen.push(format(r)) });
  router.start();
  router.selectTab("search");
  router.selectTab("sources");  // back where we left it
  router.selectTab("sources");  // tap again: root
  router.selectTab("nope");     // ignored
  assert.deepEqual(seen, ["#/sources/repo/pkg", "#/search", "#/sources/repo/pkg", "#/sources"]);
});

test("prefixes and parent", () => {
  assert.deepEqual(prefixes([]), [[]]);
  assert.deepEqual(prefixes(["a", "b"]), [[], ["a"], ["a", "b"]]);
  assert.deepEqual(parent({ tab: "sources", path: ["a", "b"] }), { tab: "sources", path: ["a"] });
  assert.equal(parent({ tab: "sources", path: [] }), null);
});

test("replace routes without a history entry", () => {
  const win = fakeWindow("#/sources/repo/pkg");
  const seen = [];
  const router = createRouter({ win, onRoute: (r) => seen.push(format(r)) });
  router.start();
  const before = win.replaces;
  router.replace({ tab: "sources", path: ["repo"] });
  router.replace({ tab: "sources", path: ["repo"] }); // same: nothing
  assert.equal(win.replaces, before + 1);
  assert.deepEqual(seen, ["#/sources/repo/pkg", "#/sources/repo"]);
});

// The navigation stack, driven by the router the way app.js drives it.
function stackHarness(hash) {
  const win = fakeWindow(hash);
  let made = 0;
  const stacks = createStacks({ tabs: TABS, create: (tab, path) => ({ id: ++made, tab, path }) });
  const results = [];
  const router = createRouter({ win, onRoute: (r) => results.push(stacks.sync(r)) });
  router.start();
  const paths = (tab) => stacks.stack(tab).map((e) => e.path.join("/"));
  return { win, router, stacks, results, last: () => results[results.length - 1], paths };
}

test("a deep link builds the whole stack", () => {
  const h = stackHarness("#/sources/repo/pkg");
  assert.equal(h.last().kind, "tab");
  assert.equal(h.last().from, null);
  assert.deepEqual(h.paths("sources"), ["", "repo", "repo/pkg"]);
  assert.equal(h.stacks.top().pushed, false); // nothing behind it in history: back must replace, not go back
});

test("push keeps the screen below; pop removes only the top", () => {
  const h = stackHarness("#/sources");
  const root = h.stacks.top();
  h.router.go({ tab: "sources", path: ["repo"] });
  let r = h.last();
  assert.equal(r.kind, "push");
  assert.equal(r.from, root);
  assert.deepEqual(r.to.path, ["repo"]);
  assert.equal(r.to.pushed, true);
  assert.deepEqual(h.paths("sources"), ["", "repo"]);
  h.router.go({ tab: "sources", path: ["repo", "pkg"] });
  const repo = h.stacks.stack("sources")[1];
  h.win.back("#/sources/repo");
  r = h.last();
  assert.equal(r.kind, "pop");
  assert.deepEqual(r.removed.map((e) => e.path), [["repo", "pkg"]]);
  assert.equal(r.to, repo); // the same page object: its DOM (and scroll position) survives the pop
  assert.deepEqual(h.paths("sources"), ["", "repo"]);
});

test("popping several levels at once, and replacing a sibling", () => {
  const h = stackHarness("#/sources/a/b/c");
  const root = h.stacks.stack("sources")[0];
  h.router.go({ tab: "sources", path: [] });
  let r = h.last();
  assert.equal(r.kind, "pop");
  assert.deepEqual(r.removed.map((e) => e.path.join("/")), ["a/b/c", "a/b", "a"]); // top first
  assert.equal(r.to, root);
  h.router.go({ tab: "sources", path: ["x", "y"] }); // a jump two levels down (Home's Featured): only its page
  assert.equal(h.last().kind, "push");
  assert.equal(h.last().to.pushed, true); // Back is history.back(), to the root it came from
  assert.deepEqual(h.paths("sources"), ["", "x/y"]);
  assert.equal(h.stacks.below(), root);
  h.router.go({ tab: "sources", path: ["x", "y", "p"] });
  assert.deepEqual(h.paths("sources"), ["", "x/y", "x/y/p"]);
  h.router.go({ tab: "sources", path: ["x", "z"] });
  r = h.last();
  assert.equal(r.kind, "replace");
  assert.deepEqual(r.removed.map((e) => e.path), [["x", "y", "p"], ["x", "y"]]);
  assert.deepEqual(r.added.map((e) => e.path), [["x", "z"]]);
  h.win.back("#/sources");
  assert.equal(h.last().kind, "pop");
  assert.deepEqual(h.paths("sources"), [""]);
});

test("switching tabs keeps both stacks and their pages", () => {
  const h = stackHarness("#/sources/repo");
  const sourcesPages = h.stacks.stack("sources").map((e) => e.page);
  h.router.selectTab("search");
  assert.equal(h.last().kind, "tab");
  h.router.go({ tab: "search", path: ["q"] });
  assert.equal(h.last().kind, "push");
  h.router.selectTab("sources");
  let r = h.last();
  assert.equal(r.kind, "tab");
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(h.stacks.stack("sources").map((e) => e.page), sourcesPages); // nothing rebuilt
  assert.deepEqual(h.paths("search"), ["", "q"]);
  h.router.selectTab("search"); // back to search where we left it
  assert.deepEqual(h.stacks.top().path, ["q"]);
  h.router.selectTab("search"); // tap again: pops to root
  r = h.last();
  assert.equal(r.kind, "pop");
  assert.deepEqual(h.paths("search"), [""]);
  assert.deepEqual(h.paths("sources"), ["", "repo"]);
});

test("edge swipe commits past half or on a rightward flick", () => {
  assert.equal(swipeCommits(100, 0, 390), false);
  assert.equal(swipeCommits(200, 0, 390), true);
  assert.equal(swipeCommits(40, 0.5, 390), true);   // flick
  assert.equal(swipeCommits(300, -0.5, 390), false); // flicked back
});

test("after a tab switch, Back goes to the parent, not back through history (Sources > BigBoss, Search, Sources, Back)", () => {
  const h = stackHarness("#/sources");
  h.router.go({ tab: "sources", path: ["bigboss"] });
  assert.equal(h.stacks.top().pushed, true); // right after the push, history.back() is the parent
  h.router.selectTab("search");
  h.router.selectTab("sources");
  assert.deepEqual(h.stacks.top().path, ["bigboss"]);
  assert.equal(h.stacks.top().pushed, false); // the entry behind is Search now: Back must replace with the parent
});

test("another tab's pages inside this one: mounted, prefixes and parent skip the mount, links stay inside it", async () => {
  const { mounted, mountLink, prefixes, parent } = await import("./router.js");
  const r = { tab: "home", path: ["~installed", "myipas", "apps"] };
  assert.deepEqual(mounted(r), { tab: "installed", path: ["myipas", "apps"] });
  assert.deepEqual(mounted({ tab: "home", path: ["browse"] }), { tab: "home", path: ["browse"] });
  assert.deepEqual(prefixes(r.path), [[], ["~installed", "myipas"], ["~installed", "myipas", "apps"]]);
  assert.deepEqual(parent({ tab: "home", path: ["~installed", "myipas"] }), { tab: "home", path: [] });
  // a link from inside the mount to that tab stays in the mount; from elsewhere it opens one
  assert.deepEqual(mountLink(r, { tab: "installed", path: ["myipas", "category:Games"] }),
    { tab: "home", path: ["~installed", "myipas", "category:Games"] });
  assert.deepEqual(mountLink({ tab: "changes", path: ["x"] }, { tab: "installed", path: ["myipas"] }),
    { tab: "changes", path: ["x", "~installed", "myipas"] });
  // B300: a page of the same tab that the route doesn't stand on pushes on top (it slides in), Back comes back here
  assert.deepEqual(mountLink(r, { tab: "home", path: ["about"] }), { tab: "home", path: ["~installed", "myipas", "apps", "~home", "about"] });
  assert.equal(mountLink(r, { tab: "sources", path: [] }), null); // a tab's root: a switch
});

// app.js goBack: history.back() when the top was pushed (the entry behind is the page below), else replace with it.
function pressBack(h) {
  const top = h.stacks.top();
  const below = h.stacks.below();
  const up = below ? { tab: below.tab, path: below.path } : parent({ tab: top.tab, path: top.path });
  if (top.pushed) h.win.back(format(up));
  else h.router.replace(up);
}

test("F143: Home > Manage > a source (More Sources) > Back is Manage, Back again is Home", async () => {
  const { mounted } = await import("./router.js");
  const h = stackHarness("#/home");
  h.win.location.hash = format({ tab: "sources", path: ["manage"] }); // Home's Recommended Sources row
  assert.equal(h.win.location.hash, "#/home/~sources/manage");
  h.win.location.hash = format({ tab: "sources", path: ["bigboss"] }); // a source in Manage's More Sources
  assert.equal(h.win.location.hash, "#/home/~sources/manage/~sources/bigboss");
  assert.deepEqual(mounted(h.router.current()), { tab: "sources", path: ["bigboss"] });
  assert.deepEqual(h.paths("home"), ["", "~sources/manage", "~sources/manage/~sources/bigboss"]);
  // inside the source, its own links stay in the inner mount
  h.win.location.hash = format({ tab: "sources", path: ["bigboss", "pkg"] });
  assert.equal(h.win.location.hash, "#/home/~sources/manage/~sources/bigboss/pkg");
  pressBack(h);
  assert.equal(h.win.location.hash, "#/home/~sources/manage/~sources/bigboss");
  pressBack(h);
  assert.equal(h.last().kind, "pop");
  assert.equal(h.win.location.hash, "#/home/~sources/manage");
  assert.deepEqual(h.paths("home"), ["", "~sources/manage"]);
  pressBack(h);
  assert.equal(h.win.location.hash, "#/home");
  assert.deepEqual(h.paths("home"), [""]);
});

test("F143: Sources > Manage > a source > Back is Manage, Back again is Sources; also from a deep link (no history)", async () => {
  const { mounted } = await import("./router.js");
  const h = stackHarness("#/sources");
  h.router.go({ tab: "sources", path: ["manage"] }); // the Manage button
  h.win.location.hash = format({ tab: "sources", path: ["bigboss"] });
  assert.equal(h.win.location.hash, "#/sources/manage/~sources/bigboss");
  assert.deepEqual(mounted(h.router.current()), { tab: "sources", path: ["bigboss"] });
  assert.deepEqual(h.paths("sources"), ["", "manage", "manage/~sources/bigboss"]);
  pressBack(h);
  assert.equal(h.win.location.hash, "#/sources/manage");
  pressBack(h);
  assert.equal(h.win.location.hash, "#/sources");

  // reloaded on the source (nothing behind in history): Back replaces, still to Manage, then Home
  const d = stackHarness("#/home/~sources/manage/~sources/bigboss");
  assert.deepEqual(d.paths("home"), ["", "~sources/manage", "~sources/manage/~sources/bigboss"]);
  pressBack(d);
  assert.equal(d.win.location.hash, "#/home/~sources/manage");
  pressBack(d);
  assert.equal(d.win.location.hash, "#/home");
});

test("F143: links within a branch of the tab stay plain pushes, pops and siblings", async () => {
  const { mountLink } = await import("./router.js");
  assert.equal(mountLink({ tab: "sources", path: [] }, { tab: "sources", path: ["bigboss"] }), null);
  assert.equal(mountLink({ tab: "sources", path: ["bigboss"] }, { tab: "sources", path: ["bigboss", "pkg"] }), null);
  assert.equal(mountLink({ tab: "sources", path: ["x", "y"] }, { tab: "sources", path: ["x", "z"] }), null);
  assert.equal(mountLink({ tab: "sources", path: ["manage", "io"] }, { tab: "sources", path: ["manage"] }), null);
  // Back's replace to the page below a nested mount is a pop, not another mount
  assert.equal(mountLink({ tab: "sources", path: ["manage", "~sources", "bigboss"] }, { tab: "sources", path: ["manage"] }), null);
  assert.equal(mountLink({ tab: "home", path: ["~sources", "manage", "~sources", "b"] }, { tab: "home", path: ["~sources", "manage"] }), null);
});
