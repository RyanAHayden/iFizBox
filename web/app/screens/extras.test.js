// B12: cancelling the vendor's sign-in sheet goes back to the package page without an alert; a callback the client
// can't read still shows one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { busyAction, vendorSignIn, CANCELLED } from "./extras.js";
import { withDocument } from "../fakes.test-helper.js";

function fakeClient({ finish = true } = {}) {
  const seen = [];
  return {
    seen,
    authenticateUrl: async () => "https://vendor.example/authenticate?udid=x",
    finishSignIn: async (cb) => { seen.push(cb); return finish; },
  };
}

function harness(job) {
  const log = [];
  const run = busyAction("Signing In", job, {
    hud: (label) => { log.push(`show ${label}`); return () => log.push("hide"); },
    fail: async (e) => { log.push(`alert ${e.message}`); },
    refresh: () => log.push("refresh"),
  });
  return { run, log };
}

test("B12: Cancel on the sign-in sheet (auth.session null) is CANCELLED: HUD down, no alert, no redraw", async () => {
  const client = fakeClient();
  const calls = [];
  const call = async (method, params) => { calls.push([method, params]); return null; };
  assert.equal(await vendorSignIn(client, call), CANCELLED);
  assert.deepEqual(calls, [["auth.session", { url: "https://vendor.example/authenticate?udid=x", callbackScheme: "sileo" }]]);
  assert.deepEqual(client.seen, [], "finishSignIn isn't asked about a sheet the user closed");
  const { run, log } = harness(() => vendorSignIn(client, call));
  await run();
  assert.deepEqual(log, ["show Signing In", "hide"]);
});

test("B12: a callback finishSignIn can't read still shows the Purchase alert", async () => {
  const client = fakeClient({ finish: false });
  const call = async () => "sileo://authentication_success?nonsense";
  await assert.rejects(vendorSignIn(client, call), /sent nothing back/);
  const { run, log } = harness(() => vendorSignIn(client, call));
  await run();
  assert.deepEqual(log, ["show Signing In", "hide", "alert The vendor sent nothing back that iFizBox could read."]);
});

test("B12: a good sign-in draws the page again", async () => {
  const client = fakeClient();
  const { run, log } = harness(() => vendorSignIn(client, async () => "sileo://authentication_success?token=t&payment_secret=s"));
  await run();
  assert.deepEqual(log, ["show Signing In", "hide", "refresh"]);
  assert.equal(client.seen.length, 1);
});

// B13: Chariz answers {"price":"FREE","purchased":true,"available":true} for betterAlarm without a token.
import { priceDetail } from "./extras.js";

test("B13: a free commercial package says Free, signed in or out, whatever `purchased` says", () => {
  for (const price of ["FREE", "free", " Free "]) {
    assert.equal(priceDetail({ price, purchased: true, available: true }, false), "Free");
    assert.equal(priceDetail({ price, purchased: true, available: true }, true), "Free");
    assert.equal(priceDetail({ price, purchased: false, available: true }, false), "Free");
  }
});

test("B13: Purchased only for a signed-in account; signed out shows the price", () => {
  assert.equal(priceDetail({ price: "$1.99", purchased: true, available: true }, true), "Purchased");
  assert.equal(priceDetail({ price: "$1.99", purchased: true, available: true }, false), "$1.99");
  assert.equal(priceDetail({ price: "$1.99", purchased: false, available: true }, true), "$1.99");
  assert.equal(priceDetail({ price: null, purchased: false, available: true }, false), "Paid");
});

// B33: Search's Other Sources leaves out rows not built for this device while the Filter hides incompatible
// packages (Show Incompatible off), keeps them (with "Other device") when it's on, and draws nothing when all go.
// Each node's own text and its text nodes', in tree order.
const texts = (n) => [...(n._text ? [n._text] : []), ...n.children.flatMap(texts)];

async function otherSources(hide, data) {
  const { discoveryGroup } = await import("./extras.js");
  return withDocument(async () => {
    const g = discoveryGroup(null, { hideIncompatible: () => hide, search: async () => ({ data }), sources: async () => [],
      arch: () => "iphoneos-arm64", wait: 0 });
    await g.search("you");
    return texts(g.el);
  });
}
const pkg = (id, name, architecture) => ({ package_id: id, name, version: "1", architecture,
  repository: { uri: "https://tinyapps.example/", name: "Tinyapps", suite: "./" } });
const mixed = [pkg("com.a.good", "Good", "iphoneos-arm64"), pkg("com.a.rootful", "Rootful", "iphoneos-arm")];

test("B33: Show Incompatible off (filter on) leaves out Other Sources rows built for another device", async () => {
  const t = await otherSources(true, mixed);
  assert.ok(t.includes("Good"));
  assert.ok(!t.includes("Rootful"));
  assert.ok(!t.includes("Other device"));
});

test("B33: Show Incompatible on (filter off) keeps them, marked Other device", async () => {
  const t = await otherSources(false, mixed);
  assert.ok(t.includes("Good"));
  assert.ok(t.includes("Rootful"));
  assert.ok(t.includes("Other device"));
});

test("B33: every row hidden draws no Other Sources group at all", async () => {
  const t = await otherSources(true, [mixed[1]]);
  assert.deepEqual(t, []);
});

