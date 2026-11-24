// F415: every signed install's end says what to do when the first launch shows "Unable to Verify App" (R96).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun } from "./apprun.js";
import { createAppQueue } from "../core/appqueue.js";
import { memoryAppStore } from "../core/installed.js";
import { FIRST_LAUNCH_HINT } from "../core/installroute.js";
import { firstLaunchHint } from "../core/apprun.js";
import { finishHere } from "../signing/common.js";
import { fakeDocument } from "../fakes.test-helper.js";

const row = (o = {}) => ({ id: "a", state: "installed", mode: "install", ...o });

test("the hint: what it tells the user to do", () => {
  for (const w of [/Unable to Verify App/, /Airplane Mode off/, /online/, /tap Cancel/, /open the app again/]) assert.match(FIRST_LAUNCH_HINT, w);
});

test("firstLaunchHint: signed apps that installed or re-signed, nothing else", () => {
  for (const mode of ["install", "upgrade", "resign"]) assert.equal(firstLaunchHint([row({ mode })]), FIRST_LAUNCH_HINT);
  assert.equal(firstLaunchHint([row({ state: "failed" }), row()]), FIRST_LAUNCH_HINT, "one is enough");
  assert.equal(firstLaunchHint([row({ state: "failed" }), row({ state: "cancelled" })]), null);
  assert.equal(firstLaunchHint([row({ mode: "remove" })]), null);
  assert.equal(firstLaunchHint([row({ job: { helper: true } })]), null, "the jailbreak's helper needs no profile");
});

test("a single install on This iPhone ends with it, without a button", () => {
  const lines = [], fin = [];
  finishHere({ set() {}, finish: (f) => fin.push(f), page: { help: (...a) => lines.push(a) } }, { bundleId: "com.a" }, { native: null, name: "A" });
  assert.deepEqual(lines, [[FIRST_LAUNCH_HINT, { label: "" }]]);
  assert.equal(fin.length, 1);
});

async function run(install) {
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const helps = [], closers = [], panes = [];
    const page = { line() {}, status() {}, progress() {}, pane(n) { panes.push(n); return n; }, view() {}, segmented() { return { select() {} }; },
      filter() {}, bar() {}, reopen() {}, finish() {}, help: (...a) => helps.push(a), onClose: (f) => closers.push(f), close: async () => {} };
    const queue = createAppQueue();
    queue.add({ id: "a", name: "Alpha", mode: "install", url: "https://x/a.ipa", version: "1" });
    await runAppRun(queue.list(), { queue, open: () => page, native: null, store: memoryAppStore(), record: () => {}, later: () => 0, clear() {},
      lanes: { sign: async () => ({ token: "t", bundleId: "a" }), install, discard() {} } });
    return { helps, texts: panes.flatMap(function walk(n) { return [n.textContent, ...(n.children ?? []).flatMap(walk)]; }) };
  } finally { globalThis.document = saved; }
}

test("an app run ends with it, in the Log and under the Apps list; a failed run doesn't", async () => {
  const ok = await run(async () => ({ installed: true }));
  assert.deepEqual(ok.helps, [[FIRST_LAUNCH_HINT, { label: "" }]]);
  assert.ok(ok.texts.includes(FIRST_LAUNCH_HINT));
  const bad = await run(async () => { throw new Error("no"); });
  assert.ok(!bad.helps.some((h) => h[0] === FIRST_LAUNCH_HINT));
  assert.ok(!bad.texts.includes(FIRST_LAUNCH_HINT));
});
