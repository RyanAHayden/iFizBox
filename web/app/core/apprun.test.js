// F235: the IPA queue's run (core/apprun.js): every app signed ahead, handed to iOS one at a time in order (iFizBox
// last), a row's stop cancels only that app, Cancel abandons the rest, a quiet phase times out into that row's failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appRows, createAppRun, rowStatus, summaryLine, runStatus, runPercent, stallText } from "./apprun.js";
import { coordinatorBusy, busyBundleId, ownIdOk, BUSY_ROW, BUSY_ROW_KEPT } from "./apprun.js"; // B151
import { SELF_ID } from "./appqueue.js";
import { recordWhen } from "./apprun.js"; // B236

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

// A controllable phone: each sign / install waits until the test settles it.
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
    signed(id, extra = {}) { pending.sign.get(id).resolve({ token: `t-${id}`, bundleId: id, ...extra }); },
    installed(id, extra = {}) { pending.install.get(id).resolve({ installed: true, ...extra }); },
  };
}

const jobs = (...ids) => ids.map((id) => ({ id, name: id.toUpperCase(), mode: "install", url: `https://x/${id}.ipa` }));

test("signs ahead (2 at a time), installs one at a time in order, iFizBox last", async () => {
  const ph = phone();
  const rows = appRows(jobs(SELF_ID, "a", "b", "c"));
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c", SELF_ID]);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard });
  const end = run.start();
  await flush();
  assert.deepEqual(ph.events, ["sign:a", "sign:b"]);
  ph.signed("a");
  await flush();
  // a goes to iOS; c starts signing in a's place
  assert.deepEqual(ph.events.slice(2), ["sign:c", "install:a"]);
  assert.equal(rowStatus(rows[0]), "Tap Install on the iOS prompt");
  ph.signed("b");
  ph.signed("c");
  await flush();
  assert.equal(rows[1].state, "signed");
  assert.equal(rowStatus(rows[1]), "Signed: Waiting to Install");
  // b waits for a's install, even though it is signed
  assert.equal(ph.events.filter((e) => e.startsWith("install")).length, 1);
  ph.installed("a");
  await flush();
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:a", "install:b"]);
  ph.signed(SELF_ID);
  ph.installed("b");
  await flush();
  ph.installed("c");
  await flush();
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:a", "install:b", "install:c", `install:${SELF_ID}`]);
  ph.installed(SELF_ID);
  await end;
  assert.equal(run.running, false);
  assert.equal(summaryLine(rows), "4 installed");
});

// B263: Re-sign All with one big app: the apps behind it go to iOS as each is signed, never held by its download
test("a row still downloading holds nobody: each signed app goes to iOS at once; iFizBox waits for every other", async () => {
  const ph = phone();
  const rows = appRows([...jobs("big", "b", "c", "d"), { id: SELF_ID, name: "Self", mode: "resign" }]);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard });
  const end = run.start();
  await flush();
  assert.deepEqual(ph.events, ["sign:big", "sign:b"]);
  ph.signed("b");
  await flush();
  // big is still downloading: b goes to iOS anyway, c signs in b's place
  assert.deepEqual(ph.events.slice(2), ["sign:c", "install:b"]);
  assert.equal(rows[0].state, "downloading");
  ph.signed("c");
  await flush();
  assert.equal(rows[2].state, "signed"); // one with iOS at a time
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:b"]);
  ph.installed("b");
  await flush();
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:b", "install:c"]);
  // a failed sign holds nobody either
  ph.pending.sign.get("d").reject(new Error("bad IPA"));
  await flush();
  assert.equal(rows[3].state, "failed");
  ph.installed("c");
  ph.signed(SELF_ID);
  await flush();
  // iFizBox's own row is signed, but big hasn't ended: it waits (installing it closes iFizBox)
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:b", "install:c"]);
  ph.signed("big");
  await flush();
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:b", "install:c", "install:big"]);
  ph.installed("big");
  await flush();
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:b", "install:c", "install:big", `install:${SELF_ID}`]);
  ph.installed(SELF_ID);
  await end;
  assert.equal(summaryLine(rows), "3 installed, 1 re-signed, 1 failed");
});

