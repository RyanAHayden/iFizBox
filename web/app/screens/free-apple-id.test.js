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
