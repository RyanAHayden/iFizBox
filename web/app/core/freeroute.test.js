// F254: the free Apple ID route's key, CSR and .p12 (core/freecert.js), and its setup checklist (core/freeroute.js)
// against a fake developer portal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeKey, makeCsr, makeP12, unpem, tlv, seq, oid, OIDS, certSpki, certSerial, sameKey, storedZip, crc32 } from "./freecert.js";
import { runSetup, freeAppId, pickTeam, freeEntitlements, freeExpiry, FREE_EXPIRY_WARNING, setupError, SETUP_STEPS,
  atCertLimit, otherTool, MACHINE_NAME } from "./freeroute.js";
import { der, children, checkP12Password, oidString } from "./signing.js";
import { unzipEntries } from "./certfiles.js";
import { DevPortal, encodePlist } from "./gsa.js";

const subtle = globalThis.crypto.subtle;
const nodeAt = (b, path) => { let n = der(b, 0); for (const i of path) n = children(b, n)[i]; return n; };
const raw = (b, n, from) => b.slice(from, n.end);

// A certificate-shaped DER (enough for certSpki/certSerial/sameKey): tbs with version, serial, …, subjectPublicKeyInfo.
function fakeCert(spki, serial = [0x00, 0x8a, 0x01]) {
  const alg = seq(oid(OIDS.rsaSha256), Uint8Array.of(5, 0));
  const tbs = seq(tlv(0xa0, tlv(0x02, Uint8Array.of(2))), tlv(0x02, Uint8Array.from(serial)), alg, seq(), seq(), seq(), spki);
  return seq(tbs, alg, tlv(0x03, Uint8Array.of(0, 1)));
}

let realKey;
const key = async () => (realKey ??= await makeKey());

test("CSR: PKCS#10 with our public key, signed with SHA-256 RSA (WebCrypto verifies it)", async () => {
  const k = await key();
  const pemText = await makeCsr({ privateKey: k.privateKey, spki: k.spki, cn: "Test", o: "Org" });
  assert.match(pemText, /^-----BEGIN CERTIFICATE REQUEST-----\n/);
  const csr = unpem(pemText);
  const [info, alg, sig] = children(csr, der(csr, 0));
  assert.equal(oidString(csr, children(csr, alg)[0]), OIDS.rsaSha256);
  const infoKids = children(csr, info);
  assert.deepEqual(raw(csr, infoKids[2], infoKids[1].end), k.spki);
  const pub = await subtle.importKey("spki", k.spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const infoBytes = csr.slice(0, info.end).slice(der(csr, 0).start);
  assert.ok(await subtle.verify("RSASSA-PKCS1-v1_5", pub, csr.slice(sig.start + 1, sig.end), infoBytes));
});

test(".p12: MAC opens with the password (checkP12Password), the key bag decrypts back to the key", async () => {
  const k = await key();
  const cert = fakeCert(k.spki);
  const p12 = await makeP12({ pkcs8: k.pkcs8, cert, password: "pa55", iterations: 1000 });
  assert.equal(await checkP12Password(p12, "pa55"), true);
  assert.equal(await checkP12Password(p12, "wrong"), false);
  // authSafe -> second ContentInfo (key) -> SafeContents -> SafeBag -> [0] EncryptedPrivateKeyInfo
  const authSafeOct = nodeAt(p12, [1, 1, 0]);
  const authSafe = p12.slice(authSafeOct.start, authSafeOct.end);
  const keyCI = nodeAt(authSafe, [1, 1, 0]);
  const safe = authSafe.slice(keyCI.start, keyCI.end);
  const epki = nodeAt(safe, [0, 1, 0]);
  const [algId, enc] = children(safe, epki);
  const [, params] = children(safe, algId);
  const [kdf, cipher] = children(safe, params);
  const [salt, iters] = children(safe, children(safe, kdf)[1]);
  const iv = children(safe, cipher)[1];
  let n = 0;
  for (let i = iters.start; i < iters.end; i++) n = n * 256 + safe[i];
  assert.equal(n, 1000);
  const base = await subtle.importKey("raw", new TextEncoder().encode("pa55"), "PBKDF2", false, ["deriveKey"]);
  const aes = await subtle.deriveKey({ name: "PBKDF2", salt: safe.slice(salt.start, salt.end), iterations: n, hash: "SHA-256" },
    base, { name: "AES-CBC", length: 256 }, false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv: safe.slice(iv.start, iv.end) }, aes, safe.slice(enc.start, enc.end)));
  assert.deepEqual(plain, k.pkcs8);
});

