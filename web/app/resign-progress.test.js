// B65: a re-sign's (and an IPA install's) progress events give the black page's log one line per phase per app; the
// percent only moves the bar and the status line. A phase that goes quiet fails with where it stopped, and cancels.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { progressHUD } from "./nav/progress.js";
import { resignLabel, phaseLabel, callWithStall, stallMessage, STALL_LIMIT } from "./core/signing.js";
import { hudLine } from "./core/progress.js";
import { bulkHud } from "./screens/installed.js";

// progressHUD reuses its last page while that is up: each test's page is closed when the test ends.
const pages = [];
afterEach(() => { for (const p of pages.splice(0)) p.closed = true; });

function fakePage() {
  const p = { steps: [], raws: [], errors: [], statuses: [], bars: [], finished: null, closed: false };
  Object.assign(p, {
    step: (t) => p.steps.push(t), raw: (t) => p.raws.push(t), error: (t) => p.errors.push(t),
    status: (t) => p.statuses.push(t), progress: (n) => p.bars.push(n),
    finish: (o) => { p.finished = o; }, reopen() {}, stoppable() {}, onClose() {},
  });
  pages.push(p);
  return p;
}

// What the shell streams for one app: Throttle sends each phase change and each whole percent.
function eventsFor(name, index, count) {
  const out = [];
  for (let i = 0; i <= 100; i += 1) out.push({ index, count, name, phase: "downloading", progress: i / 100 });
  for (let i = 0; i <= 100; i += 5) out.push({ index, count, name, phase: "reading", progress: i / 100 });
  for (const f of [0.25, 0.5, 0.75, 1]) out.push({ index, count, name, phase: "signing", progress: f });
  out.push({ index, count, name, phase: "handoff", progress: 0 });
  return out;
}

test("hudLine takes the percent out wherever it stands", () => {
  assert.deepEqual(hudLine("Signing 45% Partyboard (2 of 3)"), { text: "Signing Partyboard (2 of 3)", percent: 45 });
  assert.deepEqual(hudLine("Downloading 7% Delta"), { text: "Downloading Delta", percent: 7 });
  assert.deepEqual(hudLine("Re-signing Delta (2 of 4) 38%"), { text: "Re-signing Delta (2 of 4)", percent: 38 });
  assert.deepEqual(hudLine("Installing 3 of 5"), { text: "Installing 3 of 5", percent: null });
  assert.deepEqual(hudLine("Signing Partyboard"), { text: "Signing Partyboard", percent: null });
});

test("Re-sign All over 3 apps through progressHUD: one step line per phase per app, the bar moves", () => {
  const page = fakePage();
  const h = progressHUD("Re-signing", { open: () => page });
  const names = ["Partyboard", "Delta", "Kodi"];
  names.forEach((n, i) => { for (const ev of eventsFor(n, i, 3)) { const t = resignLabel(ev); if (t) h.set(t); } });
  h.done("Done");
  const expected = ["Re-signing"];
  names.forEach((n, i) => {
    for (const ph of ["Downloading", "Reading", "Signing"]) expected.push(`${ph} ${n} (${i + 1} of 3)`);
    expected.push(`Handing ${n} to iOS (${i + 1} of 3)`);
  });
  expected.push("Done");
  assert.deepEqual(page.steps, expected);
  assert.ok(page.bars.includes(45) && page.bars.includes(50), "the percent still reaches the bar");
  assert.ok(page.statuses.includes("Signing 50% Partyboard (1 of 3)"), "and the status line");
});

test("a queue Re-sign (1 of 1, the suffix stripped) logs one line per phase", () => {
  const page = fakePage();
  const h = progressHUD("Re-signing", { open: () => page });
  for (const ev of eventsFor("Partyboard", 0, 1)) { const t = resignLabel(ev); if (t) h.set(t.replace(/ \(1 of 1\)$/, "")); }
  assert.deepEqual(page.steps, ["Re-signing", "Downloading Partyboard", "Reading Partyboard", "Signing Partyboard", "Handing Partyboard to iOS"]);
});

