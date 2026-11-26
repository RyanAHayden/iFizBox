// F254: the website's Use a Free Apple ID (screens/free-apple-id.js): the pure parts. The alerts' wording is
// core/gsa.js signInAlert's (gsa.test.js); the setup is core/freeroute.js's (freeroute.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { signInFailure, checklist, handoffFiles, handoffZip, loadFreeIdentity, saveFreeIdentity, forgetFreeIdentity,
  relayAvailable, resetRelayAnswer, FREE_KEY, devModeSteps, devModeShot, freeInstalled, markFreeInstalled,
  INSTALLED_KEY } from "./free-apple-id.js";
import { unzipEntries } from "../core/certfiles.js";
import { NAME } from "../brand.js";

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test("sign-in failures: what each keeps, clears, links or waits for (user 2026-11-19)", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const pw = signInFailure({ code: -20101, message: "x" }, now);
  assert.equal(pw.alert.title, "Incorrect Password");
  assert.deepEqual([pw.keepEmail, pw.clearPassword, pw.stayOnCode, pw.link], [true, true, false, null]);
  assert.equal(signInFailure({ code: -22406 }, now).clearPassword, true);
  const code = signInFailure({ code: -21669 }, now);
  assert.equal(code.alert.title, "Incorrect Code");
  assert.deepEqual([code.clearPassword, code.stayOnCode], [false, true]);
  for (const c of [-20209, -20283, -20751]) {
    const l = signInFailure({ code: c, message: "locked" }, now);
    assert.equal(l.alert.title, "This Apple ID Is Locked");
    assert.equal(l.link, "https://iforgot.apple.com");
  }
  const w = signInFailure({ code: -36607, message: "nope" }, now);
  assert.equal(w.waitUntil, "2026-11-19T12:15:00.000Z");
  assert.match(w.alert.message, /15 minutes/);
  const other = signInFailure({ code: -5000, message: "Odd", step: "SRP init" }, now);
  assert.equal(other.alert.title, "Sign-In Failed");
  assert.match(other.alert.message, /SRP init.*-5000.*Odd/);
});

test("checklist: the four steps in order, waiting until they start", () => {
  const rows = checklist({ device: { state: "done", summary: "Added to the account" }, certificate: { state: "running" } });
  assert.deepEqual(rows.map((r) => r.id), ["device", "certificate", "appId", "profile"]);
  assert.deepEqual(rows.map((r) => r.state), ["done", "running", "waiting", "waiting"]);
  assert.equal(rows[0].summary, "Added to the account");
  assert.equal(rows[0].title, "Register This iPhone");
});

test("the identity: kept in this browser, read back, forgotten", () => {
  const store = memStore();
  const id = { teamId: "T1", teamName: "Me", serial: "AB", password: "pw", p12: Uint8Array.of(1, 2, 3),
    expires: new Date("2027-11-19T00:00:00Z"), profile: Uint8Array.of(9), appId: "com.example.x.T1" };
  saveFreeIdentity(id, store);
  const back = loadFreeIdentity(store);
  assert.deepEqual(back.p12, id.p12);
  assert.deepEqual(back.profile, id.profile);
  assert.equal(back.expires.toISOString(), id.expires.toISOString());
  assert.deepEqual([back.teamId, back.serial, back.password, back.appId], ["T1", "AB", "pw", "com.example.x.T1"]);
  store.setItem(FREE_KEY, "{broken");
  assert.equal(loadFreeIdentity(store), null);
  saveFreeIdentity(id, store);
  forgetFreeIdentity(store);
  assert.equal(loadFreeIdentity(store), null);
});

test("Save for the App: .p12, password.txt and the profile, as the app's Select All Files takes them", async () => {
  const id = { p12: Uint8Array.of(1), password: "s3cret", profile: Uint8Array.of(2) };
  assert.deepEqual(handoffFiles(id).map((f) => f.name), [`${NAME} Free Apple ID.p12`, "password.txt", `${NAME} Free Apple ID.mobileprovision`]);
  const files = await unzipEntries(handoffZip(id));
  assert.equal(new TextDecoder().decode(files.find((f) => f.name === "password.txt").bytes), "s3cret");
  assert.equal(handoffFiles({ ...id, profile: null }).length, 2);
});