test("certificate fields: spki, serial without the sign byte, sameKey", async () => {
  const k = await key();
  const cert = fakeCert(k.spki);
  assert.deepEqual(certSpki(cert), k.spki);
  assert.equal(certSerial(cert), "8A01");
  assert.equal(sameKey(cert, k.spki), true);
  assert.equal(sameKey(cert, k.spki.slice(1)), false);
  assert.equal(sameKey(new Uint8Array([1, 2]), k.spki), false);
});

test("storedZip: the app's import reads it back (certfiles unzipEntries), CRC-32 check value", async () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const files = [{ name: "dev.p12", data: Uint8Array.of(1, 2, 3) }, { name: "password.txt", data: new TextEncoder().encode("pw") }];
  const back = await unzipEntries(storedZip(files));
  const names = back.map((e) => e.name ?? e.file?.name).sort();
  assert.deepEqual(names, ["dev.p12", "password.txt"]);
});

test("App IDs: <id>.<TEAMID>, never twice; the free team is picked", () => {
  assert.equal(freeAppId("com.example.app", "AB12CD34EF"), "com.example.app.AB12CD34EF");
  assert.equal(freeAppId("com.example.app.AB12CD34EF", "AB12CD34EF"), "com.example.app.AB12CD34EF");
  assert.equal(pickTeam([{ teamId: "P", type: "Company/Organization" }, { teamId: "F", type: "Individual", xcodeFreeOnly: true }]).teamId, "F");
  assert.equal(pickTeam([{ teamId: "X" }]).teamId, "X");
  assert.equal(pickTeam([]), null);
});

test("free entitlements: get-task-allow as the profile allows, no push, the profile's keychain group", () => {
  const profile = { Entitlements: { "get-task-allow": true, "keychain-access-groups": ["T.*"] } };
  assert.deepEqual(freeEntitlements({ "aps-environment": "production", "get-task-allow": false, "x": 1 }, profile),
    { "get-task-allow": true, "keychain-access-groups": ["T.*"], x: 1 });
  assert.equal(freeEntitlements({}, { entitlements: {} })["get-task-allow"], false);
  // F436: a team-wide group is narrowed to the app's own; a group that doesn't cover the app is kept as the profile has it
  assert.deepEqual(freeEntitlements({ "application-identifier": "T.com.example.x.T" }, profile)["keychain-access-groups"], ["T.com.example.x.T"]);
  assert.deepEqual(freeEntitlements({ "application-identifier": "U.com.example.x" }, profile)["keychain-access-groups"], ["T.*"]);
});

test("expiry: soon 3 days before the 7-day profile ends", () => {
  const now = new Date("2026-11-19T00:00:00Z");
  assert.equal(FREE_EXPIRY_WARNING, 3);
  assert.deepEqual(freeExpiry(new Date("2026-11-26T00:00:00Z"), now), { state: "ok", days: 7 });
  assert.deepEqual(freeExpiry(new Date("2026-11-22T00:00:00Z"), now), { state: "soon", days: 3 });
  assert.equal(freeExpiry(new Date("2026-11-18T00:00:00Z"), now).state, "expired");
  assert.equal(freeExpiry(null, now).state, "ok");
});