// F319: signed out, a FREE package the vendor calls purchased (Chariz betterAlarm) installs without Sign In: a
// tokenless authorize_download first, Sign In offered on any refusal.
import { paidNav, authorizeFree, freeSignedOut } from "./extras.js";

const freeInfo = { price: "FREE", purchased: true, available: true };
const navCbs = { vendorName: "Chariz", signIn: () => "signIn", buy: () => "buy", install: () => "install", freeInstall: () => "free" };

test("F319: signed out, free and purchased: Install on the button, Download & Install first, Sign In kept", () => {
  const n = paidNav(freeInfo, false, navCbs);
  assert.equal(n.label, "Install");
  assert.equal(n.install, navCbs.freeInstall);
  assert.deepEqual(n.actions.map((a) => a.label), ["Download & Install", "Sign In to Chariz"]);
  assert.equal(n.actions[0].run, navCbs.freeInstall);
  assert.equal(n.note, null);
});

test("F319: only a free, purchased, available package skips Sign In; signed in it is the usual install", () => {
  assert.equal(freeSignedOut(freeInfo), true);
  for (const info of [{ ...freeInfo, price: "$1.99" }, { ...freeInfo, purchased: false }, { ...freeInfo, available: false }, null]) {
    assert.equal(freeSignedOut(info), false);
    const n = paidNav(info, false, navCbs);
    assert.ok(!n.actions.some((a) => a.label === "Download & Install"), JSON.stringify(info));
  }
  assert.equal(paidNav(freeInfo, true, navCbs).install, navCbs.install);
});

test("F319: authorizeFree asks without a token and answers the URL", async () => {
  const asked = [];
  const client = { authorizeDownload: async (id, opts) => { asked.push([id, opts]); return "https://dl.example/once"; } };
  const alerts = [];
  const url = await authorizeFree(client, "com.x.alarm", { version: "1.0", repo: "https://repo.chariz.com/", architecture: "iphoneos-arm64" },
    { alert: async (o) => { alerts.push(o); return { index: 0 }; } });
  assert.equal(url, "https://dl.example/once");
  assert.deepEqual(asked, [["com.x.alarm", { version: "1.0", repo: "https://repo.chariz.com/", architecture: "iphoneos-arm64", tokenless: true }]]);
  assert.deepEqual(alerts, []);
});

test("F319: any refusal offers Sign In: Sign In runs it, Cancel does nothing; no URL either way", async () => {
  const client = { authorizeDownload: async () => { throw new Error("401"); } };
  for (const [index, want] of [[1, 1], [0, 0]]) {
    let signedIn = 0;
    const alerts = [];
    const url = await authorizeFree(client, "com.x.alarm", {}, { vendorName: "Chariz",
      signIn: async () => { signedIn++; }, alert: async (o) => { alerts.push(o); return { index }; } });
    assert.equal(url, null);
    assert.equal(signedIn, want);
    assert.deepEqual(alerts.map((a) => a.buttons), [["Cancel", "Sign In"]]);
    assert.match(alerts[0].message, /Chariz/);
  }
});

// F434: what the Purchase group says about a package its vendor answers available: false for.
import { purchaseFooter } from "./extras.js";
import { createPaymentClient } from "../core/payment.js";

const banner = { message: "Sign in with your Havoc account", button: "Sign In" };
const groupFooter = (info, signedIn, vendorName = "Havoc") => purchaseFooter(info, signedIn,
  { note: paidNav(info, signedIn, { ...navCbs, vendorName }).note, banner, vendorName });

test("F434: no longer sold: the footer says so, over the vendor's sign-in message", () => {
  const gone = { price: "Unavailable", purchased: false, available: false };
  assert.equal(groupFooter(gone, false), "Havoc no longer sells this. If you bought it, sign in to download it.");
  assert.equal(groupFooter(gone, true, "Chariz"), "Chariz no longer sells this.");
  assert.equal(groupFooter({ ...gone, purchased: true }, true), "Havoc no longer sells this.");
  assert.equal(priceDetail(gone, false), "Unavailable");
  assert.equal(priceDetail({ ...gone, purchased: true }, true), "Purchased");
});

test("F434: Free but unavailable isn't called sold; a package for sale keeps its footer", () => {
  const free = { price: "Free", purchased: false, available: false };
  assert.doesNotMatch(groupFooter(free, false), /sell|sold|bought/i);
  assert.equal(groupFooter(free, true), "Not available from Havoc.");
  const sale = { price: "$1.99", purchased: false, available: true };
  assert.equal(groupFooter(sale, false), banner.message);
  assert.equal(groupFooter(sale, true), "Sold by Havoc.");
});

// Havoc's live answers (2026-11-25): an unknown package and a request with no UDID also carry available: false.
test("F434: a vendor error throws its message, though its body says available: false", async () => {
  for (const [status, error] of [[404, "Not Found"], [400, "Bad Request"]]) {
    const client = createPaymentClient({ base: "https://havoc.app/api/sileo/",
      request: async () => ({ status, json: { available: false, error, recovery_url: "https://havoc.app" } }) });
    await assert.rejects(client.packageInfo("com.nope.nope"), new RegExp(error));
  }
});
