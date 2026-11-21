// F350: the Details page after Cydia's (screens/details.js): which rows a package's and an app's Details pane has in
// each state, More Information only when it has something to show, Version's CHANGE, the dashed description box, the
// centred footer, and the fake shell's apt.files (Filesystem Content).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { packageRows, appRows, moreInfoShown, longText, detailsFooter, detailRows, descGroup, changeButton, tileCells,
  footerGroup, CHANGE_LABEL } from "./details.js";
import { grouped } from "../nav/ui.js";
import { ROW_ICONS } from "../icons/rowicons.js";
import { withDocument } from "../fakes.test-helper.js";

const labels = (rows) => rows.map((r) => r.label);
const LONG = Array.from({ length: 9 }, (_, i) => `Line ${i + 1} of a long description.`).join("\n");
const SHORT = "A small tweak.";

test("F350: a package that isn't installed: no options, the Version group without Filesystem Content", () => {
  const p = packageRows({ version: "1.2", author: "Jane", maintainer: "Jane", versions: 1, files: true, source: "Havoc",
    section: "Tweaks", worksOn: "iOS 15 – 17", installedSize: "120 KB", depends: ["mobilesubstrate", "preferenceloader"] });
  assert.deepEqual(p.options, []);
  assert.equal(p.versionHeader, "Version");
  assert.deepEqual(labels(p.version), ["Version", "Version History"]);
  assert.equal(p.version[0].detail, "1.2");
  assert.equal(p.change, false, "one version: nothing to change to");
  assert.deepEqual(labels(p.info), ["Source", "Section", "Works On", "Installed Size", "Depends"]);
  assert.equal(p.info.find((r) => r.key === "depends").detail, "mobilesubstrate, preferenceloader");
  assert.equal(p.price, "Free");
  assert.equal(p.payment, false);
});

test("F350: an installed package: Change Package Settings, Installed Package with its version, CHANGE and Filesystem Content", () => {
  const p = packageRows({ installed: "1.1", version: "1.2", author: "Jane", maintainer: "Sam", versions: 3, files: true, source: "Havoc" });
  assert.deepEqual(labels(p.options), ["Change Package Settings", "Maintainer"]);
  assert.equal(p.options[1].detail, "Sam");
  assert.equal(p.versionHeader, "Installed Package");
  assert.deepEqual(labels(p.version), ["Version", "Version History", "Filesystem Content"]);
  assert.equal(p.version[0].detail, "1.1", "the installed version, not the source's");
  assert.equal(p.version[0].cls, "cy-version-row", "CHANGE's row");
  assert.equal(p.change, true);
  // the site (no packageFiles) and the same maintainer as author
  const site = packageRows({ installed: "1.1", author: "Jane", maintainer: "jane", versions: 3, files: false });
  assert.deepEqual(labels(site.options), ["Change Package Settings"], "Maintainer only when it's someone else");
  assert.deepEqual(labels(site.version), ["Version", "Version History"], "Filesystem Content is hidden on the site");
});

test("F350: paid, installed-only and sideload tweaks", () => {
  const paid = packageRows({ paid: true, versions: 2 });
  assert.equal(paid.price, "Paid");
  assert.equal(paid.payment, true);
  const only = packageRows({ installed: "1.0", installedOnly: true, paid: true });
  assert.equal(only.price, null, "no source sells it");
  assert.equal(only.payment, false);
  assert.ok(!labels(only.info).includes("Source"), "no source to name");
  const tweak = packageRows({ sideloadTweak: true, paid: true, versions: 4 });
  assert.equal(tweak.change, false, "Add to App picks apps, not versions");
  assert.equal(tweak.payment, false, "its price is in Works In's Add to an App group");
});

test("F350: More Information only for a long text, a depiction, What's New or Permissions", () => {
  assert.equal(longText(SHORT), false);
  assert.equal(longText(LONG), true);
  assert.equal(longText(""), false);
  assert.equal(moreInfoShown({ text: SHORT }), false, "a short text with no depiction: nothing more to show");
  assert.equal(moreInfoShown({ text: LONG }), true);
  assert.equal(moreInfoShown({ text: SHORT, depiction: true }), true);
  assert.equal(moreInfoShown({ text: "", depiction: false }), false);
  assert.equal(moreInfoShown({ text: SHORT, whatsNew: true }), true, "an app's notes");
  assert.equal(moreInfoShown({ text: SHORT, permissions: 2 }), true, "an app's Permissions");
  assert.equal(moreInfoShown({ text: SHORT, permissions: 0, whatsNew: false }), false);
});

test("F350: an app's rows: Add Tweaks in the sideload build only, Version with its count, Information", () => {
  const lite = appRows({ sideload: true, bundleId: "com.x.app", versions: 3, version: "2.0 (40)", source: "Alt Repo",
    category: "Games", worksOn: "iOS 14 or later", size: "40.0 MB" });
  assert.equal(lite.addTweaks, true);
  assert.deepEqual(labels(lite.version), ["Version", "Version History"]);
  assert.equal(lite.version[0].detail, "2.0 (40)");
  assert.equal(lite.version[1].detail, "3 versions");
  assert.equal(lite.change, true);
  assert.deepEqual(labels(lite.info), ["Source", "Category", "Works On", "Size", "Bundle ID"]);
  const jb = appRows({ sideload: false, bundleId: "com.x.app", versions: 1, version: "1.0", tooBig: true, size: "3.0 GB",
    storeVersion: "1.1", storeRequires: "iOS 16 or later" });
  assert.equal(jb.addTweaks, false);
  assert.equal(jb.change, false);
  assert.equal(jb.version[1].detail, "1 version");
  assert.deepEqual(labels(jb.info), ["Source", "Category", "Works On", "Size", "App Store Version", "App Store Requires", "Bundle ID"]);
  assert.equal(jb.info.find((r) => r.key === "size").cls, "size-over", "red past the website's cap");
  assert.equal(jb.info[1].detail, "App", "no category: App");
});

