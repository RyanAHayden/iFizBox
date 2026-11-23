// F385: the website's Install iFizBox App with no signing set up shows Sign iFizBox First instead of opening
// Settings > Signing; a pick opens Signing at that way's group and keeps the install for Install Now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installApp } from "./home.js";
import { signFirstOptions, SIGNING_GROUP_OF, focusSigningGroup } from "../signing-sheet.js";
import { APP_IPA_URL, APP_NAME } from "../core/appoffer.js";

const deps = (ready, way, { free = false } = {}) => {
  const calls = [];
  return { calls, opts: { ready: async () => ready, bring: () => true, installed: () => {},
    go: (h) => calls.push(["go", h]), install: ({ onInstalled, ...o }) => calls.push(["install", o]),
    remember: (r) => calls.push(["remember", r]), free: async () => free,
    sheet: async (o) => { calls.push(["sheet", o]); return way; }, focus: (id) => calls.push(["focus", id]) } };
};

test("not ready: the sheet opens instead of navigating; Cancel stays on Home", async () => {
  const { calls, opts } = deps(false, null);
  assert.equal(await installApp(opts), "cancelled");
  assert.deepEqual(calls, [["sheet", { free: false }]]);
});

test("not ready: a pick remembers the install, opens Signing and focuses that way", async () => {
  for (const way of ["certificate", "free", "account"]) {
    const { calls, opts } = deps(false, way, { free: true });
    assert.equal(await installApp(opts), "signing");
    assert.deepEqual(calls.map((c) => c[0]), ["sheet", "remember", "go", "focus"]);
    assert.deepEqual(calls[0][1], { free: true });
    assert.equal(calls[1][1].name, APP_NAME);
    assert.deepEqual(calls[2], ["go", "/home/settings/signing"]);
    assert.deepEqual(calls[3], ["focus", way]);
    calls[1][1].run(); // Signing's Install Now
    assert.deepEqual(calls.at(-1), ["install", { url: APP_IPA_URL, name: APP_NAME, bring: true }]);
  }
});

test("ready: installs straight away, no sheet", async () => {
  const { calls, opts } = deps(true, "certificate");
  assert.equal(await installApp(opts), "install");
  assert.deepEqual(calls.map((c) => c[0]), ["install"]);
});

test("the relay's answer failing counts as no free route", async () => {
  const { calls, opts } = deps(false, null);
  opts.free = async () => { throw new Error("offline"); };
  await installApp(opts);
  assert.deepEqual(calls[0], ["sheet", { free: false }]);
});

test("the ways: Import Certificate first, Free Apple ID only where the free route is on, then Developer Account", () => {
  assert.deepEqual(signFirstOptions().map((o) => o.label), ["Import Certificate", "Developer Account"]);
  assert.deepEqual(signFirstOptions({ free: true }).map((o) => o.label), ["Import Certificate", "Use a Free Apple ID", "Developer Account"]);
  for (const o of signFirstOptions({ free: true })) {
    assert.ok(SIGNING_GROUP_OF[o.id], `${o.id} has a group on Signing`);
    const sentences = o.hint.split(/(?<=\.)\s+/).filter(Boolean);
    assert.ok(sentences.length <= 2, `${o.id}: one or two short sentences`);
  }
  assert.match(signFirstOptions()[0].hint, /\.p12/);
  assert.match(signFirstOptions()[0].hint, /\.mobileprovision/);
});

test("focusSigningGroup scrolls the way's group into view once Signing draws it", () => {
  let scrolled = null;
  let found = false;
  const group = { scrollIntoView: (o) => { scrolled = o; } };
  const doc = { querySelector: (sel) => (found && sel === SIGNING_GROUP_OF.free ? { closest: () => group } : null) };
  const queue = [];
  focusSigningGroup("free", { doc, later: (f) => queue.push(f) });
  queue.shift()(); // first look: not drawn yet
  assert.equal(scrolled, null);
  found = true;
  queue.shift()();
  assert.equal(scrolled.block, "center");
});
