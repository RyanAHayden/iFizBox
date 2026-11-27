// B502a1b: a free Apple ID: Re-sign outside the app queue (signing.resign, signing.resignAll) makes a lapsed App ID
// again and hands its profile in before the shell signs.
import test from "node:test";
import assert from "node:assert/strict";
import { resignApp } from "./queue.js";
import { handFreeProfiles } from "./signed-apps.js";

const TEAM = "TEAM123456";
const APP = `com.a.${TEAM}`;
const status = { identity: { name: "C", profile: { team: TEAM, appId: `com.setup.${TEAM}`, free: true, wildcard: false } } };
const lapsed = [{ identifier: APP, appIdId: "OLD", expirationDate: "2000-01-01T00:00:00Z" }];

function rig({ st = status, teamId = TEAM, add = null } = {}) {
  const calls = [], made = [], ended = [];
  const native = { call: async (m, p) => {
    calls.push(m === "signing.addProfile" ? [m, Buffer.from(p.profile, "base64").toString()] : [m]);
    if (m === "signing.status") return st;
    if (m === "signing.installed") return { apps: [{ bundleId: APP, originalBundleId: "com.a", name: "A", appId: `${TEAM}.${APP}` }] };
    if (m === "signing.resign") return { done: [APP], failed: [] };
    return {};
  } };
  const portal = {
    listAppIds: async () => ({ appIds: lapsed }),
    addAppId: async (team, identifier) => { if (add) throw add; made.push(identifier); return { identifier, appIdId: `NEW-${identifier}` }; },
    downloadProfile: async (team, appIdId) => ({ encodedProfile: new TextEncoder().encode(appIdId) }),
  };
  const session = async () => ({ portal, teamId, end: () => ended.push(true) });
  return { native, session, calls, made, ended };
}
const names = (calls) => calls.map((c) => c[0]).filter((m) => m === "signing.addProfile" || m.startsWith("signing.resign"));
const sc = { getServer: () => "", chooseRoute: async () => ({ route: "idevice" }) };
const hud = () => ({ set() {}, done() {}, hide() {}, fail() {} });

test("B502a1b: signing.resign: the lapsed App ID is made and its profile handed in first", async () => {
  const r = rig();
  assert.equal(await resignApp({ id: APP, name: "A", mode: "resign" }, { sc, native: r.native, hud, session: r.session }), true);
  assert.deepEqual(r.made, [APP]);
  assert.deepEqual(names(r.calls), ["signing.addProfile", "signing.resign"]);
  assert.deepEqual(r.calls.find((c) => c[0] === "signing.addProfile"), ["signing.addProfile", `NEW-${APP}`]);
});

test("B502a1b: Re-sign All's App IDs and profiles; nothing without a free profile of the session's team", async () => {
  const r = rig();
  await handFreeProfiles(r.native, { session: r.session });
  assert.deepEqual(r.made, [APP]);
  assert.deepEqual(r.calls.at(-1), ["signing.addProfile", `NEW-${APP}`]);
  for (const other of [rig({ teamId: "OTHER00000" }), rig({ st: { identity: null } })]) {
    await handFreeProfiles(other.native, { session: other.session });
    assert.deepEqual(other.made, []);
    assert.deepEqual(names(other.calls), []);
  }
  const ended = rig({ add: Object.assign(new Error("ended"), { kind: "session" }) });
  await handFreeProfiles(ended.native, { session: ended.session });
  assert.equal(ended.ended.length, 1);
});
