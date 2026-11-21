// B310: the Home Screen icon badge drops to what's still waiting the moment a queue run ends, without waiting for
// iFizBox to be opened again. Before, the jailbreak app put 0 on the icon only while the Changes tab was on screen,
// and the count after a run waited for dpkg's status and every source to be read again, which a page sent to the
// background right after never finished.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeIndexedDB } from "../fakes.test-helper.js";
import { createUpgradeNotices } from "../settings.js";

globalThis.indexedDB = fakeIndexedDB();
globalThis.fetch = async () => { throw new Error("offline"); };

const day = 86400000;
const row = (id) => ({ id, version: "2.0", installed: "1.0" });
const signed = (id, expiresIn) => ({ bundleId: id, name: id, version: "1.0", expires: new Date(Date.now() + expiresIn).toISOString() });
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("badgeAfterRun: the new count goes out at once, before any recount, less what the run installed", async () => {
  const { badgeAfterRun } = await import("./changes.js");
  const counted = { upgrades: { available: [row("a"), row("b"), row("c")], ignored: [row("held")] }, resign: [] };
  const calls = [];
  const ctx = { setBadge: () => calls.push("setBadge"), badgeAfterRun: (tab, n) => calls.push([tab, n]) };
  assert.equal(badgeAfterRun(["a", "b"], { ctx, counted }), 1);
  assert.deepEqual(calls, [["changes", 1]], "synchronously, through the after-run setter");
  assert.equal(badgeAfterRun(["a", "b", "c", "dep"], { ctx, counted }), 0);
  assert.deepEqual(calls.at(-1), ["changes", 0], "everything upgraded: 0 goes out too");
  // a re-sign still waiting stays counted
  assert.equal(badgeAfterRun(["a", "b", "c"], { ctx, counted: { ...counted, resign: [{ id: "x" }] } }), 1);
  // no count yet: nothing to take from
  assert.equal(badgeAfterRun(["a"], { ctx, counted: null }), null);
});

test("the recount after a run goes on the icon through the after-run setter, the next one through setBadge", async () => {
  let answer = { apps: [signed("a", -day), signed("b", -day)] };
  globalThis.ifizboxNative = { mode: "sideload", call: async (m) => (m === "signing.installed" ? answer : {}) };
  try {
    const m = await import("./changes.js");
    const seen = [];
    m.init({ setBadge: (tab, n) => { if (tab === "changes") seen.push(["set", n]); },
      badgeAfterRun: (tab, n) => { if (tab === "changes") seen.push(["run", n]); } });
    await new Promise((f) => setTimeout(f, 50));
    await m.recountBadge(); // takes the after-run mark the test above left (or init's count did)
    await m.recountBadge();
    assert.deepEqual(seen.at(-1), ["set", 2]);

    m.badgeAfterRun(["pkg"]); // the run upgraded a package Changes didn't count: the count stays 2, at once
    assert.deepEqual(seen.at(-1), ["run", 2]);
    answer = { apps: [signed("a", 300 * day), signed("b", 300 * day)] };
    await m.recountBadge(); // dpkg read again (catalog's change): the real count, still as the run's
    assert.deepEqual(seen.at(-1), ["run", 0]);
    await m.recountBadge(); // later counts are ordinary again
    assert.deepEqual(seen.at(-1), ["set", 0]);

    // a run whose recount never came (failed): only for a while, then counts are ordinary again
    m.badgeAfterRun([]);
    const now = Date.now;
    Date.now = () => now() + m.AFTER_RUN_MS + 1000;
    try {
      await m.recountBadge();
    } finally {
      Date.now = now;
    }
    assert.deepEqual(seen.at(-1), ["set", 0]);
  } finally {
    delete globalThis.ifizboxNative;
  }
});

test("jailbreak app: after a run the icon takes 0 on any tab; an ordinary 0 off Changes still leaves it", () => {
  const calls = [];
  const native = { mode: "jailbreak", call: async (m, p) => { if (m === "app.badge") calls.push(p.count); } };
  const up = createUpgradeNotices({ native, current: () => ({ tab: "installed", path: [] }), win: { location: { hash: "#/installed" } } });
  const tab = [];
  const setBadge = (t, n) => { tab.push(n); up.badge(t, n); };
  // app.js ctx.badgeAfterRun, as written there
  const afterRun = (t, n) => { setBadge(t, n); if (t === "changes" && !(Number(n) > 0)) up.updated(); };

  setBadge("changes", 3);
  assert.deepEqual(calls, [3]);
  afterRun("changes", 1); // the run upgraded two of three
  assert.deepEqual(calls, [3, 1]);
  afterRun("changes", 0); // the last one: the icon is bare at once, the Installed tab on screen
  assert.deepEqual(calls, [3, 1, 0]);
  assert.deepEqual(tab, [3, 1, 0]);

  // without a run (F65): a 0 off the Changes tab leaves the daemon's badge until Changes is seen
  const calls2 = [];
  const up2 = createUpgradeNotices({ native: { mode: "jailbreak", call: async (m, p) => { if (m === "app.badge") calls2.push(p.count); } },
    current: () => ({ tab: "home", path: [] }), win: { location: { hash: "#/home" } } });
  up2.badge("changes", 2);
  up2.badge("changes", 0);
  assert.deepEqual(calls2, [2]);
});

test("the wiring: app.js hands Changes the after-run setter, both package runs call it as they end", () => {
  const app = read("../app.js");
  assert.match(app, /badgeAfterRun: \(tab, n\) => \{ ctx\.setBadge\(tab, n\); if \(tab === "changes" && !\(Number\(n\) > 0\)\) upgradeNotices\.updated\(\); \}/);
  const queue = read("./queue.js");
  assert.match(queue, /export const countAfterRun = \(ids\) => import\("\.\/changes\.js"\)\.then\(\(m\) => m\.badgeAfterRun\(ids\)\)/);
  assert.match(queue, /if \(ok\) countAfterRun\(jobs\.map\(\(j\) => j\.id\)\);/, "the console run, when apt went through");
  assert.match(queue, /onEnd: \(result\) => countAfterRun\(\(result\?\.rows \?\? \[\]\)\.filter\(\(r\) => r\.state === "installed"\)/, "Confirm's run, what installed");
});
