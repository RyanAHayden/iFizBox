import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadTweakSources, loadAppSources, tweakSourcesFrom, appSourcesFrom, normalizeSourceUrl, sourceKey, sourceIconUrls, displayName, sortSources, verifySource,
  refreshSource, releaseDepiction, openSourceStore, sourceCalls, SourceError, sourcesFor, sourceFilter,
} from "./sources.js";
import { createHttpBackend, BackendError } from "../backend-http.js";
import { createParser } from "./parser.js";
import { fakeIndexedDB } from "../fakes.test-helper.js";

const DEFAULT_SOURCES = await loadTweakSources(); // web/app/tweak-sources.json
const DEFAULT_ALT_SOURCES = await loadAppSources(); // web/app/app-sources.json
// Old rootful Cydia repos, no longer defaults: the dist-repo shapes some tests below need.
const [BIGBOSS, TELESPHOREO] = tweakSourcesFrom([
  { name: "BigBoss", uri: "http://apt.thebigboss.org/repofiles/cydia/", dist: "stable", components: ["main"] },
  { name: "Telesphoreo", uri: "http://apt.saurik.com/", dist: "ios/1800.00", components: ["main"] },
]);


// A backend whose repos are a map of URL -> body (string or Uint8Array). Missing URLs fail as the proxy does:
// "upstream" 404 for plain fetches, "not_found" when packages() finds no Packages file. `refuse` hosts fail
// with "refused", as the SSRF guard does for private addresses.
function fakeBackend(files = {}, { refuse = [] } = {}) {
  const calls = [];
  const guard = (url) => {
    if (refuse.some((h) => new URL(url).hostname === h)) {
      throw new BackendError("refused", `refused: ${new URL(url).hostname} is a private address`);
    }
  };
  const get = (url) => {
    calls.push(url);
    guard(url);
    if (!(url in files)) throw new BackendError("upstream", "upstream answered HTTP 404", 404);
    return files[url];
  };
  return {
    calls,
    async packages(dir) {
      calls.push("packages " + dir);
      guard(dir);
      for (const n of ["Packages.xz", "Packages.bz2", "Packages.gz", "Packages"]) {
        if (dir + n in files) return { text: files[dir + n], source: dir + n, cached: false };
      }
      throw new BackendError("not_found", "no Packages file");
    },
    text: async (url) => String(get(url)),
    fetch: async (url) => new Response(get(url)),
  };
}

const PACKAGES = [
  "Package: com.example.rootless\nArchitecture: iphoneos-arm64\nVersion: 1\n",
  "Package: com.example.rootful\nArchitecture: iphoneos-arm\nVersion: 1\n",
  "Package: com.example.theme\nArchitecture: all\nVersion: 1\n",
  "Package: com.example.both\nArchitecture: iphoneos-arm64\nVersion: 2\n",
].join("\n");

test("URL check: Cydia's rule, https:// added to a bare host, trailing slash added", () => {
  assert.equal(normalizeSourceUrl("https://repo.example.com"), "https://repo.example.com/");
  assert.equal(normalizeSourceUrl("  http://r.example/cydia/  "), "http://r.example/cydia/");
  assert.equal(normalizeSourceUrl("repo.chariz.com"), "https://repo.chariz.com/");
  for (const bad of ["", "   ", "ftp://r.example/", "file:///var/repo/", "https://r.example/a b/", "https://r.example/#x",
    "https://", "https://r.example/?q=1", "https://user:pw@r.example/", "javascript:alert(1)"]) {
    assert.throws(() => normalizeSourceUrl(bad), (e) => e instanceof SourceError && e.kind === "invalid_url" &&
      e.title === "Invalid URL", bad);
  }
});

