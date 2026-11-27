// F46: Home's Browse: the category merge (AltStore categories + APT sections) and the Popular ranking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog, runCatalog, browseCategory, mergeCategories, rankPopular, MIN_TIER, BROWSE_CATEGORIES, ALL } from "./catalog.js";
import { appSection } from "./altstore.js";

const stanza = (f) => Object.entries(f).map(([k, v]) => `${k}: ${v}`).join("\n");
const packages = (...list) => list.map(stanza).join("\n\n") + "\n";
const ids = (rows) => rows.map((r) => r.id);
const deb = (id, section, extra = {}) => ({ Package: id, Name: id, Version: "1", Architecture: "iphoneos-arm64", Section: section, ...extra });

test("browseCategory: AltStore categories and APT sections land in one short list", () => {
  const cat = (section, name = "x", short = "") => browseCategory({ section, name, short });
  // AltStore's categories, as core/altstore.js files them
  assert.equal(cat(appSection("games")), "Games");
  assert.equal(cat(appSection("social")), "Social");
  assert.equal(cat(appSection("utilities")), "Utilities");
  assert.equal(cat(appSection("photo-video")), "Photo & Video");
  assert.equal(cat(appSection("developer")), "Developer");
  assert.equal(cat(appSection(null)), "Other");
  assert.equal(cat(appSection("other")), "Other");
  assert.equal(cat(appSection("weird-new-one")), "Other", "an app category we don't know is still an app");
  // APT sections, Cydia's names after sectionName
  assert.equal(cat("Tweaks"), "Tweaks");
  assert.equal(cat("Addons (SBSettings)"), "Tweaks");
  assert.equal(cat("Themes (SpringBoard)"), "Themes");
  assert.equal(cat("Wallpaper"), "Themes");
  assert.equal(cat("Utilities"), "Utilities");
  assert.equal(cat("Games"), "Games");
  assert.equal(cat("Development"), "Developer");
  assert.equal(cat("Terminal Support"), "Developer");
  assert.equal(cat("Social"), "Social");
  assert.equal(cat("Emulators"), "Emulators");
  assert.equal(cat("Libraries"), null, "plumbing stays out of Browse");
  assert.equal(cat("(No Section)"), null);
  // Emulators: no source has the category, so the name or subtitle decides
  assert.equal(cat(appSection("games"), "Delta", "Nintendo emulator"), "Emulators");
  assert.equal(cat(appSection("utilities"), "UTM", "Virtual machines and emulation"), "Emulators");
  assert.equal(cat("Games", "PPSSPP Emulator"), "Emulators");
  assert.equal(cat("Tweaks", "x", "emulator-like keyboard"), "Tweaks", "a tweak stays a tweak");
  assert.equal(cat(appSection("social"), "x", "emulates nothing"), "Social");
});

test("mergeCategories: fixed order, counts, empty ones out, tweak categories out while Not Jailbroken", () => {
  const rows = [
    { section: "Tweaks" }, { section: "Tweaks" }, { section: "Themes (Apps)" }, { section: "Apps (Games)" },
    { section: "Games", name: "GBA4iOS", short: "emulator" }, { section: "Apps (Social)" }, { section: "Libraries" },
  ];
  assert.deepEqual(mergeCategories(rows), [
    { name: "Games", count: 1 }, { name: "Emulators", count: 1 }, { name: "Social", count: 1 },
    { name: "Themes", count: 1 }, { name: "Tweaks", count: 2 },
  ]);
  assert.deepEqual(mergeCategories(rows, { jailbroken: false }).map((c) => c.name), ["Games", "Emulators", "Social"]);
  assert.deepEqual(mergeCategories([]), []);
  // the list really is short
  assert.ok(BROWSE_CATEGORIES.length <= 12);
});

test("rankPopular: most sources first, then newest update, then name; capped", () => {
  const item = (name, sources, date = null) => ({ row: { id: name.toLowerCase(), name }, sources, date });
  const ranked = rankPopular([
    item("Zed", 1), item("Alpha", 1), item("Wide", 3), item("Newer", 2, 2000), item("Older", 2, 1000), item("Undated", 2),
  ]);
  assert.deepEqual(ranked.map((i) => i.row.name), ["Wide", "Newer", "Older", "Undated", "Alpha", "Zed"]);
  assert.equal(rankPopular([item("a", 1), item("b", 2), item("c", 3)], 2).length, 2);
});

test("F450 rankPopular: rated first (highest average, then most ratings), the unrated after by sources", () => {
  const item = (name, sources, rating = null) => ({ row: { id: name.toLowerCase(), name }, sources, date: null, rating });
  const ranked = rankPopular([
    item("Wide", 5), item("Liked", 1, { avg: 4, count: 3 }), item("Loved", 1, { avg: 5, count: 1 }),
    item("Liked More", 1, { avg: 4, count: 9 }), item("Narrow", 1),
  ]);
  assert.deepEqual(ranked.map((i) => i.row.name), ["Liked More", "Loved", "Liked", "Wide", "Narrow"]);
});

