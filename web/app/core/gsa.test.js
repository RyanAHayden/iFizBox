// The free Apple ID sign-in (core/gsa.js): SRP against RFC 5054 and pysrp vectors, plists, and the whole flow (SRP,
// 2FA, app token, listTeams, anisette v3 provisioning) against a fake GrandSlam that runs the server side of SRP.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  processReply, bytesToBig, bigToBytes, modPow, utf8, concat, gsaPasswordKey, GSA_GROUP, encodePlist, decodePlist,
  decodeAny, decodeBinaryPlist, b64encode, AppleIdSession, AppleIdError, DevPortal, DevPortalError, anisetteV3,
  relayTransport, relayWsUrl, signInAlert, XCODE_APP, ANISETTE_SERVERS,
} from "./gsa.js";

const hx = (s) => { const c = s.replace(/\s+/g, ""); return Uint8Array.from(c.match(/../g).map((x) => parseInt(x, 16))); };
const hexOf = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
const td = new TextDecoder();

test("SRP: RFC 5054 Appendix B (SHA-1, 1024-bit, username in x)", async () => {
  const group = { N: bytesToBig(hx(`EEAF0AB9 ADB38DD6 9C33F80A FA8FC5E8 60726187 75FF3C0B 9EA2314C 9C256576 D674DF74 96EA81D3 383B4813
    D692C6E0 E0D5D8E2 50B98BE4 8E495C1D 6089DAD1 5DC7D7B4 6154D6B6 CE8EF4AD 69B15D49 82559B29 7BCF1885 C529F566 660E57EC
    68EDBC3C 05726CC0 2FD4CBF4 976EAA9A FD5138FE 8376435B 9FC61D2F C0EB06E3`)), g: 2n, hash: "SHA-1" };
  const a = bytesToBig(hx("60975527 035CF2AD 1989806F 0407210B C81EDC04 E2762A56 AFD529DD DA2D4393"));
  const B = hx(`BD0C6151 2C692C0C B6D041FA 01BB152D 4916A1E7 7AF46AE1 05393011 BAF38964 DC46A067 0DD125B9 5A981652 236F99D9
    B681CBF8 7837EC99 6C6DA044 53728610 D0C6DDB5 8B318885 D7D82C7F 8DEB75CE 7BD4FBAA 37089E6F 9C6059F3 88838E7A 00030B33
    1EB76840 910440B1 B27AAEAE EB4012B7 D7665238 A8E3FB00 4B117B58`);
  const r = await processReply({ group, a, username: "alice", password: utf8("password123"),
    salt: hx("BEB25379 D1A8581E B5A72767 3A2441EE"), B, usernameInX: true });
  assert.equal(hexOf(bigToBytes(r.k)), "7556AA045AEF2CDD07ABAF0F665C3E818913186F");
  assert.equal(hexOf(bigToBytes(r.x)), "94B7555AABE9127CC58CCF4993DB6CF84D16C124");
  assert.equal(hexOf(bigToBytes(r.u)), "CE38B9593487DA98554ED47D70A7AE5F462EF019");
  assert.equal(hexOf(r.S), hexOf(hx(`B0DC82BA BCF30674 AE450C02 87745E79 90A3381F 63B387AA F271A10D 233861E3 59B48220
    F7C4693C 9AE12B0A 6F67809F 0876E2D0 13800D6C 41BB59B6 D5979B5C 00A172B4 A2A5903A 0BDCAF8A 709585EB 2AFAFA8F 3499B200
    210DCC1F 10EB3394 3CD67FC8 8A2F39A4 BE5BEC4E C0A3212D C346D7E4 74B29EDE 8A469FFE CA686E5A`)));
});

