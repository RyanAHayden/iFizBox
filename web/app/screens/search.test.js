import { test } from "node:test";
import assert from "node:assert/strict";
import { SCOPES, scopesFor, scopeIndex, sheetActive } from "./search.js";
import { searchFilters } from "./filterpanel.js";

test("F35: the scope bar's segments and what the catalog is asked", () => {
  assert.deepEqual(SCOPES, ["All", "Tweaks", "Themes", "Apps"]);
  assert.equal(searchFilters({ section: null, source: null, installed: null, price: null }), undefined, "no filters: the plain search");
  assert.deepEqual(searchFilters({ section: "group:Themes", source: null, installed: "not", price: "" }), { section: "group:Themes", installed: "not" });
  assert.equal(scopeIndex(null), 0);
  assert.equal(scopeIndex("group:Tweaks"), 1);
  assert.equal(scopeIndex("group:Apps"), 3);
  assert.equal(scopeIndex("group:Utilities"), -1, "a group only the sheet offers selects no segment");
  assert.equal(scopeIndex("Tweaks"), -1, "a section picked in the sheet selects no segment");
  assert.equal(sheetActive({ section: "group:Themes" }), false);
  assert.equal(sheetActive({ section: "Addons" }), true);
  assert.equal(sheetActive({ price: "paid" }), true);
});

test("F41: Not Jailbroken hides the Tweaks and Themes segments", () => {
  assert.deepEqual(scopesFor("none"), ["All", "Apps"]);
  assert.deepEqual(scopesFor("iphoneos-arm64"), SCOPES);
  assert.deepEqual(scopesFor("iphoneos-arm"), SCOPES);
});

test("F53: the Filter panel's Source rows follow the device type, by the Sources tab's names", async () => {
  const { sourceChoices } = await import("./filterpanel.js");
  const list = [
    { key: "apt:bigboss", uri: "http://apt.thebigboss.org/repofiles/cydia/", name: "BigBoss" },
    { key: "apt:chariz", uri: "https://repo.chariz.com/", origin: "Chariz" },
    { key: "alt:https://alt.crystall1ne.dev/", uri: "https://alt.crystall1ne.dev/", name: "crystall1ne.dev" },
    { key: "alt:https://raw.githubusercontent.com/chachillie/flycast/main/source.json",
      uri: "https://raw.githubusercontent.com/chachillie/flycast/main/source.json", name: "Flycast-iOS26" },
  ];
  const none = sourceChoices(list, "none");
  assert.deepEqual(none.map((o) => o.label), ["crystall1ne.dev", "Flycast-iOS26"], "Not Jailbroken: AltStore sources only, by name");
  assert.ok(none.every((o) => o.value.startsWith("alt:")));
  for (const type of ["iphoneos-arm64", "iphoneos-arm"]) {
    assert.deepEqual(sourceChoices(list, type).map((o) => o.label), ["BigBoss", "Chariz", "crystall1ne.dev", "Flycast-iOS26"], type);
  }
  assert.deepEqual(sourceChoices(list, "iphoneos-arm64", ["alt:https://alt.crystall1ne.dev/", "apt:chariz"]).map((o) => o.value)[0],
    "alt:https://alt.crystall1ne.dev/", "Manage > Sources' order");
  // Not loaded yet: the same fallback as the Sources tab (host, or GitHub user).
  assert.deepEqual(sourceChoices([{ key: "alt:https://alt.x.dev/a.json", uri: "https://alt.x.dev/a.json" }], "none").map((o) => o.label), ["alt.x.dev"]);
  assert.deepEqual(sourceChoices(null, "none"), []);
});

test("F100: Recent Searches: last 5, newest first, no duplicates, cleared, stored through core/settings.js", async () => {
  const { addRecent, RECENT_MAX, createSettings } = await import("../core/settings.js");
  const { recentRows } = await import("./search.js");
  assert.equal(RECENT_MAX, 5);
  assert.deepEqual(addRecent([], "  snowboard "), ["snowboard"], "trimmed");
  assert.deepEqual(addRecent(["a", "b"], ""), ["a", "b"], "an empty query saves nothing");
  assert.deepEqual(addRecent(["a", "Snowboard", "b"], "snowboard"), ["snowboard", "a", "b"], "a repeat moves to the top, once");
  assert.deepEqual(addRecent(["1", "2", "3", "4", "5"], "6"), ["6", "1", "2", "3", "4"], "only the last five");
  assert.deepEqual(addRecent("junk", "x"), ["x"], "a hand-edited value never breaks it");

  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const s = createSettings({ storage, mode: "site" });
  const heard = [];
  s.onChange((key, value) => heard.push([key, value]));
  assert.deepEqual(s.recentSearches.list(), []);
  for (const q of ["filza", "snowboard", "filza"]) s.recentSearches.add(q);
  assert.deepEqual(s.recentSearches.list(), ["filza", "snowboard"]);
  assert.equal(mem.get("ifizbox.recentSearches"), JSON.stringify(["filza", "snowboard"]), "kept under ifizbox.recentSearches");
  assert.deepEqual(createSettings({ storage, mode: "site" }).recentSearches.list(), ["filza", "snowboard"], "survives a reload");
  heard.length = 0;
  s.recentSearches.add("filza");
  assert.deepEqual(heard, [], "no change, no notification");
  s.recentSearches.clear();
  assert.deepEqual(s.recentSearches.list(), []);
  assert.deepEqual(heard, [["recentSearches", []]]);
  mem.set("ifizbox.recentSearches", "{not json");
  assert.deepEqual(s.recentSearches.list(), []);

  const picked = [];
  const rows = recentRows(["filza", "snowboard"], (q) => picked.push(q));
  assert.deepEqual(rows.map((r) => r.label), ["filza", "snowboard"]);
  rows[1].onClick();
  assert.deepEqual(picked, ["snowboard"], "a tap runs that query again");
  assert.deepEqual(recentRows(null, () => {}), []);
});

