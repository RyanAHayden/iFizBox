// F234: the install queue run (core/installrun.js): rows, order, the re-plan after a failure, the scheduler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runRows, neededBy, deadRows, createInstallRun, rowStatus, summaryLine, runStatus, runPercent, mb, sizeText } from "./installrun.js";
import { parseSimulation } from "./queue.js";
import { PACKAGE } from "../brand.js";

// apt-get -s: lib (added by apt) <- tweak; other alone; old removed; up upgraded.
const SIM = [
  "Remv old [1.0]",
  "Inst lib (2.0 Repo [iphoneos-arm64])",
  "Inst tweak (1.0 Repo [iphoneos-arm64])",
  "Inst other (3.0 Repo [iphoneos-arm64])",
  "Inst up [1.0] (1.1 Repo [iphoneos-arm64])",
  "Inst child (1.0 Repo [iphoneos-arm64])",
].join("\n");
const JOBS = [
  { op: "install", id: "other", name: "Other" },
  { op: "install", id: "tweak", name: "Tweak" },
  { op: "install", id: "up", name: "Up" },
  { op: "install", id: "child", name: "Child" },
  { op: "remove", id: "old" },
];
const INFO = {
  lib: { name: "Lib", debUrl: "https://r/lib.deb", sha256: "a".repeat(64), size: 2_000_000 },
  tweak: { debUrl: "https://r/tweak.deb", depends: "lib (>= 2.0), mobilesubstrate", size: 1_000_000 },
  other: { debUrl: "https://r/other.deb", depends: "firmware (>= 14.0)" },
  up: { debUrl: "https://r/up.deb" },
  child: { debUrl: "https://r/child.deb", preDepends: "tweak" },
};
const rowsOf = () => runRows(parseSimulation(SIM), JOBS, INFO);

test("runRows: removals first, then the queue's order with each package after what it needs", () => {
  const rows = rowsOf();
  assert.deepEqual(rows.map((r) => r.id), ["old", "other", "lib", "tweak", "up", "child"]);
  const lib = rows.find((r) => r.id === "lib");
  assert.equal(lib.added, true);
  assert.equal(lib.name, "Lib");
  assert.deepEqual(lib.neededBy, ["tweak"]);
  assert.equal(rows.find((r) => r.id === "tweak").added, false);
  assert.equal(rows.find((r) => r.id === "old").op, "remove");
  assert.equal(rows.find((r) => r.id === "up").from, "1.0");
  assert.deepEqual(neededBy(parseSimulation(SIM), JOBS, INFO), { lib: ["tweak"] });
});

test("runRows: iFizBox's own package goes last, with only what needs it after it (installing it closes the app)", () => {
  const sim = [
    `Inst ${PACKAGE} [1.0] (1.1 R [a])`,
    "Inst small (1 R [a])",
    "Inst plug (1 R [a])",
    "Inst plugdep (1 R [a])",
    "Inst lib (1 R [a])",
    "Inst late (1 R [a])",
  ].join("\n");
  const jobs = [PACKAGE, "small", "plug", "plugdep", "late"].map((id) => ({ op: "install", id }));
  const info = { [PACKAGE]: { depends: "lib" }, plug: { depends: PACKAGE }, plugdep: { depends: "plug" } };
  const rows = runRows(parseSimulation(sim), jobs, info);
  assert.deepEqual(rows.map((r) => r.id), ["lib", "small", "late", PACKAGE, "plug", "plugdep"]);
  // alone, or with nothing else: unchanged
  assert.deepEqual(runRows(parseSimulation(`Inst ${PACKAGE} (1 R [a])\nInst small (1 R [a])`),
    [{ op: "install", id: PACKAGE }, { op: "install", id: "small" }], {}).map((r) => r.id), ["small", PACKAGE]);
  // removed, it isn't moved (and removals stay first)
  assert.deepEqual(runRows(parseSimulation(`Remv ${PACKAGE} [1]\nInst small (1 R [a])`),
    [{ op: "remove", id: PACKAGE }, { op: "install", id: "small" }], {}).map((r) => r.id), [PACKAGE, "small"]);
});

