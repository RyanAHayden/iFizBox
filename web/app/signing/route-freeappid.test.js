// B502a1a: an install outside the app queue (signing.install) gives a free Apple ID's app its own App ID first.
import test from "node:test";
import assert from "node:assert/strict";
import { installOnDevice, forgetRoute } from "./route.js";
import { SIGN_IN_ROW, SIGN_IN_TITLE } from "./freeappid.js";
import { STORAGE_KEY } from "../core/installroute.js";
import { b64encode } from "../core/gsa.js";

const TEAM = "TEAM123456";
const HELD = `com.setup.app.${TEAM}`;
const store = new Map([[STORAGE_KEY, "iphone"]]);
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
};

function shell({ free = true, install = null, inspect = null } = {}) {
  const calls = [];
  return { calls, call: async (m, p) => {
    calls.push([m, p]);
    if (m === "idevice.status") return { paired: true, vpn: { available: true } };
    if (m === "signing.status") return { identity: { name: "C", profile: { team: TEAM, appId: HELD, free, wildcard: false } } };
    if (m === "signing.installed") return { apps: [] };
    if (m === "signing.inspect") return inspect ? inspect(p) : { token: "look", app: { bundleId: "com.real", name: "Real" } };
    if (m === "signing.install") return install ? install(p) : { bundleId: `com.real.${TEAM}`, originalBundleId: "com.real" };
    return {};
  } };
}
function portal() {
  const made = [];
  return { made,
    listAppIds: async () => ({ appIds: [] }),
    addAppId: async (team, identifier) => { made.push(identifier); return { appIdId: `id-${identifier}`, identifier }; },
    downloadProfile: async (team, appIdId) => ({ encodedProfile: new TextEncoder().encode(appIdId) }),
  };
}
function page() {
  const h = { cancelled: false, failure: null, hidden: false, lines: [], cancels: [],
    set: () => {}, hide: () => { h.hidden = true; }, done: () => {}, finish: () => {}, fail: (m) => { h.failure = m; },
    onCancel: (f) => h.cancels.push(f), page: { raw: (l) => h.lines.push(l), step: () => {}, help: () => {} },
    tap: () => { h.cancelled = true; for (const f of h.cancels) f(); } };
  return h;
}
async function run(opts, { native, p = portal(), session, alert, go = () => {}, h = page() } = {}) {
  forgetRoute();
  const ok = await installOnDevice(opts, { native, hud: () => h, alert: alert ?? (async () => ({ index: 0 })), go,
    later: () => {}, follow: () => {}, session: session ?? (async () => ({ portal: p, teamId: TEAM })) });
  return { ok, p, h };
}
const sent = (n, method) => n.calls.filter(([m]) => m === method).map(([, p]) => p);
const order = (n) => n.calls.map(([m]) => m).filter((m) => ["signing.inspect", "signing.addProfile", "signing.install"].includes(m));
const profileOf = (id) => b64encode(new TextEncoder().encode(`id-${id}`));
const taken = () => Object.assign(new Error("app_id_taken: no"), { code: "app_id_taken" });

test("plain Install: the IPA's own bundle ID gets an App ID and profile before signing.install, once", async () => {
  const n = shell();
  const { ok, p } = await run({ url: "https://e.example/a.ipa", name: "A" }, { native: n });
  assert.equal(ok, true);
  assert.deepEqual(p.made, [`com.real.${TEAM}`]);
  assert.deepEqual(order(n), ["signing.inspect", "signing.addProfile", "signing.install"]);
  assert.equal(sent(n, "signing.addProfile")[0].profile, profileOf(`com.real.${TEAM}`));
  const [install] = sent(n, "signing.install");
  assert.deepEqual([install.token, install.url], ["look", undefined]);
});

test("Install a Copy: its choices go with the look's token", async () => {
  const n = shell();
  await run({ url: "https://e.example/a.ipa", name: "A", params: { url: "https://e.example/a.ipa", keepBundleId: false } }, { native: n });
  const [install] = sent(n, "signing.install");
  assert.deepEqual([install.token, install.keepBundleId], ["look", false]);
});

test("Custom Install: the sheet's token isn't looked at again; a typed bundle ID names the App ID", async () => {
  let n = shell();
  let r = await run({ url: "https://e.example/a.ipa", name: "A", bundleId: "com.sheet", params: { token: "t" } }, { native: n });
  assert.deepEqual(r.p.made, [`com.sheet.${TEAM}`]);
  assert.deepEqual(order(n), ["signing.addProfile", "signing.install"]);
  n = shell();
  r = await run({ url: "https://e.example/a.ipa", name: "A", bundleId: "com.sheet", params: { token: "t", bundleId: "me.typed" } }, { native: n });
  assert.deepEqual(r.p.made, [`me.typed.${TEAM}`]);
  assert.equal(sent(n, "signing.install").length, 1);
});

test("no free profile: no look, no App ID, the url is installed", async () => {
  const n = shell({ free: false });
  const { p } = await run({ url: "https://e.example/a.ipa", name: "A" }, { native: n });
  assert.deepEqual(p.made, []);
  assert.deepEqual(order(n), ["signing.install"]);
  assert.equal(sent(n, "signing.install")[0].url, "https://e.example/a.ipa");
});

test("an older shell without signing.inspect installs the url as before", async () => {
  const n = shell({ inspect: () => { throw new Error("unknown method signing.inspect"); } });
  const { ok } = await run({ url: "https://e.example/a.ipa", name: "A" }, { native: n });
  assert.equal(ok, true);
  assert.equal(sent(n, "signing.install")[0].url, "https://e.example/a.ipa");
});

test("app_id_taken with no session: only the queue's sign-in prompt, and Open goes to Signing", async () => {
  const n = shell({ install: () => { throw taken(); } });
  const asked = [], went = [];
  const alert = async (o) => { asked.push(o.title); return { index: 1 }; };
  const { ok, h } = await run({ url: "https://e.example/a.ipa", name: "A" },
    { native: n, session: async () => null, alert, go: (path) => went.push(path) });
  await new Promise((r) => setImmediate(r));
  assert.equal(ok, false);
  assert.deepEqual(asked, [SIGN_IN_TITLE]);
  assert.equal(h.failure, `${SIGN_IN_ROW}.`);
  assert.deepEqual(went, [["signing"]]);
  assert.equal(h.hidden, true);
});

test("Cancel while the App ID is made: nothing is installed", async () => {
  const n = shell(), p = portal(), h = page();
  const list = p.listAppIds;
  p.listAppIds = async () => { h.tap(); return list(); };
  const { ok } = await run({ url: "https://e.example/a.ipa", name: "A" }, { native: n, p, h });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ok, false);
  assert.deepEqual(sent(n, "signing.install"), []);
});
