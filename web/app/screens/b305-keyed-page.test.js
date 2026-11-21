// B305: RyukGram ships Instagram's bundle ID (com.burbn.instagram). Installed's row and the page it opens name it
// RyukGram (the source entry its record names), not Instagram (another source's app, the newest under that ID).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument, fakePage, memStorage, tick } from "../fakes.test-helper.js";

globalThis.localStorage = memStorage();
globalThis.document = fakeDocument();
globalThis.CSS ??= { escape: (s) => String(s) };
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
globalThis.fetch = async () => { throw new Error("offline"); };
delete globalThis.ifizboxNative;
const browse = await import("./browse.js");
const { appListElement } = await import("./installed.js");
const { catalog, ALL } = await import("../catalog.js");
const { getBackend } = await import("../backend.js");
const { parse } = await import("../router.js");

const ID = "com.burbn.instagram";
const RYUK = "alt:https://source.ryuksign.com/";
const TESTERS = "alt:https://repo.apptesters.org/";
const app = (name, version, key) => ({ key, row: { id: ID, name, version }, stanza: { kind: "ipa", name, version, package: ID,
  ipa: { name, bundleIdentifier: ID, permissions: { privacy: [], entitlements: [] }, version, versions: [{ version, downloadURL: `https://x.test/${name}.ipa` }], sourceUrl: key.slice(4) } } });
// Instagram is newer, so it is All Sources' answer for the bundle ID.
const PKGS = { [RYUK]: app("RyukGram", "400.0", RYUK), [TESTERS]: app("Instagram", "401.0", TESTERS) };
PKGS[ALL] = PKGS[TESTERS];

// The record Install wrote (the source's name); signing.installed names it by its IPA's Info.plist (Instagram).
const record = { id: ID, name: "RyukGram", version: "400.0", key: RYUK, source: RYUK.slice(4), sourceName: "RyukSign" };
const signed = { apps: [{ bundleId: ID, originalBundleId: ID, name: "Instagram", version: "400.0", expires: "2099-01-01T00:00:00Z" }] };

test("B305: RyukGram's Installed row says RyukGram and opens RyukGram's entry, not Instagram's", async () => {
  const cands = new Map([[ID, { version: "400.0", key: RYUK, pkg: PKGS[RYUK] }]]); // installed.js candidates: the record's own source
  const route = { tab: "installed", path: [] };
  const ul = appListElement([{ rows: [record] }], [], { route, cands, signed, editing: false,
    view: { editing: false, managing: false, selected: new Set() } });
  const cell = ul.querySelectorAll(":scope > .cell")[0];
  assert.equal(cell.querySelector(".cell-label").textContent, "RyukGram");
  const href = cell.querySelector(".cell-inner").href;
  const page = parse(href.slice(href.indexOf("#")));
  assert.deepEqual(browse.pageOf(page), { key: RYUK, page: "package", value: ID });

  const was = { ensure: catalog.ensure, package: catalog.package, history: catalog.history };
  const backend = getBackend();
  const sources = backend.sources;
  catalog.ensure = async () => {};
  catalog.package = async (id, key = ALL) => (id === ID ? PKGS[key] ?? null : null);
  catalog.history = async () => null;
  backend.sources = async () => [{ key: RYUK, url: RYUK.slice(4), name: "RyukSign" }, { key: TESTERS, url: TESTERS.slice(4), name: "AppTesters" }];
  try {
    const body = fakePage();
    await browse.render(body, page, { go() {}, setBadge() {}, setTitle() {}, showHUD: () => () => {} });
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(browse.nav(page).title, "Details", "the page's title (F350: Cydia's Details)");
    assert.match(body.textContent, /RyukGram/, "the page drew");
    assert.doesNotMatch(body.textContent, /Instagram/);
  } finally {
    Object.assign(catalog, was);
    backend.sources = sources;
  }
  // a plain package token (no source known) is still All Sources'
  assert.deepEqual(browse.pageOf({ tab: "installed", path: [browse.keyedToken(ID, null)] }), { key: ALL, page: "package", value: ID });
});
