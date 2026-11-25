// F308: paid tweaks (cydia::commercial) in the sideload build, screens/tweaks.js + core/payment.js paidTweakDeb, against
// the fake shell (native/fake/fake-native.mjs: net.request, device.info from PhoneID's UDID, auth.session, keychain.*,
// paid.download / paid.cached) and a fake Sileo Payment Provider vendor: signed out -> Sign In, not bought -> Buy, bought
// -> authorize_download (udid, device, version, repo, architecture), the one-time .deb downloaded, kept per package and
// version in the app's storage, and injected like a free tweak.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createFakeNative, makeFixture } from "../../../native/fake/fake-native.mjs";
import { createFakeVendor } from "../../../native/fake/fake-vendor.mjs";
import { createPaidTweaks, tweakDeb, addToApp, offerPaid, savedTweaks, buyLabel } from "./tweaks.js";
import { PaidNeeded, paidTweakDeb } from "../core/payment.js";
import { memoryIpaStore } from "../core/myipas.js";

const ID = "com.me.fixture"; // the fixture tweak's package (its filter names the app com.me.fixture)
const DEB = readFileSync(new URL("../core/fixtures/tweaks/tweak-xz.deb", import.meta.url));
const REPO = "https://repo.vendor.test/";
const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
let n = 0;
// a fresh version each time: tweakDeb keeps a session copy per package and version
const st = (o = {}) => ({ package: ID, name: "Fixture", version: `1.0-${++n}`, tag: "role::enduser, cydia::commercial",
  architecture: "iphoneos-arm64", debUrl: `${REPO}debs/fixture.deb`, depends: "mobilesubstrate", ...o });

function setup(t, { price = "$1.99", version } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const vendor = createFakeVendor({ packages: { [ID]: { price, version } } });
  // this vendor has every version the tests ask for
  const handle = vendor.handle.bind(vendor);
  vendor.handle = (req) => {
    try { const v = JSON.parse(req.body ?? "{}").version; if (v && !version) vendor.packages[ID].version = v; } catch { /* not JSON */ }
    return handle(req);
  };
  // the vendor's one-time URL hands out a real tweak .deb (the fake vendor's own is a control stanza only)
  const one = vendor.download.bind(vendor);
  vendor.download = (url) => { const r = one(url); return r?.status === 200 ? { status: 200, body: DEB } : r; };
  const paidTweakDir = join(fx.dir, "paid-tweaks");
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, mode: "sideload", vendors: [vendor], paidTweakDir,
    device: null, phoneUdid: "00008030-001A2B3C4D5E6F70" });
  const call = (method, params) => native.call(method, params);
  const paid = createPaidTweaks({ call, storage: storage(), vendorFor: async () => ({ base: vendor.base, source: { key: "v", uri: REPO } }) });
  return { vendor, native, paid, paidTweakDir };
}

test("signed out: Sign In; signed in, not bought: Buy (with its price); bought: the .deb downloads, is kept, and is the vendor's", async (t) => {
  const { vendor, paid, paidTweakDir } = setup(t);
  const s = st();
  await assert.rejects(tweakDeb(s, { paid }), (e) => e instanceof PaidNeeded && e.need === "signin" && e.price === "$1.99");
  assert.equal(await paid.signIn(s), true);
  await assert.rejects(tweakDeb(s, { paid }), (e) => e instanceof PaidNeeded && e.need === "purchase" && e.price === "$1.99");
  assert.ok(!vendor.log.some((r) => r.path.endsWith("authorize_download")), "nothing authorized before it's bought");
  assert.equal(await paid.buy(s), true);
  const data = await tweakDeb(s, { paid });
  assert.deepEqual(Buffer.from(data), DEB);
  const auth = vendor.log.find((r) => r.path === `package/${ID}/authorize_download`);
  assert.deepEqual(auth.body, { token: auth.body.token, udid: "00008030-001A2B3C4D5E6F70", device: "iPhone14,2", version: s.version,
    repo: REPO, architecture: "iphoneos-arm64" });
  assert.deepEqual(readdirSync(paidTweakDir), [`${ID}_${s.version}.deb`], "kept in the app's storage per package and version");
});

