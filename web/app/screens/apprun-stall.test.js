// F424: a This iPhone install that copied its IPA and hears nothing from installd for CLOSE_AFTER, over an app that is
// still on the iPhone, says "Close <App> to finish installing" on its row and the run line, until installd's first percent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun } from "./apprun.js";
import { appRows, createAppRun, rowStatus, runStatus, CLOSE_AFTER } from "../core/apprun.js";
import { createAppQueue, SELF_ID } from "../core/appqueue.js";
import { memoryAppStore, recordInstall } from "../core/installed.js";
import { fakeDocument as fakeDom } from "../fakes.test-helper.js";

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const COPIED = "Copied to iPhone, waiting for iOS";
const CLOSE = "Close Delta to finish installing";
const app = (id, name, over = {}) => ({ id, name, mode: "upgrade", url: `https://x/${id}.ipa`, version: "2.0", installed: "1.0", ...over });

// later()/clear() with a clock the test moves
function clock() {
  const list = [];
  let now = 0;
  return {
    later: (f, ms) => { const t = { f, at: now + ms, on: true }; list.push(t); return t; },
    clear: (t) => { if (t) t.on = false; },
    live: () => list.filter((t) => t.on).length,
    pass: async (ms) => {
      now += ms;
      for (const t of list) if (t.on && t.at <= now) { t.on = false; t.f(); }
      await settle();
    },
  };
}

// the rows with iOS; `at(id)` is that row's install: { progress, end }
async function start(jobs, replacing = () => true) {
  const c = clock();
  const rows = appRows(jobs);
  const calls = new Map();
  const run = createAppRun({
    rows, ahead: Infinity, parallel: 3, local: () => true, later: c.later, clear: c.clear, replacing,
    sign: async (r) => ({ token: `t-${r.id}`, bundleId: r.id }),
    install: (r, { progress }) => new Promise((resolve, reject) => {
      calls.set(r.id, { progress, end: () => resolve({ installed: true }), fail: (e) => reject(new Error(e)) });
      progress("copying", 0.5);
    }),
  });
  const done = run.start();
  await settle();
  return { c, rows, run, done, at: (id) => calls.get(id) };
}

test("15 s of silence after the copy: Close <App>; back to the usual words at installd's first percent", async () => {
  const { c, rows, done, at } = await start([app("a", "Delta")]);
  assert.equal(CLOSE_AFTER, 15000);
  await c.pass(60000);
  assert.equal(rowStatus(rows[0]), "Copying to iPhone 50%", "a slow copy is not installd's silence");
  at("a").progress("copying", 1);
  await c.pass(CLOSE_AFTER - 1);
  assert.equal(rowStatus(rows[0]), COPIED);
  at("a").progress("copying", 1); // the copy's 100% again is not installd
  await c.pass(1);
  assert.equal(rowStatus(rows[0]), CLOSE);
  assert.equal(runStatus(rows), CLOSE);
  at("a").progress("installing", 0);
  assert.equal(rowStatus(rows[0]), "Installing");
  assert.equal(runStatus(rows), "Installing Delta (1 of 1)");
  await c.pass(CLOSE_AFTER * 2);
  assert.equal(rowStatus(rows[0]), "Installing");
  at("a").end();
  await done;
  assert.equal(rowStatus(rows[0]), "Installed");
  assert.equal(c.live(), 0);
});

test("installd's percent before the time: never the words, and no timer left", async () => {
  const { c, rows, done, at } = await start([app("a", "Delta")]);
  at("a").progress("copying", 1);
  await c.pass(5000);
  at("a").progress("installing", 0.05);
  assert.equal(c.live(), 0);
  await c.pass(CLOSE_AFTER);
  assert.equal(rowStatus(rows[0]), "Installing 5%");
  at("a").end();
  await done;
});

test("the copy again (a plain retry): copying's words, and a new silence", async () => {
  const { c, rows, done, at } = await start([app("a", "Delta")]);
  at("a").progress("copying", 1);
  await c.pass(CLOSE_AFTER);
  assert.equal(rowStatus(rows[0]), CLOSE);
  at("a").progress("copying", 0.2);
  assert.equal(rowStatus(rows[0]), "Copying to iPhone 20%");
  at("a").progress("copying", 1);
  assert.equal(rowStatus(rows[0]), COPIED);
  await c.pass(CLOSE_AFTER);
  assert.equal(rowStatus(rows[0]), CLOSE);
  at("a").end();
  await done;
});

