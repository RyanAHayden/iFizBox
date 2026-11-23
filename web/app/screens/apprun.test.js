// F235: the IPA queue's run page (screens/apprun.js) over fake phone lanes: a queue of 3 apps with one stopped installs
// the other two and clears them from the queue; Cancel abandons the rest and reopens Confirm with what finished
// cleared; Retry All after a failure; and the phone lanes (signing-client.js) against a fake bridge: per-app tags,
// signing.cancel {tag} on a stop, the record-based Re-sign.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAppRun, phoneLanes } from "./apprun.js";
import { createAppQueue, SELF_ID } from "../core/appqueue.js";
import { prepareParams, prepareOnDevice, openPrepared, repromptPrepared } from "../signing-client.js";
import { fakeDocument as fakeDom, fakeNative } from "../fakes.test-helper.js";

function fakePage() {
  const p = {
    lines: [], statuses: [], finished: null, bars: [], closers: [], closed: false, panes: [], views: [], filtered: null,
    line(kind, text, id) { p.lines.push({ kind, text, id }); },
    status(t) { p.statuses.push(t); }, progress() {},
    pane(n) { p.panes.push(n); return n; }, view(v) { p.views.push(v); },
    segmented(labels, onPick) { p.seg = { labels, onPick }; return { select: (i) => { p.selected = i; } }; },
    filter(id) { p.filtered = id; },
    bar(b) { p.bars.push(b); },
    reopen() { p.finished = null; },
    finish(f) { p.finished = f; },
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

// Lanes the test drives: sign answers at once (or fails for `bad`); install waits until released.
function lanes({ bad = [] } = {}) {
  const calls = { sign: [], install: [], discard: [], aborted: [] };
  const waits = new Map();
  return {
    calls, waits,
    sign: async (r, { signal, progress }) => {
      calls.sign.push(r.id);
      progress("downloading", 0.5);
      progress("signing", 0.5);
      if (bad.includes(r.id)) throw new Error(`${r.name} couldn't be downloaded`);
      return { token: `t-${r.id}`, bundleId: r.id, expires: "2026-12-03T12:00:00Z" };
    },
    install: (r, { signal, progress }) => new Promise((resolve, reject) => {
      calls.install.push(r.id);
      progress("asking", 0);
      signal.addEventListener("abort", () => { calls.aborted.push(r.id); reject(new Error("cancelled")); });
      waits.set(r.id, () => resolve({ installed: true, expires: "2026-12-03T12:00:00Z" }));
    }),
    discard: (r) => calls.discard.push(r.id),
    release: async (id) => { for (let i = 0; i < 30 && !waits.has(id); i++) await settle(1); waits.get(id)(); await settle(); },
  };
}

const app = (id, name, mode = "install") => ({ id, name, mode, url: mode === "resign" ? null : `https://x/${id}.ipa`, version: "1.0" });

function setup(jobs, opts) {
  const queue = createAppQueue();
  for (const j of jobs) queue.add(j);
  return { queue, page: fakePage(), l: lanes(opts), recorded: [], reopened: [] };
}

const rowsOf = (page) => page.panes[0].children[0].children.filter((li) => li.className === "qr-row");
const statusOf = (li) => li.children[0].children[1].textContent;

test("a queue of 3 with one stopped at iOS's prompt installs the other two, in order, and clears them", () => withDom(async () => {
  const s = setup([app("a", "Alpha"), app("b", "Beta"), app("c", "Gamma")]);
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, record: async (j) => s.recorded.push(j.id), open: () => s.page,
    reopenConfirm: (f) => s.reopened.push(f) });
  await settle();
  // all three are signed ahead; only Alpha is with iOS
  assert.deepEqual(s.l.calls.sign, ["a", "b", "c"]);
  assert.deepEqual(s.l.calls.install, ["a"]);
  const rows = rowsOf(s.page);
  assert.equal(statusOf(rows[0]), "Tap Install on the iOS prompt");
  assert.equal(statusOf(rows[1]), "Signed: Waiting to Install");
  // F391: waiting its turn, its bar shows, full with stripes; Alpha's (with iOS) doesn't wait
  const barOfRow = (li) => li.children[0].children[2];
  assert.equal(barOfRow(rows[1]).hidden, false);
  assert.ok(barOfRow(rows[1]).classList.contains("is-waiting"));
  assert.ok(!barOfRow(rows[0]).classList.contains("is-waiting"));
  await s.l.release("a");
  assert.deepEqual(s.l.calls.install, ["a", "b"]);
  // Beta's round stop button: only Beta is cancelled, Gamma goes to iOS
  const stop = rows[1].children[1];
  assert.equal(stop.hidden, false);
  stop.click();
  await settle();
  assert.deepEqual(s.l.calls.aborted, ["b"]);
  assert.deepEqual(s.l.calls.install, ["a", "b", "c"]);
  await s.l.release("c");
  const r = await done;
  assert.deepEqual(r.rows.map((x) => [x.id, x.state]), [["a", "installed"], ["b", "cancelled"], ["c", "installed"]]);
  assert.deepEqual(s.queue.list().map((j) => j.id), ["b"]);
  assert.deepEqual(s.recorded.sort(), ["a", "c"]);
  assert.equal(s.page.bars.at(-1).left.textContent, "Close");
  assert.equal(s.page.bars.at(-1).right.textContent, "Retry All");
  assert.match(s.page.finished.label, /^Return to /);
  assert.equal(s.page.lines.at(-1).text, "2 installed, 1 cancelled");
  // one line per phase per app, never a percent
  assert.ok(!s.page.lines.some((l) => /\d+%/.test(l.text)));
  assert.deepEqual(s.page.lines.filter((l) => l.id === "a").map((l) => l.text),
    ["Downloading Alpha", "Signing Alpha", "Signed Alpha", "Asked iOS to install Alpha", "Installed Alpha"]);
  assert.deepEqual(s.page.seg.labels, ["Apps", "Log"]);
}));

