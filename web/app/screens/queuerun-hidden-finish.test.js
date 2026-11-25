// F429: a queue run put away with Hide that ends on Restart or Reload SpringBoard or Reboot Device asks in an alert:
// Later leaves the strip; the action shows the page and does what its finish button does, once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runQueue } from "./queuerun.js";
import { parseSimulation, createQueue, createRunLog } from "../core/queue.js";
import { fakeDocument } from "../fakes.test-helper.js";

const settle = () => new Promise((r) => setTimeout(r, 5));

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
    // nav/progress.js's finish button
    async tapFinish() {
      let keep = true;
      try { keep = await p.finished.action(); } catch { /* stays */ }
      if (!keep) p.close();
    },
  };
  return p;
}

// One run of two packages, held in dpkg until go(). answer(index) taps the alert's button.
async function ended({ kind = "tweak", level = null, hide = true, fail = false, cancel = false, finishAction } = {}, check) {
  const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame };
  globalThis.document = fakeDocument();
  globalThis.requestAnimationFrame = (f) => { queueMicrotask(f); return 1; };
  try {
    const jobs = ["one", "two"].map((id) => ({ op: "install", id, name: id, mode: "install" }));
    const queue = createQueue();
    for (const j of jobs) queue.add(j);
    let go;
    const gate = new Promise((f) => { go = f; });
    const t = { page: fakePage(), alerts: [], actions: [], confirms: [], broken: fail };
    const backend = {
      queueFetch: async (r) => ({ file: `${r.id}.deb` }),
      async queueInstall(r, { onEvent }) {
        await gate;
        if (r.id === "two" && t.broken) return { code: 100, stdout: "", stderr: "E: broken" };
        if (level && r.id === "one") onEvent({ fd: "status", line: `finish:${level}` });
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const alert = (o) => new Promise((resolve) => {
      t.alerts.push(o);
      t.answer = (index) => resolve({ index });
      o.signal?.addEventListener("abort", () => resolve({ index: -1 }));
    });
    const done = runQueue({ jobs, plan: parseSimulation("Inst one (1.0 R [a])\nInst two (1.0 R [a])") }, {
      backend, queue, runLogs: createRunLog(null, { flushMs: 0 }), open: () => t.page, alert,
      catalog: { runInfo: async () => ({ one: { debUrl: "https://r/1" }, two: { debUrl: "https://r/2" }, installed: {} }),
        queueInfo: async () => ({ one: { kind }, two: { kind } }), reloadInstalled: async () => {} },
      finishAction: finishAction ? (c) => finishAction(c, t) : async (c) => { t.actions.push(c.level); return false; },
      reopenConfirm: (f) => t.confirms.push(f),
    });
    await settle();
    if (hide) t.page.bars[0].right.click();
    if (cancel) t.page.bars[0].left.click();
    go();
    await done;
    await settle();
    t.strip = () => globalThis.document.body.children.find((n) => n.className === "qr-strip") ?? null;
    await check(t);
  } finally { globalThis.document = saved.document; globalThis.requestAnimationFrame = saved.raf; }
}
const shape = (a) => ({ message: a.message, buttons: a.buttons, cancel: a.cancel });

test("F429 a tweak's run put away asks; the action shows the page and runs the finish button's action once", () => ended({}, async (t) => {
  assert.deepEqual(t.alerts.map(shape), [{ message: "2 installed", buttons: ["Later", "Restart SpringBoard"], cancel: 0 }]);
  assert.ok(t.strip());
  t.answer(1);
  await settle();
  assert.equal(t.page.shows, 1);
  assert.equal(t.strip(), null);
  assert.deepEqual(t.actions, ["restart"]);
  assert.equal(t.page.closed, true);
}));

for (const [level, label] of [["reload", "Reload SpringBoard"], ["reboot", "Reboot Device"]]) {
  test(`F429 ${label} asks too`, () => ended({ kind: "package", level }, async (t) => {
    assert.deepEqual(t.alerts[0]?.buttons, ["Later", label]);
    t.answer(1);
    await settle();
    assert.deepEqual(t.actions, [level]);
  }));
}

test("F429 Later leaves the strip; its Show brings the page and its button back", () => ended({}, async (t) => {
  t.answer(0);
  await settle();
  assert.deepEqual([t.page.hidden, t.page.closed, t.actions.length], [true, false, 0]);
  assert.equal(t.strip().firstChild.textContent, "2 installed");
  t.strip().click();
  assert.equal(t.page.hidden, false);
  await t.page.tapFinish();
  assert.deepEqual(t.actions, ["restart"]);
  assert.equal(t.alerts.length, 1);
}));

test("F429 no alert with the page showing", () => ended({ hide: false }, async (t) => {
  assert.equal(t.alerts.length, 0);
  assert.equal(t.page.finished.label, "Restart SpringBoard");
}));

test("F429 no alert for a cancelled run", () => ended({ cancel: true }, async (t) => {
  assert.equal(t.alerts.length, 0);
  assert.equal(t.confirms.length, 1);
}));

for (const [kind, label] of [["package", /^Return to /], ["app", /^Reload Data$/]]) {
  test(`F429 no alert when the run ends on ${label}`, () => ended({ kind }, async (t) => {
    assert.equal(t.alerts.length, 0);
    assert.match(t.page.finished.label, label);
    assert.ok(t.strip());
  }));
}

test("F429 the strip tapped before answering takes the alert down: one way left", () => ended({}, async (t) => {
  t.strip().click();
  assert.equal(t.alerts[0].signal.aborted, true);
  t.answer(1); // a late tap changes nothing
  await settle();
  assert.deepEqual(t.actions, []);
  await t.page.tapFinish();
  assert.deepEqual(t.actions, ["restart"]);
}));

test("F429 the finish button tapped while the alert's action runs doesn't run it again", () => {
  let end;
  return ended({ finishAction: (c, t) => { t.actions.push(c.level); return new Promise((f) => { end = () => f(false); }); } }, async (t) => {
    t.answer(1);
    await settle();
    const tap = t.page.tapFinish();
    await settle();
    assert.deepEqual(t.actions, ["restart"]);
    end();
    await tap;
    assert.deepEqual(t.actions, ["restart"]);
    assert.equal(t.page.closed, true);
  });
});

test("F429 an action that failed keeps the page up, its button working", () => ended({
  finishAction: async (c, t) => { t.actions.push(c.level); return t.actions.length === 1; },
}, async (t) => {
  t.answer(1);
  await settle();
  assert.deepEqual([t.page.hidden, t.page.closed], [false, false]);
  await t.page.tapFinish();
  assert.deepEqual(t.actions, ["restart", "restart"]);
  assert.equal(t.page.closed, true);
}));

test("F429 a run with failures that needs the restart asks too; a retry from the page doesn't ask again", () => ended({ fail: true }, async (t) => {
  assert.deepEqual(t.alerts.map(shape), [{ message: "1 installed, 1 failed", buttons: ["Later", "Restart SpringBoard"], cancel: 0 }]);
  t.strip().click();
  t.broken = false;
  t.page.bars.at(-1).right.click();
  for (let i = 0; i < 20 && !t.page.finished; i++) await settle();
  assert.equal(t.page.finished.label, "Restart SpringBoard");
  assert.equal(t.alerts.length, 1);
}));
