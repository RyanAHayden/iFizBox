import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync, zstdDecompressSync } from "node:zlib";
import { detect, unwrapLink, aptLayoutFromUrl, compressionOf, SourceFormatError, FORMATS } from "./detect.js";
import { parseIpaSource, ipaRows, toAltSource, isoDate, osRange } from "./ipa.js";
import { detectSource } from "./add.js";
import { parseControl, matchesArch } from "../apt.js";
import { SourceError } from "../sources.js";
import { BackendError } from "../../backend-http.js";

const FIX = new URL("../fixtures/sources/", import.meta.url);
const bytes = (name) => new Uint8Array(readFileSync(new URL(name, FIX)));
const text = (name) => readFileSync(new URL(name, FIX), "utf8");

// Every fixture, the URL it was fetched from (journal/2026-11-17-f16-source-formats), and the format it must detect as.
const IPA_FIXTURES = [
  ["altstore-classic.json", "https://apps.altstore.io/", "altstore"],
  ["sidestore-community.json", "https://community-apps.sidestore.io/sidecommunity.json", "altstore"],
  ["feather.json", "https://raw.githubusercontent.com/khcrysalis/Feather/main/app-repo.json", "altstore"],
  ["livecontainer.json", "https://github.com/LiveContainer/LiveContainer/releases/download/1.0/apps.json", "altstore"],
  ["stikstore.json", "https://stikdebug.xyz/index.json", "altstore"],
  ["trollapps-utm.json", "https://alt.getutm.app/", "altstore"],
  ["esign-zeeho.json", "https://zhb.xn--fiqz59cpva341l.top/app/version2.json", "esign"],
  ["scarlet-locus.json", "https://raw.githubusercontent.com/suprstarrd/locus-ios/main/scarlet.json", "scarlet"],
  ["scarlet-scylla.json", "https://puffer.is-a.dev/scylla-ios/cdn/repo.json", "scarlet"],
  ["gbox-qoli.json", "https://raw.githubusercontent.com/qoli/GboxApps/main/apps.json", "gbox"],
];

const PROCURSUS = "https://apt.procurs.us/dists/1800/";
const PKG_DIR = PROCURSUS + "main/binary-iphoneos-arm64/";
const CHARIZ = "https://repo.chariz.com/";

test("every IPA fixture detects to its format and parses into catalog rows", () => {
  for (const [file, url, format] of IPA_FIXTURES) {
    for (const body of [text(file), bytes(file)]) {
      const d = detect(url, body);
      assert.equal(d.format, format, file);
      assert.equal(d.kind, "ipa", file);
      assert.equal(d.parsable, true, file);
    }
    const parsed = parseIpaSource(format, detect(url, text(file)).json);
    assert.ok(parsed.apps.length > 0, `${file}: apps`);
    const rows = ipaRows(parsed, { url, name: parsed.name }, null);
    assert.equal(rows.length, parsed.apps.length, file);
    for (const r of rows) {
      assert.equal(r.kind, "ipa", file);
      assert.ok(r.package && r.name && r.version, `${file}: ${JSON.stringify(r).slice(0, 120)}`);
      assert.ok(r.section.startsWith("Apps"), file);
      assert.equal(r.ipa.sourceUrl, url);
      assert.ok(r.ipa.versions[0].downloadURL || r.ipa.versions[0].manifestURL, `${file}: something to install`);
    }
    assert.equal(new Set(rows.map((r) => r.package)).size, rows.length, `${file}: unique ids`);
  }
});