test("Cancel abandons the rest and reopens Confirm with what finished cleared", () => withDom(async () => {
  const s = setup([app("a", "Alpha"), app("b", "Beta"), app("c", "Gamma")]);
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, open: () => s.page, reopenConfirm: (f) => s.reopened.push(f) });
  await settle();
  await s.l.release("a");
  // B224: Cydia's plain Cancel at the top left, as on the 4S
  const cancel = s.page.bars.at(-1).left;
  assert.equal(cancel.textContent, "Cancel");
  assert.ok(!cancel.className.includes("red"));
  assert.equal(s.page.bars.at(-1).right ?? null, null);
  cancel.click();
  const r = await done;
  assert.equal(r.stopped, true);
  assert.deepEqual(r.rows.map((x) => x.state), ["installed", "cancelled", "cancelled"]);
  assert.deepEqual(s.l.calls.aborted, ["b"]);
  assert.deepEqual(s.l.calls.discard, ["c"]); // Gamma's signed copy goes
  assert.equal(s.page.closed, true);
  assert.deepEqual(s.queue.list().map((j) => j.id), ["b", "c"]);
  assert.deepEqual(s.reopened, ["Stopped. 1 installed and cleared from the queue."]);
}));

test("a failed app ends its row only; Retry All signs it again; a clean run ends with no bar buttons; re-sign rows show the expiry", () => withDom(async () => {
  const s = setup([app("a", "Alpha", "resign"), app("b", "Beta")], { bad: ["b"] });
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, open: () => s.page });
  await settle();
  await s.l.release("a");
  const r = await done;
  assert.deepEqual(r.rows.map((x) => x.state), ["installed", "failed"]);
  const rows = rowsOf(s.page);
  assert.match(statusOf(rows[0]), /^Re-signed, expires Dec [23], 2026$/);
  assert.equal(statusOf(rows[1]), "Failed: Beta couldn't be downloaded");
  s.l.calls.sign.length = 0;
  s.l.sign = async (row) => { s.l.calls.sign.push(row.id); return { token: "t2", bundleId: row.id }; };
  s.page.bars.at(-1).right.click(); // Retry All
  await settle();
  await s.l.release("b");
  await settle();
  assert.deepEqual(s.l.calls.sign, ["b"]);
  // B224: no bar buttons at a clean end, as the 4S's Complete
  assert.equal(s.page.bars.at(-1).right ?? null, null);
  assert.equal(s.page.bars.at(-1).left ?? null, null);
  assert.equal(s.queue.size, 0);
}));

