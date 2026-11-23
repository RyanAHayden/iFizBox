// B148: Settings pages kept on the stack refresh their state-made details in place when they come back into view
// (nav/pagestate.js pageShown, called by app.js on Back): change state on the sub-page, fire Back, read the detail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument, fakePage, tick } from "../nav/fakedom.test-helper.js";
import { pageShown } from "../nav/pagestate.js";

import { accountSection } from "./account.js";
import { deviceSigningSection, deviceSigningDetail, siteSigningDetail, listDetail, holdsDetail, blockedDetail, settingsShown,
  certificateRows, settings } from "./settings.js";
import { grouped } from "../nav/ui.js";
import { refreshInstallation, installationRows } from "./installroute.js";
import { patchDetails, cellsOf } from "../nav/pagestate.js";
import { beforeEach, afterEach } from "node:test";

// The fake document only while a test runs: the modules above load as they do under node (no document).
let saved;
beforeEach(() => { saved = globalThis.document; globalThis.document = fakeDocument(); });
afterEach(() => { globalThis.document = saved; });

const ROOT = { tab: "settings", path: [] };
const detailOf = (page, label) => cellsOf(page).find((c) => c.label === label)?.detail?.textContent;
// Back to `route`: what app.js does when a kept page is on top again.
const back = async (route, page) => { await pageShown(route, page); await tick(); };

test("iFizBox Account: Sign In on the Account page, Back: the root's row says On (and Off after Sign Out)", async () => {
  let signedIn = false;
  const acct = () => ({ status: async () => ({ signedIn }) });
  const page = fakePage();
  page.append(accountSection({ acct }));
  await tick();
  const label = cellsOf(page)[0].label;
  assert.equal(detailOf(page, label), "Off");
  const cell = page.querySelector(".cell");
  signedIn = true; // Sign In on Settings > iFizBox Account
  await back(ROOT, page);
  assert.equal(detailOf(page, label), "On");
  assert.equal(page.querySelector(".cell"), cell, "the same row, updated in place");
  signedIn = false; // Sign Out
  await back(ROOT, page);
  assert.equal(detailOf(page, label), "Off");
});

test("Signing: a certificate imported on the Signing page shows on the root's row after Back", async () => {
  let state = [null, null];
  const page = fakePage();
  page.append(deviceSigningSection(document.createElement("div"), async () => state));
  await tick();
  assert.equal(detailOf(page, "Signing"), "None");
  state = [{ identity: { name: "Dev Cert", hasPrivateKey: true }, ready: true }, { p12: "x", profile: "y" }];
  const shown = deviceSigningDetail(...state);
  await back(ROOT, page);
  assert.equal(detailOf(page, "Signing"), shown);
  state = [null, { p12: "x" }];
  await back(ROOT, page);
  assert.equal(detailOf(page, "Signing"), "Incomplete");
});

test("the site's Signing detail: None, Incomplete, Unreadable", () => {
  assert.equal(siteSigningDetail(null), "None");
  assert.equal(siteSigningDetail({ p12: "x" }), "Incomplete");
  assert.equal(siteSigningDetail({ profile: "not a profile" }), "Unreadable");
});

test("a list row (Theme's or Updates' choice): picked on its page, Back: the row shows it", async () => {
  const d = { key: "k", options: [{ value: "a", label: "Apple" }, { value: "b", label: "Banana" }] };
  let v = "a";
  const store = { get: () => v };
  const page = fakePage();
  page.append(grouped([{ rows: [{ label: "Fruit", detail: listDetail(d, store), live: () => listDetail(d, store), href: "#" }] }]));
  await tick();
  assert.equal(detailOf(page, "Fruit"), "Apple");
  v = "b";
  await back({ tab: "settings", path: ["general"] }, page);
  assert.equal(detailOf(page, "Fruit"), "Banana");
});

