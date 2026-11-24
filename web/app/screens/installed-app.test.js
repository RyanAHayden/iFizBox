// B417: an Installed row opens Details before, during and after its source loads: drawn from what the worker has, else
// from the record, and filled in without a reopen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderInstalledApp, findApp, appRowHref, appOf, openAppPage, reloadSigned, recordSections, OPEN, RESIGN, SAVE_IPA, REMOVE } from "./installed.js";
import { format } from "../router.js";
import { fakeDocument } from "../nav/fakedom.test-helper.js";

const KEY = "alt:https://feather.example/apps.json";
const REC = { id: "com.example.feather", name: "Feather", version: "2.0", key: KEY, source: "https://feather.example/apps.json", sourceName: "Feather Repo" };
const PKG = { key: KEY, stanza: { kind: "ipa", version: "2.1" } };
const ROUTE = { tab: "installed", path: [`package:${REC.id}@${KEY}`] };
const stub = () => ({ isConnected: true, children: [], append() {}, replaceChildren() {} });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
globalThis.document ??= fakeDocument();

function drawer(log, over = {}) {
  return { wait: 5, row: async () => REC, peek: async () => null, find: async () => PKG,
    drawSource: async (b, r, p) => { log.push(["source", p.stanza.version]); return { refresh: () => log.push(["refresh"]) }; },
    drawRecord: async (b, v, r, { loading }) => { v.shown = "record"; v.record = r; log.push(["record", loading]); },
    drawMissing: () => log.push(["missing"]), ...over };
}
const later = () => { let res; const p = new Promise((r) => { res = r; }); return [p, res]; };

test("a row goes to Details in its record's source, candidates loaded or not; app:<id> is an old link to it", () => {
  const root = { tab: "installed", path: [] };
  const href = format(ROUTE);
  assert.equal(appRowHref(REC, null, root), href);
  assert.equal(appRowHref(REC, new Map(), root), href);
  assert.equal(appRowHref(REC, new Map([[REC.id, { key: KEY }]]), root), href);
  assert.match(appRowHref({ id: "com.x", key: "library:X.ipa" }, null, root), /package(:|%3A)com\.x$/);
  assert.deepEqual(appOf(ROUTE.path[0]), { id: REC.id, key: KEY });
  assert.deepEqual(appOf("app:com.x"), { id: "com.x", key: null });
  assert.equal(appOf("versions:com.x"), null);
  assert.equal(appOf("app:"), null);
});

test("not loaded: the record first, then the source's page, with no reopen; loaded: the source's page at once", async () => {
  const log = [];
  const [found, arrive] = later();
  const done = renderInstalledApp(stub(), ROUTE, null, drawer(log, { find: () => found }));
  await tick(30);
  assert.deepEqual(log, [["record", true]]);
  arrive(PKG);
  await done;
  assert.deepEqual(log, [["record", true], ["source", "2.1"]]);
  const loaded = [];
  await renderInstalledApp(stub(), ROUTE, null, drawer(loaded));
  assert.deepEqual(loaded, [["source", "2.1"]]);
});

test("a refresh running: the worker's entry at once, drawn again only when the new one differs", async () => {
  for (const [last, want] of [[PKG, [["source", "2.1"]]],
    [{ ...PKG, stanza: { ...PKG.stanza, version: "2.2" } }, [["source", "2.1"], ["source", "2.2"]]],
    [null, [["source", "2.1"]]]]) {
    const log = [];
    await renderInstalledApp(stub(), ROUTE, null, drawer(log, { peek: async () => PKG, find: async () => last }));
    assert.deepEqual(log, want);
  }
});

test("no source: the record's page; an old app:<id> link looks in the record's source; signed only never asks a source", async () => {
  const log = [];
  await renderInstalledApp(stub(), ROUTE, null, drawer(log, { find: async () => null }));
  assert.deepEqual(log, [["record", false]]);
  const asked = [];
  await renderInstalledApp(stub(), { tab: "installed", path: [`app:${REC.id}`] }, null, drawer([], { find: async (id, key) => { asked.push([id, key]); return PKG; } }));
  assert.deepEqual(asked, [[REC.id, KEY]]);
  const own = [];
  await renderInstalledApp(stub(), { tab: "installed", path: ["package:com.mine"] }, null, drawer(own, {
    row: async () => ({ id: "com.mine", name: "Mine", signedOnly: true, signed: {} }), find: () => assert.fail() }));
  assert.deepEqual(own, [["record", false]]);
  const none = [];
  await renderInstalledApp(stub(), ROUTE, null, drawer(none, { row: async () => null, find: async () => null }));
  assert.deepEqual(none, [["missing"]]);
});

test("a record page looks again quietly: filled once its source loads; a source page only refreshes its records", async () => {
  const log = [];
  const body = stub();
  await renderInstalledApp(body, ROUTE, null, drawer(log, { find: async () => null }));
  await renderInstalledApp(body, ROUTE, null, drawer(log, { quiet: true }));
  await renderInstalledApp(body, ROUTE, null, drawer(log, { quiet: true, row: () => assert.fail() }));
  assert.deepEqual(log, [["record", false], ["source", "2.1"], ["refresh"]]);
  body.isConnected = false;
});

test("findApp: the source named, else any that has it", async () => {
  const other = { key: "alt:other", stanza: { version: "1" } };
  assert.equal(await findApp("a", KEY, async (id, key) => (key === KEY ? PKG : other)), PKG);
  assert.equal(await findApp("a", KEY, async (id, key) => (key === KEY ? null : other)), other);
  assert.equal(await findApp("a", null, async () => null), null);
  assert.equal(await findApp("a", KEY, async () => { throw new Error("offline"); }), null);
});

test("the record's sections: Open, Re-sign, Save Signed IPA and Remove once settled; none while loading", () => {
  const r = { ...REC, signed: { bundleId: REC.id, expires: "2026-11-25T00:00:00Z" } };
  const ipa = { file: "F.ipa" };
  const s = recordSections(r, { ipa, mode: "sideload", now: new Date("2026-11-18T00:00:00Z"), window: 2 });
  assert.deepEqual(s.installed.rows.slice(0, 2).map((x) => [x.label, x.detail]), [["Installed Version", "2.0"], ["Signature", "7 days left"]]);
  assert.deepEqual(s.actions.rows.map((x) => x.label), [OPEN, RESIGN, SAVE_IPA]);
  assert.deepEqual(s.remove.rows.map((x) => x.label), [REMOVE]);
  assert.match(s.infoFooter, /No source lists/);
  const l = recordSections(r, { loading: true, mode: "sideload" });
  assert.equal(l.infoFooter, "Loading Feather Repo…");
  assert.equal(l.actions ?? l.remove, null);
});

test("reloadSigned still reaches a source page", () => {
  const body = { isConnected: true };
  openAppPage(body, ROUTE);
  const drawn = [];
  assert.equal(reloadSigned({ load: () => {}, draw: (b) => drawn.push(b) }) >= 1, true);
  assert.ok(drawn.includes(body));
  body.isConnected = false;
});

test("a quiet reload during the first draw takes it over: never a placeholder for ever", async () => {
  const log = [];
  const body = stub();
  const none = { row: async () => null, find: async () => null };
  const first = renderInstalledApp(body, ROUTE, null, drawer(log, none));
  await Promise.all([first, renderInstalledApp(body, ROUTE, null, drawer(log, { ...none, quiet: true }))]);
  assert.deepEqual(log, [["missing"]]);
});
