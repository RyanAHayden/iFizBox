import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NAME } from "../brand.js";
import {
  parseProfile, parseCert, parsePlist, checkP12Password, summary, profileCert, profileKind, normalizeServer,
  bmpPassword, toBase64, APP_SERVER, LEGACY_SERVER, deviceError,
} from "./signing.js";

// Throwaway certificates with fixed dates, written by the old web/signer/make_fixtures.py (gone with the server, 9905b05).
const fx = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/signing/${name}`, import.meta.url)));
const PROFILE = fx("test.mobileprovision");
const P12 = fx("test.p12");
const P12_LEGACY = fx("test-legacy.p12");

test("the profile: name, team, app ID, expiry, device count", () => {
  const p = parseProfile(PROFILE);
  assert.equal(p.name, "FizBox Test Profile");
  assert.equal(p.teamId, "TESTTEAM42");
  assert.equal(p.teamName, "Test Person");
  assert.equal(p.appId, "*");
  assert.equal(p.devices, 3);
  assert.equal(p.allDevices, false);
  assert.equal(p.expires.toISOString(), "2026-11-24T00:00:00.000Z"); // created 17 Nov, 7 days
  assert.equal(profileKind(p), "Development");
  assert.equal(p.certs.length, 2);
});

test("the certificate in the profile: name, team, expiry; the profile's own team first", () => {
  const p = parseProfile(PROFILE);
  const c = profileCert(p);
  assert.equal(c.name, "Apple Development: Test Person (ABCDE12345)");
  assert.equal(c.team, "TESTTEAM42");
  assert.equal(c.org, "Test Person");
  assert.equal(c.notBefore.toISOString(), "2026-11-16T00:00:00.000Z");
  assert.equal(c.notAfter.toISOString(), "2027-11-16T00:00:00.000Z");
  assert.equal(p.certs[0].team, "OTHERTEAM1"); // listed first, but not the profile's team
});

test("not a profile", () => {
  assert.throws(() => parseProfile(new TextEncoder().encode("hello")), /not a provisioning profile/);
  assert.throws(() => parseCert(new Uint8Array([0x30, 0x05, 1])), /truncated/);
});

test("plist values: dict, array, data, date, numbers, booleans, entities, empty forms", () => {
  const v = parsePlist(`<?xml version="1.0"?><!DOCTYPE plist><plist version="1.0"><dict>
    <key>s</key><string>a &amp; b &#x41;</string><key>e</key><string/><key>i</key><integer>-3</integer>
    <key>r</key><real>1.5</real><key>t</key><true/><key>f</key><false/><key>d</key><date>2027-01-02T03:04:05Z</date>
    <key>b</key><data>AAEC</data><key>a</key><array><string>x</string><dict/></array><key>z</key><array/>
  </dict></plist>`);
  assert.deepEqual({ ...v, d: v.d.toISOString(), b: [...v.b] },
    { s: "a & b A", e: "", i: -3, r: 1.5, t: true, f: false, d: "2027-01-02T03:04:05.000Z", b: [0, 1, 2], a: ["x", {}], z: [] });
});

test("the .p12's password, checked against its MAC (SHA-256 and SHA-1)", async () => {
  assert.equal(await checkP12Password(P12, "hunter2"), true);
  assert.equal(await checkP12Password(P12, "hunter3"), false);
  assert.equal(await checkP12Password(P12, ""), false);
  assert.equal(await checkP12Password(P12_LEGACY, "hunter2"), true);
  assert.equal(await checkP12Password(P12_LEGACY, "Hunter2"), false);
  assert.equal(await checkP12Password(new Uint8Array([1, 2, 3]), "x"), null);
});

test("BMPString password with its terminator", () => {
  assert.deepEqual([...bmpPassword("ab")], [0, 0x61, 0, 0x62, 0, 0]);
  assert.deepEqual([...bmpPassword(null)], []);
});

test("summary rows and problems", () => {
  const profile = parseProfile(PROFILE);
  const ok = summary({ profile, passwordOk: true, now: new Date("2026-11-18T00:00:00Z"), locale: "en-US", timeZone: "UTC" });
  const rows = Object.fromEntries(ok.rows.map((r) => [r.label, r.detail]));
  assert.equal(rows.Certificate, "Apple Development: Test Person (ABCDE12345)");
  assert.equal(rows.Team, "Test Person (TESTTEAM42)");
  assert.equal(rows["Certificate Expires"], "Nov 16, 2027");
  assert.equal(rows["Profile Expires"], "Nov 24, 2026");
  assert.equal(rows.Devices, "3");
  assert.equal(rows["Certificates in Profile"], "2");
  assert.deepEqual(ok.problems, []);
  const late = summary({ profile, passwordOk: false, now: new Date("2028-01-01T00:00:00Z"), locale: "en-US", timeZone: "UTC" });
  assert.deepEqual(late.problems, [
    "The certificate expired on Nov 16, 2027.",
    "The provisioning profile expired on Nov 24, 2026.",
    "The certificate's password is wrong.",
  ]);
});

test("signing server addresses", () => {
  assert.equal(APP_SERVER, "https://sign.ifizbox.com"); // B22: brand.js SIGN_HOST, not the old domain's dead sign host
  assert.equal(LEGACY_SERVER, "https://ifizbox.com");
  assert.equal(normalizeServer("sign.example.org"), "https://sign.example.org");
  assert.equal(normalizeServer(" https://box.tail1234.ts.net:8443/ "), "https://box.tail1234.ts.net:8443");
  assert.equal(normalizeServer("http://192.168.1.5:8080"), "http://192.168.1.5:8080");
  assert.equal(normalizeServer("https://example.org/ifizbox/"), "https://example.org/ifizbox");
  assert.equal(normalizeServer(""), null);
  assert.equal(normalizeServer("ftp://x"), null);
  assert.equal(normalizeServer("https://u:p@x.org"), null);
});

test("bytes go to the bridge as base64", () => {
  assert.equal(toBase64(new Uint8Array([255, 0, 1])), "/wAB");
});

// B259: Needs Re-sign also lists apps an older signer signed (signing.installed's records against its own stamp); B458:
// only by a change marked as needing a re-sign that reaches the app.
test("needsResign: an app with an older signer stamp (or none, as 0.18.0's records) is listed, saying why", async () => {
  const { needsResign, olderSigner, OLDER_SIGNER_TEXT } = await import("./signing.js");
  const now = new Date("2026-11-21T12:00:00Z");
  const later = new Date(now.getTime() + 5 * 86400000).toISOString();
  const soon = new Date(now.getTime() + 0.5 * 86400000).toISOString();
  const signer = { version: 1, groupFix: "aaaa", groupFixRevision: 2, reach: { all: [1], groupFix: [] } };
  const installed = { signer, apps: [
    // 0.18.0's record shape: no signer at all
    { bundleId: "old", originalBundleId: "old", name: "Old", version: "1.0", url: "https://x/old.ipa", signed: "2026-11-15T00:00:00Z", expires: later },
    { bundleId: "v0", name: "Version Zero", version: "1.0", expires: later, signer: { version: 0, groupFix: null } },
    { bundleId: "fix", name: "Old Fix", version: "1.0", expires: later, signer: { version: 1, groupFix: "bbbb", groupFixRevision: 1 } },
    { bundleId: "now", name: "Current", version: "1.0", expires: later, signer: { version: 1, groupFix: null } },
    { bundleId: "nowfix", name: "Current Fix", version: "1.0", expires: later, signer: { version: 1, groupFix: "aaaa", groupFixRevision: 2 } },
    { bundleId: "soon", name: "Soon", version: "1.0", expires: soon },
    { bundleId: "com.ryha.ifizbox", name: "Self", version: "0.18.0", expires: later },
  ] };
  const rows = needsResign(installed, { now, window: 2 });
  assert.deepEqual(rows.map((r) => [r.id, r.sig, r.version, r.olderSigner ?? false]),
    [["soon", "soon", "Today", true], ["old", "ok", "5 days", true], ["fix", "ok", "5 days", true], ["v0", "ok", "5 days", true]]);
  assert.equal(rows[0].short, "Signature ends today · signed by an older iFizBox"); // both reasons, the end first
  assert.ok(rows.slice(1).every((r) => r.short === OLDER_SIGNER_TEXT && r.change === "resign"));
  assert.match(OLDER_SIGNER_TEXT, /^Signed by an older iFizBox: /);
  // with an upgrade, the upgrade re-signs it
  assert.deepEqual(needsResign(installed, { now, window: 2, skip: new Set(["old", "fix", "v0", "soon"]) }), []);
  // no current stamp (an older shell, the website): only expiry counts
  assert.deepEqual(needsResign({ apps: installed.apps }, { now, window: 2 }).map((r) => r.id), ["soon"]);
  // a stale record with no expiry is still listed, last
  const noDate = needsResign({ signer, apps: [{ bundleId: "x", name: "X", expires: null }, installed.apps[0]] }, { now });
  assert.deepEqual(noDate.map((r) => [r.id, r.version, r.sig]), [["old", "5 days", "ok"], ["x", "", null]]);
  // a current dylib unknown (none bundled) can't make a record stale
  assert.equal(olderSigner({ bundleId: "y", signer: { version: 1, groupFix: "bbbb" } }, { version: 1, groupFix: null }), false);
  assert.equal(olderSigner({ bundleId: "y", signer: { version: 1, groupFix: "bbbb" } }, null), false);
});

test("B458: an app is older only by a marked change that reaches it", async () => {
  const { olderSigner, needsResign } = await import("./signing.js");
  const HASH = "496d0525dc08812d";
  const now = { version: 3, groupFix: HASH, groupFixRevision: 1, reach: { all: [1, 2, 3], groupFix: [] } };
  const older = (signer, current = now) => olderSigner({ bundleId: "y", signer }, current);
  // records from before the revision: version and hash only
  assert.equal(older({ version: 3, groupFix: HASH }), false, "0.31.0 on");
  assert.equal(older({ version: 3, groupFix: HASH, groupFixRevision: null }), false, "the shell's JSON of one");
  assert.equal(older({ version: 3, groupFix: null }), false, "current, no fix");
  assert.equal(older({ version: 3, groupFix: "bbbb" }), true, "another dylib");
  assert.equal(older({ version: 2, groupFix: HASH }), true, "an older version");
  assert.equal(older({ version: 2, groupFix: null }), true);
  assert.equal(older(undefined), true, "no stamp");
  assert.equal(older(null), true);
  // a new dylib alone lists nothing
  const rebuilt = { ...now, groupFix: "cccc" };
  assert.equal(older({ version: 3, groupFix: HASH }, rebuilt), false);
  assert.equal(older({ version: 3, groupFix: HASH, groupFixRevision: 1 }, rebuilt), false);
  assert.equal(older({ version: 3, groupFix: "cccc", groupFixRevision: 1 }), false, "its revision decides, not its hash");
  // a raised revision lists the apps with the fix only
  const raised = { ...rebuilt, groupFixRevision: 2 };
  assert.equal(older({ version: 3, groupFix: HASH }, raised), true);
  assert.equal(older({ version: 3, groupFix: HASH, groupFixRevision: 1 }, raised), true);
  assert.equal(older({ version: 3, groupFix: null, groupFixRevision: null }, raised), false);
  // a version reaching only the group fix apps, one reaching all, one with no known reach
  const fixOnly = { ...now, version: 4, reach: { all: [1, 2, 3], groupFix: [4] } };
  assert.equal(older({ version: 3, groupFix: HASH, groupFixRevision: 1 }, fixOnly), true);
  assert.equal(older({ version: 3, groupFix: null }, fixOnly), false);
  assert.equal(older({ version: 2, groupFix: null }, fixOnly), true, "version 3 reaches it");
  assert.equal(older({ version: 3, groupFix: null }, { ...now, version: 4, reach: { all: [1, 2, 3, 4], groupFix: [] } }), true);
  assert.equal(older({ version: 3, groupFix: null }, { ...now, version: 4 }), true, "can't tell");
  assert.equal(older({ version: 3, groupFix: null }, { version: 4, groupFix: null }), true, "no reach at all");
  // re-signed: it leaves the list
  const far = "2030-01-01T00:00:00Z";
  const list = (signer) => needsResign({ signer: raised, apps: [{ bundleId: "y", name: "Y", expires: far, signer }] }, { now: new Date("2026-11-25T00:00:00Z") }).length;
  assert.equal(list({ version: 3, groupFix: HASH, groupFixRevision: 1 }), 1);
  assert.equal(list({ version: raised.version, groupFix: raised.groupFix, groupFixRevision: raised.groupFixRevision }), 0);
});

test("B312: iOS already installing the same app for another app: the row's words and the failure's", async () => {
  const { deviceError, busyText, busyStuckText } = await import("./signing.js");
  assert.equal(busyText("uMod"), "iOS is already installing uMod for another app. Wait for it to finish.");
  const busy = deviceError(Object.assign(new Error("iOS is already installing com.x.umod for another app, …"), { code: "install_busy" }), "uMod");
  assert.equal(busy.title, "Couldn't Install uMod");
  assert.equal(busy.message, busyStuckText("uMod"));
  assert.match(busy.message, /Wait for it to finish, then install uMod again\.$/);
  assert.equal(busy.open, null);
  const stalled = deviceError(Object.assign(new Error("iOS didn't install com.x.umod: …"), { code: "install_stalled" }), "uMod");
  assert.equal(stalled.message, "iOS didn't install uMod: nothing moved for a minute. Try again.");
  // no name: still a sentence, never the bundle ID's raw native text
  assert.equal(deviceError({ code: "install_busy", message: "x" }).message, busyStuckText("the app"));
});

test("B444: an error that begins with the app's name keeps the name's case", () => {
  assert.equal(deviceError({ message: `${NAME} VPN didn't connect` }).message, `${NAME} VPN didn't connect`);
  assert.equal(deviceError({ message: "network down" }).message, "Network down");
});
