// F359: the sideload app's run signs every app up front, and on the This iPhone route (local(row): installd, no iOS
// prompt) copies and installs up to `parallel` apps at once, each joining once the one before it is copying. Rows on
// the iOS prompt route still go one at a time. Stop, Cancel and Retry stay per row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appRows, createAppRun, runStatus, rowStatus, summaryLine, installLaneStart, HERE_PARALLEL } from "./apprun.js";
import { SELF_ID } from "./appqueue.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

function phone() {
  const events = [];
  const pending = { sign: new Map(), install: new Map() };
  const discarded = [];
  const make = (kind) => (row, hooks) => new Promise((resolve, reject) => {
    events.push(`${kind}:${row.id}`);
    hooks.signal.addEventListener("abort", () => { events.push(`abort-${kind}:${row.id}`); reject(new Error("cancelled")); });
    pending[kind].set(row.id, { resolve, reject, hooks });
  });
  return {
    events, pending, discarded,
    sign: make("sign"), install: make("install"),
    discard: (r) => discarded.push(r.id),
    signed(id) { pending.sign.get(id).resolve({ token: `t-${id}`, bundleId: id }); },
    installed(id) { pending.install.get(id).resolve({ installed: true }); },
    copying(id, f = 0) { pending.install.get(id).hooks.progress("copying", f); },
  };
}

const jobs = (...ids) => ids.map((id) => ({ id, name: id.toUpperCase(), mode: "install", url: `https://x/${id}.ipa` }));
const installs = (ph) => ph.events.filter((e) => e.startsWith("install"));

test("every app starts signing up front, before the first install", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b", "c", "d", "e"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, ahead: Infinity, parallel: HERE_PARALLEL, local: () => true });
  run.start();
  await flush();
  assert.deepEqual(ph.events, ["sign:a", "sign:b", "sign:c", "sign:d", "sign:e"], "every app signs at once, no ahead = 2");
  ph.signed("a");
  await flush();
  assert.deepEqual(ph.events, ["sign:a", "sign:b", "sign:c", "sign:d", "sign:e", "install:a"],
    "the first install comes after every app's signing started");
  assert.deepEqual(rows.slice(1).map((r) => r.state), ["downloading", "downloading", "downloading", "downloading"]);
  ph.copying("a");
  for (const id of ["b", "c", "d", "e"]) ph.signed(id);
  await flush();
  assert.ok(rows.every((r) => r.state !== "waiting" && r.state !== "downloading" && r.state !== "signing"), "all signed");
  run.cancel();
});

test("This iPhone rows overlap: each joins once the one before is copying, at most `parallel`, each its own progress", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b", "c", "d"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, ahead: Infinity, parallel: 3, local: () => true });
  const end = run.start();
  await flush();
  for (const id of ["a", "b", "c", "d"]) ph.signed(id);
  await flush();
  // a's route isn't settled yet (the route alert may be up): nobody joins it
  assert.deepEqual(installs(ph), ["install:a"]);
  ph.copying("a", 0.1);
  await flush();
  assert.deepEqual(installs(ph), ["install:a", "install:b"]);
  ph.copying("b", 0);
  await flush();
  assert.deepEqual(installs(ph), ["install:a", "install:b", "install:c"]);
  ph.copying("c", 0.5);
  await flush();
  assert.deepEqual(installs(ph), ["install:a", "install:b", "install:c"], "3 at most");
  assert.equal(rows[3].state, "signed");
  assert.equal(rowStatus(rows[0]), "Copying to iPhone 10%");
  assert.equal(rowStatus(rows[2]), "Copying to iPhone 50%");
  assert.equal(runStatus(rows), "Copying 3 apps to iPhone");
  ph.pending.install.get("b").hooks.progress("installing", 0.4);
  assert.equal(rowStatus(rows[1]), "Installing 40%");
  assert.equal(runStatus(rows), "Installing 3 apps");
  ph.installed("b");
  await flush();
  assert.deepEqual(installs(ph), ["install:a", "install:b", "install:c", "install:d"], "a free place goes to the next");
  for (const id of ["a", "c"]) ph.installed(id);
  ph.copying("d");
  ph.installed("d");
  await end;
  assert.equal(summaryLine(rows), "4 installed");
});

