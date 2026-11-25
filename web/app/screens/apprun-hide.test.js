// F430: the sideload installs page's Hide (screens/apprun.js run on its own) and the strip it leaves (runstrip.js):
// hide and show, iOS's prompt on the strip, a run that ends hidden, Open Now's putAside, iFizBox's own IPA, Cancel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun, runPage } from "./apprun.js";
import { runStrip } from "./runstrip.js";
import { runAppQueueRun, appQueueRunning } from "./queue.js";
import { createAppQueue, SELF_ID } from "../core/appqueue.js";
import { WAITING_LABEL, CLOSING_LABEL, RETURN_LABEL } from "../nav/progress.js";
import { fakeDocument } from "../fakes.test-helper.js";

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

function fakePage() {
  const closers = [];
  const p = {
    finished: null, bars: [], closed: false, hidden: false, shows: 0,
    line() {}, status() {}, progress() {}, pane() {}, view() {}, filter() {},
    segmented: () => ({ select() {} }),
    bar(b) { p.bars.push(b); },
    reopen() { p.finished = null; },
    finish(f) { p.finished = f; },
    hide() { p.hidden = true; }, show() { p.hidden = false; p.shows++; },
    onClose(f) { closers.push(f); },
    close() { p.closed = true; for (const f of closers.splice(0)) f(); return Promise.resolve(); },
  };
  return p;
}

// Lanes: sign at once; each install reports `phase` and waits for end(id, error).
function fakeLanes(phase = "asking", here = false) {
  const waits = new Map();
  return {
    ...(here ? { local: () => true } : {}),
    sign: async (r) => ({ token: `t-${r.id}`, bundleId: r.id }),
    install: (r, { signal, progress }) => new Promise((resolve, reject) => {
      progress(phase, 0);
      signal.addEventListener("abort", () => reject(new Error("cancelled")));
      waits.set(r.id, { progress, end: (e) => (e ? reject(new Error(e)) : resolve(r.id === SELF_ID && !here ? { installed: null, host: true } : { installed: true })) });
    }),
    discard() {},
    async at(id) { for (let i = 0; i < 30 && !waits.has(id); i++) await settle(1); return waits.get(id); },
    async end(id, e) { const w = await this.at(id); waits.delete(id); w.end(e); await settle(); },
  };
}

const app = (id, name) => ({ id, name, mode: "install", url: `https://x/${id}.ipa`, version: "1.0" });
const self = () => app(SELF_ID, "iFizBox");

async function running(jobs, { phase, here, ...deps } = {}, check) {
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const t = { page: fakePage(), queue: createAppQueue(), lanes: fakeLanes(phase, here), confirms: [] };
    for (const j of jobs) t.queue.add(j);
    t.done = runAppRun(jobs, { queue: t.queue, lanes: t.lanes, open: () => t.page, later: () => 0, clear: () => {},
      reopenConfirm: (f) => t.confirms.push(f), ...deps });
    await settle();
    t.hide = () => t.page.bars.at(-1).right.click();
    t.strip = () => globalThis.document.body.children.find((n) => n.className === "qr-strip") ?? null;
    t.text = () => t.strip()?.firstChild.textContent ?? null;
    await check(t);
    if (!t.page.closed) t.page.close();
  } finally { globalThis.document = saved; }
}

test("F430 Hide puts the page away and the run goes on; Show brings it back", () => running([app("a", "Alpha"), app("b", "Beta")], { phase: "installing" }, async (t) => {
  const b = t.page.bars[0];
  assert.deepEqual([b.left.textContent, b.right.textContent], ["Cancel", "Hide"]);
  t.hide();
  assert.equal(t.page.hidden, true);
  assert.equal(t.text(), "Installing Alpha (1 of 2)");
  assert.ok(globalThis.document.body.classList.contains("qr-stripped"));
  await t.lanes.end("a");
  assert.equal(t.text(), "Installing Beta (2 of 2)");
  t.strip().click();
  assert.equal(t.page.hidden, false);
  assert.equal(t.strip(), null);
  assert.ok(!globalThis.document.body.classList.contains("qr-stripped"));
  t.hide(); // again
  assert.ok(t.strip());
  await t.lanes.end("b");
}));

test("F430 the strip says when a row waits for a tap on the iOS prompt", () => running([app("a", "Alpha"), app("b", "Beta")], {}, async (t) => {
  t.hide();
  assert.equal(t.text(), "Tap Install on the iOS prompt: Alpha");
  (await t.lanes.at("a")).progress("installing", 0.4);
  await settle();
  assert.match(t.text(), /^Installing Alpha/);
  await t.lanes.end("a");
  assert.equal(t.text(), "Tap Install on the iOS prompt: Beta");
  await t.lanes.end("b");
}));

test("F430 a run that ends hidden leaves its summary on the strip; Show reopens the finished page", () => running([app("a", "Alpha"), app("b", "Beta")], {}, async (t) => {
  t.hide();
  await t.lanes.end("a");
  await t.lanes.end("b", "no space");
  await t.done;
  assert.equal(t.text(), "1 installed, 1 failed");
  assert.deepEqual([t.page.hidden, t.page.shows], [true, 0]);
  t.strip().click();
  assert.equal(t.page.hidden, false);
  assert.equal(t.page.finished.label, RETURN_LABEL);
  assert.equal(t.page.bars.at(-1).right.textContent, "Retry All");
  t.page.bars.at(-1).right.click(); // a new pass can be hidden too
  assert.equal(t.page.bars.at(-1).right.textContent, "Hide");
  await t.lanes.end("b");
}));

