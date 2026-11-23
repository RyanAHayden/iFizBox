// F18: one fixture per kind of dependency failure gives the expected sentence and action.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseControl } from "./apt.js";
import { depIndex, explain, explainApt } from "./deps.js";

const pkgs = (text) => parseControl(text);
const index = (sources, installed = "") => depIndex({
  available: pkgs(sources).map((stanza) => ({ stanza, key: "repo" })),
  installed: pkgs(installed),
});
const one = (st, ctx) => {
  const r = explain(pkgs(st)[0], ctx);
  return r;
};

const SOURCES = `
Package: ellekit
Name: ElleKit
Version: 1.1
Provides: mobilesubstrate (= 99)

Package: com.example.libold
Name: LibOld
Version: 1.5

Package: com.example.lib
Name: Example Lib
Version: 2.0
Depends: com.example.deeper

Package: com.example.ok
Name: Fine
Version: 1.0
Depends: mobilesubstrate, firmware (>= 14.0)
`;

test("firmware too new: needs iOS x or later (you have y), with firmware explained", () => {
  const r = one("Package: t\nVersion: 1\nDepends: firmware (>= 16.0)\n", { device: { ios: "15.4" }, index: index(SOURCES) });
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].kind, "ios");
  assert.equal(r.problems[0].sentence, "Needs iOS 16.0 or later (you have 15.4).");
  assert.match(r.problems[0].detail, /firmware isn't a package you can install/);
});

test("firmware upper bound and Conflicts: firmware", () => {
  const ix = index(SOURCES);
  assert.equal(one("Package: t\nDepends: firmware (<< 16.0)\n", { device: { ios: "16.5" }, index: ix }).problems[0].sentence,
    "Needs iOS older than 16.0 (you have 16.5).");
  assert.equal(one("Package: t\nConflicts: firmware (>= 17.0)\n", { device: { ios: "17.2" }, index: ix }).problems[0].sentence,
    "Doesn't work on iOS 17.0 or later (you have 17.2).");
  assert.equal(one("Package: t\nConflicts: firmware (>= 17.0)\n", { device: { ios: "16.2" }, index: ix }).ok, true);
});

test("firmware from dpkg's status when the device doesn't say", () => {
  const r = one("Package: t\nDepends: firmware (>= 16.0)\n", { index: index(SOURCES, "Package: firmware\nVersion: 15.4\nStatus: install ok installed\n") });
  assert.equal(r.problems[0].sentence, "Needs iOS 16.0 or later (you have 15.4).");
});

test("iOS unknown: a note with Settings, not a blocker", () => {
  const r = one("Package: t\nDepends: firmware (>= 16.0)\n", { index: index(SOURCES) });
  assert.equal(r.ok, true);
  assert.equal(r.problems[0].kind, "ios-unknown");
  assert.equal(r.problems[0].sentence, "Needs iOS 16.0 or later: set your iOS version in Settings to check.");
  assert.deepEqual(r.problems[0].action, { kind: "settings", label: "Set iOS Version" });
});

test("missing, on a known repo: names it and offers Add", () => {
  const r = one("Package: t\nDepends: ws.hbang.common (>= 1.17)\n", { device: { ios: "16.0" }, index: index(SOURCES) });
  assert.equal(r.problems[0].kind, "missing");
  assert.equal(r.problems[0].sentence, "Needs ws.hbang.common 1.17 or later, which none of your sources has; it is on Chariz.");
  assert.deepEqual(r.problems[0].action, { kind: "add-source", name: "Chariz", url: "https://repo.chariz.com/", label: "Add Chariz" });
});

test("missing, nowhere known: says to add its source, no action", () => {
  const r = one("Package: t\nDepends: com.nowhere.lib\n", { index: index(SOURCES) });
  assert.equal(r.problems[0].sentence, "Needs com.nowhere.lib, which none of your sources has: add the source that carries it.");
  assert.equal(r.problems[0].action, undefined);
});

test("too old on every source: says what the sources have, opens it", () => {
  const r = one("Package: t\nDepends: com.example.libold (>= 2.0)\n", { index: index(SOURCES) });
  assert.equal(r.problems[0].kind, "version");
  assert.equal(r.problems[0].sentence, "Needs LibOld 2.0 or later; your sources have 1.5 at most.");
  assert.deepEqual(r.problems[0].action, { kind: "open", id: "com.example.libold", label: "Open LibOld" });
});

test("installed too old and no source newer", () => {
  const r = one("Package: t\nDepends: com.example.gone (>= 3)\n",
    { index: index(SOURCES, "Package: com.example.gone\nName: Gone\nVersion: 2\nStatus: install ok installed\n") });
  assert.equal(r.problems[0].sentence, "Needs Gone 3 or later; you have 2 installed and no source has a newer one.");
});

test("conflicts with an installed package: Remove it", () => {
  const r = one("Package: t\nConflicts: com.example.other\n",
    { index: index(SOURCES, "Package: com.example.other\nName: Other\nVersion: 1\nStatus: install ok installed\n") });
  assert.equal(r.problems[0].kind, "conflict");
  assert.equal(r.problems[0].sentence, "Conflicts with Other, which is installed (remove Other first).");
  assert.deepEqual(r.problems[0].action, { kind: "remove", id: "com.example.other", label: "Remove Other" });
});

test("an installed package that conflicts with it", () => {
  const r = one("Package: t\nName: Tweak\nVersion: 1\n",
    { index: index(SOURCES, "Package: com.example.old\nName: Old Tweak\nVersion: 1\nConflicts: t\nStatus: install ok installed\n") });
  assert.equal(r.problems[0].kind, "conflicted");
  assert.equal(r.problems[0].sentence, "Old Tweak, which is installed, conflicts with it (remove Old Tweak first).");
});