// ---- runSetup against a fake portal ----
const TEAM = "AB12CD34EF";
const UDID = "00008130-0011223344556677";
const profileBytes = (udids) => new TextEncoder().encode(`junk${encodePlist({ Name: "iOS Team Provisioning Profile",
  TeamIdentifier: [TEAM], ExpirationDate: new Date("2026-11-26T00:00:00Z"), ProvisionedDevices: udids,
  Entitlements: { "application-identifier": `${TEAM}.com.x.${TEAM}`, "get-task-allow": true } })}junk`);

function fakePortal({ devices = [], certs = [], appIds = [], limit = false, profileUdids = [UDID] } = {}) {
  const log = [];
  let submitted = 0;
  const p = {
    log,
    async listDevices() { log.push("listDevices"); return devices; },
    async addDevice(t, udid) { log.push(`addDevice ${udid}`); devices.push({ deviceNumber: udid }); },
    async listCerts() { log.push("listCerts"); return certs; },
    async submitCsr(t, csr, machine) {
      log.push(`submitCsr ${machine}`);
      if (limit && submitted++ === 0) throw Object.assign(new Error("You already have a current iOS Development certificate"), { code: 7460 });
      certs.push({ serialNumber: "NEW1", status: "Issued", certContent: p.newCert, expirationDate: "2027-11-19T00:00:00Z" });
    },
    async revokeCert(t, serial) { log.push(`revoke ${serial}`); certs.find((c) => c.serialNumber === serial).status = "Revoked"; },
    async listAppIds() { log.push("listAppIds"); return { appIds }; },
    async addAppId(t, identifier) { log.push(`addAppId ${identifier}`); const a = { identifier, appIdId: "ID1" }; appIds.push(a); return a; },
    async downloadProfile(t, id) { log.push(`downloadProfile ${id}`); return { encodedProfile: profileBytes(profileUdids) }; },
  };
  return p;
}
// Fast stand-ins for the RSA work: the "key" is a fake SPKI and the "certificate" carries it.
function fakeMake(portal) {
  const spki = seq(seq(oid("1.2.840.113549.1.1.1")), tlv(0x03, Uint8Array.of(0, 9, 9)));
  portal.newCert = fakeCert(spki, [0x0f, 0x0e]);
  return { key: async () => ({ privateKey: null, spki, pkcs8: Uint8Array.of(7) }), csr: async () => "CSR",
    password: () => "pw", p12: async ({ cert, password }) => Uint8Array.of(cert.length & 0xff, password.length) };
}

test("setup: new phone, no certificate, no App ID -> every step runs and ticks in order", async () => {
  const portal = fakePortal();
  const events = [];
  const r = await runSetup({ portal, teamId: TEAM, phone: { udid: UDID.toLowerCase() }, bundleId: "com.x", make: fakeMake(portal),
    onStep: (e) => events.push(`${e.id}:${e.state}`) });
  assert.deepEqual(events, SETUP_STEPS.flatMap((s) => [`${s.id}:running`, `${s.id}:done`]));
  assert.deepEqual(portal.log, ["listDevices", `addDevice ${UDID}`, "listCerts", `submitCsr ${MACHINE_NAME}`, "listCerts",
    "listAppIds", `addAppId com.x.${TEAM}`, "downloadProfile ID1"]);
  assert.equal(r.identity.serial, "0F0E");
  assert.equal(r.identity.made, true);
  assert.equal(r.identity.password, "pw");
  assert.equal(r.identity.teamId, TEAM);
  assert.equal(r.appId, `com.x.${TEAM}`);
  assert.equal(r.profile.info.getTaskAllow, true);
  assert.match(r.steps.profile, /2026-11-26/);
});

