// B413: the website's sign job reads the app's original data protection from its executable before zsign signs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runSignJob } from "./websign-job.js";
import { parsePlist } from "./core/signing.js";
import { plistXml } from "./core/websign.js";
import { GROUPFIX } from "./core/groupfix.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`./core/fixtures/signing/${n}`, import.meta.url)));
const K = "com.apple.developer.default-data-protection", COMPLETE = "NSFileProtectionComplete";
const PROFILE = new Uint8Array(Buffer.from(Buffer.from(fx("test.mobileprovision")).toString("latin1")
  .replace(/<key>Entitlements<\/key>\s*<dict>/, `$&<key>${K}</key><string>${COMPLETE}</string>`), "latin1"));

// A thin arm64 Mach-O whose signature holds the entitlements' XML slot (5).
function macho(ents) {
  const xml = Buffer.from(plistXml(ents)), b = Buffer.alloc(48 + 28 + xml.length);
  b.writeUInt32LE(0xfeedfacf, 0); b.writeUInt32LE(1, 16); b.writeUInt32LE(16, 20);
  [0x1d, 16, 48, b.length - 48].forEach((v, i) => b.writeUInt32LE(v, 32 + 4 * i));
  [0xfade0cc0, b.length - 48, 1, 5, 20, 0xfade7171, 8 + xml.length].forEach((v, i) => b.writeUInt32BE(v, 48 + 4 * i));
  xml.copy(b, 76);
  return new Uint8Array(b);
}

async function signed(value, config = null) {
  const app = "/w/app/Payload/Delta.app", files = new Map();
  files.set(`${app}/Delta`, macho({ "application-identifier": "OLDTEAM.x.delta", ...(value ? { [K]: value } : {}) }));
  if (config) files.set(`${app}/${GROUPFIX.config}`, new TextEncoder().encode(config));
  const get = (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); };
  const create = async () => ({
    FS: {
      mkdir() {}, unlink: (p) => files.delete(p), readFile: get, writeFile: (p, d) => files.set(p, d),
      readdir: (p) => { if (p !== "/w/app/Payload") throw new Error("ENOENT"); return ["Delta.app"]; },
      open: get, close() {},
      read: (s, buf, o, len, pos) => { const part = s.subarray(pos, pos + len); buf.set(part, o); return part.length; },
    },
    ccall: (name) => (name === "ifizbox_unzip" ? 0 : JSON.stringify({ CFBundleIdentifier: "x.delta", CFBundleExecutable: "Delta" })),
    callMain: () => { files.set("/w/out.ipa", new Uint8Array([0x50, 0x4b])); return 0; },
  });
  await runSignJob(create, { ipa: new Uint8Array([0x50, 0x4b, 3, 4]).buffer, p12: fx("test.p12"), profile: PROFILE, password: "hunter2" });
  return parsePlist(String(files.get("/w/ents.plist")))[K];
}

test("website sign job (B413): the profile's data protection only for an app whose original signature asked for it", async () => {
  assert.equal(await signed(null), undefined);
  assert.equal(await signed("NSFileProtectionCompleteUntilFirstUserAuthentication"), undefined);
  assert.equal(await signed(COMPLETE), COMPLETE);
  assert.equal(await signed(COMPLETE, plistXml({ groups: [] })), undefined, "signed here before");
});
