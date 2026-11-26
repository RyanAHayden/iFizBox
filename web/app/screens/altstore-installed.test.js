// B483: an app page from another source than the installed app's (fastsign's modded X while AppTesters' X is
// installed, same bundle ID) reads as not installed: Install, no Installed rows, no Modify sheet. The installed app's
// own source still gets Modify.
import { test } from "node:test";
import assert from "node:assert/strict";
import { trackingSection, appPageAction, appPageJob, appVersionInstalled, markToggle } from "./altstore.js";
import { memoryAppStore, pageInstall } from "../core/installed.js";
import { createAppQueue } from "../core/appqueue.js";
import { pageHandle } from "../nav/go.js";
import { fakeDocument, withDocument } from "../fakes.test-helper.js";

const fakeElement = (tag) => fakeDocument().createElement(tag);

const ID = "com.x.twitter";
const appOf = (url, name) => ({ bundleIdentifier: ID, name, sourceUrl: url, sourceName: name, iconURL: null,
  versions: [{ version: "2.0", downloadURL: `${url}/x2.ipa` }, { version: "1.0", downloadURL: `${url}/x1.ipa` }] });
const pkgOf = (app) => ({ key: `alt:${app.sourceUrl}`, row: { id: ID }, stanza: { kind: "ipa", ipa: app } });
const TESTERS = pkgOf(appOf("https://appt.example/apps.json", "AppTesters"));
const FASTSIGN = pkgOf(appOf("https://fastsign.example/apps.json", "fastsign"));
const testersRecord = () => ({ id: ID, name: "X", version: "1.0", key: TESTERS.key, source: TESTERS.stanza.ipa.sourceUrl });

const navFor = (body) => {
  const item = fakeElement("div");
  const right = fakeElement("div");
  right.className = "nav-right";
  const button = fakeElement("button");
  button.className = "bar-button";
  button.textContent = "Install";
  right.append(button);
  item.append(right);
  pageHandle(item, body);
  return button;
};

const pageOf = async (doc, pkg, { records = [testersRecord()], signed = null } = {}) => {
  const mem = memoryAppStore(records);
  const body = fakeElement("div");
  doc.body.append(body);
  const nav = navFor(body);
  const box = trackingSection(pkg.stanza.ipa, pkg, null, body, { store: async () => mem, signedOf: async (id) => (id === ID ? signed : null) });
  body.append(box);
  await box.drawn;
  const labels = [...box.querySelectorAll(".group")].flatMap((g) => g.textContent ? [g.textContent] : []).join(" ");
  return { nav, box, labels };
};

test("B483 trackingSection: AppTesters' X recorded, fastsign's page reads Install with no Installed rows", async () => {
  await withDocument(async (doc) => {
    const p = await pageOf(doc, FASTSIGN);
    assert.equal(p.nav.textContent, "Install");
    assert.equal(p.labels.includes("Installed Version"), false, "no Installed Version row");
    assert.equal(p.box.querySelector(".group-footer")?.textContent.startsWith("Installed it another way?"), true);
  });
});

test("B483 trackingSection: AppTesters' own page still reads installed (Modify, Installed Version 1.0)", async () => {
  await withDocument(async (doc) => {
    const p = await pageOf(doc, TESTERS);
    assert.equal(p.nav.textContent, "Modify");
    assert.ok(p.labels.includes("Installed Version"));
  });
});

test("B483 trackingSection: a signature credited to AppTesters counts on its page only", async () => {
  await withDocument(async (doc) => {
    const signed = { bundleId: ID, version: "1.0", credit: { name: "X", source: TESTERS.stanza.ipa.sourceUrl, key: TESTERS.key } };
    assert.equal((await pageOf(doc, FASTSIGN, { records: [], signed })).nav.textContent, "Install");
    assert.equal((await pageOf(doc, TESTERS, { records: [], signed })).nav.textContent, "Modify");
  });
});

