import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIDES, guideRows } from "./guides.js";
import { nav, CURATED_SOURCES, deviceHint, DEVICE_HINT, showsThemes, versionLimits } from "./home.js";

test("B295: Home's green row is always More Sources, opening Sources > More on Home's stack", async () => {
  const { MORE_SOURCES_TILE } = await import("./home.js");
  assert.deepEqual(MORE_SOURCES_TILE, { label: "More Sources", href: "#/sources/more", glyph: "more" });
  const { readFileSync } = await import("node:fs");
  const js = readFileSync(new URL("./home.js", import.meta.url), "utf8");
  assert.match(js, /tileRow\("green", tile\(MORE_SOURCES_TILE\)\)/);
  // no state tile left: none of its words, and nothing repaints the row from the sources or upgrades
  for (const gone of ["stateTile", "paintTile", "Loading Sources", "Add a Source", "Upgrades Available", "Failed to Load",
    "Everything Up to Date"]) assert.ok(!js.includes(gone), gone);
});

test("Home pages: titles below the root, and curated sources are flat repos with Cydia keys", () => {
  assert.equal(nav({ tab: "home", path: [] }, {}).left.label, "About");
  assert.equal(nav({ tab: "home", path: ["help"] }).title, "Help");
  assert.equal(nav({ tab: "home", path: ["credits"] }).title, "Credits");
  // Every User Guides row opens a guide that exists, titled by it.
  for (const r of guideRows((x) => x.path.join("/"))) {
    const [, id] = r.href.split("/");
    assert.ok(GUIDES[id], id);
    assert.ok(nav({ tab: "home", path: ["guides", id] }).title, id); // F157: guides.test.js checks the titles per set
  }
  assert.equal(nav({ tab: "home", path: ["sources"] }).title, "More Sources");
  for (const s of CURATED_SOURCES) {
    assert.match(s.uri, /^https:\/\/.+\/$/);
    assert.equal(s.key, `deb:${s.uri}:./`);
  }
});

test("F37: Home's hint shows while Not Jailbroken and taps through to Settings > Device", () => {
  assert.equal(deviceHint("none"), null, "the website: no hint (Jailbroken? Get iFizBox.deb instead)");
  assert.deepEqual(deviceHint("none", "jailbreak"), { text: DEVICE_HINT, href: "#/home/settings/device" });
  assert.equal(DEVICE_HINT, "Showing apps for iPhones without a jailbreak. Jailbroken? Settings > Device.");
  assert.equal(deviceHint("iphoneos-arm64"), null);
  assert.equal(deviceHint("iphoneos-arm"), null);
  assert.equal(deviceHint("none", "sideload"), null, "the sideload build has no choice to make");
});

test("F41: Home offers Themes only on a jailbroken type", () => {
  assert.equal(showsThemes("none"), false);
  assert.equal(showsThemes("iphoneos-arm64"), true);
  assert.equal(showsThemes("iphoneos-arm"), true);
});

test("F79/F212: Home links to Install IPAs in every build, the jailbreak app too", async () => {
  const { ipasTile } = await import("./home.js");
  assert.deepEqual(ipasTile("site"), { label: "Install IPAs", href: "#/installed/myipas" });
  assert.deepEqual(ipasTile("sideload"), { label: "Install IPAs", href: "#/installed/myipas" });
  assert.deepEqual(ipasTile("jailbreak"), { label: "Install IPAs", href: "#/installed/myipas" });
});

test("Jailbroken? Get iFizBox.deb: iFizBox's APT repo in Sileo and Zebra", async () => {
  const { repoLinks, IFIZBOX_APT_REPO, JAILBROKEN_SHEET } = await import("./home.js");
  assert.equal(IFIZBOX_APT_REPO, "https://ifizbox.com/repo/");
  assert.deepEqual(repoLinks("https://r/"), { sileo: "sileo://source/https://r/", zebra: "zbra://sources/add/https://r/",
    sileoPackage: "sileo://package/com.ryha.ifizbox", zebraPackage: "zbra://packages/com.ryha.ifizbox" });
  assert.deepEqual(JAILBROKEN_SHEET.buttons, ["Add to Sileo", "Add to Zebra", "Copy Repo URL", "Download .deb"]);
});

