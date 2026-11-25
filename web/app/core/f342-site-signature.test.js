// F342: the website's install records keep the signature's end and the website signer's stamp, and Installed and
// Changes read them as the app reads signing.installed.
import { fakeStream } from "../stream.test-helper.js";
import { joinPieces } from "./pieces.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { WEB_SIGNER_VERSION, WEB_GROUPFIX_REVISION, webSignerStamp, webSignerNow, groupFixHash, signatureEnd } from "./websign.js";
import { parseProfile, needsResign, OLDER_SIGNER_TEXT } from "./signing.js";
import { appRecord, recordInstall, memoryAppStore, noteSiteSignature, takeSiteSignature, siteSignedApps, signatureOf,
  siteSignerNow, SITE_SIGNATURE_WAIT } from "./installed.js";
import { GROUPFIX } from "./groupfix.js";
import { runSignJob } from "../websign-job.js";
import { resignNow } from "../screens/changes.js";
import { withSignatures } from "../screens/installed.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/signing/${n}`, import.meta.url)));
const P12 = fx("test.p12"), PROFILE = fx("test.mobileprovision");
const DYLIB = new Uint8Array(readFileSync(new URL(`../${GROUPFIX.file}`, import.meta.url)));
const WASM = new URL("../vendor/zsign/zsign.js", import.meta.url);
const DAY = 86400000;

test("signatureEnd: the profile's expiry, or its certificates' latest end when earlier", () => {
  const p = parseProfile(PROFILE);
  const certEnd = Math.max(...p.certs.map((c) => c.notAfter.getTime()));
  const want = Math.min(p.expires.getTime(), certEnd);
  assert.equal(signatureEnd(PROFILE), new Date(want).toISOString());
  assert.equal(signatureEnd(new Uint8Array([1, 2, 3])), null);
});

test("groupFixHash: the first 16 hex digits of the dylib's SHA-256; the stamp carries it or null", async () => {
  const want = createHash("sha256").update(DYLIB).digest("hex").slice(0, 16);
  assert.equal(await groupFixHash(DYLIB), want);
  assert.equal(await groupFixHash(null), null);
  assert.deepEqual(webSignerStamp(want), { version: WEB_SIGNER_VERSION, groupFix: want, groupFixRevision: WEB_GROUPFIX_REVISION });
  assert.deepEqual(webSignerStamp(), { version: WEB_SIGNER_VERSION, groupFix: null, groupFixRevision: null });
});

test("the sign job returns its stamp and the signature's end", async () => {
  const files = new Map(), dirs = new Set(["/"]);
  const create = async () => ({
    FS: {
      mkdir: (p) => { if (dirs.has(p)) throw new Error("EEXIST"); dirs.add(p); },
      writeFile: (p, d) => files.set(p, d), readFile: (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); },
      unlink: (p) => files.delete(p), readdir: () => [".", "..", "Delta.app"],
    },
    ipaStream: fakeStream(),
    ccall: () => JSON.stringify({ CFBundleIdentifier: "io.github.x.delta", CFBundleName: "Delta" }),
    callMain: (args) => { return 0; },
  });
  const r = await runSignJob(create, { ipa: new Uint8Array([0x50, 0x4b, 3, 4]), p12: P12, profile: PROFILE, groupFix: DYLIB });
  assert.deepEqual(r.signer, { version: WEB_SIGNER_VERSION, groupFix: null, groupFixRevision: null }, "no fix injected: no hash");
  assert.equal(r.expires, signatureEnd(PROFILE));
});

test("an app that got the group fix carries the dylib's hash", { skip: !existsSync(WASM) && "no vendor/zsign" }, async () => {
  const { default: real } = await import(WASM);
  const base = { p12: P12, profile: PROFILE, password: "hunter2", groupFix: DYLIB };
  const first = await runSignJob(real, { ...base, ipa: fx("tiny-ifizbox.ipa"), appBundleId: "com.example.box" });
  assert.equal(first.signer.groupFix, null);
  const r = await runSignJob(real, { ...base, ipa: joinPieces(first.ipa), appBundleId: "com.example.box" });
  assert.deepEqual(r.injected, [GROUPFIX.inject]);
  assert.equal(r.signer.groupFix, await groupFixHash(DYLIB));
  assert.equal(r.signer.groupFixRevision, WEB_GROUPFIX_REVISION);
});

test("appRecord keeps a valid expiry and stamp, and leaves the shape alone without them", () => {
  const plain = appRecord({ id: "a", name: "A" }, 5);
  assert.equal("expires" in plain || "signer" in plain, false);
  const r = appRecord({ id: "a", expires: "2026-12-01T00:00:00Z", signer: { version: 1, groupFix: "abc" } }, 5);
  assert.equal(r.expires, "2026-12-01T00:00:00.000Z");
  assert.deepEqual(r.signer, { version: 1, groupFix: "abc" });
  assert.deepEqual(appRecord({ id: "a", signer: { version: 3, groupFix: "abc", groupFixRevision: 1 } }, 5).signer, { version: 3, groupFix: "abc", groupFixRevision: 1 });
  assert.deepEqual(signatureOf({ expires: "never", signer: { version: "x" } }), {});
  assert.deepEqual(appRecord(r, 9).signer, r.signer, "a record written again keeps them");
});

