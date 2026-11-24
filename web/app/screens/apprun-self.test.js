// B123: the IPA queue's run when iFizBox's own IPA went to iOS (screens/apprun.js followSelf): the page follows the
// shell's signing.selfUpdate, locked on "Waiting for iOS" and "Closing iFizBox" only once the shell closes; notStarted
// turns the row Failed (back in the queue) with Try Again; a shell that can't be followed, or an iFizBox
// still open after Closing, ends on an honest "close it from the app switcher"; This iPhone ends on Return with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun, phoneLanes } from "./apprun.js";
import { createAppQueue, SELF_ID } from "../core/appqueue.js";
import { createAppRun, appRows, rowStatus, summaryLine } from "../core/apprun.js";
import { SELF_UPDATE_LINES, SELF_UPDATE_FAILED, watchSelfUpdate, HERE_CLOSING_LINE } from "../signing-client.js";
import { WAIT_HINT, waitHint, followSelfUpdate } from "../signing/selfupdate.js";
import { WAITING_LABEL, CLOSING_LABEL, TRY_AGAIN_LABEL, RETURN_LABEL, CLOSE_BY_HAND, RESTART_BY_HAND, CLOSE_GRACE } from "../nav/progress.js";
import { fakeDocument as fakeDom } from "../fakes.test-helper.js";

function fakePage() {
  const p = {
    lines: [], statuses: [], finished: null, finishes: [], bars: [], closers: [], closed: false, panes: [], views: [],
    line(kind, text, id) { p.lines.push({ kind, text, id }); },
    status(t) { p.statuses.push(t); }, progress() {},
    pane(n) { p.panes.push(n); return n; }, view(v) { p.views.push(v); },
    segmented() { return { select: () => {} }; },
    filter() {}, bar(b) { p.bars.push(b); },
    reopen() { p.finished = null; },
    finish(f) { p.finished = f; p.finishes.push(f); },
    onClose(f) { p.closers.push(f); },
    close() { p.closed = true; for (const f of p.closers.splice(0)) f(); return Promise.resolve(); },
  };
  return p;
}

async function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = fakeDom();
  try { await fn(); } finally { globalThis.document = saved; }
}
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// Lanes: sign at once; install answers as the host route does (installed null: sent), or as This iPhone (`here`).
function lanes({ here = false } = {}) {
  const calls = { sign: [], install: [] };
  return {
    calls,
    sign: async (r) => { calls.sign.push(r.id); return { token: `t-${r.id}`, bundleId: r.id }; },
    install: async (r, { progress }) => {
      calls.install.push(r.id);
      if (here) { progress("copying", 0.5); progress("installing", 1); return { installed: true }; }
      progress("asking", 0);
      return { installed: null, host: true };
    },
    discard: () => {},
  };
}

// signing.selfUpdate stood in for: each state is pushed by the test; end(state) answers.
function selfWatch() {
  const w = { calls: 0, push: null, end: null };
  w.fn = (onState) => { w.calls++; w.push = onState; return new Promise((res) => { w.end = res; }); };
  return w;
}

function setup(jobs, deps = {}, laneOpts = {}) {
  const queue = createAppQueue();
  for (const j of jobs) queue.add(j);
  const page = fakePage();
  const timers = [];
  const l = lanes(laneOpts);
  const done = runAppRun(queue.list(), { queue, lanes: l, open: () => page, later: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clear: () => {}, ...deps });
  return { queue, page, timers, l, done };
}
const self = () => ({ id: SELF_ID, name: "iFizBox", mode: "install", url: "https://x/self.ipa", version: "2.0" });
const steps = (page) => page.lines.filter((x) => x.kind === "step").map((x) => x.text);
const errors = (page) => page.lines.filter((x) => x.kind === "error").map((x) => x.text);