test("F350: every row names a tile the map has", () => {
  const all = [packageRows({ installed: "1", author: "a", maintainer: "b", versions: 2, files: true, section: "S", installedSize: "1 KB", depends: ["d"] }),
    appRows({ sideload: true, bundleId: "x", versions: 2, size: "1 MB", storeVersion: "1", storeRequires: "iOS 1" })];
  for (const p of all) for (const r of [...(p.options ?? []), ...p.version, ...p.info]) assert.ok(ROW_ICONS[r.icon], `${r.label}: ${r.icon}`);
  for (const name of ["pkgMore", "pkgBlock", "pkgTweaks", "pkgWish", "pkgLink"]) assert.ok(ROW_ICONS[name], name);
});

test("F350: Cydia's footer: the id, then · source - section", () => {
  assert.equal(detailsFooter("com.x.tweak", "Havoc", "Tweaks"), "com.x.tweak\n· Havoc - Tweaks");
  assert.equal(detailsFooter("com.x.tweak", "", "Tweaks"), "com.x.tweak\n· Tweaks");
  assert.equal(detailsFooter("com.x.tweak", "", null), "com.x.tweak");
});

test("F350: the DOM: tiles on every row, CHANGE as a price button, the dashed box, the centred footer", () => withDocument(() => {
  let changed = 0;
  const p = packageRows({ installed: "1.1", versions: 2 });
  const g = grouped([{ header: p.versionHeader, rows: detailRows(p.version, { history: { href: "#/x" } }) }]).firstElementChild;
  assert.equal(g.querySelectorAll(".row-icon").length, 2);
  assert.equal(g.querySelectorAll(".cell-inner")[1].href, "#/x");
  const b = changeButton(g, () => { changed++; });
  assert.equal(b.textContent, CHANGE_LABEL);
  assert.ok(b.classList.contains("price-btn"), "the eras' price button look (ios7.css / ios13.css)");
  assert.ok(g.querySelector(".cy-version-row .cell-inner").classList.contains("has-change"));
  assert.equal(b.disabled, false);
  b.click();
  assert.equal(changed, 1);
  const g2 = grouped([{ rows: detailRows(packageRows({ versions: 1 }).version) }]).firstElementChild;
  assert.equal(changeButton(g2, () => {}, { disabled: true }).disabled, true, "nothing to change to: greyed, not gone");
  assert.equal(changeButton(grouped([{ rows: [{ label: "x" }] }]).firstElementChild, () => {}), null, "no Version row: no button");
  const d = descGroup("See https://x.dev/a.");
  assert.ok(d.querySelector(".cy-desc"));
  assert.ok(d.querySelector(".cy-desc-text"));
  assert.equal(d.querySelector("a").href, "https://x.dev/a", "links stay links");
  assert.ok(descGroup("x", { full: true }).querySelector(".cy-desc-full"));
  const t = tileCells(grouped([{ rows: [{ label: "Block" }, { label: "Block Jane" }] }]).firstElementChild, "pkgBlock");
  assert.equal(t.querySelectorAll(".row-icon").length, 2);
  tileCells(t, "pkgBlock");
  assert.equal(t.querySelectorAll(".row-icon").length, 2, "once");
  const f = footerGroup("id\n· S").firstElementChild;
  assert.ok(f.querySelector(".group-footer").classList.contains("cy-foot"));
}));

test("F350: the footer is centred in every era, the box clamps to 6 lines", () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  assert.match(read("packages.css"), /\.group-footer\.cy-foot \{ text-align: center; \}/);
  for (const era of ["ios7", "ios13"]) {
    assert.match(read(`${era}.css`), new RegExp(`html\\[data-style="${era}"\\] \\.group-footer\\.cy-foot \\{ text-align: center; \\}`), era);
  }
  assert.match(read("packages.css"), /-webkit-line-clamp: 6/);
});

test("F350: the gallery is headed Preview and the old tiles row is gone from both pages", () => {
  const altstore = readFileSync(new URL("./altstore.js", import.meta.url), "utf8");
  const browse = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  assert.doesNotMatch(altstore, /"Screenshots"/);
  for (const [name, src] of [["altstore.js", altstore], ["browse.js", browse]]) assert.doesNotMatch(src, /\btileRow\(/, name);
});

test("F350: the fake shell's apt.files reads info/<id>[:arch].list, as Apt.swift does", async () => {
  const { createFakeNative, makeFixture } = await import("../../../native/fake/fake-native.mjs");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const fx = makeFixture();
  try {
    const info = join(fx.prefix, "var/lib/dpkg/info");
    mkdirSync(info, { recursive: true });
    writeFileSync(join(info, "a.list"), "/.\n/var/jb\n/var/jb/Library/a.dylib\n");
    writeFileSync(join(info, "b:iphoneos-arm64.list"), "/.\n/var/jb/usr/bin/b\n");
    const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote });
    assert.deepEqual(await native.call("apt.files", { id: "a" }), ["/var/jb", "/var/jb/Library/a.dylib"]);
    assert.deepEqual(await native.call("apt.files", { id: "b" }), ["/var/jb/usr/bin/b"]);
    assert.equal(await native.call("apt.files", { id: "c" }), null);
    await assert.rejects(native.call("apt.files", { id: "../x" }));
  } finally { fx.cleanup(); }
});
