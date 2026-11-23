// F382: Source Filters: the switches' rules (core/sourcefilters.js) and what the worker's catalog leaves out with them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog, ALL, APP_TWEAKS } from "./catalog.js";
import {
  ALL_SOURCES, filtersFor, filterOn, isCustom, isLegacySource, resolveFilters, isOldPackage, isUnknownIos, isAppTweak,
} from "./sourcefilters.js";

const st = (f) => Object.entries(f).map(([k, v]) => `${k}: ${v}`).join("\n");
const pkgs = (...list) => list.map(st).join("\n\n") + "\n";
const ids = (rows) => rows.map((r) => r.id).sort();
const BIGBOSS = "deb:http://apt.thebigboss.org/repofiles/cydia/:stable";
const MODERN = "deb:https://havoc.app/:./";
const OTHER = "deb:https://repo.example/:./";

test("old firmware: a stated minimum of iOS 10 or earlier is old, a modern or unstated one is not", () => {
  assert.equal(isOldPackage({ depends: "firmware (>= 7.0)" }), true);
  assert.equal(isOldPackage({ depends: "mobilesubstrate, firmware (>= 10.3)" }), true);
  assert.equal(isOldPackage({ depends: "firmware (<< 11.0)" }), false, "only the stated minimum counts");
  assert.equal(isOldPackage({ depends: "firmware (>= 11.0)" }), false);
  assert.equal(isOldPackage({ depends: "firmware (>= 15.0)" }), false);
  assert.equal(isOldPackage({ depends: "mobilesubstrate" }), false, "nothing stated is Unknown, not Old");
  assert.equal(isOldPackage({ kind: "ipa", minOSVersion: "9.0" }), false, "an app's minimum is the oldest it still runs on");
});

test("unknown: a package that says nothing about iOS", () => {
  assert.equal(isUnknownIos({ depends: "mobilesubstrate" }), true);
  assert.equal(isUnknownIos({ depends: "firmware (>= 14.0)" }), false);
});

test("app tweak: an iphoneos-arm64 build or firmware 15 or later; rootful-only is not", () => {
  assert.equal(isAppTweak({ architecture: "iphoneos-arm64" }), true);
  assert.equal(isAppTweak({ architecture: "iphoneos-arm", depends: "firmware (>= 15.0)" }), true);
  assert.equal(isAppTweak({ architecture: "iphoneos-arm", depends: "firmware (>= 12.0)" }), false);
  assert.equal(isAppTweak({ architecture: "iphoneos-arm" }), false);
});

test("All Sources sets the defaults; a source follows it unless changed there; Hide Unknown is on for old sources", () => {
  assert.equal(isLegacySource(BIGBOSS), true);
  assert.equal(isLegacySource("deb:https://apt.modmyi.com/:stable"), true);
  assert.equal(isLegacySource(MODERN), false);
  assert.equal(isLegacySource("deb:https://notthebigboss.org.example/:./"), false);
  const none = {};
  assert.equal(filterOn(none, ALL_SOURCES, "old"), true);
  assert.equal(filterOn(none, ALL_SOURCES, "unknown"), false);
  assert.equal(filterOn(none, ALL_SOURCES, "paid"), false);
  assert.equal(filterOn(none, ALL_SOURCES, "dupes"), true);
  assert.equal(filterOn(none, ALL_SOURCES, "fit", { fit: false }), false, "Works on My Phone is the worksOnMyPhone setting");
  assert.equal(filterOn(none, MODERN, "unknown"), false);
  assert.equal(filterOn(none, BIGBOSS, "unknown"), true);
  assert.equal(isCustom(none, BIGBOSS), false, "the old source's Hide Unknown is what it follows, not Custom");
  const off = { [BIGBOSS]: { unknown: false } };
  assert.equal(filterOn(off, BIGBOSS, "unknown"), false, "unless changed there");
  assert.equal(isCustom(off, BIGBOSS), true);
  const paid = { [ALL_SOURCES]: { paid: true } };
  assert.equal(filterOn(paid, MODERN, "paid"), true, "a source follows All Sources");
  assert.equal(isCustom(paid, MODERN), false);
  assert.equal(isCustom({ [MODERN]: { paid: false } }, MODERN), false, "a change back to what it follows is not Custom");
  assert.deepEqual(filtersFor(ALL_SOURCES).map((f) => f.id), ["fit", "old", "unknown", "paid", "dupes"]);
  assert.deepEqual(filtersFor(MODERN, { lite: true }).map((f) => f.id), ["fit", "old", "unknown", "appTweaks", "paid"]);
  assert.deepEqual(resolveFilters({ [MODERN]: { fit: false } }, [MODERN]).byKey[MODERN],
    { old: true, unknown: false, paid: false, appTweaks: false, fit: false });
});