test("F99: Other Sources' Add Source & Install: add, refresh that source, open the page, queue; or say it isn't there", async () => {
  const { offerButtons, addSourceAndInstall } = await import("./extras.js");
  const row = { id: "com.ex.tweak", name: "Tweak", version: "1.0", depiction: "https://ex.test/d",
    repo: { uri: "https://repo.ex.test/", name: "Example Repo", flat: true, dist: "./" } };
  assert.deepEqual(offerButtons(row, { canQueue: true }), ["Cancel", "Add Source & Install", "Depiction"], "the jailbreak app");
  assert.deepEqual(offerButtons(row, { canQueue: false }), ["Cancel", "Add Source", "Depiction"], "site and sideload keep Add Source");
  assert.deepEqual(offerButtons({ ...row, depiction: null, repo: { ...row.repo, flat: false, dist: "stable" } }, { canQueue: true }),
    ["Cancel"], "a suite repo is still added from Sources > Edit");

  const KEY = "deb:https://repo.ex.test/:./";
  function setup({ listed = true, addError = null, key = KEY } = {}) {
    const log = [];
    const backend = {
      addSource: async (uri) => { log.push(["add", uri]); if (addError) throw addError; return key ? { key, uri } : undefined; },
      sources: async () => [{ key: "apt:other", uri: "https://other.test/" }, { key: KEY, uri: "https://REPO.ex.test" }],
      refreshSources: async (onEach, { filter }) => {
        log.push(["refresh", ["apt:other", KEY].filter((k) => filter({ key: k }))]);
      },
      queue: (job) => log.push(["queue", job]),
    };
    const catalog = {
      ensure: async () => { log.push(["ensure"]); },
      package: async (id, k) => (listed && id === row.id && k === KEY ? { key: KEY, stanza: { version: "1.1" }, row: { name: "Tweak!" } } : null),
    };
    const deps = {
      backend, catalog, go: (href) => log.push(["go", href]),
      showHUD: (label) => { log.push(["hud", label]); return () => log.push(["hide", label]); },
      showAlert: async (a) => { log.push(["alert", a.title, a.message]); return { index: 0 }; },
      banner: (b) => log.push(["banner", b]),
    };
    return { log, deps };
  }

  let { log, deps } = setup();
  assert.equal(await addSourceAndInstall(row, deps), "queued");
  assert.deepEqual(log.map((l) => l[0]), ["hud", "add", "hide", "hud", "refresh", "ensure", "hide", "go", "queue"]);
  assert.deepEqual(log[1], ["add", "https://repo.ex.test/"]);
  assert.deepEqual(log[4], ["refresh", [KEY]], "only the new source is refreshed");
  const { format } = await import("../router.js");
  assert.equal(log[7][1], format({ tab: "sources", path: [KEY, "package:com.ex.tweak"] }), "the package page opens");
  assert.deepEqual(log[8][1], { op: "install", id: "com.ex.tweak", version: "1.1", name: "Tweak!" }, "queued at the source's version");

  ({ log, deps } = setup({ key: null }));
  assert.equal(await addSourceAndInstall(row, deps), "queued", "no key from addSource: found among the sources by URI");
  assert.deepEqual(log.find((l) => l[0] === "refresh"), ["refresh", [KEY]]);

  ({ log, deps } = setup({ listed: false }));
  assert.equal(await addSourceAndInstall(row, deps), "missing");
  const said = log.find((l) => l[0] === "alert");
  assert.equal(said[1], "Not Found");
  assert.match(said[2], /Example Repo was added, but it doesn't list Tweak/);
  assert.ok(!log.some((l) => l[0] === "queue" || l[0] === "go"), "nothing opened or queued");

  ({ log, deps } = setup({ addError: Object.assign(new Error("Not a repository"), { title: "Verification Error" }) }));
  assert.equal(await addSourceAndInstall(row, deps), "error");
  assert.deepEqual(log.map((l) => l[0]), ["hud", "add", "hide", "alert"], "a refused source stops there, HUD gone");
});

test("B23: Add Source & Install goes on when apt-get update failed on another source; only its own failure stops it", async () => {
  const { addSourceAndInstall } = await import("./extras.js");
  const { format } = await import("../router.js");
  const row = { id: "com.ex.tweak", name: "Tweak", version: "1.0",
    repo: { uri: "https://repo.ex.test/", name: "Mineek's Repo", flat: true, dist: "./" } };
  const KEY = "deb:https://repo.ex.test/:./";
  const DEAD = { key: "deb:https://dead.example/repo/:./", uri: "https://dead.example/repo/", name: null,
    message: "apt-get update couldn't fetch Packages (525)" };
  function setup(failed) {
    const log = [];
    const deps = {
      backend: {
        addSource: async (uri) => ({ key: KEY, uri }),
        sources: async () => [],
        refreshSources: async () => {
          const mine = failed.find((f) => f.key === KEY);
          return Object.assign([{ key: KEY, error: mine?.message ?? null, aptError: mine?.message ?? null }], { failed });
        },
        queue: (job) => log.push(["queue", job.id]),
      },
      catalog: { ensure: async () => {}, package: async () => ({ key: KEY, stanza: { version: "1.0" } }) },
      go: (href) => log.push(["go", href]),
      showHUD: () => () => {},
      showAlert: async (a) => { log.push(["alert", a.title, a.message]); return { index: 0 }; },
      banner: (b) => log.push(["banner", b]),
      sold: () => false,
    };
    return { log, deps };
  }

  // The iPhone 7, 2026-11-18: the added repo refreshed fine, only the old dead.example/repo 525'd.
  let { log, deps } = setup([DEAD]);
  assert.equal(await addSourceAndInstall(row, deps), "queued");
  assert.ok(!log.some((l) => l[0] === "alert"), "no alert for another source's failure");
  const b = log.find((l) => l[0] === "banner")[1];
  assert.equal(b.title, "Source Failed to Refresh");
  assert.match(b.message, /dead\.example\/repo/);
  assert.ok(b.duration > 0, "goes away by itself");
  assert.deepEqual(log.filter((l) => l[0] !== "banner").map((l) => l[0]), ["go", "queue"]);
  b.onTap();
  assert.deepEqual(log.at(-1), ["go", format({ tab: "sources", path: [] })], "tapping it opens Sources");

  // The added source itself failed: the blocking alert, nothing queued, no banner.
  ({ log, deps } = setup([{ key: KEY, uri: row.repo.uri, name: "Mineek's Repo", message: "apt-get update couldn't fetch Packages (404 Not Found)" }, DEAD]));
  assert.equal(await addSourceAndInstall(row, deps), "error");
  assert.deepEqual(log.map((l) => l[0]), ["alert"]);
  assert.equal(log[0][2], "Mineek's Repo was added, but refreshing it failed: apt-get update couldn't fetch Packages (404 Not Found)");

  // Nothing failed: no banner.
  ({ log, deps } = setup([]));
  assert.equal(await addSourceAndInstall(row, deps), "queued");
  assert.ok(!log.some((l) => l[0] === "banner" || l[0] === "alert"));
});

test("B23: Sources' refresh names apt's failed sources in a banner, never an alert", async () => {
  const { bannerFailed } = await import("./sources.js");
  const { format } = await import("../router.js");
  const shown = [];
  const went = [];
  const opts = { banner: (b) => shown.push(b), go: (h) => went.push(h) };
  assert.equal(bannerFailed([], opts), false, "nothing failed");
  assert.equal(bannerFailed(undefined, opts), false, "the website's refresh has no `failed`");
  assert.equal(shown.length, 0);
  assert.equal(bannerFailed(Object.assign([], { failed: [{ key: "k", uri: "https://dead.example/repo/", name: "Old Repo", message: "x" }] }), opts), true);
  assert.equal(shown[0].message, "Old Repo: tap to see Sources.");
  shown[0].onTap();
  assert.deepEqual(went, [format({ tab: "sources", path: [] })]);
});

test("B33: Other Sources follows Show Incompatible, and the switch's setting runs the search again", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./search.js", import.meta.url), "utf8");
  assert.match(src, /discoveryGroup\(ctx, \{ hideIncompatible: compatFilterOn \}\)/);
  assert.match(src, /\["worksOnMyPhone",[^\]]*\]\.includes\(key\)/, "worksOnMyPhone changes rerun run(), which redraws Other Sources");
});
