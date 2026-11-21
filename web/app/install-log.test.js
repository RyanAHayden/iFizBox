// B29: the install log on the progress page. The shell's {log} lines reach the console from library.install (My
// IPAs). Once iOS has the link the page ends on Done (user 2026-11-18), so the server's later lines aren't shown.
// F361: Settings > Console Logs keeps every run from its first line: a run that never ends is there, Running…, with
// what it said so far; one left running by an earlier launch reads Stopped; sideload signs and installs are kept too.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeNative, memStorage, withDocument } from "./fakes.test-helper.js";
import { installFromLibrary } from "./signing-client.js";
import { createRunLog, runState, runStatusText } from "./core/queue.js";
import { loggedBridge, callWithStall, sideloadRunTitle, logSideloadRuns } from "./core/signing.js";
import { runIpaConsole } from "./screens/ipa-install.js";
import { logsPage, logsSection } from "./screens/queue.js";

function fakeHUD() {
  const h = { labels: [], lines: [], hidden: 0 };
  h.set = (x) => h.labels.push(x);
  h.hide = () => { h.hidden++; };
  h.page = { raw: (t) => h.lines.push(t) };
  return h;
}

let saved;
beforeEach(() => { saved = globalThis.ifizboxNative; });
afterEach(() => { if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved; logSideloadRuns(null); });

test("installFromLibrary: library.install's log (the bundle ID it installs as) reaches the console", async () => {
  const native = fakeNative({
    "library.sign": {},
    "library.install": (p, on) => {
      on({ log: "Bundle ID: io.github.fizl0.hst.beta, version 1.7.2; serving 43.7 MB" });
      on({ phase: "installing", progress: 0 });
      return { bundleId: "io.github.fizl0.hst.beta", name: "OpenTennis Beta", version: "1.7.2" };
    },
  });
  const h = fakeHUD();
  const followed = [];
  const r = await installFromLibrary({ file: "opentennis-beta-p146.ipa", name: "OpenTennis Beta" },
    { native, hud: () => h, alert: async () => assert.fail("no alert"), check: async () => null, reachable: async () => true,
      follow: (n, id) => followed.push(id), later: () => {} });
  assert.equal(r, "installed");
  assert.deepEqual(h.lines, ["Bundle ID: io.github.fizl0.hst.beta, version 1.7.2; serving 43.7 MB"]);
  assert.deepEqual(followed, ["io.github.fizl0.hst.beta"]);
});

test("F361 start(): the entry is saved running before the run ends, each line as it comes", () => {
  const st = memStorage();
  const logs = createRunLog(st);
  const run = logs.start({ title: "Install Delta" });
  assert.equal(logs.list()[0].state, "running");
  assert.equal(runStatusText(logs.list()[0]), "Running…");
  run.line("Downloading");
  run.line("Signing");
  // what a fresh read of the same storage sees (another page, or after a crash)
  assert.equal(JSON.parse(st.getItem("ifizbox.consoleLogs"))[0].text, "Downloading\nSigning");
  run.end({ code: 0 });
  run.line("after the end"); // ignored
  const e = logs.get(run.id);
  assert.equal(e.state, "done");
  assert.equal(e.ok, true);
  assert.equal(e.text, "Downloading\nSigning");
  assert.equal(runStatusText(e), "Completed");
});

test("F361 end(): cancelled and failed runs, and older entries without a state", () => {
  const logs = createRunLog(memStorage());
  const a = logs.start({ title: "a" });
  a.end({ cancelled: true });
  const b = logs.start({ title: "b" });
  b.end({ code: 100, text: "the whole log" });
  assert.equal(runStatusText(logs.get(a.id)), "Cancelled");
  assert.equal(runStatusText(logs.get(b.id)), "Failed (100)");
  assert.equal(logs.get(b.id).text, "the whole log");
  assert.equal(runState({ ok: true }), "done");
  assert.equal(runState({ ok: false, code: 1 }), "failed");
  assert.equal(runStatusText({ ok: false, code: -1 }), "Failed");
});

test("F361 a run left running by an earlier launch reads Stopped, with its lines kept", () => {
  const st = memStorage();
  const earlier = createRunLog(st, { session: "an-earlier-launch" });
  const run = earlier.start({ title: "Install Delta" });
  run.line("Copying the IPA to iOS (40 MB), then iOS installs it");
  // the app is killed here: end() never comes
  const now = createRunLog(st);
  const e = now.list()[0];
  assert.equal(e.state, "stopped");
  assert.equal(runStatusText(e), "Stopped");
  assert.match(now.get(e.id).text, /Copying the IPA/);
});

test("F361 loggedBridge: a signing.install that never ends is in the logs, Running…, with the shell's lines", async () => {
  const logs = createRunLog(memStorage());
  let finish;
  const native = fakeNative({
    "signing.install": (p, on) => {
      on({ phase: "downloading", progress: 0.1 });
      on({ phase: "downloading", progress: 0.5 });
      on({ log: "Signed Delta 1.6 as com.example.delta, 40 MB" });
      on({ phase: "here", progress: 0.3 });
      return new Promise((r) => { finish = r; });
    },
  });
  const events = [];
  const n = loggedBridge(native, logs);
  const p = n.call("signing.install", { url: "https://example.com/Delta.ipa" }, (ev) => events.push(ev));
  await new Promise((r) => setTimeout(r, 0));
  const [e] = logs.list();
  assert.equal(e.state, "running");
  assert.equal(e.title, "Install Delta");
  assert.equal(logs.get(e.id).text, "Downloading\nSigned Delta 1.6 as com.example.delta, 40 MB\nInstalling on this iPhone");
  assert.equal(events.length, 4); // every event still reaches the caller
  finish({ bundleId: "com.example.delta", name: "Delta Emulator" });
  assert.equal((await p).name, "Delta Emulator");
  const done = logs.get(e.id);
  assert.equal(done.state, "done");
  assert.equal(done.title, "Install Delta Emulator");
  assert.match(done.text, /\nDone$/);
});