test("relayAvailable: only a 200 {on:true} from /apple/status; asked once per page", async () => {
  let asked = 0;
  resetRelayAnswer();
  assert.equal(await relayAvailable({ origin: "https://x", fetcher: async (u) => { asked++; assert.equal(u, "https://x/apple/status"); return new Response('{"on":true}'); } }), true);
  assert.equal(await relayAvailable({ fetcher: async () => { asked++; return new Response("{}"); } }), true);
  assert.equal(asked, 1);
  resetRelayAnswer();
  assert.equal(await relayAvailable({ fetcher: async () => new Response("{}", { status: 404 }) }), false);
  resetRelayAnswer();
  assert.equal(await relayAvailable({ fetcher: async () => { throw new Error("offline"); } }), false);
  resetRelayAnswer();
});

// ---- F254i: Developer Mode and Trust ----
test("Developer Mode steps: in order, the Stolen Device Protection step optional, Trust names the certificate", () => {
  const steps = devModeSteps({ email: "me@example.org" });
  assert.deepEqual(steps.map((s) => s.id), ["turn-on", "restart", "confirm", "delay", "trust"]);
  assert.deepEqual(steps.filter((s) => s.optional).map((s) => s.id), ["delay"]);
  assert.match(steps[0].text, /Privacy & Security/);
  assert.match(steps[0].text, new RegExp(NAME));
  assert.match(steps[1].shot.alert.buttons.join(), /Restart/);
  assert.match(steps[2].shot.alert.buttons.join(), /Turn On/);
  assert.match(steps[3].text, /Stolen Device Protection/);
  assert.match(steps[4].text, /VPN & Device Management.*Apple Development: me@example\.org/);
  assert.equal(steps[4].shot.groups[0].rows[0].label, "Apple Development: me@example.org");
  for (const s of steps) assert.ok(s.title && s.text && s.shot.title && s.shot.groups.length, s.id);
  assert.doesNotMatch(devModeSteps().at(-1).text, /undefined/);
});

test("Developer Mode page stops showing once an app on the route installed fine", () => {
  const store = memStore();
  assert.equal(freeInstalled(store), false);
  markFreeInstalled(store);
  assert.equal(freeInstalled(store), true);
  assert.equal(store.getItem(INSTALLED_KEY), "true");
  markFreeInstalled(store, false);
  assert.equal(freeInstalled(store), false);
  store.setItem(INSTALLED_KEY, "{broken");
  assert.equal(freeInstalled(store), false);
});

test("devModeShot: nav bar, rows (switch, detail, chevron, mark) and the alert, all as text", () => {
  const fake = (tag) => {
    const e = { tag, className: "", textContent: "", children: [], attrs: {},
      append: (...c) => e.children.push(...c), setAttribute: (k, v) => { e.attrs[k] = v; } };
    return e;
  };
  const saved = globalThis.document;
  globalThis.document = { createElement: fake };
  try {
    const fig = devModeShot(devModeSteps()[1].shot);
    const all = [];
    const walk = (n) => { all.push(n); n.children.forEach(walk); };
    walk(fig);
    const by = (c) => all.filter((n) => n.className.split(" ").includes(c));
    assert.equal(fig.attrs.role, "img");
    assert.equal(fig.attrs["aria-label"], "Settings: Developer Mode");
    assert.equal(by("dm-title")[0].textContent, "Developer Mode");
    assert.equal(by("dm-back")[0].textContent, "Privacy & Security");
    assert.equal(by("dm-switch")[0].className, "dm-switch is-on");
    assert.deepEqual(by("dm-alert-button").map((b) => [b.textContent, b.className.includes("is-bold")]), [["Cancel", false], ["Restart", true]]);
    const first = devModeShot(devModeSteps()[0].shot);
    const rows = first.children[0].children.find((n) => n.className === "dm-group").children;
    assert.equal(rows[0].className, "dm-row is-marked");
    assert.deepEqual(rows[0].children.map((n) => n.className), ["dm-label", "dm-detail", "dm-chevron"]);
  } finally {
    globalThis.document = saved;
  }
});

