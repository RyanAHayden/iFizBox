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
  for (const style of ["ios6", "ios7"]) assert.match(tileSvg("signingServer", style), /<svg/);
});

test("main page: every row below the status has its row icon; Install Apps With is the chosen route", async () => {
  forgetStatus();
  const page = mainPage({ store: store("server"), native: bridge({}), links: LINKS, signing: async () => null });
  await page.refresh();
  const [, , route, cert, apps, help] = cellsOf(page);
  assert.equal(text(route, ".cell-label"), "Signing Server");
  assert.equal(text(route, ".cell-subtitle"), `iOS installs each app from ${DOMAIN}`);
  assert.equal(iconSrc(route), rowIcon("signingServer").src);
  assert.equal(iconSrc(cert), rowIcon("signing").src);
  assert.equal(iconSrc(apps), rowIcon("websiteApps").src);
  assert.equal(iconSrc(help), rowIcon("help").src);
  assert.equal(text(route, ".slot-value"), "");
  assert.ok(page.el.textContent.includes("Tap to choose how signed apps reach iOS."));
  assert.ok(!page.el.textContent.includes("Installation"), "the old Installation header is gone");
});

test("main page: a change of route redraws the row in place, This iPhone with Paired as its detail", async () => {
  forgetStatus();
  const s = store("server");
  const page = mainPage({ store: s, native: bridge({ "idevice.status": PAIRED_ON }), links: LINKS, signing: async () => null });
  await page.refresh();
  const route = cellsOf(page)[2];
  s.set("installRoute", "iphone");
  await page.refresh();
  assert.equal(cellsOf(page)[2], route, "the same row, not a new one");
  assert.equal(text(route, ".cell-label"), "This iPhone");
  assert.equal(text(route, ".cell-subtitle"), "Straight onto this iPhone, no popup");
  assert.equal(iconSrc(route), rowIcon("installation").src);
  assert.equal(text(route, ".slot-value"), "Paired");
  s.set("installRoute", "server");
  await page.refresh();
  assert.equal(text(route, ".cell-label"), "Signing Server");
  assert.equal(iconSrc(route), rowIcon("signingServer").src);
});

test("Install Apps With page: both choices carry the same icons as the main page's row", () => {
  const [g] = installationGroups("server", null);
  const by = Object.fromEntries(g.rows.map((r) => [r.label, r.icon?.src]));
  assert.equal(by["Signing Server"], rowIcon("signingServer").src);
  assert.equal(by["This iPhone"], rowIcon("installation").src);
});
