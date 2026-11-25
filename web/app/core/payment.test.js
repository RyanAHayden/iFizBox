import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { memStorage } from "../fakes.test-helper.js";
import http from "node:http";
import {
  isCommercial, paymentEndpointUrl, parseEndpoint, buildRequest, authenticateUrl, parseCallback, parseReply,
  parsePurchase, createPaymentClient, createCredentialStore, PaymentError, paidTweakDeb,
} from "./payment.js";

test("cydia::commercial in Tag", () => {
  assert.equal(isCommercial({ tag: "purpose::extension, cydia::commercial" }), true);
  assert.equal(isCommercial("cydia::commercial"), true);
  assert.equal(isCommercial({ tag: "cydia::commercialized, role::enduser" }), false);
  assert.equal(isCommercial({}), false);
});

test("payment_endpoint: https only, one URL, trailing slash", () => {
  assert.equal(paymentEndpointUrl({ uri: "https://havoc.app/" }), "https://havoc.app/payment_endpoint");
  assert.equal(parseEndpoint("https://chariz.com/api/sileo/\n"), "https://chariz.com/api/sileo/");
  assert.equal(parseEndpoint("https://havoc.app/api/sileo"), "https://havoc.app/api/sileo/");
  for (const bad of ["http://vendor.example/", "", "<html>", "https://u:p@x.example/", "https://x.example/?a=1", "javascript:x"]) {
    assert.equal(parseEndpoint(bad), null, bad);
  }
});

test("requests are built as the spec writes them", () => {
  const base = "https://chariz.com/api/sileo/";
  assert.deepEqual(buildRequest(base, "info"), { method: "GET", url: base + "info", headers: { Accept: "application/json" }, body: null });
  const info = buildRequest(base, "package_info", { packageId: "org.coolstar.classicfolders2", udid: "u1", device: "iPhone7,2" });
  assert.equal(info.method, "POST");
  assert.equal(info.url, base + "package/org.coolstar.classicfolders2/info");
  assert.equal(info.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(info.body), { udid: "u1", device: "iPhone7,2" }); // token optional: left out
  assert.deepEqual(JSON.parse(buildRequest(base, "purchase", { packageId: "a.b", token: "t", secret: "s" }).body),
    { token: "t", payment_secret: "s" });
  // B10: udid and device in the purchase too, architecture in authorize_download (as Sileo and Zebra send them).
  assert.deepEqual(JSON.parse(buildRequest(base, "purchase", { packageId: "a.b", token: "t", secret: "s", udid: "u", device: "d" }).body),
    { token: "t", udid: "u", device: "d", payment_secret: "s" });
  assert.deepEqual(JSON.parse(buildRequest(base, "authorize_download",
    { packageId: "a.b", token: "t", udid: "u", device: "d", version: "1.0.1", repo: "https://repo.example.com", architecture: "iphoneos-arm64" }).body),
  { token: "t", udid: "u", device: "d", version: "1.0.1", repo: "https://repo.example.com", architecture: "iphoneos-arm64" });
  assert.deepEqual(JSON.parse(buildRequest(base, "authorize_download", { packageId: "a.b", token: "t", architecture: "" }).body),
    { token: "t" }); // unknown architecture: left out, not sent empty
  assert.deepEqual(JSON.parse(buildRequest(base, "sign_out", { token: "t", udid: "u" }).body), { token: "t" });
  assert.throws(() => buildRequest(base, "purchase", { packageId: "a.b", token: "t" }), /payment secret/);
  assert.throws(() => buildRequest(base, "user_info", {}), /sign in/);
  assert.throws(() => buildRequest(base, "package_info", { packageId: "../../admin" }), /package name/);
  assert.throws(() => buildRequest("http://plain.example/", "info"), /https/);
  assert.equal(authenticateUrl(base, { udid: "4e12", model: "iPhone7,2" }), base + "authenticate?udid=4e12&model=iPhone7%2C2");
});

test("B453: Havoc and Chariz are asked for the ID in lowercase on all three calls, other vendors as listed", () => {
  const path = (base, action, packageId) =>
    buildRequest(base, action, { packageId, token: "t", secret: "s" }).url.slice(base.length);
  for (const [action, last] of [["package_info", "info"], ["purchase", "purchase"], ["authorize_download", "authorize_download"]]) {
    for (const base of ["https://havoc.app/api/sileo/", "https://chariz.com/api/sileo/"]) {
      assert.equal(path(base, action, "com.thetimeloop.EchoUI"), `package/com.thetimeloop.echoui/${last}`);
      assert.equal(path(base, action, "com.paid.tweak"), `package/com.paid.tweak/${last}`);
    }
    assert.equal(path("https://vendor.example/api/", action, "com.Mixed.Case"), `package/com.Mixed.Case/${last}`);
  }
});

