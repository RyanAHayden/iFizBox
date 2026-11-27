import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAltSource } from "./altparse.js";

const app = (bundleIdentifier, name, version, n) => ({
  bundleIdentifier, name, versions: [{ version, downloadURL: `https://x.test/${n}.ipa`, date: "2026-01-01" }],
});

test("a name that differs by a bracketed version merges into one app, newest first", () => {
  const src = parseAltSource({ apps: [
    app("com.facebook.Facebook", "Facebook", "586.0.0", 1),
    app("com.facebook.Facebook", "Facebook (Plus 1.0.9)", "588.1.0", 2),
  ] });
  assert.equal(src.apps.length, 1);
  assert.equal(src.apps[0].name, "Facebook");
  assert.deepEqual(src.apps[0].versions.map((v) => v.version), ["588.1.0", "586.0.0"]);
  assert.equal(src.apps[0].id, "com.facebook.Facebook");
});

test("a [v2.3] tail merges too, named by the newest entry's base name", () => {
  const src = parseAltSource({ apps: [
    app("com.a.b", "New Name [v2.3]", "2.3", 1),
    app("com.a.b", "New Name", "2.4", 2),
  ] });
  assert.equal(src.apps.length, 1);
  assert.equal(src.apps[0].name, "New Name");
});

test("(Duplicate)-style variants without a version stay separate", () => {
  const src = parseAltSource({ apps: [
    app("com.ryuk.gram", "RyukGram", "1.0", 1),
    app("com.ryuk.gram", "RyukGram (Duplicate)", "1.0", 2),
    app("com.ryuk.gram", "RyukGram (Duplicate, iOS 15)", "1.0", 3),
  ] });
  assert.equal(src.apps.length, 3);
});

test("an iOS version in the bracket is not an app version", () => {
  const src = parseAltSource({ apps: [
    app("com.r", "R", "1.0", 1), app("com.r", "R (Duplicate, iOS 15.0)", "1.0", 2),
  ] });
  assert.equal(src.apps.length, 2);
});

test("[v2.3] merge orders versions newest first", () => {
  const src = parseAltSource({ apps: [
    app("com.a.b", "App", "2.3", 1), app("com.a.b", "App [v2.4]", "2.4", 2),
  ] });
  assert.deepEqual(src.apps[0].versions.map((v) => v.version), ["2.4", "2.3"]);
});

test("a repeat with the same build leaves no scratch flag", () => {
  const src = parseAltSource({ apps: [app("com.a", "A", "1", 1), app("com.a", "A (Plus 1.0.1)", "1", 1)] });
  assert.equal(src.apps.length, 1);
  assert.equal("byVersion" in src.apps[0], false);
});