// Made by pysrp (rfc5054_enable, no_username_in_x: what gms.py drives Apple with), s2k_fo password key.
const PYSRP = { username: "r32-vector@example.invalid", password: "not a real password", iterations: 20000, protocol: "s2k_fo",
  salt: "d03e658ed25d19807be019becec801a4", pbkdf2: "50e187d8ed0328f16631b92aa4044ae62c92f555049463aa2fb2df3100278478",
  a: "a0e2ce87cf3b98ae759d085f56e333abda1d9b9be673b69f0be85f0d4e2017070b0f6eb9416f7d8b3310d48d54f15b61601b9951d786a70753fb3504ed29b6832658ca8345279ffcf16c1b9569da2de7aa1297824d69bd475c9391ed8580015783d2a070cfc7c4fb26a1915798231c0b7293f9c9fbd480a5b85bc2e1e0f645e72c219b57e77f0941952a027dcb64782dc016969f88dc4b3c87d5d4b6744f3c5c7cb15e3d65b7288ec9aaacaa2eb62f1498cdcdb266e717d64cfa9ee78b3ffd691518cd8c84ed8306f862989c5749ad89163def2f9589ca9f3b06c27e8022134b27963cd7c1f2c9956905db4e2d57e83931dfa8a8d0833f0e99c5d29e7845008c",
  B: "323381aa1d5b3233d0575acfcae87816b3024a8b4b52fb7a345ccb0bafd199b4ac57f5296bd062288e8849c478cc1c6a01efe81ce193cdb7b04e1da09decf5061ce0db2a7e91234130b942b2fad1c41f8442f753104ba01b5af9b5e93ba3af1ca95dddfa18f4fe7353b64669ef5c6280dd6fb61c66dc1b030cfc44386d5ed784e1f4872975797e1284becdb4bda03f4a9ad6c9d9c89c1c1cd5dcdee613772ba1add0568203437a557deaa14cc622dd034db4d05d64abd8ba8e65af7a299f71710aee016ffaed0a455bd72a14e6429cbc8b348a2c41f1ece3f68b5c63aaf5e11c77c29108f5498a67b55dde4fb9380b54686e67bd7d2edc473f979ffc212082db",
  K: "e3bda10b0865abd653a005eabffc9d2a816927cf824aceec5774b9d6c43aa931", M1: "c38348a7df60cdbc9237d88a3799045ac699ad4d0d459faaab790b5ca65ec7ba",
  M2: "dc12e8264e621ea85b5bce90b42d019dab01143898b9ea2d9a5cb0cb5b8044ba" };

test("SRP: GrandSlam shape (SHA-256, 2048-bit, no username in x, s2k_fo) matches pysrp", async () => {
  const v = PYSRP;
  const P = await gsaPasswordKey(v.password, hx(v.salt), v.iterations, v.protocol);
  assert.equal(hexOf(P), v.pbkdf2.toUpperCase());
  const r = await processReply({ a: bytesToBig(hx(v.a)), username: v.username, password: P, salt: hx(v.salt), B: hx(v.B) });
  assert.equal(hexOf(r.K), v.K.toUpperCase());
  assert.equal(hexOf(r.M1), v.M1.toUpperCase());
  assert.equal(hexOf(r.M2), v.M2.toUpperCase());
  await assert.rejects(processReply({ a: 5n, username: "x", password: P, salt: hx(v.salt), B: bigToBytes(GSA_GROUP.N) }), /illegal B/);
  await assert.rejects(gsaPasswordKey("x", hx(v.salt), 10, "s2k_xx"), /Unsupported/);
});

test("plists: XML round trip, binary and JSON replies", () => {
  const v = { s: "a <&> b", n: 42, big: 2n ** 70n, t: true, f: false, d: new Uint8Array([1, 2, 255]), arr: ["x", 1, []], o: { e: {} } };
  const back = decodePlist(encodePlist(v));
  assert.deepEqual(back, { ...v, big: 2n ** 70n });
  assert.deepEqual(decodePlist("<plist><dict><key>k</key><string/><key>i</key><integer>-3</integer></dict></plist>"), { k: "", i: -3 });
  assert.throws(() => decodePlist("<plist><dict><key>k</key>"), /truncated|unexpected/);
  assert.deepEqual(decodeAny(utf8('{"resultCode":0}')), { value: { resultCode: 0 }, format: "json" });
  // bplist00: { "a": 1 }: header, dict (1 pair) -> key "a", int 1; offsets; trailer.
  const objs = [0xd1, 0x01, 0x02, 0x51, 0x61, 0x10, 0x01];
  const body = [...utf8("bplist00"), ...objs];
  const offs = [8, 11, 13];
  const trailer = new Uint8Array(32);
  const dv = new DataView(trailer.buffer);
  trailer[6] = 1; trailer[7] = 1;
  dv.setBigUint64(8, 3n); dv.setBigUint64(16, 0n); dv.setBigUint64(24, BigInt(body.length));
  const bp = new Uint8Array([...body, ...offs, ...trailer]);
  assert.deepEqual(decodeBinaryPlist(bp), { a: 1 });
  assert.equal(decodeAny(bp).format, "bplist");
});

// ---- a fake GrandSlam: SRP server side, spd, 2FA, apptokens, and developerservices2's listTeams ----

const EMAIL = "spare@example.invalid", PASSWORD = "hunter2 correct", ADSID = "000123-08-abcd", IDMS = "idms-token-xyz";
const SK = crypto.getRandomValues(new Uint8Array(32)), C = utf8("c-value"), APP_TOKEN = "xcode-app-token";

async function hmacBytes(key, ...parts) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, concat(...parts)));
}

