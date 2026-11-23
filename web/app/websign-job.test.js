// F93: the website's signing job (websign-job.js) with a fake zsign (the flow: unzip, Info.plist, bundle ID,
// entitlements, iFizBox's bring files, zsign's errors), then the real zsign WebAssembly (vendor/zsign) on a tiny IPA
// (core/fixtures/signing/tiny-ifizbox.ipa: Payload/Tiny.app, a 32 KB arm64 executable, binary Info.plist,
// com.ryha.ifizbox) signed with the throwaway test certificate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { runSignJob, zsignCrash } from "./websign-job.js";
import { parsePlist } from "./core/signing.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`./core/fixtures/signing/${n}`, import.meta.url)));
const P12 = fx("test.p12"), PROFILE = fx("test.mobileprovision");
const ZIP = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]);
const text = (b) => (typeof b === "string" ? b : new TextDecoder().decode(b));

// A module with the calls websign-job.js makes. `plist` is the app's Info.plist; `fail` makes main() print and stop.
function fakeZsign({ plist = { CFBundleIdentifier: "io.github.x.delta", CFBundleName: "Delta", CFBundleShortVersionString: "1.2" },
  fail = null, unzip = 0, appName = "Delta.app", throws = undefined } = {}) {
  const files = new Map(), dirs = new Set(["/"]);
  const seen = { args: null, files };
  const create = async ({ print }) => ({
    FS: {
      mkdir: (p) => { if (dirs.has(p)) throw new Error("EEXIST"); dirs.add(p); },
      writeFile: (p, d) => files.set(p, typeof d === "string" ? d : new Uint8Array(d)),
      readFile: (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); },
      unlink: (p) => files.delete(p),
      readdir: (p) => { if (p !== "/w/app/Payload" || unzip) throw new Error("ENOENT"); return [".", "..", appName]; },
    },
    ccall: (name, _r, _t, args) => {
      if (name === "ifizbox_unzip") {
        seen.unzipped = files.get(args[0]);
        if (!unzip) { dirs.add(`/w/app/Payload/${appName}`); dirs.add(`/w/app/Payload/${appName}/web`); }
        return unzip;
      }
      if (name === "ifizbox_plist_json") return plist ? JSON.stringify(plist) : "";
      throw new Error("unknown " + name);
    },
    callMain: (args) => {
      seen.args = args;
      seen.inputGone = !files.has("/w/in.ipa");
      if (throws !== undefined) throw throws;
      if (fail) { for (const l of fail) print(l); return 255; }
      files.set(args[args.indexOf("-o") + 1], new Uint8Array([0x50, 0x4b, 9, 9]));
      return 0;
    },
  });
  return { create, seen };
}

const job = (over = {}) => ({ ipa: ZIP.buffer.slice(0), p12: P12, profile: PROFILE, password: "hunter2", ...over });

test("signs: unzips, reads the app, passes zsign the certificate, profile, narrowed entitlements and output", async () => {
  const { create, seen } = fakeZsign();
  const steps = [];
  const r = await runSignJob(create, job(), { progress: (p) => steps.push(p) });
  assert.deepEqual(steps, ["Signing"]);
  assert.deepEqual([...seen.unzipped], [...ZIP]);
  assert.equal(seen.inputGone, true, "the zip is freed once it's unpacked");
  assert.deepEqual(seen.args, ["-f", "-k", "/w/key.p12", "-p", "hunter2", "-m", "/w/app.mobileprovision", "-t", "/w/tmp",
    "-z", "1", "-o", "/w/out.ipa", "-e", "/w/ents.plist", "/w/app/Payload/Delta.app"]);
  const ents = parsePlist(text(seen.files.get("/w/ents.plist")));
  assert.equal(ents["application-identifier"], "TESTTEAM42.io.github.x.delta");
  assert.equal(ents["get-task-allow"], false);
  assert.deepEqual([...seen.files.get("/w/key.p12")], [...P12]);
  assert.equal(r.bundleId, "io.github.x.delta");
  assert.equal(r.name, "Delta");
  assert.equal(r.version, "1.2");
  assert.deepEqual([...r.ipa], [0x50, 0x4b, 9, 9]);
  assert.equal(seen.files.has("/w/app/Payload/Delta.app/ifizbox-identity.plist"), false);
  // B327: the keychain groups and the group fix it signed with, in the app's sign log's words
  assert.deepEqual(r.signLog, ["Keychain: TESTTEAM42.io.github.x.delta (application-identifier TESTTEAM42.io.github.x.delta)",
    "Group fix: none (no fix dylib was loaded, the app's groups go unmapped)"]);
});