test("AltStore-family extras are kept on the source, apps and versions", () => {
  const alt = parseIpaSource("altstore", JSON.parse(text("altstore-classic.json")));
  assert.equal(alt.extra.patreonURL, "https://www.patreon.com/rileyshane");
  assert.ok(alt.apps[0].versions[0].extra?.sha256, "AltStore's sha256");
  assert.ok(alt.apps.some((a) => "patreon" in a.extra), "AltStore's patreon");
  assert.equal(alt.apps[1].beta, true);
  const side = parseIpaSource("altstore", JSON.parse(text("sidestore-community.json")));
  assert.ok(side.extra.sourceURL && "apiVersion" in side.extra);
  assert.ok("absoluteVersion" in side.apps[0].extra && "appID" in side.apps[0].extra);
  const stik = parseIpaSource("altstore", JSON.parse(text("stikstore.json")));
  assert.equal(stik.headerURL, JSON.parse(text("stikstore.json")).headerURL);
  assert.ok(stik.apps[0].versions[0].minOSVersion);
  // TrollApps reads plain AltStore JSON: UTM's source has nothing extra.
  assert.deepEqual(parseIpaSource("altstore", JSON.parse(text("trollapps-utm.json"))).extra, {});
});

test("ESign: its source and app fields are kept, AltStore's are read", () => {
  const json = JSON.parse(text("esign-zeeho.json"));
  const p = parseIpaSource("esign", json);
  assert.equal(p.name, json.name);
  assert.equal(p.extra.sourceicon, json.sourceicon);
  assert.equal(p.extra.message, json.message);
  assert.equal(p.apps[0].bundleIdentifier, "io.github.lswlc33.dashboard.ios");
  assert.ok("lock" in p.apps[0].extra && "type" in p.apps[0].extra && "isLanZouCloud" in p.apps[0].extra);
  // An ESign app with no real bundle id gets a stable one from its name.
  const made = toAltSource("esign", { name: "S", sourceicon: "https://e.dev/i.png", apps: [
    { name: "Cercube Plus", bundleIdentifier: "youtube", version: "1", downloadURL: "https://e.dev/a.ipa", isLanZouCloud: 0 },
    { name: "No Id", version: "2", downloadURL: "https://e.dev/b.ipa" },
  ] });
  assert.deepEqual(made.apps.map((a) => a.bundleIdentifier), ["esign.cercube-plus", "esign.no-id"]);
  assert.equal(made.iconURL, "https://e.dev/i.png");
});

test("B7: ESign entries repeating an id and name merge into one history; variants keep their own extra", () => {
  // AppTesters: one ESign entry per version, same bundle id and name.
  const at = parseIpaSource("esign", { name: "AppTesters", apps: [
    { name: "Camera", bundleIdentifier: "com.andyworks.camera", version: "2", versionDate: "2026-02-01",
      downloadURL: "https://e.dev/c2.ipa", lock: 0 },
    { name: "Camera", bundleIdentifier: "com.andyworks.camera", version: "1", versionDate: "2026-01-01",
      downloadURL: "https://e.dev/c1.ipa", lock: 1 },
    { name: "Other", version: "1", downloadURL: "https://e.dev/o1.ipa" },
    { name: "Other", version: "2", downloadURL: "https://e.dev/o2.ipa" },
  ] });
  assert.deepEqual(at.apps.map((a) => a.id), ["com.andyworks.camera", "esign.other"]);
  assert.deepEqual(at.apps[0].versions.map((v) => v.version), ["2", "1"]);
  assert.equal(at.apps[0].extra.lock, 0);
  assert.equal(at.apps[1].versions.length, 2);
  // RyukSign: variants under one bundle id with different names; each keeps its own entry's extra.
  const ry = parseIpaSource("altstore", { name: "RyukSign", apps: [
    { name: "RyukGram", bundleIdentifier: "com.burbn.instagram", flavour: "a",
      versions: [{ version: "1", downloadURL: "https://e.dev/a.ipa", sha256: "aa" }] },
    { name: "RyukGram (Duplicate)", bundleIdentifier: "com.burbn.instagram", flavour: "b",
      versions: [{ version: "1", downloadURL: "https://e.dev/b.ipa", sha256: "bb" }] },
  ] });
  assert.deepEqual(ry.apps.map((a) => a.id), ["com.burbn.instagram", "com.burbn.instagram~ryukgram-duplicate"]);
  assert.deepEqual(ry.apps.map((a) => a.extra.flavour), ["a", "b"]);
  assert.deepEqual(ry.apps.map((a) => a.versions[0].extra?.sha256), ["aa", "bb"]);
});