test("a row's stop cancels only that app, at any phase; the next goes on", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b", "c"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard, ahead: 3 });
  const end = run.start();
  await flush();
  // b stopped while it downloads/signs: its job is aborted
  run.stop("b");
  await flush();
  assert.ok(ph.events.includes("abort-sign:b"));
  assert.equal(rows[1].state, "cancelled");
  ph.signed("a");
  ph.signed("c");
  await flush();
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:a"]);
  // a stopped at iOS's prompt: its install is aborted and c goes to iOS
  run.stop("a");
  await flush();
  assert.ok(ph.events.includes("abort-install:a"));
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:a", "install:c"]);
  ph.installed("c");
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["cancelled", "cancelled", "installed"]);
  assert.equal(summaryLine(rows), "1 installed, 2 cancelled");
});

test("a signed app stopped before its turn frees its signed copy", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard });
  const end = run.start();
  await flush();
  ph.signed("a");
  ph.signed("b");
  await flush();
  run.stop("b");
  assert.deepEqual(ph.discarded, ["b"]);
  ph.installed("a");
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["installed", "cancelled"]);
});

test("Cancel abandons the rest: in-flight jobs aborted, signed copies freed, finished apps stay finished", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b", "c", "d"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard });
  const end = run.start();
  await flush();
  ph.signed("a");
  ph.signed("b");
  await flush();
  ph.installed("a");
  await flush();
  // b is with iOS, c and d sign
  assert.equal(run.current.id, "b");
  assert.equal(run.cancel(), true);
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["installed", "cancelled", "cancelled", "cancelled"]);
  assert.ok(ph.events.includes("abort-install:b"));
  assert.ok(ph.events.includes("abort-sign:c") && ph.events.includes("abort-sign:d"));
  assert.equal(run.running, false);
});

test("a failure ends its row only; Retry All runs failed and cancelled rows again", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b", "c"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard, ahead: 3 });
  const end = run.start();
  await flush();
  ph.pending.sign.get("a").reject(new Error("The IPA couldn't be downloaded"));
  ph.signed("b");
  ph.signed("c");
  await flush();
  ph.pending.install.get("b").resolve({ installed: false });
  await flush();
  ph.installed("c");
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["failed", "failed", "installed"]);
  assert.equal(rowStatus(rows[0]), "Failed: The IPA couldn't be downloaded");
  assert.equal(rowStatus(rows[1]), "Failed: iOS didn't install it");
  const again = run.retryAll();
  await flush();
  assert.ok(again);
  ph.signed("a");
  ph.signed("b");
  await flush();
  ph.installed("a");
  await flush();
  ph.installed("b");
  await again;
  assert.deepEqual(rows.map((r) => r.state), ["installed", "installed", "installed"]);
});

test("a phase that stops sending progress times out into its row's failure, and the queue moves on", async () => {
  const ph = phone();
  const timers = [];
  const later = (f, ms) => { timers.push({ f, ms, on: true }); return timers.length - 1; };
  const clear = (i) => { if (timers[i]) timers[i].on = false; };
  const rows = appRows([{ id: "p", name: "Partyboard", mode: "resign" }, { id: "q", name: "Q", mode: "install", url: "u" }]);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard, later, clear, stallMs: 1000 });
  const end = run.start();
  await flush();
  ph.pending.sign.get("p").hooks.progress("signing", 0.5);
  ph.signed("q");
  await flush();
  // fire the newest live timer (p's, armed by its 50%)
  const live = timers.filter((t) => t.on);
  assert.equal(live.length, 1);
  live[0].on = false;
  live[0].f();
  await flush();
  assert.equal(rows[0].state, "failed");
  assert.equal(rows[0].error, stallText({ phase: "signing", fraction: 0.5 }, 1000));
  assert.match(rows[0].error, /Signing 50%/);
  assert.ok(ph.events.includes("abort-sign:p"));
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:q"]);
  ph.installed("q");
  await end;
});