test("B369: Sign In and Verify sit beside Cancel in one split row, the footer under the pair", async () => {
  const { signInButtons, codeButtons, splitButtons, FREE_PASSWORD_FOOTER, freeWaitFooter } = await import("./free-apple-id.js");
  const s = signInButtons();
  assert.deepEqual(s.rows.map((r) => [r.label, r.cls]), [["Cancel", "free-button"], ["Sign In", "free-primary"]]);
  assert.equal(s.footer, FREE_PASSWORD_FOOTER);
  assert.equal(signInButtons({ busy: true }).rows[1].label, "Signing In…");
  const wait = new Date("2026-11-23T12:15:00Z");
  assert.equal(signInButtons({ wait }).footer, freeWaitFooter(wait));
  assert.deepEqual(codeButtons().rows.map((r) => r.label), ["Cancel", "Verify"]);
  assert.equal(codeButtons().footer, null);

  const fake = (tag) => {
    const e = { tag, className: "", textContent: "", children: [], on: {},
      append: (...c) => e.children.push(...c), addEventListener: (k, f) => { e.on[k] = f; } };
    return e;
  };
  const saved = globalThis.document;
  globalThis.document = { createElement: fake };
  try {
    const tapped = [];
    const g = splitButtons(signInButtons({ onSignIn: () => tapped.push("in"), onCancel: () => tapped.push("cancel") }));
    assert.equal(g.className, "group");
    const [ul, foot] = g.children;
    assert.equal(ul.className, "table grouped free-split"); // one table: the two halves share a row
    assert.equal(ul.children.length, 2);
    assert.deepEqual(ul.children.map((li) => li.className), ["cell free-button", "cell free-primary"]);
    const buttons = ul.children.map((li) => li.children[0]);
    assert.deepEqual(buttons.map((b) => [b.tag, b.type, b.className]), [["button", "button", "cell-inner"], ["button", "button", "cell-inner"]]);
    assert.deepEqual(buttons.map((b) => b.children[0].children[0].textContent), ["Cancel", "Sign In"]);
    buttons[1].on.click();
    buttons[0].on.click();
    assert.deepEqual(tapped, ["in", "cancel"]);
    assert.equal(foot.className, "group-footer");
    assert.equal(foot.textContent, FREE_PASSWORD_FOOTER);
    assert.equal(splitButtons(codeButtons()).children.length, 1); // Verify's pair has no footer
  } finally {
    globalThis.document = saved;
  }
});

test("B369: freeid.css lays the split out as one row of two equal halves", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../freeid.css", import.meta.url), "utf8");
  assert.match(css, /\.table\.grouped\.free-split \{ display: flex; \}/);
  assert.match(css, /\.free-split > \.cell \{ flex: 1 1 0; min-width: 0; \}/);
  assert.match(css, /\.free-split > \.cell \+ \.cell \{ border-top: 0; border-left: 1px solid var\(--divider\)/);
});

test("B369: scrollTarget puts the Sign In group at the top, under the nav bar", async () => {
  const { scrollTarget, TOP_GAP } = await import("./free-apple-id.js");
  // the scroller fills the screen from 0 and runs under a 64px nav bar; the group is 500px down, 100px scrolled
  assert.equal(scrollTarget({ groupTop: 500, scrollerTop: 0, scrollTop: 100, navBottom: 64 }), 100 + 500 - 64 - TOP_GAP);
  // no nav bar over the scroller: only the gap
  assert.equal(scrollTarget({ groupTop: 300, scrollerTop: 50, scrollTop: 0, navBottom: 50, gap: 0 }), 250);
  // never past the end or above the top
  assert.equal(scrollTarget({ groupTop: 900, scrollerTop: 0, scrollTop: 0, navBottom: 64, max: 400 }), 400);
  assert.equal(scrollTarget({ groupTop: 20, scrollerTop: 0, scrollTop: 0, navBottom: 64 }), 0);
});

// F444: the sideload app's route: Apple through the shell's net.request, the WebSocket straight to the anisette server,
// Ready into the Keychain, Forget only the Keychain identity that is this Free Apple ID's.
test("F444: nativeTransport passes the request to net.request and reads the answer back", async () => {
  const { nativeTransport } = await import("./free-apple-id.js");
  const { b64encode, utf8 } = await import("../core/gsa.js");
  const calls = [];
  const native = { call: async (name, p) => { calls.push([name, p]); return { status: 409, headers: { "Content-Type": "text/x-xml-plist" }, body: b64encode(utf8("<plist/>")) }; } };
  const r = await nativeTransport(native)({ url: "https://gsa.apple.com/auth/verify/phone", method: "PUT",
    headers: { "User-Agent": "akd/1.0", Accept: "application/json" }, body: utf8('{"mode":"sms"}') });
  assert.deepEqual(calls, [["net.request", { url: "https://gsa.apple.com/auth/verify/phone", method: "PUT",
    headers: { "User-Agent": "akd/1.0", Accept: "application/json" }, body: '{"mode":"sms"}' }]]);
  assert.equal(r.status, 409);
  assert.equal(r.headers["content-type"], "text/x-xml-plist");
  assert.equal(new TextDecoder().decode(r.body), "<plist/>");
  // a GET has no body
  await nativeTransport(native)({ url: "https://gsa.apple.com/grandslam/GsService2/lookup" });
  assert.equal("body" in calls[1][1], false);
  assert.equal(calls[1][1].method, "GET");
  // a bridge error throws, as the relay's refusal does
  await assert.rejects(nativeTransport({ call: async () => { throw new Error("network: offline"); } })({ url: "https://gsa.apple.com/x" }), /offline/);
});

