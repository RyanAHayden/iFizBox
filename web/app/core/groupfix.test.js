// B211: the app-group fix's plan (which groups an app's original signature asks for that the profile can't give, and
// where they go), its files for the tweak path, and the committed dylib it injects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { machoEntitlements, entitlementsRead, groupFixPlan, groupFixTweaks, withGroupFix, readConfig, GROUPFIX } from "./groupfix.js";
import { appEntitlements, plistXml } from "./websign.js";
import { parsePlist } from "./signing.js";
import { idOf, isMachO } from "./tweaks.js";

const INSTA = { "application-identifier": "OLDTEAM.com.burbn.instagram",
  "com.apple.security.application-groups": ["group.com.burbn.instagram", "group.com.burbn.shared"],
  "keychain-access-groups": ["OLDTEAM.com.burbn.instagram", "OLDTEAM.com.burbn.shared"] };

// A thin arm64 Mach-O with one LC_CODE_SIGNATURE whose superblob holds the entitlements' XML slot (5).
function signedMacho(ents, { fat = false } = {}) {
  const xml = Buffer.from(plistXml(ents));
  const ent = Buffer.alloc(8 + xml.length);
  ent.writeUInt32BE(0xfade7171, 0); ent.writeUInt32BE(ent.length, 4); xml.copy(ent, 8);
  const sb = Buffer.alloc(20 + ent.length);
  sb.writeUInt32BE(0xfade0cc0, 0); sb.writeUInt32BE(sb.length, 4); sb.writeUInt32BE(1, 8);
  sb.writeUInt32BE(5, 12); sb.writeUInt32BE(20, 16); ent.copy(sb, 20);
  const head = Buffer.alloc(0x1000);
  head.writeUInt32LE(0xfeedfacf, 0); head.writeUInt32LE(0x0100000c, 4); head.writeUInt32LE(2, 12);
  head.writeUInt32LE(1, 16); head.writeUInt32LE(16, 20);
  head.writeUInt32LE(0x1d, 32); head.writeUInt32LE(16, 36); head.writeUInt32LE(head.length, 40); head.writeUInt32LE(sb.length, 44);
  const thin = Buffer.concat([head, sb]);
  if (!fat) return new Uint8Array(thin);
  const fh = Buffer.alloc(0x4000);
  fh.writeUInt32BE(0xcafebabe, 0); fh.writeUInt32BE(1, 4);
  fh.writeUInt32BE(0x0100000c, 8); fh.writeUInt32BE(0, 12); fh.writeUInt32BE(fh.length, 16); fh.writeUInt32BE(thin.length, 20); fh.writeUInt32BE(14, 24);
  return new Uint8Array(Buffer.concat([fh, thin]));
}

test("machoEntitlements reads the original signature's XML slot, thin or fat; null when unsigned or not a Mach-O", () => {
  assert.deepEqual(machoEntitlements(signedMacho(INSTA)), INSTA);
  assert.deepEqual(machoEntitlements(signedMacho(INSTA, { fat: true })), INSTA);
  assert.equal(machoEntitlements(new Uint8Array(readFileSync(new URL("./fixtures/tweaks/app.macho", import.meta.url)))), null);
  assert.equal(machoEntitlements(new Uint8Array([1, 2, 3])), null);
  const bin = signedMacho(INSTA);
  const asked = [];
  assert.deepEqual(entitlementsRead((p, n) => { asked.push([p, n]); return bin.subarray(p, p + n); }), INSTA);
  assert.ok(asked.every(([, n]) => n <= 4096), "reads pieces, not the whole file");
});

test("groupFixPlan: the original's groups go to a folder of the app's own, whatever groups the profile has", () => {
  const withGroup = { "com.apple.security.application-groups": ["group.com.me.box"] };
  // legacy: the profile group the older rule picked, copied into the app's own folder once (an app signed that way)
  assert.deepEqual(groupFixPlan(INSTA, withGroup), { groups: ["group.com.burbn.instagram", "group.com.burbn.shared"], target: "", keychain: true, legacy: "group.com.me.box" });
  assert.deepEqual(groupFixPlan(INSTA, { "keychain-access-groups": ["T.*"] }), { groups: ["group.com.burbn.instagram", "group.com.burbn.shared"], target: "", keychain: true });
  // a group the profile has stays as it is
  assert.deepEqual(groupFixPlan(INSTA, { "com.apple.security.application-groups": ["group.com.burbn.shared"] }).groups, ["group.com.burbn.instagram"]);
  assert.deepEqual(groupFixPlan({ "keychain-access-groups": ["OLD.x"] }, {}), { groups: [], target: "", keychain: true });
  assert.equal(groupFixPlan({ "application-identifier": "OLD.x" }, withGroup), null, "nothing to fix");
  assert.equal(groupFixPlan(null, withGroup), null, "unsigned");
  // signed again: the executable now has the profile's groups, the config left by the first sign keeps the originals
  const previous = readConfig(groupFixTweaks(groupFixPlan(INSTA, {}), new Uint8Array(4)).files[1].data);
  assert.deepEqual(groupFixPlan({ "keychain-access-groups": ["T.com.burbn.instagram"] }, withGroup, previous),
    { groups: ["group.com.burbn.instagram", "group.com.burbn.shared"], target: "", keychain: true });
  assert.equal(readConfig(new Uint8Array([1, 2])), null);
});