test("the log: one line per phase per app, never one per percent", async () => {
  const ph = phone();
  const lines = [];
  const rows = appRows([{ id: "d", name: "Delta", mode: "install", url: "u", size: 48 * 1024 * 1024 },
    { id: "r", name: "Partyboard", mode: "resign" }]);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, onLog: (l) => lines.push(l.text) });
  const end = run.start();
  await flush();
  const d = ph.pending.sign.get("d").hooks;
  for (const f of [0.1, 0.2, 0.3]) d.progress("downloading", f);
  assert.equal(rowStatus(rows[0]), "Downloading 14.4 of 48.0 MB");
  for (const f of [0.1, 0.6]) d.progress("signing", f);
  ph.signed("d");
  ph.signed("r", { expires: "2026-12-03T12:00:00Z" });
  await flush();
  const i = ph.pending.install.get("d").hooks;
  i.progress("asking", 0);
  i.progress("installing", 0.3);
  i.progress("installing", 0.7);
  ph.installed("d");
  await flush();
  ph.installed("r");
  await end;
  assert.deepEqual(lines, ["Downloading Delta 48.0 MB", "Signing Delta", "Signed Delta", "Signed Partyboard", "Asked iOS to install Delta",
    "iOS is installing Delta", "Installed Delta", "Re-signed Partyboard, expires Dec 3, 2026"]);
  assert.equal(rowStatus(rows[1], { timeZone: "UTC" }), "Re-signed, expires Dec 3, 2026");
  assert.equal(summaryLine(rows), "1 installed, 1 re-signed");
});

test("status and percent while it runs", () => {
  const rows = appRows(jobs("a", "b"));
  rows[0].state = "asking";
  rows[1].state = "signing";
  rows[1].fraction = 0.5;
  assert.equal(runStatus(rows), "Tap Install for A (1 of 2)");
  assert.equal(runPercent(rows), Math.round(((0.5 + 0.375) / 2) * 100));
  rows[0].state = "installed";
  assert.equal(runStatus(rows), "Signing B (2 of 2)");
});

// B76: a stock phone loses sight of iOS's install once iFizBox is in the background; that isn't a refusal.
test("B76: installed:false after a served or backgrounded handoff ends as sent (unsure), not failed; confirm upgrades it", async () => {
  const ph = phone();
  const lines = [];
  const rows = appRows(jobs("a", "b", "c"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, ahead: 3, onLog: (l) => lines.push(l.text) });
  const end = run.start();
  await flush();
  ph.signed("a"); ph.signed("b"); ph.signed("c");
  await flush();
  // a: the shell says iOS had the whole IPA
  ph.pending.install.get("a").resolve({ installed: false, handedOff: true });
  await flush();
  // b: iFizBox went to the background while iOS had it
  assert.equal(run.current?.id, "b");
  assert.equal(run.away(), true);
  ph.pending.install.get("b").resolve({ installed: false });
  await flush();
  // c: refused while iFizBox stayed in front
  ph.pending.install.get("c").resolve({ installed: false });
  await end;
  assert.deepEqual(rows.map((r) => [r.state, r.unsure]), [["installed", true], ["installed", true], ["failed", false]]);
  assert.equal(rowStatus(rows[0]), "Sent to iOS");
  assert.equal(rowStatus(rows[2]), "Failed: iOS didn't install it");
  assert.ok(lines.includes("Sent A to iOS") && lines.includes("Sent B to iOS"));
  assert.equal(summaryLine(rows), "2 installed, 1 failed");
  // back in front, iOS has a: Installed
  assert.equal(run.confirm("a"), true);
  assert.equal(rowStatus(rows[0]), "Installed");
  assert.equal(lines.at(-1), "Installed A");
  assert.equal(run.confirm("a"), false);
  assert.equal(run.confirm("c"), false);
  assert.equal(run.away(), false); // nothing with iOS
});

test("B76: away() before a row reaches iOS doesn't excuse that row's refusal", async () => {
  const ph = phone();
  const rows = appRows(jobs("a"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install });
  const end = run.start();
  await flush();
  assert.equal(run.away(), false); // still signing
  ph.signed("a");
  await flush();
  ph.pending.install.get("a").resolve({ installed: false });
  await end;
  assert.equal(rows[0].state, "failed");
});