test("Scarlet: groups become categories, bundleID the id, changelog the what's new; Scylla's variant reads too", () => {
  const p = parseIpaSource("scarlet", JSON.parse(text("scarlet-locus.json")));
  assert.equal(p.name, "Locus");
  assert.equal(p.iconURL, "https://jbmagination.com/locus-ios/assets/icon.png");
  const app = p.apps[0];
  assert.equal(app.bundleIdentifier, "app.myzel394.locus");
  assert.equal(app.developerName, "Myzel394");
  assert.equal(app.versions[0].version, "0.15.2");
  assert.match(app.versions[0].downloadURL, /Locus\.ipa$/);
  assert.match(app.versions[0].localizedDescription, /improvements and bugfixes/);
  assert.equal(app.screenshots.length, 2);
  assert.equal(app.extra.contact.web, "https://github.com/Myzel394/locus");
  assert.equal(app.extra.group, "Locus");
  const s = parseIpaSource("scarlet", JSON.parse(text("scarlet-scylla.json")));
  assert.equal(s.name, "Scylla's Base Repo");
  assert.equal(s.extra.repoAuthor, "@pufferisadev");
  assert.equal(s.apps[0].developerName, "leminlimez");
  assert.equal(s.apps[0].tintColor, "#266a0d");
  assert.deepEqual([s.apps[0].versions[0].minOSVersion, s.apps[0].versions[0].maxOSVersion], ["14.0", "16.1.2"]);
  assert.equal(s.apps[0].bundleIdentifier, "scarlet.cowabunga");
  // A tweaked build under the original's bundle id doesn't hide the first one.
  const dup = parseIpaSource("scarlet", { META: { repoName: "R" }, Games: [
    { name: "A", version: "1", down: "https://r.dev/a.ipa", bundleID: "com.game" },
    { name: "B", version: "1", down: "https://r.dev/b.ipa", bundleID: "com.game" },
  ] });
  assert.deepEqual(dup.apps.map((a) => a.bundleIdentifier), ["com.game", "com.game.b"]);
});

test("GBox: categories by index, LINK entries and hidden apps left out, appPlist manifests kept", () => {
  const p = parseIpaSource("gbox", JSON.parse(text("gbox-qoli.json")));
  assert.equal(p.name, "Binance Test App");
  assert.equal(p.apps[0].bundleIdentifier, "gbox.binance-test-app");
  assert.equal(p.apps[0].category, "工具");
  assert.equal(p.apps[0].versions[0].date, Date.parse("2022-07-13T16:00:00+08:00"));
  assert.equal(p.apps[0].extra.appType, "SELF_SIGN");
  const q = parseIpaSource("gbox", { sourceName: "G", appCategories: ["A", "B"], appRepositories: [
    { appType: "LINK", appName: "Home", appLink: "https://g.dev" },
    { appType: "ENT_SIGN", appName: "Signed", appVersion: "1", appPlist: "https://g.dev/s.plist", appCateIndex: 1 },
    { appType: "SELF_SIGN", appName: "Hidden", appVersion: "1", appPackage: "https://g.dev/h.ipa", hide: true },
  ] });
  assert.deepEqual(q.apps.map((a) => a.name), ["Signed"]);
  assert.equal(q.apps[0].versions[0].manifestURL, "https://g.dev/s.plist");
  assert.equal(q.apps[0].category, "b");
  assert.deepEqual(q.extra.links, [{ title: "Home", url: "https://g.dev" }]);
  assert.equal(isoDate("2019-12-27T9:30:00+0800"), "2019-12-27T09:30:00+08:00");
  assert.deepEqual(osRange("iOS 15.0+"), { minOSVersion: "15.0" });
});

test("an encrypted GBox source is known but not parsable", () => {
  const d = detect("https://g.dev/src.json", text("gbox-encrypted.json"));
  assert.equal(d.format, "gbox");
  assert.equal(d.parsable, false);
  assert.match(d.reason, /encrypted/);
  assert.throws(() => toAltSource("gbox", d.json), /encrypted/);
});