test("self row, hosted: Waiting for iOS (locked) while the shell waits, a line a state, Closing only at finished", () => withDom(async () => {
  const w = selfWatch();
  const s = setup([self()], { selfUpdate: w.fn });
  await s.done;
  await settle();
  assert.equal(w.calls, 1);
  assert.deepEqual([s.page.finished.label, s.page.finished.locked], [WAITING_LABEL, true]);
  w.push("prompt");
  w.push("waiting");
  w.push("waiting");
  assert.equal(s.page.finished.label, WAITING_LABEL);
  w.push("asked");
  assert.equal(s.page.finished.label, WAITING_LABEL);
  w.push("finished");
  assert.deepEqual([s.page.finished.label, s.page.finished.locked], [CLOSING_LABEL, true]);
  w.end("finished");
  await settle();
  const st = steps(s.page);
  for (const k of ["waiting", "asked", "finished"]) assert.equal(st.filter((t) => t === SELF_UPDATE_LINES[k]).length, 1, k);
  assert.ok(st.indexOf(SELF_UPDATE_LINES.waiting) < st.indexOf(SELF_UPDATE_LINES.finished));
  // still here CLOSE_GRACE later: the honest instruction and Return
  const grace = s.timers.find((t) => t.ms === CLOSE_GRACE);
  assert.ok(grace, "a grace timer");
  grace.f();
  assert.ok(errors(s.page).includes(CLOSE_BY_HAND));
  assert.equal(s.page.finished.label, RETURN_LABEL);
  assert.ok(!s.page.finished.locked);
  assert.equal(s.queue.size, 0);
}));

// B394: cancelled, unanswered or slow: seconds later the page says what to do and unlocks with Try Again and Return, and
// still follows, so a late download turns it to Closing.
test("self row, hosted: no download within WAIT_HINT: what to do, Try Again and Return, still following", () => withDom(async () => {
  const w = selfWatch();
  const s = setup([self()], { selfUpdate: w.fn });
  await s.done;
  await settle();
  assert.deepEqual([s.page.finished.title, s.page.finished.status], ["Updating", "1 sent to iOS"], "not Complete, not installed");
  assert.ok(!steps(s.page).includes("1 installed"));
  w.push("prompt");
  w.push("waiting");
  const hints = s.timers.filter((t) => t.ms === WAIT_HINT);
  assert.equal(hints.length, 1, "one timer, from the prompt");
  assert.ok(WAIT_HINT <= 10_000, "within seconds");
  hints[0].f();
  assert.ok(steps(s.page).includes(waitHint("waiting")));
  assert.deepEqual([s.page.finished.label, s.page.finished.locked, s.page.finished.also.label], [RETURN_LABEL, undefined, TRY_AGAIN_LABEL]);
  // Install tapped after all: iOS asks for it, then its second question
  w.push("asked");
  const second = s.timers.filter((t) => t.ms === WAIT_HINT);
  assert.equal(second.length, 2);
  second[1].f();
  assert.ok(steps(s.page).includes(waitHint("asked")));
  assert.equal(s.page.finished.also.label, TRY_AGAIN_LABEL);
  w.end("finished");
  await settle();
  assert.deepEqual([s.page.finished.label, s.page.finished.locked], [CLOSING_LABEL, true]);
  assert.ok(s.timers.some((t) => t.ms === CLOSE_GRACE));
}));

test("self row, hosted: Try Again while waiting sends it again and follows it anew; the first follow is dropped", () => withDom(async () => {
  const w = selfWatch();
  const s = setup([self()], { selfUpdate: w.fn });
  await s.done;
  await settle();
  const old = w.push;
  w.push("waiting");
  s.timers.find((t) => t.ms === WAIT_HINT).f();
  const { also } = s.page.finished;
  assert.equal(await also.action(), true, "the page stays up");
  await settle();
  assert.deepEqual(s.l.calls.install, [SELF_ID, SELF_ID]);
  assert.equal(w.calls, 2);
  assert.equal(s.page.finished.label, WAITING_LABEL);
  assert.equal(s.queue.size, 0);
  const n = s.page.lines.length;
  old("asked");
  assert.equal(s.page.lines.length, n, "the first follow writes nothing more");
  s.timers.filter((t) => t.ms === WAIT_HINT)[0].f();
  assert.equal(s.page.finished.label, WAITING_LABEL, "nor does its timer unlock the new one");
  w.push("prompt");
  w.end("finished");
  await settle();
  assert.equal(s.page.finished.label, CLOSING_LABEL);
}));

