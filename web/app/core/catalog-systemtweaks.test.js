// B377: the sideload build listed tweaks for iOS itself (Aerial, SpringBoard and system-app tweaks) under App Tweaks,
// in Search and in Sections' counts: the catalog kept every tweak the Packages fields let through and never heard the
// Tweak Index's verdicts. Once checked, a systemOnly or refused tweak drops out; anyApp and unchecked ones stay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog, ALL } from "./catalog.js";
import { indexEntry, indexSource, dropsFromCatalog } from "./tweakindex.js";
import { packIndexFile } from "./tweakindexfile.js";
import { APP_TWEAKS } from "./sections.js";
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
Description: Not checked yet
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
const verdictsOf = (answer) => Object.fromEntries(answer.filter(dropsFromCatalog).map((e) => [`${e.package}@${e.version}`, true]));

test("B377: unchecked, every tweak the fields let through is listed (the bug's starting point)", () => {
  const c = lite();
  assert.deepEqual(ids(c.list(ALL, APP_TWEAKS)), ["jp.uzra.aerial", "com.b377.aerialfresh", "com.b377.anyfont"]);
  assert.equal(tweakCount(c), 3);
});

test("B377: a systemOnly verdict drops the tweak from App Tweaks, Search and the section count; anyApp and unchecked stay", () => {
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
  c.setTweakVerdicts({ "jp.uzra.aerial@1.1.0": true });
  assert.equal(tweakCount(c), 3, "the old version's verdict says nothing about 1.2.0");
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