test("APT fixtures: Release, InRelease and Packages in every compression detect as APT with the repo's layout", () => {
  for (const name of ["Release", "InRelease"]) {
    const d = detect(PROCURSUS + name, text("apt-dist-" + name));
    assert.equal(d.format, "apt");
    assert.deepEqual([d.apt.uri, d.apt.dist, d.apt.components], ["https://apt.procurs.us/", "1800", ["main", "testing"]]);
    assert.equal(d.release.origin, "Procursus");
  }
  const flat = detect(CHARIZ + "Release", text("apt-flat-Release"));
  assert.deepEqual([flat.apt.uri, flat.apt.dist, flat.release.origin], [CHARIZ, "./", "Chariz"]);

  const plain = detect(PKG_DIR + "Packages", text("apt-dist-Packages"));
  assert.deepEqual([plain.format, plain.apt.uri, plain.apt.dist, plain.apt.components], ["apt", "https://apt.procurs.us/", "1800", ["main"]]);
  const rows = parseControl(plain.text).filter((s) => matchesArch(s));
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.package && r.version && r.filename));
  const flatRows = parseControl(detect(CHARIZ + "Packages", text("apt-flat-Packages")).text);
  assert.equal(flatRows[0].package, "com.laughingquoll.prefixui");
  assert.equal(flatRows.filter((r) => matchesArch(r)).length, 2);

  const want = plain.text;
  for (const ext of ["gz", "bz2", "xz", "zst", "lzma"]) {
    const b = bytes("apt-dist-Packages." + ext);
    assert.equal(compressionOf(b), ext);
    // Served under any name (or a URL with no file name at all), the magic decides.
    const d = detect(PKG_DIR + "Packages." + ext, b);
    assert.deepEqual([d.format, d.apt.compression, d.apt.dist], ["apt", ext, "1800"]);
    assert.equal(detect("https://r.example/download?id=1", b).apt.compression, ext);
  }
  // Node can open two of them here: they hold the same index.
  assert.equal(gunzipSync(bytes("apt-dist-Packages.gz")).toString(), want);
  assert.equal(zstdDecompressSync(bytes("apt-dist-Packages.zst")).toString(), want);
});

test("APT layout from any of the paths Cydia reads", () => {
  const L = (u) => { const l = aptLayoutFromUrl(u); return [l.uri, l.dist, l.components, l.file]; };
  assert.deepEqual(L("http://apt.saurik.com/dists/ios/1800.00/main/binary-iphoneos-arm/Packages.bz2"),
    ["http://apt.saurik.com/", "ios/1800.00", ["main"], "Packages.bz2"]);
  assert.deepEqual(L("http://apt.thebigboss.org/repofiles/cydia/dists/stable/Release"),
    ["http://apt.thebigboss.org/repofiles/cydia/", "stable", ["main"], "Release"]);
  assert.deepEqual(L("https://apt.procurs.us/dists/1800/"), ["https://apt.procurs.us/", "1800", ["main"], null]);
  assert.deepEqual(L("https://havoc.app/Packages.zst"), ["https://havoc.app/", "./", [], "Packages.zst"]);
  assert.deepEqual(L("https://r.example/sub/InRelease"), ["https://r.example/sub/", "./", [], "InRelease"]);
});

