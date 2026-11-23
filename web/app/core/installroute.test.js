// Settings > Installation's route rules (core/installroute.js) and how an install picks its route (signing-client.js
// chooseRoute): This iPhone only with a pairing and the built-in VPN; otherwise the Signing Server, said in an alert.
import test from "node:test";
import assert from "node:assert/strict";
import { decideRoute, routeParams, storedRoute, pairState, pairEvent, pairFooter, pairFromNative, pinText, verifyFailure, ROUTE_OPTIONS, ALERTS, STORAGE_KEY, IPHONE_INTRO, setupState, PAIR_GUIDE,
  NO_VPN, STATUS_ACTIONS, HOW_STEPS, routeRefused, installStatus, BUILTIN_VPN, earlyEOF } from "./installroute.js";
import { existsSync, readFileSync } from "node:fs";
import { ringStyle } from "./installroute.js";
import { SETTINGS } from "./settings.js";

const mem = (v) => ({ getItem: (k) => (k === STORAGE_KEY ? v : null) });
const vpn = (o = {}) => ({ available: true, tested: true, ...o });
const ST = { paired: "rp", vpn: vpn() };

test("the server unless This iPhone is chosen", () => {
  assert.deepEqual(decideRoute("server", ST), { route: "server" });
  assert.equal(storedRoute(mem(null)), "server");
  assert.equal(storedRoute(mem("iphone")), "iphone");
  assert.equal(storedRoute({ getItem() { throw new Error("private"); } }), "server");
});

test("This iPhone: paired with the built-in VPN, else the server with an alert", () => {
  assert.deepEqual(decideRoute("iphone", ST), { route: "idevice" });
  assert.deepEqual(decideRoute("iphone", { paired: null, vpn: vpn() }), { route: "server", alert: "notPaired" });
  assert.deepEqual(decideRoute("iphone", null), { route: "server", alert: "noStatus" });
  assert.deepEqual(routeParams({ route: "idevice" }), { route: "idevice" });
  assert.deepEqual(routeParams({ route: "server", alert: "noVPN" }), {});
});

test("a profile without Network Extensions: the Signing Server with a plain alert", () => {
  for (const st of [{ paired: "rp" }, { paired: "rp", vpn: { available: false } }]) {
    assert.deepEqual(decideRoute("iphone", st), { route: "server", alert: "noVPN" });
  }
  assert.equal(ALERTS.noVPN.title, "No Network Extensions");
  assert.match(ALERTS.noVPN.message, /Signing Server/);
  assert.match(ALERTS.noVPN.message, /Network Extensions/);
  assert.equal(ALERTS.noVPN.open, undefined);
  assert.equal(setupState({ paired: null, pairOnPhone: true }), "noVPN");
  assert.equal(setupState({ paired: null, pairOnPhone: true, vpn: { available: false } }), "noVPN");
  const s = installStatus("iphone", { paired: "rp" });
  assert.equal(s.state, "noVPN");
  assert.equal(s.title, NO_VPN.title);
  assert.equal(s.local, false);
  assert.equal(installStatus("iphone", { paired: null }).state, "noVPN"); // no VPN first: pairing needs it
  const f = verifyFailure(Object.assign(new Error("connect_failed: x"), { code: "connect_failed" }), { paired: "rp" });
  assert.equal(f, NO_VPN);
  assert.equal(f.again, false);
});

test("the This iPhone option: its two ways, one line each", () => {
  assert.deepEqual(ROUTE_OPTIONS.map((x) => x.label), ["This iPhone", "Signing Server"]); // F300: This iPhone first
  const d = SETTINGS.find((x) => x.key === "installRoute");
  assert.equal(d.default, "server");
  assert.deepEqual(d.modes, ["sideload"]);
  assert.match(IPHONE_INTRO, /^Installs straight onto this iPhone: no server, no install popup, and .+ can update itself\.$/);
});

