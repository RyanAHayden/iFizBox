// F67: the jailbreak build's Install IPA flow: core/ipainstall.js (URLs, status lines, the error explanations) and
// ipa-install.js's console run against the fake bridge and fake helper (native/fake/), as screens/ipa-install.js
// drives it. The bridge's own side is backend-native-ipa.test.js (F59).
import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { join } from "node:path";
import { ipaUrl, looksLikeIpa, ipaName, ipaStatus, ipaStep, ipaError, NO_ADHOC_HELP } from "./core/ipainstall.js";
import { installIpa, runIpaInstall, ipaInstallAvailable } from "./ipa-install.js";
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

const URL_ = "https://apps.example/Demo%20App.ipa";

function setup(t, { env = {}, net = { [URL_]: { body: ipa("com.example.demo") } }, mode } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  return createFakeNative({ prefix: fx.prefix, remote: fx.remote, net, env, mode, ipaDir: join(fx.dir, "ipa-cache") });
}

function fakeView() {
  const v = { lines: [], statuses: [], bar: [] };
  v.line = (type, text) => v.lines.push([type, text]);
  v.status = (s) => v.statuses.push(s);
  v.progress = (p) => v.bar.push(p);
  return v;
}

test("ipaUrl: http(s) links only, https:// added to a bare host", () => {
  assert.equal(ipaUrl("  https://a.example/x.ipa "), "https://a.example/x.ipa");
  assert.equal(ipaUrl("a.example/x.ipa"), "https://a.example/x.ipa");
  assert.equal(ipaUrl("http://a.example/x.ipa"), "http://a.example/x.ipa");
  for (const bad of ["", "   ", "file:///etc/passwd", "itms-services://?action=download", "not a link", "javascript:alert(1)", "foo"]) {
    assert.equal(ipaUrl(bad), null, bad);
  }
});

test("looksLikeIpa and ipaName read the link's path", () => {
  assert.equal(looksLikeIpa("https://a.example/dl/App.IPA?token=1"), true);
  assert.equal(looksLikeIpa("https://a.example/App.ipa.html"), false);
  assert.equal(looksLikeIpa("ftp://a.example/App.ipa"), false);
  assert.equal(looksLikeIpa("nonsense"), false);
  assert.equal(ipaName(URL_), "Demo App");
  assert.equal(ipaName("https://a.example/"), "App");
  assert.equal(ipaName("junk"), "App");
});

test("ipaStatus: the download is the bar's first fifth, installd's percent the rest", () => {
  assert.deepEqual(ipaStatus("dlstatus:ipa:0:Downloading"), { text: "Downloading", percent: 0 });
  assert.deepEqual(ipaStatus("pmstatus:com.example.demo:50:Installing"), { text: "Installing", percent: 60 });
  assert.deepEqual(ipaStatus("pmstatus:com.example.demo:100:Installed"), { text: "Installed", percent: 100 });
  // B400: each step's own percent beside the bar's
  assert.deepEqual(ipaStatus("dlstatus:ipa:40:Downloading"), { text: "Downloading", percent: 8, step: 40 });
  assert.deepEqual(ipaStatus("pmstatus:com.example.demo:75:Installing 40%"), { text: "Installing", percent: 80, step: 40 });
  assert.deepEqual(["Preparing", "Downloading", "Copying the IPA", "Unpacking", "Sealing the app (ldid)", "Signing ad hoc (ldid)",
    "Adding the application-identifier entitlement (ldid)", "Installing (AppSync Unified)", "Installed", "Done"].map(ipaStep),
  ["Preparing", "Downloading", "Copying", "Unpacking", "Signing", "Signing", "Signing", "Installing", null, null]);
  assert.deepEqual(ipaStatus("pmerror:com.example.demo:0:oops"), { text: "oops", percent: null, error: true });
  assert.equal(ipaStatus("Installed com.example.demo"), null);
});

test("ipaError: no_adhoc names AppSync Unified in one line (F189: no ldid or sign-it-yourself options)", () => {
  const e = ipaError(new Error("no_adhoc: AppSync Unified isn't installed and there's no ldid"), "Demo");
  assert.equal(e.code, "no_adhoc");
  assert.equal(e.title, "Needs AppSync Unified");
  assert.equal(e.detail, "AppSync Unified isn't installed and there's no ldid");
  assert.match(e.message, /^AppSync Unified isn't installed and there's no ldid\n\n/);
  assert.equal(NO_ADHOC_HELP.length, 1);
  assert.match(NO_ADHOC_HELP[0], /AppSync Unified \(cydia\.akemi\.ai\)/);
  assert.doesNotMatch(NO_ADHOC_HELP.join("\n"), /ldid|sign the IPA/);
  assert.deepEqual(e.lines, NO_ADHOC_HELP);
  // err.code from bridge.js wins; anything unknown is an install failure with the raw words.
  assert.equal(ipaError(Object.assign(new Error("whatever"), { code: "timeout" })).code, "timeout");
  const odd = ipaError(new Error("boom"), "Demo");
  assert.equal(odd.code, "install");
  assert.equal(odd.message, "iOS didn't install Demo: boom");
  assert.match(ipaError(new Error("not_found: HTTP 404 for x")).message, /HTTP 404 for x/);
  assert.equal(ipaError(new Error("sideload: x")).title, "Not Available");
});

