// B475: with a free Apple ID's profile, an install through the Signing Server fails and says why (iOS refuses such an
// app from a website without a word), and iFizBox's own update is signed as <bundle ID>.<TEAMID>.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map([["ifizbox.installRoute", "server"]]);
Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });

const { freeProfile, deviceError, FREE_PROFILE_TITLE } = await import("../core/signing.js");
const { onFreeProfile } = await import("./freeprofile.js");
const { openPrepared, prepareOnDevice, installOnDevice, forgetRoute } = await import("../signing-client.js");
const { SELF_ID } = await import("../core/appqueue.js");
const { progressHUD } = await import("../nav/progress.js");
const { fakeNative } = await import("../fakes.test-helper.js");

const status = (free) => ({ identity: { name: "iPhone Developer: X", team: "TEAM1", profile: { name: "iOS Team Provisioning Profile: com.ryha.ifizbox.TEAM1", kind: "Development", free } } });
const page = { line() {}, step() {}, error() {}, status() {}, progress() {}, reopen() {}, onClose() {}, finish() {}, stoppable() {}, close() {}, help() {}, raw() {} };
const methods = (native) => native.calls.map((c) => c.method);

test("freeProfile reads the shell's profile.free; anything else is not free", async () => {
  assert.equal(freeProfile(status(true)), true);
  assert.equal(freeProfile(status(false)), false);
  assert.equal(freeProfile({ identity: { profile: {} } }), false);
  assert.equal(freeProfile(null), false);
  assert.equal(await onFreeProfile(fakeNative({ "signing.status": JSON.stringify(status(true)) })), true, "the status as JSON text");
  assert.equal(await onFreeProfile(fakeNative({ "signing.status": new Error("no bridge") })), false);
});

test("deviceError words free_profile: the real reason and what works", () => {
  const why = deviceError(Object.assign(new Error("free Apple ID profile"), { code: "free_profile" }), "Alpha");
  assert.equal(why.title, FREE_PROFILE_TITLE);
  assert.equal(why.open, "signing");
  assert.match(why.message, /Alpha/);
  assert.match(why.message, /Signing Server/);
  assert.match(why.message, /free Apple ID/);
  assert.match(why.message, /Network Extensions/);
  assert.match(why.message, /Computer Install/);
});

// the shell's answer on the Signing Server route with a free profile (Sideload.refusesFree)
const refusedFree = () => Object.assign(new Error("free_profile: iOS doesn't install an app signed with a free Apple ID from the Signing Server"), { code: "free_profile" });

test("openPrepared: the shell's free_profile ends the row with the reason, not Completed", async () => {
  const native = fakeNative({ "signing.open": refusedFree() });
  await assert.rejects(openPrepared({ id: "a", name: "Alpha", token: "t1" }, { tag: "a#2", native }),
    (e) => e.code === "free_profile" && /free Apple ID/.test(e.message) && /Alpha/.test(e.message) && /Computer Install/.test(e.message));
  assert.ok(!methods(native).includes("signing.progress"), "nothing waits for an install that can't come");
  assert.ok(!methods(native).includes("signing.status"), "other apps' rows read no status");
});

test("prepareOnDevice: iFizBox's own update on a free profile is signed with Keep Bundle IDs off; other apps as they were", async () => {
  const run = async (job, free) => {
    const native = fakeNative({ "signing.status": status(free), "signing.prepare": () => ({ token: "t" }) });
    await prepareOnDevice(job, { tag: "x#1", native, ownIcon: async (p) => p });
    return native.calls.find((c) => c.method === "signing.prepare").params;
  };
  const self = { id: SELF_ID, name: "iFizBox", mode: "update", url: "https://x/i.ipa" };
  assert.equal((await run(self, true)).keepBundleId, false);
  assert.equal((await run(self, false)).keepBundleId, undefined);
  assert.equal((await run({ id: "com.a", name: "Alpha", mode: "install", url: "https://x/a.ipa" }, true)).keepBundleId, undefined);
});

test("installOnDevice: iFizBox's own update on a free profile asks for <bundle ID>.<TEAMID>; free_profile alerts the reason", async () => {
  const run = async (opts, free) => {
    forgetRoute();
    const native = fakeNative({ "signing.status": status(free), "signing.install": refusedFree() });
    const alerts = [], went = [];
    const ok = await installOnDevice(opts, { native, alert: async (a) => { alerts.push(a); return { index: 0 }; }, go: (r) => went.push(r),
      hud: (t) => progressHUD(t, { open: () => page }), later: () => {} });
    return { ok, alerts, went, params: native.calls.find((c) => c.method === "signing.install")?.params, methods: methods(native) };
  };
  const self = await run({ url: "https://a.example/i.ipa", name: "iFizBox", host: true }, true);
  assert.equal(self.params.keepBundleId, false);
  assert.equal(self.params.url, "https://a.example/i.ipa");
  assert.equal(self.ok, false);
  assert.equal(self.alerts.length, 1);
  assert.equal(self.alerts[0].title, FREE_PROFILE_TITLE);
  assert.match(self.alerts[0].message, /free Apple ID/);
  assert.deepEqual(self.went, [["signing"]]);
  assert.equal((await run({ url: "https://a.example/i.ipa", name: "iFizBox", host: true }, false)).params.keepBundleId, undefined, "a paid profile: as before");
  const other = await run({ url: "https://a.example/x.ipa", name: "X" }, true);
  assert.equal(other.params.keepBundleId, undefined);
  assert.ok(!other.methods.includes("signing.status"), "other apps read no status");
  assert.equal(other.alerts[0].title, FREE_PROFILE_TITLE);
});