test("F430 Open Now's putAside leaves no strip and the page comes back at the end", () => running([app("a", "Alpha")], {}, async (t) => {
  runPage().putAside();
  assert.deepEqual([t.page.hidden, t.strip()], [true, null]);
  await t.lanes.end("a");
  await t.done;
  assert.deepEqual([t.page.hidden, t.page.shows], [false, 1]);
}));

test("F430 a hidden run counts as aside: a link opens on top, and the end stays hidden", () => running([app("a", "Alpha")], {}, async (t) => {
  t.hide();
  assert.deepEqual([runPage().busy, runPage().aside], [true, true]);
  await t.lanes.end("a");
  assert.equal(t.page.hidden, true);
  await runPage().dismiss(); // a link once it is over
  assert.deepEqual([t.page.closed, t.strip()], [true, null]);
}));

test("F430 iFizBox's own IPA with iOS: the hidden page comes back locked, without Hide", () => running([app("a", "Alpha"), self()], { selfUpdate: () => new Promise(() => {}) }, async (t) => {
  t.hide();
  await t.lanes.end("a");
  assert.equal(t.text(), "Tap Install on the iOS prompt: iFizBox");
  await t.lanes.end(SELF_ID);
  await t.done;
  assert.deepEqual([t.page.hidden, t.strip()], [false, null]);
  assert.deepEqual([t.page.finished.label, t.page.finished.locked], [WAITING_LABEL, true]);
  assert.equal(t.page.bars.at(-1).right, undefined);
}));

test("F430 iFizBox's own IPA on This iPhone: back as soon as installd has it", () => running([self()], { phase: "copying", here: true, selfUpdate: () => new Promise(() => {}) }, async (t) => {
  t.hide();
  const hide = t.page.bars[0].right;
  (await t.lanes.at(SELF_ID)).progress("installing", 0.5);
  await settle();
  assert.deepEqual([t.page.hidden, t.strip()], [false, null]);
  assert.equal(t.page.bars.at(-1).right, undefined);
  hide.click(); // sliding off the bar: nothing
  assert.equal(t.page.hidden, false);
  await t.lanes.end(SELF_ID);
  assert.deepEqual([t.page.finished.label, t.page.hidden], [CLOSING_LABEL, false]);
}));

test("F430 iFizBox's own IPA on This iPhone: back once its copy ended, put away by Hide or Open Now", async () => {
  for (const away of ["hide", "aside"]) {
    await running([self()], { phase: "copying", here: true, selfUpdate: () => new Promise(() => {}) }, async (t) => {
      if (away === "hide") t.hide(); else runPage().putAside();
      const { progress } = await t.lanes.at(SELF_ID);
      progress("copying", 0.5);
      await settle();
      assert.equal(t.page.hidden, true);
      progress("copying", 1);
      await settle();
      assert.deepEqual([t.page.hidden, t.strip()], [false, null]);
      assert.equal(t.page.bars.at(-1).right, undefined);
      await t.lanes.end(SELF_ID);
    });
  }
});

test("F430 Cancel and Close take the strip away", async () => {
  await running([app("a", "Alpha")], {}, async (t) => {
    t.hide();
    t.strip().click();
    t.hide();
    t.page.bars[0].left.click(); // Cancel, tapped as the page went
    await t.done;
    assert.deepEqual([t.page.closed, t.strip(), t.confirms.length], [true, null, 1]);
  });
  await running([app("a", "Alpha")], {}, async (t) => {
    t.hide();
    await t.lanes.end("a", "no space");
    t.strip().click();
    t.page.bars.at(-1).left.click(); // Close
    assert.deepEqual([t.page.closed, t.strip()], [true, null]);
  });
});

test("F430 a second run stays blocked while one is hidden", async () => {
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const queue = createAppQueue();
    queue.add(app("a", "Alpha"));
    const page = fakePage();
    const l = fakeLanes();
    const go = (run) => runAppQueueRun(queue.list(), { queue, ready: async () => true, record: async () => {}, lanes: l, keep: () => {}, recount: () => {}, run });
    const done = go((jobs, d) => runAppRun(jobs, { ...d, open: () => page, later: () => 0, clear: () => {} }));
    for (let i = 0; i < 50 && !page.bars.length; i++) await settle(5);
    page.bars[0].right.click();
    assert.equal(page.hidden, true);
    assert.equal(appQueueRunning(), true);
    assert.equal(await go(() => assert.fail("a second run")), null);
    await l.end("a");
    await done;
    assert.equal(appQueueRunning(), true); // finished, still hidden
    page.close();
    assert.equal(appQueueRunning(), false);
  } finally { globalThis.document = saved; }
});

test("F430 no Hide on the jailbreak app's own run of apps", () => running([{ ...app("a", "Alpha"), helper: true }], { phase: "installing" }, async (t) => {
  assert.equal(t.page.bars[0].right, undefined);
  await t.lanes.end("a");
}));

test("F430 runStrip: one strip, its text read again by update()", () => {
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    let text = "one";
    let taps = 0;
    const s = runStrip({ text: () => text, onShow: () => taps++ });
    s.update(); // not up: nothing
    s.show();
    s.show();
    const up = () => globalThis.document.body.children.filter((n) => n.className === "qr-strip");
    assert.equal(up().length, 1);
    text = "two";
    s.update();
    assert.deepEqual(up()[0].children.map((n) => n.textContent), ["two", "Show"]);
    up()[0].click();
    assert.equal(taps, 1);
    s.hide();
    assert.equal(up().length, 0);
  } finally { globalThis.document = saved; }
});
