// B452: Open Now (runPage().putAside) while iFizBox's own update is locked on Waiting for iOS or Closing iFizBox: the
// run has ended, so the follow (screens/apprun.js followSelf, followHere) brings the page back with its next finish.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun, runPage } from "./apprun.js";
import { createAppQueue, SELF_ID } from "../core/appqueue.js";
import { WAITING_LABEL, CLOSING_LABEL, RETURN_LABEL, TRY_AGAIN_LABEL, CLOSE_GRACE } from "../nav/progress.js";
import { WAIT_HINT } from "../signing/selfupdate.js";
import { fakeDocument } from "../fakes.test-helper.js";

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

function fakePage() {
  const closers = [];
  const p = {
    finished: null, closed: false, hidden: false, shows: 0,
    line() {}, status() {}, progress() {}, pane() {}, view() {}, filter() {}, bar() {},
    segmented: () => ({ select() {} }),
    reopen() { p.finished = null; },
    finish(f) { p.finished = f; },
    hide() { p.hidden = true; }, show() { if (p.hidden) p.shows++; p.hidden = false; },
    onClose(f) { closers.push(f); },
    close() { p.closed = true; for (const f of closers.splice(0)) f(); return Promise.resolve(); },
  };
  return p;
}

// A run of iFizBox's own IPA, ended and locked, put aside with Open Now -> check({ page, push, end, timer })
async function lockedAside(here, check) {
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  const page = fakePage();
  try {
    const job = { id: SELF_ID, name: "iFizBox", mode: "install", url: "https://x/self.ipa", version: "2.0" };
    const queue = createAppQueue();
    queue.add(job);
    const timers = [];
    const w = {};
    await runAppRun([job], {
      queue, open: () => page, clear: () => {}, reopenConfirm: () => {},
      later: (f, ms) => { timers.push({ f, ms }); return timers.length; },
      selfUpdate: (onState) => { w.push = onState; return new Promise((res) => { w.end = res; }); },
      lanes: {
        sign: async () => ({ token: "t", bundleId: SELF_ID }),
        install: async (r, { progress }) => {
          progress(here ? "copying" : "asking", 0);
          return here ? { installed: true } : { installed: null, host: true };
        },
        discard() {},
      },
    });
    await settle();
    assert.deepEqual([page.finished.label, page.finished.locked], [here ? CLOSING_LABEL : WAITING_LABEL, true]);
    assert.equal(runPage().busy, true);
    runPage().putAside();
    assert.equal(page.hidden, true);
    await check({
      page, push: w.push,
      end: async (s) => { w.end(s); await settle(); },
      timer: (ms) => timers.find((t) => t.ms === ms).f(),
      back: (label) => assert.deepEqual([page.hidden, page.shows, page.finished.label], [false, 1, label]),
    });
  } finally {
    if (!page.closed) page.close();
    globalThis.document = saved;
  }
}

test("B452 Waiting for iOS put aside: steps leave it away, Closing brings it back, and byHand if put aside again", () => lockedAside(false, async (t) => {
  t.push("waiting");
  t.push("asked");
  assert.equal(t.page.hidden, true);
  t.push("finished");
  t.back(CLOSING_LABEL);
  runPage().putAside();
  t.timer(CLOSE_GRACE);
  assert.deepEqual([t.page.hidden, t.page.shows, t.page.finished.label], [false, 2, RETURN_LABEL]);
  assert.equal(runPage().busy, false);
}));

test("B452 Waiting for iOS put aside: the hint's Try Again and Return bring it back", () => lockedAside(false, async (t) => {
  t.push("waiting");
  t.timer(WAIT_HINT);
  t.back(RETURN_LABEL);
  assert.equal(t.page.finished.also.label, TRY_AGAIN_LABEL);
}));

test("B452 Waiting for iOS put aside: back with Try Again when iOS never took it", () => lockedAside(false, async (t) => {
  await t.end("notStarted");
  t.back(TRY_AGAIN_LABEL);
}));

test("B452 Waiting for iOS put aside: back with Return when the shell can't be followed", () => lockedAside(false, async (t) => {
  await t.end(null);
  t.back(RETURN_LABEL);
}));

test("B452 This iPhone, Closing iFizBox put aside: back once it is still here after the grace", () => lockedAside(true, async (t) => {
  await t.end("finished");
  assert.equal(t.page.hidden, true);
  t.timer(CLOSE_GRACE);
  t.back(RETURN_LABEL);
}));

test("B452 This iPhone, Closing iFizBox put aside: back when installd answered without closing it", () => lockedAside(true, async (t) => {
  await t.end(null);
  t.back(RETURN_LABEL);
}));

test("B452 a page closed while put aside is not shown again", () => lockedAside(false, async (t) => {
  t.page.close();
  t.push("finished");
  await t.end("finished");
  assert.equal(t.page.shows, 0);
}));