test("F444: the provisioning WebSocket goes straight to the anisette server in the app", async () => {
  const { directWsUrl } = await import("./free-apple-id.js");
  assert.equal(directWsUrl("https://ani.sidestore.io"), "wss://ani.sidestore.io/v3/provisioning_session");
  assert.equal(directWsUrl("https://ani.sidestore.app/"), "wss://ani.sidestore.app/v3/provisioning_session");
});

test("F444: Ready's signing.import gets the .p12, profile and password as Select All Files does", async () => {
  const { importParams } = await import("./free-apple-id.js");
  const { b64decode } = await import("../core/gsa.js");
  const p = importParams({ p12: new Uint8Array([1, 2, 3]), profile: new Uint8Array([4, 5]), password: "pw" });
  assert.deepEqual([...b64decode(p.p12)], [1, 2, 3]);
  assert.deepEqual([...b64decode(p.profile)], [4, 5]);
  assert.equal(p.password, "pw");
});

test("F444: Forget removes the Keychain identity only when its serial is the Free Apple ID's", async () => {
  const { sameSerial } = await import("./free-apple-id.js");
  assert.ok(sameSerial("0A1B2C", "a1b2c"));
  assert.ok(sameSerial("0a:1b:2c", "0A1B2C"));
  assert.ok(!sameSerial("0A1B2C", "0A1B2D"));
  assert.ok(!sameSerial("", ""));
  assert.ok(!sameSerial(null, undefined));
});

test("F444: the app's footers name neither the website nor the browser", async () => {
  const { APP_FOOTERS, signInButtons, FREE_PASSWORD_FOOTER } = await import("./free-apple-id.js");
  for (const [k, v] of Object.entries(APP_FOOTERS)) assert.doesNotMatch(v, /website|browser|server/i, k);
  assert.equal(signInButtons({ app: true }).footer, APP_FOOTERS.password);
  assert.equal(signInButtons().footer, FREE_PASSWORD_FOOTER);
});

test("F444: settings.js reads the Free Apple ID under free-apple-id.js's key", async () => {
  const { FREE_ID_KEY } = await import("./settings.js");
  assert.equal(FREE_ID_KEY, FREE_KEY);
});

test("B473: the sign-in is kept across the Find UDID detour for 30 minutes at most, never past the token", async () => {
  const { keepFreeSession, keptFreeSession, dropFreeSession, FREE_SESSION_KEY } = await import("./free-apple-id.js");
  const store = memStore();
  const now = Date.parse("2026-11-26T12:00:00Z");
  keepFreeSession({ token: "tok", adsid: "000-1", team: { teamId: "T1", name: "Me", extra: "x" }, email: "a@b.c" }, store, now);
  const s = keptFreeSession(store, now + 29 * 60000);
  assert.deepEqual([s.token, s.adsid, s.team, s.email], ["tok", "000-1", { teamId: "T1", name: "Me" }, "a@b.c"]);
  assert.doesNotMatch(store.getItem(FREE_SESSION_KEY), /password/i);
  assert.equal(keptFreeSession(store, now + 31 * 60000), null);
  assert.equal(store.getItem(FREE_SESSION_KEY), null, "an expired one is removed");
  keepFreeSession({ token: "tok", adsid: "000-1", team: { teamId: "T1" }, expiry: now + 5 * 60000 }, store, now);
  assert.ok(keptFreeSession(store, now + 4 * 60000));
  assert.equal(keptFreeSession(store, now + 6 * 60000), null, "the token's own expiry, when sooner");
  keepFreeSession({ token: "tok", adsid: "000-1", team: { teamId: "T1" } }, store, now);
  dropFreeSession(store);
  assert.equal(keptFreeSession(store, now), null);
  keepFreeSession({ token: null, adsid: "000-1", team: { teamId: "T1" } }, store, now);
  assert.equal(keptFreeSession(store, now), null, "nothing kept without a token");
  store.setItem(FREE_SESSION_KEY, "{broken");
  assert.equal(keptFreeSession(store, now), null);
});