test("self row, hosted: the hint stands down once iOS asked (its own timer), once closing and once failed", () => withDom(async () => {
  for (const [state, label] of [["asked", WAITING_LABEL], ["finished", CLOSING_LABEL], ["notStarted", TRY_AGAIN_LABEL]]) {
    const w = selfWatch();
    const s = setup([self()], { selfUpdate: w.fn });
    await s.done;
    await settle();
    w.push("waiting");
    if (state === "asked") w.push(state); else { w.end(state); await settle(); }
    s.timers.find((t) => t.ms === WAIT_HINT).f();
    assert.ok(!steps(s.page).includes(waitHint("waiting")), state);
    assert.equal(s.page.finished.label, label, state);
  }
}));

test("followSelfUpdate (single install): the hint, Try Again and Return, then Closing at a late finish; Try Again ends the follow", async () => {
  for (const tap of [false, true]) {
    const lines = [], finishes = [], timers = [];
    const page = { closed: false, step: (t) => lines.push(t), error: (t) => lines.push(t) };
    const h = { page, finish: (o) => finishes.push(o) };
    let push, end, retried = 0;
    const native = { call: (m, p, onEvent) => { push = (st) => onEvent({ state: st }); return new Promise((r) => { end = r; }); } };
    const done = followSelfUpdate(h, { native, waiting: true, retry: () => { retried++; }, later: (f, ms) => timers.push({ f, ms }) });
    await settle();
    push("prompt");
    push("waiting");
    timers.find((t) => t.ms === WAIT_HINT).f();
    assert.ok(lines.includes(waitHint("waiting")));
    assert.deepEqual([finishes.at(-1).label, finishes.at(-1).also.label], [RETURN_LABEL, TRY_AGAIN_LABEL]);
    const n = finishes.length;
    if (tap) assert.equal(finishes.at(-1).also.action(), false, "the page closes");
    end({ state: "finished" });
    assert.equal(await done, "finished");
    await settle();
    assert.equal(retried, tap ? 1 : 0);
    if (tap) assert.equal(finishes.length, n, "the old follow is over");
    else assert.deepEqual([finishes.at(-1).label, finishes.at(-1).locked], [CLOSING_LABEL, true]);
  }
});

test("summaryLine: iFizBox's own IPA with iOS counts as sent, installed only once confirmed", () => {
  const row = (over) => ({ ...appRows([{ id: SELF_ID, name: "iFizBox", mode: "install", url: "https://x/s.ipa" }])[0], state: "installed", ...over });
  assert.equal(summaryLine([row({ unsure: true })]), "1 sent to iOS");
  assert.equal(summaryLine([row({ unsure: false })]), "1 installed");
});

test("self row, hosted: a guess (older server) is Closing too; a closed page gets no late instruction", () => withDom(async () => {
  const w = selfWatch();
  const s = setup([self()], { selfUpdate: w.fn });
  await s.done;
  await settle();
  w.push("prompt");
  w.end("guessed");
  await settle();
  assert.equal(s.page.finished.label, CLOSING_LABEL);
  await s.page.close();
  const n = s.page.finishes.length;
  s.timers.find((t) => t.ms === CLOSE_GRACE).f();
  assert.equal(s.page.finishes.length, n);
}));

