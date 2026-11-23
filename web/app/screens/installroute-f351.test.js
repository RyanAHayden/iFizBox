// F351: Installation & Signing's main page: every row has its row icon, and the Install Apps With group shows the
// chosen route as its row (its icon, its name, one line under it), with Paired / Not Paired as This iPhone's detail.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

globalThis.document = fakeDocument();

const { mainPage, forgetStatus, hudHooks, withDetail, installationGroups } = await import("./installroute.js");
const { rowIcon, ROW_ICONS, tileSvg } = await import("../icons/rowicons.js");
const { DOMAIN } = await import("../brand.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;

const store = (route) => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; };
const PAIRED_ON = { paired: "rp", pairOnPhone: true, localDevVPN: true, otherVPN: false, tailscale: { connect: "auto", signedIn: false } };
const bridge = (answers) => ({ call: (m) => Promise.resolve(answers[m]) });
const LINKS = { with: "#w", certificate: "#c", apps: "#a", help: "#h" };
const cellsOf = (page) => [...page.el.querySelectorAll(".cell-inner")];
const text = (cell, c) => cell.querySelector(c)?.textContent ?? null;
const iconSrc = (cell) => cell.querySelector(".cell-icon img")?.src ?? null;

test("withDetail: nothing for the Signing Server or an unanswered pairing, Paired / Not Paired for This iPhone", () => {
  assert.equal(withDetail("server", PAIRED_ON), "");
  assert.equal(withDetail("iphone", undefined), "");
  assert.equal(withDetail("iphone", null), "");
  assert.equal(withDetail("iphone", PAIRED_ON), "Paired");
  assert.equal(withDetail("iphone", { paired: null }), "Not Paired");
});

test("the new Signing Server tile is a purple cloud, drawn in every icon set", () => {
  assert.deepEqual(ROW_ICONS.signingServer.slice(1), ["cloud"]);
  for (const style of ["ios6", "ios7", "ios13", "ios26"]) assert.match(tileSvg("signingServer", style), /<svg/);
});

// F372: Install Apps With lists both ways, each row opening its page, with USE beside it and ACTIVE on the one in use
const rowOf = (cell) => cell.parentElement;
const classesOf = (n) => n?.className ?? "";
test("main page: every row below the status has its row icon; both ways listed, the one in use ACTIVE", async () => {
  forgetStatus();
  const page = mainPage({ store: store("server"), native: bridge({}), links: LINKS, signing: async () => null });
  await page.refresh();
  const [, , iphone, server, cert, apps, help] = cellsOf(page);
  assert.equal(text(iphone, ".cell-label"), "This iPhone");
  assert.equal(text(iphone, ".cell-subtitle"), "Works offline - no install popup");
  assert.equal(text(server, ".cell-label"), "Signing Server");
  assert.equal(text(server, ".cell-subtitle"), `Default - Uses ${DOMAIN}`);
  assert.equal(iconSrc(iphone), rowIcon("installation").src);
  assert.equal(iconSrc(server), rowIcon("signingServer").src);
  assert.equal(iconSrc(cert), rowIcon("signing").src);
  assert.equal(iconSrc(apps), rowIcon("websiteApps").src);
  assert.equal(iconSrc(help), rowIcon("help").src);
  assert.ok(page.el.textContent.includes("Tap USE to install that way."));
  assert.ok(rowOf(server).classList.contains("route-on"), "the Signing Server is ACTIVE");
  assert.ok(!rowOf(iphone).classList.contains("route-on"));
  for (const c of [iphone, server]) {
    const use = rowOf(c).querySelector(".route-use-btn");
    assert.equal(use?.textContent, "USE");
    assert.equal(rowOf(c).querySelector(".route-active")?.textContent, "ACTIVE");
    assert.ok(!c.contains?.(use), "USE sits beside the row's link, not inside it");
  }
  assert.ok(!classesOf(cellsOf(page)[2]).includes("route-on"));
});

test("main page: USE on the Signing Server makes it ACTIVE; USE on This iPhone not set up opens its setup", async () => {
  forgetStatus();
  const s = store("iphone");
  const page = mainPage({ store: s, native: bridge({ "idevice.status": { ...PAIRED_ON, vpn: { available: true, tested: false } } }), links: LINKS, signing: async () => null });
  await page.refresh();
  const [, , iphone, server] = cellsOf(page);
  assert.ok(rowOf(iphone).classList.contains("route-on"));
  const click = (cell) => rowOf(cell).querySelector(".route-use-btn").listeners.click[0]({ preventDefault() {}, stopPropagation() {} });
  click(server);
  assert.ok(rowOf(server).classList.contains("route-on"), "ACTIVE at once (the reveal)");
  assert.ok(!rowOf(iphone).classList.contains("route-on"));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(s.get("installRoute"), "server", "used once the reveal ends");
  const was = globalThis.location;
  globalThis.location = { hash: "" };
  try {
    click(iphone); // paired but not tested: setup first
    assert.equal(s.get("installRoute"), "server", "not used until set up");
    assert.ok(!rowOf(iphone).classList.contains("route-on"));
  } finally { globalThis.location = was; }
});

test("Install Apps With page: both choices carry the same icons as the main page's row", () => {
  const [g] = installationGroups("server", null);
  const by = Object.fromEntries(g.rows.map((r) => [r.label, r.icon?.src]));
  assert.equal(by["Signing Server"], rowIcon("signingServer").src);
  assert.equal(by["This iPhone"], rowIcon("installation").src);
});