test("add: a good flat repo is saved with its rootless package count and Release Origin", async () => {
  const b = fakeBackend({
    "https://repo.example.com/Packages.bz2": PACKAGES,
    "https://repo.example.com/Release": "Origin: Example Repo\nLabel: Example\nArchitectures: iphoneos-arm64 iphoneos-arm\n",
  });
  const s = await verifySource(b, "repo.example.com");
  assert.equal(s.key, "deb:https://repo.example.com/:./");
  assert.equal(s.uri, "https://repo.example.com/");
  assert.equal(s.dist, "./");
  assert.equal(s.count, 3); // two arm64 and one "all"; the rootful one is not ours
  assert.equal(s.origin, "Example Repo");
  assert.equal(displayName(s), "Example Repo");
  assert.equal((await verifySource(b, "https://repo.example.com/", { arch: "iphoneos-arm" })).count, 2);
});

test("add: the count can come from the worker parser", async () => {
  const b = fakeBackend({ "https://r.example/Packages": PACKAGES });
  const parser = createParser({ Worker: null });
  const s = await verifySource(b, "https://r.example/", { count: parser.count });
  assert.equal(s.count, 3);
  assert.equal(displayName(s), "r.example");
});

test("count: a package listed in several versions counts once, inline and in the worker parser (B366)", async () => {
  const multi = [
    "Package: com.a.tweak\nVersion: 1.0\nArchitecture: iphoneos-arm64\n",
    "Package: com.a.tweak\nVersion: 1.1\nArchitecture: iphoneos-arm64\n",
    "Package: com.a.tweak\nVersion: 1.2\nArchitecture: iphoneos-arm64\n",
    "Package: com.b.lib\nVersion: 2.0\nArchitecture: all\n",
    "Package: com.b.lib\nVersion: 2.1\nArchitecture: all\n",
    "Package: com.c.old\nVersion: 1.0\nArchitecture: iphoneos-arm\n",
    "Package: com.c.old\nVersion: 1.1\nArchitecture: iphoneos-arm\n",
  ].join("\n");
  const b = fakeBackend({ "https://m.example/Packages": multi });
  assert.equal((await verifySource(b, "https://m.example/")).count, 2);
  assert.equal((await verifySource(b, "https://m.example/", { arch: "iphoneos-arm" })).count, 2);
  const parser = createParser({ Worker: null });
  assert.equal((await verifySource(b, "https://m.example/", { count: parser.count })).count, 2);
  const d = fakeBackend({
    "https://d.example/dists/stable/Release": "Origin: D\nArchitectures: iphoneos-arm64\nComponents: main\n",
    "https://d.example/dists/stable/main/binary-iphoneos-arm64/Packages": multi,
  });
  const fresh = await refreshSource(d, { uri: "https://d.example/", dist: "stable", components: ["main"] });
  assert.equal(fresh.count, 2);
  assert.equal(fresh.countBy, "id");
  // a count stored before B366 counted stanzas: recounted even though the Release is the same
  const old = { uri: "https://d.example/", dist: "stable", components: ["main"], count: 5, releaseHash: fresh.releaseHash,
    countArch: fresh.countArch };
  const again = await refreshSource(d, old);
  assert.equal(again.count, 2);
  assert.equal(again.unchanged, undefined);
  assert.equal((await refreshSource(d, { ...old, count: 2, countBy: "id" })).unchanged, true);
  // a package two components carry counts once
  const two = fakeBackend({
    "https://t.example/dists/stable/Release": "Origin: T\nArchitectures: iphoneos-arm64\nComponents: main extra\n",
    "https://t.example/dists/stable/main/binary-iphoneos-arm64/Packages": multi,
    "https://t.example/dists/stable/extra/binary-iphoneos-arm64/Packages": multi + "\nPackage: com.d.new\nArchitecture: all\n",
  });
  assert.equal((await refreshSource(two, { uri: "https://t.example/", dist: "stable", components: ["main", "extra"] })).count, 3);
  // a refresh that fails saves no countBy
  const failed = await refreshSource(fakeBackend({}), { uri: "https://x.example/", dist: "stable", components: ["main"] });
  assert.ok(failed.error);
  assert.equal(failed.countBy, undefined);
});