test("F361 loggedBridge: failures and Cancel, other calls untouched, wrapping twice logs once", async () => {
  const logs = createRunLog(memStorage());
  const native = fakeNative({
    "library.sign": Object.assign(new Error("Cancelled"), { code: "cancelled" }),
    "signing.resign": new Error("The profile has expired."),
    "signing.installed": { apps: [] },
  });
  const n = loggedBridge(loggedBridge(native, logs), logs);
  await assert.rejects(n.call("library.sign", { file: "Delta.ipa" }));
  await assert.rejects(n.call("signing.resign", { bundleId: "com.example.delta" }));
  assert.deepEqual(await n.call("signing.installed", {}), { apps: [] });
  const list = logs.list();
  assert.deepEqual(list.map((e) => [e.title, runStatusText(e)]),
    [["Re-sign com.example.delta", "Failed"], ["Sign Delta", "Cancelled"]]);
  assert.match(logs.get(list[0].id).text, /Error: The profile has expired\./);
  assert.equal(native.calls.length, 3);
  // no store: the bridge as it was
  assert.equal(loggedBridge(native, null), native);
});

test("F361 Re-sign All and the sign-ahead's install get their titles; callWithStall's re-sign is kept", async () => {
  assert.equal(sideloadRunTitle("signing.resignAll", {}), "Re-sign All");
  const logs = createRunLog(memStorage());
  logSideloadRuns(logs);
  const native = fakeNative({
    "signing.prepare": { token: "t1", name: "Delta" },
    "signing.open": { opened: true },
    "signing.resignAll": (p, on) => {
      on({ index: 0, count: 2, name: "Delta", phase: "signing", progress: 0.2 });
      on({ index: 0, count: 2, name: "Delta", phase: "signing", progress: 0.7 });
      on({ index: 1, count: 2, name: "Provenance", phase: "signing", progress: 0.1 });
      return { done: 2 };
    },
    "signing.resign": (p, on) => { on({ log: "Re-signing com.example.delta" }); return { bundleId: "com.example.delta", name: "Delta" }; },
  });
  const n = loggedBridge(native);
  await n.call("signing.prepare", { url: "https://example.com/x.ipa" });
  await n.call("signing.open", { token: "t1" });
  await n.call("signing.resignAll", {});
  await callWithStall(native, "signing.resign", { bundleId: "com.example.delta" });
  const list = logs.list();
  assert.deepEqual(list.map((e) => e.title), ["Re-sign Delta", "Re-sign All", "Install Delta", "Sign Delta"]);
  assert.equal(logs.get(list[1].id).text, "Signing Delta (1 of 2)\nSigning Provenance (2 of 2)\nDone");
  assert.match(logs.get(list[0].id).text, /^Re-signing com\.example\.delta/);
});

test("F361 runIpaConsole: an IPA install that never ends is in the logs from its first line", async () => {
  const logs = createRunLog(memStorage());
  let finish;
  const closers = [];
  const page = { line() {}, status() {}, progress() {}, finish() {}, stoppable() {}, close() {}, onClose: (f) => closers.push(f) };
  const install = (job, view) => {
    view.line("info", job.url);
    view.line("status", "Downloading");
    return new Promise((r) => { finish = r; });
  };
  const ended = runIpaConsole({ url: "https://example.com/Delta.ipa", name: "Delta" }, { open: () => page, install, logs });
  await new Promise((r) => setTimeout(r, 0));
  const [e] = logs.list();
  assert.equal(e.title, "Install Delta");
  assert.equal(e.state, "running");
  assert.equal(logs.get(e.id).text, "https://example.com/Delta.ipa\n» Downloading");
  finish({ ok: false, cancelled: true, bundleId: "", log: "https://example.com/Delta.ipa\n» Downloading\n» Cancelled" });
  await ended;
  assert.equal(runStatusText(logs.get(e.id)), "Cancelled");
  for (const f of closers) f();
});

test("F361 Settings: the Console row in both builds, and a running install on Console Logs", () => withDocument(() => {
  const logs = createRunLog(memStorage());
  assert.match(logsSection("sideload", { logs }).textContent, /Console Logs.*None/);
  const run = logs.start({ title: "Install Delta" });
  run.line("Downloading");
  const later = [];
  const list = logsPage(undefined, () => {}, { logs, later: (f, ms) => later.push(ms) });
  assert.match(list.textContent, /Install Delta.*Running…/);
  assert.deepEqual(later, [1000]); // drawn again while it runs
  const one = logsPage(run.id, () => {}, { logs, later: (f, ms) => later.push(ms) });
  assert.match(one.textContent, /Running…[\s\S]*Downloading/);
  run.end({ code: 0 });
  later.length = 0;
  logsPage(undefined, () => {}, { logs, later: (f, ms) => later.push(ms) });
  assert.deepEqual(later, []);
}));
