// F237: Keep Bundle IDs. The ID and entitlement choice per profile kind and option (both signers' rules: core/websign.js
// signingIds, core/keepid.js keepPlan), the warnings, the guide link, the bridge params, the website's job (no -b,
// the profile's App ID in the entitlements), Custom Install's params and the queue's library job.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepPlan, profileFacts, profileNotes, originalNote, sheetNotes, notifyNote, originalState, withKeep, storedKeep, keepOn,
  OLD_WAY_ALERT, GUIDE_ID, GUIDE_ROUTE, siteSigned, rememberSiteSigned, resignNote, installWarningText, SITE_SIGNED_KEY,
  RESIGN_TITLE, RESIGN_BUTTONS, INSTALL_WARNING_TITLE, INSTALL_WARNING_BUTTONS } from "./keepid.js";
import { signingIds, profileInfo, plistXml } from "./websign.js";
import { installParams, installedId, signsAsFor, parseProfile } from "./signing.js";
import { libraryJob } from "./appqueue.js";
import { SETTINGS } from "./settings.js";
import { runSignJob } from "../websign-job.js";
import { parsePlist } from "./signing.js";

const ADHOC_PUSH = { appId: "com.you.youtube", push: "production", kind: "Ad Hoc", wildcard: false };
const ADHOC = { appId: "com.you.youtube", push: null, kind: "Ad Hoc", wildcard: false };
const DEV = { appId: "com.you.youtube", push: "development", kind: "Development", wildcard: false };
const PREFIX = { appId: "com.you.*", push: null, kind: "Ad Hoc", wildcard: true };
const ALL = { appId: "*", push: null, kind: "Development", wildcard: true };
const ids = (n) => n.map((x) => x.id);

test("signingIds / keepPlan: kept, Info.plist keeps the app's ID and the entitlements get the profile's App ID", () => {
  assert.deepEqual(signingIds("com.you.youtube", "com.google.ios.youtube"), { bundleId: "com.google.ios.youtube", entitlementsId: "com.you.youtube" });
  assert.deepEqual(signingIds("com.you.*", "com.google.ios.youtube"), { bundleId: "com.google.ios.youtube", entitlementsId: "com.you.youtube" });
  assert.deepEqual(signingIds("com.you.*", "com.you.tool"), { bundleId: "com.you.tool", entitlementsId: "com.you.tool" });
  assert.deepEqual(signingIds("*", "io.dev.delta"), { bundleId: "io.dev.delta", entitlementsId: "io.dev.delta" });
  // off: the old way, the app becomes the profile's ID
  assert.deepEqual(signingIds("com.you.youtube", "com.google.ios.youtube", { keep: false }), { bundleId: "com.you.youtube", entitlementsId: "com.you.youtube" });
  assert.deepEqual(signingIds("com.you.*", "io.dev.delta", { keep: false }), { bundleId: "com.you.delta", entitlementsId: "com.you.delta" });
  for (const p of [ADHOC_PUSH, ADHOC, DEV, PREFIX]) {
    const k = keepPlan(p, "com.google.ios.youtube");
    assert.equal(k.bundleId, "com.google.ios.youtube", p.kind);
    assert.equal(k.entitlementsId, "com.you.youtube", p.kind);
    assert.equal(keepPlan(p, "com.google.ios.youtube", { keep: false }).bundleId, "com.you.youtube", p.kind);
  }
});

