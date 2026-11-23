// B250: Installation & Signing's status cell knows the certificate: none kept says Import Your Certificate (its action
// opens the Certificate page) on either route, instead of Ready to Install while every install stops at Set Up Signing.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

globalThis.document = fakeDocument();

const { mainPage, forgetStatus, hudHooks } = await import("./installroute.js");
const { installStatus, NO_CERTIFICATE, STATUS_ACTIONS } = await import("../core/installroute.js");
const { setNavigator } = await import("../nav/go.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const tap = (cell) => Promise.all(cell.listeners.click.map((f) => f({})));
const store = (route) => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; };
const PAIRED_ON = { paired: "rp", pairOnPhone: true, otherVPN: false, vpn: { available: true, tested: true } };
const bridge = (answers) => ({ call: (m) => Promise.resolve(answers[m]) });
const LINKS = { with: "#w", certificate: "#settings/signing/certificate", apps: "#a", help: "#h" };

test("core: no certificate is Import Your Certificate on both routes; unknown keeps the route's answer", () => {
  assert.equal(installStatus("server", undefined, { host: "ifizbox.com", certificate: false }), NO_CERTIFICATE);
  assert.equal(installStatus("iphone", PAIRED_ON, { certificate: false }), NO_CERTIFICATE);
  assert.equal(installStatus("iphone", undefined, { certificate: false }), NO_CERTIFICATE, "known before idevice.status answers");
  assert.equal(NO_CERTIFICATE.title, "Import Your Certificate");
  assert.equal(NO_CERTIFICATE.local, false);
  assert.equal(STATUS_ACTIONS[NO_CERTIFICATE.action], "Import Certificate");
  assert.equal(installStatus("server", undefined, { host: "ifizbox.com" }).state, "server");
  assert.equal(installStatus("server", undefined, { host: "ifizbox.com", certificate: true }).title, "Ready to Install");
  assert.equal(installStatus("iphone", PAIRED_ON, { certificate: true }).state, "ready");
});

test("main page, Signing Server, no certificate: the cell says Import Your Certificate and its action opens Certificate", async () => {
  forgetStatus();
  const went = [];
  setNavigator({ go: (to) => went.push(to) });
  const page = mainPage({ store: store("server"), native: bridge({}), links: LINKS,
    signing: async () => ({ certificate: { text: "None" }, ready: false }) });
  await page.refresh();
  assert.equal(page.status().state, "certificate");
  const action = withClass(page.el, "install-action")[0].children[0];
  assert.equal(withClass(action, "cell-label")[0].textContent, "Import Certificate");
  await tap(action);
  assert.deepEqual(went, [LINKS.certificate]);
  setNavigator(null);
});

test("main page: a certificate imported later turns the cell back to Ready to Install", async () => {
  forgetStatus();
  let ready = false;
  const page = mainPage({ store: store("server"), native: bridge({}), links: LINKS,
    signing: async () => ({ certificate: { text: ready ? "300 days left" : "None" }, ready }) });
  await page.refresh();
  assert.equal(page.status().state, "certificate");
  ready = true;
  await page.refresh();
  assert.equal(page.status().state, "server");
  assert.equal(page.status().title, "Ready to Install");
});

test("main page, Signing Server: no Ready to Install before signing.status first answers", async () => {
  forgetStatus();
  let answer;
  const page = mainPage({ store: store("server"), native: bridge({}), links: LINKS,
    signing: () => new Promise((r) => { answer = r; }) });
  const done = page.refresh();
  assert.equal(page.status().state, "checking");
  assert.equal(page.status().subtitle, "Your certificate.");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(page.status().state, "checking", "still waiting on signing.status");
  answer({ certificate: { text: "300 days left" }, ready: true });
  await done;
  assert.equal(page.status().title, "Ready to Install");
  // a failed read (no `ready`) is unknown: the route's answer, never Import Your Certificate
  const failed = mainPage({ store: store("server"), native: bridge({}), links: LINKS, signing: async () => ({ certificate: { text: "Unknown" } }) });
  await failed.refresh();
  assert.equal(failed.status().state, "server");
});

test("main page, This iPhone: signing answers before idevice.status: Import, and it stays when the status lands", async () => {
  forgetStatus();
  let answer;
  const slow = mainPage({ store: store("iphone"), native: { call: () => new Promise((r) => { answer = r; }) }, links: LINKS,
    signing: async () => ({ certificate: { text: "None" }, ready: false }) });
  const done = slow.refresh();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(slow.status().state, "certificate", "known before idevice.status answers");
  answer(PAIRED_ON);
  await done;
  assert.equal(slow.status().state, "certificate");
  forgetStatus();
});

test("main page, This iPhone: no certificate wins over Ready; a failed signing read leaves the route's answer", async () => {
  forgetStatus();
  const page = mainPage({ store: store("iphone"), native: bridge({ "idevice.status": PAIRED_ON }), links: LINKS,
    signing: async () => ({ certificate: { text: "None" }, ready: false }) });
  await page.refresh();
  assert.equal(page.status().state, "certificate");
  forgetStatus();
  const unknown = mainPage({ store: store("iphone"), native: bridge({ "idevice.status": PAIRED_ON }), links: LINKS,
    signing: async () => ({ certificate: { text: "Unknown" } }) });
  await unknown.refresh();
  assert.equal(unknown.status().state, "ready");
  forgetStatus();
});