test("add: repos Cydia's check misses (Release only, .zst only) still pass", async () => {
  const rel = await verifySource(fakeBackend({ "https://r.example/Release": "Origin: R\nSuite: stable\n" }), "https://r.example/");
  assert.equal(rel.count, null);
  const zst = fakeBackend({ "https://z.example/Packages.zst": new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 1, 2]) });
  assert.equal((await verifySource(zst, "https://z.example/")).count, null);
  // an HTML page served for every path is not a Release, and wrong magic is not a .zst
  const html = fakeBackend({ "https://h.example/Release": "<!doctype html><title>x</title>",
    "https://h.example/Packages.zst": new Uint8Array([60, 104, 116, 109]) });
  await assert.rejects(verifySource(html, "https://h.example/"), { kind: "not_repository" });
});

test("add: a URL that isn't a repo is 'Did Not Find Repository'", async () => {
  const b = fakeBackend({});
  await assert.rejects(verifySource(b, "https://example.org/"), (e) => e instanceof SourceError &&
    e.kind === "not_repository" && e.title === "Did Not Find Repository" && /legacy Installer/.test(e.message));
  assert.deepEqual(b.calls, ["packages https://example.org/", "https://example.org/Release",
    "https://example.org/InRelease", "https://example.org/Packages.zst", "https://example.org/Packages.lzma",
    "https://example.org/dists/stable/Release", "https://example.org/dists/stable/InRelease"]); // B261's BigBoss layout
});

test("add: a bad URL never reaches the backend", async () => {
  const b = fakeBackend({});
  await assert.rejects(verifySource(b, "ftp://r.example/"), { kind: "invalid_url" });
  await assert.rejects(verifySource(b, "not a url"), { kind: "invalid_url" });
  assert.deepEqual(b.calls, []);
});

test("add: refused by the proxy is a Verification Error with the proxy's reason, and stops at once", async () => {
  const b = fakeBackend({ "http://10.0.0.1/Packages": PACKAGES }, { refuse: ["10.0.0.1"] });
  await assert.rejects(verifySource(b, "http://10.0.0.1/"), (e) => e instanceof SourceError &&
    e.kind === "verification" && e.title === "Verification Error" && e.code === "refused" && /private/.test(e.message));
  assert.deepEqual(b.calls, ["packages http://10.0.0.1/"]);
});

test("add through the HTTP backend: the proxy's 403 refused reaches the alert; nothing is saved", async () => {
  const fetchFn = async (url) => {
    const u = new URL(url, "http://site.test");
    if (u.searchParams.get("url").startsWith("http://192.168.")) {
      return Response.json({ error: "refused: 192.168.1.1 is not a public address", code: "refused" }, { status: 403 });
    }
    if (u.searchParams.get("kind") === "packages") return new Response(PACKAGES);
    return Response.json({ error: "upstream answered HTTP 404", code: "upstream", status: 404 }, { status: 502 });
  };
  const b = createHttpBackend({ fetchFn, sourceOptions: { indexedDB: fakeIndexedDB() } });
  await assert.rejects(b.addSource("http://192.168.1.1/repo/"), { kind: "verification", code: "refused" });
  const before = await b.sources();
  assert.equal(before.length, DEFAULT_SOURCES.length + DEFAULT_ALT_SOURCES.length);
  const added = await b.addSource("https://good.example/");
  assert.equal(added.count, 3);
  const after = await b.sources();
  assert.equal(after.length, DEFAULT_SOURCES.length + DEFAULT_ALT_SOURCES.length + 1);
  assert.ok(after.some((s) => s.key === "deb:https://good.example/:./" && s.count === 3));
  await b.addSource("https://good.example");  // the same source again: updated, not doubled
  assert.equal((await b.sources()).length, DEFAULT_SOURCES.length + DEFAULT_ALT_SOURCES.length + 1);
});