test("iFizBox's own IPA goes last and ends the page locked on Closing", () => withDom(async () => {
  const s = setup([app(SELF_ID, "iFizBox"), app("a", "Alpha")]);
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, open: () => s.page });
  await settle();
  assert.deepEqual(s.l.calls.install, ["a"]);
  await s.l.release("a");
  assert.deepEqual(s.l.calls.install, ["a", SELF_ID]);
  await s.l.release(SELF_ID);
  await done;
  assert.equal(s.page.finished.locked, true);
}));

// ---- the phone lanes against a fake bridge ----

// The shared fakeNative's calls as [method, params] pairs.
const sent = (native) => native.calls.map((c) => [c.method, c.params]);

test("prepareParams: url with edits, a record for a plain re-sign, a My IPAs file", () => {
  assert.deepEqual(prepareParams({ id: "a", mode: "install", url: "u" }), { url: "u" });
  assert.deepEqual(prepareParams({ id: "a", mode: "resign", url: null }), { record: "a" });
  assert.deepEqual(prepareParams({ id: "a", mode: "resign", url: "v" }), { url: "v" });
  assert.deepEqual(prepareParams({ id: "a", mode: "install", url: "u", options: { token: "t", edits: { name: "N", token: "x" } } }), { url: "u", name: "N" });
  assert.deepEqual(prepareParams({ id: "a", mode: "install", library: "f.ipa" }), { library: "f.ipa" });
});

test("a stop sends signing.cancel with that app's tag and nothing else", async () => {
  let release;
  const native = fakeNative({
    "signing.prepare": (p, on) => { on({ phase: "downloading", progress: 0.3 }); on({ log: "Downloading u" }); return new Promise((r) => { release = r; }); },
  });
  const ctl = new AbortController();
  const seen = [];
  const logs = [];
  const p = prepareOnDevice({ id: "a", name: "Alpha", mode: "install", url: "u" }, { tag: "a#1", signal: ctl.signal, native,
    progress: (ph, f) => seen.push([ph, f]), log: (t) => logs.push(t) });
  // F302a: the kept tweaks are looked up first, so the call starts a few ticks later
  for (let i = 0; i < 50 && !native.calls.length; i++) await new Promise((r) => setTimeout(r, 0));
  ctl.abort();
  await assert.rejects(p, (e) => e.code === "cancelled");
  assert.deepEqual(sent(native), [["signing.prepare", { url: "u", tag: "a#1" }], ["signing.cancel", { tag: "a#1" }]]);
  assert.deepEqual(seen, [["downloading", 0.3]]);
  assert.deepEqual(logs, ["Downloading u"]);
  release({});
});

test("openPrepared opens the kept copy, then waits for iOS's install under the same tag", async () => {
  const native = fakeNative({
    "signing.open": () => Promise.resolve({ bundleId: "com.a", expires: "2026-12-03T00:00:00Z" }),
    "signing.progress": (p, on) => { on({ phase: "installing", progress: 0.5 }); return Promise.resolve({ installed: true }); },
  });
  const seen = [];
  const r = await openPrepared({ id: "a", name: "Alpha", token: "t1" }, { tag: "a#2", native, progress: (ph, f) => seen.push([ph, f]) });
  assert.deepEqual(r, { installed: true, expires: "2026-12-03T00:00:00Z" });
  assert.equal(sent(native)[0][0], "signing.open");
  assert.equal(sent(native)[0][1].token, "t1");
  assert.equal(sent(native)[0][1].tag, "a#2");
  assert.deepEqual(sent(native)[1], ["signing.progress", { bundleId: "com.a", wait: 600, tag: "a#2" }]);
  assert.deepEqual(seen, [["asking", 0], ["installing", 0.5]]);
});

test("phoneLanes: each try gets its own tag; iFizBox's own is hosted and not watched", async () => {
  const sc = { prepareOnDevice: async (job, o) => o.tag, openPrepared: async (row, o) => [o.tag, o.host], discardPrepared: () => {} };
  const l = phoneLanes(sc, { run: "" });
  const row = { id: "a", job: {} };
  assert.equal(await l.sign(row, {}), "a#1");
  assert.equal(await l.sign(row, {}), "a#2");
  assert.deepEqual(await l.install({ id: SELF_ID }, {}), [`${SELF_ID}#3`, true]);
});