function fakeApple({ twoFactor = "device", wrongCode = "000000", protocol = "s2k", bag = true } = {}) {
  const { N, g } = GSA_GROUP;
  const salt = crypto.getRandomValues(new Uint8Array(16)), iterations = 1000;
  const seen = [];
  let pending = null, verified = false, smsId = null;
  const plist = (o, status = 200) => ({ status, headers: { "content-type": "text/x-xml-plist" }, body: utf8(encodePlist(o)) });
  const json = (o, status = 200) => ({ status, headers: { "content-type": "application/json" }, body: utf8(JSON.stringify(o)) });
  return { seen, transport: async ({ url, method, headers, body }) => {
    const u = new URL(url);
    seen.push({ url, method, headers });
    if (u.pathname === "/grandslam/GsService2/lookup") return bag ? plist({ urls: { gsService: "https://gsa.apple.com/grandslam/GsService2" } }) : { status: 500, headers: {}, body: new Uint8Array() };
    if (u.pathname === "/grandslam/GsService2" && method === "POST") {
      const req = decodePlist(body).Request;
      assert.equal(req.cpd["X-Apple-I-MD"], "md-value"); // anisette rides inside cpd
      if (req.o === "init") {
        if (req.u !== EMAIL) return plist({ Response: { Status: { ec: -20970, em: "Your account information was entered incorrectly." } } });
        const P = await gsaPasswordKey(PASSWORD, salt, iterations, protocol);
        const r0 = await processReply({ a: 5n, username: EMAIL, password: P, salt, B: bigToBytes(7n) }); // x and k
        const v = modPow(g, r0.x, N), b = bytesToBig(crypto.getRandomValues(new Uint8Array(32)));
        const B = bigToBytes((r0.k * v + modPow(g, b, N)) % N);
        pending = { A: bytesToBig(req.A2k), b, v, B, k: r0.k };
        return plist({ Response: { Status: { ec: 0 }, s: salt, B, i: iterations, c: utf8("c1"), sp: protocol } });
      }
      if (req.o === "complete") {
        const { A, b, v, B } = pending;
        const nLen = bigToBytes(N).length;
        const hash = async (...p) => new Uint8Array(await crypto.subtle.digest("SHA-256", concat(...p)));
        const u2 = bytesToBig(await hash(bigToBytes(A, nLen), bigToBytes(bytesToBig(B), nLen)));
        const S = bigToBytes(modPow((A * modPow(v, u2, N)) % N, b, N));
        const K = await hash(S);
        const hN = await hash(bigToBytes(N)), hg = await hash(bigToBytes(g, nLen));
        const M1 = await hash(hN.map((x, i) => x ^ hg[i]), await hash(utf8(EMAIL)), salt, bigToBytes(A), B, K);
        if (hexOf(M1) !== hexOf(req.M1)) return plist({ Response: { Status: { ec: -20101, em: "Your Apple ID or password was entered incorrectly." } } });
        const M2 = await hash(bigToBytes(A), M1, K);
        const spdPlain = utf8(encodePlist({ adsid: ADSID, GsIdmsToken: IDMS, sk: SK, c: C, fn: "Spare", ln: "Account" }));
        const key = await crypto.subtle.importKey("raw", await hmacBytes(K, utf8("extra data key:")), "AES-CBC", false, ["encrypt"]);
        const iv = (await hmacBytes(K, utf8("extra data iv:"))).slice(0, 16);
        const spd = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, spdPlain));
        const au = verified || !twoFactor ? undefined : twoFactor === "device" ? "trustedDeviceSecondaryAuth" : "secondaryAuth";
        return plist({ Response: { Status: { ec: 0, ...(au ? { au } : {}) }, M2, spd } });
      }
      if (req.o === "apptokens") {
        assert.equal(req.u, ADSID);
        assert.equal(req.t, IDMS);
        assert.equal(hexOf(req.checksum), hexOf(await hmacBytes(SK, utf8("apptokens"), utf8(ADSID), utf8(XCODE_APP))));
        const iv = crypto.getRandomValues(new Uint8Array(16)), hdr = utf8("XYZ");
        const k = await crypto.subtle.importKey("raw", SK, "AES-GCM", false, ["encrypt"]);
        const inner = utf8(encodePlist({ "status-code": 200, t: { [XCODE_APP]: { token: APP_TOKEN, expiry: 1, duration: 2 } } }));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: hdr, tagLength: 128 }, k, inner));
        return plist({ Response: { Status: { ec: 0 }, et: concat(hdr, iv, ct) } });
      }
    }
    const idOk = headers["X-Apple-Identity-Token"] === b64encode(utf8(`${ADSID}:${IDMS}`));
    if (u.pathname === "/auth/verify/trusteddevice") return plist({}, idOk ? 200 : 401);
    if (u.pathname === "/grandslam/GsService2/validate") {
      if (headers["security-code"] === wrongCode) return plist({ Status: { ec: -21669, em: "Incorrect verification code." } }, 400);
      verified = true;
      return plist({ Status: { ec: 0 } });
    }
    if (u.pathname === "/auth") return json({ trustedPhoneNumbers: [{ id: 3, numberWithDialCode: "+1 (•••) •••-••12" }] });
    if (u.pathname === "/auth/verify/phone") { smsId = JSON.parse(td.decode(body)).phoneNumber.id; return json({}, 200); }
    if (u.pathname === "/auth/verify/phone/securitycode") {
      const j = JSON.parse(td.decode(body));
      if (j.phoneNumber.id !== smsId || j.securityCode.code === wrongCode) return json({ serviceErrors: [{ code: "-21669", title: "Incorrect", message: "code" }] }, 400);
      verified = true;
      return json({});
    }
    if (u.host === "developerservices2.apple.com" && u.pathname === "/services/QH65B2/listTeams.action") {
      if (headers["X-Apple-GS-Token"] !== APP_TOKEN || headers["X-Apple-I-Identity-Id"] !== ADSID) return plist({ resultCode: 1100, resultString: "Your session has expired" });
      return plist({ resultCode: 0, teams: [{ teamId: "TEAM123456", name: "Spare Account (Personal Team)", type: "Individual" }] });
    }
    return { status: 404, headers: {}, body: new Uint8Array() };
  } };
}
const fakeAnisette = { get: async () => ({ headers: { "X-Apple-I-MD": "md-value", "X-Apple-I-MD-M": "mdm" }, cpd: { "X-Apple-I-MD": "md-value" },
  clientInfo: "<Mac> <macOS> <akd>", userAgent: "akd/1.0" }) };

