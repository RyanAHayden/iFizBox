// F436: the free route's computer install (screens/computer-install.js): the sign job it asks for, the code from the
// real Worker (worker/src/index.js on a KV in memory), and what the block shows.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { computerSections, computerInstallBlock, signForComputer, makeCode, setupCommands, resetComputerInstall, codeFooter,
  COMPUTER_LABEL, COMPUTER_FOOTER, COMPUTER_OFF_FOOTER, CODE_EXPIRED_FOOTER, CODE_MISSING_FOOTER, SAVE_IPA_FOOTER } from "./computer-install.js";
import { uploadSigned } from "../signing/browser.js";
import { APP_IPA_URL } from "../core/appoffer.js";
import { fakeDocument } from "../nav/fakedom.test-helper.js";
import { DOMAIN, BUNDLE_ID } from "../brand.js";
import worker from "../../../worker/src/index.js";

const PK = Uint8Array.of(0x50, 0x4b, 3, 4, 9, 9);
const SIGNED = { data: PK, bundleId: `${BUNDLE_ID}.T1`, name: "App", version: "1.2" };

function site() {
  const kv = new Map();
  const bytes = async (v) => new Uint8Array(await new Response(v).arrayBuffer());
  const env = { TTL: "600", MAX_UPLOAD_MB: "512", HOSTED: {
    put: async (k, v, o = {}) => { kv.set(k, { v: await bytes(v), m: o.metadata ?? null }); },
    get: async (k) => kv.get(k)?.v ?? null,
    getWithMetadata: async (k) => ({ value: kv.has(k) ? new Response(kv.get(k).v).body : null, metadata: kv.get(k)?.m ?? null }),
    delete: async (k) => { kv.delete(k); },
  } };
  return (path, init) => worker.fetch(new Request(`https://${DOMAIN}${path}`, init), env, { waitUntil() {} });
}

test("signForComputer: the release's IPA with the free identity inside, under the profile's ID", async () => {
  const id = { p12: Uint8Array.of(1), profile: Uint8Array.of(2), password: "pw" };
  let job = null, asked = null;
  const r = await signForComputer(id, { download: async (u) => { asked = u; return PK; }, transfer: async () => "ifizbox://import?d=1",
    worker: async (j) => { job = j; return { ipa: [PK.slice(0, 2), PK.slice(2)], bundleId: SIGNED.bundleId, name: "App", version: "1.2" }; } });
  assert.equal(asked, APP_IPA_URL);
  assert.deepEqual([job.free, job.keepBundleId, job.appBundleId, job.password], [true, false, BUNDLE_ID, "pw"]);
  assert.deepEqual(job.bring, { identity: true, transfer: "ifizbox://import?d=1" });
  assert.deepEqual([...new Uint8Array(job.p12), ...new Uint8Array(job.profile)], [1, 2]);
  assert.equal(id.p12.length, 1, "the identity isn't handed over (transferred) itself");
  assert.deepEqual(r, SIGNED);
});

test("makeCode: uploads, and the Worker's code reads back this IPA, its hash and the pairing file's place", async () => {
  const go = site();
  const upload = (b, s, o) => uploadSigned(b, s, { ...o, fetcher: go });
  const { code, until } = await makeCode(SIGNED, { upload, fetcher: go, now: () => 1000 });
  assert.match(code, /^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  assert.ok(until > 1000 && until <= 1000 + 600000);
  const got = await (await go(`/sign/setup/${code}`)).json();
  assert.equal(got.sha256, createHash("sha256").update(PK).digest("hex"));
  assert.deepEqual([got.bundleId, got.size, got.pairing.bundleId], [SIGNED.bundleId, PK.length, SIGNED.bundleId]);
});

test("makeCode: the Worker's own words when it refuses, and no connection", async () => {
  const upload = async () => ({ manifest: `https://x/sign/up/${"a".repeat(48)}/manifest.plist` });
  await assert.rejects(makeCode(SIGNED, { upload, fetcher: site() }), /That upload has expired/);
  await assert.rejects(makeCode(SIGNED, { upload, fetcher: async () => { throw new TypeError("Load failed"); } }), /no connection/);
  await assert.rejects(makeCode(SIGNED, { upload: async () => ({}), fetcher: site() }), /didn't say/);
});

test("computerSections: off, start, code, expired, and signed with no code", () => {
  const s = (o, now = 0) => { const r = computerSections(o, now); return [r.stage, r.footer]; };
  assert.deepEqual(s({ expired: true, signed: SIGNED, code: "X", until: 9 }), ["off", COMPUTER_OFF_FOOTER]);
  assert.deepEqual(s({}), ["start", COMPUTER_FOOTER]);
  assert.deepEqual(s({ signed: SIGNED, code: "X", until: 9 }, 8), ["code", codeFooter(9)]);
  assert.deepEqual(s({ signed: SIGNED, code: "X", until: 9 }, 9), ["expired", CODE_EXPIRED_FOOTER]);
  assert.deepEqual(s({ signed: SIGNED }), ["expired", CODE_MISSING_FOOTER]);
});

test("the one-liners are docs/sideload.md's, and every footer is one or two short sentences", async () => {
  const { readFile } = await import("node:fs/promises");
  const doc = await readFile(new URL("../../../docs/sideload.md", import.meta.url), "utf8");
  for (const c of setupCommands()) assert.ok(doc.includes(c.cmd), c.cmd);
  for (const f of [COMPUTER_FOOTER, COMPUTER_OFF_FOOTER, CODE_EXPIRED_FOOTER, CODE_MISSING_FOOTER, SAVE_IPA_FOOTER, codeFooter(0),
    ...setupCommands().map((c) => c.footer)]) {
    assert.ok(f.length <= 140 && f.split(/(?<=[.!?])\s+/).length <= 2, f);
  }
});

test("the block: the button, or the row that renews the profile in its place", () => {
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    resetComputerInstall();
    const base = { id: {}, ask: async () => {}, save() {}, fix: { label: "Sign In Again", onClick() {} } };
    const on = computerInstallBlock(base);
    assert.match(on.textContent, new RegExp(COMPUTER_LABEL));
    const off = computerInstallBlock({ ...base, expired: true });
    assert.match(off.textContent, /Sign In Again/);
    assert.doesNotMatch(off.textContent, new RegExp(COMPUTER_LABEL));
  } finally { globalThis.document = saved; }
});