test("createInstallRun: queued iFizBox + a small package: the small one installs before iFizBox", async () => {
  const sim = `Inst ${PACKAGE} [1.0] (1.1 R [a])\nInst small (1 R [a])`;
  const rows = runRows(parseSimulation(sim), [{ op: "install", id: PACKAGE }, { op: "install", id: "small" }], {});
  const order = [];
  const run = createInstallRun({ rows, fetch: async () => ({ file: "x" }), install: async (r) => { order.push(r.id); return { ok: true }; } });
  await run.start();
  assert.deepEqual(order, ["small", PACKAGE]);
});

test("deadRows: a failure takes its reverse dependencies (transitively), nothing else", () => {
  const rows = rowsOf();
  rows.find((r) => r.id === "lib").state = "failed";
  const dead = deadRows(rows);
  assert.deepEqual([...dead.entries()].sort(), [["child", "lib"], ["tweak", "lib"]]);
});

test("Depends names match ignoring case: order, needed by, skipped", () => {
  const plan = parseSimulation("Inst user (1 R [a])\nInst oreo (1 R [a])");
  const jobs = [{ op: "install", id: "User" }];
  const info = { user: { depends: "Oreo" } };
  const rows = runRows(plan, jobs, info);
  assert.deepEqual(rows.map((r) => r.id), ["oreo", "user"]);
  assert.deepEqual(rows.map((r) => r.added), [true, false]);
  assert.deepEqual(neededBy(plan, jobs, info), { oreo: ["user"] });
  rows[0].state = "failed";
  assert.deepEqual([...deadRows(rows).entries()], [["user", "oreo"]]);
  assert.equal(deadRows(rows, { Oreo: "1" }).size, 0);
});

test("deadRows: an installed version that satisfies the relation stands in for a failed upgrade", () => {
  const rows = runRows(parseSimulation("Inst up [1.0] (1.1 R [a])\nInst a (1 R [a])\nInst b (1 R [a])"),
    [{ op: "install", id: "up" }, { op: "install", id: "a" }, { op: "install", id: "b" }],
    { a: { depends: "up" }, b: { depends: "up (>= 1.1)" } });
  rows.find((r) => r.id === "up").state = "failed";
  assert.deepEqual([...deadRows(rows).keys()], ["b"]);
});

test("deadRows: another alternative in the plan or not a row at all keeps it", () => {
  const rows = runRows(parseSimulation("Inst x (1 R [a])\nInst y (1 R [a])\nInst z (1 R [a])"),
    [{ op: "install", id: "z" }], { z: { depends: "x | y, virtual-thing" } });
  rows.find((r) => r.id === "x").state = "failed";
  assert.equal(deadRows(rows).size, 0);
  rows.find((r) => r.id === "y").state = "failed";
  assert.deepEqual([...deadRows(rows).entries()], [["z", "x"]]);
});

// A fake backend: each fetch and install resolves when the test says so.
function harness(rows, { downloads = 3 } = {}) {
  const fetches = new Map();
  const installs = [];
  const logs = [];
  const fetchStarted = [];
  const run = createInstallRun({
    rows, downloads,
    fetch: (r, { signal, progress }) => new Promise((resolve, reject) => {
      fetchStarted.push(r.id);
      fetches.set(r.id, { resolve, reject, progress, signal });
    }),
    install: (r) => new Promise((resolve) => installs.push({ id: r.id, resolve })),
    onLog: (l) => logs.push(l),
  });
  return { run, fetches, installs, logs, fetchStarted };
}
const tick = () => new Promise((r) => setImmediate(r));

