import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCatalog, sectionName, simpleSection, parseAuthor, isVisible, indexLetter, NO_SECTION, ALL, runCatalog,
  searchable, wordStart,
} from "./catalog.js";
import { reply } from "./worker.js";
import { createParser } from "./parser.js";
import { readFileSync } from "node:fs";

const stanza = (f) => Object.entries(f).map(([k, v]) => `${k}: ${v}`).join("\n");
const packages = (...list) => list.map(stanza).join("\n\n") + "\n";
const ids = (rows) => rows.map((r) => r.id);

const REPO_A = packages(
  { Package: "com.a.tweak", Name: "Alpha Tweak", Version: "1.0", Architecture: "iphoneos-arm64", Section: "Tweaks",
    Author: "Jane Dev <jane@example.com>", Description: "makes things alpha\n long text about springboard",
    Filename: "debs/alpha_1.0.deb", Icon: "icons/alpha.png" },
  { Package: "com.a.tweak", Name: "Alpha Tweak", Version: "1.2", Architecture: "iphoneos-arm64", Section: "Tweaks",
    Author: "Jane Dev <jane@example.com>", Description: "makes things alpha", Filename: "debs/alpha_1.2.deb" },
  { Package: "com.a.rootful", Name: "Rootful Only", Version: "1", Architecture: "iphoneos-arm", Section: "Tweaks" },
  { Package: "com.a.util", Name: "beta util", Version: "2", Architecture: "all", Section: "Utility",
    Maintainer: "Sam Packager <sam@example.com>", Description: "a utility" },
  { Package: "com.a.theme", Name: "Gamma Theme", Version: "1", Architecture: "iphoneos-arm64", Section: "Themes_(Lockscreen)",
    Author: "jane dev", Description: "lock screen look" },
  { Package: "com.a.nosection", Version: "1", Architecture: "iphoneos-arm64", Description: "no section here" },
  { Package: "com.a.old", Name: "Old", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Tag: "cydia::obsolete" },
  { Package: "com.a.hidden", Name: "Hidden", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Tag: "purpose::x, role::cydia" },
);
const REPO_B = packages(
  { Package: "com.a.tweak", Name: "Alpha Tweak", Version: "1.10", Architecture: "iphoneos-arm64", Section: "Tweaks",
    Author: "Jane Dev <jane@example.com>", Description: "makes things alpha (B)\n long text about springboard" },
  { Package: "com.b.springy", Name: "Springy", Version: "3", Architecture: "iphoneos-arm64", Section: "Tweaks",
    Author: "Other <o@example.com>", Maintainer: "Jane Dev <jane@example.com>", Description: "bouncy icons" },
);

function loaded() {
  const c = createCatalog();
  assert.equal(c.load("A", REPO_A, "https://a.example/"), 4);
  assert.equal(c.load("B", REPO_B, "https://b.example/"), 2);
  return c;
}

test("section names follow Cydia: underscores, Sections.plist fixes, (No Section)", () => {
  assert.equal(sectionName("Utility"), "Utilities");
  assert.equal(sectionName("Themes_(Lockscreen)"), "Themes (LockScreen)");
  assert.equal(sectionName("Tweaks"), "Tweaks");
  assert.equal(sectionName("Some_New Section"), "Some New Section");
  assert.equal(sectionName(""), NO_SECTION);
  assert.equal(sectionName(undefined), NO_SECTION);
  assert.equal(simpleSection("Themes (SpringBoard)"), "Themes");
  assert.equal(simpleSection("[Beta]"), "Beta");
  assert.equal(simpleSection("(No Section)"), "No Section");
});

test("authors, visibility and index letters", () => {
  assert.deepEqual(parseAuthor("Jay Freeman (saurik) <saurik@saurik.com>"), { name: "Jay Freeman (saurik)", email: "saurik@saurik.com" });
  assert.deepEqual(parseAuthor("just a name"), { name: "just a name", email: "" });
  assert.deepEqual(parseAuthor("<only@mail>"), { name: "only@mail", email: "only@mail" });
  assert.equal(parseAuthor(""), null);
  assert.equal(isVisible({ tag: "purpose::extension, role::enduser" }), true);
  assert.equal(isVisible({ tag: "role::cydia" }), false);
  assert.equal(isVisible({ tag: "cydia::obsolete" }), false);
  assert.equal(isVisible({}), true);
  assert.equal(indexLetter("alpha"), "A");
  assert.equal(indexLetter("Écran"), "E");
  assert.equal(indexLetter("3D Touch"), "#");
});

