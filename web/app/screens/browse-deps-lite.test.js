// B325: a Tweak Source's tweak in the sideload build (Lite) never shows the jailbreak dependency report: Add to App
// bundles ElleKit for mobilesubstrate, so "Can't Install Yet: needs mobilesubstrate" was wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCatalog } from "../core/catalog.js";
import { pageDepReport } from "./browse.js";

const KEY = "deb:https://repo.x/:./";
// A Lite fixture: one Tweak Source, a tweak that Depends: mobilesubstrate (and PreferenceLoader, firmware), no dpkg status.
const PACKAGES = "Package: com.x.yt\nName: YTLite\nArchitecture: iphoneos-arm64\nSection: Tweaks\nVersion: 1\n"
  + "Depends: mobilesubstrate (>= 0.9), preferenceloader, firmware (>= 15.0)\n";

const liteCatalog = () => {
  const c = createCatalog();
  c.setDevice({ ios: "17.0", jailbreak: "none" });
  c.load(KEY, PACKAGES, "https://repo.x/", "iphoneos-arm64", { tweaks: true });
  return c;
};

test("Lite: a Depends: mobilesubstrate tweak gets no Can't Install Yet", () => {
  const c = liteCatalog();
  const st = c.package("com.x.yt", KEY).stanza;
  assert.equal(st.injectable, true);
  const report = c.deps("com.x.yt", KEY);
  // What the catalog says against apt's view (nothing provides mobilesubstrate here): the page must not show it.
  assert.ok(report.problems.some((p) => p.id === "mobilesubstrate" && p.blocking), "the bug's starting point");
  assert.equal(pageDepReport(report, st, "sideload"), null);
});

test("the jailbreak build still shows the same report", () => {
  const c = liteCatalog();
  const st = c.package("com.x.yt", KEY).stanza;
  const report = c.deps("com.x.yt", KEY);
  assert.equal(pageDepReport(report, st, "jailbreak"), report);
  const plain = { package: "com.x.plain", version: "1", depends: "mobilesubstrate" };
  assert.equal(pageDepReport(report, plain, "sideload"), report, "not a Tweak Source tweak: left as it is");
});

test("an unmet iOS range still shows on the page: Works On comes from compat, not the dependency report", async () => {
  const { compat } = await import("../core/compat.js");
  const st = liteCatalog().package("com.x.yt", KEY).stanza;
  const old = compat(st, { ios: "14.8", jailbreak: "none" });
  assert.equal(old.status, "no");
  assert.equal(old.reason, "ios");
  assert.match(old.detail, /iOS 15\.0 or later/);
  const browse = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  assert.ok(browse.includes("const fit = compat(st, currentDevice());"), "the package page judges the stanza itself");
});

test("plain jailbreak tweaks aren't offered in Lite: a Tweak Source drops them, so they have no page to report on", () => {
  const c = createCatalog();
  c.setDevice({ ios: "17.0", jailbreak: "none" });
  const text = `${PACKAGES}\nPackage: com.x.daemon\nName: Daemon Tweak\nArchitecture: iphoneos-arm64\nSection: Tweaks\nVersion: 1\nDepends: mobilesubstrate, com.x.lib\n`;
  c.load(KEY, text, "https://repo.x/", "iphoneos-arm64", { tweaks: true });
  assert.equal(c.package("com.x.daemon", KEY), null);
  assert.ok(c.package("com.x.yt", KEY));
});

test("wiring: the package page draws Can't Install Yet from pageDepReport only", () => {
  const browse = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  assert.ok(browse.includes("const shownDeps = pageDepReport(depReport, st);"));
  assert.ok(browse.includes("details.append(depProblemsGroup(shownDeps, route, ctx))"));
  assert.ok(!browse.includes("depProblemsGroup(depReport"));
});
