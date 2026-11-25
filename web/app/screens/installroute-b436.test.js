// B436: the pairing code expires after 10 minutes (the shell answers idevice.pair with "expired: ..."): the page says
// so where the code was and offers a new one; no alert, and nothing starts by itself.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

globalThis.document = fakeDocument();
const { drawInstallation, leave, reread, pendingStep, setupGroups } = await import("./installroute.js");
const { codeExpired, CODE_EXPIRED, NEW_CODE } = await import("../core/installroute.js");

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const flush = () => new Promise((r) => setTimeout(r, 0));
const STATUS = { paired: null, pairOnPhone: true, otherVPN: false, vpn: { available: true, tested: true } };

test("codeExpired: the shell's expired answer only", () => {
  assert.ok(codeExpired(Object.assign(new Error("the pairing code expired"), { code: "expired" })));
  assert.ok(codeExpired(new Error("expired: the pairing code expired")));
  assert.ok(!codeExpired(new Error("canceled: pairing stopped")));
  assert.ok(!codeExpired(null));
});

test("the expired page: no code, the reason with Get New Code, the steps without a spinner", () => {
  const gs = setupGroups("pairing", null, null, { failed: true, expired: true });
  assert.deepEqual(gs[2].rows.map((r) => r.label), [NEW_CODE]);
  assert.equal(gs[2].footer, CODE_EXPIRED);
  assert.ok(!gs.some((g) => g.pin || g.spinner));
  assert.ok(gs[3].guide);
  assert.equal(gs.length, 4);
});

test("expiring says so with no alert; Get New Code pairs again with a new code", async () => {
  let pairs = 0, expire;
  const native = { call: (m, p, ev) => {
    if (m === "idevice.status") return Promise.resolve(STATUS);
    if (m === "idevice.pair") return new Promise((_, no) => {
      ev({ pin: `12345${++pairs}` });
      expire = () => no(Object.assign(new Error("the pairing code expired"), { code: "expired" }));
    });
    return Promise.resolve(null);
  } };
  const box = document.createElement("div"), alerts = [];
  const store = { get: () => "iphone", set: () => {} };
  const redraw = () => drawInstallation(box, "pair", { store, native, alert: async (a) => { alerts.push(a); return { index: 0 }; }, redraw });
  globalThis.location = { hash: "" };
  await redraw();
  await flush();
  assert.equal(withClass(box, "pair-code")[0].textContent, "123 451");
  expire();
  await flush(); await flush();
  assert.match(box.textContent, /The code expired after 10 minutes\./);
  assert.equal(withClass(box, "pair-code").length, 0, "the expired code is off the page");
  assert.equal(pendingStep(true), null, "leaving asks nothing");
  assert.deepEqual(alerts, []);
  await redraw(); // coming back to the app
  await flush();
  assert.equal(pairs, 1, "nothing starts by itself");
  const row = withClass(box, "sign-import").find((n) => n.textContent.includes(NEW_CODE));
  const tapped = all(row).find((n) => n.listeners?.click?.length);
  tapped.listeners.click.forEach((f) => f({}));
  await flush(); await flush();
  assert.equal(pairs, 2);
  assert.equal(withClass(box, "pair-code")[0].textContent, "123 452");
  assert.doesNotMatch(box.textContent, /expired/);
  leave();
});

test("expired in the background with the reply lost: coming back reads it; a late reply leaves the new code alone", async () => {
  let pairs = 0, late;
  const native = { call: (m, p, ev) => {
    if (m === "idevice.status") return Promise.resolve(STATUS);
    if (m === "idevice.pairState") return Promise.resolve({ active: false, expired: true });
    if (m === "idevice.pair") return new Promise((_, no) => { ev({ pin: `12345${++pairs}` }); late ??= () => no(new Error("expired: x")); });
    return Promise.resolve(null);
  } };
  const box = document.createElement("div");
  const redraw = () => drawInstallation(box, "pair", { store: { get: () => "iphone", set: () => {} }, native, alert: async () => ({ index: 0 }), redraw });
  document.visibilityState = "visible";
  await redraw();
  await flush();
  await reread();
  await flush();
  assert.match(box.textContent, /The code expired/);
  const row = withClass(box, "sign-import").find((n) => n.textContent.includes(NEW_CODE));
  all(row).find((n) => n.listeners?.click?.length).listeners.click.forEach((f) => f({}));
  await flush(); await flush();
  late();
  await flush(); await flush();
  assert.equal(withClass(box, "pair-code")[0].textContent, "123 452");
  leave();
});