const JB = pkgs(
  { Package: "com.x.new", Name: "New", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (>= 15.0)" },
  { Package: "com.x.old", Name: "Old", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (>= 8.0)" },
  { Package: "com.x.unknown", Name: "Unknown", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks" },
  { Package: "com.x.paid", Name: "Paid", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (>= 15.0)", Tag: "cydia::commercial" },
);

test("catalog: Old hidden by default, Unknown only on old sources, Paid when asked; package() still opens them", () => {
  const c = createCatalog();
  c.setDevice({ ios: "17.0", jailbreak: "rootless" });
  c.setFilters({});
  c.load(OTHER, JB, "https://repo.example/");
  c.load(BIGBOSS, JB, "http://apt.thebigboss.org/repofiles/cydia/");
  assert.deepEqual(ids(c.list(OTHER, ALL)), ["com.x.new", "com.x.paid", "com.x.unknown"]);
  assert.deepEqual(ids(c.list(BIGBOSS, ALL)), ["com.x.new", "com.x.paid"], "old source: Unknown hidden too");
  c.setFilters({ [BIGBOSS]: { unknown: false } });
  assert.deepEqual(ids(c.list(BIGBOSS, ALL)), ["com.x.new", "com.x.paid", "com.x.unknown"]);
  c.setFilters({ [ALL_SOURCES]: { paid: true } });
  assert.deepEqual(ids(c.list(ALL, ALL)), ["com.x.new", "com.x.unknown"]);
  assert.deepEqual(ids(c.search("paid")), []);
  assert.equal(c.sections(OTHER).total, 2);
  assert.ok(c.package("com.x.old", ALL), "a filtered package's page still opens");
  c.setFilters(null);
  assert.equal(c.list(ALL, ALL).length, 4, "no filters sent: nothing left out");
});

test("catalog: Newest Copy Only leaves the older copy out of its source's list, All Sources keeps the newest", () => {
  const a = pkgs({ Package: "com.x.t", Name: "T", Version: "1.0", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (>= 15.0)" });
  const b = pkgs({ Package: "com.x.t", Name: "T", Version: "1.2", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (>= 15.0)" });
  const c = createCatalog();
  c.setFilters({});
  c.load(OTHER, a, "https://repo.example/");
  c.load(MODERN, b, "https://havoc.app/");
  assert.deepEqual(ids(c.list(OTHER, ALL)), []);
  assert.deepEqual(ids(c.list(MODERN, ALL)), ["com.x.t"]);
  assert.equal(c.list(ALL, ALL)[0].version, "1.2");
  c.setFilters({ [ALL_SOURCES]: { dupes: false } });
  assert.deepEqual(ids(c.list(OTHER, ALL)), ["com.x.t"]);
});

test("catalog: a source's own Works on My Phone overrides All Sources'", () => {
  const text = pkgs({ Package: "com.x.ios12", Name: "Twelve", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (>= 12.0), firmware (<< 13.0)" });
  const c = createCatalog();
  c.setDevice({ ios: "17.0", jailbreak: "rootless" }, { filter: true });
  c.setFilters({});
  c.load(OTHER, text, "https://repo.example/");
  assert.deepEqual(ids(c.list(OTHER, ALL)), []);
  c.setFilters({ [OTHER]: { fit: false } });
  assert.deepEqual(ids(c.list(OTHER, ALL)), ["com.x.ios12"]);
});

test("Lite: App Tweaks Only drops rootful-only tweaks from a Tweak Source; the source can end up with none", () => {
  const tweaks = pkgs(
    { Package: "com.x.yt", Name: "YT", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "mobilesubstrate, firmware (>= 15.0)" },
    { Package: "com.x.ig", Name: "IG", Version: "1", Architecture: "iphoneos-arm", Section: "Tweaks", Depends: "mobilesubstrate, firmware (>= 15.0)" },
    { Package: "com.x.sb", Name: "SB", Version: "1", Architecture: "iphoneos-arm", Section: "Tweaks", Depends: "mobilesubstrate, firmware (>= 12.0)" },
  );
  const c = createCatalog();
  c.setDevice({ ios: "17.0", jailbreak: "none" });
  c.setTweakKnown({ worked: ["com.x.yt", "com.x.ig", "com.x.sb", "com.bb.t"] }); // B391: checked here, they work
  c.setFilters({}, { lite: true });
  c.load(OTHER, tweaks, "https://repo.example/", "iphoneos-arm64", { tweaks: true });
  assert.deepEqual(ids(c.list(ALL, APP_TWEAKS)), ["com.x.ig", "com.x.yt"]);
  assert.deepEqual(ids(c.list(OTHER, ALL)), ["com.x.ig", "com.x.yt"]);
  c.setFilters({ [OTHER]: { appTweaks: false } }, { lite: true });
  assert.deepEqual(ids(c.list(OTHER, ALL)), ["com.x.ig", "com.x.sb", "com.x.yt"]);
  // BigBoss: rootful, no stated iOS: nothing is left.
  const bb = pkgs({ Package: "com.bb.t", Name: "BB", Version: "1", Architecture: "iphoneos-arm", Section: "Tweaks", Depends: "mobilesubstrate" });
  c.setFilters({}, { lite: true });
  c.load(BIGBOSS, bb, "http://apt.thebigboss.org/repofiles/cydia/", "iphoneos-arm64", { tweaks: true });
  assert.equal(c.sections(BIGBOSS).total, 0);
  c.setFilters({}, { lite: false });
  assert.equal(c.sections(BIGBOSS).total, 0, "Hide Unknown still leaves BigBoss's tweaks out");
});
