// B174: an IPA handed over (Files, Share > Open in iFizBox) ends on its page: a link the shell keeps while the page's
// take is under way is taken, and Return Home After (app.js) leaves a hand-off's page alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startIncoming } from "./incoming.js";
import { markHandoff, handoffRecent, HANDOFF_MS } from "./handoffclock.js";

function events() {
  const listeners = {};
  return { listeners, addEventListener: (t, f) => { listeners[t] = f; } };
}

test("cold launch: a link the shell keeps while the start take is out is taken by the round after it", async () => {
  const kept = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  let n = 0;
  const native = {
    async call(m) {
      if (m !== "app.takeURL") return { lines: [] };
      n++;
      if (n === 1) { await gate; return null; } // the start take: nothing yet, answered late
      const u = kept.shift();
      return u ? { url: u } : null;
    },
  };
  const ev = events();
  const started = startIncoming({ native, events: ev });
  kept.push("ifizbox://nothing-of-ours/y"); // the shell keeps the link and says so while the take is out
  ev.listeners["ifizbox:url"]();
  release();
  await started;
  assert.deepEqual(kept, []); // taken
  assert.equal(n, 3); // the empty start, the link, then none left
});

test("handoff clock: recent for HANDOFF_MS after a mark, not before any", () => {
  assert.equal(handoffRecent(0), false);
  markHandoff(1000);
  assert.equal(handoffRecent(1000), true);
  assert.equal(handoffRecent(1000 + HANDOFF_MS - 1), true);
  assert.equal(handoffRecent(1000 + HANDOFF_MS), false);
  assert.equal(handoffRecent(999), false); // a clock that went back is no hand-off
});

test("the shell's receiving and url events mark a hand-off", async () => {
  const native = { async call() { return null; } };
  const ev = events();
  markHandoff(-1e15);
  await startIncoming({ native, events: ev });
  assert.equal(handoffRecent(), false);
  ev.listeners["ifizbox:receiving"]({ detail: { name: "A.ipa", progress: null } });
  assert.equal(handoffRecent(), true);
  markHandoff(-1e15);
  await ev.listeners["ifizbox:url"]();
  assert.equal(handoffRecent(), true);
});

test("Return Home After leaves a hand-off's page alone (app.js)", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  // nav/hometop.js createReturnHome asks blocked() before going Home (hometop.test.js)
  assert.match(app, /blocked: \(\) => [^\n]*handoffRecent\(\)/);
});