test("F372: each way's subtitle is one line, as the concept says it", () => {
  assert.deepEqual(ROUTE_OPTIONS.map((o) => o.subtitle), ["Works offline", "Default - Uses ifizbox.com"]);
  // beside the checkmark and the disclosure a row keeps about 200pt for its subtitle at 375pt; 13px Helvetica averages about 6.5pt a character
  for (const o of ROUTE_OPTIONS) assert.ok(!o.subtitle.includes("\n") && o.subtitle.length <= 32, o.subtitle);
});

test("This iPhone's page: pairing by itself with the VPN; Paired and older iOS as before", () => {
  assert.equal(setupState(null), "file");
  assert.equal(setupState({ paired: null, pairOnPhone: true, vpn: vpn() }), "pairing");
  assert.equal(setupState(null, { pin: "1" }), "pairing"); // pairing under way draws without idevice.status
  assert.equal(setupState({ paired: "rp", vpn: vpn() }), "paired");
  assert.equal(setupState({ paired: null, pairOnPhone: false }), "file");
  assert.equal(setupState(undefined), "checking"); // nothing asked yet: the page draws with a spinner
});

test("the pairing guide: a short line a step, screenshots for the three Settings rows, all in the app", () => {
  assert.deepEqual(PAIR_GUIDE.map((s) => s.text), ["Open Settings", "Privacy & Security", "Developer Mode", "Pair with iFizBox", "Type the code above"]);
  const shots = PAIR_GUIDE.filter((s) => s.img).map((s) => s.img);
  assert.equal(shots.length, 3);
  for (const s of shots) {
    assert.match(s, /^img\/pair\/.+\.jpg$/);
    assert.ok(existsSync(new URL(`../${s}`, import.meta.url)), s);
  }
});

// A JPEG's [width, height], from its start-of-frame marker.
function jpegSize(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

test("the pairing guide: every screenshot has its real size and a row box inside it", () => {
  for (const s of PAIR_GUIDE.filter((g) => g.img)) {
    assert.deepEqual(jpegSize(readFileSync(new URL(`../${s.img}`, import.meta.url))), s.size, s.img);
    const { x, y, w, h } = s.box;
    assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 100 && y + h <= 100, `${s.img} box inside`);
    // A Settings row is wide and short: a box that is not is measuring something else.
    const px = { w: (w / 100) * s.size[0], h: (h / 100) * s.size[1] };
    assert.ok(px.h > 120 && px.h < 170 && px.w > 900, `${s.img} box is one row (${px.w}x${px.h} px)`);
    // Room for the ring outside the row (3 CSS px at a 300 px wide image is 12 image px).
    const room = Math.min(x * s.size[0], (100 - x - w) * s.size[0], y * s.size[1], (100 - y - h) * s.size[1]) / 100;
    assert.ok(room >= 12, `${s.img} leaves ${room} px around the row`);
  }
  assert.deepEqual(ringStyle({ x: 4, y: 50, w: 92, h: 25 }), {
    left: "calc(4% - 3px)", top: "calc(50% - 3px)", width: "calc(92% + 6px)", height: "calc(25% + 6px)" });
});

test("pairing: on the phone from iOS 27, a file before; Pair Again unless it just couldn't connect", () => {
  assert.equal(pairState({ paired: null, pairOnPhone: true }), "phone");
  assert.equal(pairState({ paired: null, pairOnPhone: false }), "file");
  assert.equal(pairState({ paired: "rp" }), "paired");
  assert.equal(verifyFailure(Object.assign(new Error("no route"), { code: "connect_failed" }), ST).again, false);
  assert.equal(verifyFailure(Object.assign(new Error("rejected"), { code: "bad_pairing" })).again, true);
  assert.equal(verifyFailure(new Error("not_paired: none")).again, true);
});

