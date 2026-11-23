// B377: the sideload build listed tweaks for iOS itself (Aerial, SpringBoard and system-app tweaks) under App Tweaks,
// in Search and in Sections' counts: the catalog kept every tweak the Packages fields let through and never heard the
// Tweak Index's verdicts. Once checked, a systemOnly or refused tweak drops out.
// B391: one with no verdict is listed only when its name or description mentions a known app or one of the user's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog, ALL } from "./catalog.js";
import { indexEntry, indexSource, dropsFromCatalog } from "./tweakindex.js";
import { packIndexFile } from "./tweakindexfile.js";
import { APP_TWEAKS } from "./sections.js";
import { bannersInCatalog } from "./featured.js";
import { loadTweakIndex, catalogVerdicts, onTweakVerdicts } from "../screens/tweaks.js";

const KEY = "https://havoc-b377.example/";
const PACKAGES = `Package: jp.uzra.aerial
Name: Aerial
Version: 1.2.0
Architecture: iphoneos-arm64
Section: Tweaks
Author: uzra
Depends: mobilesubstrate, firmware (>= 15.0)
Description: Wallpaper effects for the Home Screen
Filename: debs/jp.uzra.aerial_1.2.0_iphoneos-arm64.deb

Package: com.b377.anyfont
Name: AnyFont
Version: 1.1
Architecture: iphoneos-arm64
Section: Tweaks
Depends: mobilesubstrate
Description: A font for every app
Filename: debs/com.b377.anyfont_1.1_iphoneos-arm64.deb

Package: com.b377.aerialfresh
Name: Aerial Fresh
Version: 0.9
Architecture: iphoneos-arm64
Section: Tweaks
Depends: mobilesubstrate
Description: Not checked yet, for YouTube
Filename: debs/com.b377.aerialfresh_0.9_iphoneos-arm64.deb
`;

// What the Tweak Index says of the source: Aerial hooks SpringBoard only, AnyFont loads into every app.
const ANSWER = [
  indexEntry({ package: "jp.uzra.aerial", version: "1.2.0" }, { ok: false, why: "It's for iOS itself", bundles: [], anyApp: false, systemOnly: true }),
  indexEntry({ package: "com.b377.anyfont", version: "1.1" }, { ok: true, bundles: [], anyApp: true }),
];

const lite = () => {
  const c = createCatalog();
  c.setDevice({ ios: "27.0", jailbreak: "none" });
  c.load(KEY, PACKAGES, KEY, "iphoneos-arm64", { tweaks: true });
  return c;
};
const ids = (rows) => rows.map((r) => r.id);
const tweakCount = (c) => c.sections(ALL).sections.find((s) => s.name === APP_TWEAKS)?.count ?? 0;
const verdictsOf = (answer) => Object.fromEntries(answer.map((e) => [`${e.package}@${e.version}`, dropsFromCatalog(e)]));

test("B391: with no verdict, only the tweak that mentions an app is listed", () => {
  const c = lite();
  assert.deepEqual(ids(c.list(ALL, APP_TWEAKS)), ["com.b377.aerialfresh"]);
  assert.equal(tweakCount(c), 1);
});

test("B377: a systemOnly verdict drops the tweak from App Tweaks, Search and the section count; anyApp and one mentioning an app stay", () => {
  const c = lite();
  assert.equal(c.setTweakVerdicts(verdictsOf(ANSWER)), 1);
  assert.deepEqual(ids(c.list(ALL, APP_TWEAKS)), ["com.b377.aerialfresh", "com.b377.anyfont"]);
  assert.equal(tweakCount(c), 2);
  assert.deepEqual(ids(c.search("aerial")), ["com.b377.aerialfresh"], "unfiltered Search");
  assert.deepEqual(ids(c.search("aerial", { section: APP_TWEAKS })), ["com.b377.aerialfresh"], "App Tweaks' Search");
  assert.deepEqual(ids(c.search("aerial", { section: "group:Tweaks" })), ["com.b377.aerialfresh"], "All Tweaks' Search");
  assert.deepEqual(ids(c.search("aerial", { source: KEY })), ["com.b377.aerialfresh"], "the source's Search");
  assert.deepEqual(ids(c.list(KEY)), ["com.b377.aerialfresh", "com.b377.anyfont"], "the source's own list");
  assert.equal(c.sections(KEY).total, 2);
  assert.ok(c.package("jp.uzra.aerial", KEY), "its page still opens");
  // a device check that says otherwise brings it back
  c.setTweakVerdicts({ "jp.uzra.aerial@1.2.0": false });
  assert.equal(tweakCount(c), 3);
});