test("Ignored Upgrades and Blocked counts follow after Back", async () => {
  let holds = [], versions = {}, blocked = [];
  const store = { holds: { list: () => holds }, ignoredVersions: { all: () => versions }, blocked: { list: () => blocked, authors: () => [] } };
  const page = fakePage();
  page.append(grouped([{ rows: [
    { label: "Ignored Upgrades", detail: holdsDetail(store), live: () => holdsDetail(store) },
    { label: "Blocked", detail: blockedDetail(store), live: () => blockedDetail(store) }] }]));
  await tick();
  assert.equal(detailOf(page, "Ignored Upgrades"), "None");
  holds = ["a"]; versions = { b: "1.0" }; blocked = ["c"];
  await back({ tab: "settings", path: ["updates"] }, page);
  assert.equal(detailOf(page, "Ignored Upgrades"), "2");
  assert.equal(detailOf(page, "Blocked"), "1");
});

test("the app's real store: a list row drawn from settings follows settings.set", async () => {
  const d = (await import("../core/settings.js")).SETTINGS.find((s) => s.kind === "list" && s.options?.length > 1);
  if (!d) return;
  const page = fakePage();
  page.append(grouped([{ rows: [{ label: d.label, detail: "", live: () => listDetail(d) }] }]));
  await tick();
  const was = settings.get(d.key);
  const other = d.options.find((o) => o.value !== was);
  settings.set(d.key, other.value);
  try {
    await back(ROOT, page);
    assert.equal(detailOf(page, d.label), other.label);
  } finally { settings.set(d.key, was); }
});

test("only the page shown refreshes; a detail on another page waits for its own Back", async () => {
  let n = 0;
  const a = fakePage(), b = fakePage();
  a.append(grouped([{ rows: [{ label: "A", live: () => String(++n) }] }]));
  b.append(grouped([{ rows: [{ label: "B", live: () => "b" }] }]));
  await tick();
  assert.equal(detailOf(a, "A"), "1");
  await back(ROOT, b);
  assert.equal(detailOf(a, "A"), "1");
  await back(ROOT, a);
  assert.equal(detailOf(a, "A"), "2");
});

test("Installation & Signing: Back to the main page refreshes it in place; This iPhone and Certificate patch theirs", async () => {
  const calls = [];
  const opts = {
    isMerged: () => true,
    main: () => ({ refresh: () => calls.push("main") }),
    installation: (el, sub) => calls.push(`installation/${sub}`),
    certificate: () => calls.push("certificate"),
  };
  const el = fakePage();
  settingsShown({ tab: "settings", path: ["signing"] }, el, opts);
  settingsShown({ tab: "settings", path: ["installation"] }, el, opts);
  settingsShown({ tab: "settings", path: ["installation", "iphone"] }, el, opts);
  settingsShown({ tab: "settings", path: ["installation", "pair"] }, el, opts);
  settingsShown({ tab: "settings", path: ["signing", "certificate"] }, el, opts);
  settingsShown({ tab: "settings", path: ["signing", "server"] }, el, opts);
  settingsShown(ROOT, el, opts);
  assert.deepEqual(calls, ["main", "main", "installation/iphone", "certificate"]);
});

test("This iPhone: paired on the Pairing page, Back: Pairing says Paired on the row already drawn", async () => {
  let paired = false;
  const native = { call: async (m) => (m === "idevice.status" ? { paired, vpn: { available: true } } : null) };
  const store = { get: () => "iphone" };
  const page = fakePage();
  page.append(grouped([{ rows: installationRows("iphone", { paired: false, vpn: { available: true } }, { store }) }]));
  assert.equal(detailOf(page, "Pair This iPhone"), "Start");
  const cells = page.querySelectorAll(".cell").length;
  paired = true;
  await refreshInstallation(page, "iphone", { store, native, patch: (el, rows) => patchDetails(cellsOf(el), rows) });
  assert.equal(detailOf(page, "Pair This iPhone"), "Done");
  assert.equal(page.querySelectorAll(".cell").length, cells, "no rows added or removed");
});

test("Certificate: rows from a fresh read; None and Incomplete without one", () => {
  assert.deepEqual(certificateRows({ kept: null, staged: false }), [{ label: "Certificate", detail: "None" }]);
  assert.deepEqual(certificateRows({ kept: null, staged: true }), [{ label: "Certificate", detail: "Incomplete" }]);
});
