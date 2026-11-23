// B135: Check Connection answers on its own button: a success is a check and "Successful" (no alert), a failure the
// alert as before and an x on the button; back to plain after CHECK_RESET.ms or on the next tap. Both buttons: the
// paired Pairing page's and the main page's action row.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

// The shared fake DOM.
globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);

const { drawInstallation, leave, hudHooks, CHECK_RESET, mainPage } = await import("./installroute.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const cellOf = (box, label) => withClass(box, "cell-inner").find((n) => withClass(n, "cell-label")[0]?.textContent.includes(label));
const tap = (cell) => Promise.all(cell.listeners.click.map((f) => f({})));
const store = (route = "iphone") => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; }, m }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PAIRED_ON = { paired: "rp", pairOnPhone: true, otherVPN: false, vpn: { available: true, tested: true } };
function bridge(answers) {
  return { call: (m) => { const a = answers[m]; return typeof a === "function" ? a() : a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}
const look = (cell) => ({ check: cell.attrs["data-check"] || "", label: withClass(cell, "cell-label")[0].textContent });

test("the Pairing page: success shows a check and Successful with no alert, then goes back to plain", async () => {
  CHECK_RESET.ms = 30;
  const alerts = [];
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native: bridge({ "idevice.status": PAIRED_ON, "idevice.verify": {} }),
    alert: async (a) => { alerts.push(a.title); return { index: 0 }; } });
  const cell = cellOf(box, "Check Connection");
  await tap(cell);
  assert.deepEqual(alerts, []);
  assert.deepEqual(look(cell), { check: "ok", label: "✓Successful" });
  await wait(50);
  assert.deepEqual(look(cell), { check: "", label: "Check Connection" });
  leave();
});

test("the Pairing page: failure keeps the alert and shows an x until the alert is closed and the time is up", async () => {
  CHECK_RESET.ms = 30;
  let close;
  const alerts = [];
  const box = make("div");
  const err = Object.assign(new Error("connect_failed: no route"), { code: "connect_failed" });
  await drawInstallation(box, "pair", { store: store(), native: bridge({ "idevice.status": PAIRED_ON, "idevice.verify": err }),
    alert: (a) => { alerts.push(a.title); return new Promise((r) => { close = () => r({ index: 0 }); }); } });
  const cell = cellOf(box, "Check Connection");
  const run = tap(cell);
  await wait(5);
  assert.deepEqual(alerts, ["Couldn't Connect"]);
  assert.deepEqual(look(cell), { check: "fail", label: "✕Check Connection" });
  await wait(50);
  assert.equal(look(cell).check, "fail", "kept while the alert is up");
  close();
  await run;
  assert.equal(look(cell).check, "fail");
  await wait(50);
  assert.deepEqual(look(cell), { check: "", label: "Check Connection" });
  leave();
});

test("the next tap clears the last answer before it checks again", async () => {
  CHECK_RESET.ms = 300;
  let answer;
  const box = make("div");
  let n = 0;
  await drawInstallation(box, "pair", { store: store(), alert: async () => ({ index: 0 }),
    native: bridge({ "idevice.status": PAIRED_ON, "idevice.verify": () => (n++ ? new Promise((r) => { answer = r; }) : Promise.resolve({})) }) });
  const cell = cellOf(box, "Check Connection");
  await tap(cell);
  assert.equal(look(cell).check, "ok");
  const again = tap(cell);
  assert.deepEqual(look(cell), { check: "", label: "Check Connection" });
  await wait(5); // F301: idevice.status is read first, then idevice.verify
  answer({});
  await again;
  assert.equal(look(cell).check, "ok");
  leave();
});

test("the main page's action row: Successful stays through the status repaint, then goes", async () => {
  CHECK_RESET.ms = 30;
  const alerts = [];
  const page = mainPage({ store: store(), native: bridge({ "idevice.status": PAIRED_ON, "idevice.developerMode": { on: true }, "idevice.verify": {} }),
    alert: async (a) => { alerts.push(a.title); return { index: 0 }; }, links: {} });
  await page.refresh();
  const cell = withClass(page.el, "install-action")[0].children[0];
  assert.equal(look(cell).label, "Check Connection", `status: ${page.status().state}`);
  await tap(cell);
  assert.deepEqual(alerts, []);
  assert.deepEqual(look(cell), { check: "ok", label: "✓Successful" });
  await wait(50);
  assert.deepEqual(look(cell), { check: "", label: "Check Connection" });
});

test("F301: the main page shows the last idevice.status answer at once instead of Checking…, then reads again", async () => {
  const { forgetStatus, rememberStatus } = await import("./installroute.js");
  forgetStatus();
  const page0 = mainPage({ store: store(), native: bridge({ "idevice.status": () => new Promise(() => {}) }), links: {} });
  page0.refresh();
  assert.equal(page0.status().state, "checking", "nothing known yet: Checking…");
  rememberStatus(PAIRED_ON);
  let answer;
  const page = mainPage({ store: store(), native: bridge({ "idevice.status": () => new Promise((r) => { answer = r; }) }), links: {} });
  const done = page.refresh();
  assert.equal(page.status().state, "ready", "Ready to Install from the last answer");
  answer({ ...PAIRED_ON, paired: null });
  await done;
  assert.equal(page.status().state, "pair", "the fresh answer replaces it");
  forgetStatus();
});