test("B377: a verdict for another version, a refusal and a paid guess", () => {
  const c = lite();
  c.setTweakVerdicts({ "jp.uzra.aerial@1.1.0": true, "jp.uzra.aerial@1.0.0": false });
  assert.equal(tweakCount(c), 1, "the old version's verdict says nothing about 1.2.0");
  assert.equal(dropsFromCatalog({ ok: false, why: "needs a daemon" }), true, "refused");
  assert.equal(dropsFromCatalog({ ok: true, systemOnly: false, unverified: true, paid: true }), false, "a paid guess is no verdict");
  assert.equal(dropsFromCatalog(null), false, "unchecked");
  assert.equal(dropsFromCatalog({ ok: true, anyApp: true }), false);
});

test("B377: the index's answer reaches the catalog (screens/tweaks.js onTweakVerdicts, catalogVerdicts)", async () => {
  const c = lite();
  const got = [];
  const off = onTweakVerdicts((m) => { got.push(m); c.setTweakVerdicts(m); });
  try {
    const { key } = indexSource({ uri: KEY, dist: "./" });
    const file = packIndexFile([{ key, refreshed: 5, pending: 0 }], ANSWER.map((e) => ({ source: key, checked: 6, entry: JSON.stringify(e) })));
    assert.equal(await loadTweakIndex([{ key: KEY, uri: KEY, dist: "./" }], { file: { read: async () => file } }), 2);
  } finally { off(); }
  assert.deepEqual(got, [{ "jp.uzra.aerial@1.2.0": true, "com.b377.anyfont@1.1": false }]);
  assert.equal(catalogVerdicts({ storage: { getItem: () => null, setItem() {} } })["jp.uzra.aerial@1.2.0"], true);
  // a check on this device that found Aerial works after all (its cached verdict wins over the index's) brings it back
  const dev = { getItem: () => JSON.stringify({ "jp.uzra.aerial@1.2.0": { v: 2, ok: true, why: null, bundles: [], anyApp: true } }), setItem() {} };
  assert.equal(catalogVerdicts({ storage: dev })["jp.uzra.aerial@1.2.0"], false);
  assert.equal(catalogVerdicts({ storage: dev })["com.b377.aerialfresh@0.9"], undefined, "unchecked: no verdict");
  assert.deepEqual(ids(c.list(ALL, APP_TWEAKS)), ["com.b377.aerialfresh", "com.b377.anyfont"]);
  assert.deepEqual(ids(c.search("aerial")), ["com.b377.aerialfresh"]);
  assert.equal(tweakCount(c), 2);
});

// B391: a Chariz-like source. No verdict covers Glint, Deck, Drift and betterAlarm (paid, or not in the index).
const CHARIZ = "https://repo.chariz.com/";
const st = (id, name, desc, { paid = false, v = "1.0", section = "Tweaks" } = {}) => `Package: ${id}
Name: ${name}
Version: ${v}
Architecture: iphoneos-arm64
Section: ${section}
Depends: mobilesubstrate, firmware (>= 15.0)
${paid ? "Tag: cydia::commercial\n" : ""}Description: ${desc}
Filename: debs/${id}.deb
`;
const CHARIZ_PACKAGES = [
  st("com.c.glint", "Glint", "Shine for your status bar", { paid: true }), st("com.c.deck", "Deck", "A new dock", { paid: true }),
  st("com.c.drift", "Drift", "Live wallpapers"), st("com.c.betteralarm", "betterAlarm", "A beautiful timer and alarm screen", { paid: true }),
  st("com.c.ryd", "Return YouTube Dislike", "Shows dislikes"), st("com.c.rytm", "Return YTM dislikes", "Shows dislikes"),
  st("com.c.ygs", "YouGroupSettings", "Groups settings"), st("com.c.any", "AnyFont", "A font everywhere"),
  st("com.c.ytpaid", "Tube Pro", "Extras for YouTube", { paid: true }), st("com.c.bought", "Bought", "Bought and checked", { paid: true }),
  st("com.c.apollo", "Reader+", "Made for Apollo\n .\n More"), st("com.c.kept", "Kept", "Already in an app"),
].join("\n");
const YES = Object.fromEntries(["ryd", "rytm", "ygs", "any", "bought"].map((x) => [`com.c.${x}@1.0`, false]));
const STAY = ["com.c.any", "com.c.bought", "com.c.ryd", "com.c.rytm", "com.c.ygs", "com.c.ytpaid"];
const chariz = (map = YES) => {
  const c = createCatalog();
  c.setDevice({ ios: "27.0", jailbreak: "none" });
  c.setFilters({}, { lite: true });
  c.load(CHARIZ, CHARIZ_PACKAGES, CHARIZ, "iphoneos-arm64", { tweaks: true });
  c.setTweakVerdicts(map);
  return c;
};
const sortedIds = (rows) => ids(rows).sort();