// B85: a multi-app run after the downloads: each app gets its own turn with iOS's prompt; a prompt that closed with
// no download fails that app only (B91: "iOS didn't download it", not Cancelled) and never hangs the run.
test("B85/B91: a dismissed prompt fails that app only (iOS didn't download it); the second app still goes to iOS", async () => {
  const ph = phone();
  const lines = [];
  const rows = appRows(jobs("a", "b"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard, onLog: (l) => lines.push(l.text) });
  const end = run.start();
  await flush();
  ph.signed("a"); ph.signed("b");
  await flush();
  assert.equal(run.current?.id, "a");
  // the shell: iOS's prompt for a closed and iOS never asked for the IPA
  ph.pending.install.get("a").resolve({ installed: false, dismissed: true });
  await flush();
  assert.equal(rows[0].state, "failed");
  assert.equal(rowStatus(rows[0]), "Failed: iOS didn't download it");
  assert.ok(lines.includes("A: iOS didn't download it"));
  assert.ok(!lines.some((l) => /Cancelled/.test(l)));
  // b gets its own prompt
  assert.deepEqual(ph.events.filter((e) => e.startsWith("install")), ["install:a", "install:b"]);
  assert.equal(run.current?.id, "b");
  assert.equal(rowStatus(rows[1]), "Tap Install on the iOS prompt");
  ph.installed("b");
  await end;
  assert.equal(run.running, false);
  assert.deepEqual(rows.map((r) => r.state), ["failed", "installed"]);
  assert.equal(summaryLine(rows), "1 installed, 1 failed");
  // no reprompt lane (the website): Try Again signs it again and goes to iOS again, the dismissed mark cleared
  const again = run.retry("a");
  assert.ok(again);
  assert.equal(rows[0].dismissed, false);
  await flush();
  ph.signed("a");
  await flush();
  assert.equal(run.current?.id, "a");
  ph.installed("a");
  await again;
  assert.equal(summaryLine(rows), "2 installed");
});

test("B85: a dismissed answer on the last app still ends the run (no stuck wait); a refusal stays Failed", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install });
  const end = run.start();
  await flush();
  ph.signed("a"); ph.signed("b");
  await flush();
  ph.pending.install.get("a").resolve({ installed: false });
  await flush();
  ph.pending.install.get("b").resolve({ installed: false, dismissed: true });
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["failed", "failed"]);
  assert.equal(rowStatus(rows[0]), "Failed: iOS didn't install it");
  assert.equal(rowStatus(rows[1]), "Failed: iOS didn't download it");
});

// B91: the row iOS didn't download: its Try Again offers the IPA the shell still serves (hooks.again, no new
// signing); only that tap opens a new prompt. When the shell no longer serves it ("gone") the row signs again.
test("B91: Try Again on a row iOS didn't download goes back to iOS's prompt without signing again", async () => {
  const ph = phone();
  const lines = [];
  const rows = appRows(jobs("a"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, reprompt: async () => true,
    onLog: (l) => lines.push(l.text) });
  const end = run.start();
  await flush();
  ph.signed("a");
  await flush();
  ph.pending.install.get("a").resolve({ installed: false, dismissed: true });
  await end;
  assert.equal(rowStatus(rows[0]), "Failed: iOS didn't download it");
  // nothing more goes to the phone by itself
  await flush();
  assert.deepEqual(ph.events, ["sign:a", "install:a"]);
  const again = run.retry("a");
  assert.ok(again);
  await flush();
  assert.deepEqual(ph.events, ["sign:a", "install:a", "install:a"]); // no second sign
  assert.equal(ph.pending.install.get("a").hooks.again, true);
  assert.equal(rows[0].state, "asking");
  assert.equal(rowStatus(rows[0]), "Tap Install on the iOS prompt");
  ph.installed("a");
  await again;
  assert.equal(rows[0].state, "installed");
  assert.equal(summaryLine(rows), "1 installed");
});

