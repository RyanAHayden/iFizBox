// F135: Home's Settings row first with its gear icon, the jailbreak app's Home without the featured banners and its
// Browse page with them, and the banners' placeholder cards while they load (over a small fake DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homeLinks, settingsIcon, repaintLinkIcons, followStyle, homeShowsFeatured, browseShowsFeatured } from "./home.js";
import { ensureWhyStyle } from "./why.js";
import { rowIcon, homeTileCss } from "../icons/rowicons.js";
import { homeFeatured, featuredPlaceholder, FEATURED_PLACEHOLDERS } from "./extras.js";

const here = new URL(".", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, here), "utf8");

import { withDocument as withDom } from "../fakes.test-helper.js";

test("F135: Settings is Home's first group, its row with our gear at the left, Theme its other half", () => {
  const [first, ...rest] = homeLinks();
  assert.equal(first.pair, true);
  assert.deepEqual(first.rows.map((r) => r.label), ["Settings", "Theme"]);
  assert.equal(first.rows[0].label, "Settings");
  assert.deepEqual(first.rows[0].icon, settingsIcon());
  assert.ok(rest.every((g) => g.rows?.every((r) => r.label !== "Settings")), "Settings only once");
  assert.equal(rest.at(-1).rows[0].label, "Credits / Thank You");
});

test("F159: the Settings row's gear has the tiles' padding, so it lines up with them", () => {
  assert.equal(settingsIcon().cls, "row-icon"); // F223: Settings > General's tile (rowicons.test.js)
  const css = read("../home.css");
  const rule = (sel) => css.match(new RegExp(sel.replace(/[.>]/g, (c) => "\\" + c) + " \\{([^}]*)\\}"))?.[1] ?? "";
  const decl = (body, prop) => body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))?.[1].trim();
  const tile = rule(".home-tile"), row = rule(".home-settings-row > .cell-inner");
  assert.ok(decl(tile, "padding"), "the tiles set their padding");
  assert.equal(decl(row, "padding"), decl(tile, "padding"), "same left inset as the tiles");
  assert.equal(decl(row, "gap"), decl(tile, "gap"), "same icon-label gap as the tiles");
  assert.equal(decl(rule(".home-settings-row .cell-icon.row-icon"), "margin"), "0", "no .row-icon nudge on top of the inset");
  assert.doesNotMatch(css, /settings\.svg/, "no full-bleed bitmap gear left");
});

test("F159: grouped() rows put an icon's cls on the cell-icon", async () => {
  const { grouped } = await import("../nav/ui.js");
  await withDom(async () => {
    const frag = grouped([{ rows: homeLinks()[0].rows }]);
    const find = (n, cls) => (n.className?.split?.(" ").includes(cls) ? n : (n.children ?? []).map((c) => find(c, cls)).find(Boolean));
    const icon = find(frag, "cell-icon");
    assert.ok(icon, "the Settings row draws an icon");
    assert.deepEqual(icon.className.split(" "), ["cell-icon", "row-icon"]);
    assert.equal(icon.children.length, 1, "the tile is an <img> (rowicons.js)");
  });
});