test("B453: a mixed-case package's paid .deb is asked for in lowercase and downloaded as the package listed", async () => {
  const urls = [];
  const client = createPaymentClient({
    base: "https://havoc.app/api/sileo/",
    request: async ({ url }) => {
      urls.push(url);
      return { status: 200, json: url.endsWith("/info") ? { price: "$0.99", purchased: true, available: true } : { url: "https://havoc.app/dl" } };
    },
    credentials: { load: async () => ({ token: "t", secret: "s" }) },
  });
  const st = { package: "com.thetimeloop.EchoUI", version: "1.0" };
  assert.equal(await paidTweakDeb(st, { client, download: (url, got) => got.package }), "com.thetimeloop.EchoUI");
  assert.deepEqual(urls, ["info", "authorize_download"].map((c) => `https://havoc.app/api/sileo/package/com.thetimeloop.echoui/${c}`));
});

test("callbacks: sileo:// as vendors send it, ifizbox:// the same way", () => {
  const ok = { kind: "authentication_success", token: "tok", secret: "sec" };
  assert.deepEqual(parseCallback("sileo://authentication_success?token=tok&payment_secret=sec"), ok);
  assert.deepEqual(parseCallback("ifizbox://authentication_success?token=tok&payment_secret=sec"), ok);
  assert.deepEqual(parseCallback("ifizbox://payment/authentication_success?token=tok&payment_secret=sec"), ok);
  assert.deepEqual(parseCallback("sileo://payment_completed"), { kind: "payment_completed" });
  assert.equal(parseCallback("sileo://authentication_success?token=tok"), null);
  assert.equal(parseCallback("https://evil.example/authentication_success?token=a&payment_secret=b"), null);
  assert.equal(parseCallback("not a url"), null);
});

test("replies: error, success false, HTTP failures; recovery URL and invalidate", () => {
  assert.equal(parseReply(200, { price: "$1" }).ok, true);
  const e = parseReply(200, { available: false, error: "Restricted", recovery_url: "https://v.example/r", invalidate: true });
  assert.deepEqual([e.ok, e.error, e.recoveryUrl, e.invalidate], [false, "Restricted", "https://v.example/r", true]);
  assert.equal(parseReply(200, { success: false }).ok, false);
  assert.equal(parseReply(500, null).error, "the vendor answered HTTP 500");
  assert.equal(parseReply(400, { error: "x", recovery_url: "javascript:alert(1)" }).recoveryUrl, null);
  assert.deepEqual(parsePurchase({ status: 1, url: "http://insecure.example" }), { status: "failed" });
});

// A fake vendor that speaks the spec, and records what it was sent.
let server, base;
const seen = [];
const PRICES = { "com.paid.tweak": "$1.99", "com.free.tweak": null };
before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, path: req.url, type: req.headers["content-type"], body });
      const send = (status, j) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
      const m = req.url.match(/^\/api\/sileo\/(?:package\/([^/]+)\/)?([a-z_]+)$/);
      if (!m) return send(404, { error: "no such call" });
      const [, pkg, call] = m;
      const signedIn = body?.token === "good-token";
      if (req.method === "GET" && call === "info") return send(200, { name: "Fake Pay", icon: "https://v/i.png", description: "d", authentication_banner: { message: "Sign in to buy", button: "" } });
      if (req.method !== "POST") return send(405, { error: "POST" });
      if (call === "user_info") return signedIn ? send(200, { items: ["com.paid.tweak", 7], user: { name: "Ann", email: "a@example.com" } }) : send(401, { error: "Signed out", invalidate: true });
      if (call === "sign_out") return send(200, { success: true });
      if (call === "info") return pkg in PRICES ? send(200, { price: PRICES[pkg] ?? "Free", purchased: signedIn && pkg === "com.paid.tweak", available: true }) : send(200, { available: false, error: "Unknown package", recovery_url: "https://vendor.example/help" });
      if (call === "purchase") return body?.payment_secret === "good-secret" ? send(200, { status: 1, url: "https://vendor.example/checkout?s=1" }) : send(200, { status: -1 });
      if (call === "authorize_download") return signedIn ? send(200, { url: `https://vendor.example/dl/${pkg}?v=${body.version}&key=once` }) : send(200, { error: "Sign in first", invalidate: true });
      send(404, { error: "no such call" });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `https://127.0.0.1:${server.address().port}/api/sileo/`;
});
after(() => server.close());

