// B327: every sign logs the keychain groups the app gets (in order: new items go to the first) and the group fix
// config it got, or why none, in the same words as the app's signer (native/sign/Profile.swift keychainLine,
// GroupFix.swift logLine), so a report of an app that lost its data can be read from the log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupFixPlan, groupFixLogLine } from "./groupfix.js";
import { appEntitlements, keychainLogLine } from "./websign.js";

const INSTA = { "application-identifier": "OLDTEAM.com.burbn.instagram",
  "com.apple.security.application-groups": ["group.com.burbn.instagram"],
  "keychain-access-groups": ["OLDTEAM.com.burbn.instagram"] };

test("B327: the keychain line names every group in order and the application-identifier", () => {
  const ents = appEntitlements({ entitlements: { "keychain-access-groups": ["T.*"] }, teamId: "T" }, "com.me.sideload", "com.burbn.instagram");
  assert.equal(keychainLogLine(ents), "Keychain: T.com.burbn.instagram, T.com.me.sideload (application-identifier T.com.me.sideload)");
  assert.equal(keychainLogLine({}), "Keychain: no keychain groups (application-identifier none)");
});

test("B327: the group fix line names the whole config, or why there is none", () => {
  const plan = groupFixPlan(INSTA, { "com.apple.security.application-groups": ["group.com.me.box"] });
  assert.equal(groupFixLogLine(plan),
    "Group fix: group.com.burbn.instagram -> the app's own folder; keychain groups stripped; group.com.me.box copied in once if the app ran before");
  assert.equal(groupFixLogLine({ groups: [], target: "group.com.me.box", keychain: false }), "Group fix: no app groups -> group.com.me.box");
  assert.equal(groupFixLogLine(null), "Group fix: none (the original signature names no app groups or keychain groups)");
  assert.equal(groupFixLogLine(null, "no fix dylib"), "Group fix: none (no fix dylib)");
});

// B327 cause (iPhone 15 Pro, tools/resignprobe): every app under one App ID can reach TEAM.<App ID>, where apps signed
// before B227 left their items and where a group-less read finds another app's. A second app's group-less delete
// there (a fresh install clearing its keychain) wiped the first app's items: signed out. Every app signed with its
// own keychain group first now gets the fix with `isolate`, so its passwords stay in that group alone.
test("B327: an app with its own keychain group is isolated, even when the original names no groups", () => {
  const ents = appEntitlements({ entitlements: { "keychain-access-groups": ["T.*"] }, teamId: "T" }, "com.me.sideload", "com.google.ios.youtube");
  const kc = ents["keychain-access-groups"];
  const plain = groupFixPlan({ "application-identifier": "OLD.com.google.ios.youtube" }, {}, null, kc);
  assert.deepEqual(plain, { groups: [], target: "", keychain: false, isolate: "T.com.google.ios.youtube" });
  assert.equal(groupFixPlan(INSTA, {}, null, kc).isolate, "T.com.google.ios.youtube");
  assert.match(groupFixLogLine(plain), /passwords kept in T\.com\.google\.ios\.youtube, the shared groups' copied in once if the app ran before$/);
  // one group (a wildcard App ID, or a profile that can't name the app's own): nothing to isolate from
  assert.equal(groupFixPlan({}, {}, null, ["T.com.me.sideload"]), null);
});

test("B327: the config the dylib reads carries isolate", async () => {
  const { groupFixTweaks, readConfig, GROUPFIX } = await import("./groupfix.js");
  const t = groupFixTweaks({ groups: [], target: "", keychain: false, isolate: "T.a" }, new Uint8Array([1]));
  const c = readConfig(t.files.find((f) => f.path === GROUPFIX.config).data);
  assert.equal(c.isolate, "T.a");
});