test("F154: no horizontal scroller of banners on Home or Browse, in any build", () => {
  for (const m of ["jailbreak", "site", "sideload"]) {
    assert.equal(homeShowsFeatured(m), false, m);
    assert.equal(browseShowsFeatured(m), false, m);
  }
  // Home's root, its Reload, its Featured page and Browse draw no homeFeatured() strip at all.
  assert.doesNotMatch(read("./home.js"), /homeFeatured\(/);
  const browse = read("./browse.js");
  const home = browse.slice(browse.indexOf("// ---- Browse (F154)"));
  assert.doesNotMatch(home, /homeFeatured|featuredStrip|featured-row/, "Browse's page: the Tweak of the Day card instead");
});

test("F135: placeholder cards the banners' size while they load, then the banners", () => withDom(async () => {
  const ph = featuredPlaceholder();
  assert.equal(ph.attrs["aria-busy"], "true");
  assert.equal(ph.children.length, FEATURED_PLACEHOLDERS);
  for (const c of ph.children) {
    assert.ok(c.classList.contains("featured-banner"), "the banners' own box: size and corners");
    assert.ok(c.classList.contains("ph-box"), "the app's placeholder look");
  }
  let land;
  const box = homeFeatured({ deviceType: () => "rootless", sources: async () => [{ key: "k" }],
    forHome: () => new Promise((r) => { land = r; }) });
  assert.equal(box.children.length, 1);
  assert.ok(box.children[0].classList.contains("featured-ph"), "placeholders, not empty or a spinner");
  await new Promise((r) => setTimeout(r, 0));
  land([{ key: "k", package: "p", title: "P", url: "https://x.dev/b.png" }]);
  await box.ready;
  assert.equal(box.children.length, 1);
  assert.ok(box.children[0].classList.contains("featured-row"));
  assert.equal(box.children[0].classList.contains("featured-ph"), false, "the banners took the placeholders' place");
  assert.equal(box.children[0].children.length, 1);
}));

test("F135: no banners or a failure empties the scroller; Not Jailbroken shows no placeholders at all", () => withDom(async () => {
  const none = homeFeatured({ deviceType: () => "rootless", sources: async () => [], forHome: async () => [] });
  await none.ready;
  assert.equal(none.children.length, 0);
  const bad = homeFeatured({ deviceType: () => "rootless", sources: async () => { throw new Error("down"); } });
  await bad.ready;
  assert.equal(bad.children.length, 0);
  const off = homeFeatured({ deviceType: () => "none" });
  assert.equal(off.children.length, 0);
}));

// B239: Theme > Style swaps Home's icons at once: the Settings gear and the Why tile are read when Home draws, and
// Home repaints them when <html data-style> changes (no reload).
test("B239: Home's Settings gear is the Style showing when Home draws, not the one at import", () => withDom((doc) => {
  doc.documentElement.dataset.style = "ios7";
  assert.equal(homeLinks()[0].rows[0].icon.src, rowIcon("general", "ios7").src);
  doc.documentElement.dataset.style = "ios6";
  assert.equal(homeLinks()[0].rows[0].icon.src, rowIcon("general", "ios6").src);
  assert.notEqual(rowIcon("general", "ios6").src, rowIcon("general", "ios7").src, "the two Styles draw different tiles");
}));

test("B239: a Style change repaints the link rows' tiles Home already drew", async () => {
  const { grouped } = await import("../nav/ui.js");
  await withDom((doc) => {
    doc.documentElement.dataset.style = "ios6";
    const links = homeLinks();
    const frag = grouped(links);
    const groups = [...frag.children];
    const gear = () => groups[0].querySelector(".cell-icon > img").src;
    assert.equal(gear(), rowIcon("general", "ios6").src);
    doc.documentElement.dataset.style = "ios7";
    assert.ok(repaintLinkIcons(groups, homeLinks()) >= 1, "Settings at least");
    assert.equal(gear(), rowIcon("general", "ios7").src);
    assert.equal(repaintLinkIcons(groups, homeLinks()), 0, "nothing left to repaint");
  });
});

test("B239: followStyle calls back on a data-style change while its box is on the page, then stops", () => withDom((doc) => {
  const observers = [];
  class Observer {
    constructor(cb) { this.cb = cb; this.on = false; observers.push(this); }
    observe(target, opts) { this.on = true; this.target = target; this.opts = opts; }
    disconnect() { this.on = false; }
  }
  const box = { isConnected: true };
  const seen = [];
  followStyle(box, (s) => seen.push(s), doc, Observer);
  const mo = observers[0];
  assert.equal(mo.target, doc.documentElement);
  assert.deepEqual(mo.opts.attributeFilter, ["data-style"]);
  doc.documentElement.dataset.style = "ios7";
  mo.cb();
  mo.cb(); // the same Style again: no second call
  assert.deepEqual(seen, ["ios7"]);
  box.isConnected = false;
  doc.documentElement.dataset.style = "ios6";
  mo.cb();
  assert.deepEqual(seen, ["ios7"]);
  assert.equal(mo.on, false, "stops once Home has left the page");
}));

test("B239: the Why tile's CSS is rewritten for the new Style, once per change", () => {
  const added = [];
  const doc = { documentElement: { dataset: { style: "ios6" } }, head: { append: (s) => added.push(s) },
    getElementById: (id) => added.find((s) => s.id === id) ?? null, createElement: () => ({}) };
  assert.equal(ensureWhyStyle(doc), true);
  assert.ok(added[0].textContent.includes(homeTileCss("why", "ios6")));
  assert.equal(ensureWhyStyle(doc), false, "same Style: nothing written");
  doc.documentElement.dataset.style = "ios7";
  assert.equal(ensureWhyStyle(doc), true);
  assert.equal(added.length, 1, "the one <style>, rewritten");
  assert.ok(added[0].textContent.includes(homeTileCss("why", "ios7")));
  assert.notEqual(homeTileCss("why", "ios6"), homeTileCss("why", "ios7"));
});

test("B239: Home follows the Style for its link rows and the Why tile", () => {
  assert.match(read("./home.js"), /followStyle\(home, \(\) => \{ why\.ensureWhyStyle\(\); repaintLinkIcons\(groups, homeLinks\(\)\); \}\);/);
  assert.doesNotMatch(read("./home.js"), /^export const \w+ = rowIcon\(/m, "no row tile computed at import");
  assert.doesNotMatch(read("./why.js"), /^export const \w+ = whyCss\(\)/m, "no Why CSS computed at import");
});
