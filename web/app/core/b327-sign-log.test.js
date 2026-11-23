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