test("iOS prompt rows stay one at a time, the others signed and waiting", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b", "c"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, ahead: Infinity, parallel: 3, local: () => false });
  const end = run.start();
  await flush();
  for (const id of ["a", "b", "c"]) ph.signed(id);
  await flush();
  assert.deepEqual(installs(ph), ["install:a"]);
  ph.pending.install.get("a").hooks.progress("asking", 0);
  await flush();
  assert.deepEqual(installs(ph), ["install:a"]);
  assert.deepEqual(rows.slice(1).map((r) => r.state), ["signed", "signed"]);
  ph.installed("a");
  await flush();
  assert.deepEqual(installs(ph), ["install:a", "install:b"]);
  ph.installed("b");
  await flush();
  ph.installed("c");
  await end;
  assert.deepEqual(installs(ph), ["install:a", "install:b", "install:c"]);
});

test("a This iPhone row that fell back to iOS's prompt holds the others", () => {
  const signed = (id) => ({ id, state: "signed", here: false, job: {} });
  const rows = [{ id: "a", state: "asking", phase: "asking", here: false, job: {} }, signed("b")];
  assert.equal(installLaneStart(rows, { parallel: 3, local: () => true }), null);
  rows[0] = { ...rows[0], state: "installing", phase: "copying", here: true };
  assert.equal(installLaneStart(rows, { parallel: 3, local: () => true })?.id, "b");
  // a Try Again (iOS's prompt again) never goes beside others
  rows[1] = { ...rows[1], again: true };
  assert.equal(installLaneStart(rows, { parallel: 3, local: () => true }), null);
});

test("iFizBox's own row still waits until every other row ended, even on This iPhone", async () => {
  const ph = phone();
  const rows = appRows([...jobs("a", "b"), { id: SELF_ID, name: "Self", mode: "install", url: "https://x/self.ipa" }]);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, ahead: Infinity, parallel: 3, local: () => true });
  const end = run.start();
  await flush();
  for (const id of ["a", "b", SELF_ID]) ph.signed(id);
  await flush();
  ph.copying("a");
  await flush();
  ph.copying("b");
  await flush();
  assert.deepEqual(installs(ph), ["install:a", "install:b"]);
  ph.installed("a");
  await flush();
  assert.deepEqual(installs(ph), ["install:a", "install:b"]);
  ph.installed("b");
  await flush();
  assert.deepEqual(installs(ph), ["install:a", "install:b", `install:${SELF_ID}`]);
  ph.installed(SELF_ID);
  await end;
});

test("stop, Retry and Cancel stay per row while rows copy together", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b", "c"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard, ahead: Infinity, parallel: 3, local: () => true });
  const end = run.start();
  await flush();
  for (const id of ["a", "b", "c"]) ph.signed(id);
  await flush();
  ph.copying("a");
  await flush();
  ph.copying("b");
  await flush();
  ph.copying("c");
  await flush();
  run.stop("b");
  await flush();
  assert.equal(rows[1].state, "cancelled");
  assert.ok(ph.events.includes("abort-install:b"));
  assert.deepEqual(rows.map((r) => r.state), ["installing", "cancelled", "installing"], "the others go on");
  ph.pending.install.get("c").reject(new Error("installd said no"));
  await flush();
  assert.equal(rows[2].state, "failed");
  run.retry("c");
  await flush();
  assert.equal(ph.events.filter((e) => e === "sign:c").length, 2, "Retry signs c again");
  ph.signed("c");
  await flush();
  assert.equal(installs(ph).filter((e) => e === "install:c").length, 2, "and it joins a's copy");
  run.cancel();
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["cancelled", "cancelled", "cancelled"]);
});

test("a downloaded app waiting for the shell's one signer doesn't stall while another signs", async () => {
  const timers = [];
  const later = (f, ms) => { const t = { f, ms, live: true }; timers.push(t); return t; };
  const clear = (t) => { if (t) t.live = false; };
  const ph = phone();
  const rows = appRows(jobs("a", "b"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, ahead: Infinity, parallel: 3, local: () => true, later, clear, stallMs: 1000 });
  run.start();
  await flush();
  ph.pending.sign.get("b").hooks.progress("downloading", 1); // b downloaded: it waits for a's signing
  const bTimer = timers.filter((t) => t.live).at(-1);
  ph.pending.sign.get("a").hooks.progress("signing", 0.3, "signing");
  assert.equal(bTimer.live, false, "b's clock started again");
  assert.equal(rows[1].state, "downloading");
  run.cancel();
});
