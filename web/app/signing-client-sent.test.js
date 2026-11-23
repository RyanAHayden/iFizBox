// B146: on the Signing Server route (iOS's Install prompt), iFizBox can't tell "not installed" from "installed but
// not seen" once iOS took the IPA (isInstalled is unreliable on iOS 27, a re-signed app may not show), so the shell's
// installed:false ends the row Done "Sent X to iOS", not Failed. A dismissed prompt (iOS never asked for the IPA)
// still fails, and This iPhone's real answer (installd) still counts.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeNative } from "./fakes.test-helper.js";

const store = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });

const { openPrepared, forgetRoute } = await import("./signing-client.js");
const { appRows, createAppRun, rowStatus } = await import("./core/apprun.js");

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };


// The prompt route: signing.open, then signing.progress answers `reply`.
const promptNative = (reply) => fakeNative({
  "signing.open": () => Promise.resolve({ bundleId: "com.a", expires: "2026-12-03T00:00:00Z" }),
  "signing.progress": () => Promise.resolve(reply),
});

// One row through the run, its install being openPrepared over `native`.
async function runOne(native) {
  const rows = appRows([{ id: "com.a", name: "Alpha", mode: "install", url: "https://x/a.ipa" }]);
  const lines = [];
  const run = createAppRun({
    rows,
    sign: async () => ({ token: "t", bundleId: "com.a" }),
    install: (r, o) => openPrepared(r, { ...o, tag: "a#1", native }),
    onLog: ({ text }) => lines.push(text),
  });
  await run.start();
  await flush();
  return { row: rows[0], lines };
}

test("B146: prompt route, installed:false after iOS took the IPA -> null, the row ends Sent to iOS (unsure)", async () => {
  store.clear();
  forgetRoute();
  const reply = { installed: false, handedOff: false, dismissed: false };
  assert.deepEqual(await openPrepared({ id: "a", name: "Alpha", token: "t" }, { tag: "a#1", native: promptNative(reply) }),
    { installed: null, expires: "2026-12-03T00:00:00Z" });
  const { row, lines } = await runOne(promptNative(reply));
  assert.equal(row.state, "installed");
  assert.equal(row.unsure, true);
  assert.notEqual(rowStatus(row), "Failed: iOS didn't install it");
  assert.ok(lines.includes("Sent Alpha to iOS"), lines.join(" | "));
  assert.ok(!lines.some((l) => /didn't install/.test(l)));
});

test("B146: prompt route, installed:true stays Installed", async () => {
  store.clear();
  forgetRoute();
  const { row, lines } = await runOne(promptNative({ installed: true }));
  assert.equal(row.state, "installed");
  assert.equal(row.unsure, false);
  assert.ok(lines.includes("Installed Alpha"));
});

test("B146: prompt route, a dismissed prompt still fails: iOS didn't download it", async () => {
  store.clear();
  forgetRoute();
  const reply = { installed: false, handedOff: false, dismissed: true };
  assert.deepEqual(await openPrepared({ id: "a", name: "Alpha", token: "t" }, { tag: "a#1", native: promptNative(reply) }),
    { installed: false, expires: "2026-12-03T00:00:00Z", dismissed: true });
  const { row } = await runOne(promptNative(reply));
  assert.equal(row.state, "failed");
  assert.equal(row.dismissed, true);
  assert.match(rowStatus(row), /^Failed: iOS didn't download it/);
});

test("B146: This iPhone route keeps installd's real answer: false still fails", async () => {
  store.clear();
  store.set("ifizbox.installRoute", "iphone");
  forgetRoute();
  const native = () => fakeNative({
    "idevice.status": () => Promise.resolve({ paired: "rp", vpn: { available: true, tested: true } }),
    "signing.open": () => Promise.resolve({ bundleId: "com.a", installed: false }),
  });
  const n = native();
  assert.deepEqual(await openPrepared({ id: "a", name: "Alpha", token: "t", bundleId: "com.a" }, { tag: "a#1", native: n }),
    { installed: false, expires: null });
  assert.ok(!n.calls.some((c) => c.method === "signing.progress"));
  forgetRoute();
  const { row } = await runOne(native());
  assert.equal(row.state, "failed");
  assert.equal(rowStatus(row), "Failed: iOS didn't install it");
  forgetRoute();
  store.clear();
});