test("the run: 3 downloads at a time, one dpkg lane in order; a bad hash fails one row and skips only its dependents", async () => {
  const rows = rowsOf();
  const h = harness(rows);
  const done = h.run.start();
  await tick();
  // old (a removal) needs no download and is dpkg's first; the first 3 downloads are going
  assert.deepEqual(h.fetchStarted, ["other", "lib", "tweak"]);
  assert.deepEqual(h.installs.map((i) => i.id), ["old"]);
  assert.equal(rows.find((r) => r.id === "up").state, "waiting");
  h.fetches.get("lib").progress(0.5);
  assert.equal(rowStatus(rows.find((r) => r.id === "lib")), "Downloading 1.0 of 2.0 MB");
  h.fetches.get("lib").reject(new Error("bad_hash: SHA256 doesn't match"));
  await tick();
  assert.equal(rows.find((r) => r.id === "lib").state, "failed");
  assert.equal(rows.find((r) => r.id === "tweak").state, "skipped");
  assert.equal(rows.find((r) => r.id === "child").state, "skipped");
  assert.equal(h.fetches.get("tweak").signal.aborted, true);
  assert.equal(rowStatus(rows.find((r) => r.id === "child"), { lib: "Lib" }), "Needs Lib, which failed");
  assert.deepEqual(h.fetchStarted, ["other", "lib", "tweak", "up"]);
  h.installs[0].resolve({ ok: true });
  h.fetches.get("other").resolve({ file: "o.deb" });
  h.fetches.get("up").resolve({ viaApt: true });
  await tick();
  assert.deepEqual(h.installs.map((i) => i.id), ["old", "other"]);
  h.installs[1].resolve({ ok: true });
  await tick();
  assert.deepEqual(h.installs.map((i) => i.id), ["old", "other", "up"]);
  assert.equal(rowStatus(rows.find((r) => r.id === "up")), "Downloading and installing");
  h.installs[2].resolve({ ok: true });
  const end = await done;
  assert.equal(summaryLine(end), "2 installed, 1 removed, 1 failed, 2 skipped");
  assert.ok(h.logs.some((l) => l.pkg === "child" && l.kind === "warning"));
  assert.ok(h.logs.every((l) => l.pkg));
});

test("retrying a skipped row retries what it needs first, then it", async () => {
  const rows = runRows(parseSimulation("Inst a (1 R [x])\nInst b (1 R [x])"), [{ op: "install", id: "b" }], { a: { debUrl: "u" }, b: { debUrl: "v", depends: "a" } });
  const h = harness(rows);
  let done = h.run.start();
  await tick();
  h.fetches.get("a").reject(new Error("network: offline"));
  await tick();
  await done;
  assert.deepEqual(rows.map((r) => r.state), ["failed", "skipped"]);
  done = h.run.retry("b");
  await tick();
  assert.deepEqual(rows.map((r) => r.state), ["downloading", "downloading"]);
  h.fetches.get("a").resolve({ file: "a" });
  await tick();
  h.installs.at(-1).resolve({ ok: true });
  await tick();
  h.fetches.get("b").resolve({ file: "b" });
  await tick();
  h.installs.at(-1).resolve({ ok: true });
  await done;
  assert.deepEqual(rows.map((r) => r.state), ["installed", "installed"]);
});

test("an install failure skips its dependents; the rest installs", async () => {
  const rows = runRows(parseSimulation("Inst a (1 R [x])\nInst b (1 R [x])\nInst c (1 R [x])"),
    [{ op: "install", id: "a" }, { op: "install", id: "b" }, { op: "install", id: "c" }], { b: { depends: "a" } });
  const h = harness(rows);
  const done = h.run.start();
  await tick();
  for (const id of ["a", "b", "c"]) h.fetches.get(id).resolve({ file: id });
  await tick();
  h.installs[0].resolve({ ok: false, error: "dpkg: error processing a" });
  await tick();
  assert.equal(rows[1].state, "skipped");
  assert.deepEqual(h.installs.map((i) => i.id), ["a", "c"]);
  h.installs[1].resolve({ ok: true });
  await done;
  assert.equal(summaryLine(rows), "1 installed, 1 failed, 1 skipped");
});