test("setup: everything already there -> reuses the saved certificate and App ID, adds nothing", async () => {
  const portal = fakePortal({ devices: [{ deviceNumber: UDID }], certs: [{ serialNumber: "AA01", status: "Issued" }],
    appIds: [{ identifier: `com.x.${TEAM}`, appIdId: "OLD" }] });
  const saved = { teamId: TEAM, serial: "AA01", p12: Uint8Array.of(1), password: "s" };
  const r = await runSetup({ portal, teamId: TEAM, phone: { udid: UDID }, saved, bundleId: "com.x", make: fakeMake(portal) });
  assert.deepEqual(portal.log, ["listDevices", "listCerts", "listAppIds", "downloadProfile OLD"]);
  assert.equal(r.identity.made, false);
  assert.equal(r.identity.password, "s");
  assert.equal(r.steps.device, "Already on the account");
  assert.match(r.steps.certificate, /Reused/);
});

test("setup: in the app the reuse summary names no browser", async () => {
  const saved = { teamId: TEAM, serial: "AA01", p12: Uint8Array.of(1), password: "s" };
  const run = (app) => {
    const portal = fakePortal({ devices: [{ deviceNumber: UDID }], certs: [{ serialNumber: "AA01", status: "Issued" }],
      appIds: [{ identifier: `com.x.${TEAM}`, appIdId: "OLD" }] });
    return runSetup({ portal, teamId: TEAM, phone: { udid: UDID }, saved, bundleId: "com.x", make: fakeMake(portal), app });
  };
  const inApp = await run(true);
  assert.equal(inApp.steps.certificate, "Reused the saved certificate");
  assert.doesNotMatch(inApp.steps.certificate, /browser|website/i);
  assert.equal((await run(false)).steps.certificate, "Reused this browser's certificate");
});

test("setup: a revoked saved certificate is replaced", async () => {
  const portal = fakePortal({ certs: [{ serialNumber: "AA01", status: "Revoked" }] });
  const r = await runSetup({ portal, teamId: TEAM, phone: { udid: UDID }, saved: { teamId: TEAM, serial: "AA01", p12: Uint8Array.of(1), password: "s" },
    bundleId: "com.x", make: fakeMake(portal) });
  assert.equal(r.identity.made, true);
});

// B478, checked on the iPhone 15 Pro: Apple's listAllDevelopmentCerts serialNumber is the same upper-case hex as
// certSerial() of its certContent, so the record a computer install carried (web/free-id.json) is reused as is.
test("B478: a computer install's carried certificate is reused while Apple lists it as issued", async () => {
  const spki = seq(seq(oid("1.2.840.113549.1.1.1")), tlv(0x03, Uint8Array.of(0, 4, 2)));
  const cert = fakeCert(spki, [0x6c, 0x76, 0x16, 0xe2]);
  const portal = fakePortal({ devices: [{ deviceNumber: UDID }], appIds: [{ identifier: `com.x.${TEAM}`, appIdId: "OLD" }], certs: [
    { serialNumber: "1DB66FCB", status: "Issued", machineName: "iloader" },
    { serialNumber: "6C7616E2", status: "Issued", machineName: MACHINE_NAME }] }); // Apple's own string, no certContent
  const saved = { teamId: TEAM, serial: certSerial(cert), p12: Uint8Array.of(1), password: "s" };
  const r = await runSetup({ portal, teamId: TEAM, phone: { udid: UDID }, saved, bundleId: "com.x", make: fakeMake(portal),
    askRevoke: async () => assert.fail("no Certificate Limit alert while the carried certificate is issued") });
  assert.equal(r.identity.made, false);
  assert.equal(r.identity.serial, "6C7616E2");
  assert.ok(!portal.log.some((l) => l.startsWith("submitCsr")));
});

// B478: what R103 saw. The carried certificate had been revoked elsewhere (another setup with the same Apple ID), so it is
// not in Apple's list at all: a new one is needed, and at the limit the alert asks; Cancel stops with nothing revoked.
test("B478: a carried certificate revoked elsewhere is not reused; at the limit Cancel revokes nothing", async () => {
  const portal = fakePortal({ devices: [{ deviceNumber: UDID }], limit: true, certs: [
    { serialNumber: "1DB66FCB", status: "Issued", machineName: "iloader" },
    { serialNumber: "15B426F3", status: "Issued", machineName: MACHINE_NAME }] });
  let offered = null;
  await assert.rejects(runSetup({ portal, teamId: TEAM, phone: { udid: UDID }, bundleId: "com.x", make: fakeMake(portal),
    saved: { teamId: TEAM, serial: "4C360FE9", p12: Uint8Array.of(1), password: "s" },
    askRevoke: async (list) => { offered = list.map((c) => c.serialNumber).sort(); return null; } }),
  (e) => e.kind === "cancelled" && /No certificate was revoked/.test(e.message));
  assert.deepEqual(offered, ["15B426F3", "1DB66FCB"]);
  assert.ok(!portal.log.some((l) => l.startsWith("revoke")));
});