test("profileNotes per profile kind: what it can't do with the ID kept, and the guide link", () => {
  assert.deepEqual(ids(profileNotes(ADHOC_PUSH)), ["one-app"], "an Ad Hoc profile with Push: only the one-app reminder");
  assert.deepEqual(ids(profileNotes(ADHOC)), ["no-push", "one-app"]);
  assert.deepEqual(ids(profileNotes(DEV)), ["development", "one-app"]);
  assert.deepEqual(ids(profileNotes(PREFIX)), ["wildcard"]);
  assert.deepEqual(ids(profileNotes(ALL)), ["wildcard"]);
  assert.match(profileNotes(PREFIX, { name: "YouTube" })[0].text, /wildcard \(com\.you\.\*\).*YouTube keeps its ID but won't get notifications/);
  assert.match(profileNotes(DEV)[0].text, /test servers/);
  assert.match(profileNotes(ADHOC)[0].text, /doesn't have Push/);
  for (const p of [ADHOC, DEV, PREFIX]) assert.equal(profileNotes(p)[0].guide, true, "links the guide");
  assert.equal(profileNotes(ADHOC_PUSH)[0].guide, false);
  // one explicit App ID with Push covers every app; an ID per app only keeps keychains and App Groups apart
  const oneApp = profileNotes(ADHOC_PUSH)[0].text;
  assert.match(oneApp, /com\.you\.youtube.*covers every app's notifications.*own keychain.*App Groups folders.*App ID per app only/);
  assert.doesNotMatch(oneApp, /use it for one app/);
  // off: one plain warning, whatever the profile
  const off = profileNotes(ADHOC_PUSH, { keep: false, name: "YouTube", as: "com.you.youtube" });
  assert.deepEqual(ids(off), ["old-way"]);
  assert.match(off[0].text, /YouTube becomes a separate copy under your ID \(com\.you\.youtube\).*notifications won't work.*sign-in, iCloud/);
  assert.match(OLD_WAY_ALERT.message, /separate copy.*notifications won't work/);
  assert.deepEqual(GUIDE_ROUTE, ["guides", GUIDE_ID]);
});

test("profileFacts reads signing.status, signing.inspect and the website's parsed profile alike", () => {
  assert.deepEqual(profileFacts({ appId: "com.you.*", wildcard: true, kind: "Ad Hoc", push: null }), PREFIX);
  assert.deepEqual(profileFacts({ profileAppId: "com.you.youtube", profileKind: "Ad Hoc", push: "production", wildcard: false }), ADHOC_PUSH);
  assert.deepEqual(profileFacts({ appId: "com.you.youtube", getTaskAllow: true, devices: 2, push: "development" }), DEV);
  assert.equal(profileFacts(null), null);
});

test("the original app on the phone: warned unless iFizBox signed that copy; not when the old way makes a copy", async () => {
  assert.equal(originalNote("YouTube", { installed: false }), null);
  assert.equal(originalNote("YouTube", { installed: true, ours: true }), null);
  assert.match(originalNote("YouTube", { installed: true }).text, /YouTube is already on this iPhone.*replaces it.*App Store copy: delete that one first/);
  const info = { app: { name: "YouTube", bundleId: "com.google.ios.youtube" }, profileAppId: "com.you.youtube", push: "production",
    profileKind: "Ad Hoc", wildcard: false, appIdAs: "com.you.youtube" };
  assert.deepEqual(ids(sheetNotes(info, { installed: true }).notes), ["original", "one-app"]);
  assert.deepEqual(ids(sheetNotes(info, { keep: false, installed: true }).notes), ["old-way"]);
  assert.equal(sheetNotes({ ...info, push: null }).guide, true);
  const calls = [];
  const native = { call: async (m, p) => { calls.push(m); return m === "apps.isInstalled" ? { installed: { [p.bundleIds[0]]: true } } : { apps: [{ bundleId: "x" }] }; } };
  assert.deepEqual(await originalState(native, "com.google.ios.youtube"), { installed: true, ours: false });
  assert.deepEqual(calls, ["apps.isInstalled", "signing.installed"]);
  assert.deepEqual(await originalState({ call: async () => { throw new Error("no"); } }, "a.b"), { installed: false, ours: false });
  assert.deepEqual(await originalState(null, "a.b"), { installed: false, ours: false });
});

test("notifyNote (F413): the app asks for App Groups or Communication Notifications and the profile has none", () => {
  const GROUPS = "com.apple.security.application-groups", COMM = "com.apple.developer.usernotifications.communication";
  const app = { name: "RyukGram", bundleId: "com.burbn.instagram", entitlements: { [GROUPS]: ["group.com.burbn.instagram"], [COMM]: true },
    extensions: [{ path: "PlugIns/Service.appex", point: "com.apple.usernotifications.service" }] };
  const info = { app, profileAppId: "com.you.apps", push: "production", profileKind: "Ad Hoc", wildcard: false, appIdAs: "com.you.apps",
    profileGroups: [], missing: [COMM] }; // App Groups ticked, none assigned: not in missing
  const both = notifyNote(info, { name: "RyukGram" });
  assert.match(both.text, /no App Groups or Communication Notifications, which RyukGram asks for.*may not show.*newer profile that has them/);
  assert.equal(both.guide, true);
  assert.deepEqual(ids(sheetNotes(info).notes), ["no-notify", "one-app"]);
  assert.equal(sheetNotes(info).guide, true);
  // missing one
  assert.match(notifyNote({ ...info, profileGroups: ["group.com.you.1"] }).text, /no Communication Notifications, which the app asks for.*has it/);
  assert.match(notifyNote({ ...info, missing: [] }).text, /no App Groups, which/);
  // an older shell sends no profileGroups: only an absent key is known
  assert.match(notifyNote({ ...info, profileGroups: undefined, missing: [GROUPS] }).text, /no App Groups, which/);
  assert.equal(notifyNote({ ...info, profileGroups: undefined, missing: [] }), null);
  // has both
  const has = { ...info, profileGroups: ["group.com.you.1"], missing: [] };
  assert.equal(notifyNote(has), null);
  assert.equal(sheetNotes(has).guide, false);
  // the app does not ask, or has no notification service extension
  for (const entitlements of [{}, { [GROUPS]: [] }, undefined]) assert.equal(notifyNote({ ...info, app: { ...app, entitlements } }), null);
  assert.equal(notifyNote({ ...info, app: { ...app, extensions: [{ point: "com.apple.widgetkit-extension" }] } }), null);
  assert.equal(notifyNote({ ...info, app: { ...app, extensions: undefined } }), null);
  // other profiles have their own note; off is the old way's warning alone
  for (const p of [{ wildcard: true }, { profileKind: "Development" }, { push: "development" }, { push: null }]) assert.equal(notifyNote({ ...info, ...p }), null);
  assert.deepEqual(ids(sheetNotes(info, { keep: false }).notes), ["old-way"]);
  assert.equal(notifyNote(null), null);
});

test("the setting: on by default, both signing builds; withKeep sends false only when off, a job's choice wins", () => {
  const d = SETTINGS.find((x) => x.key === "keepBundleId");
  assert.equal(d.default, true);
  assert.equal(d.kind, "toggle");
  assert.deepEqual(d.modes, ["site", "sideload"]);
  assert.equal(d.confirmOff, OLD_WAY_ALERT, "turning it off asks first");
  const store = (v) => ({ getItem: (k) => (k === "ifizbox.keepBundleId" ? v : null) });
  assert.equal(storedKeep(store(null)), true);
  assert.equal(storedKeep(store("true")), true);
  assert.equal(storedKeep(store("false")), false);
  assert.equal(storedKeep({ getItem: () => { throw new Error("private"); } }), true);
  assert.equal(keepOn(() => false), false);
  assert.equal(keepOn(() => true), true);
  assert.deepEqual(withKeep({ url: "u" }, true), { url: "u" });
  assert.deepEqual(withKeep({ url: "u" }, false), { url: "u", keepBundleId: false });
  assert.deepEqual(withKeep({ url: "u", keepBundleId: true }, false), { url: "u", keepBundleId: true });
  assert.deepEqual(withKeep(null, false), { keepBundleId: false });
});

test("Custom Install: the switch always goes, and the ID compares with what that choice signs as", () => {
  const info = { token: "t", app: { name: "YouTube", bundleId: "com.google.ios.youtube" }, signsAs: "com.google.ios.youtube",
    appIdAs: "com.you.youtube", keepBundleId: true };
  assert.deepEqual(installParams(info, { bundleId: "com.google.ios.youtube", keepBundleId: true }), { token: "t", keepBundleId: true });
  assert.deepEqual(installParams(info, { bundleId: "com.you.youtube", keepBundleId: false }), { token: "t", keepBundleId: false });
  assert.deepEqual(installParams(info, { bundleId: "com.me.other", keepBundleId: true }), { token: "t", keepBundleId: true, bundleId: "com.me.other" });
  assert.equal(signsAsFor(info, true), "com.google.ios.youtube");
  assert.equal(signsAsFor(info, false), "com.you.youtube");
  assert.equal(signsAsFor(info, undefined), "com.google.ios.youtube");
  assert.equal(installedId(null, { token: "t", keepBundleId: false }, info), "com.you.youtube");
  assert.equal(installedId(null, { token: "t", keepBundleId: true }, info), "com.google.ios.youtube");
  // an older shell (no appIdAs, signsAs the profile's) still reads as before
  assert.equal(signsAsFor({ app: { bundleId: "a.b" }, signsAs: "com.you.b" }, undefined), "com.you.b");
});

test("My IPAs in the queue: Sign Options saved the old way stay so; otherwise the global setting decides", () => {
  const entry = { file: "A.ipa", name: "A", bundleId: "io.dev.a", version: "1" };
  // F243: null is "no Sign Options saved" (the setting decides); true is the Sign Options page's switch, sent as it is
  assert.equal(libraryJob({ ...entry, options: { keepBundleId: null } }).options, null);
  assert.deepEqual(libraryJob({ ...entry, options: { keepBundleId: true } }).options, { edits: { keepBundleId: true } });
  assert.deepEqual(libraryJob({ ...entry, options: { keepBundleId: false } }).options, { edits: { keepBundleId: false } });
  assert.equal(libraryJob(entry).id, "io.dev.a", "it installs as its own ID");
});

test("the website's parsed profile carries Push for the notes", () => {
  const xml = (ent) => new TextEncoder().encode(plistXml({ Name: "P", TeamIdentifier: ["TEAM"], Entitlements: ent }));
  assert.equal(parseProfile(xml({ "application-identifier": "TEAM.com.you.yt", "aps-environment": "production" })).push, "production");
  assert.equal(parseProfile(xml({ "application-identifier": "TEAM.com.you.*" })).push, null);
  assert.equal(profileInfo(xml({ "application-identifier": "TEAM.com.you.yt", "aps-environment": "development" })).push, "development");
});

// ---- the website's job with a fake zsign: kept, no -b and the profile's App ID in the entitlements ----------------
function fakeZsign(bundleId) {
  const files = new Map();
  const seen = { args: null, files };
  const create = async () => ({
    FS: {
      mkdir: () => {}, writeFile: (p, d) => files.set(p, d), readFile: (p) => files.get(p), unlink: (p) => files.delete(p),
      readdir: () => [".", "..", "App.app"],
    },
    ccall: (name) => (name === "ifizbox_unzip" ? 0 : JSON.stringify({ CFBundleIdentifier: bundleId, CFBundleName: "App" })),
    callMain: (args) => { seen.args = args; files.set(args[args.indexOf("-o") + 1], new Uint8Array([0x50, 0x4b, 1])); return 0; },
  });
  return { create, seen };
}
const explicit = new TextEncoder().encode(plistXml({ Name: "YT", TeamIdentifier: ["TEAM"],
  Entitlements: { "application-identifier": "TEAM.com.you.youtube", "com.apple.developer.team-identifier": "TEAM",
    "keychain-access-groups": ["TEAM.*"], "aps-environment": "production" } }));
const job = (over) => ({ ipa: new Uint8Array([0x50, 0x4b, 3, 4]), p12: new Uint8Array(1), profile: explicit, password: "", ...over });

test("website signing keeps the app's ID: no -b, entitlements with the profile's App ID, keychain group narrowed, Push", async () => {
  const { create, seen } = fakeZsign("com.google.ios.youtube");
  const r = await runSignJob(create, job({}));
  assert.equal(r.bundleId, "com.google.ios.youtube");
  assert.equal(seen.args.includes("-b"), false, "zsign takes Info.plist's ID");
  const ents = parsePlist(seen.files.get("/w/ents.plist"));
  assert.equal(ents["application-identifier"], "TEAM.com.you.youtube");
  // B227: the app's own keychain group first (not one shared by every app under the App ID), the App ID's after
  assert.deepEqual(ents["keychain-access-groups"], ["TEAM.com.google.ios.youtube", "TEAM.com.you.youtube"]);
  assert.equal(ents["aps-environment"], "production");
  assert.equal(ents["get-task-allow"], false);
});

test("website signing the old way (keepBundleId false); iFizBox's own IPA keeps its ID too (F280: push needs it)", async () => {
  let { create, seen } = fakeZsign("com.google.ios.youtube");
  let r = await runSignJob(create, job({ keepBundleId: false }));
  assert.equal(r.bundleId, "com.you.youtube");
  assert.equal(seen.args[seen.args.indexOf("-b") + 1], "com.you.youtube");
  ({ create, seen } = fakeZsign("com.ryha.ifizbox"));
  r = await runSignJob(create, job({}));
  assert.equal(r.bundleId, "com.ryha.ifizbox", "APNs delivers by the Info.plist ID");
  assert.ok(!seen.args.includes("-b"), "Info.plist left as it is");
  ({ create, seen } = fakeZsign("com.ryha.ifizbox"));
  r = await runSignJob(create, job({ keepBundleId: false }));
  assert.equal(r.bundleId, "com.you.youtube", "Keep Bundle IDs off: the old way, iFizBox too");
});

// F334: the one-app note no longer says apps under one App ID share a keychain (B227: each app's own group first)
test("F334: the one-app note: each app keeps its own keychain; only the profile's App Groups folders are shared", () => {
  const text = profileNotes(ADHOC_PUSH).find((n) => n.id === "one-app").text;
  assert.doesNotMatch(text, /share a keychain/);
  assert.match(text, /Each app keeps its own keychain/);
  assert.match(text, /share the profile's App Groups folders/);
});

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

test("F334: the website remembers team + App ID per bundle ID; resignNote names what changed", () => {
  const s = memoryStorage();
  assert.equal(siteSigned(s, "com.google.ios.youtube"), null);
  rememberSiteSigned(s, "com.google.ios.youtube", { team: "TEAM", appId: "com.you.youtube" });
  rememberSiteSigned(s, "io.dev.delta", { team: "TEAM", appId: "io.dev.delta" });
  const before = siteSigned(s, "com.google.ios.youtube");
  assert.deepEqual(before, { team: "TEAM", appId: "com.you.youtube" });
  assert.equal(JSON.parse(s.m.get(SITE_SIGNED_KEY))["io.dev.delta"].appId, "io.dev.delta");
  // same team and App ID: an update iOS takes, no warning
  assert.equal(resignNote(before, { team: "TEAM", appId: "com.you.youtube" }, "YouTube"), null);
  assert.equal(resignNote(null, { team: "OTHER", appId: "x" }, "YouTube"), null, "never signed here: nothing to say");
  assert.equal(resignNote(before, { team: "OTHER", appId: "com.you.youtube" }, "YouTube"),
    "YouTube was signed here before under another team (TEAM). If that copy is still on your iPhone, iOS won't update it with this one, and deleting it first loses its data.");
  assert.match(resignNote(before, { team: "TEAM", appId: "com.you.yt2" }, "YouTube"), /under another App ID \(com\.you\.youtube\)\./);
  assert.match(resignNote(before, { team: "B", appId: "com.b.yt" }, ""), /^The app was signed here before under another team \(TEAM\) and App ID \(com\.you\.youtube\)/);
  // unreadable storage: nothing remembered, nothing thrown
  assert.equal(siteSigned({ getItem: () => "{oops" }, "a"), null);
  assert.doesNotThrow(() => rememberSiteSigned({ getItem: () => null, setItem: () => { throw new Error("full"); } }, "a", { team: "T" }));
});

test("F334: the sign job's warnings as one alert message", () => {
  assert.equal(installWarningText(undefined), "");
  assert.equal(installWarningText(["", null]), "");
  assert.equal(installWarningText(["One.", " Two. "]), "One.\n\nTwo.");
  assert.equal(INSTALL_WARNING_TITLE, "Before You Install");
  assert.deepEqual(INSTALL_WARNING_BUTTONS, ["Cancel", "Install"]);
  assert.deepEqual(RESIGN_BUTTONS, ["Cancel", "Sign Anyway"]);
});

// F334 on the website's Install (signing/browser.js signInBrowser): the warnings come before the upload and Install
const site = await import("../signing-client.js");
function siteDeps(storage, { warnings = null, answer = 1, bundleId = "com.google.ios.youtube" } = {}) {
  const log = { alerts: [], uploads: 0 };
  const fetcher = async (url, init = {}) => {
    const u = new URL(url, "https://ifizbox.example");
    const j = (b) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
    if (u.pathname === "/api/fetch") return new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { headers: { "Content-Length": "4" } });
    if (u.pathname === "/sign/upload") { log.uploads++; return j({ token: "t", partSize: 64, parts: 1 }); }
    if (u.pathname === "/sign/upload/t/done") return j({ itms: "itms-services://x" });
    return j({ ok: true, method: init.method });
  };
  const d = {
    storage, fetcher, open: () => {}, go: () => {}, transfer: async () => null, phone: () => null, now: () => null,
    hud: () => ({ set: () => {}, hide: () => {} }),
    identity: async () => ({ p12: new Uint8Array([0x30]), profile: explicit, password: "" }),
    alert: async (a) => { log.alerts.push(a); const index = a.title === "Ready to Install" ? 1 : answer; a.onTap?.(index); return { index }; },
    worker: async () => ({ ipa: new Uint8Array([0x50, 0x4b, 1]), bundleId, originalId: bundleId, name: "YouTube", version: "1",
      ...(warnings ? { warnings } : {}) }),
  };
  return { d, log };
}

test("F334: website Install shows the job's warnings before Install; Cancel uploads nothing", async () => {
  const lost = ["This profile has no group.com.google.ios.youtube, where YouTube kept its shared data until now: iOS keeps that folder from it."];
  let { d, log } = siteDeps(memoryStorage(), { warnings: lost, answer: 0 });
  assert.equal(await site.signInBrowser({ url: "https://a.example/yt.ipa", name: "YouTube" }, d), false);
  assert.deepEqual(log.alerts.map((a) => [a.title, a.message, a.buttons]), [["Before You Install", lost[0], ["Cancel", "Install"]]]);
  assert.equal(log.uploads, 0);
  ({ d, log } = siteDeps(memoryStorage(), { warnings: lost, answer: 1 }));
  assert.equal(await site.signInBrowser({ url: "https://a.example/yt.ipa", name: "YouTube" }, d), true);
  assert.deepEqual(log.alerts.map((a) => a.title), ["Before You Install", "Ready to Install"]);
});

test("F334: website Install remembers team + App ID and warns before signing under another one", async () => {
  const s = memoryStorage();
  let { d, log } = siteDeps(s);
  assert.equal(await site.signInBrowser({ url: "https://a.example/yt.ipa", name: "YouTube", bundleId: "com.google.ios.youtube" }, d), true);
  assert.deepEqual(siteSigned(s, "com.google.ios.youtube"), { team: "TEAM", appId: "com.you.youtube" });
  assert.deepEqual(log.alerts.map((a) => a.title), ["Ready to Install"], "the same profile again: no warning");
  // another team signed it before: asked before signing; Cancel stops there
  rememberSiteSigned(s, "com.google.ios.youtube", { team: "OLDTEAM", appId: "com.you.youtube" });
  let signedJobs = 0;
  ({ d, log } = siteDeps(s, { answer: 0 }));
  const w = d.worker; d.worker = async (...a) => { signedJobs++; return w(...a); };
  assert.equal(await site.signInBrowser({ url: "https://a.example/yt.ipa", name: "YouTube", bundleId: "com.google.ios.youtube" }, d), false);
  assert.equal(signedJobs, 0, "nothing signed after Cancel");
  assert.equal(log.alerts[0].title, RESIGN_TITLE);
  assert.match(log.alerts[0].message, /another team \(OLDTEAM\)/);
  // an IPA whose ID only the job knows: the same warning comes after signing, before the upload
  ({ d, log } = siteDeps(s, { answer: 0 }));
  assert.equal(await site.signInBrowser({ url: "https://a.example/yt.ipa", name: "YouTube" }, d), false);
  assert.equal(log.alerts[0].title, "Before You Install");
  assert.match(log.alerts[0].message, /another team \(OLDTEAM\)/);
  assert.equal(log.uploads, 0);
});
