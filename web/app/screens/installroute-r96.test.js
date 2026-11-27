// B492: an install's end no longer says what to do about "Unable to Verify App" on the first launch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun } from "./apprun.js";
import { createAppQueue } from "../core/appqueue.js";
import { memoryAppStore } from "../core/installed.js";
import { finishHere } from "../signing/common.js";
import { fakeDocument } from "../fakes.test-helper.js";

test("a single install on This iPhone ends with no first-launch line", () => {
  const lines = [], fin = [];
  finishHere({ set() {}, finish: (f) => fin.push(f), page: { help: (...a) => lines.push(a) } }, { bundleId: "com.a" }, { native: null, name: "A" });
  assert.deepEqual(lines, []);
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

test("an app run ends with no first-launch line, in the Log or under the Apps list", async () => {
  const ok = await run(async () => ({ installed: true }));
  assert.deepEqual(ok.helps, []);
  assert.ok(!ok.texts.some((t) => /Unable to Verify App/.test(t ?? "")));
});
