// F76: what the Share sheet lists on a source's page and on an app's page (screens/handoff.js shareItems).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shareItems, sourceUrlOf, APP_TILES, SIDELOAD_TOOLS, headerShareButton } from "./handoff.js";
import { fakeDocument } from "../fakes.test-helper.js";

const ORIGIN = "https://ifizbox.com";
const APT = { key: "deb:https://repo.example/:./", uri: "https://repo.example/", dist: "./" };
const ALT = { key: "alt:https://alt.example/apps.json", kind: "altstore", uri: "https://alt.example/apps.json" };
const kinds = (items) => items.filter((i) => i.kind !== "link").map((i) => (i.kind === "open" ? i.label : i.kind));

test("an AltStore source: Copy Link, Add on Another Device, then every AltStore-format sideloader", () => {
  const items = shareItems(ALT, { origin: ORIGIN, jailbroken: false });
  assert.deepEqual(kinds(items), ["copy", "qr", "AltStore Classic", "AltStore", "SideStore", "Feather", "LiveContainer", "StikStore", "TrollApps"]);
  assert.equal(items[0].label, "Copy Link");
  assert.equal(items[0].text, "https://alt.example/apps.json");
  assert.equal(items[1].label, "Add on Another Device");
  assert.equal(items[1].link, `${ORIGIN}/add?url=${encodeURIComponent("https://alt.example/apps.json")}`);
  assert.equal(items.find((i) => i.label === "SideStore").url, `sidestore://source?url=${encodeURIComponent(ALT.uri)}`);
  for (const i of items.slice(2)) {
    assert.match(i.letter, /^[A-Z]$/);
    assert.match(i.color, /^#[0-9a-f]{6}$/);
  }
});

test("an APT source: the four managers on a jailbroken phone, only the link and QR code on one that isn't", () => {
  assert.deepEqual(kinds(shareItems(APT, { origin: ORIGIN, jailbroken: true })), ["copy", "qr", "Cydia", "Sileo", "Zebra", "Irisin"]);
  assert.deepEqual(kinds(shareItems(APT, { origin: ORIGIN, jailbroken: false })), ["copy", "qr"]);
  assert.equal(shareItems(APT, { origin: ORIGIN, jailbroken: true })[0].text, "https://repo.example/");
  // A dist repo: only Irisin takes a suite.
  const dist = { key: "deb:https://apt.procurs.us/:iphoneos-arm64/1900", uri: "https://apt.procurs.us/", dist: "iphoneos-arm64/1900", components: ["main"] };
  assert.deepEqual(kinds(shareItems(dist, { origin: ORIGIN, jailbroken: true })), ["copy", "qr", "Irisin"]);
});

test("an app's page: Copy Link, Add on Another Device, then the apps that take its source", () => {
  assert.deepEqual(kinds(shareItems(ALT, { app: true, origin: ORIGIN, jailbroken: true })), kinds(shareItems(ALT, { origin: ORIGIN, jailbroken: true })));
  assert.deepEqual(kinds(shareItems(ALT, { app: true, origin: ORIGIN })).slice(0, 2), ["copy", "qr"]);
});

test("other IPA formats get their own app first; nothing to share without an http URL", () => {
  const esign = { ...ALT, format: "esign" };
  assert.deepEqual(kinds(shareItems(esign, { origin: ORIGIN })).slice(0, 4), ["copy", "qr", "ESign", "AltStore Classic"]);
  assert.deepEqual(kinds(shareItems({ ...ALT, format: "scarlet" }, { origin: ORIGIN })), ["copy", "qr", "Scarlet"]);
  assert.deepEqual(shareItems({ key: "deb:file:///x:./", uri: "file:///x/" }, { origin: ORIGIN, jailbroken: true }), []);
  assert.deepEqual(shareItems(null), []);
  assert.equal(sourceUrlOf({ uri: "javascript:alert(1)" }), null);
});

test("every app the hand-offs name has its own tile", () => {
  for (const app of ["Cydia", "Sileo", "Zebra", "Irisin", "AltStore Classic", "AltStore", "SideStore", "Feather", "LiveContainer", "StikStore", "TrollApps", "Scarlet", "ESign", "GBox"]) {
    assert.ok(APP_TILES[app], app);
  }
});

// ---- F194: the jailbreak build's sheet leaves out the sideload tools; Share on an app page's header ---------------

const SIDELOADERS = ["AltStore Classic", "AltStore", "SideStore", "Feather", "LiveContainer", "StikStore", "TrollApps", "Scarlet", "ESign", "GBox"];

test("F194: the jailbreak build lists no sideload-tool hand-offs; the sideload IPA and the website still do", () => {
  for (const app of SIDELOADERS) assert.ok(SIDELOAD_TOOLS.has(app), app);
  for (const app of ["Cydia", "Sileo", "Zebra", "Irisin"]) assert.ok(!SIDELOAD_TOOLS.has(app), app);
  for (const source of [ALT, { ...ALT, format: "esign" }, { ...ALT, format: "scarlet" }, { ...ALT, format: "gbox" }]) {
    for (const app of [false, true]) {
      const jb = shareItems(source, { app, origin: ORIGIN, jailbroken: true, mode: "jailbreak" });
      assert.deepEqual(kinds(jb), ["copy", "qr"], `${source.format ?? "altstore"} app=${app}: Copy Link and the QR code only`);
      for (const mode of ["sideload", "site"]) {
        const opens = shareItems(source, { app, origin: ORIGIN, jailbroken: true, mode }).filter((i) => i.kind === "open");
        assert.ok(opens.length > 0, `${mode} keeps them`);
        assert.ok(opens.every((i) => SIDELOAD_TOOLS.has(i.label)));
      }
    }
  }
  // The full list on the sideload IPA, as on the website.
  assert.deepEqual(kinds(shareItems(ALT, { origin: ORIGIN, jailbroken: false, mode: "sideload" })),
    ["copy", "qr", "AltStore Classic", "AltStore", "SideStore", "Feather", "LiveContainer", "StikStore", "TrollApps"]);
  // The APT managers stay in the jailbreak build.
  assert.deepEqual(kinds(shareItems(APT, { origin: ORIGIN, jailbroken: true, mode: "jailbreak" })), ["copy", "qr", "Cydia", "Sileo", "Zebra", "Irisin"]);
  // With no mode given it is the page's own (core/settings.js detectMode): no native bridge here, so the website's.
  assert.deepEqual(kinds(shareItems(ALT, { origin: ORIGIN })), kinds(shareItems(ALT, { origin: ORIGIN, mode: "site" })));
});

const fakeDom = () => (globalThis.document = fakeDocument()).body;
const all = (n, out = []) => { out.push(n); (n.children ?? []).forEach((c) => all(c, out)); return out; };

test("F194: the app page header's Share button opens the share sheet with the source's hand-offs", async () => {
  const saved = { document: globalThis.document, fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  globalThis.fetch = () => Promise.reject(new Error("offline in tests")); // the apps' icons: letters instead
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  try {
    for (const [mode, expected] of [["sideload", ["Copy Link", "Add on Another Device", "AltStore Classic", "AltStore", "SideStore"]],
      ["jailbreak", ["Copy Link", "Add on Another Device"]]]) {
      const body = fakeDom();
      const b = headerShareButton(ALT, { app: true, origin: ORIGIN, mode });
      assert.equal(b.tagName, "BUTTON");
      for (const c of ["bar-button", "bar-icon", "share-button", "store-head-share"]) assert.ok(b.classList.contains(c), c);
      assert.equal(b.getAttribute("aria-label"), "Share");
      b.dispatch("click");
      const sheet = all(body).find((n) => n._cls?.has("share-sheet"));
      assert.ok(sheet, "the share sheet is open");
      const labels = all(sheet).filter((n) => n._cls?.has("share-label")).map((n) => n.textContent);
      assert.deepEqual(labels.slice(0, expected.length), expected, mode);
      if (mode === "jailbreak") assert.equal(labels.length, 2, "no sideload tools in the jailbreak build");
      else assert.ok(labels.includes("Feather"));
    }
    fakeDom();
    assert.equal(headerShareButton(null, { origin: ORIGIN }), null, "nothing to share, no button");
  } finally {
    Object.assign(globalThis, saved);
  }
});

test("F194: the app page puts Share on its header (storeHeader's action), not in the nav bar", async () => {
  const { readFileSync } = await import("node:fs");
  const alt = readFileSync(new URL("./altstore.js", import.meta.url), "utf8");
  const app = alt.slice(alt.indexOf("export function renderApp("), alt.indexOf("export function storeLookup("));
  assert.match(app, /storeHeader\(\{[^]*?action: headerShareButton\(source \?\? \{ key: pkg\.key \}, \{ app: true, appId: pkg\.row\?\.id \?\? pkg\.stanza\.package \}\)/);
  assert.doesNotMatch(app, /setSourceShare\(/, "one Share, on the header");
});

test("a tweak page has Share on its header too, opening the row menu's package sheet", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  const page = src.slice(src.indexOf("async function renderPackage("));
  assert.match(page, /storeHeader\(\{[^]*?action: shareHeadButton\(\(\) => showPackageShare\(/);
});

test("F451: Share iFizBox link: a source's add link, an app's /app link", () => {
  const src = shareItems(ALT, { origin: ORIGIN, jailbroken: false }).find((i) => i.kind === "link");
  assert.equal(src.label, "Share iFizBox link");
  assert.equal(src.url, "https://ifizbox.com/add?url=https%3A%2F%2Falt.example%2Fapps.json");
  const app = shareItems(ALT, { app: true, appId: "com.x.y", origin: ORIGIN, jailbroken: false }).find((i) => i.kind === "link");
  assert.equal(app.url, "https://ifizbox.com/app?id=com.x.y");
  assert.equal(shareItems(ALT, { app: true, origin: ORIGIN }).some((i) => i.kind === "link"), false);
});