test("load keeps this arch only, the newest version, and visible packages", () => {
  const c = loaded();
  const a = c.list("A");
  assert.deepEqual(ids(a), ["com.a.tweak", "com.a.util", "com.a.nosection", "com.a.theme"]);
  const tweak = a[0];
  assert.equal(tweak.version, "1.2");
  assert.equal(tweak.author, "Jane Dev");
  assert.equal(tweak.short, "makes things alpha");
  assert.equal(c.list("A").find((r) => r.id === "com.a.util").author, "Sam Packager", "maintainer when no author");
  assert.equal(Object.keys(tweak).some((k) => k.startsWith("_")), false, "search fields stay in the worker");
  // rootful arch sees the rootful package and the arch-all one
  const r = createCatalog();
  assert.equal(r.load("A", REPO_A, "https://a.example/", "iphoneos-arm"), 2);
});

test("sections group with counts, sorted by name; All Sources merges", () => {
  const c = loaded();
  assert.deepEqual(c.sections("A"), {
    total: 4,
    sections: [
      { name: NO_SECTION, count: 1 }, { name: "Themes (LockScreen)", count: 1 },
      { name: "Tweaks", count: 1 }, { name: "Utilities", count: 1 },
    ],
  });
  const all = c.sections(ALL);
  assert.equal(all.total, 5, "com.a.tweak counted once across sources");
  assert.deepEqual(all.sections.find((s) => s.name === "Tweaks"), { name: "Tweaks", count: 2 });
  assert.deepEqual(ids(c.list(ALL, "Tweaks")), ["com.a.tweak", "com.b.springy"]);
  assert.deepEqual(ids(c.list("A", NO_SECTION)), ["com.a.nosection"]);
  assert.equal(c.list("missing").length, 0);
});

test("All Sources picks the newest version (dpkg order: 1.10 > 1.2)", () => {
  const c = loaded();
  const p = c.package("com.a.tweak");
  assert.equal(p.stanza.version, "1.10");
  assert.equal(p.key, "B");
  assert.deepEqual(p.others, [{ key: "A", version: "1.2" }, { key: "B", version: "1.10" }]);
  const a = c.package("com.a.tweak", "A");
  assert.equal(a.stanza.version, "1.2");
  assert.equal(a.stanza.debUrl, "https://a.example/debs/alpha_1.2.deb");
  assert.equal(c.package("nope"), null);
  assert.deepEqual(c.has(["com.a.util", "libc", "com.b.springy"]), ["com.a.util", "com.b.springy"]);
});

test("search covers name, id, description and author, ranked", () => {
  const c = loaded();
  assert.deepEqual(ids(c.search("springy")), ["com.b.springy"]);
  assert.deepEqual(ids(c.search("com.a.ut")), ["com.a.util"], "id prefix");
  assert.deepEqual(ids(c.search("bouncy")), ["com.b.springy"], "short description");
  assert.deepEqual(ids(c.search("springboard")), ["com.a.tweak"], "long description");
  assert.deepEqual(ids(c.search("sam packager")), ["com.a.util"], "maintainer, all words");
  // exact name first, then name prefix, then the rest by name
  assert.deepEqual(ids(c.search("alpha tweak")), ["com.a.tweak"]);
  const jane = ids(c.search("jane"));
  assert.deepEqual(jane.sort(), ["com.a.theme", "com.a.tweak", "com.b.springy"].sort());
  const t = ids(c.search("ga"));
  assert.equal(t[0], "com.a.theme", "name or id prefix outranks a match inside");
  assert.deepEqual(c.search("   "), []);
  assert.deepEqual(c.search("zzz-nothing"), []);
  assert.equal(c.search("ja", { limit: 2 }).length, 2);
});

test("search: any non-blank query searches, one character too", () => {
  assert.equal(searchable(""), false);
  assert.equal(searchable("   "), false);
  assert.equal(searchable("x"), true);
  assert.equal(searchable("雪"), true);
  const c = loaded();
  assert.ok(c.search("g").length > 0);
  c.load("C", packages({ Package: "com.c.snow", Name: "雪板", Version: "1", Architecture: "iphoneos-arm64", Section: "Themes" }));
  assert.deepEqual(ids(c.search("雪")), ["com.c.snow"]);
});