test("B91: Try Again when the shell no longer serves the IPA signs it again; a plain failure always signs again", async () => {
  const ph = phone();
  const lines = [];
  const rows = appRows(jobs("a", "b"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, reprompt: async () => true,
    onLog: (l) => lines.push(l.text) });
  const end = run.start();
  await flush();
  ph.signed("a"); ph.signed("b");
  await flush();
  ph.pending.install.get("a").resolve({ installed: false, dismissed: true });
  await flush();
  ph.pending.install.get("b").resolve({ installed: false });
  await end;
  const again = run.retryAll();
  await flush();
  // a goes back to iOS (again), b signs from the start
  assert.equal(ph.pending.install.get("a").hooks.again, true);
  assert.deepEqual(ph.events.slice(4), ["sign:b", "install:a"]);
  ph.pending.install.get("a").reject(Object.assign(new Error("no longer served"), { code: "gone" }));
  await flush();
  assert.ok(ph.events.slice(4).includes("sign:a"));
  assert.ok(lines.includes("A is no longer with iOS; signing it again"));
  ph.signed("a"); ph.signed("b");
  await flush();
  assert.equal(ph.pending.install.get("a").hooks.again, undefined);
  ph.installed("a");
  await flush();
  ph.installed("b");
  await again;
  assert.equal(summaryLine(rows), "2 installed");
});

test("B85: the asking row's reprompt asks the phone again and logs it; only while that app is with iOS", async () => {
  const ph = phone();
  const lines = [];
  const asked = [];
  let answer = true;
  const rows = appRows(jobs("a", "b"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, onLog: (l) => lines.push(l.text),
    reprompt: async (r) => { asked.push(r.id); return answer; } });
  const end = run.start();
  await flush();
  // not with iOS yet: nothing to show again
  assert.equal(await run.reprompt("a"), false);
  ph.signed("a"); ph.signed("b");
  await flush();
  assert.equal(await run.reprompt("b"), false); // b waits its turn (signed)
  assert.equal(await run.reprompt("a"), true);
  assert.deepEqual(asked, ["a"]);
  assert.equal(lines.at(-1), "Asked iOS again to install A");
  assert.equal(rows[0].state, "asking"); // still waits for the Install tap
  answer = false;
  assert.equal(await run.reprompt("a"), false);
  assert.equal(lines.at(-1), "iOS's prompt for A can't be shown again");
  ph.installed("a");
  await flush();
  assert.equal(await run.reprompt("a"), false); // ended
  ph.installed("b");
  await end;
  // a run without a reprompt lane says no
  const r2 = appRows(jobs("c"));
  const run2 = createAppRun({ rows: r2, sign: ph.sign, install: ph.install });
  run2.start();
  await flush();
  ph.signed("c");
  await flush();
  assert.equal(r2[0].state, "asking");
  assert.equal(await run2.reprompt("c"), false);
  run2.cancel();
});

// B137: the This iPhone route (local) has no iOS prompt: its rows and the bottom status say Installing while the
// route is settled, never Tap Install; the Signing Server route keeps the tap words.
test("B137: rowStatus and runStatus per route: local says Installing, the server route says Tap Install", async () => {
  const ph = phone();
  const asked = [];
  const rows = appRows(jobs("a", "b"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, local: (r) => r.id === "a", reprompt: (r) => { asked.push(r.id); return true; } });
  const end = run.start();
  await flush();
  ph.signed("a"); ph.signed("b");
  await flush();
  // a: This iPhone, its route not settled yet (phase null)
  assert.equal(rows[0].state, "asking");
  assert.equal(rows[0].local, true);
  assert.equal(rowStatus(rows[0]), "Installing");
  assert.equal(runStatus(rows), "Installing A (1 of 2)");
  assert.equal(await run.reprompt("a"), false); // no prompt to show again
  assert.deepEqual(asked, []);
  const hooks = ph.pending.install.get("a").hooks;
  hooks.progress("copying", 0.4);
  assert.equal(rowStatus(rows[0]), "Copying to iPhone 40%");
  assert.equal(runStatus(rows), "Copying A to iPhone (1 of 2)");
  hooks.progress("installing", 0.5);
  assert.equal(rowStatus(rows[0]), "Installing 50%");
  assert.equal(runStatus(rows), "Installing A (1 of 2)");
  ph.installed("a");
  await flush();
  // b: the Signing Server route keeps iOS's prompt words
  assert.equal(rows[1].local, false);
  assert.equal(rowStatus(rows[1]), "Tap Install on the iOS prompt");
  assert.equal(runStatus(rows), "Tap Install for B (2 of 2)");
  ph.installed("b");
  await end;
});

