// F436: the free route's computer install (screens/computer-install.js): the sign job it asks for, the code from the
// real Worker (worker/src/index.js on a KV in memory), and what the block shows.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { computerSections, computerInstallBlock, signForComputer, makeCode, setupCommands, resetComputerInstall, codeFooter,
  COMPUTER_LABEL, COMPUTER_FOOTER, COMPUTER_OFF_FOOTER, CODE_EXPIRED_FOOTER, CODE_MISSING_FOOTER, SAVE_IPA_FOOTER,
  recordKey, finishSetupLink, finishSetupSection, FINISH_LABEL, FINISH_FOOTER, phoneSetupOffered, phoneSetupCommand, PHONE_HEADER,
  PHONE_APPS_FOOTER, PHONE_LINE_FOOTER, PHONE_START_FOOTER, PHONE_SETUP_MARK, OPEN_MINIS_LINK } from "./computer-install.js";
import { VPN_APP_LINK } from "../core/installroute.js";
import { openRecord } from "../core/websign.js";
import { KEYS } from "../core/storagekeys.js";
import { uploadSigned } from "../signing/browser.js";
import { APP_IPA_URL } from "../core/appoffer.js";
import { fakeDocument, tick } from "../nav/fakedom.test-helper.js";
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

const memory = (init = {}) => {
  const kv = new Map(Object.entries(init));
  return { getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => kv.set(k, String(v)), removeItem: (k) => kv.delete(k) };
};

test("F460: Finish Setup opens ifizbox://free-id#<the kept key>, the same key for every install", async () => {
  const store = memory();
  assert.equal(finishSetupLink(store), null);
  assert.equal(finishSetupSection(store), null);
  const key = recordKey(store);
  assert.match(key, /^[A-Za-z0-9_-]{43}$/); // 256 bits, base64url
  assert.equal(recordKey(store), key);
  assert.equal(store.getItem(KEYS.freeidKey), key);
  assert.equal(finishSetupLink(store), `ifizbox://free-id#${key}`);
  assert.equal(new URL(finishSetupLink(store)).hash, `#${key}`, "in the fragment");
  assert.deepEqual(finishSetupSection(store).rows.map((r) => [r.label, r.href]), [[FINISH_LABEL, `ifizbox://free-id#${key}`]]);
  assert.throws(() => recordKey({ getItem: () => null, setItem() { throw new Error("quota"); } }), /Private Browsing/);
});