test("a kept .deb is read back without asking the vendor again; a newer version replaces it", async (t) => {
  const { vendor, native, paid, paidTweakDir } = setup(t);
  const s = st();
  await paid.signIn(s);
  await paid.buy(s);
  await paid.deb(s);
  const asked = vendor.log.length;
  // another session (no session copy): paid.cached answers
  const again = await paid.deb(s);
  assert.deepEqual(Buffer.from(again), DEB);
  assert.equal(vendor.log.length, asked, "no vendor call for a kept .deb");
  assert.ok(native.calls.some((c) => c.method === "paid.cached"));
  const newer = { ...s, version: s.version + "+1" };
  await paid.deb(newer);
  assert.deepEqual(readdirSync(paidTweakDir), [`${ID}_${newer.version}.deb`], "the older version goes");
});

test("a FREE commercial tweak (Chariz answers purchased) downloads once signed in, with no Buy step", async () => {
  // Chariz's betterAlarm: price FREE, purchased true; the client is faked at core/payment.js's level
  const calls = [];
  const client = {
    signedIn: async () => true,
    packageInfo: async () => ({ price: "FREE", purchased: true, available: true }),
    authorizeDownload: async (id, o) => { calls.push({ id, ...o }); return "https://chariz.com/dl/once.deb"; },
  };
  const data = await paidTweakDeb({ package: "com.example.betteralarm", version: "1.2", architecture: "iphoneos-arm64" },
    { client, repo: "https://repo.chariz.com/", download: async (url) => { calls.push({ url }); return new Uint8Array([1]); } });
  assert.deepEqual([...data], [1]);
  assert.deepEqual(calls, [{ id: "com.example.betteralarm", version: "1.2", repo: "https://repo.chariz.com/", architecture: "iphoneos-arm64" },
    { url: "https://chariz.com/dl/once.deb" }]);
  // signed out and the seller refuses the tokenless ask: Sign In, not an error; not for sale says so
  await assert.rejects(paidTweakDeb({ package: "x", version: "1" }, { client: { ...client, signedIn: async () => false,
    authorizeDownload: async () => { throw new Error("Please sign in"); } }, download: async () => null }),
  (e) => e instanceof PaidNeeded && e.need === "signin");
  await assert.rejects(paidTweakDeb({ package: "x", version: "1" }, { client: { ...client, packageInfo: async () => ({ price: "$1", purchased: false, available: false }) },
    download: async () => null }), (e) => e instanceof PaidNeeded && e.need === "unavailable" && e.available === false);
});

test("Add to App on a paid tweak: Sign In, then Buy for its price, then the .deb is injected like a free one", async (t) => {
  const { paid } = setup(t);
  const mem = memoryIpaStore();
  const store = async () => mem;
  const sheets = [], alerts = [];
  const app = await addToApp(st(), {
    paid, store, storage: storage(),
    hud: () => () => {},
    sheet: async (o) => { sheets.push(o); return 0; },
    alert: async (o) => { alerts.push(o); return 0; },
    pick: async (o) => o.made[0],
    apps: async () => [{ bundleId: ID, name: "Fixture" }],
  });
  assert.equal(app?.bundleId, ID);
  assert.deepEqual(sheets.map((s) => s.buttons), [["Sign In to Fake Vendor"], ["Buy for $1.99"]]);
  assert.match(sheets[0].title, /sold by Fake Vendor for \$1\.99/);
  assert.ok(!alerts.some((a) => a.title === "Can't Add This Tweak"), "not bought is not an error");
  assert.equal(alerts.at(-1).title, "Tweak Added");
  assert.deepEqual((await savedTweaks(ID, { store })).map((x) => x.name), [`${ID}_1.0-${n}.deb`]);
});