test("store: seeded once with the defaults, sorted by name; deletes stick", async () => {
  const idb = fakeIndexedDB();
  let st = await openSourceStore({ indexedDB: idb });
  assert.deepEqual((await st.list()).map(displayName), ["Chariz", "Havoc", "Procursus"]);
  await st.remove(sourceKey({ uri: "https://havoc.app/", dist: "./" }));
  await st.put({ key: "deb:https://9.example/:./", uri: "https://9.example/", dist: "./", components: [] });
  st = await openSourceStore({ indexedDB: idb }); // reopen: the defaults don't come back
  assert.deepEqual((await st.list()).map(displayName), ["Chariz", "Procursus", "9.example"]);
  assert.equal(await st.update("deb:nope:./", { count: 1 }), undefined);
});

test("sorting: letters first, then without case or diacritics", () => {
  const s = (name) => ({ name, uri: "https://x/" });
  assert.deepEqual(sortSources([s("zeta"), s("_x"), s("Élan"), s("alpha"), s("2nd")]).map(displayName),
    ["alpha", "Élan", "zeta", "_x", "2nd"]);
});

test("icon URL: flat dir, or dists/<dist>/ for dist repos", () => {
  assert.equal(sourceIconUrls(DEFAULT_SOURCES.find((s) => s.name === "Chariz"))[0], "https://repo.chariz.com/CydiaIcon.png");
  assert.equal(sourceIconUrls(BIGBOSS)[0],
    "http://apt.thebigboss.org/repofiles/cydia/dists/stable/CydiaIcon.png");
});

test("icon URLs: a dist repo tries dists/<dist>/, then the top level; a flat repo has one", () => {
  assert.deepEqual(sourceIconUrls(DEFAULT_SOURCES.find((s) => s.name === "Procursus")),
    ["https://apt.procurs.us/dists/1800/CydiaIcon.png", "https://apt.procurs.us/CydiaIcon.png"]);
  assert.deepEqual(sourceIconUrls(DEFAULT_SOURCES.find((s) => s.name === "Chariz")), ["https://repo.chariz.com/CydiaIcon.png"]);
  assert.deepEqual(sourceIconUrls({ uri: "http://cydia.akemi.ai/", dist: "./" }), ["http://cydia.akemi.ai/CydiaIcon.png"]);
  assert.deepEqual(sourceIconUrls({ uri: "https://r.example/repo/", dist: "sub/" }),
    ["https://r.example/repo/sub/CydiaIcon.png"]);
});

test("refresh: dist repo counts every component for our arch; rootful-only Release counts 0 without fetching", async () => {
  const bigboss = BIGBOSS;
  const base = "http://apt.thebigboss.org/repofiles/cydia/dists/stable/";
  const b = fakeBackend({
    [base + "Release"]: "Origin: BigBoss\nArchitectures: iphoneos-arm iphoneos-arm64\n",
    [base + "main/binary-iphoneos-arm64/Packages.bz2"]: PACKAGES,
  });
  const r = await refreshSource(b, bigboss);
  assert.equal(r.count, 3);
  assert.equal(r.error, null);

  const tele = TELESPHOREO;
  const t = fakeBackend({ "http://apt.saurik.com/dists/ios/1800.00/Release": "Origin: Telesphoreo\nArchitectures: darwin-arm iphoneos-arm\n" });
  assert.equal((await refreshSource(t, tele)).count, 0);
  assert.ok(!t.calls.some((c) => c.startsWith("packages")));

  const gone = await refreshSource(fakeBackend({}), { key: "k", uri: "https://gone.example/", dist: "./" });
  assert.equal(gone.count, undefined);
  assert.match(gone.error, /no Packages/);
});

test("refreshSources saves each source's count and reports it", async () => {
  const b = fakeBackend({ "https://repo.chariz.com/Packages.bz2": PACKAGES });
  const calls = sourceCalls(b, { indexedDB: fakeIndexedDB() });
  const seen = [];
  await calls.refreshSources((s) => seen.push(s.name));
  assert.equal(seen.length, DEFAULT_SOURCES.length);
  const list = await calls.sources();
  assert.equal(list.find((s) => s.name === "Chariz").count, 3);
  assert.ok(list.find((s) => s.name === "Havoc").error);
  await calls.removeSource(list[0].key);
  assert.equal((await calls.sources()).length, DEFAULT_SOURCES.length - 1);
});

