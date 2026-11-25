// F436: runSignJob's free option: a free Apple ID's profile signs with core/freeroute.js freeEntitlements, in the
// signature zsign makes (the real WebAssembly; the test profile allows get-task-allow and TESTTEAM42.* groups).
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { runSignJob } from "./websign-job.js";
import { afterOpen } from "./stream.test-helper.js";
import { parsePlist } from "./core/signing.js";
import { BUNDLE_ID } from "./brand.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`./core/fixtures/signing/${n}`, import.meta.url)));
const WASM = new URL("./vendor/zsign/zsign.js", import.meta.url);

async function sign(over) {
  const { default: real } = await import(WASM);
  let ents = null, identity = null, exe = null;
  const create = async (o) => {
    const zs = await real(o), main = zs.callMain;
    afterOpen(zs, () => {});
    zs.callMain = (args) => {
      ents = parsePlist(new TextDecoder().decode(zs.FS.readFile("/w/ents.plist")));
      try { identity = zs.FS.readFile("/w/app/Payload/Tiny.app/ifizbox-identity.plist"); } catch { /* none */ }
      try { return main(args); } finally { exe = Buffer.from(zs.FS.readFile("/w/app/Payload/Tiny.app/Tiny")).toString("latin1"); }
    };
    return zs;
  };
  const r = await runSignJob(create, { ipa: fx("tiny-ifizbox.ipa"), p12: fx("test.p12"), profile: fx("test.mobileprovision"), password: "hunter2",
    appBundleId: BUNDLE_ID, keepBundleId: false, bring: { identity: true, transfer: null }, ...over });
  return { r, ents, identity, exe };
}

test("free: get-task-allow, the app's own keychain group, no push, the identity inside", { skip: !existsSync(WASM) && "no vendor/zsign" }, async () => {
  const { r, ents, identity, exe } = await sign({ free: true });
  assert.equal(ents["get-task-allow"], true);
  assert.equal("aps-environment" in ents, false);
  assert.deepEqual(ents["keychain-access-groups"], [`TESTTEAM42.${BUNDLE_ID}`]);
  assert.ok(exe.includes("<key>get-task-allow</key><true/>"), "in the signed executable");
  assert.ok(identity?.length, "carries the certificate");
  assert.equal(r.bundleId, BUNDLE_ID);
});

test("without free the certificate route's entitlements stay: get-task-allow false", { skip: !existsSync(WASM) && "no vendor/zsign" }, async () => {
  assert.equal((await sign({})).ents["get-task-allow"], false);
});