test("bring: only iFizBox's own IPA gets the certificate and the website's link, before zsign seals it", async () => {
  const link = "ifizbox://import?d=abc";
  let { create, seen } = fakeZsign();
  await runSignJob(create, job({ bring: { identity: true, transfer: link } }));
  assert.equal([...seen.files.keys()].some((k) => k.includes("ifizbox-identity") || k.includes("transfer.link")), false, "not another app");
  ({ create, seen } = fakeZsign({ plist: { CFBundleIdentifier: "com.ryha.ifizbox", CFBundleName: "iFizBox" }, appName: "iFizBox.app" }));
  await runSignJob(create, job({ bring: { identity: true, transfer: link } }));
  const id = parsePlist(text(seen.files.get("/w/app/Payload/iFizBox.app/ifizbox-identity.plist")));
  assert.deepEqual([...id.p12], [...P12]);
  assert.deepEqual([...id.profile], [...PROFILE]);
  assert.equal(id.password, "hunter2");
  assert.equal(seen.files.get("/w/app/Payload/iFizBox.app/web/transfer.link"), link);
  ({ create, seen } = fakeZsign({ plist: { CFBundleIdentifier: "com.ryha.ifizbox" }, appName: "iFizBox.app" }));
  await runSignJob(create, job({ bring: { identity: false, transfer: "https://not-a-link" } }));
  assert.equal([...seen.files.keys()].some((k) => k.includes("ifizbox-identity") || k.includes("transfer.link")), false, "switch off, bad link");
});

test("appBundleId wins over the IPA's own ID: an old-ID iFizBox IPA is signed as iFizBox and gets its bring files", async () => {
  const { create, seen } = fakeZsign({ plist: { CFBundleIdentifier: "com.example.oldname", CFBundleName: "iFizBox" }, appName: "iFizBox.app" });
  const r = await runSignJob(create, job({ appBundleId: "com.ryha.ifizbox", bring: { identity: true, transfer: "ifizbox://import?d=abc" } }));
  assert.equal(r.bundleId, "com.ryha.ifizbox", "the ID the early install link was opened for");
  assert.equal(seen.args[seen.args.indexOf("-b") + 1], "com.ryha.ifizbox");
  assert.ok(seen.files.has("/w/app/Payload/iFizBox.app/ifizbox-identity.plist"));
});