test("a dependency's own missing dependency is named through the chain", () => {
  const r = one("Package: t\nDepends: com.example.lib\n", { index: index(SOURCES) });
  assert.equal(r.problems[0].sentence, "Needs Example Lib, which needs com.example.deeper, which none of your sources has: add the source that carries it.");
  assert.deepEqual(r.problems[0].via, ["com.example.lib"]);
});

test("satisfied through Provides, alternatives and installed packages; targets open the provider", () => {
  const r = one("Package: t\nDepends: mobilesubstrate (>= 0.9), com.nowhere | com.example.ok, firmware (>= 14.0)\n", { device: { ios: "15.0" }, index: index(SOURCES) });
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.equal(r.targets.mobilesubstrate, "ellekit");
  assert.equal(r.targets["com.example.ok"], "com.example.ok");
  // An unversioned Provides doesn't satisfy a versioned dependency (apt's rule).
  const ix = index("Package: p\nVersion: 1\nProvides: virt\n");
  assert.equal(one("Package: t\nDepends: virt (>= 1)\n", { index: ix }).ok, false);
  assert.equal(one("Package: t\nDepends: virt\n", { index: ix }).ok, true);
});

test("apt's own output reads into the same sentences", () => {
  const out = `Reading package lists...
Some packages could not be installed.
The following packages have unmet dependencies:
 com.example.tweak : Depends: firmware (>= 16.0) but 15.4 is installed
                     Depends: ws.hbang.common (>= 1.17) but it is not installable
                     Conflicts: com.example.other but 1 is installed
E: Unable to correct problems, you have held broken packages.
E: Unable to locate package com.nowhere.thing`;
  const p = explainApt(out, { index: index(SOURCES) });
  assert.deepEqual(p.map((x) => x.sentence), [
    "com.example.tweak needs iOS 16.0 or later (you have 15.4).",
    "com.example.tweak needs ws.hbang.common 1.17 or later, which none of your sources has; it is on Chariz.",
    "com.example.tweak conflicts with com.example.other, which is installed (remove com.example.other first).",
    "None of your sources has com.nowhere.thing: add the source that carries it.",
  ]);
  assert.equal(p[1].action.kind, "add-source");
  assert.equal(p[2].action.kind, "remove");
});

test("apt that can't read its own lists says which source's file and to Refresh, not 'apt refused'", () => {
  // The iPhone 7's output when a source answered its Translation URL with a web page.
  const out = `E: Encountered a section with no Package: header
E: Problem with MergeList /var/jb/var/lib/apt/lists/repo.twickd.com_._en
E: The package lists or status file could not be parsed or opened.`;
  const p = explainApt(out, { index: index(SOURCES) });
  assert.deepEqual(p.map((x) => x.sentence), [
    "apt can't read the list it downloaded from repo.twickd.com (repo.twickd.com_._en), so it won't run. Refresh your sources to download it again.",
  ]);
  assert.equal(p[0].kind, "lists");
  assert.equal(p[0].blocking, true);
  // A host with a port: apt writes ':' as %3a in the file name.
  assert.match(explainApt("E: Problem with MergeList /var/lib/apt/lists/repo.example.com%3a8080_dists_stable_main_binary-iphoneos-arm64_Packages", {})[0].sentence,
    /from repo\.example\.com:8080 \(/);
  // dpkg's status file: Refresh doesn't fix that one.
  const s = explainApt("E: Problem with MergeList /var/jb/var/lib/dpkg/status\nE: The package lists or status file could not be parsed or opened.", {});
  assert.equal(s.length, 1);
  assert.match(s[0].sentence, /^apt can't read dpkg's status file \(\/var\/jb\/var\/lib\/dpkg\/status\).*won't fix it/);
  // Only the summary line: still a sentence.
  assert.deepEqual(explainApt("E: The package lists or status file could not be parsed or opened.", {}).map((x) => x.sentence),
    ["apt can't read its package lists, so it won't run. Refresh your sources to download them again."]);
});

test("the catalog's deps op: every source (older versions too) and dpkg's status, against the device", async () => {
  const { createCatalog, runCatalog } = await import("./catalog.js");
  const c = createCatalog();
  c.load("a", "Package: t\nName: Tweak\nVersion: 1\nArchitecture: iphoneos-arm64\nDepends: firmware (>= 16.0), libx (>= 2), ellekit\n");
  c.load("b", "Package: libx\nVersion: 3\nArchitecture: iphoneos-arm64\n\nPackage: libx\nVersion: 1\nArchitecture: iphoneos-arm64\n");
  c.setInstalled("Package: ellekit\nVersion: 1.0\nStatus: install ok installed\nArchitecture: iphoneos-arm64\n");
  c.setDevice({ ios: "15.4", jailbreak: "rootless" }, { filter: false });
  const r = runCatalog(c, "deps", ["t", "*"]);
  assert.deepEqual(r.problems.map((p) => p.sentence), ["Needs iOS 16.0 or later (you have 15.4)."]);
  assert.equal(r.targets.libx, "libx");
  c.setDevice({ ios: "16.1", jailbreak: "rootless" }, { filter: false });
  assert.equal(c.deps("t").ok, true);
  c.setInstalled(null); // ellekit no longer installed and no source has it
  assert.match(c.deps("t").problems[0].sentence, /^Needs ellekit, which none of your sources has; it is on ElleKit\.$/);
  assert.equal(c.deps("nope"), null);
});