test("F41: Refresh while Not Jailbroken fetches no APT source; a jailbroken type keeps them all", async () => {
  const b = fakeBackend({});
  const calls = sourceCalls(b, { indexedDB: fakeIndexedDB() });
  assert.deepEqual(await calls.refreshSources(() => {}, { filter: sourceFilter("none") }), []);
  assert.deepEqual(b.calls, []);
  assert.equal(sourceFilter("iphoneos-arm64"), null);
  assert.equal(sourceFilter("none")({ key: "alt:https://a.example/apps.json" }), true);
  assert.equal(sourceFilter("none")({ key: "deb:https://repo.example/:./" }), false);
});

test("Release Depiction: kept on the source by add and refresh, * becomes the package id, http(s) only", async () => {
  const flat = "https://repo.example/";
  const b = fakeBackend({
    [flat + "Packages"]: PACKAGES,
    [flat + "Release"]: "Origin: Example\nDepiction: https://repo.example/depiction/*.html?id=*\n",
  });
  const added = await verifySource(b, flat);
  assert.equal(added.depiction, "https://repo.example/depiction/*.html?id=*");
  assert.equal(releaseDepiction(added, "com.example.a"),
    "https://repo.example/depiction/com.example.a.html?id=com.example.a");

  const r = await refreshSource(b, added);
  assert.equal(r.depiction, added.depiction);

  // A Release without the field clears it; no Release at all (flat repo) leaves the stored one alone.
  const none = fakeBackend({ [flat + "Packages"]: PACKAGES, [flat + "Release"]: "Origin: Example\n" });
  assert.equal((await refreshSource(none, added)).depiction, null);
  const noRelease = fakeBackend({ [flat + "Packages"]: PACKAGES });
  assert.ok(!("depiction" in (await refreshSource(noRelease, added))));

  assert.equal(releaseDepiction({ depiction: "cydia://package/*" }, "x"), null);
  assert.equal(releaseDepiction({}, "x"), null);
  assert.equal(releaseDepiction(undefined, "x"), null);
});

test("F37: Not Jailbroken shows AltStore sources only; a jailbroken type shows them all", () => {
  const list = [{ key: "https://repo.chariz.com/|./" }, { key: "alt:https://apps.example/source.json" }, { key: "https://havoc.app/|./" }];
  assert.deepEqual(sourcesFor(list, "none"), { shown: [list[1]], hidden: 2 });
  assert.deepEqual(sourcesFor(list, "iphoneos-arm64"), { shown: list, hidden: 0 });
  assert.deepEqual(sourcesFor(list, "iphoneos-arm"), { shown: list, hidden: 0 });
  assert.deepEqual(sourcesFor(null, "none"), { shown: [], hidden: 0 });
});

// ---- F48: dist repos ----------------------------------------------------------------------------------------

test("add a dist repo: Release under dists/<suite>/, components counted, key deb:<uri>:<suite>", async () => {
  const base = "https://apt.example.com/dists/1800/";
  const b = fakeBackend({
    [base + "Release"]: "Origin: Example APT\nSuite: 1800\nComponents: main extra\nArchitectures: iphoneos-arm64\n",
    [base + "main/binary-iphoneos-arm64/Packages.xz"]: PACKAGES,
  });
  const s = await verifySource(b, { uri: "apt.example.com", dist: "1800", components: ["main"] });
  assert.equal(s.key, "deb:https://apt.example.com/:1800");
  assert.deepEqual([s.uri, s.dist, s.components], ["https://apt.example.com/", "1800", ["main"]]);
  assert.equal(s.count, 3);
  assert.equal(s.origin, "Example APT");
  assert.equal(s.error, undefined);
});