test("runAppQueueRun: the Signing walkthrough first; then the queued jobs to the run, one run at a time", async () => {
  const { runAppQueueRun, appQueueRunning } = await import("./queue.js");
  const q = createAppQueue();
  q.add(app("a", "Alpha"));
  q.add(app("b", "Beta"));
  assert.equal(await runAppQueueRun(q.list(), { queue: q, ready: async () => false, lanes: {}, run: async () => assert.fail("ran") }), null);
  assert.equal(appQueueRunning(), false);
  let deps = null;
  const jobs = q.list();
  q.clear("b"); // cleared before Confirm's run starts
  const r = await runAppQueueRun(jobs, { queue: q, ready: async () => true, lanes: { x: 1 },
    run: async (js, d) => { deps = d; return { ok: true, ids: js.map((j) => j.id) }; } });
  assert.deepEqual(r.ids, ["a"]);
  assert.equal(appQueueRunning(), true); // until the page closes
  assert.equal(await runAppQueueRun(jobs, { queue: q, ready: async () => true, lanes: {}, run: async () => assert.fail("twice") }), null);
  deps.onClose();
  assert.equal(appQueueRunning(), false);
});

test("B257: runAppQueueRun holds the app awake from Confirm; the run's lanes keep it; the page's close lets go", async () => {
  const { runAppQueueRun } = await import("./queue.js");
  const q = createAppQueue();
  q.add(app("a", "Alpha"));
  const sent = [];
  const keep = (_n, on) => sent.push(on);
  assert.equal(await runAppQueueRun(q.list(), { queue: q, ready: async () => false, lanes: {}, keep, run: async () => assert.fail("ran") }), null);
  assert.deepEqual(sent, []); // the walkthrough opened: nothing held
  let deps = null;
  await runAppQueueRun(q.list(), { queue: q, ready: async () => true, keep,
    lanes: { sign: async () => ({ token: "t" }), install: async () => ({ installed: true }) },
    run: async (js, d) => { deps = d; await d.lanes.sign({ id: "a" }, {}); await d.lanes.install({ id: "a" }, {}); return { ok: true }; } });
  assert.deepEqual(sent, [true, true, true]); // Confirm, then each lane's start
  deps.onClose();
  assert.deepEqual(sent, [true, true, true, false]);
});

test("F247: a one-app run opens on the Log; two apps open on the Apps list", () => withDom(async () => {
  const one = setup([app("a", "Alpha")]);
  const doneOne = runAppRun(one.queue.list(), { queue: one.queue, lanes: one.l, open: () => one.page });
  assert.equal(one.page.views[0], "log");
  assert.equal(one.page.selected, 1);
  await settle();
  await one.l.release("a");
  await doneOne;
  const two = setup([app("a", "Alpha"), app("b", "Beta")]);
  const doneTwo = runAppRun(two.queue.list(), { queue: two.queue, lanes: two.l, open: () => two.page });
  assert.equal(two.page.views[0], "pane");
  assert.equal(two.page.selected, 0);
  await settle();
  await two.l.release("a");
  await two.l.release("b");
  await doneTwo;
}));

// B76: leaving iFizBox while an app is with iOS hands it off; coming back asks iOS (apps.isInstalled) and upgrades it.
function fakeDoc() {
  const d = { visibilityState: "visible", listeners: [],
    addEventListener(t, f) { if (t === "visibilitychange") d.listeners.push(f); },
    removeEventListener(t, f) { d.listeners = d.listeners.filter((x) => x !== f); },
    set(state) { d.visibilityState = state; for (const f of [...d.listeners]) f(); } };
  return d;
}

