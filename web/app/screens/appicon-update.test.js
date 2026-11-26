// B469: an update of Lite itself keeps the picked own icon ({ownIcon} on signing.install / signing.prepare).
import { test } from "node:test";
import assert from "node:assert/strict";
import { updateOwnIcon, withOwnIcon } from "./appicon.js";
import { prepareOnDevice } from "../signing/queue.js";
import { SELF_ID } from "../core/appqueue.js";

const reader = (o) => (k) => ({ iconMatch: false, lightIcon: "theme", darkIcon: "theme", ...o })[k];

test("the own icon an update keeps: the tone on screen's, else the other tone's", () => {
  const both = reader({ lightIcon: "owna1", darkIcon: "ownb2" });
  assert.equal(updateOwnIcon(both, "light"), "owna1");
  assert.equal(updateOwnIcon(both, "dark"), "ownb2");
  assert.equal(updateOwnIcon(reader({ darkIcon: "ownb2" }), "light"), "ownb2");
  assert.equal(updateOwnIcon(reader({ lightIcon: "owna1" }), "dark"), "owna1");
  assert.equal(updateOwnIcon(reader({}), "light"), null);
  // Matching the theme (iconMatch on) shows the theme's icon, whatever the picks say
  assert.equal(updateOwnIcon(reader({ iconMatch: true, lightIcon: "owna1" }), "light"), null);
});

test("withOwnIcon adds {ownIcon} only in Lite with an own icon picked", () => {
  const read = reader({ lightIcon: "owna1" });
  assert.deepEqual(withOwnIcon({ url: "https://x/a.ipa" }, { mode: "sideload", read, onScreen: "light" }), { url: "https://x/a.ipa", ownIcon: "owna1" });
  assert.deepEqual(withOwnIcon({ url: "u" }, { mode: "jailbreak", read, onScreen: "light" }), { url: "u" });
  assert.deepEqual(withOwnIcon({ url: "u" }, { mode: "sideload", read: reader({}), onScreen: "light" }), { url: "u" });
  assert.equal(withOwnIcon(null, { mode: "sideload", read }), null);
});

test("the queue's row for Lite itself sends {ownIcon} with signing.prepare; other apps don't", async () => {
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return { token: "t", bundleId: p.url }; } };
  const ownIcon = async (params) => ({ ...params, ownIcon: "owna1" });
  await prepareOnDevice({ id: SELF_ID, url: "https://x/self.ipa", name: "Self" }, { tag: "a", native, ownIcon });
  await prepareOnDevice({ id: "com.other.app", url: "https://x/other.ipa", name: "Other" }, { tag: "b", native, ownIcon });
  const prep = calls.filter(([m]) => m === "signing.prepare").map(([, p]) => p);
  assert.equal(prep.length, 2);
  assert.equal(prep[0].ownIcon, "owna1");
  assert.equal(prep[0].url, "https://x/self.ipa");
  assert.equal(prep[1].ownIcon, undefined);
});