test("no words when the app is not on the iPhone, or it can't be told", async () => {
  for (const replacing of [() => false, async () => null, () => { throw new Error("x"); }, () => Promise.reject(new Error("x"))]) {
    const { c, rows, done, at } = await start([app("a", "Delta")], replacing);
    at("a").progress("copying", 1);
    await c.pass(CLOSE_AFTER * 3);
    assert.equal(rowStatus(rows[0]), COPIED);
    assert.equal(runStatus(rows), "Copied Delta to iPhone, waiting for iOS (1 of 1)");
    at("a").end();
    await done;
  }
});

test("a percent that comes while iFizBox asks whether the app is there: the words stay away", async () => {
  let answer;
  const { c, rows, done, at } = await start([app("a", "Delta")], () => new Promise((r) => { answer = r; }));
  at("a").progress("copying", 1);
  await c.pass(CLOSE_AFTER);
  at("a").progress("installing", 0);
  answer(true);
  await settle();
  assert.equal(rowStatus(rows[0]), "Installing");
  at("a").end();
  await done;
});

test("several apps: another row's percent or end is news from installd, so a waiting row's silence starts again", async () => {
  const { c, rows, done, at } = await start([app("a", "Delta"), app("b", "Echo")]);
  at("a").progress("copying", 1);
  await settle();
  at("b").progress("copying", 1);
  await c.pass(10000);
  at("a").progress("installing", 0.3);
  await c.pass(10000);
  assert.equal(rowStatus(rows[1]), COPIED);
  at("a").end();
  await settle();
  await c.pass(CLOSE_AFTER - 1);
  assert.equal(rowStatus(rows[1]), COPIED);
  await c.pass(1);
  assert.equal(rowStatus(rows[1]), "Close Echo to finish installing");
  assert.equal(runStatus(rows), "Close Echo to finish installing");
  at("b").end();
  await done;
});

test("iFizBox's own IPA never says to close it; a failed row and its retry start clean", async () => {
  const self = await start([app(SELF_ID, "Self")]);
  self.at(SELF_ID).progress("copying", 1);
  await self.c.pass(CLOSE_AFTER * 2);
  assert.equal(rowStatus(self.rows[0]), COPIED);
  self.at(SELF_ID).end();
  await self.done;

  const { c, rows, run, done, at } = await start([app("a", "Delta")]);
  at("a").progress("copying", 1);
  await c.pass(CLOSE_AFTER);
  at("a").fail("installd said no");
  await done;
  assert.equal(c.live(), 0);
  const again = run.retry("a");
  await settle();
  at("a").progress("copying", 1);
  assert.equal(rowStatus(rows[0]), COPIED);
  at("a").end();
  await again;
});

// ---- the page: which app counts as still on the iPhone ----
async function pageWords(job, says, records = []) {
  const saved = globalThis.document;
  globalThis.document = fakeDom();
  try {
    const c = clock();
    const queue = createAppQueue();
    const store = memoryAppStore();
    for (const r of records) await recordInstall(store, r);
    const p = { last: "", closers: [], line() {}, status(t) { p.last = t; }, progress() {}, pane(n) { return n; }, view() {},
      segmented: () => ({ select() {} }), filter() {}, bar() {}, reopen() {}, finish() {}, onClose() {}, close: async () => {} };
    let call;
    const lanes = { local: () => true, discard() {}, sign: async (r) => ({ token: "t", bundleId: r.id }),
      isInstalled: async (ids) => ({ [ids[0]]: says }),
      install: (r, { progress }) => new Promise((resolve) => { call = { progress, end: () => resolve({ installed: true }) }; }) };
    const done = runAppRun([job], { queue, lanes, store: async () => store, open: () => p, later: c.later, clear: c.clear, keepAwake() {},
      doc: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} } });
    await settle();
    call.progress("copying", 1);
    await c.pass(CLOSE_AFTER);
    const words = p.last;
    call.end();
    await Promise.race([done, settle(30)]);
    return words;
  } finally { globalThis.document = saved; }
}

test("the page asks iOS, then what iFizBox knows when iOS has no answer (iOS 27)", async () => {
  const fresh = app("a", "Delta", { mode: "install", installed: null });
  const waiting = "Copied Delta to iPhone, waiting for iOS (1 of 1)";
  assert.equal(await pageWords(fresh, true), CLOSE);
  assert.equal(await pageWords(app("a", "Delta"), false), waiting, "deleted meanwhile");
  assert.equal(await pageWords(app("a", "Delta"), null), CLOSE);
  assert.equal(await pageWords(app("a", "Delta", { installed: "" }), null), CLOSE, "installed, version not known");
  assert.equal(await pageWords(app("a", "Delta", { mode: "resign", installed: null }), null), CLOSE);
  assert.equal(await pageWords(fresh, null), waiting);
  assert.equal(await pageWords(fresh, null, [{ id: "a", name: "Delta", version: "1.0" }]), CLOSE);
});
