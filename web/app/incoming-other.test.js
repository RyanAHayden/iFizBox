// F83: other sideloaders' links reaching incoming.js: a source opens the Sources tab, Add filled in, an IPA opens
// Install IPAs and asks, and with Open Other Apps' Links off (or a link only that app understands) iFizBox opens it
// again, and says the link was for another app when nothing else answers or it comes straight back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleIncoming, handBackText } from "./incoming.js";

const SRC = "https://repo.example.com/apps.json";
const IPA = "https://cdn.example.com/My.ipa";

function deps({ on = true, answer = 1, opened = false, t = 0 } = {}) {
  const log = { adds: [], installs: [], alerts: [], hashes: [], opens: [] };
  const clock = { t };
  return {
    log, clock,
    d: {
      on: () => on, now: () => clock.t, hud: () => () => {},
      open: (h) => log.hashes.push(h),
      add: async (ctx, prefill) => { log.adds.push(prefill); },
      install: async (o) => { log.installs.push(o); return true; },
      alert: async (a) => { log.alerts.push(a); return { index: answer }; },
      native: { call: async (m, p) => { log.opens.push([m, p.url]); return { opened }; } },
    },
  };
}

test("AltStore source link: the Sources tab, Add Source filled in", async () => {
  const { d, log } = deps();
  assert.equal(await handleIncoming(`altstore://source?url=${encodeURIComponent(SRC)}`, d), "other-source");
  assert.deepEqual(log.adds, [{ url: SRC }]);
  assert.deepEqual(log.hashes, ["#/sources"]); // B306: the tab's list, no Manage page
  assert.equal(log.opens.length, 0);
});

test("Feather install link: Install IPAs, then Install signs and installs it", async () => {
  const { d, log } = deps();
  assert.equal(await handleIncoming(`feather://install/${IPA}`, d), "other-install");
  assert.match(log.hashes[0], /installed\/myipas/);
  assert.match(log.alerts[0].message, /Feather link: My\.ipa/);
  assert.deepEqual(log.installs.map(({ url, name }) => ({ url, name })), [{ url: IPA, name: "" }]);
});

test("Install IPA's Cancel installs nothing", async () => {
  const { d, log } = deps({ answer: 0 });
  await handleIncoming(`sidestore://install?url=${encodeURIComponent(IPA)}`, d);
  assert.equal(log.installs.length, 0);
});

test("off: the link goes back out, and opens there when another app answers", async () => {
  const { d, log } = deps({ on: false, opened: true, t: 1_000 });
  const link = `altstore://source?url=${encodeURIComponent(SRC)}`;
  assert.equal(await handleIncoming(link, d), "other-app");
  assert.deepEqual(log.opens, [["app.openURL", link]]);
  assert.equal(log.adds.length + log.alerts.length, 0);
});

test("off: nothing else answers -> the alert names the app and the switch", async () => {
  const { d, log } = deps({ on: false, opened: false, t: 50_000 });
  await handleIncoming(`feather://source/${SRC}`, d);
  assert.equal(log.alerts.length, 1);
  assert.equal(log.alerts[0].title, "Feather Link");
  assert.match(log.alerts[0].message, /Open Other Apps' Links/);
});

test("off: the same link coming straight back (iOS picked iFizBox) is not opened a second time", async () => {
  const { d, log, clock } = deps({ on: false, opened: true, t: 100_000 });
  const link = `scarlet://repo=${SRC}`;
  await handleIncoming(link, d);
  clock.t += 300;
  await handleIncoming(link, d);
  assert.equal(log.opens.length, 1);
  assert.equal(log.alerts.length, 1);
  assert.match(log.alerts[0].message, /iOS sent it to iFizBox/);
});

test("on, but a link only that app understands: handed back too", async () => {
  const { d, log } = deps({ opened: false, t: 200_000 });
  assert.equal(await handleIncoming("feather://import-certificate?p12=A&mobileprovision=B&password=C", d), "other-app");
  assert.equal(log.opens.length, 1);
  assert.match(log.alerts[0].message, /Only Feather can/);
});

test("not one of ours, still null", async () => {
  const { d } = deps();
  assert.equal(await handleIncoming("sileo://source/https://x.example/", d), null);
  assert.match(handBackText({ app: "GBox", scheme: "gbox" }, true), /GBox/);
});
