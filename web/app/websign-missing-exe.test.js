// B21: the website's zsign WebAssembly on an IPA with nested bundles that name a missing executable
// (web/fixtures/missing-exe.ipa: core/fixtures/signing/tiny-ifizbox.ipa plus YTUHD.bundle and Frameworks/Kit.framework,
// each with an Info.plist naming a binary that isn't there, as modded IPAs inject them: YouMod, user 2026-11-18).
// zsign never signs a .bundle; a .framework without its binary used to stop it ("Can't parse BundleExecute file!"),
// tools/zsign-wasm/skip-missing-exe.patch skips it with a warning and seals its files in the app's CodeResources.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { runSignJob } from "./websign-job.js";

const WASM = new URL("./vendor/zsign/zsign.js", import.meta.url);
const fx = (u) => new Uint8Array(readFileSync(new URL(u, import.meta.url)));

test("zsign WebAssembly: a .bundle and a .framework without their executables are sealed, not an error",
  { skip: !existsSync(WASM) && "no vendor/zsign" }, async () => {
    const { default: real } = await import(WASM);
    let log = [], resources = null;
    const createZsign = async (o) => {
      const zs = await real({ ...o, print: (s) => { log.push(s); o.print(s); }, printErr: (s) => { log.push(s); o.printErr(s); } });
      const main = zs.callMain;
      zs.callMain = (args) => {
        try { return main(args); } finally {
          try { resources = new TextDecoder().decode(zs.FS.readFile("/w/app/Payload/Tiny.app/_CodeSignature/CodeResources")); } catch { /* none */ }
        }
      };
      return zs;
    };
    const r = await runSignJob(createZsign, { ipa: fx("../fixtures/missing-exe.ipa"), p12: fx("./core/fixtures/signing/test.p12"),
      profile: fx("./core/fixtures/signing/test.mobileprovision"), password: "hunter2" });
    assert.equal(r.bundleId, "com.ryha.ifizbox");
    assert.equal(r.ipa[0][0], 0x50);
    assert.ok(log.some((l) => /Skipped Frameworks\/Kit\.framework: its executable Kit is missing/.test(l)), log.join("\n"));
    for (const f of ["YTUHD.bundle/Info.plist", "YTUHD.bundle/en.lproj/Localizable.strings", "Frameworks/Kit.framework/Info.plist",
      "Frameworks/Kit.framework/kit.txt", "DontEatMyContent.bundle/Info.plist"]) assert.ok(resources?.includes(`<key>${f}</key>`), `${f} sealed by the app`);
  });