test("pairing page: the code first, then the native steps and a failed try; the code stays", () => {
  let p = { pin: "" };
  assert.equal(pairFooter(p), "Starting…");
  p = pairEvent(p, [{ pin: "042917" }]);
  assert.equal(p.pin, "042917");
  assert.equal(pinText(p.pin), "042 917");
  p = pairEvent(p, [{ step: "advertised", text: "Waiting for the iPhone to connect (port 5)." }]);
  assert.equal(pairFooter(p), "Waiting for the iPhone to connect (port 5).");
  p = pairEvent(p, [{ step: "failed", failedAt: "pairing", error: "bad proof (3)" }]);
  assert.match(pairFooter(p), /bad proof \(3\).*try again/);
  assert.equal(p.pin, "042917");
  p = pairEvent(p, [{ step: "connected", text: "The iPhone connected. Pairing…" }]);
  assert.equal(pairFooter(p), "The iPhone connected. Pairing…");
  assert.equal(p.pin, "042917");
  assert.equal(pairEvent(p, []), p);
});

test("pairing page: the state read back from native after the background", () => {
  assert.equal(pairFromNative(null), null);
  assert.equal(pairFromNative({ active: false }), null);
  assert.deepEqual(pairFromNative({ active: true, pin: "123456", step: "failed", text: "Listening on port 1.", error: "bad proof" }),
    { pin: "123456", text: "Listening on port 1.", error: "bad proof" });
  assert.equal(pinText("12345"), "12345");
  assert.equal(pinText(undefined), "");
});

// B258: an early eof after connecting means pair again, through the built-in VPN.
test("Check Connection: a connect failure names the VPN; early eof is Pair Again", () => {
  const cf = (m) => Object.assign(new Error(`connect_failed: ${m}`), { code: "connect_failed" });
  const eof = verifyFailure(cf('Socket(UnexpectedEof "early eof") (1)'), ST);
  assert.equal(eof.title, "Pair Again");
  assert.equal(eof.again, true);
  assert.ok(!eof.unusable, "an early eof offers Pair Again but doesn't forget the pairing by itself");
  assert.ok(eof.message.includes(BUILTIN_VPN));
  assert.ok(earlyEOF("Socket(UnexpectedEof)"));
  assert.equal(verifyFailure(cf("Socket(Kind(UnexpectedEof))")).title, "Pair Again");
  const c = verifyFailure(cf("timeout"), ST);
  assert.equal(c.title, "Couldn't Connect");
  assert.ok(c.message.includes(BUILTIN_VPN));
  assert.equal(c.again, false);
  assert.equal(verifyFailure(cf("no route")).title, "Couldn't Connect"); // no status: the same words
});

test("no text the core says names Tailscale or LocalDevVPN", () => {
  const words = [];
  const walk = (v) => { if (typeof v === "string") words.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(ALERTS); walk(STATUS_ACTIONS); walk(HOW_STEPS); walk(NO_VPN);
  const sts = [null, {}, { paired: null }, { paired: "rp" }, { paired: "rp", vpn: { available: false } },
    ...[false, true].flatMap((cellular) => [false, true].flatMap((tested) => [false, true].flatMap((sw) =>
      [{ paired: "rp", otherVPN: true, vpn: { available: true, tested, cellular, shortcuts: { switch: sw } } },
        { paired: null, vpn: { available: true, tested, cellular } }])))];
  for (const st of [...sts, undefined]) {
    for (const choice of ["iphone", "server"]) { const s = installStatus(choice, st, { failure: { title: "t", short: "s", fix: "check", button: "b" } }); walk(s); }
    walk(routeRefused(st));
    for (const code of ["refused", "pairing_rejected", "pair_again", "connect_failed", "bad_pairing", "route_refused", "vpn_failed", "switch_failed", "not_paired", "other"]) {
      for (const msg of ["x", "Socket(UnexpectedEof early eof)", "connection refused"]) walk(verifyFailure(Object.assign(new Error(`${code}: ${msg}`), { code }), st));
    }
  }
  assert.ok(words.length > 50);
  for (const w of words) assert.doesNotMatch(w, /tailscale|localdevvpn/i, w);
});
