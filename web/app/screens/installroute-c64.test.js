// C64: This iPhone has one way in, the built-in VPN. No state of Install Apps With's page draws Tailscale, LocalDevVPN
// or Connect With, and the page draws Set Up and How It Works from the first frame (rows Checking…), before
// idevice.status answers, with no cached status, after a late answer, and after a failed one.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);

const { drawInstallation, installationGroups, forgetStatus, hudHooks, TIMEOUTS, NOT_RESPONDING } = await import("./installroute.js");
const { NO_VPN } = await import("../core/installroute.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;

const OLD = /tailscale|localdevvpn|connect with/i;
const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const labels = (box) => withClass(box, "cell-label").map((n) => n.textContent);
const cellOf = (box, label) => withClass(box, "cell-inner").find((n) => withClass(n, "cell-label")[0]?.textContent === label);
const detailOf = (box, label) => withClass(cellOf(box, label), "cell-detail")[0]?.textContent;
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const store = () => { const m = { installRoute: "iphone" }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; };
const later = () => { let answer, fail; const p = new Promise((r, no) => { answer = r; fail = no; }); return { p, answer, fail }; };

const vpn = (o = {}) => ({ available: true, tested: true, cellular: false, wifi: true, shortcuts: {}, ...o });
const STATES = [undefined, null, {}, { paired: false }, { paired: "rp" }, { paired: "rp", vpn: { available: false } },
  { paired: null, vpn: vpn({ available: false }) }, { paired: "rp", vpn: vpn() }, { paired: "rp", vpn: vpn({ tested: false }) },
  { paired: "rp", vpn: vpn({ cellular: true }) }, { paired: "rp", otherVPN: true, vpn: vpn() },
  { paired: "rp", otherVPN: true, vpn: vpn({ otherVPN: true, shortcuts: { switch: true, trip: true, idle: true } }) },
  { paired: null, pairOnPhone: true, vpn: vpn({ tested: false }) }];
const FLAGS = [{}, { reading: true }, { refreshing: { device: true } }, { late: { device: true } }, { picking: true }, { testing: true },
  { pairChecking: true }, { switchChecking: true }, { hint: { paired: "rp", vpn: vpn() }, reading: true },
  { failure: { title: "iPhone Refused", short: "Every connection was refused.", fix: "check", button: "Check Again" } }];

test("no state draws Tailscale, LocalDevVPN or Connect With", () => {
  for (const st of STATES) for (const flags of FLAGS) {
    const text = JSON.stringify(installationGroups("iphone", st, flags));
    assert.ok(!OLD.test(text), `${JSON.stringify(st)} ${JSON.stringify(flags)}: ${text.match(OLD)?.[0]}`);
  }
});

test("the first frame: Install Apps With, Set Up (all rows Checking…) and How It Works", () => {
  const gs = installationGroups("iphone", undefined, { reading: true });
  assert.deepEqual(gs.map((g) => g.header), ["Install Apps With", "Set Up", undefined]);
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.detail]), [["Pair This iPhone", "Checking…"], ["Test Connection", "Checking…"], ["Install Switch", "Checking…"]]);
  assert.ok(gs[1].rows.every((r) => r.spin));
  assert.equal(gs[1].footer, undefined);
  assert.equal(gs[2].rows[0].label, "How It Works");
  const late = installationGroups("iphone", null, { late: { device: true } });
  assert.deepEqual(late.map((g) => g.header), ["Install Apps With", "Set Up", undefined]);
  assert.equal(late[1].rows[0].detail, NOT_RESPONDING);
  assert.equal(installationGroups("iphone", undefined, {})[1].header, "Set Up", "no flags: still Set Up, never the old groups");
});

test("a profile without Network Extensions says so in Set Up", () => {
  const gs = installationGroups("iphone", { paired: "rp", vpn: { available: false } });
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.detail]), [["Network Extensions", "Missing"]]);
  assert.equal(gs[1].footer, NO_VPN.message);
  assert.equal(gs[1].warn, true);
});

test("the page draws Set Up and How It Works before idevice.status answers, with no cached status", async () => {
  forgetStatus();
  const dev = later();
  const box = make("div");
  const done = drawInstallation(box, "iphone", { store: store(), native: { call: () => dev.p } });
  assert.deepEqual(labels(box).slice(0, 4), ["Pair This iPhone", "Test Connection", "Install Switch", "How It Works"], labels(box).join(", "));
  assert.equal(detailOf(box, "Pair This iPhone"), "Checking…");
  assert.ok(!OLD.test(box.textContent), box.textContent);
  dev.answer({ paired: "rp", vpn: { available: false } });
  await done;
  assert.ok(labels(box).includes("Network Extensions"));
  assert.match(box.textContent, new RegExp(NO_VPN.message.slice(0, 40)));
  assert.ok(!OLD.test(box.textContent), box.textContent);
});

test("a late answer: the first frame stands, then the rows fill without the old groups", async () => {
  forgetStatus();
  const dev = later();
  const box = make("div");
  const done = drawInstallation(box, "with", { store: store(), native: { call: () => dev.p } });
  await flush();
  assert.ok(!OLD.test(box.textContent));
  dev.answer({ paired: "rp", vpn: vpn() });
  await done;
  assert.equal(detailOf(box, "Pair This iPhone"), "Done");
  assert.ok(!OLD.test(box.textContent));
});

test("a failed or rejected answer says Not Responding, with no old groups", async () => {
  for (const how of ["rejects", "never"]) {
    forgetStatus();
    const was = TIMEOUTS.status;
    TIMEOUTS.status = 20;
    try {
      const box = make("div");
      const native = { call: () => (how === "rejects" ? Promise.reject(new Error("no")) : new Promise(() => {})) };
      const first = drawInstallation(box, "iphone", { store: store(), native });
      assert.ok(labels(box).includes("Pair This iPhone"), "drawn before the answer");
      await first;
      assert.equal(detailOf(box, "Pair This iPhone"), NOT_RESPONDING, how);
      assert.ok(!OLD.test(box.textContent), box.textContent);
      assert.equal(withClass(box, "loading-spinner").length, 0, "nothing spins on");
    } finally { TIMEOUTS.status = was; }
  }
});