test("setup: at Apple's certificate limit it asks (ours first, other tools last), revokes the pick, retries once", async () => {
  const certs = [{ serialNumber: "SS", status: "Issued", machineName: "SideStore" }, { serialNumber: "WEB", status: "Issued", machineName: MACHINE_NAME }];
  const portal = fakePortal({ certs, limit: true });
  let offered;
  const r = await runSetup({ portal, teamId: TEAM, phone: { udid: UDID }, bundleId: "com.x", make: fakeMake(portal),
    askRevoke: async (list) => { offered = list.map((c) => c.serialNumber); return "WEB"; } });
  assert.deepEqual(offered, ["WEB", "SS"]);
  assert.ok(portal.log.includes("revoke WEB"));
  assert.equal(portal.log.filter((l) => l.startsWith("submitCsr")).length, 2);
  assert.equal(r.identity.made, true);
  assert.equal(otherTool(certs[0]), true);
});

test("setup: at the limit an iloader certificate is offered last, below ours and unknown ones", async () => {
  const certs = [
    { serialNumber: "1DB66FCB", status: "Issued", machineName: "iloader" },
    { serialNumber: "IL2", status: "Issued", name: "iloader" },
    { serialNumber: "UNK", status: "Issued", machineName: "Some Mac" },
    { serialNumber: "WEB", status: "Issued", machineName: MACHINE_NAME },
  ];
  const portal = fakePortal({ certs, limit: true });
  let offered;
  await runSetup({ portal, teamId: TEAM, phone: { udid: UDID }, bundleId: "com.x", make: fakeMake(portal),
    askRevoke: async (list) => { offered = list.map((c) => c.serialNumber); return "WEB"; } });
  assert.deepEqual(offered, ["WEB", "UNK", "1DB66FCB", "IL2"]);
  assert.ok(portal.log.includes("revoke WEB"));
  assert.ok(!portal.log.includes("revoke 1DB66FCB"));
  assert.equal(otherTool(certs[0]), true);
  assert.equal(otherTool(certs[1]), true);
  assert.equal(otherTool(certs[2]), false);
});

test("setup: Cancel at the limit stops at the certificate step, nothing revoked", async () => {
  const portal = fakePortal({ certs: [{ serialNumber: "SS", status: "Issued" }], limit: true });
  const events = [];
  await assert.rejects(runSetup({ portal, teamId: TEAM, phone: { udid: UDID }, bundleId: "com.x", make: fakeMake(portal),
    onStep: (e) => events.push(`${e.id}:${e.state}`) }), (e) => e.kind === "cancelled" && e.step === "certificate");
  assert.equal(events.at(-1), "certificate:failed");
  assert.ok(!portal.log.some((l) => l.startsWith("revoke")));
  assert.equal(setupError({ kind: "cancelled", message: "m" }).title, "Setup Stopped");
});