test("an IPA install's events (phaseLabel) log one line per phase", () => {
  const page = fakePage();
  const h = progressHUD("Downloading", { open: () => page });
  for (const ev of eventsFor("X", 0, 1)) { const t = phaseLabel(ev); if (t) h.set(t); }
  assert.deepEqual(page.steps, ["Downloading", "Reading", "Signing", "Handing to iOS"]);
});

test("bulkHud (Manage, My IPAs) logs each phase once, not each percent", () => {
  const page = fakePage();
  const make = bulkHud((t) => progressHUD(t, { open: () => page }), { verb: "Re-signing", name: "Partyboard", i: 1, n: 3 });
  const h = make("Re-signing");
  for (const ev of eventsFor("Partyboard", 0, 1)) { const t = resignLabel(ev); if (t) h.set(t.replace(/ \(1 of 1\)$/, "")); }
  assert.deepEqual(page.raws, ["Downloading Partyboard", "Reading Partyboard", "Signing Partyboard", "Handing Partyboard to iOS"]);
  assert.deepEqual(page.steps, ["Re-signing Partyboard (1 of 3)"]);
});

// ---- the stall limit ----

function fakeTimers() {
  const t = { list: new Map(), n: 0 };
  t.later = (f, ms) => { const id = ++t.n; t.list.set(id, { f, ms }); return id; };
  t.clear = (id) => { t.list.delete(id); };
  t.fire = () => { const all = [...t.list.values()]; t.list.clear(); for (const x of all) x.f(); };
  return t;
}

test("callWithStall: a phase that goes quiet fails with where it stopped and cancels the shell's job", async () => {
  const t = fakeTimers();
  const calls = [];
  let push;
  const native = { call: (m, p, on) => { calls.push(m); if (m === "signing.resign") { push = on; return new Promise(() => {}); } return Promise.resolve({ cancelled: true }); } };
  const seen = [];
  const run = callWithStall(native, "signing.resign", { bundleId: "a" }, (ev) => seen.push(ev), { limit: STALL_LIMIT, later: t.later, clear: t.clear });
  await Promise.resolve();
  push({ index: 0, count: 1, name: "Partyboard", phase: "signing", progress: 0.5 });
  push({ log: "Signed PlugIns/Widget.appex" });
  assert.equal(t.list.size, 1);
  assert.equal([...t.list.values()][0].ms, STALL_LIMIT);
  t.fire();
  await assert.rejects(run, (e) => e.code === "stalled" && e.message === "Partyboard stopped at Signing 50%: nothing moved for 3 minutes, so it was cancelled.");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ["signing.resign", "signing.cancel"]);
  push({ phase: "signing", progress: 0.75, name: "Partyboard", count: 1, index: 0 });
  assert.equal(seen.length, 2, "events after the stall are dropped");
});

test("callWithStall: iOS's install isn't timed, the next app's download is, and an answer clears the timer", async () => {
  const t = fakeTimers();
  let push, answer;
  const native = { call: (m, p, on) => { push = on; return new Promise((r) => { answer = r; }); } };
  const run = callWithStall(native, "signing.resignAll", {}, () => {}, { later: t.later, clear: t.clear });
  await Promise.resolve();
  for (const phase of ["uploading", "handoff", "installing"]) {
    push({ index: 0, count: 2, name: "A", phase, progress: 0 });
    assert.equal(t.list.size, 0, phase);
  }
  push({ index: 1, count: 2, name: "B", phase: "downloading", progress: 0.1 });
  assert.equal(t.list.size, 1);
  answer({ done: ["a", "b"], failed: [] });
  assert.deepEqual(await run, { done: ["a", "b"], failed: [] });
  assert.equal(t.list.size, 0);
});

test("callWithStall: a failure passes through as it came", async () => {
  const t = fakeTimers();
  const native = { call: () => Promise.reject(Object.assign(new Error("No certificate"), { code: "no_identity" })) };
  await assert.rejects(callWithStall(native, "signing.resign", {}, () => {}, { later: t.later, clear: t.clear }), (e) => e.code === "no_identity");
  assert.equal(t.list.size, 0);
});

test("stallMessage before any event", () => {
  assert.equal(stallMessage(null), "Re-signing stopped at the start: nothing moved for 3 minutes, so it was cancelled.");
});
