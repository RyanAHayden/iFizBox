// B502a1: a free Apple ID's apps each get an App ID and profile of their own before the app queue signs them.
import test from "node:test";
import assert from "node:assert/strict";
import { withOwnAppId, pinnedProfile, openFreeGroup, SHOW_TRIES, SIGN_IN_ROW, SIGN_IN_TITLE } from "./freeappid.js";
import { freeIdPath } from "../screens/settings.js";
import { prepareOnDevice } from "./queue.js";
import { b64encode } from "../core/gsa.js";

const TEAM = "TEAM123456";
const HELD = `com.setup.app.${TEAM}`;
const status = (profile = {}) => ({ identity: { name: "C", profile: { team: TEAM, appId: HELD, free: true, wildcard: false, ...profile } } });

function shell({ st = status(), apps = [], prepare = null } = {}) {
  const calls = [];
  return { calls, call: async (m, p) => {
    calls.push([m, p]);
    if (m === "signing.status") return st;
    if (m === "signing.installed") return { apps };
    if (m === "signing.addProfile") return { appId: "x", expires: null };
    if (m === "signing.prepare") return prepare ? prepare(p) : { token: "t", bundleId: `com.a.${TEAM}`, originalBundleId: "com.a" };
    return {};
  } };
}
function portal(existing = [], { add = null } = {}) {
  const made = [];
  return { made,
    listAppIds: async () => ({ appIds: existing }),
    addAppId: async (team, identifier) => { if (add) add(); made.push(identifier); return { appIdId: `id-${identifier}`, identifier }; },
    downloadProfile: async (team, appIdId) => ({ encodedProfile: new TextEncoder().encode(appIdId) }),
  };
}
const session = (p, extra = {}) => async () => ({ portal: p, teamId: TEAM, ...extra });
const handed = (n) => n.calls.filter(([m]) => m === "signing.addProfile").map(([, p]) => p.profile);
const profileOf = (id) => b64encode(new TextEncoder().encode(`id-${id}`));
const taken = () => Object.assign(new Error("app_id_taken: no"), { code: "app_id_taken" });

test("pinnedProfile: only a free profile for one app", async () => {
  assert.deepEqual(await pinnedProfile(shell()), { team: TEAM, appId: HELD });
  assert.equal(await pinnedProfile(shell({ st: status({ free: false }) })), null);
  assert.equal(await pinnedProfile(shell({ st: status({ wildcard: true }) })), null);
  assert.equal(await pinnedProfile(shell({ st: { identity: null } })), null);
});

test("two apps get an App ID and profile each, handed in before they sign", async () => {
  const n = shell(), p = portal();
  const order = [];
  for (const id of ["com.a", "com.b"]) {
    await withOwnAppId({ id, name: id }, { url: "u" }, async () => { order.push(handed(n).length); return { token: id, originalBundleId: id, bundleId: `${id}.${TEAM}` }; },
      { native: n, session: session(p) });
  }
  assert.deepEqual(p.made, [`com.a.${TEAM}`, `com.b.${TEAM}`]);
  assert.deepEqual(handed(n), [profileOf(`com.a.${TEAM}`), profileOf(`com.b.${TEAM}`)]);
  assert.deepEqual(order, [1, 2]);
});

test("a listed App ID is reused, a typed bundle ID names it, a queued Re-sign renews the installed one", async () => {
  const have = { appIdId: `id-com.a.${TEAM}`, identifier: `com.a.${TEAM}` };
  const sign = async () => ({ token: "t" });
  let n = shell(), p = portal([have]);
  await withOwnAppId({ id: "com.a" }, { url: "u" }, sign, { native: n, session: session(p) });
  assert.deepEqual(p.made, []);
  assert.equal(handed(n).length, 1);
  n = shell(); p = portal();
  await withOwnAppId({ id: "com.a" }, { url: "u", bundleId: "me.typed" }, sign, { native: n, session: session(p) });
  assert.deepEqual(p.made, [`me.typed.${TEAM}`]);
  n = shell(); p = portal();
  await withOwnAppId({ id: `com.a.${TEAM}` }, { record: `com.a.${TEAM}` }, sign, { native: n, session: session(p) });
  assert.deepEqual(p.made, [`com.a.${TEAM}`]);
  n = shell(); p = portal();
  await withOwnAppId({ id: "com.old" }, { record: "com.old" }, sign, { native: n, session: session(p) });
  assert.deepEqual([p.made, handed(n)], [[], []]);
});