test("the console run: the helper's lines streamed, pmstatus on the bar, Installed at the end", async (t) => {
  const native = setup(t, { env: { FAKE_LDID: "1" } });
  const v = fakeView();
  const r = await runIpaInstall({ url: URL_, name: "Demo" }, v, { native });
  assert.equal(r.ok, true);
  assert.equal(r.bundleId, "com.example.demo");
  assert.deepEqual(native.calls.find((c) => c.method === "ipa.install").params, { url: URL_, stream: true });
  assert.equal(v.statuses[0], "Preparing");
  assert.ok(v.statuses.includes("Downloading"));
  assert.equal(v.statuses.at(-1), "Done");
  assert.equal(v.bar[0], 0);
  assert.equal(v.bar.at(-1), 100);
  assert.ok(v.bar.every((p, i) => i === 0 || p >= v.bar[i - 1]), `the bar only moves forward: ${v.bar}`);
  assert.ok(v.lines.some(([type, text]) => type === "info" && text === "Installed com.example.demo"));
  assert.ok(v.lines.some(([type, text]) => type === "status" && text === "Installed"));
  assert.deepEqual(v.lines.at(-1), ["status", "Installed Demo (com.example.demo)"]);
  assert.match(r.log, /^https:\/\/apps\.example\/Demo%20App\.ipa\n/);
  assert.match(r.log, /» Installed Demo \(com\.example\.demo\)$/);
});

test("the console run: no_adhoc ends in red with what to install", async (t) => {
  const native = setup(t);
  const v = fakeView();
  const r = await runIpaInstall({ url: URL_, name: "Demo" }, v, { native });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "no_adhoc");
  assert.equal(v.statuses.at(-1), "Needs AppSync Unified");
  assert.equal(v.bar.at(-1), 100);
  const errors = v.lines.filter(([type]) => type === "error").map(([, text]) => text);
  assert.ok(errors.some((l) => /AppSync Unified isn.t installed and there.s no ldid/.test(l)), errors.join("\n"));
  const warnings = v.lines.filter(([type]) => type === "warning").map(([, text]) => text);
  assert.deepEqual(warnings, NO_ADHOC_HELP);
  assert.match(r.log, /E: (ifizbox-helper: )?AppSync Unified isn.t installed/);
});

test("the console run: other errors are one red line with the reason", async (t) => {
  const native = setup(t, { env: { FAKE_APPSYNC: "1" }, net: {} });
  const v = fakeView();
  const r = await runIpaInstall({ url: URL_, name: "Demo" }, v, { native });
  assert.equal(r.error.code, "not_found");
  assert.equal(v.statuses.at(-1), "Download Failed");
  assert.match(v.lines.at(-1)[1], /The server doesn't have Demo's IPA \(HTTP 404/);
});

test("installIpa keeps the shell's error code; the sideload build and the site have no ipa.install", async (t) => {
  const side = setup(t, { mode: "sideload" });
  await assert.rejects(installIpa(URL_, null, { native: side }), (e) => e.code === "sideload");
  await assert.rejects(installIpa(URL_, null, { native: null }), (e) => e.code === "sideload");
  const bad = setup(t);
  await assert.rejects(installIpa("file:///etc/passwd", null, { native: bad }), (e) => e.code === "bad_url");
  assert.equal(ipaInstallAvailable("sideload"), false);
  assert.equal(ipaInstallAvailable("site"), false);
});

test("the console run: one line per status, and the helper's own error line isn't said twice", async () => {
  const v = fakeView();
  const native = { async call(m, p, on) {
    for (const pct of [10, 50, 90]) on({ fd: "status", line: `pmstatus:com.example.demo:${pct}:Installing` });
    on({ fd: "err", line: "ifizbox-helper: installd refused the ad hoc signed app" });
    throw new Error("no_adhoc: installd refused the ad hoc signed app");
  } };
  const r = await runIpaInstall({ url: URL_ }, v, { native });
  assert.equal(r.error.code, "no_adhoc");
  assert.equal(v.lines.filter(([, text]) => text === "Installing").length, 1);
  assert.deepEqual(v.bar.slice(0, 4), [0, 28, 60, 92]);
  assert.equal(v.lines.filter(([, text]) => /installd refused/.test(text)).length, 1);
});