test("B137: a local row whose install goes through the Signing Server after all (phase asking) says Tap Install", () => {
  const rows = appRows(jobs("a", "b"));
  Object.assign(rows[0], { state: "asking", local: true, phase: "asking" });
  assert.equal(rowStatus(rows[0]), "Tap Install on the iOS prompt");
  assert.equal(runStatus(rows), "Tap Install for A (1 of 2)");
  rows[0].local = false; rows[0].phase = null; // no local hint (website, tests): the old words
  assert.equal(rowStatus(rows[0]), "Tap Install on the iOS prompt");
});

// B151: the user's error from the This iPhone route (installd), as the row's failure reached the run.
const IX46 = 'Error Domain=IXErrorDomain Code=46 "A coordinated app install already exists for com.atebits.Tweetie2 ' +
  '(creator App Store) but request by mobile_installation_proxy had scope requirement ' +
  'IXCoordinatorScopeRequirementRequired" UserInfo={NSLocalizedDescription=A coordinated app install already exists ' +
  'for com.atebits.Tweetie2, SourceFileLine=123, FunctionName=+[IXAppInstallCoordinator ...]} (APIInternalError)';

test("B151: the App Store's install coordinator (IX Code 46) reads in plain words, and the row's tap installs it with its own bundle ID", async () => {
  assert.equal(coordinatorBusy(IX46), true);
  assert.equal(coordinatorBusy("IXErrorDomain Code=46"), true);
  assert.equal(coordinatorBusy("IXErrorDomain Code=4"), false);
  assert.equal(coordinatorBusy("ApplicationVerificationFailed"), false);
  assert.equal(busyBundleId(IX46), "com.atebits.Tweetie2");

  const ph = phone();
  const lines = [];
  const rows = appRows([{ id: "com.atebits.Tweetie2", name: "X", mode: "install", url: "https://x/x.ipa" }]);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard, onLog: (l) => lines.push(l) });
  const end = run.start();
  await flush();
  ph.signed("com.atebits.Tweetie2");
  await flush();
  ph.pending.install.get("com.atebits.Tweetie2").reject(new Error(IX46));
  await end;
  const r = rows[0];
  assert.equal(r.state, "failed");
  assert.equal(r.busy, true);
  assert.equal(rowStatus(r), `Failed: ${BUSY_ROW}`);
  assert.ok(!rowStatus(r).includes("IXErrorDomain"), "never installd's dump as the main line");
  // B155: the real cause was the App Store copy still installed; the row says so, short
  assert.equal(BUSY_ROW_KEPT, "the App Store version is installed. Delete it, then Retry");
  assert.equal(rowStatus(r), "Failed: the App Store version is installed. Delete it, then Retry, or tap to install it with its own bundle ID");
  const err = lines.filter((l) => l.kind === "error").map((l) => l.text);
  assert.deepEqual(err, [`X: ${BUSY_ROW}`], "the Log's red line is the same one short line");
  // installd's error kept, grey, right below it
  const i = lines.findIndex((l) => l.kind === "error");
  assert.deepEqual(lines[i + 1], { id: "com.atebits.Tweetie2", kind: "raw", text: IX46 });
  assert.equal(summaryLine(rows), "1 failed");

  // the tap: signed again from the start with Keep Bundle IDs off for this app only
  const again = run.ownIdRetry("com.atebits.Tweetie2");
  assert.ok(again);
  assert.equal(r.busy, false);
  assert.equal(r.job.options.edits.keepBundleId, false);
  assert.ok(lines.some((l) => l.text === "Installing X with its own bundle ID"));
  await flush();
  assert.equal(r.state, "downloading");
  ph.signed("com.atebits.Tweetie2", { bundleId: "com.atebits.Tweetie2.ABCDE12345" });
  await flush();
  ph.installed("com.atebits.Tweetie2");
  await again;
  assert.equal(r.state, "installed");
  assert.equal(r.bundleId, "com.atebits.Tweetie2.ABCDE12345");
  // already its own ID: no second offer
  assert.equal(ownIdOk(r), false);
  assert.equal(run.ownIdRetry("com.atebits.Tweetie2"), null);
});

