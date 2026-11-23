// F374: Installed Apps' rules (core/userapps.js): ifizbox-helper user-apps' lines, the page's groups and rows, the
// library copies made from an app, and the decrypt stream's lines on the progress page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUserApps, userAppSections, userAppLine, copiesOf, decryptLine, decryptStatus, decryptError, bundleIdOfToken,
  userAppToken, rememberNames, userAppTitle, listRow, decryptLabel } from "./userapps.js";

const LINES = [
  "com.x.tube\tTube\t2.1\t210\t/var/containers/Bundle/Application/A1/Tube.app\t1\t1",
  "com.rileytestut.Delta\tDelta\t1.6\t\t/var/containers/Bundle/Application/B2/Delta.app\t0\t0",
  "com.apple.calculator\tCalculator\t1.0.0\t1.0\t/var/containers/Bundle/Application/C3/Calculator.app\t0\t0",
  "com.example.plain\t\t\t\t/var/containers/Bundle/Application/D4/Plain.app\t\t0",
  "bad id!\tBad\t1\t1\t/x.app\t1\t1", // a bad bundle ID
  "com.short\tShort\t1", // too few fields
  "com.x.tube\tTube Again\t9\t9\t/y.app\t0\t1", // the same ID twice: the first one kept
  "",
].join("\n");

test("parseUserApps: the helper's lines, A-Z by name, encrypted true/false/null, App Store or not", () => {
  const apps = parseUserApps(LINES);
  assert.deepEqual(apps.map((a) => a.bundleId), ["com.apple.calculator", "com.example.plain", "com.rileytestut.Delta", "com.x.tube"]);
  assert.deepEqual(apps.find((a) => a.bundleId === "com.x.tube"),
    { bundleId: "com.x.tube", name: "Tube", version: "2.1", build: "210", path: "/var/containers/Bundle/Application/A1/Tube.app", encrypted: true, store: true });
  const plain = apps.find((a) => a.bundleId === "com.example.plain");
  assert.equal(plain.name, "com.example.plain"); // no name: the bundle ID
  assert.equal(plain.encrypted, null);
  assert.equal(apps.find((a) => a.bundleId === "com.rileytestut.Delta").encrypted, false);
  assert.deepEqual(parseUserApps(""), []);
  assert.deepEqual(parseUserApps(null), []);
});

// A thin 64-bit (or 32-bit) Mach-O header with one LC_ENCRYPTION_INFO(_64), as ifizbox-helper user-apps reads off an
// app's executable (native/helper/test_decrypt.py has the same fixtures for the C side).
function machoHeader(cryptid, { is64 = true } = {}) {
  const b = new Uint8Array(0x2000);
  const dv = new DataView(b.buffer);
  const h = is64 ? 32 : 28, cmd = is64 ? 24 : 20;
  dv.setUint32(0, is64 ? 0xfeedfacf : 0xfeedface, true);
  dv.setUint32(4, is64 ? 0x0100000c : 12, true);
  dv.setUint32(16, 1, true);
  dv.setUint32(20, cmd, true);
  dv.setUint32(h, is64 ? 0x2c : 0x21, true);
  dv.setUint32(h + 4, cmd, true);
  dv.setUint32(h + 8, 0x1000, true);
  dv.setUint32(h + 12, 0x200, true);
  dv.setUint32(h + 16, cryptid, true);
  return b;
}

test("the encrypted flag on fixture Mach-O headers: the page's flag and the web's own reading agree", async () => {
  const { machoEncrypted } = await import("./tweaks.js");
  for (const [bytes, flag] of [[machoHeader(1), "1"], [machoHeader(0), "0"], [machoHeader(7, { is64: false }), "1"],
    [machoHeader(0, { is64: false }), "0"]]) {
    const enc = machoEncrypted(bytes);
    assert.equal(enc, flag === "1");
    // the helper's line for the same executable -> the row and the page say the same
    const [app] = parseUserApps(`com.x.tube\tTube\t1\t1\t/x/Tube.app\t${flag}\t1`);
    assert.equal(app.encrypted, enc);
    assert.equal(userAppLine(app, []), enc ? "1 · Encrypted" : "1 · Not encrypted");
  }
  assert.equal(machoEncrypted(new TextEncoder().encode("not a binary")), null);
  assert.equal(parseUserApps("com.x.tube\tTube\t1\t1\t/x/Tube.app\t\t1")[0].encrypted, null); // unreadable: unknown
});