// The shell's net.request, played by fetch over plain http to the fake (the endpoint is https in name only).
async function request({ method, url, headers, body }) {
  const res = await fetch(url.replace(/^https:/, "http:"), { method, headers, body: body ?? undefined });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

test("against a fake vendor: price, sign in, buy, authorize the download, sign out", async () => {
  seen.length = 0;
  const storage = memStorage();
  const keychain = new Map();
  const secure = { get: async (k) => keychain.get(k) ?? null, set: async (k, v) => { keychain.set(k, v); }, remove: async (k) => { keychain.delete(k); } };
  const credentials = createCredentialStore({ storage, secure });
  const client = createPaymentClient({ base, request, credentials, device: async () => ({ udid: "UDID1", model: "iPhone10,6" }) });

  const info = await client.info();
  assert.deepEqual(info.banner, { message: "Sign in to buy", button: "Sign In" });
  assert.deepEqual(await client.packageInfo("com.paid.tweak"), { price: "$1.99", purchased: false, available: true });
  assert.deepEqual(seen.at(-1), { method: "POST", path: "/api/sileo/package/com.paid.tweak/info", type: "application/json", body: { udid: "UDID1", device: "iPhone10,6" } });
  await assert.rejects(client.packageInfo("com.unknown"), (e) => e instanceof PaymentError && e.recoveryUrl === "https://vendor.example/help");

  assert.equal(await client.signedIn(), false);
  assert.equal(await client.authenticateUrl(), `${base}authenticate?udid=UDID1&model=iPhone10%2C6`);
  assert.equal(await client.finishSignIn("sileo://payment_completed"), false);
  assert.equal(await client.finishSignIn("sileo://authentication_success?token=good-token&payment_secret=good-secret"), true);
  assert.equal(await client.signedIn(), true);
  assert.ok(![...storage.m.values()].join().includes("good-secret"), "the secret is in the keychain, not storage");

  assert.deepEqual(await client.userInfo(), { items: ["com.paid.tweak"], user: { name: "Ann", email: "a@example.com" } });
  assert.equal((await client.packageInfo("com.paid.tweak")).purchased, true);
  assert.deepEqual(seen.at(-1).body, { token: "good-token", udid: "UDID1", device: "iPhone10,6" });
  assert.deepEqual(await client.purchase("com.paid.tweak"), { status: "action", url: "https://vendor.example/checkout?s=1" });
  assert.deepEqual(seen.at(-1).body, { token: "good-token", udid: "UDID1", device: "iPhone10,6", payment_secret: "good-secret" });
  const url = await client.authorizeDownload("com.paid.tweak", { version: "1.0.1", repo: "https://havoc.app/", architecture: "iphoneos-arm64" });
  assert.equal(url, "https://vendor.example/dl/com.paid.tweak?v=1.0.1&key=once");
  assert.deepEqual(seen.at(-1).body, { token: "good-token", udid: "UDID1", device: "iPhone10,6", version: "1.0.1", repo: "https://havoc.app/", architecture: "iphoneos-arm64" });

  await client.signOut();
  assert.deepEqual(seen.at(-1), { method: "POST", path: "/api/sileo/sign_out", type: "application/json", body: { token: "good-token" } });
  assert.equal(await client.signedIn(), false);
  assert.equal(keychain.size, 0);
});

test("invalidate forgets the credentials", async () => {
  const storage = memStorage();
  const credentials = createCredentialStore({ storage });
  const client = createPaymentClient({ base, request, credentials });
  await client.finishSignIn("ifizbox://authentication_success?token=stale&payment_secret=s");
  assert.equal(await client.signedIn(), true);
  await assert.rejects(client.userInfo(), (e) => e.invalidate === true && /Signed out/.test(e.message));
  assert.equal(await client.signedIn(), false);
  await client.finishSignIn("ifizbox://authentication_success?token=stale&payment_secret=wrong");
  assert.deepEqual(await client.purchase("com.paid.tweak"), { status: "failed" });
});

test("B13: isFreePrice reads FREE in any case, and nothing else", async () => {
  const { isFreePrice } = await import("./payment.js");
  for (const p of ["FREE", "free", "Free", " free "]) assert.equal(isFreePrice(p), true, p);
  for (const p of ["$1.99", "", null, undefined, 0, "Freeware"]) assert.equal(isFreePrice(p), false, String(p));
});

test("B454: paidTweakDeb, available false: signed out Sign In; bought authorizes, or throws the vendor's refusal; else unavailable", async () => {
  const { paidTweakDeb, PaidNeeded } = await import("./payment.js");
  const st = { package: "org.gone.tweak", version: "1.0", architecture: "iphoneos-arm64" };
  const asked = [];
  const run = ({ signedIn, purchased, price = "Unavailable", refusal = null }) => paidTweakDeb(st, {
    client: { signedIn: async () => signedIn, packageInfo: async () => ({ price, purchased, available: false }),
      authorizeDownload: async (id) => { asked.push(id); if (refusal) throw refusal; return "https://v.test/dl"; } },
    download: async () => new Uint8Array([9]) });
  const needs = (need) => (e) => e instanceof PaidNeeded && e.need === need && e.available === false;
  await assert.rejects(run({ signedIn: false, purchased: false }), needs("signin"));
  await assert.rejects(run({ signedIn: false, purchased: true, price: "FREE" }), needs("signin"), "no tokenless ask (F434)");
  await assert.rejects(run({ signedIn: true, purchased: false }), needs("unavailable"));
  assert.deepEqual(asked, []);
  assert.deepEqual([...await run({ signedIn: true, purchased: true })], [9]);
  const refusal = new PaymentError({ error: "Withdrawn", recoveryUrl: null, invalidate: false });
  await assert.rejects(run({ signedIn: true, purchased: true, refusal }), (e) => e === refusal);
  const stale = new PaymentError({ error: "Signed out", recoveryUrl: null, invalidate: true });
  await assert.rejects(run({ signedIn: true, purchased: true, refusal: stale }), needs("signin"));
});