test("B151: iFizBox itself and a record-only re-sign get the plain words without the own-ID offer", async () => {
  const ph = phone();
  const lines = [];
  const rows = appRows([{ id: "rec", name: "Rec", mode: "resign" }, { id: SELF_ID, name: "Self", mode: "install", url: "https://x/s.ipa" }]);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard, onLog: (l) => lines.push(l) });
  const end = run.start();
  await flush();
  ph.pending.sign.get("rec").reject(new Error(IX46));
  ph.pending.sign.get(SELF_ID).reject(new Error(IX46));
  await end;
  for (const r of rows) {
    assert.equal(r.busy, false);
    assert.equal(rowStatus(r), `Failed: ${BUSY_ROW_KEPT}`);
    assert.equal(run.ownIdRetry(r.id), null);
  }
  assert.deepEqual(lines.filter((l) => l.kind === "error").map((l) => l.text).sort(),
    [`Rec: ${BUSY_ROW_KEPT}`, `Self: ${BUSY_ROW_KEPT}`]);
  assert.equal(lines.filter((l) => l.kind === "raw" && l.text === IX46).length, 2);
});

// B153: a retry after the run ended is a new pass (onStart(pass)); a retry while the run still goes is not, and the
// own-bundle-ID retry's line comes after its pass begins (so the page's clean log opens with it).
test("B153: each start of an idle run is a new pass, told before its first line", async () => {
  const ph = phone();
  const events = [];
  const rows = appRows([...jobs("a"), { id: "com.atebits.Tweetie2", name: "X", mode: "install", url: "https://x/x.ipa" }]);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard,
    onStart: (n) => events.push(`pass ${n}`), onLog: (l) => events.push(l.text) });
  const end = run.start();
  assert.deepEqual(events, ["pass 1"]);
  await flush();
  ph.pending.sign.get("a").reject(new Error("a broke"));
  await flush();
  assert.equal(run.retry("a"), end); // still running: the same pass
  assert.equal(run.pass, 1);
  await flush();
  ph.pending.sign.get("a").reject(new Error("a broke again"));
  ph.pending.sign.get("com.atebits.Tweetie2").reject(new Error(IX46));
  await end;
  events.length = 0;
  const again = run.ownIdRetry("com.atebits.Tweetie2");
  assert.ok(again);
  assert.deepEqual(events, ["pass 2", "Installing X with its own bundle ID"]);
  assert.equal(run.pass, 2);
  run.stop("com.atebits.Tweetie2");
  await again;
  events.length = 0;
  const third = run.retryAll();
  assert.equal(events[0], "pass 3");
  run.cancel();
  await third;
});

// B152: the row's bar went back and forth while signing X: the signer reads the IPA (0..1) and then signs it (0..1),
// both under "signing", and every stage (iOS's prompt, its install) starts at 0. The bar is one overall value per app
// that never goes backwards, and so is the bottom bar.
test("B152: interleaved stage events never move a row's bar or the run's percent backwards", async () => {
  const { barOf, SIGN_STEPS } = await import("./apprun.js");
  assert.ok(SIGN_STEPS.reading && SIGN_STEPS.signing);
  const ph = phone();
  const rows = appRows(jobs("x", "y"));
  const seen = { x: [], y: [] };
  const percents = [];
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard,
    onChange: (r) => { seen[r.id].push(barOf(r)); percents.push(runPercent(rows)); } });
  const end = run.start();
  await flush();
  const sx = ph.pending.sign.get("x").hooks.progress;
  const sy = ph.pending.sign.get("y").hooks.progress;
  // two apps signing ahead, their events interleaved, each stage restarting at 0, one late lower value
  const steps = [
    [sx, "downloading", 0], [sy, "downloading", 0.2], [sx, "downloading", 0.5], [sy, "downloading", 1],
    [sx, "downloading", 0.4], [sx, "downloading", 1], [sy, "signing", 0, "reading"], [sx, "signing", 0, "reading"],
    [sy, "signing", 0.6, "reading"], [sx, "signing", 1, "reading"], [sy, "signing", 1, "reading"],
    [sx, "signing", 0, "signing"], [sy, "signing", 0, "signing"], [sx, "signing", 0.5, "signing"],
    [sy, "signing", 0.3], [sx, "signing", 1, "signing"], [sy, "signing", 0.9, "signing"],
  ];
  for (const [p, phase, f, step] of steps) p(phase, f, step);
  assert.equal(rowStatus(rows[0]), "Signing"); // reading done, signing done: 100% says no number
  ph.signed("x");
  await flush();
  const ix = ph.pending.install.get("x").hooks.progress;
  ix("asking", 0);
  ix("installing", 0);
  ix("installing", 0.7);
  ix("installing", 0.2); // iOS's percent stepping back
  ph.signed("y");
  ph.installed("x");
  await flush();
  const iy = ph.pending.install.get("y").hooks.progress;
  iy("copying", 0); iy("copying", 1); iy("installing", 0); iy("installing", 0.5);
  ph.installed("y");
  await end;
  const rising = (xs) => xs.every((v, i) => i === 0 || v >= xs[i - 1]);
  assert.ok(rising(seen.x), `x went back: ${seen.x}`);
  assert.ok(rising(seen.y), `y went back: ${seen.y}`);
  assert.ok(rising(percents), `the run went back: ${percents}`);
  assert.equal(seen.x.at(-1), 1);
  assert.equal(percents.at(-1), 100);
  // reading then signing fill one Signing: halfway once the IPA is read
  const r = appRows(jobs("z"))[0];
  r.state = "signing"; r.fraction = 0.5;
  assert.equal(barOf(r), 0.375);
});