test("add a dist repo with no components: the Release's Components", async () => {
  const base = "https://apt.example.com/dists/stable/";
  const b = fakeBackend({
    [base + "InRelease"]: "Origin: X\nComponents: main\n",
    [base + "main/binary-iphoneos-arm64/Packages"]: PACKAGES,
  });
  const s = await verifySource(b, { uri: "https://apt.example.com/", dist: "stable", components: [] });
  assert.deepEqual(s.components, ["main"]);
  assert.equal(s.count, 3);
});

test("add a dist repo whose Release leaves our architecture out: added with count 0", async () => {
  const b = fakeBackend({ "http://apt.saurik.com/dists/ios/1800.00/Release": "Origin: Telesphoreo\nArchitectures: iphoneos-arm\nComponents: main\n" });
  const s = await verifySource(b, { uri: "http://apt.saurik.com/", dist: "ios/1800.00", components: ["main"] });
  assert.equal(s.count, 0);
  assert.equal(s.key, "deb:http://apt.saurik.com/:ios/1800.00");
});

test("add a dist repo: no Release, a wrong component, a bad suite, a flat dist", async () => {
  await assert.rejects(verifySource(fakeBackend({}), { uri: "https://r.example/", dist: "stable", components: ["main"] }),
    { kind: "not_repository" });
  const html = fakeBackend({ "https://r.example/dists/stable/Release": "<html>" });
  await assert.rejects(verifySource(html, { uri: "https://r.example/", dist: "stable", components: ["main"] }), { kind: "not_repository" });
  const rel = fakeBackend({ "https://r.example/dists/stable/Release": "Origin: R\nComponents: main\n" });
  await assert.rejects(verifySource(rel, { uri: "https://r.example/", dist: "stable", components: ["nope"] }), { kind: "verification" });
  const none = fakeBackend({ "https://r.example/dists/stable/Release": "Origin: R\n" });
  await assert.rejects(verifySource(none, { uri: "https://r.example/", dist: "stable" }), { kind: "verification" });
  for (const dist of ["../x", "a b", "/abs", "stable/../.."]) {
    await assert.rejects(verifySource(rel, { uri: "https://r.example/", dist, components: ["main"] }), { kind: "invalid_url" }, dist);
  }
  await assert.rejects(verifySource(rel, { uri: "https://r.example/", dist: "stable", components: ["../main"] }), { kind: "invalid_url" });
  await assert.rejects(verifySource(rel, { uri: "ftp://r.example/", dist: "stable", components: ["main"] }), { kind: "invalid_url" });
  // "./" is a flat repo: the usual check
  const flat = fakeBackend({ "https://f.example/Packages": PACKAGES });
  assert.equal((await verifySource(flat, { uri: "https://f.example/", dist: "./", components: [] })).key, "deb:https://f.example/:./");
});

test("freshUrl: raw.githubusercontent.com gets a per-minute query, other hosts and queried URLs stay", async () => {
  const { freshUrl } = await import("./sources.js");
  assert.equal(freshUrl("https://raw.githubusercontent.com/o/r/main/source.json", 120000), "https://raw.githubusercontent.com/o/r/main/source.json?t=2");
  assert.equal(freshUrl("https://repo.example/"), "https://repo.example/");
  assert.equal(freshUrl("https://raw.githubusercontent.com/o/r/main/x.json?a=1"), "https://raw.githubusercontent.com/o/r/main/x.json?a=1");
});

test("F150: refreshSources starts no source once its signal is aborted (the reload bar's Cancel)", async () => {
  const b = fakeBackend({});
  const calls = sourceCalls(b, { indexedDB: fakeIndexedDB() });
  const seen = [];
  const out = await calls.refreshSources((s) => seen.push(s), { signal: { aborted: true } });
  assert.deepEqual(seen, []);
  assert.deepEqual(b.calls, [], "nothing fetched");
  assert.ok(out.every((x) => x === null));
});