test("F123/F135: Home's list starts with Settings in its own group, with its icon; Credits ends it", async () => {
  const { homeLinks } = await import("./home.js");
  const groups = homeLinks();
  const { rowIcon } = await import("../icons/rowicons.js");
  assert.deepEqual(groups[0], { pair: true, rows: [{ label: "Settings", href: "#/home/settings", icon: rowIcon("general"), cls: "home-settings-row" },
    { label: "Theme", href: "#/home/settings/theme", icon: { cls: "home-glyph glyph-theme" }, cls: "home-settings-row" }] });
  assert.equal(groups[1].rows[0].label, "Upgrading & Jailbreaking Help", "the help links come right after Settings");
  assert.equal(groups[2].header, "User Guides");
  assert.equal(groups.at(-1).rows[0].label, "Credits / Thank You");
  assert.equal(groups.at(-1).rows.length, 1);
});

test("F123: the Signing tile shows only while signing isn't set up, where something signs", async () => {
  const { showsSigningTile, signingSetUp } = await import("./home.js");
  assert.equal(showsSigningTile("site"), true);
  assert.equal(showsSigningTile("sideload", false), true);
  assert.equal(showsSigningTile("site", true), false);
  assert.equal(showsSigningTile("sideload", true), false);
  assert.equal(showsSigningTile("jailbreak", false), false);
  // the website: a certificate and profile saved (signingReady)
  assert.equal(await signingSetUp("site", { ready: async () => true }), true);
  assert.equal(await signingSetUp("site", { ready: async () => false }), false);
  assert.equal(await signingSetUp("site", { ready: async () => { throw new Error("idb"); } }), false);
  // the sideload app: every walkthrough step (the real signing.js missingStep: certificate, then an https server)
  const id = { identity: { name: "Me" } };
  assert.equal(await signingSetUp("sideload", { status: async () => id, server: () => "https://ifizbox.com" }), true);
  assert.equal(await signingSetUp("sideload", { status: async () => ({ identity: null }), server: () => "https://ifizbox.com" }), false);
  assert.equal(await signingSetUp("sideload", { status: async () => id, server: () => "" }), false);
  assert.equal(await signingSetUp("sideload", { status: async () => { throw new Error("no bridge"); }, server: () => "https://x" }), false);
  assert.equal(await signingSetUp("jailbreak"), false);
});

test("F123: every Settings link in the screens goes through settingsRoute (Home's stack)", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dirs = [import.meta.dirname, join(import.meta.dirname, "..")];
  for (const d of dirs) {
    for (const f of readdirSync(d).filter((n) => n.endsWith(".js") && !n.endsWith(".test.js") && n !== "router.js")) {
      assert.doesNotMatch(readFileSync(join(d, f), "utf8"), /tab: "settings"/, f);
    }
  }
});

test("the Home icon tells the website and Lite what they can't do; the jailbreak app has no popup", () => {
  assert.match(versionLimits("web").message, /tweaks/);
  assert.match(versionLimits("sideload").message, /update itself/);
  assert.equal(versionLimits("jailbreak"), null);
});

test("B295: Home's list has no More Sources row; the locked website keeps the tile locked", async () => {
  const { homeLinks, MORE_SOURCES_HREF, openWhileLocked } = await import("./home.js");
  const rows = homeLinks().flatMap((g) => g.rows);
  assert.equal(rows.find((r) => r.label === "More Sources" || r.href === MORE_SOURCES_HREF), undefined);
  assert.equal(openWhileLocked(MORE_SOURCES_HREF), false);
});