test("no App ID is spent on an app already under the held one, on another team or without a free profile", async () => {
  const sign = async () => ({ token: "t", originalBundleId: "com.a", bundleId: HELD });
  let p = portal();
  await withOwnAppId({ id: "com.a" }, { url: "u" }, sign, { native: shell({ apps: [{ bundleId: HELD, originalBundleId: "com.a" }] }), session: session(p) });
  assert.deepEqual(p.made, []);
  p = portal();
  await withOwnAppId({ id: "com.a" }, { url: "u" }, sign, { native: shell(), session: async () => ({ portal: p, teamId: "OTHER00000" }) });
  assert.deepEqual(p.made, []);
  p = portal();
  await withOwnAppId({ id: "com.a" }, { url: "u" }, sign, { native: shell({ st: status({ free: false }) }), session: session(p) });
  assert.deepEqual(p.made, []);
});

test("the IPA's bundle ID isn't the listed one: its App ID, and signed again", async () => {
  const n = shell(), p = portal(), dropped = [];
  let signs = 0;
  const r = await withOwnAppId({ id: "row.name" }, { url: "u" }, async () => ({ token: `t${++signs}`, originalBundleId: "com.real", bundleId: HELD }),
    { native: n, session: session(p), discard: (t) => dropped.push(t) });
  assert.deepEqual(p.made, [`row.name.${TEAM}`, `com.real.${TEAM}`]);
  assert.deepEqual([r.token, dropped], ["t2", ["t1"]]);
});

test("no session: app_id_taken shows one sign-in prompt, and Open is taken", async () => {
  const asked = [];
  let opened = 0, answer;
  const alert = (o) => { asked.push(o); return new Promise((ok) => { answer = ok; }); };
  const o = { native: shell(), session: async () => null, alert, go: () => { opened += 1; } };
  for (const id of ["com.a", "com.b"]) {
    await assert.rejects(withOwnAppId({ id }, { url: "u" }, async () => { throw taken(); }, o), { message: SIGN_IN_ROW, code: "app_id_taken" });
  }
  assert.deepEqual(asked.map((a) => a.title), [SIGN_IN_TITLE]);
  answer({ index: 1 });
  await new Promise((ok) => setImmediate(ok));
  assert.equal(opened, 1);
});

test("Open: the run's page goes, then the group's page opens and slides to the group", async () => {
  assert.deepEqual([freeIdPath(true), freeIdPath(false)], [["signing", "certificate"], ["signing"]]);
  for (const busy of [false, true]) {
    const did = [];
    const nav = { set hash(h) { did.push(h); } };
    let drawn = 0;
    const ok = await openFreeGroup({ nav, wait: async () => {}, path: () => freeIdPath(true), show: () => ++drawn === 3,
      runPage: () => ({ busy, putAside: () => did.push("aside"), dismiss: async () => did.push("closed") }) });
    assert.deepEqual([ok, drawn, did], [true, 3, [busy ? "aside" : "closed", "/home/settings/signing/certificate"]]);
  }
  let tries = 0;
  assert.equal(await openFreeGroup({ nav: {}, wait: async () => {}, runPage: () => null, path: () => ["signing"], show: () => { tries += 1; return false; } }), false);
  assert.equal(tries, SHOW_TRIES);
});

test("Apple's refusal is the row's reason; an ended session is dropped", async () => {
  const sign = async () => { throw taken(); };
  const limit = portal([], { add: () => { throw Object.assign(new Error("maximum App ID limit"), { code: 9401 }); } });
  await assert.rejects(withOwnAppId({ id: "com.a" }, { url: "u" }, sign, { native: shell(), session: session(limit) }), /10 App IDs a week/);
  let live = true;
  const gone = portal([], { add: () => { throw Object.assign(new Error("expired"), { kind: "session" }); } });
  await assert.rejects(withOwnAppId({ id: "com.a" }, { url: "u" }, sign, { native: shell(),
    session: async () => (live ? { portal: gone, teamId: TEAM, end: () => { live = false; } } : null) }), { message: SIGN_IN_ROW });
  assert.equal(live, false);
});

test("prepareOnDevice: with no session the queue's row fails with the sign-in reason", async () => {
  const n = shell({ prepare: () => { throw taken(); } });
  const asked = [];
  await assert.rejects(prepareOnDevice({ id: "com.a", name: "A", url: "https://q.example/a.ipa" },
    { tag: "a#1", native: n, alert: async (o) => { asked.push(o.title); return { index: 0 }; } }), { message: SIGN_IN_ROW });
  assert.deepEqual(asked, [SIGN_IN_TITLE]);
});
