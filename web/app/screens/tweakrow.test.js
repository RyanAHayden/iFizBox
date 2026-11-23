// SPDX-License-Identifier: GPL-3.0-or-later
// B267: the Add Tweaks flow's tweak lists scroll on their own scroller under the fixed bar, and their rows are Cydia's
// list rows: a 29pt icon (the package's Icon over its section's), the name, version · author; never a trust word.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withDocument, tick } from "../fakes.test-helper.js";
import { tweakListRow, tweakSubtitle, isBanner } from "./tweakrow.js";
import { searchAllRepos } from "./findmore.js";

const spark = { id: "com.spark.snowboard", name: "SnowBoard", version: "1.2.74", author: "Spark", short: "Theme engine", section: "Tweaks",
  icon: "https://www.sparkdev.me/package-logo/com.spark.snowboard", repo: { name: "SparkDev" } };

test("tweakSubtitle: version · author, the repo only for results from several repos, the description as a last resort", () => {
  assert.equal(tweakSubtitle(spark), "1.2.74 · Spark");
  assert.equal(tweakSubtitle(spark, { repo: true }), "1.2.74 · Spark · SparkDev");
  assert.equal(tweakSubtitle({ name: "X", short: "Does a thing" }), "Does a thing");
  assert.equal(tweakSubtitle({ name: "X", description: "Canister's words" }), "Canister's words");
  assert.equal(tweakSubtitle({ name: "X" }), "");
});

test("isBanner: a header or featured art given as the icon is dropped, a square icon kept", () => {
  assert.equal(isBanner(512, 512), false);
  assert.equal(isBanner(120, 100), false);
  assert.equal(isBanner(1200, 400), true);
  assert.equal(isBanner(100, 300), true);
  assert.equal(isBanner(0, 0), false);
});

test("tweakListRow: the package's icon in a 29pt box over its section's icon, name and subtitle", async () => {
  await withDocument(async () => {
    const li = tweakListRow(spark, { onClick: () => {} });
    assert.ok(li.classList.contains("tw-list-row"));
    const icon = li.querySelector(".tw-icon");
    assert.ok(icon, "an icon box");
    assert.match(icon.style.backgroundImage, /icons\/sections\/Tweaks\.png/);
    assert.equal(icon.querySelector("img").src, spark.icon);
    assert.equal(li.querySelector(".cell-label").textContent, "SnowBoard");
    assert.equal(li.querySelector(".cell-subtitle").textContent, "1.2.74 · Spark");
    const bare = tweakListRow({ id: "a.b", name: "Bare", icon: "file:///x.png" });
    assert.equal(bare.querySelector(".tw-icon img"), null, "a file: icon isn't loaded");
    assert.match(bare.querySelector(".tw-icon").style.backgroundImage, /unknown\.png/);
  });
});

test("Search All Repos: the bar is pinned and the results scroll on their own scroller; no trust word in the rows", async () => {
  await withDocument(async () => {
    const data = { data: [{ package_id: "com.spark.notchless", name: "Notchless", version: "2.1.9", author: "Spark", section: "Tweaks",
      architecture: "iphoneos-arm64", icon_url: "https://www.sparkdev.me/package-logo/com.spark.notchless",
      repository: { uri: "https://sparkdev.me/", name: "SparkDev", suite: "./" } }] };
    const s = searchAllRepos({ appName: "Spark", api: { search: async () => data }, sources: async () => [], sheet: () => () => {} });
    await s.ready;
    await tick();
    for (const c of ["sheet-scroll", "page-body", "search-root"]) assert.ok(s.el.classList.contains(c), c);
    const results = s.el.querySelector(".search-results");
    assert.ok(results, "a scroller of its own");
    const sub = results.querySelector(".tw-list-row .cell-subtitle").textContent;
    assert.equal(sub, "2.1.9 · Spark · SparkDev");
    assert.doesNotMatch(results.textContent, /Unknown/);
  });
});

test("wiring: Browse Tweak Sources, a repo's tweaks and Add to App are page scrollers under the sheet's bar", () => {
  const tweaks = readFileSync(new URL("./tweaks.js", import.meta.url), "utf8");
  assert.match(tweaks, /el\("div", "sheet-scroll page-body grouped tweak-pick tw-browse"\)/);
  assert.match(tweaks, /el\("div", "sheet-scroll page-body grouped tweak-pick"\); \/\/ B267/);
  assert.match(tweaks, /tweakListRow\(r, \{ onClick/);
  const find = readFileSync(new URL("./findmore.js", import.meta.url), "utf8");
  assert.match(find, /el\("div", "sheet-scroll page-body grouped tweak-pick find-tweak-list"\)/);
});
