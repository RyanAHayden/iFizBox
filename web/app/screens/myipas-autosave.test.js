// F379: a custom IPA install saves its IPA in My IPAs with the Sign Options it was signed with (core/myipas.js
// saveInstalledIpa), unless that bundle ID and version is saved already, and a later Re-sign signs that saved IPA
// (core/appqueue.js savedResignJob, signing/queue.js prepareOnDevice) with no download.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppQueue, customInstallSave, savedResignJob, withSavedIpa, resignJob, jobDownloads } from "../core/appqueue.js";
import { savedIpa, savedIpaOptions, saveInstalledIpa } from "../core/myipas.js";
import { prepareOnDevice } from "../signing-client.js";
import { saveIpaCopy, rememberIpa } from "./ipa-install.js";

const URL1 = "https://example.com/Delta-1.5.ipa";

// The shell's library (native MyIPAs.swift) as a fake bridge: library.add "downloads" (counted in `fetches`).
function fakeShell(ipas = [], { about = { name: "Delta", bundleId: "com.x.delta", version: "1.5", size: 1000 } } = {}) {
  const lib = ipas.map((e) => ({ ...e }));
  const calls = [];
  const fetches = [];
  const call = async (method, params = {}) => {
    calls.push({ method, params });
    if (method === "library.list") return { ipas: lib.map((e) => ({ ...e })), identity: true };
    if (method === "library.add") {
      fetches.push(params.url);
      let file = `${about.name}.ipa`;
      for (let i = 2; lib.some((e) => e.file === file); i++) file = `${about.name} ${i}.ipa`;
      lib.push({ file, ...about, options: null, signed: null, error: null });
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
      return { token: "t1", bundleId: params.bundleId || "com.x.delta", name: "Delta" };
    }
    if (method === "signing.cancel") return {};
    throw new Error(`unknown method ${method}`);
  };
  return { lib, calls, fetches, call, native: { call } };
}

const EDITS = { name: "My Delta", bundleId: "com.me.delta", removeExtensions: ["PlugIns/W.appex"], keepBundleId: false };
const customJob = () => createAppQueue().add({ id: "com.x.delta", name: "Delta", version: "1.5", url: URL1,
  options: { token: "tok", at: 1, edits: { ...EDITS }, name: "My Delta", signsAs: "com.me.delta" } });

test("an IPA install adds a My IPAs entry with its Sign Options, and a following re-sign signs it with no fetch", async () => {
  const shell = fakeShell();
  const what = customInstallSave(customJob());
  assert.deepEqual(what, { url: URL1, bundleId: "com.x.delta", version: "1.5", edits: EDITS }); // no token
  const saved = await saveInstalledIpa(what, { call: shell.call });
  assert.equal(saved.added, true);
  assert.equal(shell.lib.length, 1);
  assert.deepEqual(shell.lib[0].options, EDITS);
  assert.deepEqual(shell.fetches, [URL1]); // the one download, the save's

  // the Re-sign the app's row queues (signed record: the ID it was signed as)
  const q = createAppQueue();
  const job = q.add(resignJob({ bundleId: "com.me.delta", name: "My Delta", version: "1.5" }));
  shell.calls.length = 0;
  await prepareOnDevice(job, { tag: "com.me.delta#1", native: shell.native });
  const prep = shell.calls.find((c) => c.method === "signing.prepare");
  assert.equal(prep.params.library, "Delta.ipa");
  assert.equal(prep.params.record, undefined);
  assert.equal(prep.params.url, undefined);
  assert.equal(prep.params.bundleId, "com.me.delta");
  assert.equal(prep.params.name, "My Delta");
  assert.deepEqual(prep.params.removeExtensions, ["PlugIns/W.appex"]);
  assert.equal(prep.params.keepBundleId, false);
  assert.deepEqual(shell.fetches, [URL1]); // nothing downloaded again
});