const REPO_A = packages(
  deb("com.x.shared", "Tweaks", { Name: "Shared Tweak" }),
  deb("com.x.theme", "Themes_(SpringBoard)", { Name: "A Theme" }),
  deb("com.x.lib", "Libraries", { Name: "libthing" }),
  deb("com.x.old", "Tweaks", { Name: "Old", Architecture: "iphoneos-arm" }),
);
const REPO_B = packages(deb("com.x.shared", "Tweaks", { Name: "Shared Tweak", Version: "2" }), deb("com.x.util", "Utilities", { Name: "Util" }));
const REPO_C = packages(deb("com.x.shared", "Tweak", { Name: "Shared Tweak" }), deb("com.x.util", "Utility", { Name: "Util" }));
const ALT_KEY = "alt:https://apps.example/source.json";
const ALT_JSON = JSON.stringify({
  name: "Apps", identifier: "com.example.apps",
  apps: [
    { name: "Delta", bundleIdentifier: "com.example.delta", developerName: "R", subtitle: "Nintendo emulator", category: "games",
      localizedDescription: "plays games", versions: [{ version: "1.5", date: "2026-01-01", downloadURL: "https://apps.example/d.ipa", size: 1, minOSVersion: "14.0" }] },
    { name: "Chat", bundleIdentifier: "com.example.chat", developerName: "R", category: "social",
      localizedDescription: "talk", versions: [{ version: "2", date: "2026-06-01", downloadURL: "https://apps.example/c.ipa", size: 1 }] },
    { name: "Solitaire", bundleIdentifier: "com.example.cards", developerName: "R", category: "games",
      localizedDescription: "cards", versions: [{ version: "1", date: "2025-01-01", downloadURL: "https://apps.example/s.ipa", size: 1 }] },
  ],
});

function loaded() {
  const c = createCatalog();
  c.load("A", REPO_A, "https://a.example/");
  c.load("B", REPO_B, "https://b.example/");
  c.load("C", REPO_C, "https://c.example/");
  c.loadAlt(ALT_KEY, ALT_JSON, "16.5");
  return c;
}

test("catalog.categories and browse: the merged list over every source, with lists per category", () => {
  const c = loaded();
  assert.deepEqual(c.categories(), [
    { name: "Games", count: 1 }, { name: "Emulators", count: 1 }, { name: "Social", count: 1 },
    { name: "Utilities", count: 1 }, { name: "Themes", count: 1 }, { name: "Tweaks", count: 1 },
  ]);
  assert.deepEqual(ids(c.browse("Tweaks")), ["com.x.shared"]);
  assert.equal(c.browse("Tweaks")[0].version, "2", "the newest version across sources, like All Packages");
  assert.deepEqual(ids(c.browse("Games")), ["com.example.cards"]);
  assert.deepEqual(ids(c.browse("Emulators")), ["com.example.delta"]);
  assert.deepEqual(ids(c.browse("Nonsense")), []);
  // hidden sections drop out of Browse too (Section Visibility)
  c.setHidden(["Tweaks"]);
  assert.equal(c.categories().find((x) => x.name === "Tweaks"), undefined);
  assert.deepEqual(ids(c.browse("Tweaks")), []);
  // through the worker's entry point
  assert.deepEqual(runCatalog(c, "browse", ["Social"]).map((r) => r.id), ["com.example.chat"]);
  assert.ok(Array.isArray(runCatalog(c, "categories")));
});

test("Not Jailbroken: Browse hides tweak categories and lists apps only", () => {
  const c = loaded();
  c.setDevice({ ios: "16.5", jailbreak: "none" });
  assert.deepEqual(c.categories().map((x) => x.name), ["Games", "Emulators", "Social"]);
  assert.deepEqual(ids(c.browse("Tweaks")), []);
  assert.deepEqual(ids(c.browse("Themes")), []);
  assert.deepEqual(ids(c.popular()), ["com.example.chat", "com.example.delta", "com.example.cards"], "apps, newest update first");
});

test("catalog.popular: what most sources list first, each row with its source count", () => {
  const c = loaded();
  const top = c.popular();
  assert.deepEqual(top.slice(0, 2).map((r) => [r.id, r.sources]), [["com.x.shared", 3], ["com.x.util", 2]]);
  // then the one-source rows: dated apps newest first, then the rest by name
  assert.deepEqual(ids(top.slice(2, 5)), ["com.example.chat", "com.example.delta", "com.example.cards"]);
  assert.deepEqual(ids(top.slice(5)), ["com.x.theme", "com.x.lib"], "A Theme before libthing, by name");
  assert.equal(c.popular({ limit: 1 }).length, 1);
  assert.equal(top.find((r) => r.id === "com.x.old"), undefined, "packages for another arch are not in the catalog");
  assert.deepEqual(runCatalog(c, "popular", [{ limit: 2 }]).map((r) => r.id), ["com.x.shared", "com.x.util"]);
  assert.equal(ALL, "*");
  // F450: the stars given here come first (catalog.js passes the review server's { id: [average, count] })
  const rated = c.popular({ ratings: { "com.x.lib": [4.5, 2], "com.example.cards": [5, 1], "com.x.none": [3, 1] } });
  assert.deepEqual(ids(rated.slice(0, 4)), ["com.example.cards", "com.x.lib", "com.x.shared", "com.x.util"]);
});

test("F452 rankPopular: tiers: over 5 ratings by rating, then over 5 installs by installs, then the rest", () => {
  const item = (name, installs, rating = null, sources = 1) => ({ row: { id: name.toLowerCase(), name }, sources, date: null, rating, installs });
  const ranked = rankPopular([
    item("Few Rated", 0, { avg: 5, count: 5 }), item("One", 1), item("Wide", 3, null, 4), item("Five", 5),
    item("Big", 50), item("Mid", 9, { avg: 5, count: 2 }), item("Top", 0, { avg: 4.5, count: 6 }),
    item("Top More", 100, { avg: 4.5, count: 20 }), item("Low", 1000, { avg: 2, count: 8 }),
  ]);
  assert.deepEqual(ranked.map((i) => i.row.name), ["Top More", "Top", "Low", "Big", "Mid", "Few Rated", "Wide", "Five", "One"]);
  assert.equal(MIN_TIER, 5);
});