test("sign-in: SRP, trusted-device code, Xcode app token, listTeams", async () => {
  const apple = fakeApple({ twoFactor: "device" });
  const s = new AppleIdSession({ transport: apple.transport, anisette: fakeAnisette });
  assert.deepEqual(await s.login(EMAIL, PASSWORD), { step: "device", au: "trustedDeviceSecondaryAuth" });
  assert.equal(s.adsid, ADSID);
  assert.equal(s.displayName, "Spare Account");
  assert.equal(s.spdKeyVariant, "K");
  assert.ok(s.password, "kept until 2FA is through");
  assert.equal(await s.requestDeviceCode(), true);
  await assert.rejects(s.verifyDeviceCode("000000"), (e) => e instanceof AppleIdError && e.code === -21669);
  assert.deepEqual(await s.verifyDeviceCode(" 123456 "), { step: "done", au: null });
  assert.equal(s.password, null, "the password is dropped once signed in");
  const t = await s.appToken();
  assert.equal(t.token, APP_TOKEN);
  const teams = await new DevPortal({ transport: apple.transport, anisette: fakeAnisette, token: t.token, adsid: s.adsid }).listTeams();
  assert.deepEqual(teams.map((x) => x.teamId), ["TEAM123456"]);
  await assert.rejects(new DevPortal({ transport: apple.transport, anisette: fakeAnisette, token: "stale", adsid: s.adsid }).listTeams(),
    (e) => e instanceof DevPortalError && e.kind === "session" && e.code === 1100);
  // Every request carries Apple's client headers, and the password never goes out.
  for (const r of apple.seen) assert.ok(!JSON.stringify(r).includes(PASSWORD));
});

test("sign-in: SMS code, s2k_fo, no URL bag", async () => {
  const apple = fakeApple({ twoFactor: "sms", protocol: "s2k_fo", bag: false });
  const s = new AppleIdSession({ transport: apple.transport, anisette: fakeAnisette });
  assert.equal((await s.login(EMAIL, PASSWORD)).step, "sms");
  const phones = await s.trustedPhones();
  assert.deepEqual(phones, [{ id: 3, number: "+1 (•••) •••-••12" }]);
  assert.equal(await s.requestSmsCode(3), true);
  await assert.rejects(s.verifySmsCode(3, "000000"), (e) => String(e.code) === "-21669");
  assert.equal((await s.verifySmsCode(3, "654321")).step, "done");
});

test("sign-in: wrong password, unknown Apple ID", async () => {
  const apple = fakeApple({ twoFactor: null });
  const s = new AppleIdSession({ transport: apple.transport, anisette: fakeAnisette });
  await assert.rejects(s.login(EMAIL, "wrong"), (e) => e.code === -20101 && signInAlert(e).kind === "wrong-password");
  await assert.rejects(new AppleIdSession({ transport: apple.transport, anisette: fakeAnisette }).login("nobody@example.invalid", "x"),
    (e) => e.code === -20970 && signInAlert(e).title === "Apple ID Not Found");
  assert.equal((await new AppleIdSession({ transport: apple.transport, anisette: fakeAnisette }).login(EMAIL, PASSWORD)).step, "done");
});

test("alerts for Apple's error codes", () => {
  const now = new Date("2026-11-19T10:00:00Z");
  const r = signInAlert(new AppleIdError("refused", { code: -36607 }), { now });
  assert.equal(r.kind, "rejected");
  assert.equal(r.waitUntil, "2026-11-19T10:15:00.000Z");
  assert.match(r.message, /10:15 UTC/);
  assert.equal(signInAlert({ code: -20209, message: "locked" }).kind, "locked");
  assert.equal(signInAlert({ code: "-21669" }).kind, "wrong-code");
  assert.match(signInAlert(new AppleIdError("odd", { code: -1, step: "SRP init" })).message, /Step: SRP init\. Apple error -1: odd/);
});