test("skipped when that bundle ID and version is saved already: no download", async () => {
  const shell = fakeShell([{ file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.5" }]);
  const r = await saveInstalledIpa(customInstallSave(customJob()), { call: shell.call });
  assert.equal(r.added, false);
  assert.equal(r.entry.file, "Delta.ipa");
  assert.deepEqual(shell.fetches, []);
  assert.equal(shell.lib.length, 1);
  assert.deepEqual(shell.lib[0].options, EDITS); // the install's Sign Options become the saved IPA's
  // and a Re-sign of that app signs the saved IPA, as it was installed, with no download
  shell.calls.length = 0;
  await prepareOnDevice(createAppQueue().add(resignJob({ bundleId: "com.me.delta", name: "My Delta", version: "1.5" })),
    { tag: "com.me.delta#2", native: shell.native });
  const prep = shell.calls.find((c) => c.method === "signing.prepare");
  assert.equal(prep.params.library, "Delta.ipa");
  assert.equal(prep.params.bundleId, "com.me.delta");
  assert.deepEqual(shell.fetches, []);
  // another version is saved as its own entry
  const other = fakeShell([{ file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.4" }]);
  assert.equal((await saveInstalledIpa(customInstallSave(customJob()), { call: other.call })).added, true);
  assert.equal(other.lib.length, 2);
});

test("an install that didn't say its version (jailbreak): a copy that turns out to be saved already is deleted again", async () => {
  const shell = fakeShell([{ file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.5" }]);
  const r = await saveInstalledIpa({ url: URL1, bundleId: "com.x.delta", version: null }, { call: shell.call });
  assert.equal(r.added, false);
  assert.equal(r.entry.file, "Delta.ipa");
  assert.deepEqual(shell.lib.map((e) => e.file), ["Delta.ipa"]);
  assert.ok(shell.calls.some((c) => c.method === "library.delete" && c.params.file === "Delta 2.ipa"));
  assert.ok(!shell.calls.some((c) => c.method === "library.options")); // no edits: no Sign Options
});

test("customInstallSave: only a Custom Install with a url (not a source's plain Install, a My IPAs file, iFizBox, a Remove)", () => {
  const q = createAppQueue();
  assert.equal(customInstallSave(q.add({ id: "com.x.a", url: "https://a/a.ipa", version: "1" })), null);
  assert.equal(customInstallSave(q.add({ id: "com.x.b", library: "B.ipa", options: { edits: { name: "B" } } })), null);
  assert.equal(customInstallSave(q.add({ id: "com.ryha.ifizbox", url: "https://a/i.ipa", options: { edits: {} } })), null);
  assert.equal(customInstallSave(q.add({ op: "remove", id: "com.x.c" })), null);
  assert.equal(customInstallSave(null), null);
});

test("savedIpa: the same bundle ID (its own or the one its Sign Options sign as) and version; both must be known", () => {
  const list = [{ file: "A.ipa", bundleId: "com.x.a", version: "2", options: { bundleId: "com.me.a" } },
    { file: "Bad.ipa", bundleId: "com.x.b", version: "1", error: "not a zip" }];
  assert.equal(savedIpa(list, { bundleId: "com.x.a", version: "2" }).file, "A.ipa");
  assert.equal(savedIpa(list, { bundleId: "com.me.a", version: "2" }).file, "A.ipa");
  assert.equal(savedIpa(list, { bundleId: "com.x.a", version: "3" }), null);
  assert.equal(savedIpa(list, { bundleId: "com.x.a", version: null }), null);
  assert.equal(savedIpa(list, { bundleId: "com.x.b", version: "1" }), null); // unreadable
  assert.equal(savedIpa(null, { bundleId: "com.x.a", version: "2" }), null);
});

test("savedIpaOptions: the install's edits as library.options, nothing when it had none", () => {
  assert.deepEqual(savedIpaOptions("A.ipa", { name: "N", icon: "", removeExtensions: [], fixArm64e: false }), { file: "A.ipa", name: "N", fixArm64e: false });
  assert.equal(savedIpaOptions("A.ipa", {}), null);
  assert.equal(savedIpaOptions("A.ipa", null), null);
  assert.equal(savedIpaOptions("", { name: "N" }), null);
});

test("savedResignJob: a Re-sign with a url, a library job or no saved IPA stays as it is; the queue keeps library", async () => {
  const entries = [{ file: "A.ipa", name: "A", bundleId: "com.x.a", version: "2", size: 500, options: null }];
  const marked = { id: "com.x.a", mode: "resign", url: "https://a/a.ipa", installed: "2" };
  const m = { match: savedIpa };
  assert.equal(savedResignJob(marked, entries, m), marked);
  const other = { id: "com.x.a", mode: "resign", url: null, installed: "3" };
  assert.equal(savedResignJob(other, entries, m), other);
  const plain = { id: "com.x.a", mode: "install", url: "https://a/a.ipa", version: "2" };
  assert.equal(savedResignJob(plain, entries, m), plain);
  const s = savedResignJob({ id: "com.x.a", mode: "resign", url: null, installed: "2", version: "2" }, entries, m);
  assert.equal(savedResignJob({ id: "com.x.a", mode: "resign", installed: "2" }, entries).library, undefined); // no match given
  assert.equal(s.library, "A.ipa");
  assert.equal(jobDownloads(s), false);
  const kept = createAppQueue().add({ ...s, options: { edits: { name: "A2" } } });
  assert.equal(kept.mode, "resign");
  assert.equal(kept.library, "A.ipa");
  assert.deepEqual(kept.options, { edits: { name: "A2" } });
  assert.equal(await withSavedIpa(other, { call: async () => { throw new Error("no shell"); } }), other);
  assert.equal(await withSavedIpa(other, {}), other);
});

test("jailbreak: Install from URL or a link saves the IPA (saveIpaCopy, from rememberIpa), not awaited", async () => {
  const shell = fakeShell();
  const r = await saveIpaCopy({ ok: true, url: URL1, bundleId: "com.x.delta" }, { bridge: shell.native });
  assert.equal(r.added, true);
  assert.deepEqual(shell.fetches, [URL1]);
  assert.equal(await saveIpaCopy({ ok: false, url: URL1 }, { bridge: shell.native }), null);
  assert.equal(await saveIpaCopy({ ok: true, url: URL1 }, { bridge: null }), null);
  const saved = [];
  const store = async () => ({ all: async () => [], put: async () => {}, get: async () => null });
  await rememberIpa({ ok: true, url: URL1, bundleId: "com.x.delta" }, "Delta.ipa", { store, save: (x) => { saved.push(x.url); } });
  assert.deepEqual(saved, [URL1]);
  saved.length = 0;
  await rememberIpa({ ok: true, url: URL1, bundleId: "" }, "Delta.ipa", { store, save: (x) => { saved.push(x.url); } });
  assert.deepEqual(saved, []);
});

test("sideload: a Custom Install that landed saves its IPA (screens/queue.js saveCustomIpa); a plain Install doesn't", async () => {
  const { saveCustomIpa } = await import("./queue.js");
  const shell = fakeShell();
  const r = await saveCustomIpa(customJob(), { native: shell.native });
  assert.equal(r.added, true);
  assert.deepEqual(shell.lib[0].options, EDITS);
  const plain = fakeShell();
  assert.equal(await saveCustomIpa(createAppQueue().add({ id: "com.x.a", url: "https://a/a.ipa", version: "1" }), { native: plain.native }), null);
  assert.deepEqual(plain.calls, []);
  assert.equal(saveCustomIpa(customJob(), { native: null }), null);
});