test("B391: Glint, Deck, Drift and betterAlarm are gone everywhere, their banners too; nothing is fetched", async () => {
  const savedFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; throw new Error("fetched"); };
  try {
    const c = chariz();
    assert.deepEqual(sortedIds(c.list(ALL, APP_TWEAKS)), STAY);
    assert.deepEqual(sortedIds(c.list(CHARIZ)), STAY);
    assert.equal(tweakCount(c), STAY.length);
    assert.equal(c.sections(CHARIZ).total, STAY.length);
    for (const q of ["glint", "deck", "drift", "betteralarm"]) assert.deepEqual(c.search(q), [], q);
    const banners = ["glint", "ryd", "deck", "drift", "ytpaid", "betteralarm"].map((x) => ({ package: `com.c.${x}` }));
    const kept = await bannersInCatalog(banners, (id) => c.shows(id, CHARIZ));
    assert.deepEqual(kept.map((b) => b.package), ["com.c.ryd", "com.c.ytpaid"]);
    assert.ok(c.package("com.c.glint", CHARIZ), "its page still opens");
    assert.deepEqual(c.list(CHARIZ).find((r) => r.id === "com.c.ytpaid").guess, ["com.google.ios.youtube"]);
  } finally { globalThis.fetch = savedFetch; }
  assert.equal(fetched, 0);
});

test("B391: the user's apps' names count, a tweak an app has stays, one found to work stays without a verdict", () => {
  const c = chariz();
  c.setTweakKnown({ apps: { "com.christianselig.Apollo": "Apollo" }, held: ["com.c.kept"], worked: ["com.c.drift"] });
  assert.deepEqual(sortedIds(c.list(CHARIZ)), [...STAY, "com.c.apollo", "com.c.drift", "com.c.kept"].sort());
  // this version's own verdict wins over an earlier check of another; one an app has stays all the same
  c.setTweakVerdicts({ "com.c.drift@1.0": true, "com.c.kept@1.0": true });
  assert.deepEqual(sortedIds(c.list(CHARIZ)), [...STAY, "com.c.apollo", "com.c.kept"].sort());
  // a verdict taken back (a newer index file without it): no verdict again
  c.setTweakVerdicts({ "com.c.ygs@1.0": null });
  assert.ok(!ids(c.list(CHARIZ)).includes("com.c.ygs"));
  c.setTweakKnown({});
  assert.ok(!ids(c.list(CHARIZ)).includes("com.c.apollo"), "the app is gone");
});

test("B391: a source filter still hides first, and a hidden newer copy hides no older one", () => {
  const c = chariz();
  c.setFilters({ [CHARIZ]: { paid: true } }, { lite: true });
  assert.ok(!ids(c.list(CHARIZ)).includes("com.c.ytpaid"));
  c.setFilters({}, { lite: true });
  c.load("https://other.example/", st("com.c.ryd", "Dislike", "New, no verdict", { v: "2.0" }), "https://other.example/", "iphoneos-arm64", { tweaks: true });
  assert.ok(ids(c.list(CHARIZ)).includes("com.c.ryd"));
  assert.deepEqual(ids(c.list("https://other.example/")), []);
});

test("B391: the jailbreak build lists them all", async () => {
  const c = createCatalog();
  c.setDevice({ ios: "16.5", jailbreak: "rootless" });
  c.load(CHARIZ, CHARIZ_PACKAGES, CHARIZ, "iphoneos-arm64");
  c.setTweakVerdicts({ "com.c.glint@1.0": true });
  assert.equal(c.list(CHARIZ).length, 12);
  assert.equal(c.shows("com.c.glint", CHARIZ), true);
});