test("B76: an app whose watch answers false after iFizBox left ends Sent to iOS, cleared; back in front it turns Installed", () => withDom(async () => {
  const s = setup([app("a", "Alpha"), app("b", "Beta")]);
  const doc = fakeDoc();
  const asked = [];
  let has = {};
  const isInstalled = async (ids) => { asked.push(ids); return has; };
  s.l.install = (r, { signal, progress }) => new Promise((resolve) => {
    s.l.calls.install.push(r.id);
    progress("asking", 0);
    s.l.waits.set(r.id, () => resolve({ installed: false }));
  });
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, open: () => s.page, doc, isInstalled });
  await settle();
  doc.set("hidden"); // the user tapped Install, iOS's home screen shows
  await s.l.release("a");
  // b refused in front: Failed
  await s.l.release("b");
  const r = await done;
  assert.deepEqual(r.rows.map((x) => x.state), ["installed", "failed"]);
  const rows = rowsOf(s.page);
  assert.equal(statusOf(rows[0]), "Sent to iOS");
  assert.deepEqual(s.queue.list().map((j) => j.id), ["b"]);
  assert.deepEqual(asked, []); // not asked while hidden
  has = { a: true };
  doc.set("visible");
  await settle();
  assert.deepEqual(asked, [["a"]]);
  assert.equal(statusOf(rows[0]), "Installed");
  assert.equal(s.page.lines.filter((l) => l.id === "a").at(-1).text, "Installed Alpha");
  s.page.close();
  assert.equal(doc.listeners.length, 0);
}));

test("B76: phoneLanes asks apps.isInstalled; no bridge or a failed call is unknown", async () => {
  const native = fakeNative({ "apps.isInstalled": async (p) => ({ installed: { [p.bundleIds[0]]: true } }) });
  const l = phoneLanes({}, { native });
  assert.deepEqual(await l.isInstalled(["com.a"]), { "com.a": true });
  assert.deepEqual(sent(native), [["apps.isInstalled", { bundleIds: ["com.a"] }]]);
  const bad = phoneLanes({}, { native: fakeNative({ "apps.isInstalled": async () => { throw new Error("x"); } }) });
  assert.deepEqual(await bad.isInstalled(["com.a"]), {});
});

// B85: a 2-app run: the first app's prompt dismissed ends that row (B91: Failed, iOS didn't download it) and the
// second still goes to iOS; the "Tap Install on the iOS prompt" row's tap asks iOS for the prompt again instead of
// opening the Log.
test("B85/B91: tapping the asking row re-prompts; a dismissed prompt fails that row, the next app goes on", () => withDom(async () => {
  const s = setup([app("a", "Alpha"), app("b", "Beta")]);
  const reprompted = [];
  const answers = new Map();
  const l = {
    ...s.l,
    install: (r, hooks) => new Promise((resolve) => {
      s.l.calls.install.push(r.id);
      hooks.progress("asking", 0);
      answers.set(r.id, resolve);
    }),
    reprompt: async (r) => { reprompted.push(r.id); return true; },
  };
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: l, open: () => s.page });
  await settle();
  const rows = rowsOf(s.page);
  assert.equal(statusOf(rows[0]), "Tap Install on the iOS prompt");
  rows[0].children[0].click();
  await settle();
  assert.deepEqual(reprompted, ["a"]);
  assert.equal(s.page.filtered, null); // not the Log
  assert.equal(s.page.lines.filter((x) => x.id === "a").at(-1).text, "Asked iOS again to install Alpha");
  // Beta waits its turn: its tap opens the Log
  rows[1].children[0].click();
  assert.equal(s.page.filtered, "b");
  answers.get("a")({ installed: false, dismissed: true });
  await settle();
  assert.equal(statusOf(rows[0]), "Failed: iOS didn't download it"); // B91: not "Cancelled"
  assert.deepEqual(s.l.calls.install, ["a", "b"]);
  assert.equal(statusOf(rows[1]), "Tap Install on the iOS prompt");
  answers.get("b")({ installed: true });
  const r = await done;
  assert.deepEqual(r.rows.map((x) => x.state), ["failed", "installed"]);
  assert.deepEqual(s.queue.list().map((j) => j.id), ["a"]); // still queued, retryable
  assert.equal(s.page.lines.at(-1).text, "1 installed, 1 failed");
  // B91: nothing reopened by itself; the row's tap (Try Again) offers the served IPA again, no new signing
  assert.deepEqual(reprompted, ["a"]);
  const signs = s.l.calls.sign?.length;
  rows[0].children[0].click();
  await settle();
  assert.deepEqual(s.l.calls.install, ["a", "b", "a"]);
  assert.equal(s.l.calls.sign?.length, signs);
  assert.equal(statusOf(rows[0]), "Tap Install on the iOS prompt");
  answers.get("a")({ installed: true });
  await settle();
  assert.equal(statusOf(rows[0]), "Installed");
}));