test("not bought and the sheet cancelled: nothing added, no error alert", async (t) => {
  const { paid } = setup(t);
  const alerts = [];
  const sheets = [];
  const r = await addToApp(st(), { paid, storage: storage(), hud: () => () => {}, sheet: async (o) => { sheets.push(o); return -1; },
    alert: async (o) => { alerts.push(o); }, pick: async () => null, apps: async () => [] });
  assert.equal(r, null);
  assert.equal(sheets.length, 1);
  assert.deepEqual(alerts, []);
});

test("offerPaid: the seller's name and Buy for Free on a free one; a failed sign-in is the Purchase alert", async () => {
  const s = { package: "a", name: "A" };
  const seller = async () => ({ name: "Chariz" });
  const sheets = [];
  assert.equal(await offerPaid(s, new PaidNeeded("purchase", { price: "FREE" }), { paid: { seller, buy: async () => true },
    sheet: async (o) => { sheets.push(o); return 0; } }), true);
  assert.deepEqual(sheets[0].buttons, ["Buy for Free"]);
  assert.equal(buyLabel(null), "Buy");
  const alerts = [];
  assert.equal(await offerPaid(s, new PaidNeeded("signin"), { paid: { seller, signIn: async () => { throw new Error("device: pair this iPhone"); } },
    sheet: async () => 0, alert: async (o) => { alerts.push(o); } }), false);
  assert.equal(alerts[0].title, "Purchase");
  assert.match(alerts[0].message, /pair this iPhone/);
});

test("the shell refuses a package name that would step out of its folder", async (t) => {
  const { native, paidTweakDir } = setup(t);
  await assert.rejects(native.call("paid.download", { url: "https://vendor.test/dl/x.deb", package: "../x", version: "1" }), /bad_url/);
  await assert.rejects(native.call("paid.cached", { package: "a", version: "../../1" }), /bad_url/);
  assert.equal(existsSync(paidTweakDir), false);
});

test("F318: signed out, a FREE tweak the seller calls purchased downloads without a token; any refusal asks for Sign In", async () => {
  const { createPaymentClient } = await import("../core/payment.js");
  const BASE = "https://chariz.test/api/sileo/";
  const sent = [];
  // a Chariz-like seller: package_info FREE + purchased with no token, authorize_download hands out a URL with none
  let refuse = false;
  const request = async (req) => {
    const body = req.body ? JSON.parse(req.body) : null;
    sent.push({ url: req.url, body });
    if (req.url.endsWith("/info")) return { status: 200, json: { price: "FREE", purchased: true, available: true } };
    if (refuse) return { status: 401, json: { error: "Please sign in" } };
    return { status: 200, json: { url: "https://chariz.test/dl/once.deb" } };
  };
  const client = createPaymentClient({ base: BASE, request, device: () => ({ udid: "U1", model: "iPhone14,2" }),
    credentials: { load: async () => null, save: async () => {}, forget: async () => {} } });
  const got = [];
  const s = { package: "com.example.betteralarm", version: "1.2", architecture: "iphoneos-arm64" };
  const data = await paidTweakDeb(s, { client, repo: "https://repo.chariz.test/", download: async (url) => { got.push(url); return new Uint8Array([7]); } });
  assert.deepEqual([...data], [7]);
  assert.deepEqual(got, ["https://chariz.test/dl/once.deb"]);
  const auth = sent.find((r) => r.url.endsWith("/authorize_download"));
  assert.deepEqual(auth.body, { udid: "U1", device: "iPhone14,2", version: "1.2", repo: "https://repo.chariz.test/", architecture: "iphoneos-arm64" },
    "no token field at all");
  refuse = true;
  await assert.rejects(paidTweakDeb({ ...s, version: "1.3" }, { client, download: async () => assert.fail("no download after a refusal") }),
    (e) => e instanceof PaidNeeded && e.need === "signin" && e.price === "FREE");
  // a priced tweak, or a FREE one not yet "purchased", still asks for Sign In without trying
  sent.length = 0;
  for (const info of [{ price: "$1.99", purchased: true }, { price: "FREE", purchased: false }]) {
    const c = { signedIn: async () => false, packageInfo: async () => ({ ...info, available: true }),
      authorizeDownload: async () => assert.fail("not tried") };
    await assert.rejects(paidTweakDeb(s, { client: c, download: async () => null }), (e) => e instanceof PaidNeeded && e.need === "signin");
  }
  // the request builder still refuses a tokenless authorize_download unless asked for one
  const { buildRequest } = await import("../core/payment.js");
  assert.throws(() => buildRequest(BASE, "authorize_download", { packageId: "a" }), /no token/);
  assert.equal(JSON.parse(buildRequest(BASE, "authorize_download", { packageId: "a", tokenless: true }).body).token, undefined);
});