test("links from package managers and sideloaders give the source URL", () => {
  const U = (s) => unwrapLink(s)?.url ?? null;
  const src = "https://jbmagination.com/locus-ios/alt.json";
  for (const link of [
    `altstore://source?url=${src}`, `sidestore://source?url=${encodeURIComponent(src)}`, `feather://source/${src}`,
    `livecontainer://source?url=${src}`, `stikstore://add-source?url=${src}`, `trollapps://add?url=${src}`,
    `altstore-classic://source?url=${src}`,
  ]) assert.equal(U(link), src, link);
  assert.equal(unwrapLink(`trollapps://add?url=${src}`).hint, "altstore");
  assert.equal(U("scarlet://repo=https://jbmagination.com/locus-ios/scarlet.json"), "https://jbmagination.com/locus-ios/scarlet.json");
  assert.equal(unwrapLink("scarlet://repo=https://x.dev/s.json").hint, "scarlet");
  assert.equal(U("trollapps://add?url=alt.getutm.app"), "https://alt.getutm.app/");
  assert.equal(U("cydia://url/https://cydia.saurik.com/api/share#?source=https://repo.chariz.com/"), CHARIZ);
  assert.equal(U("sileo://source/https://repo.chariz.com/"), CHARIZ);
  assert.equal(U("zbra://sources/add/https://repo.chariz.com/"), CHARIZ);
  assert.equal(U("installer://add/https://repo.chariz.com/"), CHARIZ);
  assert.equal(U("repo.chariz.com"), CHARIZ);
  assert.equal(U("https://apps.altstore.io"), "https://apps.altstore.io/");
  for (const bad of ["", "javascript:alert(1)", "altstore://source", "ftp://r.example/", "https://user:pw@r.example/"]) {
    assert.equal(unwrapLink(bad), null, bad);
  }
});

test("garbage is refused with a clear message", () => {
  const refused = (body, reason, re) => assert.throws(() => detect("https://junk.example/x", body),
    (e) => e instanceof SourceFormatError && e instanceof SourceError && e.kind === "not_source" && e.reason === reason
      && e.title === "Did Not Find Source" && re.test(e.message));
  refused(text("page-repo-landing.html"), "web_page", /junk\.example sent a web page, not a source/);
  refused(text("garbage.txt"), "unknown_text", /not a source: no APT Release or Packages, and no app source JSON/);
  refused(text("garbage.json"), "unknown_json", /no source format iFizBox knows/);
  refused("{ \"apps\": [ ", "bad_json", /broken JSON/);
  refused("   \n", "empty", /empty page/);
  refused(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), "unknown_text", /not a source/);
});

test("FORMATS: one entry per format, readers named for the Open in row", () => {
  assert.deepEqual(Object.keys(FORMATS).sort(), ["altstore", "apt", "esign", "gbox", "scarlet"]);
  for (const f of Object.values(FORMATS)) assert.ok(f.name && f.readers.length);
  assert.ok(FORMATS.altstore.readers.includes("TrollApps") && FORMATS.altstore.readers.includes("LiveContainer"));
});

// ---- detectSource over a fake backend ------------------------------------------------------------------------

// URL -> body. Missing URLs fail as the proxy does: "upstream" 404, or "not_found" from packages().
function fakeBackend(files) {
  const calls = [];
  const get = (url) => {
    calls.push(url);
    if (!(url in files)) throw new BackendError("upstream", "upstream answered HTTP 404", 404);
    return files[url];
  };
  return {
    calls,
    async packages(dir) {
      calls.push("packages " + dir);
      for (const n of ["Packages.xz", "Packages.bz2", "Packages.gz", "Packages"]) {
        // The fake serves compressed files' plain text, as the server's decompressing packages() does.
        if (dir + n in files) return { text: files[dir + "Packages"] ?? text("apt-dist-Packages"), source: dir + n, cached: false };
      }
      throw new BackendError("not_found", "no Packages file");
    },
    text: async (url) => { const b = get(url); return typeof b === "string" ? b : new TextDecoder().decode(b); },
    fetch: async (url) => new Response(get(url)),
  };
}

test("detectSource: an IPA source of each format is added as an alt: record of that format", async () => {
  for (const [file, url, format] of IPA_FIXTURES) {
    const r = await detectSource(fakeBackend({ [url]: bytes(file) }), url);
    assert.equal(r.format, format, file);
    assert.equal(r.kind, "ipa");
    assert.equal(r.source.key, "alt:" + url);
    assert.equal(r.source.kind, "altstore");
    assert.equal(r.source.format, format);
    assert.equal(r.source.count, r.parsed.apps.length);
    assert.ok(r.source.count > 0);
  }
  const viaLink = await detectSource(fakeBackend({ "https://x.dev/s.json": text("scarlet-locus.json") }), "scarlet://repo=https://x.dev/s.json");
  assert.equal(viaLink.format, "scarlet");
  assert.equal(viaLink.source.name, "Locus");
});

