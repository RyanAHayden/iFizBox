// Settings > Installation's page (screens/installroute.js): the choice with short subtitles, This iPhone's Set Up
// once it is chosen, and This iPhone's one page in each state.
import test from "node:test";
import assert from "node:assert/strict";
import { installationGroups, SUB_TITLES, setupGroups } from "./installroute.js";
import { IPHONE_INTRO, NO_VPN } from "../core/installroute.js";

const VPN_ST = { paired: "rp", vpn: { available: true, tested: true } };

test("Install Apps With: This iPhone and Signing Server, the chosen one checked, a point per subtitle line", () => {
  const [g, more] = installationGroups("server", null);
  assert.equal(g.header, "Install Apps With");
  assert.deepEqual(g.rows.map((r) => [r.label, r.checked]), [["This iPhone", false], ["Signing Server", true]]);
  assert.deepEqual(g.rows.map((r) => r.subtitle), ["Works offline", "Default - Uses ifizbox.com"]); // F372
  assert.ok(g.rows.every((r) => r.cls === "route-row"));
  assert.equal(more, undefined);
});

test("This iPhone chosen: Set Up and How It Works, and a tap picks", () => {
  const picked = [];
  const gs = installationGroups("iphone", VPN_ST, { pick: (v) => picked.push(v) });
  assert.deepEqual(gs.map((g) => g.header), ["Install Apps With", "Set Up", undefined]);
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.detail]), [["Pair This iPhone", "Done"], ["Test Connection", "Connected"], ["Install Switch", "Add"]]);
  assert.match(gs[1].rows[0].href, /installation\/pair$/);
  assert.equal(gs[2].rows[0].label, "How It Works");
  gs[0].rows[1].onClick();
  assert.deepEqual(picked, ["server"]);
  assert.equal(SUB_TITLES.pair, "Pairing");
  assert.equal(SUB_TITLES.iphone, "This iPhone");
});

test("a profile without Network Extensions says so instead of the VPN's rows", () => {
  const gs = installationGroups("iphone", { paired: "rp", vpn: { available: false } });
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.detail]), [["Network Extensions", "Missing"]]);
  assert.equal(gs[1].footer, NO_VPN.message);
  assert.equal(gs[1].warn, true);
});

test("This iPhone's page: one sentence under the title, no list of benefits", () => {
  for (const s of ["noVPN", "pairing", "paired", "file"]) {
    const [intro] = setupGroups(s, null, null);
    assert.equal(intro.header, "Install on This iPhone");
    assert.equal(intro.footer, IPHONE_INTRO);
    assert.equal(intro.rows, undefined);
  }
});

test("pairing without Network Extensions: nothing to pair, the profile is said", () => {
  const gs = setupGroups("noVPN", { paired: null, pairOnPhone: true }, null);
  assert.equal(gs.length, 2);
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.detail]), [["Network Extensions", "Missing"]]);
  assert.equal(gs[1].footer, NO_VPN.message);
  assert.ok(!gs.some((g) => g.pin || g.guide));
});

test("pairing: the code group, then the guide with the step or error line; Try Again only after it stopped", () => {
  const on = setupGroups("pairing", null, { pin: "123456", text: "Waiting for the iPhone to connect (port 5).", error: "" });
  assert.deepEqual(on[1].rows.map((r) => [r.label, r.detail]), [["iFizBox VPN", "On"]]);
  assert.ok(on[2].pin);
  assert.ok(on[3].guide);
  assert.equal(on[3].spinner, "Waiting for the iPhone to connect (port 5)."); // B133: a wait, so it spins
  assert.equal(on[3].footer, undefined);
  assert.equal(on.length, 4);
  assert.match(setupGroups("pairing", null, { pin: "123456", text: "", error: "bad proof" })[3].footer, /bad proof.*try again/);
  let tries = 0;
  const off = setupGroups("pairing", null, null, { failed: true, retry: () => tries++ });
  assert.equal(off[3].footer, "Pairing stopped.");
  off[4].rows[0].onClick();
  assert.equal(tries, 1);
});

test("paired: Paired with a check, then Check Connection and Forget Pairing", () => {
  const gs = setupGroups("paired", { paired: "rp" }, null);
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.checked]), [["Paired", true]]);
  assert.equal(gs[2].rows[0].label, "Check Connection");
  assert.match(gs[2].footer, /iFizBox VPN/);
  assert.equal(gs[3].rows[0].label, "Forget Pairing");
});