test("F460: the block shows Finish Setup once an install was made, also after a reload and with the profile expired", () => {
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    resetComputerInstall();
    const base = { id: {}, ask: async () => {}, save() {}, fix: { label: "Sign In Again", onClick() {} } };
    assert.doesNotMatch(computerInstallBlock({ ...base, store: memory() }).textContent, new RegExp(FINISH_LABEL));
    const store = memory();
    recordKey(store);
    assert.match(computerInstallBlock({ ...base, store }).textContent, new RegExp(FINISH_LABEL));
    assert.match(computerInstallBlock({ ...base, store, expired: true }).textContent, new RegExp(FINISH_LABEL));
  } finally { globalThis.document = saved; }
});

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
  // B474: the Free Apple ID record goes along, for the app's Signing page (free-apple-id.js adoptBundledFreeId)
  await signForComputer(id, { download: async () => PK, transfer: async () => null, record: { teamId: "T", serial: "AA" },
    worker: async (j) => { job = j; return { ipa: [PK], bundleId: SIGNED.bundleId }; } });
  assert.deepEqual(JSON.parse(job.bring.freeId), { teamId: "T", serial: "AA" });
  // F460: for the upload, the record sealed and no identity in the clear; never without a record to seal
  const key = recordKey(memory());
  await signForComputer(id, { download: async () => PK, transfer: async () => null, record: { teamId: "T", serial: "AA" }, sealKey: key,
    worker: async (j) => { job = j; return { ipa: [PK], bundleId: SIGNED.bundleId }; } });
  assert.deepEqual(Object.keys(job.bring), ["transfer", "sealedFreeId"]);
  assert.deepEqual(await openRecord(job.bring.sealedFreeId, key), { teamId: "T", serial: "AA" });
  await assert.rejects(signForComputer(id, { download: async () => PK, transfer: async () => null, sealKey: key,
    worker: async () => ({ ipa: [PK] }) }), /no Free Apple ID record/);
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
  assert.ok(doc.includes(phoneSetupCommand("<code>")), "the Open Minis line");
  for (const f of [COMPUTER_FOOTER, COMPUTER_OFF_FOOTER, CODE_EXPIRED_FOOTER, CODE_MISSING_FOOTER, SAVE_IPA_FOOTER, FINISH_FOOTER, codeFooter(0),
    PHONE_APPS_FOOTER, PHONE_LINE_FOOTER, PHONE_START_FOOTER,
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

test("F465b: offered on iOS 27 and later, only once the published setup script has Phone Setup", async () => {
  const { readFile } = await import("node:fs/promises");
  const script = await readFile(new URL("../../../tools/setup/install.sh.in", import.meta.url), "utf8");
  assert.ok(script.includes(PHONE_SETUP_MARK), "the script the next setup release publishes carries the mark");
  assert.equal(phoneSetupOffered("27.0", script), true);
  assert.equal(phoneSetupOffered("28", script), true);
  assert.equal(phoneSetupOffered("26.4", script), false);
  assert.equal(phoneSetupOffered(null, script), false);
  assert.equal(phoneSetupOffered("27.0", "#!/bin/sh\n# the published script from before Phone Setup\n"), false);
  assert.equal(phoneSetupCommand("ABCD-2345"), `wget -qO- https://${DOMAIN}/sign/setup.sh | sh -s -- ABCD-2345`);
});

test("F465b: the block shows Install Without a Computer beside the code, with Computer Install still there", async () => {
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  const base = { id: {}, ask: async () => {}, save() {}, fix: { label: "Sign In Again", onClick() {} }, store: memory() };
  const served = (text, ok = true) => {
    const asked = [];
    return Object.assign(async (url) => { asked.push(url); return { ok, text: async () => text }; }, { asked });
  };
  const show = async (o) => { const box = computerInstallBlock({ ...base, ...o }); await tick(); return box; };
  try {
    resetComputerInstall({ signed: SIGNED, code: "ABCD-2345", until: Date.now() + 60_000 });
    const fetcher = served(PHONE_SETUP_MARK);
    const box = await show({ ios: "27.0", fetcher });
    assert.deepEqual(fetcher.asked, ["/sign/setup.sh"]);
    for (const s of [PHONE_HEADER, "Get Open Minis", "Get LocalDevVPN", phoneSetupCommand("ABCD-2345"), PHONE_APPS_FOOTER,
      PHONE_LINE_FOOTER, ...setupCommands().map((c) => c.cmd)]) assert.ok(box.textContent.includes(s), s);
    assert.deepEqual(box.querySelectorAll("a.cell-inner").map((a) => a.href).filter((h) => h?.startsWith("https:")),
      [OPEN_MINIS_LINK, VPN_APP_LINK]);

    for (const [why, o] of [["iOS 26", { ios: "26.4", fetcher: served(PHONE_SETUP_MARK) }],
      ["the old published script", { ios: "27.0", fetcher: served("#!/bin/sh\n") }],
      ["no script published", { ios: "27.0", fetcher: served(PHONE_SETUP_MARK, false) }],
      ["offline", { ios: "27.0", fetcher: async () => { throw new TypeError("Load failed"); } }],
      ["an expired profile", { ios: "27.0", fetcher: served(PHONE_SETUP_MARK), expired: true }]]) {
      assert.ok(!(await show(o)).textContent.includes(PHONE_HEADER), why);
    }

    resetComputerInstall();
    const start = await show({ ios: "27.0", fetcher: served(PHONE_SETUP_MARK) });
    assert.ok(start.textContent.includes(PHONE_START_FOOTER));
    assert.ok(!start.textContent.includes(PHONE_HEADER), "no line without a code");
    assert.ok((await show({ ios: "26.4", fetcher: served(PHONE_SETUP_MARK) })).textContent.includes(COMPUTER_FOOTER));
  } finally {
    resetComputerInstall();
    globalThis.document = saved;
  }
});