test("search: word-start tier, then closest length, most sources, name (F101, Sileo)", () => {
  assert.equal(wordStart("snow board", "board"), true);
  assert.equal(wordStart("com.x.board", "board"), true);
  assert.equal(wordStart("keyboard plus", "board"), false);
  assert.equal(wordStart("board", "board"), false, "the start is the prefix tier's");
  assert.equal(wordStart("keyboard board", "board"), true, "a later match can start a word");
  const pkg = (id, name) => ({ Package: id, Name: name, Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks" });
  const c = createCatalog();
  c.load("A", packages(
    pkg("com.k.keyboardplus", "Keyboard Plus"),
    pkg("com.s.snowboardclassic", "Snowboard Classic Theme"),
    pkg("com.s.snowboard", "Snowboard"),
    pkg("com.w.snowb", "Snow Board"),
    pkg("com.b.boarder", "Boarder"),
    pkg("com.z.board2", "Zed Boards"),
    pkg("com.y.board3", "Yak Boards"),
  ));
  // the Yak is in a second source too: same length as Zed, so it goes first
  c.load("B", packages(pkg("com.y.board3", "Yak Boards")));
  assert.deepEqual(ids(c.search("board")), [
    "com.b.boarder",                                      // prefix
    "com.y.board3", "com.w.snowb", "com.z.board2",        // word start, all 10 long: 2 sources first, then by name
    "com.s.snowboard", "com.k.keyboardplus", "com.s.snowboardclassic", // inside: shortest first
  ]);
  // Sileo's example: the closer length wins inside the prefix tier
  assert.deepEqual(ids(c.search("snowb")), ["com.s.snowboard", "com.s.snowboardclassic", "com.w.snowb"]);
});

test("author lists every package by Author or Maintainer name, any case", () => {
  const c = loaded();
  assert.deepEqual(ids(c.author("Jane Dev")), ["com.a.tweak", "com.a.theme", "com.b.springy"]);
  assert.deepEqual(ids(c.author("other")), ["com.b.springy"]);
  assert.deepEqual(c.author(""), []);
});

test("B363: the author page keeps what can't work, marked, and spacing or case never hides a name", () => {
  const bigboss = packages(
    { Package: "com.bb.old", Name: "Old Rootful", Version: "1", Architecture: "iphoneos-arm", Section: "Tweaks",
      Author: "Someone <s@example.com>", Maintainer: "BigBoss <bigboss@thebigboss.org>" },
    { Package: "com.bb.case", Name: "Case Variant", Version: "1", Architecture: "iphoneos-arm", Section: "Tweaks",
      Maintainer: "Bigboss <bigboss@thebigboss.org>" },
    { Package: "com.bb.spaced", Name: "Spaced", Version: "1", Architecture: "all", Section: "Themes",
      Maintainer: "Big  Boss <bigboss@thebigboss.org>" },
    { Package: "com.bb.new", Name: "Any Arch", Version: "1", Architecture: "all", Section: "Tweaks",
      Maintainer: "BigBoss <bigboss@thebigboss.org>" },
  );
  const c = createCatalog();
  c.setDevice({ ios: "16.5", jailbreak: "rootless" });
  c.load("bb", bigboss, "http://apt.thebigboss.org/repofiles/cydia/", "iphoneos-arm");
  assert.deepEqual(ids(c.list()), ["com.bb.new", "com.bb.spaced"], "the fit filter is on: lists drop the rootful ones");
  const rows = c.author("BigBoss");
  assert.deepEqual(ids(rows), ["com.bb.new", "com.bb.case", "com.bb.old", "com.bb.spaced"]);
  assert.deepEqual(rows.map((r) => Boolean(r.misfit)), [false, true, true, false]);
  assert.ok(rows[1].why, "a misfit says why, for its subtitle");
  assert.equal(rows[0].why, undefined);
  assert.deepEqual(ids(c.author("  big   boss ")), ids(rows));
  assert.deepEqual(ids(c.author("Someone")), ["com.bb.old"]);
  // Filter off: the same rows, none marked.
  c.setDevice({ ios: "16.5", jailbreak: "rootless" }, { filter: false });
  assert.deepEqual(c.author("BigBoss").map((r) => [r.id, Boolean(r.misfit)]),
    [["com.bb.new", false], ["com.bb.case", false], ["com.bb.old", false], ["com.bb.spaced", false]]);
  // Sideload build: BigBoss as a Tweak Source. Its tweaks aren't in All Sources' apps, but their maintainer's page finds them.
  const lite = createCatalog();
  lite.setDevice({ ios: "27.0", jailbreak: "none" });
  lite.load("bb", bigboss, "http://apt.thebigboss.org/repofiles/cydia/", "iphoneos-arm", { tweaks: true });
  assert.equal(lite.list(ALL).length, 0);
  // (Only what the sideload build can inject loads from a Tweak Source: here the two iphoneos-arm tweaks.)
  assert.deepEqual(ids(lite.author("BigBoss")), ["com.bb.case", "com.bb.old"], "the Tweak Source's packages are listed");
});

test("reloading a source replaces it; removing drops it from All Sources", () => {
  const c = loaded();
  c.load("B", packages({ Package: "com.b.new", Name: "New", Version: "1", Architecture: "all" }), "https://b.example/");
  assert.equal(c.package("com.a.tweak").stanza.version, "1.2");
  assert.deepEqual(c.search("springy"), []);
  c.remove("A");
  assert.deepEqual(ids(c.list(ALL)), ["com.b.new"]);
  assert.deepEqual(c.keys(), ["B"]);
});

test("the worker runs catalog ops, with the Packages text as bytes", async () => {
  const bytes = new TextEncoder().encode(REPO_B).buffer;
  const r = reply({ id: 1, type: "catalog", op: "load", args: ["W", null, "https://b.example/", "iphoneos-arm64"], bytes });
  assert.deepEqual(r, { id: 1, ok: true, result: 2 });
  assert.equal(reply({ id: 2, type: "catalog", op: "search", args: ["bouncy"] }).result[0].id, "com.b.springy");
  assert.equal(reply({ id: 3, type: "catalog", op: "bogus" }).ok, false);
  // and through the parser's inline fallback (no Worker in node)
  const p = createParser({ Worker: null });
  assert.equal(await p.catalog("load", ["P", undefined, "https://a.example/"], REPO_A), 4);
  assert.equal((await p.catalog("sections", ["P"])).total, 4);
  await assert.rejects(p.catalog("nope"));
});

test("versions lists every source's candidate per id, for the Changes tab", () => {
  const c = createCatalog();
  c.load("a", REPO_A, "https://a.example/", "iphoneos-arm64");
  const v = c.versions();
  assert.deepEqual(v.find(([, id]) => id === "com.a.tweak"), ["a", "com.a.tweak", "1.2"]);
  assert.ok(!v.some(([, id]) => id === "com.a.rootful"));
  assert.deepEqual(reply({ id: 1, type: "catalog", op: "versions" }).ok, true);
});

test("Section Visibility: hidden sections leave sections, lists, search and author; package and has still see them", () => {
  const c = loaded();
  const before = c.sections(ALL);
  assert.equal(c.setHidden(["Tweaks", 42]), 1);
  const after = c.sections(ALL);
  assert.equal(after.sections.some((s) => s.name === "Tweaks"), false);
  assert.equal(after.total, before.total - 2); // com.a.tweak and com.b.springy
  const edit = c.sections(ALL, { hidden: true });
  assert.deepEqual(edit.sections.map((s) => s.name), before.sections.map((s) => s.name));
  assert.equal(edit.sections.find((s) => s.name === "Tweaks").hidden, true);
  assert.equal(edit.sections.find((s) => s.name === "Utilities").hidden, false);
  assert.equal(edit.total, after.total);
  assert.deepEqual(c.list(ALL, "Tweaks"), []);
  assert.equal(ids(c.list(ALL)).includes("com.a.tweak"), false);
  assert.equal(ids(c.list("B")).length, 0);
  assert.deepEqual(c.search("alpha"), []);
  assert.deepEqual(ids(c.author("Jane Dev")), ["com.a.theme"]); // her tweaks are hidden, her theme isn't
  assert.equal(ids(c.author("Sam Packager")).length, 1);
  assert.equal(c.package("com.a.tweak").row.id, "com.a.tweak");
  assert.deepEqual(c.has(["com.a.tweak"]), ["com.a.tweak"]);
  assert.equal(c.versions().some(([, id]) => id === "com.b.springy"), true, "Changes still files what it sees");
  // a reload keeps the hidden set; clearing it brings everything back
  c.load("B", REPO_B, "https://b.example/");
  assert.equal(ids(c.list("B")).length, 0);
  c.setHidden([]);
  assert.deepEqual(c.sections(ALL), before);
  assert.equal(c.search("alpha")[0].id, "com.a.tweak");
});

test("the worker takes setHidden as a catalog op", () => {
  reply({ id: 1, type: "catalog", op: "load", args: ["H", null, "https://b.example/"], text: REPO_B });
  assert.equal(reply({ id: 2, type: "catalog", op: "setHidden", args: [["Tweaks"]] }).result, 1);
  assert.deepEqual(reply({ id: 3, type: "catalog", op: "search", args: ["bouncy"] }).result, []);
  reply({ id: 4, type: "catalog", op: "setHidden", args: [[]] });
  reply({ id: 5, type: "catalog", op: "remove", args: ["H"] });
});

test("Works on my phone (F17): rows carry their code; the filter drops what can't work, keeps unknown", () => {
  const c = createCatalog();
  c.load("k", packages(
    { Package: "fits", Name: "Fits", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (>= 15.0)" },
    { Package: "old", Name: "Old Only", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (<< 15.0)" },
    { Package: "says-nothing", Name: "Says Nothing", Version: "1", Architecture: "all", Section: "Themes" },
    { Package: "too-new", Name: "Too New", Version: "1", Architecture: "iphoneos-arm64", Section: "Lonely", Depends: "firmware (>= 18.0)" },
  ), null);
  // before a device is set: no codes, nothing filtered
  assert.deepEqual(c.list().map((r) => [r.id, r.compat]), [["fits", null], ["old", null], ["says-nothing", null], ["too-new", null]]);
  assert.equal(c.setDevice({ ios: "16.5", jailbreak: "rootless" }), 2);
  assert.deepEqual(ids(c.list()), ["fits", "says-nothing"]);
  assert.deepEqual(c.list().map((r) => r.compat), ["works", "unknown"]);
  assert.deepEqual(ids(c.search("in")), ["says-nothing"]);
  assert.deepEqual(ids(c.search("ol")), []); // "Old Only" and "Too New" match but can't work
  assert.deepEqual(ids(c.search("ne")), []);
  // a section with nothing that fits drops out, and counts follow the filter
  assert.deepEqual(c.sections(), { total: 2, sections: [{ name: "Themes", count: 1 }, { name: "Tweaks", count: 1 }] });
  // the package page still finds what the filter hides
  assert.equal(c.package("old").stanza.package, "old");
  // filter off: everything back, each with its code
  c.setDevice({ ios: "16.5", jailbreak: "rootless" }, { filter: false });
  assert.deepEqual(c.list().map((r) => [r.id, r.compat]), [["fits", "works"], ["old", "ios"], ["says-nothing", "unknown"], ["too-new", "ios"]]);
  // through the worker's entry point too, and rows loaded later are judged on load
  assert.equal(reply({ id: 1, type: "catalog", op: "setDevice", args: [{ ios: "14.2", jailbreak: "rootless" }] }).ok, true);
  c.setDevice({ ios: "14.2", jailbreak: "rootless" });
  c.load("k2", packages({ Package: "later", Version: "1", Architecture: "iphoneos-arm64", Depends: "firmware (>= 15.0)" }), null);
  assert.equal(c.package("later").row.compat, "ios");
  assert.deepEqual(ids(c.list()), ["old", "says-nothing"]);
  c.setDevice(null);
  assert.equal(c.list().length, 5);
});

test("Search filters (F35): section and group, source, installed, paid", async () => {
  const { SECTION_GROUPS, sectionGroup } = await import("./catalog.js");
  assert.deepEqual(SECTION_GROUPS, ["Tweaks", "Themes", "Apps", "Utilities"]);
  assert.equal(sectionGroup("Themes (LockScreen)"), "Themes");
  assert.equal(sectionGroup("Tweaks"), "Tweaks");
  assert.equal(sectionGroup("Utilities"), "Utilities");
  assert.equal(sectionGroup("Applications"), "Apps");
  assert.equal(sectionGroup("Addons (SBSettings)"), null);
  const c = loaded();
  c.load("P", packages(
    { Package: "com.p.paid", Name: "Paid Alpha", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Tag: "cydia::commercial" },
  ), null);
  assert.deepEqual(ids(c.search("am", { section: "group:Themes" })), ["com.a.theme"]);
  assert.deepEqual(ids(c.search("ut", { section: "Utilities" })), ["com.a.util"]);
  assert.deepEqual(ids(c.search("alpha", { section: "group:Tweaks" })), ["com.a.tweak", "com.p.paid"]);
  assert.deepEqual(ids(c.search("alpha", { price: "paid" })), ["com.p.paid"]);
  assert.deepEqual(ids(c.search("alpha", { price: "free" })), ["com.a.tweak"]);
  assert.equal(c.search("paid")[0].paid, true);
  // source: that source's own rows (its own version), and nothing for a source that isn't loaded
  assert.deepEqual(c.search("alpha", { source: "A" }).map((r) => [r.id, r.version, r.key]), [["com.a.tweak", "1.2", "A"]]);
  assert.deepEqual(c.search("alpha", { source: "nope" }), []);
  // installed / not installed: from dpkg's status file; before one came, nothing is installed
  assert.deepEqual(ids(c.search("alpha", { installed: "installed" })), []);
  c.setInstalled(stanza({ Package: "com.a.tweak", Status: "install ok installed", Version: "1.0", Architecture: "iphoneos-arm64" }) + "\n");
  assert.deepEqual(ids(c.search("alpha", { installed: "installed" })), ["com.a.tweak"]);
  assert.deepEqual(ids(c.search("alpha", { installed: "not" })), ["com.p.paid"]);
  // hidden sections stay out of a filtered search too
  c.setHidden(["Tweaks"]);
  assert.deepEqual(ids(c.search("alpha")), []);
});

test("Search (F35): incompatible packages are hidden by default, except an exact name or id match, which says why", () => {
  const c = createCatalog();
  c.load("k", packages(
    { Package: "com.old.flex", Name: "Flex", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (<= 15)" },
    { Package: "com.new.flexall", Name: "FlexAll", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (>= 14.0)" },
    { Package: "com.old.flexer", Name: "Flexer", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (<< 15.0)" },
  ), null);
  c.setDevice({ ios: "16.5", jailbreak: "rootless" });
  // "flex" is Flex's exact name: it stays, first, with the reason; Flexer can't work and only starts with it
  const rows = c.search("flex");
  assert.deepEqual(ids(rows), ["com.old.flex", "com.new.flexall"]);
  assert.equal(rows[0].exact, true);
  assert.equal(rows[0].compat, "ios");
  assert.equal(rows[0].why, "Needs iOS 15 or earlier");
  assert.equal(rows[1].exact, undefined);
  // an exact id works the same way
  assert.deepEqual(ids(c.search("com.old.flexer")), ["com.old.flexer"]);
  assert.equal(c.search("com.old.flexer")[0].why, "Needs iOS older than 15.0");
  // Show Incompatible (the filter off): everything, the exact match still flagged; Flexer is closer in length
  c.setDevice({ ios: "16.5", jailbreak: "rootless" }, { filter: false });
  assert.deepEqual(ids(c.search("flex")), ["com.old.flex", "com.old.flexer", "com.new.flexall"]);
  assert.equal(c.search("flex")[0].exact, true);
  // a package that works is never flagged, exact or not
  c.setDevice({ ios: "14.2", jailbreak: "rootless" });
  assert.equal(c.search("flex")[0].exact, undefined);
});

// ---- F37: Device type. Not Jailbroken sees AltStore apps only; a jailbroken type sees its arch's debs and apps. ----

const ALT_KEY = "alt:https://apps.example/source.json";
const ALT_JSON = JSON.stringify({
  name: "Apps", identifier: "com.example.apps",
  apps: [
    { name: "Delta", bundleIdentifier: "com.example.delta", developerName: "Riley", localizedDescription: "a springboard-free emulator",
      versions: [{ version: "1.5", date: "2026-01-01", downloadURL: "https://apps.example/Delta.ipa", size: 1000, minOSVersion: "14.0" }] },
  ],
});
const STATUS = "Package: com.a.tweak\nStatus: install ok installed\nVersion: 1.0\nArchitecture: iphoneos-arm64\n\n";

function withApps(arch) {
  const c = createCatalog();
  c.load("A", REPO_A, "https://a.example/", arch);
  c.load("B", REPO_B, "https://b.example/", arch);
  c.loadAlt(ALT_KEY, ALT_JSON, "16.5");
  c.setInstalled(STATUS);
  return c;
}

test("Not Jailbroken: only AltStore apps, everywhere, whatever the Works on My Phone switch says", () => {
  for (const filter of [true, false]) {
    const c = withApps("iphoneos-arm64");
    c.setDevice({ ios: "16.5", jailbreak: "none" }, { filter });
    assert.deepEqual(ids(c.list(ALL, ALL)), ["com.example.delta"], `filter ${filter}`);
    assert.deepEqual(c.sections(ALL).sections.map((s) => s.name), [c.list(ALL, ALL)[0].section]);
    assert.deepEqual(ids(c.list("A", ALL)), [], "an APT source's own list is empty");
    assert.deepEqual(ids(c.search("alpha")), [], "search finds no debs");
    assert.deepEqual(ids(c.search("com.a.tweak")), [], "not even an exact id match");
    assert.deepEqual(ids(c.search("springboard")), ["com.example.delta"]);
    assert.deepEqual(ids(c.search("alpha", { source: "A" })), []);
    assert.deepEqual(ids(c.author("jane dev")), []);
    assert.equal(c.package("com.a.tweak", ALL)?.key ?? null, null, "no deb page through the merge");
    assert.deepEqual(c.upgrades().available, [], "installed upgrades hide debs");
    assert.equal(c.package("com.example.delta", ALL).key, ALT_KEY);
  }
});

test("Jailbroken (Rootless): arm64 debs and apps; Rootful: arm debs and apps", () => {
  const rootless = withApps("iphoneos-arm64");
  rootless.setDevice({ ios: "16.5", jailbreak: "rootless" });
  assert.deepEqual(ids(rootless.list(ALL, ALL)).sort(),
    ["com.a.nosection", "com.a.theme", "com.a.tweak", "com.a.util", "com.b.springy", "com.example.delta"]);
  assert.deepEqual(ids(rootless.upgrades().available), ["com.a.tweak"]);
  assert.deepEqual(ids(rootless.search("alpha")), ["com.a.tweak"]);

  const rootful = withApps("iphoneos-arm");
  rootful.setDevice({ ios: "16.5", jailbreak: "rootful" });
  assert.deepEqual(ids(rootful.list(ALL, ALL)).sort(), ["com.a.rootful", "com.a.util", "com.example.delta"]);
});

test("switching back from Not Jailbroken brings the debs back (caches dropped)", () => {
  const c = withApps("iphoneos-arm64");
  c.setDevice({ ios: "16.5", jailbreak: "rootless" });
  assert.equal(c.list(ALL, ALL).length, 6);
  c.setDevice({ ios: "16.5", jailbreak: "none" });
  assert.equal(c.list(ALL, ALL).length, 1);
  assert.equal(c.sections("A").total, 0);
  c.setDevice({ ios: "16.5", jailbreak: "rootless" });
  assert.equal(c.list(ALL, ALL).length, 6);
  assert.equal(c.sections("A").total, 4);
});

// F16a: the worker's loadAlt takes the source record's format as args[3], so Scarlet, ESign and GBox sources are
// rows like AltStore ones, with their own fields kept as `extra`; no format is AltStore (records from before F16a).
test("F16a: loadAlt reads each IPA format by the record's format", async () => {
  const { parseIpaSource } = await import("./sources/ipa.js");
  const src = (f) => readFileSync(new URL(`./fixtures/sources/${f}`, import.meta.url), "utf8");
  const c = createCatalog();
  for (const [file, format] of [["scarlet-locus.json", "scarlet"], ["gbox-qoli.json", "gbox"], ["esign-zeeho.json", "esign"], ["altstore-classic.json", null]]) {
    const key = `alt:https://x.dev/${file}`;
    const want = parseIpaSource(format ?? "altstore", JSON.parse(src(file)));
    const n = runCatalog(c, "loadAlt", [key, src(file), null, format]);
    assert.equal(n, new Set(want.apps.map((a) => a.id)).size, file);
    const app = want.apps[0];
    const p = c.package(app.id, key);
    assert.equal(p.stanza.kind, "ipa", file);
    assert.deepEqual(p.stanza.ipa.extra, app.extra, file);
    assert.equal(c.altSource(key).format, format ?? "altstore", file);
  }
  assert.equal(c.list(ALL).filter((r) => r.kind === "ipa").length > 0, true);
  // Scarlet JSON read as AltStore has no apps list: refused, not loaded empty.
  assert.throws(() => runCatalog(c, "loadAlt", ["alt:https://x.dev/wrong", src("scarlet-locus.json"), null, null]), /AltStore/);
});

// B364: Havoc's paid Aerial (jp.uzra.aerial, cydia::commercial, iphoneos-arm64) and the rootful Aerial 2
// (com.polytweaks.aerial2, iphoneos-arm), from a cut of Havoc's real Packages.
test("search finds Havoc's paid Aerial in the jailbreak and sideload builds (B364)", () => {
  const havoc = readFileSync(new URL("./fixtures/paid/havoc-Packages", import.meta.url), "utf8") + "\n" + packages(
    { Package: "com.mikifp.griddy", Name: "Griddy", Version: "1.0.5", Architecture: "iphoneos-arm64", Section: "Tweaks",
      Depends: "mobilesubstrate", Tag: "cydia::commercial", Description: "Place icons anywhere" },
    { Package: "com.nicho1asdev.novus", Name: "Novus", Version: "1.0", Architecture: "iphoneos-arm64", Section: "Tweaks",
      Depends: "mobilesubstrate (>= 0.9.5000), com.muirey03.libmryipc", Tag: "cydia::commercial", Description: "Notifications, redesigned" },
  );
  // Jailbreak (rootless): any case, paid, newest version, and still there with Works on My Phone on.
  const jb = createCatalog();
  jb.load("https://havoc.app/", havoc, "https://havoc.app/", "iphoneos-arm64");
  for (const q of ["aerial", "Aerial", " AERIAL "]) {
    const hits = jb.search(q);
    assert.deepEqual(ids(hits), ["jp.uzra.aerial"], q);
    assert.equal(hits[0].paid, true);
  }
  assert.equal(jb.search("aerial")[0].version, "5.1");
  assert.deepEqual(ids(jb.search("stage manager")), ["jp.uzra.aerial"], "by its description");
  assert.deepEqual(ids(jb.search("aerial", { price: "paid", section: "group:Tweaks" })), ["jp.uzra.aerial"]);
  jb.setDevice({ ios: "16.5", jailbreak: "rootless" });
  assert.deepEqual(ids(jb.search("aerial")), ["jp.uzra.aerial"]);
  // Other paid Havoc tweaks too.
  for (const [q, id] of [["griddy", "com.mikifp.griddy"], ["Novus", "com.nicho1asdev.novus"]]) assert.deepEqual(ids(jb.search(q)), [id], q);
  // Aerial 2 is built for rootful only: a rootful device finds it, a rootless one doesn't.
  const rootful = createCatalog();
  rootful.load("https://havoc.app/", havoc, "https://havoc.app/", "iphoneos-arm");
  assert.deepEqual(ids(rootful.search("aerial")), ["com.polytweaks.aerial2"]);
  // Sideload: Havoc as a Tweak Source. An unfiltered Search finds its tweaks beside the apps (they used to be left
  // out, and Other Sources leaves out what an added source lists, so Aerial was nowhere).
  const lite = createCatalog();
  lite.setDevice({ ios: "27.0", jailbreak: "none" });
  lite.load("https://havoc.app/", havoc, "https://havoc.app/", "iphoneos-arm64", { tweaks: true });
  lite.loadAlt("alt:https://apps.example/", JSON.stringify({ name: "Apps", apps: [{ name: "Aerial Photos", bundleIdentifier: "com.x.aerialphotos",
    developerName: "X", version: "1.0", downloadURL: "https://apps.example/a.ipa", localizedDescription: "drone shots" }] }));
  assert.deepEqual(ids(lite.search("Aerial")), ["jp.uzra.aerial", "com.polytweaks.aerial2", "com.x.aerialphotos"]);
  assert.deepEqual(ids(lite.search("aerial", { price: "paid" })), ["jp.uzra.aerial", "com.polytweaks.aerial2"]);
  assert.deepEqual(ids(lite.search("aerial", { section: "group:Apps" })), ["com.x.aerialphotos"], "Apps keeps the apps");
  assert.deepEqual(ids(lite.search("aerial", { source: "https://havoc.app/" })), ["jp.uzra.aerial", "com.polytweaks.aerial2"]);
  assert.deepEqual(ids(lite.search("griddy")), ["com.mikifp.griddy"]);
  assert.deepEqual(ids(lite.search("novus")), [], "needs a library the sideload build can't bring");
  assert.equal(lite.list(ALL).length, 1, "All Packages stays the apps");
  lite.setHidden(["App Tweaks"]);
  assert.deepEqual(ids(lite.search("aerial")), ["com.x.aerialphotos"], "a hidden App Tweaks stays out");
});
