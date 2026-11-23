// B341: All Sources' Sections page and Search's Section filter list Tweaks in the jailbreak build and App Tweaks
// (the Tweak Sources' injectable app tweaks) in the sideload build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog, ALL, APP_TWEAKS, sectionGroup } from "./catalog.js";

const TWEAKS = [
  "Package: com.x.yt\nName: YTLite\nArchitecture: iphoneos-arm64\nSection: Tweaks\nVersion: 1\nDepends: mobilesubstrate\n",
  "Package: com.x.ig\nName: IGLite\nArchitecture: iphoneos-arm64\nSection: Tweak\nVersion: 2\nDepends: mobilesubstrate\n",
  "Package: com.x.theme\nName: Glow\nArchitecture: iphoneos-arm64\nSection: Themes\nVersion: 1\n",
].join("\n");
const TWEAK_KEY = "deb:https://repo.x/:./";
const names = (c) => c.sections(ALL).sections.map((s) => s.name);

test("jailbreak build: a Tweak or Tweaks section shows as Tweaks under All Sources, with no App Tweaks", () => {
  const c = createCatalog();
  c.setDevice({ ios: "16.5", jailbreak: "rootless" });
  c.load(TWEAK_KEY, TWEAKS, "https://repo.x/", "iphoneos-arm64");
  assert.deepEqual(c.sections(ALL).sections, [{ name: "Themes", count: 1 }, { name: "Tweaks", count: 2 }]);
  assert.deepEqual(c.list(ALL, "Tweaks").map((r) => r.id), ["com.x.ig", "com.x.yt"]);
  assert.deepEqual(c.search("lite", { section: "Tweaks" }).map((r) => r.id).sort(), ["com.x.ig", "com.x.yt"]);
  assert.deepEqual(c.list(ALL, APP_TWEAKS), []);
});

test("sideload build: All Sources gets an App Tweaks section of the Tweak Sources' injectable tweaks", () => {
  const c = createCatalog();
  c.setDevice({ ios: "17.0", jailbreak: "none" });
  c.load(TWEAK_KEY, TWEAKS, "https://repo.x/", "iphoneos-arm64", { tweaks: true });
  assert.deepEqual(c.sections(ALL), { total: 0, sections: [{ name: APP_TWEAKS, count: 2 }] });
  assert.deepEqual(c.sections(TWEAK_KEY).sections.map((s) => s.name), ["Tweaks"], "the source's own page keeps its sections");
  assert.deepEqual(c.list(ALL, APP_TWEAKS).map((r) => r.id), ["com.x.ig", "com.x.yt"]);
  assert.equal(c.list(ALL, ALL).length, 0, "All Packages stays the apps");
  // A tweak opened from App Tweaks (package/<id> under All Sources) has its page, its versions and its deps.
  assert.equal(c.package("com.x.yt", ALL).stanza.injectable, true);
  assert.equal(c.history("com.x.ig", ALL).versions.length, 1);
  // Search: the App Tweaks choice (and All Tweaks) search them; no filter keeps them out, as before.
  assert.deepEqual(c.search("lite", { section: APP_TWEAKS }).map((r) => r.id), ["com.x.ig", "com.x.yt"]);
  assert.deepEqual(c.search("lite", { section: "group:Tweaks" }).map((r) => r.id), ["com.x.ig", "com.x.yt"]);
  assert.deepEqual(c.search("lite"), []);
  assert.equal(sectionGroup(APP_TWEAKS), "Tweaks");
});

test("sideload build: App Tweaks follows Section Visibility, Block and the newest version", () => {
  const c = createCatalog();
  c.setDevice({ ios: "17.0", jailbreak: "none" });
  c.load(TWEAK_KEY, TWEAKS, "https://repo.x/", "iphoneos-arm64", { tweaks: true });
  c.load("deb:https://repo.y/:./", TWEAKS.replace("Version: 1\nDepends", "Version: 9\nDepends"), "https://repo.y/", "iphoneos-arm64", { tweaks: true });
  assert.equal(c.list(ALL, APP_TWEAKS).find((r) => r.id === "com.x.yt").version, "9");
  c.setBlocked(["com.x.ig"]);
  assert.deepEqual(c.sections(ALL).sections, [{ name: APP_TWEAKS, count: 1 }]);
  c.setHidden([APP_TWEAKS]);
  assert.deepEqual(names(c), []);
  assert.deepEqual(c.sections(ALL, { hidden: true }).sections, [{ name: APP_TWEAKS, count: 1, hidden: true }]);
  assert.deepEqual(c.list(ALL, APP_TWEAKS), []);
  assert.deepEqual(c.search("lite", { section: APP_TWEAKS }), []);
  // A tweak whose own section is hidden (from its source's page) leaves the count and the list alike.
  c.setHidden(["Tweaks"]);
  assert.deepEqual(names(c), [], "no App Tweaks row counting tweaks its list would leave out");
  assert.deepEqual(c.list(ALL, APP_TWEAKS), []);
  // A Tweak Source loaded after the section was built shows at once.
  c.setHidden([]);
  c.setBlocked([]);
  c.load("deb:https://repo.z/:./", "Package: com.z.new\nName: NewLite\nArchitecture: iphoneos-arm64\nSection: Tweaks\nVersion: 1\nDepends: mobilesubstrate\n",
    "https://repo.z/", "iphoneos-arm64", { tweaks: true });
  assert.deepEqual(c.list(ALL, APP_TWEAKS).map((r) => r.id), ["com.x.ig", "com.z.new", "com.x.yt"]);
  assert.deepEqual(c.sections(ALL).sections, [{ name: APP_TWEAKS, count: 3 }]);
  // Back to a jailbroken device: Tweak Sources are reloaded as plain sources there, so no App Tweaks.
  c.setHidden([]);
  c.setDevice({ ios: "17.0", jailbreak: "rootless" });
  assert.equal(names(c).includes(APP_TWEAKS), false);
});
