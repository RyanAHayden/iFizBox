// F288: the website's signer with tweaks: websign-job.js puts the prepared tweaks (core/tweaks.js) into the unpacked
// app and the weak load commands into its executable, then the real zsign WebAssembly signs it all. Node only: the
// tiny fixture IPA carries iFizBox's own bundle ID and is never installed on a phone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { runSignJob, putTweaks } from "./websign-job.js";
import { prepareTweaks, dylibsOf, loadCommands, LC, RPATH } from "./core/tweaks.js";
import { readZip } from "./core/unpack.js";
import { GROUPFIX } from "./core/groupfix.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`./core/fixtures/signing/${n}`, import.meta.url)));
const tw = (n) => new Uint8Array(readFileSync(new URL(`./core/fixtures/tweaks/${n}`, import.meta.url)));
const P12 = fx("test.p12"), PROFILE = fx("test.mobileprovision");
const WASM = new URL("./vendor/zsign/zsign.js", import.meta.url);
const CSMAGIC_EMBEDDED_SIGNATURE = Buffer.from([0xfa, 0xde, 0x0c, 0xc0]);

test("putTweaks: files under the app, folders made; a path outside it is refused", () => {
  const files = new Map(), dirs = new Set();
  const FS = { mkdir: (p) => { if (dirs.has(p)) throw new Error("EEXIST"); dirs.add(p); }, writeFile: (p, d) => files.set(p, d),
    readFile: (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); } };
  files.set("/a/X.app/X", tw("app.macho"));
  const prep = prepareTweaks([{ name: "FixtureUI.framework.zip", data: tw("FixtureUI.framework.zip") }]);
  assert.deepEqual(putTweaks(FS, "/a/X.app", { CFBundleExecutable: "X" }, prep), ["@rpath/FixtureUI.framework/FixtureUI"]);
  assert.ok(dirs.has("/a/X.app/Frameworks/FixtureUI.framework"));
  assert.ok(files.has("/a/X.app/Frameworks/FixtureUI.framework/FixtureUI"));
  assert.deepEqual(dylibsOf(files.get("/a/X.app/X")), ["/usr/lib/libSystem.B.dylib", "@rpath/FixtureUI.framework/FixtureUI"]);
  assert.throws(() => putTweaks(FS, "/a/X.app", {}, { files: [{ path: "../evil", data: new Uint8Array(1) }] }), (e) => e.code === "bad_tweak");
  assert.throws(() => putTweaks(FS, "/a/Y.app", { CFBundleExecutable: "Y" }, prep), (e) => e.code === "bad_ipa");
});

test("zsign WebAssembly signs an IPA with a tweak: the executable loads it weakly, the dylib is signed and sealed", { skip: !existsSync(WASM) && "no vendor/zsign" }, async () => {
  const { default: real } = await import(WASM);
  let exe = null, dylib = null;
  const createZsign = async (o) => {
    const zs = await real(o);
    const main = zs.callMain;
    zs.callMain = (args) => {
      try { return main(args); } finally {
        exe = zs.FS.readFile("/w/app/Payload/Tiny.app/Tiny");
        dylib = zs.FS.readFile("/w/app/Payload/Tiny.app/Frameworks/Plain.dylib");
      }
    };
    return zs;
  };
  const tweaks = prepareTweaks([{ name: "Plain.dylib", data: tw("Plain.dylib") }]);
  const r = await runSignJob(createZsign, { ipa: fx("tiny-ifizbox.ipa"), p12: P12, profile: PROFILE, password: "hunter2", tweaks });
  assert.deepEqual(r.injected, ["@rpath/Plain.dylib"]);
  // otool -l on the signed executable
  const cmds = loadCommands(exe).map((c) => [c.cmd, c.name]);
  assert.ok(cmds.some(([c, n]) => c === LC.LOAD_WEAK_DYLIB && n === "@rpath/Plain.dylib"), JSON.stringify(cmds));
  assert.ok(cmds.some(([c, n]) => c === LC.RPATH && n === RPATH));
  assert.ok(Buffer.from(exe).includes(Buffer.from("<string>TESTTEAM42.com.ryha.ifizbox</string>")), "signed after the injection");
  assert.ok(Buffer.from(dylib).includes(CSMAGIC_EMBEDDED_SIGNATURE), "zsign signed the tweak");
  const zip = readZip(r.ipa);
  const cr = zip.find((e) => e.path === "Payload/Tiny.app/_CodeSignature/CodeResources");
  assert.ok(Buffer.from(cr.data).includes(Buffer.from("Frameworks/Plain.dylib")), "sealed by the app");
  assert.ok(zip.some((e) => e.path === "Payload/Tiny.app/Frameworks/Plain.dylib"));
});

test("B211: an app whose original signature names keychain groups gets the group fix injected; iFizBox's own IPA never", { skip: !existsSync(WASM) && "no vendor/zsign" }, async () => {
  const { default: real } = await import(WASM);
  const groupFix = new Uint8Array(readFileSync(new URL(`./${GROUPFIX.file}`, import.meta.url)));
  let seen = null;
  const createZsign = async (o) => {
    const zs = await real(o);
    const main = zs.callMain;
    zs.callMain = (args) => {
      try { return main(args); } finally {
        const at = "/w/app/Payload/Tiny.app/";
        const read = (p) => { try { return zs.FS.readFile(at + p); } catch { return null; } };
        seen = { exe: read("Tiny"), dylib: read(GROUPFIX.dylib), config: read(GROUPFIX.config) };
      }
    };
    return zs;
  };
  const base = { p12: P12, profile: PROFILE, password: "hunter2", groupFix };
  // the fixture's executable is unsigned: nothing to fix
  const first = await runSignJob(createZsign, { ...base, ipa: fx("tiny-ifizbox.ipa"), appBundleId: "com.example.box" });
  assert.equal(first.injected, undefined);
  // signed once, it carries keychain-access-groups: signed again as another app, it gets the fix
  const r = await runSignJob(createZsign, { ...base, ipa: first.ipa, appBundleId: "com.example.box" });
  assert.deepEqual(r.injected, [GROUPFIX.inject]);
  assert.ok(loadCommands(seen.exe).some((c) => c.cmd === LC.LOAD_WEAK_DYLIB && c.name === GROUPFIX.inject));
  assert.ok(Buffer.from(seen.dylib).includes(CSMAGIC_EMBEDDED_SIGNATURE), "zsign signed the fix");
  assert.match(new TextDecoder().decode(seen.config), /<key>keychain<\/key><true\/>/);
  // B327: the sign log names the fix it got, and says when an app that needs one went without (no dylib loaded)
  assert.equal(first.signLog[1], "Group fix: none (the original signature names no app groups or keychain groups)");
  assert.match(r.signLog[1], /^Group fix: no app groups -> the app's own folder; keychain groups stripped/);
  const bare = await runSignJob(createZsign, { ...base, groupFix: null, ipa: first.ipa, appBundleId: "com.example.box" });
  assert.equal(bare.signLog[1], "Group fix: none (no fix dylib was loaded, the app's groups go unmapped)");
  const cr = readZip(r.ipa).find((e) => e.path === "Payload/Tiny.app/_CodeSignature/CodeResources");
  assert.ok(Buffer.from(cr.data).includes(Buffer.from(GROUPFIX.config)), "its config sealed by the app");
  // iFizBox's own IPA keeps its own groups: no fix
  const own = await runSignJob(createZsign, { ...base, ipa: first.ipa, appBundleId: "com.ryha.ifizbox" });
  assert.equal(own.injected, undefined);
  assert.equal(seen.dylib, null);
});
