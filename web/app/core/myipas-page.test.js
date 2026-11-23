// F224: Install IPAs as one page: Not Installed / Installed, the row's line, Manage's presets, counts, summary, toolbar and sheets, and Unsign keeping the IPA file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installedIdOf, ipaLine, matchIpa, ipaSections, ipaPresetFiles,
  ipaSelectSheet, ipaSelectLabel, ipaCounts, ipaSummary, ipaToolbar, ipaSheet, unsignEntries, IPA_SELECT, IPA_DESELECT } from "./myipas.js";
import { SELECT, DESELECT } from "./installed.js";

const MB = 1048576;
const LIST = [
  { file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.5", size: 10 * MB, signed: null },
  { file: "Alpha.ipa", name: "Alpha", bundleId: "com.x.alpha", version: "2.0", size: 20 * MB, signed: { at: "2026-11-18T00:00:00Z", bundleId: "com.me.alpha" } },
  { file: "Broken.ipa", name: "Broken", size: 1 * MB, error: "not a zip" },
  { file: "Car.ipa", name: "Car", bundleId: "com.x.car", version: "3", size: 2 * MB, signed: { at: "2026-11-18T00:00:00Z", bundleId: "com.x.car" } },
];
const INSTALLED = { "com.me.alpha": true }; // iOS has Alpha as it was signed (its new bundle ID)

test("the bundle ID iOS knows: the signed copy's, then Sign Options', then the IPA's", () => {
  assert.equal(installedIdOf(LIST[1]), "com.me.alpha");
  assert.equal(installedIdOf({ bundleId: "a", options: { bundleId: "b" } }), "b");
  assert.equal(installedIdOf({ bundleId: "a" }), "a");
  assert.equal(installedIdOf({}), null);
});

test("the row's line: Version · size · Signed | Not signed (the website: Not signed or Link; the jailbreak app no word)", () => {
  assert.equal(ipaLine(LIST[0]), "Version 1.5 · 10.0 MB · Not signed");
  assert.equal(ipaLine(LIST[1]), "Version 2.0 · 20.0 MB · Signed");
  assert.equal(ipaLine(LIST[2]), "1.0 MB · Can't be read");
  assert.equal(ipaLine(LIST[0], { jailbreak: true }), "Version 1.5 · 10.0 MB");
  assert.equal(ipaLine({ file: "a.ipa", stored: true, version: "1", size: MB }, { site: true }), "Version 1 · 1.0 MB · Not signed");
  assert.equal(ipaLine({ file: "a.ipa", url: "https://x/a.ipa" }, { site: true }), "Link");
});

test("sections: Not Installed then Installed, A-Z, empty ones left out; the search narrows both", () => {
  const s = ipaSections(LIST, { installed: INSTALLED });
  assert.deepEqual(s.map((x) => x.header), ["Not Installed", "Installed"]);
  assert.deepEqual(s[0].rows.map((r) => r.file), ["Broken.ipa", "Car.ipa", "Delta.ipa"]);
  assert.deepEqual(s[1].rows.map((r) => r.file), ["Alpha.ipa"]);
  assert.equal(s[1].rows[0].installed, true);
  assert.equal(s[0].rows[2].line, "Version 1.5 · 10.0 MB · Not signed");
  assert.deepEqual(ipaSections(LIST, { installed: {} }).map((x) => x.key), ["notInstalled"]);
  assert.deepEqual(ipaSections([], {}), []);
  const q = ipaSections(LIST, { installed: INSTALLED, query: "x.del" });
  assert.deepEqual(q.map((x) => x.rows.map((r) => r.file)), [["Delta.ipa"]]);
  assert.ok(matchIpa({ name: "Delta" }, "DEL") && matchIpa({ file: "Delta.ipa" }, "") && !matchIpa({ name: "Delta" }, "zz"));
  // a function answers too; a broken file never counts as installed
  assert.deepEqual(ipaSections(LIST, { installed: (id) => id === "com.x.car" })[1].rows.map((r) => r.file), ["Car.ipa"]);
});

test("Manage: Select… presets All IPAs / Not Installed (n) / Signed (n); Deselect once every row is picked", () => {
  const rows = ipaSections(LIST, { installed: INSTALLED }).flatMap((s) => s.rows);
  assert.deepEqual(ipaSelectSheet(rows).map((o) => o.label), ["All IPAs", "Not Installed (3)", "Signed (2)"]);
  assert.deepEqual(ipaPresetFiles(rows, "notInstalled"), ["Broken.ipa", "Car.ipa", "Delta.ipa"]);
  assert.deepEqual(ipaPresetFiles(rows, "signed"), ["Car.ipa", "Alpha.ipa"]);
  assert.equal(ipaPresetFiles(rows, "all").length, 4);
  assert.deepEqual(ipaPresetFiles(rows, "nope"), []);
  assert.equal(ipaSelectLabel(rows, []), "Select…");
  assert.equal(ipaSelectLabel(rows, rows.map((r) => r.file)), "Deselect");
  assert.equal(ipaSelectLabel([], []), "Select…");
  assert.equal(IPA_SELECT, SELECT, "Installed's words (F222)");
  assert.equal(IPA_DESELECT, DESELECT);
});

test("Manage: counts, the grey line and the toolbar (Sign blue, Unsign only signed picks, Delete), per build", () => {
  const rows = ipaSections(LIST, { installed: INSTALLED }).flatMap((s) => s.rows);
  assert.equal(ipaSummary(rows, []), "0 selected · 4 IPAs · 2 signed · 1 installed");
  assert.deepEqual(ipaToolbar(ipaCounts(rows, [])), [
    { kind: "sign", label: "Sign", disabled: true }, { kind: "unsign", label: "Unsign", disabled: true },
    { kind: "delete", label: "Delete", disabled: true }]);
  const picked = ["Delta.ipa", "Broken.ipa", "Alpha.ipa"];
  const c = ipaCounts(rows, picked);
  assert.deepEqual(c, { n: 3, sign: 2, unsign: 1, del: 3, installed: 1 }); // a broken file can't be signed
  assert.equal(ipaSummary(rows, picked), "3 selected · 4 IPAs · 2 signed · 1 installed");
  assert.deepEqual(ipaToolbar(c).map((b) => [b.label, b.disabled]), [["Sign (2)", false], ["Unsign (1)", false], ["Delete (3)", false]]);
  assert.deepEqual(ipaToolbar(ipaCounts(rows, ["Delta.ipa"])).map((b) => [b.label, b.disabled]),
    [["Sign (1)", false], ["Unsign", true], ["Delete (1)", false]]);
  // F212: the jailbreak app doesn't sign: Delete only. The website keeps no signed copies: no Unsign; links don't sign.
  assert.deepEqual(ipaToolbar(ipaCounts(rows, picked, { jailbreak: true }), { jailbreak: true }).map((b) => b.kind), ["delete"]);
  const site = [{ file: "k.ipa", stored: true }, { file: "l.ipa", url: "https://x/l.ipa" }];
  const sc = ipaCounts(site, ["k.ipa", "l.ipa"], { site: true });
  assert.deepEqual(ipaToolbar(sc, { site: true }).map((b) => b.label), ["Sign (1)", "Delete (2)"]);
});

test("Manage's sheets: Sign and Install, Unsign keeps the files, Delete says installed apps stay (manage them in Installed)", () => {
  const rows = ipaSections(LIST, { installed: INSTALLED }).flatMap((s) => s.rows);
  const pick = (...f) => rows.filter((r) => f.includes(r.file));
  assert.deepEqual(ipaSheet("sign", pick("Delta.ipa", "Car.ipa")), { title: "Each IPA is signed with your certificate and installed.",
    button: "Sign and Install 2 IPAs", destructive: false });
  assert.equal(ipaSheet("sign", pick("Delta.ipa")).button, "Sign and Install IPA");
  assert.deepEqual(ipaSheet("unsign", pick("Car.ipa", "Alpha.ipa")), { title: "2 signed copies are deleted. The IPA files stay.",
    button: "Unsign 2 IPAs", destructive: true });
  const del = ipaSheet("delete", pick("Delta.ipa", "Alpha.ipa"));
  assert.equal(del.button, "Delete 2 IPAs");
  assert.match(del.title, /^2 IPAs and their signed copies are deleted from this iPhone\. The installed app stays on your iPhone: manage it in Installed\.$/);
  assert.doesNotMatch(ipaSheet("delete", pick("Delta.ipa")).title, /Installed/);
});

test("Unsign: library.unsign for each picked IPA with a signed copy; the files stay (a fake library)", async () => {
  const lib = new Map(LIST.map((e) => [e.file, { ...e }]));
  const calls = [];
  const call = async (method, { file }) => {
    calls.push([method, file]);
    if (method !== "unsign") throw new Error("unexpected " + method);
    if (file === "Car.ipa") throw new Error("busy");
    lib.get(file).signed = null;
    return { ipas: [...lib.values()] };
  };
  const r = await unsignEntries([lib.get("Delta.ipa"), lib.get("Alpha.ipa"), lib.get("Car.ipa")], { call });
  assert.deepEqual(calls, [["unsign", "Alpha.ipa"], ["unsign", "Car.ipa"]], "Delta has no signed copy: not asked");
  assert.deepEqual(r.done, ["Alpha.ipa"]);
  assert.deepEqual(r.failed.map((f) => [f.file, f.message]), [["Car.ipa", "busy"]]);
  assert.equal(lib.size, 4, "every IPA file is still there");
  assert.equal(r.ipas.find((e) => e.file === "Alpha.ipa").signed, null);
});
