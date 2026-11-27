// F68: the sideload build's look-first install (signing-sheet.js) and the page's side of F14's calls in
// core/signing.js: the sheet's params, what it shows, the certificate warnings, Signed Apps, Re-sign All's HUD and
// the re-sign reminder call. A fake ifizboxNative stands in for native/Sources/Sideload.swift.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeNative, withDocument, tick } from "./fakes.test-helper.js";
import { inspectAndInstall, followInstall, openSignSheet } from "./signing-sheet.js";
import { installOnDevice } from "./signing-client.js";
import { progressHUD } from "./nav/progress.js";
import {
  installParams, inspectGroups, isCgBI, fromBase64, certificateWarnings, revocationLabel, resignLabel, signedAppRows,
  syncReminder, installedId, validBundleId, entitlementName,
} from "./core/signing.js";
import { createSettings, FEATURES } from "./core/settings.js";

const coded = (code, message) => Object.assign(new Error(message), { code });
function fakeUI() {
  const ui = { labels: [], hidden: 0, alerts: [], timers: [] };
  ui.hud = (t) => { ui.labels.push(t); return { set: (x) => ui.labels.push(x), hide: () => { ui.hidden++; } }; };
  ui.alert = async (a) => { ui.alerts.push(a); return { index: 0 }; };
  ui.later = (f, ms) => ui.timers.push([f, ms]);
  return ui;
}

// Delta as signing.inspect answers it (Sideload.swift inspect).
const INFO = {
  token: "tok1",
  app: {
    name: "Delta", bundleId: "com.rileytestut.Delta", version: "1.6", minimumOS: "14.0", size: 52_000_000,
    entitlements: { "application-identifier": "X.com.rileytestut.Delta", "aps-environment": "production",
      "com.apple.security.application-groups": ["group.com.rileytestut.Delta"] },
    permissions: [{ key: "NSCameraUsageDescription", label: "Camera", text: "Scan QR codes." }],
    extensions: [
      { path: "PlugIns/DeltaWidget.appex", bundleId: "com.rileytestut.Delta.Widget", name: "Widget", point: "com.apple.widgetkit-extension" },
      { path: "PlugIns/Share.appex", bundleId: "com.rileytestut.Delta.Share", name: "Share", point: "com.apple.share-services" },
    ],
  },
  icon: null,
  missing: ["aps-environment", "com.apple.security.application-groups"],
  signsAs: "com.rileytestut.Delta",
  profileKind: "Development",
};

let saved;
beforeEach(() => { saved = globalThis.ifizboxNative; });
afterEach(() => { globalThis.ifizboxNative = saved; });

