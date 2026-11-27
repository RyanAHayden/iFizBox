// Every `ifizbox.` string literal in web/app and worker/src comes from core/storagekeys.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PREFIX, KEYS, KEY_PREFIXES } from "./storagekeys.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.isDirectory()) return ["vendor", "fixtures", "node_modules"].includes(e.name) ? [] : walk(join(dir, e.name));
  return /\.(m?js|html)$/.test(e.name) && !/\.test(-helper)?\./.test(e.name) ? [join(dir, e.name)] : [];
});
// Comments quote keys in backticks, so they go first. A `//` after a space is a comment; a URL's has none.
const code = (file) => readFileSync(file, "utf8").replace(/(^|\s)\/\/.*$/gm, "$1");
const literals = (file) => [...code(file).matchAll(/(["'`])(ifizbox\.(?!com\b)[^"'`\n]*)\1/g)].map((m) => m[2]);
const files = [join(repo, "web/app"), join(repo, "worker/src")].flatMap(walk);
const own = ["web/app/core/storagekeys.js", "web/app/theme-boot.js"];

test("no ifizbox.* literal outside the key module", () => {
  assert.ok(files.length > 200, `${files.length} files scanned`);
  // `literals` leaves out the domain (ifizbox.com), which is no storage key.
  const found = files.filter((f) => !own.includes(relative(repo, f)))
    .flatMap((f) => literals(f).map((l) => `${relative(repo, f)}: ${l}`));
  assert.deepEqual(found, []);
});

test("theme-boot.js's keys are the module's", () => {
  const found = literals(join(repo, "web/app/theme-boot.js"));
  assert.deepEqual(found.sort(), [KEYS.appearance, KEYS.darkTheme, KEYS.lightTheme, KEYS.style].sort());
});

test("every key starts with the prefix and is named once", () => {
  const all = [...Object.values(KEYS), ...Object.values(KEY_PREFIXES)];
  assert.ok(all.every((k) => k.startsWith(PREFIX)));
  assert.equal(new Set(all).size, all.length);
});