test("B91: phoneLanes' Try Again reuses the try's tag (Stop ends that serving) and asks openPrepared with again", async () => {
  const sc = { prepareOnDevice: async (job, o) => o.tag, openPrepared: async (row, o) => [o.tag, Boolean(o.again)], discardPrepared: () => {} };
  const l = phoneLanes(sc, { run: "" });
  const row = { id: "a", job: {} };
  assert.equal(await l.sign(row, {}), "a#1");
  assert.deepEqual(await l.install(row, {}), ["a#2", false]);
  assert.deepEqual(await l.install(row, { again: true }), ["a#2", true]);
  assert.deepEqual(await l.install(row, {}), ["a#3", false]);
  assert.deepEqual(await l.install({ id: "b" }, { again: true }), ["b#4", true]); // no earlier try: a new tag
});

test("B91: openPrepared with again asks signing.reprompt, not signing.open, then waits; gone when not served", async () => {
  let reopened = true;
  const native = fakeNative({
    "signing.open": () => assert.fail("signed or served again"),
    "signing.reprompt": () => Promise.resolve({ reopened }),
    "signing.progress": () => Promise.resolve({ installed: true }),
  });
  const seen = [];
  const row = { id: "a", name: "Alpha", bundleId: "com.a", expires: "2026-12-01" };
  const r = await openPrepared(row, { tag: "a#2", native, again: true, progress: (...a) => seen.push(a) });
  assert.deepEqual(r, { installed: true, expires: "2026-12-01" });
  assert.deepEqual(sent(native).map((c) => c[0]), ["signing.reprompt", "signing.progress"]);
  assert.deepEqual(sent(native)[1][1], { bundleId: "com.a", wait: 600, tag: "a#2" });
  assert.deepEqual(seen[0], ["asking", 0]);
  reopened = false;
  await assert.rejects(openPrepared(row, { tag: "a#2", native, again: true }), (e) => e.code === "gone");
});

test("B85: openPrepared passes the shell's dismissed; repromptPrepared asks signing.reprompt by bundle ID", async () => {
  const native = fakeNative({
    "signing.open": () => Promise.resolve({ bundleId: "com.a" }),
    "signing.progress": () => Promise.resolve({ installed: false, handedOff: false, dismissed: true }),
    "signing.reprompt": (p) => Promise.resolve({ reopened: p.bundleId === "com.a" }),
  });
  const r = await openPrepared({ id: "a", name: "Alpha", token: "t1" }, { tag: "a#2", native });
  assert.deepEqual(r, { installed: false, expires: null, dismissed: true });
  assert.equal(await repromptPrepared({ id: "a", bundleId: "com.a" }, native), true);
  assert.equal(await repromptPrepared({ id: "b", bundleId: "com.b" }, native), false);
  assert.equal(await repromptPrepared({ id: "c" }, native), false); // no bundle ID: nothing to ask
  assert.deepEqual(sent(native).slice(2), [["signing.reprompt", { bundleId: "com.a" }], ["signing.reprompt", { bundleId: "com.b" }]]);
  const broken = fakeNative({ "signing.reprompt": () => Promise.reject(new Error("x")) });
  assert.equal(await repromptPrepared({ id: "a", bundleId: "com.a" }, broken), false);
  // phoneLanes hands the row to it
  const sc = { repromptPrepared: async (row, n) => [row.id, n === native] };
  assert.deepEqual(await phoneLanes(sc, { native }).reprompt({ id: "a" }), ["a", true]);
});