test("copiesOf: the decrypted IPA and the one with tweaks, by bundle ID and file name", () => {
  const ipas = [
    { file: "Tube 2.1 (decrypted).ipa", bundleId: "com.x.tube" },
    { file: "Tube 2.1 (tweaks).ipa", bundleId: "com.x.tube" },
    { file: "Tube.ipa", bundleId: "com.x.tube" }, // the user's own IPA: neither
    { file: "Other (decrypted).ipa", bundleId: "com.other" },
    { file: "Broken (decrypted).ipa", bundleId: "com.x.tube", error: "not a zip" },
  ];
  const c = copiesOf("com.x.tube", ipas);
  assert.equal(c.decrypted.file, "Tube 2.1 (decrypted).ipa");
  assert.equal(c.tweaked.file, "Tube 2.1 (tweaks).ipa");
  assert.deepEqual(copiesOf("com.none", ipas), { decrypted: null, tweaked: null });
  assert.equal(copiesOf("com.x.tube", [{ file: "Tube 2.1 (decrypted) 2.ipa", bundleId: "com.x.tube" }]).decrypted.file,
    "Tube 2.1 (decrypted) 2.ipa"); // the library's free name for a second one
});

test("userAppSections: App Store, then Other Apps; each row's line; a query on name or bundle ID", () => {
  const apps = parseUserApps(LINES);
  const s = userAppSections(apps, { ipas: [] });
  assert.deepEqual(s.map((x) => x.header), ["App Store", "Other Apps"]);
  assert.deepEqual(s[0].rows, [{ bundleId: "com.x.tube", label: "Tube", subtitle: "2.1 · Encrypted" }]);
  assert.deepEqual(s[1].rows.map((r) => r.subtitle), ["1.0.0", "", "1.6"]);
  const decrypted = userAppSections(apps, { ipas: [{ file: "Tube 2.1 (decrypted).ipa", bundleId: "com.x.tube" }] });
  assert.equal(decrypted[0].rows[0].subtitle, "2.1 · Decrypted copy in My IPAs");
  assert.deepEqual(userAppSections(apps, { query: "delta" }).map((x) => x.rows.map((r) => r.label)), [["Delta"]]);
  assert.deepEqual(userAppSections(apps, { query: "com.x" }).map((x) => x.header), ["App Store"]);
  assert.deepEqual(userAppSections(apps, { query: "nothing" }), []);
  assert.equal(userAppLine({ bundleId: "a.b", version: "", build: "7", encrypted: false, store: true }, []), "7 · Not encrypted");
});

test("routes: userapp:<bundle id> tokens, a bad ID is no page; the list's row; names for the nav bar", () => {
  assert.equal(userAppToken("com.x.tube"), "userapp:com.x.tube");
  assert.equal(bundleIdOfToken("userapp:com.x.tube"), "com.x.tube");
  assert.equal(bundleIdOfToken("userapp:../x"), null);
  assert.equal(bundleIdOfToken("ipa:A.ipa"), null);
  assert.equal(userAppTitle("com.unknown.app"), "com.unknown.app");
  rememberNames([{ bundleId: "com.x.tube", name: "Tube" }]);
  assert.equal(userAppTitle("com.x.tube"), "Tube");
  assert.deepEqual(listRow("#/x"), { label: "Installed Apps", subtitle: "Decrypt the apps on this iPhone and inject tweaks", href: "#/x" });
  assert.equal(decryptLabel(null), "Decrypt");
  assert.equal(decryptLabel({ file: "A.ipa" }), "Decrypt Again");
});

test("decryptLine / decryptStatus: the stream on the progress page", () => {
  assert.deepEqual(decryptLine({ fd: "out", line: "Decrypted Tube (3413 KB)" }), { kind: "raw", text: "Decrypted Tube (3413 KB)" });
  assert.deepEqual(decryptLine({ fd: "out", line: "Still encrypted PlugIns/A.appex/A: Operation not permitted" }).kind, "warning");
  assert.deepEqual(decryptLine({ fd: "out", line: "Left out PlugIns/A.appex: still encrypted" }).kind, "warning");
  assert.deepEqual(decryptLine({ fd: "out", line: "Decrypted 5 of 62 Mach-O files, 1 still encrypted" }).kind, "step");
  assert.deepEqual(decryptLine({ fd: "err", line: "ifizbox-helper: no installed app has that bundle ID" }),
    { kind: "error", text: "no installed app has that bundle ID" });
  assert.equal(decryptLine({ fd: "status", line: "pmstatus:com.x.tube:10:Decrypting Tube" }), null);
  assert.equal(decryptLine({ fd: "out", line: "" }), null);
  assert.deepEqual(decryptStatus({ fd: "status", line: "pmstatus:com.x.tube:10:Decrypting Tube" }), { percent: 10, text: "Decrypting Tube" });
  assert.equal(decryptStatus({ fd: "out", line: "pmstatus:a:1:x" }), null);
});

test("decryptError: the shell's reason without its code; an older helper says to update", () => {
  assert.equal(decryptError(new Error("decrypt: can't decrypt Tube: Operation not permitted"), "Tube"), "can't decrypt Tube: Operation not permitted");
  assert.match(decryptError(new Error("decrypt: unknown verb (update, upgrade)"), "Tube"), /helper can't decrypt apps\. Update iFizBox/);
  assert.equal(decryptError(new Error(""), "Tube"), "Tube couldn't be decrypted.");
});
