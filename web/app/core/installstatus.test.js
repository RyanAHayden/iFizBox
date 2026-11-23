// F284: Installation & Signing's top cell (core/installroute.js installStatus) and the main page's row details.
import test from "node:test";
import assert from "node:assert/strict";
import { installStatus, STATUS_ACTIONS, CHECKING, serverDetail, certificateDetail, ALERTS, decideRoute } from "./installroute.js";

const paired = (o = {}) => ({ paired: "rp", otherVPN: false, ...o, vpn: { available: true, tested: true, cellular: false, ...(o.vpn || {}) } });

test("still checking: Checking… with Check Connection (dimmed by the page)", () => {
  assert.equal(installStatus("iphone", undefined), CHECKING);
  assert.equal(CHECKING.title, "Checking…");
  assert.equal(STATUS_ACTIONS[CHECKING.action], "Check Connection");
});

test("ready through the built-in VPN, Check Connection, installs here", () => {
  const l = installStatus("iphone", paired());
  assert.deepEqual([l.title, l.subtitle, STATUS_ACTIONS[l.action], l.local], ["Ready to Install", "Straight onto this iPhone, through iFizBox VPN.", "Check Connection", true]);
  assert.equal(serverDetail(l, "ifizbox.com"), "This iPhone");
  // another VPN being on is no state of its own: the shell turns the built-in VPN on for the install
  assert.equal(installStatus("iphone", paired({ otherVPN: true })).state, "ready");
});

test("on cellular without the Install Switch: the warning, with Add Install Switch", () => {
  const c = installStatus("iphone", paired({ vpn: { cellular: true } }));
  assert.deepEqual([c.state, STATUS_ACTIONS[c.action], c.local], ["cellular", "Add Install Switch", true]);
  assert.equal(installStatus("iphone", paired({ vpn: { cellular: true, shortcuts: { switch: true } } })).state, "ready");
});

test("a profile without Network Extensions: said plainly, the server meanwhile", () => {
  for (const st of [{ paired: "rp" }, { paired: "rp", vpn: { available: false } }, { paired: null }]) {
    const n = installStatus("iphone", st);
    assert.deepEqual([n.state, n.title, STATUS_ACTIONS[n.action], n.local], ["noVPN", "No Network Extensions", "Check Connection", false]);
    assert.equal(serverDetail(n, "ifizbox.com"), "ifizbox.com");
  }
  assert.equal(decideRoute("iphone", { paired: "rp" }).alert, "noVPN");
  assert.ok(ALERTS.noVPN.title);
});

test("not paired: Pair This iPhone with Start Pairing", () => {
  const p = installStatus("iphone", paired({ paired: null }));
  assert.deepEqual([p.title, STATUS_ACTIONS[p.action]], ["Pair This iPhone", "Start Pairing"]);
  assert.equal(installStatus("iphone", null).state, "noStatus");
});

test("Signing Server chosen: ready through the server, Check Server", () => {
  const s = installStatus("server", undefined, { host: "sign.example.com" });
  assert.deepEqual([s.title, s.subtitle, STATUS_ACTIONS[s.action], s.local], ["Ready to Install", "Through the Signing Server, sign.example.com.", "Check Server", false]);
});

test("every subtitle stays short enough for the cell's two lines at 320pt", () => {
  const all = [CHECKING, installStatus("iphone", null), installStatus("iphone", { paired: null }), installStatus("iphone", { paired: "rp" }),
    installStatus("iphone", paired({ paired: null })), installStatus("iphone", paired({ vpn: { cellular: true } })), installStatus("iphone", paired()),
    installStatus("server", undefined)];
  for (const s of all) assert.ok(s.subtitle.length <= 70, s.subtitle);
});

test("the Certificate row: days left, Expired in red, None or Incomplete", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  assert.deepEqual(certificateDetail({ expires: "2027-09-05T12:00:00Z" }, { now }), { text: "289 days left", red: false });
  assert.deepEqual(certificateDetail({ expires: "2026-11-21T13:00:00Z" }, { now }), { text: "1 day left", red: true });
  assert.deepEqual(certificateDetail({ expires: "2026-11-01T00:00:00Z" }, { now }), { text: "Expired", red: true });
  assert.deepEqual(certificateDetail(null), { text: "None" });
  assert.deepEqual(certificateDetail(null, { staged: true }), { text: "Incomplete" });
});