test("recordInstall takes the website's note for that app once, within the wait", async () => {
  const store = memoryAppStore();
  noteSiteSignature(["com.x.orig", "com.you.orig"], { expires: "2026-12-01T00:00:00Z", signer: { version: 1, groupFix: null } }, 1000);
  const rec = await recordInstall(store, { id: "com.x.orig", name: "X", version: "1" }, 2000);
  assert.equal(rec.expires, "2026-12-01T00:00:00.000Z");
  assert.deepEqual(rec.signer, { version: 1, groupFix: null });
  assert.equal(takeSiteSignature("com.you.orig", 2000), null, "used once, under every ID");
  const again = await recordInstall(store, { id: "com.x.orig", name: "X", version: "1" }, 3000);
  assert.equal(again.expires, rec.expires, "the same version written again (account sync) keeps it");
  const mark = await recordInstall(store, { id: "com.x.orig", name: "X", version: "2" }, 4000);
  assert.equal("expires" in mark, false, "another version marked as installed knows no signature");
  noteSiteSignature("synced", { expires: "2026-12-01T00:00:00Z" }, 5000);
  const synced = await recordInstall(store, { id: "synced", version: "1" }, 10);
  assert.equal("expires" in synced, false, "a record dated before the sign doesn't take it");
  assert.equal((await recordInstall(store, { id: "synced", version: "1" }, 6000)).expires, "2026-12-01T00:00:00.000Z");
  noteSiteSignature("late", { expires: "2026-12-01T00:00:00Z" }, 0);
  assert.equal(takeSiteSignature("late", SITE_SIGNATURE_WAIT + 1), null, "too old");
  noteSiteSignature("none", { expires: null }, 0);
  assert.equal(takeSiteSignature("none", 1), null);
});

const now = new Date("2026-11-21T12:00:00Z");
const records = [
  { id: "fresh", name: "Fresh", version: "1", expires: new Date(now.getTime() + 30 * DAY).toISOString(), signer: { version: WEB_SIGNER_VERSION, groupFix: null } },
  { id: "soon", name: "Soon", version: "2", expires: new Date(now.getTime() + DAY / 2).toISOString(), signer: { version: WEB_SIGNER_VERSION, groupFix: null } },
  { id: "oldfix", name: "Old Fix", version: "3", expires: new Date(now.getTime() + 30 * DAY).toISOString(), signer: { version: WEB_SIGNER_VERSION, groupFix: "0000" } },
  { id: "oldver", name: "Old Version", version: "4", expires: new Date(now.getTime() + 30 * DAY).toISOString(), signer: { version: 0, groupFix: null } },
  { id: "marked", name: "Marked", version: "5" },
  { id: "com.ryha.ifizbox", name: "iFizBox", version: "9", self: true, expires: new Date(now.getTime() + DAY / 2).toISOString() },
];

test("siteSignedApps: only records with the website's signature, in signing.installed's shape", () => {
  const s = siteSignedApps(records, { version: 1, groupFix: "ffff" });
  assert.deepEqual(s.apps.map((a) => a.bundleId), ["fresh", "soon", "oldfix", "oldver"]);
  assert.deepEqual(s.signer, { version: 1, groupFix: "ffff" });
});

test("Needs Re-sign on the website: expiring apps and ones an older website signer signed", async () => {
  const current = webSignerNow();
  const rows = needsResign(siteSignedApps(records, current), { now, window: 2 });
  assert.deepEqual(rows.map((r) => r.id).sort(), ["oldfix", "oldver", "soon"]);
  assert.equal(rows.find((r) => r.id === "oldver").short, OLDER_SIGNER_TEXT);
  const site = await resignNow({ available: [{ id: "soon" }] }, { mode: "site", now, get: () => 2, records: async () => records, signer: async () => current });
  assert.deepEqual(site.map((r) => r.id).sort(), ["oldfix", "oldver"], "an app with an upgrade is left to it");
  assert.deepEqual(await resignNow(null, { mode: "site", records: async () => { throw new Error("no db"); }, signer: async () => current }), []);
});

test("Installed on the website: days left from the record, no '?' for the others", () => {
  const rows = records.map((r) => ({ ...r }));
  const { rows: out, extra } = withSignatures(rows, siteSignedApps(records), { now, window: 2 });
  assert.equal(out.find((r) => r.id === "soon").sig.state, "soon");
  assert.equal(out.find((r) => r.id === "fresh").sig.state, "ok");
  assert.equal(out.find((r) => r.id === "marked").sig, undefined);
  assert.deepEqual(extra, []);
});

test("siteSignerNow: the version, the dylib's revision and each version's reach", async () => {
  const stamp = await siteSignerNow();
  assert.deepEqual(stamp, webSignerNow());
  assert.deepEqual([...stamp.reach.all, ...stamp.reach.groupFix].sort((a, b) => a - b), Array.from({ length: WEB_SIGNER_VERSION }, (_, i) => i + 1));
  const swift = readFileSync(new URL("../../../native/sign/SignerStamp.swift", import.meta.url), "utf8");
  assert.equal(WEB_GROUPFIX_REVISION, Number(/static let groupFixRevision = (\d+)/.exec(swift)[1]), "the app's signer injects the same dylib");
});

test("B458: a website record lists only for a marked change, and leaves the list once re-signed", async () => {
  const current = webSignerNow();
  const far = new Date(now.getTime() + 30 * DAY).toISOString();
  const ids = async (store) => needsResign(siteSignedApps(await store.all(), current), { now, window: 2 }).map((r) => r.id);
  const store = memoryAppStore();
  await recordInstall(store, { id: "kept", version: "1", expires: far, signer: { version: 3, groupFix: "496d0525dc08812d" } }, 1);
  await recordInstall(store, { id: "other", version: "1", expires: far, signer: { version: 3, groupFix: "0000" } }, 1);
  await recordInstall(store, { id: "rebuilt", version: "1", expires: far, signer: webSignerStamp("cccc") }, 1);
  assert.deepEqual(await ids(store), ["other"]);
  noteSiteSignature("other", { expires: far, signer: webSignerStamp("dddd") }, 2);
  await recordInstall(store, { id: "other", version: "1" }, 3);
  assert.deepEqual(await ids(store), []);
});
