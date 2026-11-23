// The website's Install (F92, user 2026-11-18: "the webpage install still shows open in and get in all these apps. we
// shouldnt"): an app page offers only Install and Download IPA. F93: Install signs in the browser
// (signing-client.js signInBrowser), and Home's Install iFizBox App signs iFizBox (home.js installApp). My IPAs' links
// (F95) still say the certificate is needed, with Download IPA beside OK. Share keeps the sideloaders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installRows, SITE_INSTALL_FOOTER, SITE_INSTALL_SUBTITLE, SITE_CERT_TITLE, siteCertificateAlert } from "./altstore.js";
import * as handoff from "./handoff.js";
import { installApp, showsSigningTile } from "./home.js";
import { siteInstallSheet } from "./myipas.js";
import { APP_IPA_URL, APP_NAME } from "../core/appoffer.js";

const V = { version: "1.2", downloadURL: "https://example.com/My-Delta.ipa" };
const labels = (rows) => rows.map((r) => r.label);

const SITE = { site: true, jailbreak: false, custom: false };

const IFIZBOX = { version: "0.3.7", downloadURL: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.3.7/iFizBox.ipa" };

test("the website's Install rows: iFizBox installs in the browser; other apps go to iFizBox first (F96), no hand-offs", () => {
  const own = installRows(IFIZBOX, "https://example.com/apps.json", () => {}, () => {}, null, "iFizBox", SITE).rows;
  assert.deepEqual(labels(own), ["Install", "Download IPA"]);
  assert.equal(own[0].subtitle, SITE_INSTALL_SUBTITLE);
  const { rows } = installRows(V, "https://example.com/apps.json", () => {}, () => {}, null, "Delta", SITE);
  assert.deepEqual(labels(rows), ["Install in iFizBox", "Download IPA", "Install on the Website"]);
  assert.ok(!rows.some((r) => r.handoff), "no hand-off rows");
  assert.ok(!rows.some((r) => /Open in|Get in|AltStore|SideStore|Feather/.test(`${r.label} ${r.subtitle}`)), labels(rows).join());
  assert.doesNotMatch(SITE_INSTALL_FOOTER, /AltStore|SideStore|Feather|Open in/);
  assert.ok(!rows.some((r) => r.label === "Custom Install"), "no Custom Install on the website");
});

test("the website's Download IPA opens the file; nothing is recorded", async () => {
  const opened = [];
  let recorded = 0;
  const { rows } = installRows(V, null, (u) => opened.push(u), () => { recorded++; }, null, "Delta", SITE);
  rows[1].onClick(); // Download IPA; Install signs (signing-client.test.js covers it)
  assert.deepEqual(opened, [V.downloadURL]);
  assert.equal(recorded, 0, "Download IPA installs nothing, so nothing on the Installed tab");
});

test("siteCertificateAlert (My IPAs on the website): OK does nothing, Download IPA downloads", async () => {
  let downloads = 0;
  let shown = null;
  const alert = (index) => async (o) => { shown = o; return { index } };
  assert.equal(await siteCertificateAlert({ download: () => downloads++, alert: alert(0) }), false);
  assert.equal(shown.title, SITE_CERT_TITLE);
  assert.deepEqual(shown.buttons, ["OK", "Download IPA"]);
  assert.equal(downloads, 0);
  assert.equal(await siteCertificateAlert({ download: () => downloads++, alert: alert(1) }), true);
  assert.equal(downloads, 1);
});

test("a source's own signed link stays first on the website; the jailbreak app keeps its helper", () => {
  const itms = { version: "1", downloadURL: "itms-services://?action=download-manifest&url=x" };
  assert.deepEqual(labels(installRows(itms, null, () => {}, () => {}, null, "X", { site: true, jailbreak: false }).rows), ["Install"]);
  const jb = installRows(V, null, () => {}, () => {}, null, "X", { site: false, jailbreak: true, custom: false }).rows;
  assert.deepEqual(labels(jb), ["Install", "Download IPA"]);
  assert.equal(jb[0].subtitle, "With the jailbreak");
});

test("the sideload app still signs: Install, no hand-offs", () => {
  const { rows } = installRows(V, null, () => {}, () => {}, null, "X", { site: false, jailbreak: false, custom: false });
  assert.deepEqual(labels(rows), ["Install", "Download IPA"]);
  assert.equal(rows[0].subtitle, "Signed with your certificate");
  assert.equal(rows[0].needsCertificate, undefined);
});

test("by default (no bridge: the website in node) iFizBox installs in the browser and other apps get the F96 rows", () => {
  const saved = globalThis.ifizboxNative;
  try {
    delete globalThis.ifizboxNative;
    assert.deepEqual(labels(installRows(IFIZBOX, null).rows), ["Install", "Download IPA"]);
    assert.deepEqual(labels(installRows(V, null).rows), ["Install in iFizBox", "Download IPA", "Install on the Website"]);
  } finally { if (saved) globalThis.ifizboxNative = saved; }
  assert.match(SITE_INSTALL_FOOTER, /signs the app here in the browser/);
});

test("the install hand-offs are gone (F95): nothing builds Open in iFizBox / Get in links", () => {
  assert.equal(handoff.installLinks, undefined);
  assert.equal(handoff.HANDOFF_APPS, undefined);
});

test("Home's Install iFizBox App (F93): signs iFizBox with the certificate, or opens Settings > Signing; no sideloaders", async () => {
  const calls = [];
  let marked = 0;
  const deps = (ready, bring) => ({ ready: async () => ready, bring: () => bring, go: (h) => calls.push(["go", h]), installed: () => marked++,
    install: ({ onInstalled, ...o }) => { calls.push(["install", o]); onInstalled(); },
    sheet: async () => "certificate", free: async () => false, focus: () => {} }); // F385: Sign iFizBox First's pick
  assert.equal(await installApp(deps(false, true)), "signing");
  assert.equal(await installApp(deps(true, false)), "install");
  assert.deepEqual(calls, [["go", "/home/settings/signing"], ["install", { url: APP_IPA_URL, name: APP_NAME, bring: false }]]);
  assert.equal(marked, 1, "F96: once installed, the first-visit prompt stops");
  assert.equal(showsSigningTile("site"), true);
  assert.equal(showsSigningTile("sideload"), true);
  assert.equal(showsSigningTile("jailbreak"), false);
});

test("My IPAs on the website: a link's Install is the certificate alert, whose Download IPA opens the link", async () => {
  const opened = [];
  let shown = null;
  const entry = { file: "a", url: "https://e.example/A.ipa", name: "A" };
  assert.equal(await siteInstallSheet(entry, { alert: async (o) => { shown = o; return { index: 0 }; }, open: (u) => opened.push(u) }), false);
  assert.equal(shown.title, SITE_CERT_TITLE);
  assert.deepEqual(shown.buttons, ["OK", "Download IPA"]);
  assert.ok(!shown.buttons.some((b) => /Open in|Get in|AltStore|SideStore|Feather/.test(b)));
  assert.deepEqual(opened, []);
  assert.equal(await siteInstallSheet(entry, { alert: async () => ({ index: 1 }), open: (u) => opened.push(u) }), true);
  assert.deepEqual(opened, ["https://e.example/A.ipa"]);
  let asked = 0;
  assert.equal(await siteInstallSheet({ file: "a" }, { alert: async () => { asked++; return { index: 1 }; }, open: (u) => opened.push(u) }), false);
  assert.equal(asked, 0, "no link, no alert");
});