test("installParams: the token, and only the edits that change something", () => {
  assert.deepEqual(installParams(INFO, { name: "Delta", bundleId: "com.rileytestut.Delta", icon: null, removeExtensions: [] }), { token: "tok1" });
  assert.deepEqual(installParams(INFO, {}), { token: "tok1" });
  assert.deepEqual(installParams(INFO, {
    name: "  Delta 2 ", bundleId: "com.me.delta", icon: "iVBORw0KGgo=",
    removeExtensions: ["PlugIns/Share.appex", "PlugIns/Share.appex", "PlugIns/Nope.appex"],
  }), { token: "tok1", name: "Delta 2", bundleId: "com.me.delta", icon: "iVBORw0KGgo=", removeExtensions: ["PlugIns/Share.appex"] });
  // the ID compared is the one it signs as (an explicit profile's), not the IPA's
  assert.deepEqual(installParams({ ...INFO, signsAs: "com.team.fixed" }, { bundleId: "com.team.fixed" }), { token: "tok1" });
  assert.throws(() => installParams(INFO, { bundleId: "com..bad" }), /isn't a bundle ID/);
  assert.throws(() => installParams({ app: {} }, {}), /looked at/);
  assert.equal(validBundleId("com.you.app-2"), true);
  assert.equal(validBundleId(".com"), false);
  assert.equal(validBundleId("com.you app"), false);
});

test("inspectGroups: app, permissions, entitlements (missing marked) and what the profile can't give", () => {
  const g = inspectGroups(INFO);
  assert.deepEqual(g.map((x) => x.header), ["App", "Permissions", "Entitlements", "Your Profile Can't Give It"]);
  assert.deepEqual(g[0].rows.map((r) => `${r.label}=${r.detail}`), ["Version=1.6", "Size=49.6 MB", "Needs iOS=14.0 or later", "Profile=Development"]);
  assert.deepEqual(g[1].rows, [{ label: "Camera", subtitle: "Scan QR codes." }]);
  const ent = Object.fromEntries(g[2].rows.map((r) => [r.label, r.detail]));
  assert.equal(ent["Push Notifications"], "Missing");
  assert.equal(ent["App ID"], null);
  assert.deepEqual(g[3].rows.map((r) => r.label), ["Push Notifications", "App Groups"]);
  assert.equal(entitlementName("com.example.custom"), "com.example.custom");
  const bare = inspectGroups({ token: "t", app: { name: "X" }, missing: [] });
  assert.deepEqual(bare.map((x) => x.header), ["App", "Permissions", "Entitlements"]);
  assert.deepEqual(bare[1].rows, [{ label: "None" }]);
});

test("isCgBI: Apple's CgBI PNG is told apart from a plain one", () => {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const cgbi = new Uint8Array([...sig, 0, 0, 0, 4, 0x43, 0x67, 0x42, 0x49, 0x50, 0, 0x20, 2]);
  const plain = new Uint8Array([...sig, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]);
  assert.equal(isCgBI(cgbi), true);
  assert.equal(isCgBI(plain), false);
  assert.equal(isCgBI(fromBase64(Buffer.from(cgbi).toString("base64"))), true);
  assert.equal(isCgBI(new Uint8Array(4)), false);
});

test("Install: inspect, the sheet's edits, signing.install {token, ...edits}, then Done once iOS has the link", async () => {
  const native = fakeNative({
    "signing.inspect": (p, on) => { on({ phase: "downloading", progress: 0.5 }); return INFO; },
    "signing.install": (p, on) => { on({ phase: "signing", progress: 0.3 }); return { bundleId: "com.me.delta", name: "Delta 2" }; },
  });
  globalThis.ifizboxNative = native;
  const ui = fakeUI();
  let shown = null;
  const sheet = (info, { onSign }) => {
    shown = info;
    setTimeout(() => onSign({ name: "Delta 2", bundleId: "com.me.delta", icon: null, removeExtensions: ["PlugIns/DeltaWidget.appex"] }), 0);
    return () => {};
  };
  const installed = [];
  const install = (opts) => installOnDevice(opts, { native, hud: ui.hud, alert: ui.alert, later: ui.later });
  const ok = await inspectAndInstall({ url: "https://example.com/Delta.ipa", name: "Delta", onInstalled: (r) => installed.push(r) },
    { native, hud: ui.hud, alert: ui.alert, install, sheet, later: ui.later });
  assert.equal(ok, true);
  assert.equal(shown, INFO);
  // B252: Confirm holds the app awake (signing.hold) until signing.install has answered
  assert.deepEqual(native.calls.map((c) => c.method), ["signing.inspect", "signing.hold", "signing.install", "signing.hold"]);
  assert.deepEqual(native.calls[0].params, { url: "https://example.com/Delta.ipa" });
  assert.deepEqual([native.calls[1].params, native.calls[3].params], [{ on: true }, { on: false }]);
  const { manifestServer, ...sent } = native.calls[2].params;
  assert.deepEqual(sent, { token: "tok1", name: "Delta 2", bundleId: "com.me.delta", removeExtensions: ["PlugIns/DeltaWidget.appex"] });
  assert.match(manifestServer, /^https:\/\//);
  assert.deepEqual(installed, [{ bundleId: "com.me.delta", name: "Delta 2" }]);
  // let the progress call finish (after() runs it without awaiting)
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ui.labels, ["Downloading", "Downloading 50%", "Downloading", "Signing 30%", "Waiting for iOS", "Sent to iOS. Press Home to watch it install."]);
  assert.equal(ui.timers.length, 1); // the HUD goes a moment after Done
});

test("Install: Cancel on the sheet signs nothing; a bad ID is said before signing", async () => {
  const native = fakeNative({ "signing.inspect": INFO });
  const ui = fakeUI();
  const cancel = (info, { onClose }) => { setTimeout(onClose, 0); return () => {}; };
  assert.equal(await inspectAndInstall({ url: "https://e.com/a.ipa" }, { native, hud: ui.hud, alert: ui.alert, install: () => assert.fail(), sheet: cancel }), false);
  assert.deepEqual(native.calls.map((c) => c.method), ["signing.inspect"]);

  let tries = 0;
  const bad = (info, { onSign, onClose }) => {
    setTimeout(async () => { tries++; await onSign({ bundleId: "no spaces" }); onClose(); }, 0);
    return () => {};
  };
  assert.equal(await inspectAndInstall({ url: "https://e.com/a.ipa" }, { native, hud: ui.hud, alert: ui.alert, install: () => assert.fail(), sheet: bad }), false);
  assert.equal(tries, 1);
  assert.equal(ui.alerts.at(-1).title, "Can't Sign");
});

test("Install: inspect's errors are alerts; an older shell without signing.inspect installs straight away", async () => {
  const ui = fakeUI();
  const failing = fakeNative({ "signing.inspect": coded("bad_url", "not an http(s) URL") });
  assert.equal(await inspectAndInstall({ url: "x", name: "Delta" }, { native: failing, hud: ui.hud, alert: ui.alert, sheet: () => assert.fail() }), false);
  assert.equal(ui.alerts[0].title, "Couldn't Install Delta");
  assert.equal(ui.hidden, 1);

  const old = fakeNative({ "signing.inspect": new Error("unknown method signing.inspect") });
  const straight = [];
  const r = await inspectAndInstall({ url: "https://e.com/a.ipa", name: "A" },
    { native: old, hud: ui.hud, alert: ui.alert, install: (o) => { straight.push(o); return true; }, sheet: () => assert.fail() });
  assert.equal(r, true);
  assert.equal(straight[0].url, "https://e.com/a.ipa");
  assert.equal(straight[0].params, undefined);
});

// A progress page as nav/progress.js openProgress draws it, keeping what the tests look at.
function fakePage() {
  const p = {
    title: "Running", statusText: "", finished: null, closed: false, closers: [],
    line() {}, step() {}, error() {}, raw() {}, progress() {},
    status(t) { p.statusText = t; },
    finish(o) { p.title = "Complete"; p.finished = o; },
    reopen() { p.title = "Running"; p.finished = null; },
    onClose(f) { p.closers.push(f); },
    close() { p.closed = true; p.closers.forEach((f) => f()); },
  };
  return p;
}

test("followInstall: once iOS has the link the page says Done and ends on Return; no signing.progress (user 2026-11-18)", async () => {
  const page = fakePage();
  const native = { async call() { assert.fail("iOS's install isn't followed"); } };
  assert.equal(await followInstall(native, "com.a", progressHUD("Installing", { open: () => page }), { later: () => assert.fail("no timer") }), null);
  assert.equal(page.title, "Complete");
  assert.equal(page.finished.status, "Sent to iOS. Press Home to watch it install."); // F252
  assert.equal(page.finished.label, "Return to iFizBox"); // B45/B67: a normal app's install says Return to iFizBox
  page.close(); // else the next job continues on this page (progressHUD)
  const own = fakePage();
  await followInstall(native, "com.ryha.ifizbox", progressHUD("Installing", { open: () => own }), { later: () => assert.fail("no timer") });
  // B49: iFizBox's own IPA ends locked on Closing iFizBox (no Close to tap until iOS closes it)
  assert.equal(own.finished.label, "Closing iFizBox");
  assert.equal(own.finished.locked, true);
  own.close();
  const ui = fakeUI();
  assert.equal(await followInstall(native, "com.a", ui.hud("Installing"), { later: ui.later }), null);
  assert.equal(ui.timers.length, 1); // a plain HUD goes a moment after Done
});

test("certificateWarnings: revoked, and signatures ending within 7 days", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  assert.deepEqual(certificateWarnings(null, now), []);
  assert.deepEqual(certificateWarnings({ revocation: { status: "good" }, signatureExpires: "2027-01-01T00:00:00Z" }, now), []);
  const rev = certificateWarnings({ revocation: { status: "revoked", revokedAt: "2026-11-10T08:00:00Z" } }, now);
  assert.equal(rev.length, 1);
  assert.match(rev[0], /revoked.*2026-11-10/);
  assert.match(certificateWarnings({ signatureExpires: "2026-11-20T12:00:00Z" }, now)[0], /in 3 days \(2026-11-20\)/);
  assert.match(certificateWarnings({ signatureExpires: "2026-11-17T20:00:00Z" }, now)[0], /within a day/);
  assert.match(certificateWarnings({ signatureExpires: "2026-11-01T00:00:00Z" }, now)[0], /already expired/);
  assert.deepEqual(certificateWarnings({ signatureExpires: "2026-11-24T12:00:01Z" }, now), []);
  assert.equal(certificateWarnings({ revocation: { status: "revoked" }, signatureExpires: "2026-11-18T00:00:00Z" }, now).length, 2);
  assert.equal(revocationLabel(null), "Not Checked");
  assert.equal(revocationLabel({ status: "revoked" }), "Revoked");
});