test("zsign's own reason when it can't sign; not an IPA; no app inside; no Info.plist", async () => {
  const { create } = fakeZsign({ fail: ["\x1b[31m>>> Can't find the signature of Frameworks/X.framework!\x1b[0m"] });
  await assert.rejects(runSignJob(create, job()), (e) => e.code === "sign_failed" && /zsign: Can't find the signature of Frameworks\/X\.framework\./.test(e.message));
  const pw = fakeZsign({ fail: ["01000000:error:...mac verify failure", "\x1b[31m>>> Can't load p12 or private key file. Please input the correct file and password!\x1b[0m"] });
  await assert.rejects(runSignJob(pw.create, job()), /password is wrong/);
  await assert.rejects(runSignJob(fakeZsign().create, job({ ipa: new Uint8Array([1, 2, 3, 4]) })), (e) => e.code === "bad_ipa");
  await assert.rejects(runSignJob(fakeZsign({ unzip: 1 }).create, job()), /couldn't be unpacked/);
  await assert.rejects(runSignJob(fakeZsign({ plist: null }).create, job()), /no readable Info\.plist/);
  await assert.rejects(runSignJob(fakeZsign().create, job({ profile: new Uint8Array([1, 2]) })), (e) => e.code === "bad_profile");
});

test("zsign crashing outside exit() names the error: Out of memory for a bare object, RangeError, RuntimeError, abort", async () => {
  const crash = async (thrown) => {
    let err;
    await assert.rejects(runSignJob(fakeZsign({ throws: thrown }).create, job()), (e) => { err = e; return e.code === "sign_failed"; });
    assert.doesNotMatch(err.message, /\[object Object\]|undefined/);
    return err.message;
  };
  assert.equal(await crash({}), "zsign stopped: Out of memory. The app may be too big for this browser.");
  assert.match(await crash({ what: 1 }), /stopped: Out of memory\./);
  assert.match(await crash(new RangeError("Array buffer allocation failed")), /stopped: Out of memory\./);
  assert.match(await crash(new WebAssembly.RuntimeError("unreachable")), /stopped: Out of memory\./);
  assert.match(await crash(new Error("Aborted(OOM)")), /stopped: Out of memory\./);
  assert.match(await crash("Aborted()"), /stopped: Out of memory\./);
  assert.match(await crash(null), /stopped: Out of memory\./);
  assert.match(await crash(new TypeError("x is not a function")), /stopped: x is not a function\./);
  // exit() still reads as zsign's own exit status and log
  const ex = fakeZsign({ throws: { status: 1 } });
  await assert.rejects(runSignJob(ex.create, job()), (e) => e.code === "sign_failed" && !/stopped:|too big/.test(e.message));
  assert.equal(zsignCrash({ name: "RangeError" }), "Out of memory");
});

// ---- the real thing: zsign as WebAssembly ----------------------------------------------------------------------
const WASM = new URL("./vendor/zsign/zsign.js", import.meta.url);
const has = (b, s) => Buffer.from(b).includes(Buffer.from(s));

test("zsign WebAssembly signs a tiny IPA, sealing iFizBox's bring files", { skip: !existsSync(WASM) && "no vendor/zsign" }, async () => {
  const { default: createZsign } = await import(WASM);
  const r = await runSignJob(createZsign, { ipa: fx("tiny-ifizbox.ipa"), p12: P12, profile: PROFILE, password: "hunter2",
    bring: { identity: true, transfer: "ifizbox://import?d=abc" } });
  assert.equal(r.bundleId, "com.ryha.ifizbox");
  assert.equal(r.name, "Tiny iFizBox"); // from a binary Info.plist
  assert.equal(r.version, "9.9");
  assert.equal(r.ipa[0], 0x50);
  for (const n of ["Payload/Tiny.app/_CodeSignature/CodeResources", "Payload/Tiny.app/embedded.mobileprovision",
    "Payload/Tiny.app/ifizbox-identity.plist", "Payload/Tiny.app/web/transfer.link"]) assert.ok(has(r.ipa, n), n);
});

test("zsign WebAssembly signs the executable itself: the profile's entitlements and a CMS signature", { skip: !existsSync(WASM) && "no vendor/zsign" }, async () => {
  // zsign signs each Mach-O in a MAP_SHARED mapping; emscripten writes it back at munmap through the mapping's fd,
  // which zsign had closed (tools/zsign-wasm/fs-mmap.patch): the app kept its old signature and iOS refused it.
  const { default: real } = await import(WASM);
  let exe = null;
  const createZsign = async (o) => {
    const zs = await real(o);
    const main = zs.callMain;
    zs.callMain = (args) => { try { return main(args); } finally { exe = zs.FS.readFile("/w/app/Payload/Tiny.app/Tiny"); } };
    return zs;
  };
  await runSignJob(createZsign, { ipa: fx("tiny-ifizbox.ipa"), p12: P12, profile: PROFILE, password: "hunter2" });
  assert.ok(has(exe, "<string>TESTTEAM42.com.ryha.ifizbox</string>"), "application-identifier in the signed executable");
  assert.ok(has(exe, "<key>get-task-allow</key><false/>"));
  assert.ok(!has(exe, "<key>get-task-allow</key><true/>") && !has(exe, "application-groups"));
  const b = Buffer.from(exe), cms = b.indexOf(Buffer.from([0xfa, 0xde, 0x0b, 0x01]));
  assert.ok(cms > 0 && b.readUInt32BE(cms + 4) > 1000, "a real CMS blob, not ad-hoc's empty one");
});

test("zsign WebAssembly: a wrong password says so", { skip: !existsSync(WASM) && "no vendor/zsign" }, async (t) => {
  const { default: createZsign } = await import(WASM);
  // emscripten on node sets process.exitCode when main() fails (a browser's worker just throws): keep this run's
  const code = process.exitCode;
  t.after(() => { process.exitCode = code; });
  await assert.rejects(runSignJob(createZsign, { ipa: fx("tiny-ifizbox.ipa"), p12: P12, profile: PROFILE, password: "nope" }),
    (e) => e.code === "sign_failed" && /password/.test(e.message));
});

test("app extensions come out before zsign signs (their entitlements wouldn't match: iOS refuses the app)", async () => {
  const { removeTree } = await import("./websign-job.js");
  const tree = { "/a/PlugIns": "dir", "/a/PlugIns/S.appex": "dir", "/a/PlugIns/S.appex/S": "file", "/a/Info.plist": "file" };
  const FS = {
    stat: (p) => { if (!(p in tree)) throw new Error("ENOENT"); return { mode: tree[p] }; },
    isDir: (m) => m === "dir",
    readdir: (p) => [".", "..", ...Object.keys(tree).filter((k) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")).map((k) => k.slice(p.length + 1))],
    rmdir: (p) => { delete tree[p]; }, unlink: (p) => { delete tree[p]; },
  };
  removeTree(FS, "/a/PlugIns");
  removeTree(FS, "/a/Watch"); // not there: fine
  assert.deepEqual(Object.keys(tree), ["/a/Info.plist"]);
});