test("cancel: downloads stop at once, dpkg finishes its package, the rest is cancelled", async () => {
  const rows = runRows(parseSimulation("Inst a (1 R [x])\nInst b (1 R [x])\nInst c (1 R [x])"),
    [{ op: "install", id: "a" }, { op: "install", id: "b" }, { op: "install", id: "c" }], {});
  const h = harness(rows);
  const done = h.run.start();
  await tick();
  h.fetches.get("a").resolve({ file: "a" });
  await tick();
  assert.equal(h.run.current.id, "a");
  assert.equal(h.run.cancel(), true);
  assert.equal(h.run.stopping, true);
  assert.equal(h.fetches.get("b").signal.aborted, true);
  assert.deepEqual(rows.map((r) => r.state), ["installing", "cancelled", "cancelled"]);
  h.fetches.get("b").resolve({ file: "late" }); // too late: ignored
  h.installs[0].resolve({ ok: true });
  await done;
  assert.deepEqual(rows.map((r) => r.state), ["installed", "cancelled", "cancelled"]);
  assert.equal(h.installs.length, 1);
  assert.equal(summaryLine(rows), "1 installed, 2 cancelled");
  // Retry All reruns the cancelled ones
  const again = h.run.retryAll();
  await tick();
  assert.deepEqual(rows.map((r) => r.state), ["installed", "downloading", "downloading"]);
  h.fetches.get("b").resolve({ file: "b" });
  h.fetches.get("c").resolve({ file: "c" });
  await tick();
  h.installs.at(-1).resolve({ ok: true });
  await tick();
  h.installs.at(-1).resolve({ ok: true });
  await again;
  assert.equal(summaryLine(rows), "3 installed");
});

test("a row's stop cancels it and skips what needs it; the rest goes on", async () => {
  const rows = runRows(parseSimulation("Inst a (1 R [x])\nInst b (1 R [x])\nInst c (1 R [x])"),
    [{ op: "install", id: "a" }, { op: "install", id: "b" }, { op: "install", id: "c" }], { b: { depends: "a" } });
  const h = harness(rows);
  const done = h.run.start();
  await tick();
  assert.equal(h.run.stop("a"), true);
  assert.equal(h.fetches.get("a").signal.aborted, true);
  assert.deepEqual(rows.map((r) => r.state), ["cancelled", "skipped", "downloading"]);
  assert.equal(rowStatus(rows[1], { a: "Ay" }), "Needs Ay, which was cancelled");
  h.fetches.get("c").resolve({ file: "c" });
  await tick();
  h.installs[0].resolve({ ok: true });
  await done;
  assert.equal(summaryLine(rows), "1 installed, 1 skipped, 1 cancelled");
  assert.equal(h.run.stop("c"), false);
});

test("words: statuses, summary, bottom status and the bar", () => {
  const r = { id: "a", op: "install", state: "waiting" };
  assert.equal(rowStatus(r), "Waiting");
  assert.equal(rowStatus({ ...r, state: "downloading" }), "Downloading");
  assert.equal(rowStatus({ ...r, state: "ready" }), "Waiting to install");
  assert.equal(rowStatus({ ...r, state: "installing" }), "Installing");
  assert.equal(rowStatus({ ...r, state: "installed" }), "Installed");
  assert.equal(rowStatus({ ...r, op: "remove", state: "installed" }), "Removed");
  assert.equal(rowStatus({ ...r, state: "failed", error: "bad hash" }), "Failed: bad hash");
  assert.equal(rowStatus({ ...r, state: "cancelled" }), "Cancelled");
  assert.equal(summaryLine([]), "Nothing to do");
  assert.equal(mb(4_000_000), "4.0");
  assert.equal(sizeText(4_000_000), "4.0 MB");
  assert.equal(sizeText(568), "1 KB");
  assert.equal(sizeText(0), "0 KB");
  assert.equal(rowStatus({ ...r, state: "downloading", total: 600_000, done: 300_000 }), "Downloading 300 of 600 KB");
  const rows = [{ id: "a", op: "install", state: "installed" }, { id: "b", op: "install", state: "installing" }, { id: "c", op: "install", state: "downloading", fraction: 0.5 }];
  assert.equal(rowStatus(rows[2]), "Downloading 50%");
  assert.equal(runStatus(rows, { b: "Bee" }), "Installing Bee (2 of 3)");
  assert.equal(runStatus([rows[2]]), "Downloading c");
  assert.equal(runPercent(rows), Math.round(((1 + 0.75 + 0.25) / 3) * 100));
});