for (const state of ["notStarted"]) {
  test(`self row, hosted: ${state} turns the row Failed, back in the queue, with Try Again that sends it again`, () => withDom(async () => {
    const w = selfWatch();
    const s = setup([self()], { selfUpdate: w.fn });
    await s.done;
    await settle();
    assert.equal(s.queue.size, 0, "sent: out of the queue");
    w.push("prompt");
    w.push("waiting");
    w.end(state);
    await settle();
    assert.ok(errors(s.page).includes(SELF_UPDATE_FAILED[state]));
    const f = s.page.finished;
    assert.equal(f.label, TRY_AGAIN_LABEL);
    assert.ok(!f.locked);
    assert.equal(s.queue.size, 1, "back in the queue");
    const li = s.page.panes[0].children[0].children.find((x) => x.className === "qr-row");
    assert.equal(li.dataset.state, "failed");
    assert.match(li.children[0].children[1].textContent, /didn't download/);
    assert.equal(s.page.bars.at(-1).right.textContent, "Retry All");
    // Try Again: signed and sent again, followed again
    assert.equal(await f.action(), true, "the page stays up");
    await settle();
    assert.deepEqual(s.l.calls.sign, [SELF_ID, SELF_ID]);
    assert.equal(w.calls, 2);
    assert.equal(s.page.finished.label, WAITING_LABEL);
    assert.equal(s.queue.size, 0);
  }));
}

test("self row, hosted: a shell that can't be followed (older, or none running) says to close it by hand", () => withDom(async () => {
  for (const watch of [async () => null, async () => { throw new Error("unknown method"); }]) {
    const s = setup([self()], { selfUpdate: watch });
    await s.done;
    await settle();
    assert.ok(errors(s.page).includes(CLOSE_BY_HAND));
    assert.equal(s.page.finished.label, RETURN_LABEL);
    assert.ok(!s.page.finished.locked);
  }
}));

test("self row, This iPhone: installd answered while iFizBox lived (shell: none closing): Return and the instruction", () => withDom(async () => {
  for (const watch of [async () => null, async () => { throw new Error("unknown method"); }, undefined]) {
    const s = setup([self()], { selfUpdate: watch }, { here: true });
    await s.done;
    await settle();
    assert.ok(steps(s.page).includes(RESTART_BY_HAND));
    assert.ok(!steps(s.page).includes(HERE_CLOSING_LINE));
    assert.equal(s.page.finished.label, RETURN_LABEL);
    assert.ok(!s.page.finished.locked);
  }
}));

test("self row, This iPhone (B159): the shell closing for installd locks on Closing iFizBox, then by hand if still here", () => withDom(async () => {
  const w = selfWatch();
  const s = setup([self()], { selfUpdate: w.fn }, { here: true });
  await s.done;
  await settle();
  assert.equal(w.calls, 1, "the page follows signing.selfUpdate");
  assert.deepEqual([s.page.finished.label, s.page.finished.locked], [CLOSING_LABEL, true]);
  w.end("finished");
  await settle();
  assert.ok(steps(s.page).includes(HERE_CLOSING_LINE));
  assert.ok(!steps(s.page).includes(RESTART_BY_HAND));
  assert.deepEqual([s.page.finished.label, s.page.finished.locked], [CLOSING_LABEL, true]);
  s.timers.find((t) => t.ms === CLOSE_GRACE).f();
  assert.ok(errors(s.page).includes(CLOSE_BY_HAND));
  assert.equal(s.page.finished.label, RETURN_LABEL);
  assert.ok(!s.page.finished.locked);
}));

test("notTaken: only an ended run's sent row turns Failed", async () => {
  const rows = appRows([{ id: SELF_ID, name: "iFizBox", mode: "install", url: "https://x/s.ipa" }]);
  const run = createAppRun({ rows, sign: async () => ({ token: "t" }), install: async () => ({ installed: null }), discard: () => {} });
  assert.equal(run.notTaken(SELF_ID, "x"), false, "not sent yet");
  await run.start();
  assert.equal(rows[0].unsure, true);
  assert.equal(run.notTaken("nope", "x"), false);
  assert.equal(run.notTaken(SELF_ID, "iOS didn't download it"), true);
  assert.equal(rowStatus(rows[0]), "Failed: iOS didn't download it");
  assert.equal(run.notTaken(SELF_ID, "x"), false, "already failed");
});

test("phoneLanes.selfUpdate and watchSelfUpdate: the shell's states, its last; null for an older shell", async () => {
  const native = {
    async call(m, p, onEvent) {
      assert.equal(m, "signing.selfUpdate");
      for (const s of ["prompt", "waiting"]) onEvent({ state: s });
      onEvent({});
      return { state: "notStarted" };
    },
  };
  const seen = [];
  assert.equal(await watchSelfUpdate((s) => seen.push(s), native), "notStarted");
  assert.deepEqual(seen, ["prompt", "waiting"]);
  const l = phoneLanes({ watchSelfUpdate }, { native });
  assert.equal(await l.selfUpdate(() => {}), "notStarted");
  assert.equal(await phoneLanes({}, { native }).selfUpdate(() => {}), null);
  assert.equal(await watchSelfUpdate(() => {}, { async call() { throw new Error("unknown"); } }), null);
  assert.equal(await watchSelfUpdate(() => {}, { async call() { return null; } }), null);
});
