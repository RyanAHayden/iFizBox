// Settings > Installation's page (screens/installroute.js): the choice with short subtitles, This iPhone's state rows
// once it is chosen, and This iPhone's one page in each state.
import test from "node:test";
import assert from "node:assert/strict";
import { installationGroups, vpnDetail, SUB_TITLES, setupGroups } from "./installroute.js";
import { IPHONE_INTRO } from "../core/installroute.js";

test("Install Apps With: This iPhone and Signing Server, the chosen one checked, a point per subtitle line", () => {
  const [g, more] = installationGroups("server", null);
  assert.equal(g.header, "Install Apps With");
  assert.deepEqual(g.rows.map((r) => [r.label, r.checked]), [["This iPhone", false], ["Signing Server", true]]);
  assert.deepEqual(g.rows.map((r) => r.subtitle), ["Works offline - no install popup", "Default - Uses ifizbox.com"]); // F372
  assert.ok(g.rows.every((r) => r.cls === "route-row"));
  assert.equal(more, undefined);
});

test("This iPhone chosen: Pairing and the VPN's state, and a tap picks", () => {
  const picked = [];
  const gs = installationGroups("iphone", { paired: "rp", localDevVPN: false, otherVPN: true }, { pick: (v) => picked.push(v) });
  assert.equal(gs.length, 4);
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.detail]), [["Pairing", "Paired"], ["LocalDevVPN", "Another VPN"], ["Open LocalDevVPN", undefined]]);
  assert.match(gs[1].rows[0].href, /installation\/pair$/);
  gs[0].rows[1].onClick();
  assert.deepEqual(picked, ["server"]);
  assert.equal(vpnDetail({ localDevVPN: true }), "On");
  assert.equal(vpnDetail(null), "Unknown");
  assert.equal(SUB_TITLES.pair, "Pairing"); // F284: This iPhone is the status page above it
  assert.equal(SUB_TITLES.iphone, "This iPhone");
});

test("This iPhone's page: one sentence under the title, no list of benefits", () => {
  for (const s of ["connect", "pairing", "paired", "file"]) {
    const [intro] = setupGroups(s, null, null);
    assert.equal(intro.header, "Install on This iPhone");
    assert.equal(intro.footer, IPHONE_INTRO);
    assert.equal(intro.rows, undefined);
  }
});

test("VPN off: its state and Open LocalDevVPN, nothing to pair yet", () => {
  let opened = 0;
  const gs = setupGroups("connect", { paired: null, pairOnPhone: true, localDevVPN: false, otherVPN: false }, null, { openVPN: () => opened++ });
  assert.equal(gs.length, 3);
  assert.deepEqual(gs[2], { spinner: "Waiting for LocalDevVPN…" }); // B133: the poll for the VPN spins
  assert.deepEqual(gs[1].rows.map((r) => [r.label, r.detail]), [["LocalDevVPN", "Off"], ["Open LocalDevVPN", undefined]]);
  gs[1].rows[1].onClick();
  assert.equal(opened, 1);
  assert.match(gs[1].footer, /by itself/);
  assert.ok(!gs.some((g) => g.pin || g.guide));
});

test("pairing: the code group, then the guide with the step or error line; Try Again only after it stopped", () => {
  const on = setupGroups("pairing", null, { pin: "123456", text: "Waiting for the iPhone to connect (port 5).", error: "" });
  assert.deepEqual(on[1].rows.map((r) => [r.label, r.detail]), [["LocalDevVPN", "On"]]);
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
  assert.equal(gs[3].rows[0].label, "Forget Pairing");
});

test("This iPhone: Connect With and Tailscale (Sign In, or the device with Test Connection and Sign Out)", () => {
  const chosen = [];
  let gs = installationGroups("iphone", { paired: "rp", tailscale: { connect: "tailscale", signedIn: false } }, { connect: (v) => chosen.push(v) });
  assert.equal(gs[2].header, "Connect With");
  assert.deepEqual(gs[2].rows.map((r) => [r.label, r.checked]), [["Automatic", false], ["LocalDevVPN", false], ["Tailscale", true]]);
  gs[2].rows[0].onClick();
  assert.deepEqual(chosen, ["auto"]);
  assert.equal(gs[3].header, "Tailscale");
  assert.deepEqual(gs[3].rows.map((r) => r.label), ["Sign In"]);
  gs = installationGroups("iphone", { paired: "rp", tailscale: { connect: "auto", signedIn: true, name: "ifizbox-on-iphone" } });
  assert.deepEqual(gs[3].rows.map((r) => [r.label, r.detail]), [["Device", "ifizbox-on-iphone"], ["Test Connection", undefined], ["Sign Out", undefined]]);
  assert.equal(gs[2].rows[0].checked, true);
  gs = installationGroups("iphone", null, { busy: "Log in on the page" });
  assert.deepEqual(gs[3].rows.map((r) => [r.label, r.detail]), [["Signing In…", "Log in on the page"]]);
});

test("Tailscale while its state is unknown: Checking… with the spinner, never Sign In; Connect With keeps the pick", () => {
  let gs = installationGroups("iphone", null, { reading: true });
  assert.deepEqual(gs[3].rows.map((r) => [r.label, r.detail, r.spin]), [["Tailscale", "Checking…", true]]);
  assert.equal(gs[2].rows.find((r) => r.checked).label, "Automatic");
  gs = installationGroups("iphone", null, { reading: true, connectPick: "tailscale" });
  assert.equal(gs[2].rows.find((r) => r.checked).label, "Tailscale");
  gs = installationGroups("iphone", null, { reading: true, busy: "Log in on the page" });
  assert.equal(gs[3].rows[0].label, "Signing In…", "a running sign-in still shows");
  gs = installationGroups("iphone", { paired: "rp", tailscale: { connect: "auto", signedIn: false } }, { connectPick: "tailscale" });
  assert.deepEqual(gs[3].rows.map((r) => r.label), ["Sign In"], "the answer's signed out is Sign In");
  assert.equal(gs[2].rows.find((r) => r.checked).label, "Automatic", "the answer wins over the pick");
});