// B136: an install iOS never fetched (B128's ECONNREFUSED, handed off while iFizBox was away) ends "Sent to iOS" but
// isn't recorded as installed while iOS says it doesn't have the app; once iOS has it, it is.
test("B136: a Sent to iOS row is recorded only once iOS has the app", () => withDom(async () => {
  const s = setup([app("a", "Alpha"), app("b", "Beta")]);
  const doc = fakeDoc();
  let has = { a: false }; // ({} would be "iOS gave no answer": recorded as sent)
  const isInstalled = async () => has;
  s.l.install = (r, { progress }) => new Promise((resolve) => {
    s.l.calls.install.push(r.id);
    progress("asking", 0);
    s.l.waits.set(r.id, () => resolve(r.id === "a" ? { installed: false } : { installed: true }));
  });
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, record: async (j) => s.recorded.push(j.id), open: () => s.page, doc, isInstalled });
  await settle();
  doc.set("hidden");
  await s.l.release("a");
  doc.set("visible"); // iOS hasn't got Alpha
  await s.l.release("b");
  await done;
  await settle();
  assert.equal(statusOf(rowsOf(s.page)[0]), "Sent to iOS");
  assert.deepEqual(s.recorded, ["b"]); // the failed handoff isn't recorded
  has = { a: false };
  doc.set("hidden");
  doc.set("visible");
  await settle();
  assert.deepEqual(s.recorded, ["b"]);
  has = { a: true };
  doc.set("hidden");
  doc.set("visible");
  await settle();
  assert.deepEqual(s.recorded, ["b", "a"]);
  doc.set("hidden");
  doc.set("visible");
  await settle();
  assert.deepEqual(s.recorded, ["b", "a"]); // once
  s.page.close();
}));

// B264: each app's end (installed or re-signed) tells the run's owner once, after Installed's record was asked for,
// so the badge counts again while the run goes on (in the background too); a stopped app tells nothing.
test("B264: onAppEnd once per app that ends, with its record's promise; not for a stopped one", () => withDom(async () => {
  const s = setup([app("a", "Alpha", "resign"), app("b", "Beta"), app("c", "Gamma")]);
  const ends = [];
  const done = runAppRun(s.queue.list(), { queue: s.queue, lanes: s.l, record: async (j) => s.recorded.push(j.id), open: () => s.page,
    onAppEnd: (r, recorded) => ends.push([r.id, recorded === null ? null : typeof recorded.then]) });
  await settle();
  await s.l.release("a");
  assert.deepEqual(ends.map((e) => e[0]), ["a"]);
  const rows = rowsOf(s.page);
  rows[1].children[1].click(); // Beta's stop
  await settle();
  await s.l.release("c");
  await done;
  assert.deepEqual(ends.map((e) => e[0]), ["a", "c"]);
  assert.ok(ends.every(([, t]) => t === null || t === "function"));
}));

test("B264: runAppQueueRun counts the badge as each app ends, after its record, without holding the app", async () => {
  const { runAppQueueRun } = await import("./queue.js");
  const q = createAppQueue();
  q.add(app("a", "Alpha", "resign"));
  const sent = [];
  const keep = (_n, on) => sent.push(on);
  let counted = 0, deps = null, wrote = null;
  const recount = () => { counted++; return new Promise(() => {}); }; // a count the page never finishes (asleep)
  await runAppQueueRun(q.list(), { queue: q, ready: async () => true, keep, recount, lanes: {},
    run: async (js, d) => { deps = d; return { ok: true }; } });
  assert.deepEqual(sent, [true]); // Confirm
  deps.onAppEnd({ id: "a" }, new Promise((f) => { wrote = f; }));
  await settle();
  assert.equal(counted, 0); // waits for Installed's record
  wrote({ before: null, wrote: null });
  await settle();
  assert.equal(counted, 1);
  assert.deepEqual(sent, [true]); // no hold for the count: it can't keep the silent audio going
  deps.onClose();
  assert.equal(sent.at(-1), false);
});