const modifyBase = (records) => {
  const mem = memoryAppStore(records);
  const queued = [];
  const asked = [];
  return { queued, asked, opts: { queue: createAppQueue(), mode: "sideload", ready: async () => true, store: async () => mem,
    signedOf: async () => null, add: (j) => queued.push(j), tweaks: async () => true, warn: async () => "install",
    ask: async (o) => { asked.push(o.buttons); return -1; } } };
};

test("B483 appPageAction: fastsign's Install queues a fresh install, no Modify sheet; AppTesters' gets Modify", async () => {
  const f = modifyBase([testersRecord()]);
  assert.equal(await appPageAction(FASTSIGN, null, f.opts), true);
  assert.deepEqual(f.asked, [], "no Modify sheet");
  assert.equal(f.queued.length, 1);
  assert.equal(f.queued[0].installed ?? null, null, "queued as a fresh install");

  const t = modifyBase([testersRecord()]);
  assert.equal(await appPageAction(TESTERS, null, t.opts), true);
  assert.equal(t.asked.length, 1, "Modify sheet");
  assert.ok(t.asked[0].some((b) => /^Upgrade/.test(b)), "it offers Upgrade");
  assert.equal(t.queued.length, 0);
});

test("B483 appPageJob and appVersionInstalled: another source's record is not this page's install", async () => {
  const store = async () => memoryAppStore([testersRecord()]);
  const job = await appPageJob(FASTSIGN, null, { mode: "sideload", store, warn: async () => "install" });
  assert.equal(job.installed ?? null, null);
  assert.equal(await appVersionInstalled(FASTSIGN.stanza.ipa, { store, signedOf: async () => null, key: FASTSIGN.key }), null);
  assert.equal(await appVersionInstalled(TESTERS.stanza.ipa, { store, signedOf: async () => null, key: TESTERS.key }), "1.0");
});

test("B483 markToggle: outline on fastsign's page, filled on AppTesters'", async () => {
  await withDocument(async () => {
    const store = async () => memoryAppStore([testersRecord()]);
    const f = markToggle(FASTSIGN.stanza.ipa, FASTSIGN, null, { store, signedOf: async () => null });
    await f.refreshed;
    assert.equal(f.classList.contains("is-marked"), false);
    const t = markToggle(TESTERS.stanza.ipa, TESTERS, null, { store, signedOf: async () => null });
    await t.refreshed;
    assert.equal(t.classList.contains("is-marked"), true);
  });
});

test("B483 pageInstall: records and signatures by their own source; no source of their own keeps counting", () => {
  const rec = testersRecord();
  assert.equal(pageInstall([rec], ID, null, TESTERS.key).rec, rec);
  assert.equal(pageInstall([rec], ID, null, FASTSIGN.key).rec, null);
  // an older record with only its source URL: ownKey falls back to the source's key
  assert.equal(pageInstall([{ id: ID, source: TESTERS.stanza.ipa.sourceUrl }], ID, null, FASTSIGN.key).rec, null);
  const bare = { id: ID, version: "1.0" };
  assert.equal(pageInstall([bare], ID, null, FASTSIGN.key).rec, bare, "no source of its own: nothing says it's another app");
  assert.equal(pageInstall([rec], ID, null, null).rec, rec, "no page key: as recordOf");
  // a signature with no credit follows the record it stands for
  const signed = { bundleId: ID, version: "1.0" };
  assert.equal(pageInstall([rec], ID, signed, FASTSIGN.key).signed, null);
  assert.equal(pageInstall([rec], ID, signed, TESTERS.key).signed, signed);
  assert.equal(pageInstall([], ID, signed, FASTSIGN.key).signed, signed, "no credit, no record: counts");
  // a credit wins over the record
  const credited = { ...signed, credit: { name: "X", source: FASTSIGN.stanza.ipa.sourceUrl, key: FASTSIGN.key } };
  assert.equal(pageInstall([rec], ID, credited, FASTSIGN.key).signed, credited);
});
