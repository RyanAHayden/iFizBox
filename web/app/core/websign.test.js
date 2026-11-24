// F93: the website signer's rules (core/websign.js), the old server signer's, in JS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { profileInfo, targetBundleId, appEntitlements, originalDataProtection, keychainGroups, plistXml, identityPlist, zsignArgs, zsignError, appInfo, isZip } from "./websign.js";
import { parsePlist } from "./signing.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/signing/${n}`, import.meta.url)));

test("the profile's app ID, team and entitlements", () => {
  const p = profileInfo(fx("test.mobileprovision"));
  assert.equal(p.appId, "*");
  assert.equal(p.teamId, "TESTTEAM42");
  assert.equal(p.entitlements["application-identifier"], "TESTTEAM42.*");
  assert.throws(() => profileInfo(new Uint8Array([1, 2, 3])), /not a provisioning profile/);
});

test("the bundle ID an app is signed as", () => {
  assert.equal(targetBundleId("*", "io.github.x.delta"), "io.github.x.delta");
  assert.equal(targetBundleId("com.you.*", "com.you.delta"), "com.you.delta");
  assert.equal(targetBundleId("com.you.*", "io.github.fizl0.openmx"), "com.you.openmx");
  assert.equal(targetBundleId("com.you.app", "io.github.x.delta"), "com.you.app");
  assert.throws(() => targetBundleId("", "a.b"), (e) => e.code === "bad_profile");
});

test("entitlements narrowed to the app, never debuggable", () => {
  const e = appEntitlements({ teamId: "T1", entitlements: { "application-identifier": "T1.*", "keychain-access-groups": ["T1.*"], "get-task-allow": true, "aps-environment": "development" } }, "com.you.delta");
  assert.deepEqual(e, { "application-identifier": "T1.com.you.delta", "keychain-access-groups": ["T1.com.you.delta"], "get-task-allow": false, "aps-environment": "development" });
  assert.equal(appEntitlements({ entitlements: { "com.apple.developer.team-identifier": "T2" } }, "a.b")["application-identifier"], "T2.a.b");
});

test("appEntitlements (B413): the profile's data protection only when the app's original signature asked for the same", () => {
  const K = "com.apple.developer.default-data-protection";
  const prof = { teamId: "T", entitlements: { "application-identifier": "T.*", [K]: "NSFileProtectionComplete" } };
  const COMPLETE = "NSFileProtectionComplete", UNTIL = "NSFileProtectionCompleteUntilFirstUserAuthentication";
  const signed = (original, before = false, p = prof) => appEntitlements(p, "a.b", "a.b", originalDataProtection(original, p, before))[K];
  const app = (v) => ({ "application-identifier": "OLD.a.b", ...(v ? { [K]: v } : {}) });
  assert.equal(signed(null), undefined, "unsigned");
  assert.equal(signed(app()), undefined, "no original value");
  assert.equal(signed(app(UNTIL)), undefined, "the profile doesn't allow UntilFirstUserAuthentication");
  assert.equal(signed(app(COMPLETE)), COMPLETE);
  const until = { teamId: "T", entitlements: { [K]: UNTIL } };
  assert.equal(signed(app(UNTIL), false, until), UNTIL);
  assert.equal(signed(app(COMPLETE), false, until), undefined);
  assert.equal(signed(app(COMPLETE), false, { teamId: "T", entitlements: {} }), undefined, "a profile without it");
  assert.equal(signed(app(COMPLETE), true), undefined, "signed here before: the profile's value, not the app's");
  assert.equal(signed({ ...app(COMPLETE), "application-identifier": "T.a.b" }), undefined, "signed under the profile's team before");
});

test("keychainGroups (B227): the app's own ID first when the profile allows it, the App ID's group after", () => {
  assert.deepEqual(keychainGroups(["T.*", "com.apple.token"], "T", "com.me.sideload", "com.burbn.instagram"), ["T.com.burbn.instagram", "T.com.me.sideload"]);
  assert.deepEqual(keychainGroups(["T.*"], "T", "com.you.delta", "com.you.delta"), ["T.com.you.delta"]);
  assert.deepEqual(keychainGroups(["T.com.me.*"], "T", "com.me.sideload", "com.burbn.instagram"), ["T.com.me.sideload"], "not allowed: as before");
  assert.deepEqual(keychainGroups(["T.com.burbn.instagram"], "T", "com.me.sideload", "com.burbn.instagram"), ["T.com.burbn.instagram", "T.com.me.sideload"]);
  assert.deepEqual(keychainGroups(undefined, "T", "a.b", "c.d"), ["T.a.b"]);
});

test("XML plists read back (core/signing.js parsePlist), data and escapes included", () => {
  const v = { s: "a & <b>", n: 3, r: 1.5, t: true, f: false, a: ["x", 2], d: new Uint8Array([0, 255, 7]), o: {} };
  assert.deepEqual(parsePlist(plistXml(v)), v);
  const id = parsePlist(identityPlist({ p12: new Uint8Array([1, 2]), password: "pw", profile: new Uint8Array([3]) }));
  assert.deepEqual(id, { p12: new Uint8Array([1, 2]), password: "pw", profile: new Uint8Array([3]) });
});

test("zsign's command line; its errors as one sentence", () => {
  assert.deepEqual(zsignArgs({ p12: "k", password: "", profile: "m", input: "in", output: "o", temp: "t" }),
    ["-f", "-k", "k", "-p", "", "-m", "m", "-t", "t", "-z", "1", "-o", "o", "in"]);
  assert.deepEqual(zsignArgs({ p12: "k", profile: "m", entitlements: "e", bundleId: "a.b", input: "in", output: "o", temp: "t" }).slice(-5),
    ["-b", "a.b", "-e", "e", "in"]);
  assert.equal(zsignError([">>> Signing: x", "\x1b[31m>>> Invalid mach-o file!\x1b[0m"]), "zsign: Invalid mach-o file.");
  assert.match(zsignError(["\x1b[31m>>> Can't load p12 or private key file. Please input the correct file and password!"]), /password/);
  assert.equal(zsignError([]), "zsign stopped without saying why.");
});

test("an app's name, version and ID from its Info.plist; zip check", () => {
  assert.deepEqual(appInfo({ CFBundleIdentifier: "a.b", CFBundleName: "B", CFBundleVersion: "7" }), { bundleId: "a.b", name: "B", version: "7" });
  assert.deepEqual(appInfo({ CFBundleIdentifier: "a.b", CFBundleDisplayName: "Bee", CFBundleShortVersionString: "1.2", CFBundleVersion: "7" }), { bundleId: "a.b", name: "Bee", version: "1.2" });
  assert.throws(() => appInfo({}), (e) => e.code === "bad_ipa");
  assert.equal(isZip(new Uint8Array([0x50, 0x4b, 3, 4])), true);
  assert.equal(isZip(new Uint8Array([0x50])), false);
});

test("zsignError: OpenSSL's mac verify failure says the password is wrong", () => {
  assert.match(zsignError(["01000000:error:11800071:PKCS12 routines:PKCS12_parse:mac verify failure:crypto/pkcs12/p12_kiss.c:71:",
    "\x1b[31m>>> Can't load p12 or private key file. Please input the correct file and password!"]), /password is wrong/);
});
