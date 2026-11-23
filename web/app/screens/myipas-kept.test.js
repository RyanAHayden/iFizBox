// F380: a custom IPA install keeps its own download in My IPAs (keepInLibrary: true on signing.prepare and ipa.install;
// the shell's reply says libraryFile), so the save after it (core/myipas.js saveInstalledIpa) uses that file instead
// of library.add {url}: the whole install and save cost one download.
import { test } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });

const { createAppQueue, customInstallSave } = await import("../core/appqueue.js");
const { saveInstalledIpa, noteKeptIpa, takeKeptIpa } = await import("../core/myipas.js");
const { prepareOnDevice, openPrepared, forgetRoute } = await import("../signing-client.js");
const { saveIpaCopy } = await import("./ipa-install.js");
const { installIpa } = await import("../ipa-install.js");

const URL1 = "https://example.com/Delta-1.5.ipa";
const DELTA = { name: "Delta", bundleId: "com.x.delta", version: "1.5", options: null, signed: null, error: null };

// The shell: signing.prepare downloads (with keepInLibrary the download is held), signing.open puts the held file in
// the library; library.add downloads again. Every download is counted in `fetches`.
function fakeShell(ipas = []) {
  const lib = ipas.map((e) => ({ ...e }));
  const calls = [];
  const fetches = [];
  let held = null;
  const call = async (method, params = {}) => {
    calls.push({ method, params });
    if (method === "library.list") return { ipas: lib.map((e) => ({ ...e })), identity: true };
    if (method === "library.add") {
      fetches.push(params.url);
      const file = lib.some((e) => e.file === "Delta-1.5.ipa") ? "Delta-1.5 2.ipa" : "Delta-1.5.ipa";
      lib.push({ file, ...DELTA });
      return { file, ipas: lib.map((e) => ({ ...e })) };
    }
    if (method === "library.options") {
      const e = lib.find((x) => x.file === params.file);
      const { file, ...o } = params;
      e.options = o;
      return { ...e };
    }
    if (method === "library.delete") { lib.splice(lib.findIndex((x) => x.file === params.file), 1); return { ipas: lib }; }
    if (method === "signing.prepare") {
      if (params.url) fetches.push(params.url);
      held = params.keepInLibrary === true ? params.url : null;
      return { token: "t1", bundleId: "com.x.delta", name: "Delta", version: "1.5" };
    }
    if (method === "signing.open") {
      const out = { bundleId: "com.x.delta", name: "Delta", version: "1.5" };
      if (!held) return out;
      const file = lib.some((e) => e.file === "Delta-1.5.ipa") ? "Delta-1.5 2.ipa" : "Delta-1.5.ipa";
      lib.push({ file, ...DELTA });
      held = null;
      return { ...out, libraryFile: file };
    }
    if (method === "signing.progress") return { installed: true };
    if (method === "signing.cancel") return {};
    throw new Error(`unknown method ${method}`);
  };
  return { lib, calls, fetches, call, native: { call } };
}

const EDITS = { name: "My Delta", bundleId: "com.me.delta" };
const customJob = () => createAppQueue().add({ id: "com.x.delta", name: "Delta", version: "1.5", url: URL1,
  options: { token: "tok", at: 1, edits: { ...EDITS } } });

test("a Custom Install's prepare keeps its download: one library entry, one download, its Sign Options", async () => {
  store.clear();
  forgetRoute();
  const shell = fakeShell();
  const job = customJob();
  const prep = await prepareOnDevice(job, { tag: "d#1", native: shell.native });
  assert.equal(shell.calls.find((c) => c.method === "signing.prepare").params.keepInLibrary, true);
  await openPrepared({ id: job.id, name: "Delta", token: prep.token, bundleId: prep.bundleId, job }, { tag: "d#1", native: shell.native, server: true });
  // screens/queue.js saveCustomIpa's save, once the install landed
  const r = await saveInstalledIpa(customInstallSave(job), { call: shell.call });
  assert.equal(r.added, true);
  assert.equal(r.entry.file, "Delta-1.5.ipa");
  assert.deepEqual(shell.lib.map((e) => e.file), ["Delta-1.5.ipa"]);
  assert.deepEqual(shell.lib[0].options, EDITS);
  assert.deepEqual(shell.fetches, [URL1]); // the install's download only
  assert.ok(!shell.calls.some((c) => c.method === "library.add"));
  assert.equal(takeKeptIpa(URL1), null); // used once
});

test("a plain Install from a source sends no keepInLibrary", async () => {
  store.clear();
  forgetRoute();
  const shell = fakeShell();
  await prepareOnDevice(createAppQueue().add({ id: "com.x.a", name: "A", url: "https://a/a.ipa", version: "1" }), { tag: "a#1", native: shell.native });
  assert.equal(shell.calls.find((c) => c.method === "signing.prepare").params.keepInLibrary, undefined);
});

test("the kept file of an app saved already at that version is deleted again; the saved one takes the Sign Options", async () => {
  const shell = fakeShell([{ file: "Delta.ipa", ...DELTA }, { file: "Delta-1.5.ipa", ...DELTA }]);
  noteKeptIpa(URL1, "Delta-1.5.ipa");
  const r = await saveInstalledIpa(customInstallSave(customJob()), { call: shell.call });
  assert.equal(r.added, false);
  assert.equal(r.entry.file, "Delta.ipa");
  assert.deepEqual(shell.lib.map((e) => e.file), ["Delta.ipa"]);
  assert.deepEqual(shell.lib[0].options, EDITS);
  assert.deepEqual(shell.fetches, []);
});

test("a kept file that is gone (deleted in Files meanwhile): library.add downloads it as before", async () => {
  const shell = fakeShell();
  const r = await saveInstalledIpa({ ...customInstallSave(customJob()), file: "Gone.ipa" }, { call: shell.call });
  assert.equal(r.added, true);
  assert.deepEqual(shell.fetches, [URL1]);
});

test("jailbreak: Install from URL asks ipa.install to keep the IPA, and saveIpaCopy uses its libraryFile", async () => {
  const sent = [];
  const native = { call: async (m, p) => { sent.push([m, p]); return { code: 0, bundleId: "com.x.delta", libraryFile: "Delta-1.5.ipa" }; } };
  const r = await installIpa(URL1, null, { native, keep: true });
  assert.equal(sent[0][1].keepInLibrary, true);
  assert.equal(r.libraryFile, "Delta-1.5.ipa");
  await installIpa(URL1, null, { native });
  assert.equal(sent[1][1].keepInLibrary, undefined); // AltStore and queue installs keep nothing
  const shell = fakeShell([{ file: "Delta-1.5.ipa", ...DELTA }]);
  const saved = await saveIpaCopy({ ok: true, url: URL1, bundleId: "com.x.delta", libraryFile: "Delta-1.5.ipa" }, { bridge: shell.native });
  assert.equal(saved.added, true);
  assert.equal(saved.entry.file, "Delta-1.5.ipa");
  assert.deepEqual(shell.fetches, []);
  assert.deepEqual(shell.lib.map((e) => e.file), ["Delta-1.5.ipa"]);
});