test("Signed Apps' rows and Re-sign All's HUD text", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const rows = signedAppRows({ apps: [
    { bundleId: "b", name: "Bravo", version: "2", expires: "2026-12-01T00:00:00Z" },
    { bundleId: "a", name: "Alpha", version: "1", expires: "2026-11-19T00:00:00Z" },
    { bundleId: "c", name: "", expires: null },
  ] }, now);
  assert.deepEqual(rows.map((r) => [r.label, r.detail, r.expiring]), [["Alpha", "1 day", true], ["Bravo", "13 days", false], ["c", "", false]]);
  assert.equal(rows[0].subtitle, "Version 1 · a");
  assert.deepEqual(signedAppRows(null), []);
  assert.equal(resignLabel({ index: 0, count: 3, name: "Delta", phase: "signing", progress: 0.5 }), "Signing 50% Delta (1 of 3)");
  assert.equal(resignLabel({ index: 2, count: 3, name: "Kodi", phase: "waiting" }), "Re-signing Kodi (3 of 3)");
  assert.equal(resignLabel({}), null);
});

test("Re-sign Reminder: shown in the sideload build, and its value goes to signing.remind {days}", async () => {
  assert.ok(FEATURES.has("resign"));
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const s = createSettings({ storage, mode: "sideload" });
  assert.equal(s.isShown("resignReminder"), true);
  assert.equal(createSettings({ storage, mode: "jailbreak" }).isShown("resignReminder"), false);
  const native = fakeNative({ "signing.remind": (p) => ({ at: p.days ? "2026-11-20T10:00:00Z" : null }) });
  const call = (m, p) => native.call(m, p);
  assert.deepEqual(await syncReminder(s.get, call), { at: "2026-11-20T10:00:00Z" });
  s.set("resignReminder", 7);
  await syncReminder(s.get, call);
  s.set("resignReminder", 0);
  assert.deepEqual(await syncReminder(s.get, call), { at: null });
  assert.deepEqual(native.calls.map((c) => c.params), [{ days: 2 }, { days: 7 }, { days: 0 }]);
  assert.equal(await syncReminder(s.get, null), null);
  assert.equal(await syncReminder(s.get, async () => { throw new Error("unknown method"); }), null);
});

