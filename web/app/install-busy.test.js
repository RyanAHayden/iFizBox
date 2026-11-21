// B312: reinstalling an app while another app (SideDrop re-signing every app) has iOS installing the same bundle ID
// sat on the progress page. signing.progress now says {busy: true} while that other install runs, and fails
// install_busy / install_stalled once the install iOS shows sits still for a minute before iOS has our IPA.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });

const { openPrepared, forgetRoute } = await import("./signing-client.js");
const { appRows, createAppRun, rowStatus, runStatus } = await import("./core/apprun.js");
const { busyText, busyStuckText } = await import("./core/signing.js");

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// The prompt route: signing.open answers at once; signing.progress is driven through `watches[bundleId]`.
function promptNative() {
  const watches = {};
  return {
    watches,
    call(method, params, onEvent) {
      if (method === "signing.open") return Promise.resolve({ bundleId: `com.${params.token}`, expires: null });
      if (method === "signing.progress") {
        return new Promise((resolve, reject) => { watches[params.bundleId] = { emit: onEvent, answer: resolve, fail: reject }; });
      }
      return Promise.resolve({});
    },
  };
}

const nativeError = (text) => Object.assign(new Error(text.slice(text.indexOf(":") + 2)), { code: text.slice(0, text.indexOf(":")) });

function oneRun(native) {
  const rows = appRows([{ id: "com.umod", name: "uMod", mode: "install", url: "https://x/umod.ipa" }]);
  const lines = [];
  const run = createAppRun({
    rows,
    sign: async (r) => ({ token: r.id.slice(4), bundleId: r.id }),
    install: (r, o) => openPrepared(r, { ...o, tag: `${r.id}#1`, native }),
    onLog: ({ text }) => lines.push(text),
  });
  return { rows, lines, end: run.start() };
}

test("B312: {busy: true} shows on the row and the run's status, and {busy: false} goes back to waiting for iOS", async () => {
  store.clear();
  forgetRoute();
  const native = promptNative();
  const { rows, lines, end } = oneRun(native);
  await flush();
  native.watches["com.umod"].emit({ busy: true });
  await flush();
  assert.equal(rowStatus(rows[0]), busyText("uMod"));
  assert.equal(runStatus(rows), busyText("uMod"));
  assert.ok(lines.includes(busyText("uMod")), "the run's log says it once");
  native.watches["com.umod"].emit({ busy: false });
  await flush();
  assert.notEqual(rowStatus(rows[0]), busyText("uMod"));
  native.watches["com.umod"].answer({ installed: true });
  await end;
  assert.equal(rows[0].state, "installed");
});

test("B312: install_busy ends the row Failed with the wait-then-again hint, not Sent to iOS", async () => {
  store.clear();
  forgetRoute();
  const native = promptNative();
  const { rows, end } = oneRun(native);
  await flush();
  native.watches["com.umod"].emit({ busy: true });
  native.watches["com.umod"].fail(nativeError("install_busy: iOS is already installing com.umod for another app, and it hasn't moved for 60 seconds"));
  await end;
  assert.equal(rows[0].state, "failed");
  assert.equal(rows[0].error, busyStuckText("uMod"));
});

test("B312: install_stalled ends the row Failed with iOS didn't install it", async () => {
  store.clear();
  forgetRoute();
  const native = promptNative();
  const { rows, end } = oneRun(native);
  await flush();
  native.watches["com.umod"].fail(nativeError("install_stalled: iOS didn't install com.umod: its install hasn't moved for 60 seconds"));
  await end;
  assert.equal(rows[0].state, "failed");
  assert.match(rows[0].error, /^iOS didn't install uMod/);
});

test("B312: any other watch failure still ends Sent to iOS (B146)", async () => {
  store.clear();
  forgetRoute();
  const native = promptNative();
  const p = openPrepared({ id: "y", name: "Y", token: "y" }, { tag: "y#1", native });
  await flush();
  native.watches["com.y"].fail(nativeError("timeout: something else"));
  assert.deepEqual(await p, { installed: null, expires: null });
});