// B454: the vendor answers available: false (F434's rules, for a tweak that goes into an app).
const noLongerSold = (vendor) => {
  const handle = vendor.handle;
  vendor.handle = (req) => {
    const r = handle(req);
    return r && req.url.endsWith("/info") && req.method === "POST" ? { ...r, body: JSON.stringify({ ...JSON.parse(r.body), available: false }) } : r;
  };
};
const adding = (paid) => {
  const mem = memoryIpaStore(), seen = { sheets: [], alerts: [] };
  return { seen, opts: { paid, store: async () => mem, storage: storage(), hud: () => () => {},
    sheet: async (o) => { seen.sheets.push(o); return 0; }, alert: async (o) => { seen.alerts.push(o); return 0; },
    pick: async (o) => o.made[0], apps: async () => [{ bundleId: ID, name: "Fixture" }] } };
};

test("B454: no longer sold: signed out offers Sign In and says why; a buyer's sign-in adds it", async (t) => {
  const { vendor, paid } = setup(t);
  noLongerSold(vendor);
  const signIn = paid.signIn;
  // the account that signs in bought it while it was sold
  paid.signIn = async (s) => (await signIn(s)) && paid.buy(s);
  const { seen, opts } = adding(paid);
  const app = await addToApp(st(), opts);
  assert.equal(app?.bundleId, ID);
  assert.deepEqual(seen.sheets.map((s) => [s.title, s.buttons]),
    [["Fake Vendor no longer sells Fixture. If you bought it, sign in to download it.", ["Sign In to Fake Vendor"]]]);
  assert.deepEqual(seen.alerts.map((a) => a.title), ["Tweak Added"]);
});

test("B454: no longer sold, signed in and not bought: says so, no Buy and no download asked for", async (t) => {
  const { vendor, paid } = setup(t);
  noLongerSold(vendor);
  const s = st();
  await paid.signIn(s);
  const { seen, opts } = adding(paid);
  assert.equal(await addToApp(s, opts), null);
  assert.deepEqual(seen.sheets, []);
  assert.deepEqual(seen.alerts.map((a) => a.message), ["Fake Vendor no longer sells Fixture."]);
  assert.ok(!vendor.log.some((r) => r.path.endsWith("authorize_download")));
});

test("B454: no longer sold, bought, and the vendor refuses the download: its own message", async (t) => {
  const { vendor, paid } = setup(t);
  noLongerSold(vendor);
  const s = st();
  await paid.signIn(s);
  await paid.buy(s);
  const handle = vendor.handle;
  vendor.handle = (req) => req.url.endsWith("/authorize_download")
    ? { status: 403, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "This package was withdrawn" }) } : handle(req);
  const { seen, opts } = adding(paid);
  assert.equal(await addToApp(s, opts), null);
  assert.deepEqual(seen.alerts.map((a) => [a.title, a.message]), [["Can't Add This Tweak", "This package was withdrawn"]]);
  assert.deepEqual(seen.sheets, []);
});

test("B454: a free tweak no longer available isn't called sold", async () => {
  const seen = [];
  const o = { paid: { seller: async () => ({ name: "Havoc" }) }, sheet: async (x) => { seen.push(x.title); return -1; },
    alert: async (x) => { seen.push(x.message); } };
  for (const need of ["signin", "unavailable"]) await offerPaid({ package: "a", name: "A" }, new PaidNeeded(need, { price: "Free", available: false }), o);
  assert.deepEqual(seen, ["A is not available from Havoc. If you already got it, sign in to download it.", "A is not available from Havoc."]);
});