test("relayTransport: /apple/<host>/<path>, User-Agent as X-Relay-User-Agent, relay refusals throw", async () => {
  const calls = [];
  const t = relayTransport({ fetcher: async (url, init) => {
    calls.push({ url, init });
    if (url.includes("blocked")) return new Response(JSON.stringify({ code: "not_allowed", error: "not on the list" }), { status: 403 });
    return new Response("<plist/>", { status: 401, headers: { "X-Relay-Status": "401", "Content-Type": "text/x-xml-plist" } });
  } });
  const r = await t({ url: "https://gsa.apple.com/grandslam/GsService2?x=1", method: "POST", headers: { "User-Agent": "akd/1.0", "X-Apple-I-MD": "m" }, body: utf8("b") });
  assert.equal(calls[0].url, "/apple/gsa.apple.com/grandslam/GsService2?x=1");
  assert.deepEqual(calls[0].init.headers, { "X-Relay-User-Agent": "akd/1.0", "X-Apple-I-MD": "m" });
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(r.status, 401); // Apple's status, passed through
  assert.equal(r.headers["content-type"], "text/x-xml-plist");
  await assert.rejects(t({ url: "https://blocked.example/" }), (e) => e.relay && e.status === 403 && /not on the list/.test(e.message));
  assert.equal(relayWsUrl("https://ani.sidestore.io", "https://preview.example"), "wss://preview.example/apple/ani.sidestore.io/v3/provisioning_session");
});