test("B337: Use the Signing Server installs the failed rows again from their signed IPA, keeping the Log and progress", () => withDom(async () => {
  const { serverFallback, USE_SERVER, serverStep } = await import("../core/installroute.js");
  const calls = { sign: [], install: [] };
  const sc = {
    prepareOnDevice: async (job, { progress }) => {
      calls.sign.push(job.id);
      progress("downloading", 1);
      progress("signing", 1);
      return { token: `t-${job.id}`, bundleId: job.id };
    },
    openPrepared: async (r, o) => {
      calls.install.push({ id: r.id, token: r.token, server: Boolean(o.server), progress: r.progress });
      if (!o.server) {
        const fallback = serverFallback(Object.assign(new Error("refused: this iPhone refused the connection"), { code: "refused" }));
        throw Object.assign(new Error("refused"), { fallback });
      }
      return { installed: true };
    },
    discardPrepared() {},
  };
  const l = phoneLanes(sc, { native: { call: async () => null } });
  const queue = createAppQueue();
  queue.add(app("a", "Alpha"));
  const page = fakePage();
  const r = await runAppRun(queue.list(), { queue, lanes: { ...l, local: () => !l.serverRoute() }, open: () => page });
  assert.equal(r.ok, false);
  assert.deepEqual(calls.sign, ["a"]);
  const before = page.lines.map((x) => x.text);
  assert.ok(before.includes("Signed Alpha"));
  const row = r.rows[0];
  const reached = row.progress;
  assert.ok(reached > 0);
  assert.equal(page.finished.also?.label, USE_SERVER);
  page.finished.also.action();
  await settle();
  assert.deepEqual(calls.sign, ["a"], "no new download or signing");
  assert.deepEqual(calls.install.map(({ progress, ...c }) => c),
    [{ id: "a", token: "t-a", server: false }, { id: "a", token: "t-a", server: true }]);
  assert.ok(calls.install[1].progress >= reached, "the row's progress isn't reset when its install runs again");
  const after = page.lines.map((x) => x.text);
  assert.deepEqual(after.slice(0, before.length), before, "the Log keeps its earlier lines");
  assert.ok(after.slice(before.length).includes(serverStep("Alpha")));
  assert.equal(row.state, "installed");
  assert.equal(queue.size, 0);
}));

test("B337: a Signing Server Fallback row whose signed IPA the shell no longer keeps signs it again", () => withDom(async () => {
  const { serverFallback } = await import("../core/installroute.js");
  const calls = { sign: [], install: [] };
  let n = 0;
  const sc = {
    prepareOnDevice: async (job) => { calls.sign.push(job.id); return { token: `t-${job.id}-${++n}`, bundleId: job.id }; },
    openPrepared: async (r, o) => {
      calls.install.push({ token: r.token, server: Boolean(o.server) });
      if (!o.server) throw Object.assign(new Error("refused"), { fallback: serverFallback(Object.assign(new Error("refused"), { code: "refused" })) });
      if (r.token === "t-a-1") throw Object.assign(new Error("the signed copy is gone"), { code: "gone" });
      return { installed: true };
    },
    discardPrepared() {},
  };
  const l = phoneLanes(sc, { native: { call: async () => null } });
  const queue = createAppQueue();
  queue.add(app("a", "Alpha"));
  const page = fakePage();
  const r = await runAppRun(queue.list(), { queue, lanes: { ...l, local: () => !l.serverRoute() }, open: () => page });
  page.finished.also.action();
  await settle(20);
  assert.deepEqual(calls.sign, ["a", "a"]);
  assert.deepEqual(calls.install, [{ token: "t-a-1", server: false }, { token: "t-a-1", server: true }, { token: "t-a-2", server: true }]);
  assert.ok(page.lines.some((x) => x.text === "The signed copy of Alpha is gone; signing it again"));
  assert.equal(r.rows[0].state, "installed");
}));

test("B395: the Install Switch didn't run: one alert for the run with Cancel, Update and Use Server", () => withDom(async () => {
  const { serverFallback } = await import("../core/installroute.js");
  for (const pick of [0, 1, 2]) {
    const asked = [], fixed = [], server = [];
    const sc = {
      prepareOnDevice: async (job) => ({ token: `t-${job.id}`, bundleId: job.id }),
      openPrepared: async (r, o) => {
        if (o.server) { server.push(r.id); return { installed: true }; }
        throw Object.assign(new Error("no"), { fallback: serverFallback(Object.assign(new Error("switch_failed: no"), { code: "switch_failed" })) });
      },
      runFix: (f) => fixed.push(f),
      discardPrepared() {},
    };
    const l = phoneLanes(sc, { native: { call: async () => null } });
    const queue = createAppQueue();
    queue.add(app("a", "Alpha"));
    queue.add(app("b", "Beta"));
    const page = fakePage();
    await runAppRun(queue.list(), { queue, lanes: { ...l, local: () => !l.serverRoute() }, open: () => page, alert: async (a) => { asked.push(a.buttons); return { index: pick }; } });
    await settle(20);
    assert.deepEqual(asked, [["Cancel", "Update", "Use Server"]]);
    assert.deepEqual(fixed, pick === 1 ? ["shortcuts"] : []);
    assert.deepEqual(server, pick === 2 ? ["a", "b"] : []);
  }
}));
