// F389: another VPN that is selected in Settings > VPN but idle (On Demand, no tunnel address) counts as another VPN.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument } from "../fakes.test-helper.js";

globalThis.document ??= fakeDocument();
const { shortcutGroups } = await import("./installroute.js");
const { switchOld, switchWanted, switchWouldRun, decideRoute, ALERTS } = await import("../core/installroute.js");
const ST = (vpn = {}) => ({ paired: "rp", tunnels: [], otherVPN: false, vpn: { available: true, tested: true, cellular: false, otherVPN: false, otherVPNSelected: true, trips: true, shortcuts: {}, ...vpn } });

test("selected, not up, not added: the install says it may stay off and goes on", () => {
  assert.equal(switchWanted(ST()), true);
  assert.deepEqual(decideRoute("iphone", ST()), { route: "idevice", alert: "vpnIdle" });
  assert.equal(ALERTS.vpnIdle.goes, true);
  assert.match(ALERTS.vpnIdle.message, /^If your VPN connects on demand/);
  assert.equal(decideRoute("iphone", ST({ otherVPN: true })).alert, "vpnStaysOff", "up: it is on for sure");
  assert.equal(decideRoute("iphone", ST({ otherVPNSelected: false })).alert, undefined);
});

test("selected, not up, added: a connect runs the Install Switch, so the automatic check stays away", () => {
  const st = ST({ shortcuts: { switch: true, trip: true, idle: true } });
  assert.deepEqual(decideRoute("iphone", st), { route: "idevice" });
  assert.equal(switchWouldRun(st), true);
  assert.equal(switchWouldRun(ST({ otherVPNSelected: false, shortcuts: { switch: true } })), false);
});

test("an Install Switch that can't bring an idle VPN back offers Update", () => {
  const vpn = { trips: true, shortcuts: { switch: true, trip: true } };
  assert.equal(switchOld(vpn), true);
  assert.match(shortcutGroups(vpn)[0].footer, /^To get an idle VPN back, delete Install Switch in Shortcuts, then tap Update\.$/);
  assert.equal(switchOld({ ...vpn, shortcuts: { ...vpn.shortcuts, idle: true } }), false);
});

test("the app: selected starts the run, is kept for a kill, and the end looks at the place in Settings too", () => {
  const swift = readFileSync(new URL("../../../native/sideload/vpn/App/LocalVPN.swift", import.meta.url), "utf8");
  const begin = swift.slice(swift.indexOf("static func begin("), swift.indexOf("static func waitOffCellular("));
  assert.match(begin, /let other = !before\.isEmpty \|\| selected\n/);
  assert.ok(begin.indexOf("otherVPNSelected()") < begin.indexOf("try up(step)"), "before ours takes its place");
  assert.match(swift, /return enabled == false\n/, "no configuration of ours tells nothing");
  assert.match(swift, /before\.isSubset\(of: otherVPNAddresses\(\)\) && \(!selected \|\| otherVPNSelected\(\)\)/);
  assert.match(swift, /switchSelectedBefore = p\["selected"\] as\? Bool \?\? false/);
  assert.equal(swift.match(/vpnBefore: !before\.isEmpty \|\| selected/g).length, 1);
});