test("anisette v3: provisions a machine over the WebSocket, then gets headers", async () => {
  const sent = [], gets = [];
  let saved = null;
  const transport = async ({ url, method, body }) => {
    const u = new URL(url);
    const j = (o) => ({ status: 200, headers: {}, body: utf8(JSON.stringify(o)) });
    if (u.pathname === "/v3/client_info") return j({ client_info: "<ci>", user_agent: "ua" });
    if (u.pathname === "/grandslam/GsService2/lookup") return { status: 200, headers: {}, body: utf8(encodePlist({ urls: {} })) };
    if (u.pathname.endsWith("startMachineProvisioning")) return { status: 200, headers: {}, body: utf8(encodePlist({ Response: { spim: "SPIM" } })) };
    if (u.pathname.endsWith("finishMachineProvisioning")) {
      assert.equal(decodePlist(body).Request.cpim, "CPIM");
      return { status: 200, headers: {}, body: utf8(encodePlist({ Response: { ptm: "PTM", tk: "TK" } })) };
    }
    if (u.pathname === "/v3/get_headers" && method === "POST") {
      gets.push(JSON.parse(td.decode(body)));
      return j({ result: "Headers", "X-Apple-I-MD": "md", "X-Apple-I-MD-M": "mdm", "X-Apple-I-MD-RINFO": 17106176 });
    }
    return { status: 404, headers: {}, body: new Uint8Array() };
  };
  class FakeWs {
    constructor(url) {
      this.url = url;
      this.script = [{ result: "GiveIdentifier" }, { result: "GiveStartProvisioningData" }, { result: "GiveEndProvisioningData", cpim: "CPIM" },
        { result: "ProvisioningSuccess", adi_pb: "ADIPB" }];
      setTimeout(() => this.next(), 0);
    }
    next() { const m = this.script.shift(); if (m) this.onmessage({ data: JSON.stringify(m) }); }
    send(s) { sent.push(JSON.parse(s)); setTimeout(() => this.next(), 0); }
    close() {}
  }
  const ani = anisetteV3({ transport, servers: ["https://ani.example"], storage: { load: () => null, save: (s) => { saved = s; } },
    wsUrl: (s) => relayWsUrl(s, "https://site.example"), WebSocketImpl: FakeWs });
  const h = await ani.get();
  assert.deepEqual(sent.map((m) => Object.keys(m)[0]), ["identifier", "spim", "ptm"]);
  assert.deepEqual(sent[2], { ptm: "PTM", tk: "TK" });
  assert.equal(saved.adi_pb, "ADIPB");
  assert.equal(saved.server, "https://ani.example");
  assert.equal(gets[0].adi_pb, "ADIPB");
  assert.equal(h.headers["X-Apple-I-MD"], "md");
  assert.equal(h.headers["X-Apple-I-MD-RINFO"], "17106176");
  assert.match(h.headers["X-Mme-Device-Id"], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.match(h.headers["X-Apple-I-MD-LU"], /^[0-9a-f]{64}$/);
  assert.equal(h.cpd["X-Apple-I-MD"], "md");
  assert.equal(h.userAgent, "ua");
  // A saved machine is reused: no new provisioning.
  sent.length = 0;
  const again = anisetteV3({ transport, servers: ["https://ani.example"], storage: { load: () => saved }, WebSocketImpl: FakeWs });
  await again.get();
  assert.equal(sent.length, 0);
  assert.equal(gets.at(-1).identifier, saved.identifier);
});

// B498: a fake provisioning socket and MidService, with Apple's 503s and dropped sockets on demand.
function rig({ statuses = {}, drops = [] } = {}) {
  const mids = [], sockets = [];
  const ok = (o) => ({ status: 200, headers: {}, body: utf8(JSON.stringify(o)) });
  const transport = async ({ url }) => {
    const u = new URL(url);
    if (u.pathname === "/v3/client_info") return ok({ client_info: "<ci>", user_agent: "ua" });
    if (u.pathname === "/v3/get_headers") return ok({ result: "Headers", "X-Apple-I-MD": "md", "X-Apple-I-MD-M": "mdm" });
    if (!u.pathname.includes("MidService")) return { status: 404, headers: {}, body: new Uint8Array() };
    const step = u.pathname.endsWith("startMachineProvisioning") ? "start" : "finish";
    mids.push(step);
    const status = statuses[step]?.shift() ?? 200;
    return { status, headers: {}, body: utf8(encodePlist({ Response: { spim: "SPIM", ptm: "PTM", tk: "TK" } })) };
  };
  class Ws {
    constructor(url) {
      this.drop = drops.shift(); // how many messages arrive before the socket breaks
      this.script = [{ result: "GiveIdentifier" }, { result: "GiveStartProvisioningData" }, { result: "GiveEndProvisioningData", cpim: "C" },
        { result: "ProvisioningSuccess", adi_pb: "ADIPB" }];
      sockets.push(new URL(url).pathname.split("/")[2]);
      setTimeout(() => this.next(), 0);
    }
    next() {
      if (this.drop === 0) return this.onerror();
      if (this.drop) this.drop--;
      this.onmessage({ data: JSON.stringify(this.script.shift()) });
    }
    send() { setTimeout(() => this.next(), 0); }
    close() {}
  }
  const ani = anisetteV3({ transport, servers: ["https://a.example", "https://b.example"], wsUrl: (s) => relayWsUrl(s, "https://site.example"),
    WebSocketImpl: Ws });
  return { ani, mids, sockets };
}

test("anisette v3: MidService's 503 moves on to the next server, without asking again", async () => {
  const r = rig({ statuses: { start: [503] } });
  assert.equal((await r.ani.get()).server, "https://b.example");
  assert.deepEqual(r.mids, ["start", "start", "finish"]);
  assert.deepEqual(r.sockets, ["a.example", "b.example"]);
});

test("anisette v3: a socket dropped part way is tried once more; one that never talks isn't", async () => {
  const once = rig({ drops: [3] });
  assert.equal((await once.ani.get()).server, "https://a.example");
  assert.deepEqual(once.sockets, ["a.example", "a.example"]);
  const twice = rig({ drops: [3, 3] });
  assert.equal((await twice.ani.get()).server, "https://b.example");
  assert.deepEqual(twice.sockets, ["a.example", "a.example", "b.example"]);
  const dead = rig({ drops: [0] });
  await dead.ani.get();
  assert.deepEqual(dead.sockets, ["a.example", "b.example"]);
});

// B498a: BariStore's working order, then lillq.me, which provisioned end to end in B498's checks.
test("anisette: the servers, in the order they're tried", () => {
  assert.deepEqual(ANISETTE_SERVERS.map((s) => new URL(s).host), ["new.ani.sidestore.io", "mac-ani.jkcoxson.com", "ani.iloader.app",
    "ani3.stikstore.app", "ani.jkcoxson.com", "ani2.stikstore.app", "win.ani.sidestore.io", "anisette.lillq.me"]);
});

test("Apple sign-in: with no anisette client info, the fallback isn't an Android-library one", () => {
  const info = new AppleIdSession({}).baseHeaders()["X-MMe-Client-Info"];
  assert.match(info, /^<MacBookPro13,3> <Mac OS X;10\.12\.6;16G29> /);
});

test("anisette: every server is on the relay's list, in the same order", async () => {
  const { ANISETTE_HOSTS } = await import("../../../worker/src/apple-relay.js");
  assert.deepEqual(ANISETTE_SERVERS.map((s) => new URL(s).host), ANISETTE_HOSTS);
});

test("anisette: a server on Apple's Android library is skipped before any provisioning", async () => {
  const asked = [], opened = [];
  for (const client_info of ["<MacBookPro13,2> <macOS;13.1;22C65> <x>", "<MacBookPro15,1> <Mac OS X;10.15.2;19C57> <x>", "<Pixel> <Android;14> <x>"]) {
    const transport = async ({ url }) => { asked.push(new URL(url).pathname); return { status: 200, headers: {}, body: utf8(JSON.stringify({ client_info, user_agent: "ua" })) }; };
    const ani = anisetteV3({ transport, servers: ["https://a.example"], wsUrl: (s) => s, WebSocketImpl: class { constructor(u) { opened.push(u); } } });
    await assert.rejects(ani.get(), /Android library/);
  }
  assert.deepEqual([...new Set(asked)], ["/v3/client_info"]);
  assert.deepEqual(opened, []);
});

// B498c: sign-in rotating servers x claims, against the fake GrandSlam behind two anisette servers.
const OLD_MAC = "<MacBookPro13,3> <Mac OS X;10.12.6;16G29> <com.apple.AuthKit/1 (com.apple.akd/1.0)>";
const NEW_MAC = "<MacBookPro18,3> <macOS;26.6;25F84> <com.apple.AuthKit/1 (com.apple.akd/1.0)>";
const NEW_UA = "AuthKit/1 (Macintosh; OS X 26.6) (com.apple.akd/1.0)";

// refuse(server, claim, op) -> 503 | -23782 | another ec | undefined (Apple takes it).
function routed({ refuse = () => {}, infos = {}, saved = null, twoFactor = null } = {}) {
  const apple = fakeApple({ twoFactor }), tried = [], provisioned = [];
  let store = saved, asking = null, inits = [];
  const ok = (o) => ({ status: 200, headers: {}, body: utf8(JSON.stringify(o)) });
  const transport = async (req) => {
    const u = new URL(req.url);
    if (u.pathname === "/v3/client_info") {
      const i = infos[u.host] ?? { client_info: OLD_MAC, user_agent: "" };
      return i === "down" ? { status: 502, headers: {}, body: new Uint8Array() } : ok(i);
    }
    if (u.pathname === "/v3/get_headers") { asking = u.host; return ok({ result: "Headers", "X-Apple-I-MD": "md-value", "X-Apple-I-MD-M": "mdm" }); }
    if (u.pathname.includes("MidService")) return { status: 200, headers: {}, body: utf8(encodePlist({ Response: { spim: "S", ptm: "P", tk: "T" } })) };
    if (u.pathname === "/grandslam/GsService2" && req.method === "POST") {
      const r = decodePlist(req.body).Request;
      const claim = req.headers["X-MMe-Client-Info"] === NEW_MAC ? "mac" : "advertised";
      if (r.o === "init") { inits.push(req.headers); tried.push(`${asking[0]} ${claim}`); }
      const no = refuse(asking[0], claim, r.o);
      if (no === 503) return { status: 503, headers: {}, body: new Uint8Array() };
      if (no) return { status: 200, headers: {}, body: utf8(encodePlist({ Response: { Status: { ec: no, em: "refused" } } })) };
    }
    return apple.transport(req);
  };
  class Ws {
    constructor(url) {
      this.host = new URL(url).pathname.split("/")[2];
      this.script = [{ result: "GiveIdentifier" }, { result: "ProvisioningSuccess", adi_pb: `PB${provisioned.length}` }];
      setTimeout(() => this.next(), 0);
    }
    next() { this.onmessage({ data: JSON.stringify(this.script.shift()) }); }
    send(s) { provisioned.push({ host: this.host[0], identifier: JSON.parse(s).identifier }); setTimeout(() => this.next(), 0); }
    close() {}
  }
  const storage = { load: () => store, save: (s) => { store = structuredClone(s); } };
  const make = () => anisetteV3({ transport, servers: ["https://a.example", "https://b.example"], storage,
    wsUrl: (s) => relayWsUrl(s, "https://site.example"), WebSocketImpl: Ws });
  const session = () => new AppleIdSession({ transport, anisette: make() });
  return { session, make, tried, inits, provisioned, apple, get store() { return store; } };
}

test("sign-in: exactly the advertised client, akd's user agent when none, the email lowercased", async () => {
  const r = routed();
  const s = r.session();
  assert.equal((await s.login(`  ${EMAIL.toUpperCase()} `, PASSWORD)).step, "done"); // the fake knows only the lowercase one
  assert.equal(s.email, EMAIL);
  assert.equal(r.inits[0]["X-MMe-Client-Info"], OLD_MAC);
  assert.equal(r.inits[0]["User-Agent"], "akd/1.0 CFNetwork/808.1.4");
  const own = routed({ infos: { "a.example": { client_info: `${OLD_MAC} `, user_agent: "akd/x" } } });
  await own.session().login(EMAIL, PASSWORD);
  assert.equal(own.inits[0]["X-MMe-Client-Info"], `${OLD_MAC} `);
  assert.equal(own.inits[0]["User-Agent"], "akd/x");
});

test("sign-in: a 503 moves to the next server x claim, never the same one twice", async () => {
  const r = routed({ refuse: (server, claim) => (server === "a" || claim === "advertised" ? 503 : undefined) });
  assert.equal((await r.session().login(EMAIL, PASSWORD)).step, "done");
  assert.deepEqual(r.tried, ["a advertised", "a mac", "b advertised", "b mac"]);
  assert.deepEqual([r.store.server, r.store.claim], ["https://b.example", "mac"]);
  // a 503 on the password check, after init, rotates too
  const late = routed({ refuse: (server, claim, op) => (op === "complete" && server === "a" ? 503 : undefined) });
  assert.equal((await late.session().login(EMAIL, PASSWORD)).step, "done");
  assert.deepEqual(late.tried, ["a advertised", "a mac", "b advertised"]);
  const all = routed({ refuse: () => 503 });
  await assert.rejects(all.session().login(EMAIL, PASSWORD), (e) => e.status === 503);
  assert.equal(all.tried.length, 4);
});

test("sign-in: -23782 retries as a current Mac, only through a server that names a Mac", async () => {
  const r = routed({ refuse: (server, claim) => (claim === "advertised" ? -23782 : undefined) });
  assert.equal((await r.session().login(EMAIL, PASSWORD)).step, "done");
  assert.deepEqual(r.tried, ["a advertised", "a mac"]);
  assert.equal(r.inits[1]["X-MMe-Client-Info"], NEW_MAC);
  assert.equal(r.inits[1]["User-Agent"], NEW_UA);
  const win = routed({ infos: { "a.example": { client_info: "<PC> <Windows;6.2(0,0);9200> <x>", user_agent: "w" } },
    refuse: (server, claim) => (server === "a" ? -23782 : undefined) });
  await win.session().login(EMAIL, PASSWORD);
  assert.deepEqual(win.tried, ["a advertised", "b advertised"]);
});

test("sign-in: credential errors and anything else Apple says stop the rotation", async () => {
  for (const ec of [-22406, -20101, -20970, -36607]) {
    const r = routed({ refuse: () => ec });
    await assert.rejects(r.session().login(EMAIL, PASSWORD), (e) => e.code === ec);
    assert.deepEqual(r.tried, ["a advertised"], String(ec));
  }
  const wrong = routed();
  await assert.rejects(wrong.session().login(EMAIL, "not it"), (e) => e.code === -20101);
  assert.deepEqual(wrong.tried, ["a advertised"]);
});

test("sign-in: a server that's down is passed over; with none up, the anisette error", async () => {
  const r = routed({ infos: { "a.example": "down" } });
  await r.session().login(EMAIL, PASSWORD);
  assert.deepEqual(r.tried, ["b advertised"]);
  const none = routed({ infos: { "a.example": "down", "b.example": "down" } });
  await assert.rejects(none.session().login(EMAIL, PASSWORD), /No anisette server could provision.*502/);
});

test("anisette: one identity per (server, client info), kept and reused", async () => {
  const r = routed({ refuse: (server, claim) => (server === "a" || claim === "advertised" ? 503 : undefined) });
  await r.session().login(EMAIL, PASSWORD);
  assert.deepEqual(r.provisioned.map((p) => p.host), ["a", "a", "b", "b"]);
  assert.equal(new Set(r.provisioned.map((p) => p.identifier)).size, 4);
  // a new page signs in on the pair that worked, then the others find their identities again
  r.tried.length = 0;
  const ani = r.make();
  assert.deepEqual(ani.current, { server: "https://b.example", claim: "mac" });
  assert.equal((await ani.get()).clientInfo, NEW_MAC);
  await ani.use("https://a.example", "advertised");
  await ani.use("https://a.example", "mac");
  await ani.use("https://b.example", "advertised");
  assert.equal(r.provisioned.length, 4);
  assert.equal(r.store.identifier, r.provisioned[2].identifier);
  assert.equal(Object.keys(r.store.others).length, 3);
  await ani.use("https://b.example", "mac");
  const again = r.session(); // loads the stored pair
  await again.login(EMAIL, PASSWORD);
  assert.deepEqual(r.tried, ["b mac"]);
});

test("anisette: a machine saved without its client info is the advertised one's", async () => {
  const saved = { identifier: b64encode(new Uint8Array(16)), adi_pb: "OLD", server: "https://a.example" };
  const r = routed({ saved });
  const ani = r.make();
  await ani.use("https://a.example", "mac");
  assert.equal(r.provisioned.length, 1);
  await ani.use("https://a.example", "advertised");
  assert.equal(r.provisioned.length, 1);
  assert.deepEqual([r.store.identifier, r.store.adi_pb], [saved.identifier, "OLD"]);
});

test("sign-in: the code check signs in again with the same server and claim", async () => {
  const r = routed({ twoFactor: "device", refuse: (server, claim) => (claim === "advertised" ? -23782 : undefined) });
  const s = r.session();
  assert.equal((await s.login(EMAIL, PASSWORD)).step, "device");
  r.tried.length = 0;
  assert.equal((await s.verifyDeviceCode("123456")).step, "done");
  assert.deepEqual(r.tried, ["a mac"]);
});