test("detectSource: an encrypted GBox source is saved as unsupported, for the Open in row", async () => {
  const url = "https://g.dev/src.json";
  const r = await detectSource(fakeBackend({ [url]: text("gbox-encrypted.json") }), url);
  assert.equal(r.format, "gbox");
  assert.equal(r.parsed, null);
  assert.match(r.source.unsupported, /encrypted/);
  assert.equal(r.source.key, "alt:" + url);
});

test("detectSource: a flat APT repo whose root is a web page", async () => {
  const backend = fakeBackend({
    [CHARIZ]: text("page-repo-landing.html"), [CHARIZ + "Release"]: text("apt-flat-Release"),
    [CHARIZ + "Packages.bz2"]: bytes("apt-flat-Packages"), [CHARIZ + "Packages"]: text("apt-flat-Packages"),
  });
  const r = await detectSource(backend, "repo.chariz.com");
  assert.equal(r.format, "apt");
  assert.deepEqual([r.source.key, r.source.uri, r.source.dist, r.source.origin], ["deb:https://repo.chariz.com/:./", CHARIZ, "./", "Chariz"]);
  assert.equal(r.source.count, 2); // the first of the three Chariz packages is rootful (iphoneos-arm) only
});

test("detectSource: a dist repo's root, Release URL, or Packages.xz URL", async () => {
  const files = {
    [PROCURSUS + "Release"]: text("apt-dist-Release"),
    [PKG_DIR + "Packages.xz"]: bytes("apt-dist-Packages.xz"), [PKG_DIR + "Packages"]: text("apt-dist-Packages"),
    [PROCURSUS + "testing/binary-iphoneos-arm64/Packages"]: "",
  };
  const want = ["deb:https://apt.procurs.us/:1800", "https://apt.procurs.us/", "1800", ["main", "testing"], "Procursus"];
  const got = (r) => [r.source.key, r.source.uri, r.source.dist, r.source.components, r.source.origin];
  // The root: no page, no flat repo; found under dists/<d>/ from the candidates the caller passes.
  assert.deepEqual(got(await detectSource(fakeBackend(files), "https://apt.procurs.us/", { dists: ["stable", "1800"] })), want);
  assert.deepEqual(got(await detectSource(fakeBackend(files), PROCURSUS + "Release")), want);
  const viaPackages = await detectSource(fakeBackend(files), PKG_DIR + "Packages.xz");
  assert.deepEqual(got(viaPackages), want);
  assert.equal(viaPackages.source.count, 2); // 2048 in two versions and adv-cmds: two packages (B366)
});

test("detectSource: a page with no repo or source behind it is refused, saying what it was", async () => {
  const url = "https://junk.example/";
  await assert.rejects(detectSource(fakeBackend({ [url]: text("page-repo-landing.html") }), url),
    (e) => e instanceof SourceFormatError && e.reason === "web_page"
      && /junk\.example sent a web page, not a source\. There is no APT repository \(Release or Packages\) there either/.test(e.message));
  await assert.rejects(detectSource(fakeBackend({}), url), (e) => e.kind === "not_source" && /Nothing was found at https:\/\/junk\.example\//.test(e.message));
  await assert.rejects(detectSource(fakeBackend({ [url + "x.json"]: text("garbage.json") }), url + "x.json"),
    (e) => e.reason === "unknown_json");
  await assert.rejects(detectSource(fakeBackend({}), "javascript:alert(1)"), (e) => e.kind === "invalid_url");
  const refusing = { fetch: async () => { throw new BackendError("refused", "refused: private address"); } };
  await assert.rejects(detectSource(refusing, "https://10.0.0.1/"), (e) => e.kind === "verification" && e.code === "refused");
});
