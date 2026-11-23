// B113: plain-http IPA links in the jailbreak app (ipa.install). The shell downloads the https twin; with none it
// answers "insecure", runIpaInstall asks with INSECURE_IPA_ALERT, and Install Anyway sends ipa.install again with
// insecure: true (Apt.swift IPAInstall.fetchHTTP: PlainDownload). Against the fake bridge and fake helper
// (native/fake/), which follow the same rules.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runIpaInstall, askInsecureIpa, forgetAllowedHttp } from "./ipa-install.js";
import { ipaError } from "./core/ipainstall.js";
import { INSECURE_IPA_ALERT } from "./core/insecureipa.js";
import { helperLanes } from "./screens/apprun.js";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";

function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(text), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const ipa = (id) => zip({
  "Payload/Demo.app/Info.plist": `<?xml version="1.0"?><plist version="1.0"><dict>\n<key>CFBundleIdentifier</key>\n<string>${id}</string>\n</dict></plist>\n`,
  "Payload/Demo.app/Demo": "\xcf\xfa\xed\xfe",
});

const HTTP = "http://bigboss.example/debs/Demo.ipa";
const TWIN = "https://bigboss.example/debs/Demo.ipa";

function setup(t, net) {
  forgetAllowedHttp();
  const fx = makeFixture();
  t.after(fx.cleanup);
  return createFakeNative({ prefix: fx.prefix, remote: fx.remote, net, env: { FAKE_LDID: "1" }, ipaDir: join(fx.dir, "ipa-cache") });
}

function fakeView() {
  const v = { lines: [], statuses: [] };
  v.line = (type, text) => v.lines.push([type, text]);
  v.status = (s) => v.statuses.push(s);
  v.progress = () => {};
  return v;
}

const installs = (native) => native.calls.filter((c) => c.method === "ipa.install").map((c) => c.params);

test("an http link whose https twin exists installs from it without asking", async (t) => {
  const native = setup(t, { [TWIN]: { body: ipa("com.example.demo") } });
  let asked = 0;
  const r = await runIpaInstall({ url: HTTP, name: "Demo" }, fakeView(), { native, ask: async () => { asked++; return true; } });
  assert.equal(r.ok, true);
  assert.equal(r.bundleId, "com.example.demo");
  assert.equal(asked, 0);
  assert.deepEqual(installs(native), [{ url: HTTP, stream: true }]);
});

test("no https twin: This Download Is Not Secure, and Install Anyway installs over plain http", async (t) => {
  const native = setup(t, { [HTTP]: { body: ipa("com.example.demo") } });
  let asked = 0;
  const v = fakeView();
  const r = await runIpaInstall({ url: HTTP, name: "Demo" }, v, { native, ask: async () => { asked++; return true; } });
  assert.equal(asked, 1);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.bundleId, "com.example.demo");
  assert.deepEqual(installs(native), [{ url: HTTP, stream: true }, { url: HTTP, stream: true, insecure: true }]);
  assert.ok(v.statuses.includes(INSECURE_IPA_ALERT.title));
  assert.ok(v.lines.some(([type, text]) => type === "warning" && /^No https copy of the IPA: bigboss\.example offers/.test(text)), JSON.stringify(v.lines));
  assert.match(r.log, /Downloading over plain http \(Install Anyway\)/);

  // the link stays let through for the session: no second alert
  const again = await runIpaInstall({ url: HTTP, name: "Demo" }, fakeView(), { native, ask: async () => { asked++; return false; } });
  assert.equal(again.ok, true);
  assert.equal(asked, 1);
  assert.deepEqual(installs(native).at(-1), { url: HTTP, stream: true, insecure: true });
});

test("no https twin, Cancel: nothing installed, no error, declined", async (t) => {
  const native = setup(t, { [HTTP]: { body: ipa("com.example.demo") } });
  const r = await runIpaInstall({ url: HTTP, name: "Demo" }, fakeView(), { native, ask: async () => false });
  assert.equal(r.ok, false);
  assert.equal(r.cancelled, true);
  assert.equal(r.declined, true);
  assert.equal(r.error, null);
  assert.equal(installs(native).length, 1);
  assert.match(r.log, /» Cancelled$/);
});

test("https links and other errors never ask", async (t) => {
  const native = setup(t, {});
  let asked = 0;
  const r = await runIpaInstall({ url: TWIN, name: "Demo" }, fakeView(), { native, ask: async () => { asked++; return true; } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "not_found");
  // Install Anyway, then the http link is missing too: the plain download's own error, asked once
  const r2 = await runIpaInstall({ url: HTTP, name: "Demo" }, fakeView(), { native, ask: async () => { asked++; return true; } });
  assert.equal(r2.error.code, "not_found");
  assert.equal(asked, 1);
});

test("askInsecureIpa: the alert's Install Anyway is true, Cancel false", async () => {
  let shown = null;
  assert.equal(await askInsecureIpa({ alert: async (a) => { shown = a; return { index: 1 }; } }), true);
  assert.equal(shown, INSECURE_IPA_ALERT);
  assert.equal(await askInsecureIpa({ alert: async () => ({ index: 0 }) }), false);
});

test("ipaError: insecure where nothing asked is in our words", () => {
  const e = ipaError(Object.assign(new Error("insecure: x.example offers this IPA only over plain http, without encryption"), { code: "insecure" }), "Demo");
  assert.equal(e.code, "insecure");
  assert.equal(e.title, INSECURE_IPA_ALERT.title);
  assert.match(e.message, /^Demo is only offered over plain http/);
});

test("a queued app's row: Cancel on the alert ends the row as cancelled", async (t) => {
  const native = setup(t, { [HTTP]: { body: ipa("com.example.demo") } });
  const lanes = helperLanes({ install: (job, view, opts) => runIpaInstall(job, view, { ...opts, ask: async () => false }), native });
  await assert.rejects(lanes.install({ id: "com.example.demo", name: "Demo", job: { url: HTTP } }, { signal: null, progress: () => {} }),
    /cancelled/);
});

test("Apt.swift: ipa.install passes insecure, and http links go through fetchHTTP (twin, PlainDownload), not URLSession", () => {
  const src = readFileSync(fileURLToPath(new URL("../../native/Sources/Apt.swift", import.meta.url)), "utf8");
  assert.match(src, /IPAInstall\.run\(url, listed: \.init\(c\.params\), insecure: insecure,/);
  const fetch = src.slice(src.indexOf("static func fetchHTTP"), src.indexOf("static func run(_ url: URL, listed"));
  assert.match(fetch, /PlainDownload\.start\(url,/);
  assert.match(fetch, /Download\.start\(twin,/);
  assert.match(fetch, /"insecure: /);
  const run = src.slice(src.indexOf("private static func download(_ url: URL, insecure"));
  assert.ok(run.indexOf("Sideload.httpsTwin(url)") < run.indexOf("session.downloadTask"), "the http branch comes before URLSession");
});
