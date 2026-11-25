// F292: the IPA's SHA-256 taken when it is signed (the website's signing job; the shell's signing.install /
// signing.prepare answers), kept for Report as Malicious (core/malicious.js rememberIpaHash) under the app page's ID and
// version and the IPA's own, and refused before signing when MALWARE_IPAS lists it (refuseSha256, code "malware").
import { fakeStream } from "./stream.test-helper.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage as memory } from "./fakes.test-helper.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runSignJob } from "./websign-job.js";
import { rememberSigned, malwareHashes, ipaHash, MALWARE_REFUSED, MALWARE_IPAS } from "./core/malicious.js";
import { keepIpaHash, prepareOnDevice, installOnDevice, KNOWN_MALWARE } from "./signing-client.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`./core/fixtures/signing/${n}`, import.meta.url)));
const P12 = fx("test.p12"), PROFILE = fx("test.mobileprovision");
const ZIP = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 7, 7]);
const SHA = createHash("sha256").update(ZIP).digest("hex");


// The smallest zsign the job gets through with: one app, an Info.plist, an output file.
function fakeZsign() {
  const files = new Map(), dirs = new Set(["/"]);
  const seen = { signed: false };
  const create = async () => ({
    FS: {
      mkdir: (p) => { if (dirs.has(p)) throw new Error("EEXIST"); dirs.add(p); },
      writeFile: (p, d) => files.set(p, d),
      readFile: (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); },
      unlink: (p) => files.delete(p),
      readdir: (p) => { if (p !== "/w/app/Payload") throw new Error("ENOENT"); return ["Delta.app"]; },
      stat: () => { throw new Error("ENOENT"); },
    },
    ipaStream: fakeStream(),
    ccall: () => JSON.stringify({ CFBundleIdentifier: "io.x.delta", CFBundleName: "Delta", CFBundleShortVersionString: "1.2" }),
    callMain: (args) => { seen.signed = true; return 0; },
  });
  return { create, seen };
}
const job = (over = {}) => ({ ipa: ZIP.buffer.slice(0), p12: P12, profile: PROFILE, password: "", ...over });

test("the website's signing job answers the IPA's hash, taken before signing", async () => {
  const { create } = fakeZsign();
  const r = await runSignJob(create, job());
  assert.equal(r.sha256, SHA);
  assert.equal(r.originalId, "io.x.delta");
});

test("a hash on the known-malware list is refused before zsign runs (code malware)", async () => {
  const { create, seen } = fakeZsign();
  await assert.rejects(runSignJob(create, job({ refuseSha256: ["f".repeat(64), SHA.toUpperCase()] })),
    (e) => e.code === "malware" && e.message === MALWARE_REFUSED);
  assert.equal(seen.signed, false);
  const other = fakeZsign();
  assert.equal((await runSignJob(other.create, job({ refuseSha256: ["f".repeat(64)] }))).sha256, SHA);
});

test("malwareHashes: the entries' hashes, lowercased, without the ones that have none or a bad one", () => {
  assert.deepEqual(malwareHashes(), []); // the shipped list is empty
  assert.deepEqual(malwareHashes([{ bundleId: "a" }, { sha256: "AB".repeat(32) }, { sha256: "ab".repeat(32) }, { sha256: "nope" }]), ["ab".repeat(32)]);
});

test("rememberSigned: under every ID and version, so the app page's report finds it", () => {
  const s = memory();
  rememberSigned(s, { ids: ["com.src", "com.src", null, "TEAM.signed"], versions: ["1.2", 1.2, ""], sha256: SHA.toUpperCase() });
  assert.equal(ipaHash(s, "com.src", "1.2"), SHA);
  assert.equal(ipaHash(s, "TEAM.signed", "1.2"), SHA);
  rememberSigned(s, { ids: ["com.bad"], versions: ["1"], sha256: "nope" });
  assert.equal(ipaHash(s, "com.bad", "1"), null);
});

test("keepIpaHash: a signer's answer under the caller's ID and version and the IPA's own", () => {
  const s = memory();
  keepIpaHash(s, { sha256: SHA, bundleId: "com.signed", originalBundleId: "com.orig", version: "2.0 (5)" }, { bundleId: "com.page", version: "2.0" });
  for (const [id, v] of [["com.page", "2.0"], ["com.orig", "2.0 (5)"], ["com.signed", "2.0"]]) assert.equal(ipaHash(s, id, v), SHA, `${id}@${v}`);
  keepIpaHash(s, { bundleId: "com.none", version: "1" }, {}); // an older shell: no sha256, nothing kept
  assert.equal(ipaHash(s, "com.none", "1"), null);
});

// The shell's calls, with localStorage standing in for the browser's.
function withStorage(fn) {
  const s = memory();
  const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });
  return Promise.resolve().then(() => fn(s)).finally(() => {
    if (had) Object.defineProperty(globalThis, "localStorage", had); else delete globalThis.localStorage;
  });
}

test("the IPA queue's signing.prepare sends refuseSha256 and keeps the hash it answers", () => withStorage(async (s) => {
  const calls = [];
  const native = { mode: "sideload", async call(m, p) { calls.push({ m, p }); return m === "signing.prepare" ? { token: "t", bundleId: "com.x", originalBundleId: "com.x", version: "3", sha256: SHA } : null; } };
  const r = await prepareOnDevice({ id: "com.x", name: "X", url: "https://q.example/x.ipa", version: "3", options: {} }, { tag: "a", native });
  assert.equal(r.token, "t");
  assert.equal("refuseSha256" in calls.find((c) => c.m === "signing.prepare").p, false, "nothing listed: the call is as it was");
  assert.equal(ipaHash(s, "com.x", "3"), SHA);
  await listing(async () => {
    await prepareOnDevice({ id: "com.y", name: "Y", url: "https://q.example/y.ipa", options: {} }, { tag: "b", native });
    assert.deepEqual(calls.filter((c) => c.m === "signing.prepare").at(-1).p.refuseSha256, ["e".repeat(64)]);
  });
}));

// MALWARE_IPAS with one hashed entry for the length of `fn` (the shipped list is empty).
async function listing(fn) {
  MALWARE_IPAS.push({ bundleId: "com.bad", sha256: "E".repeat(64), name: "Bad", reason: "It is bad.", link: null });
  try { return await fn(); } finally { MALWARE_IPAS.length = 0; }
}

test("signing.install sends refuseSha256; its malware refusal shows as Known Malware", () => withStorage(async () => {
  const calls = [];
  const native = { mode: "sideload", async call(m, p) {
    calls.push({ m, p });
    if (m === "signing.install") throw Object.assign(new Error(MALWARE_REFUSED), { code: "malware" });
    return null;
  } };
  const shown = [];
  const hud = { set() {}, hide() {}, onCancel() {} };
  const ok = await listing(() => installOnDevice({ url: "https://m.example/x.ipa", name: "X" }, { native, hud: () => hud, alert: async (a) => { shown.push(a); return { index: 0 }; }, later: () => {} }));
  assert.equal(ok, false);
  assert.deepEqual(calls.find((c) => c.m === "signing.install").p.refuseSha256, ["e".repeat(64)]);
  assert.equal(shown.at(-1).title, KNOWN_MALWARE);
  assert.equal(shown.at(-1).message, MALWARE_REFUSED);
}));