test("the sheet on a free Apple ID's profile (pinned): no Keep Bundle ID switch or notes, and no keepBundleId sent", async () => {
  const as = "com.rileytestut.Delta.TEAM123456";
  const free = { ...INFO, pinned: true, keepBundleId: false, signsAs: as, appIdAs: as, profileAppId: as };
  const draw = (info) => withDocument(async (doc) => {
    const signed = [];
    openSignSheet(info, { onSign: (e) => signed.push(e) });
    await tick();
    const labels = doc.body.querySelectorAll(".cell-label").map((n) => n.textContent);
    const footers = doc.body.querySelectorAll(".group-footer").map((n) => n.textContent).join(" ");
    const keep = doc.body.querySelectorAll(".ss-keep").length;
    await doc.body.querySelector(".ss-install").click();
    for (let i = 0; i < 5; i++) await tick();
    return { labels, footers, keep, edits: signed[0] };
  });
  const pinned = await draw(free);
  assert.equal(pinned.keep, 0);
  assert.ok(!pinned.labels.includes("Keep Bundle ID"));
  assert.doesNotMatch(pinned.footers, /original|keeps its own ID|notifications/i);
  assert.equal(pinned.edits.bundleId, as);
  assert.equal("keepBundleId" in pinned.edits, false);
  assert.deepEqual(installParams(free, pinned.edits), { token: "tok1" });
  // any other profile keeps the switch and sends it
  const other = await draw({ ...INFO, pinned: false, keepBundleId: true });
  assert.equal(other.keep, 1);
  assert.ok(other.labels.includes("Keep Bundle ID"));
  assert.equal(other.edits.keepBundleId, true);
});