test("B152: a retry starts the row's bar again from the start", async () => {
  const { barOf } = await import("./apprun.js");
  const ph = phone();
  const rows = appRows(jobs("x"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard });
  const end = run.start();
  await flush();
  ph.pending.sign.get("x").hooks.progress("signing", 1, "signing");
  assert.equal(barOf(rows[0]), 0.5);
  ph.pending.sign.get("x").reject(new Error("broke"));
  await end;
  const again = run.retry("x");
  await flush();
  assert.equal(rows[0].state, "downloading");
  assert.equal(barOf(rows[0]), 0);
  run.cancel();
  await again;
});

// B236: iOS 27 never answers apps.isInstalled (null for every app), so an install whose IPA iOS fetched in full is
// recorded on that no-answer; one iOS never fetched (B170: the user's Cancel on iOS's prompt) still waits.
test("B236: a row handed off once iOS had the whole IPA is fetched, and recordWhen records it when iOS can't answer", async () => {
  const ph = phone();
  const rows = appRows(jobs("a", "b"));
  assert.equal(rows[0].fetched, false);
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard });
  const end = run.start();
  await flush();
  ph.signed("a");
  ph.signed("b");
  await flush();
  ph.pending.install.get("a").resolve({ installed: null, handedOff: true }); // the shell's served word
  await flush();
  ph.pending.install.get("b").resolve({ installed: null }); // no answer, nothing fetched (iOS's prompt cancelled)
  await end;
  assert.deepEqual(rows.map((r) => [r.state, r.unsure, r.fetched]), [["installed", true, true], ["installed", true, false]]);
  assert.equal(recordWhen(rows[0]), "wait", "not asked yet");
  assert.equal(recordWhen(rows[0], null), "now", "iOS can't answer: the fetch is the proof");
  assert.equal(recordWhen(rows[0], false), "wait", "iOS says it doesn't have it");
  assert.equal(recordWhen(rows[1], null), "wait", "B170: no fetch, no record");
  assert.equal(recordWhen({ ...rows[0], bundleId: null }, null), "wait");
  assert.equal(recordWhen({ ...rows[0], state: "failed" }, null), "never");
});

test("B236: a retried row starts unfetched", async () => {
  const ph = phone();
  const rows = appRows(jobs("a"));
  const run = createAppRun({ rows, sign: ph.sign, install: ph.install, discard: ph.discard });
  const end = run.start();
  await flush();
  ph.signed("a");
  await flush();
  ph.pending.install.get("a").resolve({ installed: null, handedOff: true });
  await end;
  assert.equal(rows[0].fetched, true);
  rows[0].state = "failed"; // as a later notTaken would leave it
  const again = run.retry("a");
  await flush();
  assert.equal(rows[0].fetched, false);
  run.cancel();
  await again;
});
