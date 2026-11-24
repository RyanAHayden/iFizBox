// F236: Settings > Signing's "This iPhone" rows under the Provisioning Profile (screens/signing.js deviceRows), and
// the line an install adds when nobody could check this iPhone against the profile (signing-sheet.js followInstall,
// signing-client.js siteCause).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceRows, DEVICE_HINTS } from "./signing.js";
import { deviceCheckText, IN_PROFILE_TEXT, notLandedText, NOT_LANDED_TEXT, SENT_TO_IOS, UDID_HOW } from "../core/signing.js";
import { answerFor, appHelpHref, openAppHelp, APP_HELP } from "./guides.js";
import { siteCause } from "../signing-client.js";
import { followInstall } from "../signing-sheet.js";
import { FIRST_LAUNCH_HINT } from "../core/installroute.js"; // F415: ends every install

const UDID = "00008030-0011223344556677";

test("in the profile: one row, the sentence as the footer", () => {
  const g = deviceRows(deviceCheckText({ state: "in", udid: UDID, count: 3 }));
  assert.deepEqual(g.rows, [{ label: "This iPhone", detail: "In Profile" }]);
  assert.equal(g.footer, IN_PROFILE_TEXT);
  assert.equal(g.warn, false);
});

test("not in the profile: red, with the UDID and Copy UDID", () => {
  const g = deviceRows(deviceCheckText({ state: "out", udid: UDID, count: 3 }));
  assert.deepEqual(g.rows.map((r) => r.label), ["This iPhone", "UDID", "Copy UDID"]);
  assert.equal(g.rows[0].detail, "Not in Profile");
  assert.equal(g.rows[1].subtitle, UDID);
  assert.equal(g.rows[2].copy, UDID);
  assert.equal(g.footer, DEVICE_HINTS.outCopy, "F316: the fix, short: the UDID is already a row");
  assert.equal(g.warn, true);
  const noUdid = deviceRows(deviceCheckText({ state: "out", count: 3 }));
  assert.deepEqual(noUdid.rows.map((r) => r.label), ["This iPhone"], "a set from the app's own profile: no UDID to copy");
  assert.equal(noUdid.footer, DEVICE_HINTS.out);
  assert.equal(noUdid.warn, true);
});

test("unknown: not checked, and where to find the UDID (or, with the website's Find row, only what's missing); skip: nothing", () => {
  const g = deviceRows(deviceCheckText({ state: "unknown", count: 5 }));
  assert.equal(g.rows[0].detail, "Unknown");
  assert.equal(g.footer, DEVICE_HINTS.unknown);
  assert.match(g.footer, /Finder/);
  assert.equal(deviceRows(deviceCheckText({ state: "unknown", count: 5 }), { find: true }).footer, DEVICE_HINTS.unknownFind);
  assert.equal(g.warn, false);
  assert.equal(deviceRows(deviceCheckText({ state: "skip", count: 0 })), null);
  assert.equal(deviceRows(null), null);
});

test("the website's install: the short help line when the profile lists devices", () => {
  const profile = (extra) => new TextEncoder().encode(`xx<?xml version="1.0"?><plist version="1.0"><dict>${extra}</dict></plist>xx`);
  const listed = siteCause({ profile: profile("<key>ProvisionedDevices</key><array><string>a</string><string>b</string></array>") }, "Foo");
  assert.equal(listed, NOT_LANDED_TEXT);
  assert.equal(listed, "Not on the Home Screen?");
  assert.equal(siteCause({ profile: profile("<key>ProvisionsAllDevices</key><true/>") }, "Foo"), null);
  assert.equal(siteCause({ profile: new Uint8Array([1, 2]) }, "Foo"), null, "an unreadable profile: no guess");
});

// A HUD whose page records every line and help line; finish's options too (no Retry on this page).
function hud() {
  const lines = [], sets = [], finished = [];
  const page = {
    line: (kind, text) => lines.push([kind, text]),
    help: (text, o) => lines.push(["help", text, o]),
  };
  return { lines, sets, finished, set: (t) => sets.push(t), finish: (o) => finished.push(o), page };
}

test("the app's install: 'Sent to iOS', and the grey help line only when its check couldn't run", async () => {
  for (const state of ["unknown", "out"]) {
    const h = hud();
    let helped = null;
    await followInstall(null, "com.example.app", h, { name: "Example", device: { state, count: 2 }, help: (p) => { helped = p; } });
    assert.deepEqual(h.sets, [SENT_TO_IOS]);
    assert.deepEqual(h.lines.map((l) => l[1]), ["Not on the Home Screen?", FIRST_LAUNCH_HINT], state);
    assert.equal(h.lines[0][0], "help");
    assert.equal(h.lines[0][1], "Not on the Home Screen?");
    assert.ok(!h.lines.some((l) => l[0] === "warning"), "no yellow paragraph any more");
    h.lines[0][2].action("PAGE");
    assert.equal(helped, "PAGE");
    assert.deepEqual(h.finished, [{ status: SENT_TO_IOS }], "Return only: no Retry");
  }
  for (const device of [{ state: "in", count: 2 }, { state: "skip", count: 0 }, null]) {
    const ok = hud();
    await followInstall(null, "com.example.app", ok, { name: "Example", device });
    assert.deepEqual(ok.lines.map((l) => l[1]), [FIRST_LAUNCH_HINT], JSON.stringify(device));
  }
});

test("Help opens Guides > FAQ > 'An app won't install', which now carries the UDID steps", () => {
  assert.equal(appHelpHref((r) => JSON.stringify(r)), JSON.stringify({ tab: "home", path: ["guides", "faq", "app"] }));
  for (const lite of [true, false]) {
    const a = answerFor(APP_HELP, lite);
    assert.equal(a.q, "An app won't install");
    assert.ok(a.steps.includes(UDID_HOW), "how to find the UDID");
    assert.ok(a.steps.some((s) => /UDID/.test(s) && /integrity could not be verified/.test(s) && /Settings > Signing/.test(s)));
  }
  let closed = 0, went = null;
  openAppHelp({ close: () => { closed++; } }, { go: (h) => { went = h; } });
  assert.equal(closed, 1);
  assert.equal(went, appHelpHref());
});

test("the website's watch: the cause under the last step once iOS has the app, and when it gives up waiting", async () => {
  const { watchInstall } = await import("../signing-client.js");
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
  const run = async (status, upTo) => {
    let now = 0;
    const lines = [];
    const help = () => "HELPED";
    const h = { set() {}, done() {}, hide() {}, page: { line: (k, t) => lines.push([k, t]), help: (t, o) => lines.push(["help", t, o.action === help]) } };
    const end = await watchInstall("ab".repeat(24), h, { fetcher: async () => json(status), cause: "CAUSE", help, clock: () => now,
      sleep: async (ms) => { now += ms; }, askWithin: 10 ** 9, upTo }).end;
    return { end, lines };
  };
  assert.deepEqual(await run({ manifest: true, started: true, finished: true }, 60000), { end: "installed", lines: [["help", "CAUSE", true], ["help", FIRST_LAUNCH_HINT, false]] });
  assert.deepEqual(await run({ manifest: true, started: false, finished: false }, 5000), { end: "timeout", lines: [["help", "CAUSE", true]] });
});