test("B473: Register This iPhone failed with no UDID: the row offers Find This iPhone's UDID", async () => {
  const { udidDetour, FREE_UDID_FOOTER, FREE_UDID_ELSEWHERE } = await import("./free-apple-id.js");
  const { FIND_UDID, UDID_WAITING } = await import("./signing.js");
  const failed = { device: { state: "failed", summary: "This iPhone's UDID isn't known yet." } };
  const g = udidDetour(failed, { href: "#home/settings/signing/udid" });
  assert.deepEqual(g.rows, [{ label: FIND_UDID, href: "#home/settings/signing/udid" }]);
  assert.equal(g.footer, FREE_UDID_FOOTER);
  const w = udidDetour(failed, { pending: true, href: "#x" });
  assert.equal(w.rows[0].detail, "Waiting");
  assert.equal(w.footer, UDID_WAITING);
  assert.deepEqual(udidDetour(failed, { can: false }), { rows: [], footer: FREE_UDID_ELSEWHERE });
  assert.equal(udidDetour(failed, { native: true }), null, "the app reads the UDID itself");
  assert.equal(udidDetour(failed, { udid: "00008030-001A" }), null, "failed for another reason");
  assert.equal(udidDetour({ device: { state: "done" }, certificate: { state: "failed" } }), null);
  assert.equal(udidDetour({}), null);
});

test("B473: after a reload the kept sign-in comes back; with the UDID here Register This iPhone goes on", async () => {
  const { fakeDocument, memStorage } = await import("../fakes.test-helper.js");
  const { freeRouteBlock, keepFreeSession, keptFreeSession, resetRelayAnswer } = await import("./free-apple-id.js");
  const { FIND_UDID, UDID_KEY } = await import("./signing.js");
  const saved = { document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  const doc = fakeDocument();
  const ls = memStorage();
  const asked = [];
  const relayed = [];
  globalThis.document = doc;
  globalThis.localStorage = ls;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/apple/status")) return { ok: true, json: async () => ({ on: true }) };
    relayed.push({ url: String(url), headers: init?.headers ?? {} });
    return new Promise(() => {}); // Apple's answer never comes: enough to see what was asked
  };
  const wait = () => new Promise((r) => setTimeout(r, 5));
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)" }, configurable: true });
  try {
    resetRelayAnswer();
    keepFreeSession({ token: "tok", adsid: "000-1", team: { teamId: "T1", name: "Me" }, email: "a@b.c" }, ls);
    const box = freeRouteBlock({ alert: async (o) => { asked.push(o); return { index: 0 }; } });
    doc.body.append(box);
    await wait();
    // no UDID yet: back on the checklist, Register This iPhone red, the row offers Find This iPhone's UDID, no alert
    assert.equal(box.hidden, false);
    assert.match(box.textContent, /Setting Up Me/);
    assert.ok(box.querySelector("li.free-step.is-failed"), "Register This iPhone failed");
    const link = box.querySelectorAll("a").find((a) => a.textContent.includes(FIND_UDID));
    assert.ok(link, `the Find This iPhone's UDID row: ${box.textContent}`);
    assert.match(link.href, /signing\/udid$/);
    assert.deepEqual(asked, [], "the row explains it: no iPhone Not Known alert");
    assert.ok(keptFreeSession(ls), "still kept while on the detour");
    assert.equal(relayed.length, 0, "nothing asked of Apple without a UDID");
    // the UDID arrives (Find This iPhone's UDID saved it): the next draw goes on with the kept sign-in, no new sign-in
    ls.setItem(UDID_KEY, JSON.stringify({ udid: "00008030001A2B3C4D5E6F70", product: "iPhone16,1" }));
    const again = freeRouteBlock({ alert: async (o) => { asked.push(o); return { index: 0 }; } }); // back on Signing
    await wait();
    assert.ok(relayed.length > 0, "setup asked Apple again");
    assert.ok(again.querySelectorAll("li.free-step")[0].classList.contains("is-running"), "Register This iPhone is running");
    assert.doesNotMatch(again.textContent, /Sign In With a Free Apple ID/, "no new sign-in");
    assert.deepEqual(asked, []);
    // a real reload after the UDID was found: a fresh module (no sign-in in memory) picks the kept one up
    relayed.length = 0;
    const fresh = await import("./free-apple-id.js?reload");
    const reloaded = fresh.freeRouteBlock({ alert: async (o) => { asked.push(o); return { index: 0 }; } });
    await wait();
    assert.match(reloaded.textContent, /Setting Up Me/);
    assert.ok(reloaded.querySelectorAll("li.free-step")[0].classList.contains("is-running"), "Register This iPhone goes on");
    assert.ok(relayed.length > 0, "asked Apple with the kept sign-in");
    assert.deepEqual(asked, []);
    fresh.dropFreeSession(ls);
  } finally {
    Object.assign(globalThis, saved);
    Object.defineProperty(globalThis, "navigator", nav);
    resetRelayAnswer();
  }
});
