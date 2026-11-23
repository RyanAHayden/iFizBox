// B407: dpkg's status says oreo where the source says Oreo: one package, shown and linked by the source's spelling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog } from "./catalog.js";
import { withLowerIds } from "./apt.js";
import { createSettings } from "./settings.js";
import { wishCount, wishRows } from "./wishlist.js";
import { dependedOn, findUpgrades, installedStanzas, markedRows, modeRows } from "./installed.js";

const A = "deb:https://a.example/:./";
const B = "deb:https://b.example/:./";
const pkg = (id, version, more = "") => `Package: ${id}\nVersion: ${version}\nArchitecture: iphoneos-arm64\nFilename: debs/${id}_${version}.deb\n${more}\n`;
const STATUS = `Package: oreo
Status: install ok installed
Version: 1.0
Depends: LibThing

Package: libthing
Status: install ok installed
Version: 3.0

Package: alone
Status: install ok installed
Version: 1
`;

function setup() {
  const c = createCatalog();
  c.load(A, pkg("Oreo", "1.4", "Name: Oreo Theme\nDepends: LibThing (>= 2)\n") + pkg("LibThing", "3.0"), "https://a.example/");
  c.load(B, pkg("oreo", "1.2") + pkg("User", "1.0", "Depends: OREO, LIBTHING\n"), "https://b.example/");
  c.setInstalled(STATUS);
  return c;
}

test("an installed package with capitals shows as installed, once, under the source's spelling", () => {
  const c = setup();
  assert.deepEqual(c.installed().map((r) => r.id).sort(), ["LibThing", "Oreo", "alone"]);
  assert.equal(c.list().filter((r) => /oreo/i.test(r.id)).length, 1);
  assert.deepEqual(c.search("oreo", { installed: "installed" }).map((r) => r.id), ["Oreo"]);
  assert.deepEqual(c.search("oreo", { installed: "not" }), []);
  for (const id of ["Oreo", "oreo"]) {
    const p = c.package(id);
    assert.equal(p.row.id, "Oreo");
    assert.equal(p.stanza.package, "Oreo");
    assert.equal(p.stanza.debUrl, "https://a.example/debs/Oreo_1.4.deb");
    assert.deepEqual(p.others.map((o) => o.version), ["1.4", "1.2"]);
    assert.ok(c.history(id).versions.some((v) => v.installed && v.version === "1.0"));
    assert.equal(c.queueInfo([id])[id].name, "Oreo Theme");
  }
  assert.equal(c.package("Alone").installedOnly, true);
  assert.ok(c.versions().some(([k, id, v]) => k === A && id === "Oreo" && v === "1.4"));
  assert.ok(c.versions().some(([k, id]) => k === B && id === "oreo"));
});

test("upgrades, holds and blocked ids ignore case", () => {
  const c = setup();
  assert.deepEqual(c.upgrades().available.map((r) => [r.id, r.installed, r.version]), [["Oreo", "1.0", "1.4"]]);
  assert.deepEqual(c.upgrades(["oreo"]).ignored.map((r) => r.id), ["Oreo"]);
  assert.deepEqual(findUpgrades([{ id: "oreo", version: "1" }], () => ({ id: "Oreo", name: "Oreo", version: "2" }), ["OREO"]).ignored.length, 1);
  c.setBlocked(["oreo"]);
  assert.equal(c.list().some((r) => /oreo/i.test(r.id)), false);
});

test("Depends names match ignoring case", () => {
  const c = setup();
  const info = c.runInfo([{ id: "oreo", version: "1.4" }, { id: "User" }]);
  assert.equal(info.oreo.debUrl, "https://a.example/debs/Oreo_1.4.deb");
  assert.equal(info.installed.LibThing, "3.0");
  assert.equal(info.installed.OREO, "1.0");
  assert.deepEqual(c.has(["OREO", "libTHING", "nope"]), ["OREO", "libTHING"]);
  assert.equal(c.deps("User").ok, true);
  assert.deepEqual([...dependedOn(installedStanzas(STATUS))], ["libthing"]);
});

test("a package's two spellings in one source are one package; apps' bundle IDs stay apart without a jailbreak", () => {
  const c = createCatalog();
  assert.equal(c.load(A, pkg("Oreo", "1.0") + pkg("oreo", "2.0"), "https://a.example/"), 1);
  assert.deepEqual(c.history("OREO").versions.map((v) => v.version), ["2.0", "1.0"]);
  const app = (id) => ({ name: id, bundleIdentifier: id, versions: [{ version: "1", downloadURL: `https://a.example/${id}.ipa`, date: "2026-01-01" }] });
  c.loadAlt("alt:https://a.example/apps.json", { name: "Apps", identifier: "x", apps: [app("com.x.App"), app("com.x.app")] });
  c.setDevice({ ios: "18.0", jailbreak: "none" });
  assert.deepEqual(c.list().map((r) => r.id).sort(), ["com.x.App", "com.x.app"]);
});

test("holds and the wish list match ignoring case", async () => {
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const s = createSettings({ storage, mode: "site" });
  s.holds.replace(["oreo"]);
  assert.equal(s.holds.has("Oreo"), true);
  await s.holds.set("Oreo", true);
  assert.deepEqual(s.holds.list(), ["oreo"]);
  await s.holds.set("Oreo", false);
  assert.deepEqual(s.holds.list(), []);
  assert.deepEqual(wishRows(["oreo"], [{ id: "Oreo" }]).length, 1);
  assert.equal(wishCount(["oreo"], ["Oreo"]), 0);
});

test("the marks, dates and names dpkg and apt give in lower case", () => {
  const rows = [{ id: "Oreo", name: "Oreo", tier: 1 }];
  assert.equal(markedRows(rows, new Set(["oreo"]))[0].tier, 2);
  assert.equal(modeRows(rows, "recent", { oreo: 5 }).length, 1);
  assert.deepEqual(withLowerIds({ Oreo: "Oreo Theme", oreo2: "Two" }), { Oreo: "Oreo Theme", oreo: "Oreo Theme", oreo2: "Two" });
});