test("groupFixPlan (B227): the same folder whatever the profile's groups or their order; an earlier profile group kept or reported lost", () => {
  const a = groupFixPlan(INSTA, { "com.apple.security.application-groups": ["group.x.1", "group.x.4", "group.x.2"] });
  const b = groupFixPlan(INSTA, { "com.apple.security.application-groups": ["group.x.2", "group.x.1"] });
  const none = groupFixPlan(INSTA, {});
  assert.equal(a.target, "");
  assert.equal(b.target, "");
  assert.equal(none.target, "");
  // an app an earlier (B211) sign mapped onto a profile group keeps it while the profile has it
  const was = { groups: ["group.com.burbn.instagram"], target: "group.x.1", keychain: true };
  assert.equal(groupFixPlan(INSTA, { "com.apple.security.application-groups": ["group.x.4", "group.x.1"] }, was).target, "group.x.1");
  const gone = groupFixPlan(INSTA, { "com.apple.security.application-groups": ["group.x.4"] }, was);
  assert.equal(gone.target, "");
  assert.equal(gone.lost, "group.x.1", "the folder iOS now keeps from the app is named, for a warning");
  // the config carries legacy for the dylib
  const cfg = readConfig(groupFixTweaks(a, new Uint8Array(4)).files[1].data);
  assert.equal(cfg.legacy, "group.x.1");
  assert.equal(readConfig(groupFixTweaks(none, new Uint8Array(4)).files[1].data).legacy, undefined);
});

test("machoEntitlements reads the first 64-bit slice of a fat armv7+arm64 file", () => {
  const thin = Buffer.from(signedMacho(INSTA));
  const v7 = Buffer.alloc(0x1000); v7.writeUInt32LE(0xfeedface, 0);
  const fh = Buffer.alloc(0x4000);
  fh.writeUInt32BE(0xcafebabe, 0); fh.writeUInt32BE(2, 4);
  fh.writeUInt32BE(12, 8); fh.writeUInt32BE(9, 12); fh.writeUInt32BE(0x4000, 16); fh.writeUInt32BE(v7.length, 20);
  fh.writeUInt32BE(0x0100000c, 28); fh.writeUInt32BE(0, 32); fh.writeUInt32BE(0x5000, 36); fh.writeUInt32BE(thin.length, 40);
  assert.deepEqual(machoEntitlements(new Uint8Array(Buffer.concat([fh, v7, thin]))), INSTA);
});

test("appEntitlements keeps the profile's own app groups (the fix maps the app's onto them)", () => {
  const ents = appEntitlements({ teamId: "T", entitlements: { "application-identifier": "T.*", "com.apple.security.application-groups": ["group.com.me.box"],
    "keychain-access-groups": ["T.*"] } }, "com.burbn.instagram");
  assert.deepEqual(ents["com.apple.security.application-groups"], ["group.com.me.box"]);
  assert.deepEqual(ents["keychain-access-groups"], ["T.com.burbn.instagram"]);
  // B227: an explicit App ID (every app under one ID): the keychain group named after the app's own, kept ID first
  const kept = appEntitlements({ teamId: "T", entitlements: { "application-identifier": "T.com.me.sideload", "keychain-access-groups": ["T.*", "com.apple.token"] } },
    "com.me.sideload", "com.burbn.instagram");
  assert.equal(kept["application-identifier"], "T.com.me.sideload");
  assert.deepEqual(kept["keychain-access-groups"], ["T.com.burbn.instagram", "T.com.me.sideload"]);
});

test("groupFixTweaks / withGroupFix: the dylib and its config under Frameworks/, injected after the user's tweaks", () => {
  const plan = groupFixPlan(INSTA, {});
  const dylib = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]);
  const t = groupFixTweaks(plan, dylib);
  assert.deepEqual(t.inject, ["@rpath/ifizbox-groupfix.dylib"]);
  assert.deepEqual(t.files.map((f) => f.path), ["Frameworks/ifizbox-groupfix.dylib", "Frameworks/ifizbox-groupfix.plist"]);
  assert.deepEqual(parsePlist(new TextDecoder().decode(t.files[1].data)), { groups: plan.groups, target: "", keychain: true });
  const user = { files: [{ path: "Frameworks/A.dylib", data: dylib }], inject: ["@rpath/A.dylib"], names: ["A.dylib"] };
  const both = withGroupFix(user, plan, dylib);
  assert.deepEqual(both.inject, ["@rpath/A.dylib", "@rpath/ifizbox-groupfix.dylib"]);
  assert.deepEqual(both.names, ["A.dylib"]);
  assert.equal(both.files.length, 3);
  assert.deepEqual(withGroupFix(null, plan, dylib).inject, ["@rpath/ifizbox-groupfix.dylib"]);
  assert.equal(withGroupFix(user, null, dylib), user, "no plan: unchanged");
  assert.equal(withGroupFix(null, plan, null), null, "no dylib: unchanged");
});

test("the committed fix dylib: an arm64 dylib under @rpath, built from the current native/groupfix/groupfix.m", () => {
  const bin = new Uint8Array(readFileSync(new URL(`../${GROUPFIX.file}`, import.meta.url)));
  assert.ok(isMachO(bin));
  assert.equal(idOf(bin), GROUPFIX.inject);
  const src = readFileSync(new URL("../../../native/groupfix/groupfix.m", import.meta.url));
  const built = readFileSync(new URL(`../${GROUPFIX.file}.source-sha256`, import.meta.url), "utf8").trim();
  assert.equal(built, createHash("sha256").update(src).digest("hex"), "groupfix.m changed: run native/groupfix/build.sh and commit the dylib");
  assert.ok(src.includes(`@"${GROUPFIX.config.split("/").pop()}"`), "the dylib reads the config the signers write");
  // B390: each launch's line for a report of lost sign-ins, kept out of the app's own preferences
  assert.ok(new TextDecoder("latin1").decode(bin).includes("Library/ifizbox-groupfix.log"), "the dylib logs each launch");
});