test("setup: no UDID, a profile without the phone, and portal errors become alerts", async () => {
  await assert.rejects(runSetup({ portal: fakePortal(), teamId: TEAM, phone: null, bundleId: "com.x" }), (e) => e.kind === "no-udid" && e.step === "device");
  const p2 = fakePortal({ profileUdids: ["OTHER"] });
  await assert.rejects(runSetup({ portal: p2, teamId: TEAM, phone: { udid: UDID }, bundleId: "com.x", make: fakeMake(p2) }), (e) => e.step === "profile");
  assert.match(setupError({ kind: "agreement" }).message, /developer\.apple\.com\/account/);
  assert.match(setupError({ kind: "appid-limit" }).message, /10 App IDs a week/);
  assert.deepEqual(setupError({ step: "appId", code: 35, message: "Nope" }), { title: "Setup Failed", message: "App ID: Apple error 35: Nope" });
  assert.equal(atCertLimit({ code: 7460 }), true);
  assert.equal(atCertLimit({ code: 1, message: "other" }), false);
});

test("DevPortal: the setup calls send Apple's action names and parameters", async () => {
  const sent = [];
  const transport = async ({ url, body }) => {
    sent.push({ action: /\/([A-Za-z]+)\.action/.exec(url)[1], ios: url.includes("/ios/"), body: new TextDecoder().decode(body) });
    return { status: 200, body: new TextEncoder().encode(encodePlist({ resultCode: 0, devices: [], certificates: [], appIds: [], appId: { appIdId: "X" },
      provisioningProfile: { encodedProfile: Uint8Array.of(1) } })) };
  };
  const portal = new DevPortal({ transport, anisette: { get: async () => ({ headers: {} }) }, token: "t", adsid: "a" });
  await portal.listDevices(TEAM);
  await portal.addDevice(TEAM, UDID, "iPhone");
  await portal.listCerts(TEAM);
  await portal.submitCsr(TEAM, "CSR", "M");
  await portal.revokeCert(TEAM, "S1");
  await portal.listAppIds(TEAM);
  assert.deepEqual(await portal.addAppId(TEAM, "com.x.T", "My App!"), { appIdId: "X" });
  assert.deepEqual((await portal.downloadProfile(TEAM, "X")).encodedProfile, Uint8Array.of(1));
  assert.deepEqual(sent.map((s) => s.action), ["listDevices", "addDevice", "listAllDevelopmentCerts", "submitDevelopmentCSR",
    "revokeDevelopmentCert", "listAppIds", "addAppId", "downloadTeamProvisioningProfile"]);
  assert.ok(sent.every((s) => s.ios));
  assert.match(sent[1].body, new RegExp(`<key>deviceNumber</key>\\s*<string>${UDID}</string>`));
  assert.match(sent[3].body, /<key>csrContent<\/key>\s*<string>CSR<\/string>/);
  assert.match(sent[6].body, /<key>name<\/key>\s*<string>MyApp<\/string>/);
});

// The website's signer (zsign as WebAssembly, OpenSSL 3) takes a .p12 made here: the fake test identity's key,
// certificate and its CA (fixtures/signing/test-*.der, out of test.p12) packed by makeP12, then a real signing run.
test("zsign WebAssembly signs with a .p12 from makeP12", async (t) => {
  const { existsSync, readFileSync } = await import("node:fs");
  const wasm = new URL("../vendor/zsign/zsign.js", import.meta.url);
  if (!existsSync(wasm)) return t.skip("no vendor/zsign");
  const fx = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/signing/${n}`, import.meta.url)));
  const { default: createZsign } = await import(wasm);
  const { runSignJob, runPasswordCheck } = await import("../websign-job.js");
  const p12 = await makeP12({ pkcs8: fx("test-key.pk8"), cert: fx("test-cert.der"), password: "abc123", chain: [fx("test-ca.der")] });
  const profile = fx("test.mobileprovision");
  assert.equal(await runPasswordCheck(createZsign, { p12, password: "abc123", profile }), true);
  assert.equal(await runPasswordCheck(createZsign, { p12, password: "nope", profile }), false);
  const quiet = (o) => createZsign({ ...o, print: () => {}, printErr: () => {} });
  const r = await runSignJob(quiet, { ipa: fx("tiny-ifizbox.ipa"), p12, password: "abc123", profile });
  assert.equal(r.ipa[0][0], 0x50);
  assert.equal(r.bundleId, "com.ryha.ifizbox");
});
