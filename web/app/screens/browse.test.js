import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToken, token, pageOf, nav, withBase, escapeHtml, installedAppSection } from "./browse.js";
import { sizeText as formatSize } from "../core/appqueue.js";
import { withLetterHeaders } from "../nav/vlist.js";
import { parse, format } from "../router.js";

const KEY = "deb:https://repo.example/:./";

test("routes below Sources and Search name their page", () => {
  assert.deepEqual(parseToken("section:Tweaks"), { kind: "section", value: "Tweaks" });
  assert.deepEqual(parseToken("author:Jay Freeman (saurik)"), { kind: "author", value: "Jay Freeman (saurik)" });
  assert.deepEqual(parseToken("package:com.a:b"), { kind: "package", value: "com.a:b" });
  assert.equal(parseToken("nonsense").kind, "unknown");
  assert.deepEqual(pageOf({ tab: "sources", path: [KEY] }), { key: KEY, page: "sections" });
  assert.deepEqual(pageOf({ tab: "sources", path: ["*", token("section", "*")] }), { key: "*", page: "section", value: "*" });
  assert.deepEqual(pageOf({ tab: "search", path: [token("package", "x")] }), { key: "*", page: "package", value: "x" });
  // a source key full of ':' and '/' survives the hash round trip
  const hash = format({ tab: "sources", path: [KEY, token("section", "Themes (SpringBoard)"), token("package", "com.x")] });
  assert.deepEqual(pageOf(parse(hash)), { key: KEY, page: "package", value: "com.x" });
  assert.equal(parse(hash).path[0], KEY);
});

test("titles: source name, All Packages, section, author", () => {
  assert.equal(nav({ tab: "sources", path: [KEY] }, () => "Example").title, "Example");
  assert.equal(nav({ tab: "sources", path: ["*"] }).title, "Sections");
  assert.equal(nav({ tab: "sources", path: ["*"] }).right.label, "Edit"); // Section Visibility (F24)
  assert.equal(nav({ tab: "sources", path: ["*", "section:*"] }).right, undefined);
  assert.equal(nav({ tab: "sources", path: ["*", "section:*"] }).title, "All Packages");
  assert.equal(nav({ tab: "sources", path: ["*", "section:Tweaks"] }).title, "Tweaks");
  assert.equal(nav({ tab: "search", path: ["author:Jane"] }).title, "Jane");
  assert.equal(nav({ tab: "search", path: ["package:com.unseen"] }).title, "Details", "F350: Cydia's title, not the name");
  assert.equal(nav({ tab: "search", path: ["package:x", "info:x"] }).title, "More Information");
  assert.equal(nav({ tab: "search", path: ["package:x", "pkgsettings:x"] }).title, "Settings");
  assert.equal(nav({ tab: "search", path: ["package:x", "files:x"] }).title, "Files");
});

test("sizes, letter headers and proxied depiction HTML", () => {
  assert.equal(formatSize(109 * 1024), "109 kB");
  assert.equal(formatSize(4938586), "4.7 MB");
  assert.equal(formatSize(10), "1 kB");
  assert.equal(formatSize("x"), null);
  const rows = [{ n: "Alpha" }, { n: "apple" }, { n: "Bravo" }, { n: "3D" }];
  assert.deepEqual(withLetterHeaders(rows, (r) => r.n[0].toUpperCase()).map((r) => r.header ?? r.n),
    ["A", "Alpha", "apple", "B", "Bravo", "3", "3D"]);
  assert.equal(withBase("<html><head><title>t</title></head></html>", "http://x/a?b=1&c=\"2\""),
    '<html><head><base href="http://x/a?b=1&amp;c=&quot;2&quot;" target="_blank"><title>t</title></head></html>');
  assert.equal(withBase("<p>hi</p>", "http://x/"), '<base href="http://x/" target="_blank"><p>hi</p>');
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("F87: the jailbreak app page's Installed App group: the phone's version, and I4's note where it differs", () => {
  assert.deepEqual(installedAppSection({ id: "d", version: "1.6", actual: "1.6", note: "Installed: 1.6 (iFizBox remembered 1.5)" }),
    { header: "Installed App", rows: [{ label: "Version", detail: "1.6" }], footer: "Installed: 1.6 (iFizBox remembered 1.5)" });
  assert.deepEqual(installedAppSection({ id: "g", version: "2.0", actual: null, note: "Not installed (iFizBox remembered 2.0)" }).rows,
    [{ label: "Version", detail: "Not Installed" }]);
  assert.equal(installedAppSection({ id: "u", version: "4.5.2", actual: "4.5.2", note: null }).footer, null);
  assert.equal(installedAppSection({ id: "o", version: "1.0" }).rows[0].detail, "1.0"); // real versions unreadable: the remembered one
});

// F192: holding a package row: the queue action named by state, Share, then Source unless the list is that source.
import { rowMenuItems, packageShareItems } from "./browse.js";

test("a held row's callout: Install / Upgrade / Remove / Cancel, Share, Source", () => {
  const pkg = { id: "com.x", name: "X", version: "1.0", key: KEY };
  const labels = (o) => rowMenuItems(pkg, o).map((i) => i.label);
  assert.deepEqual(labels({ queue: true, newest: "1.0" }), ["Install", "Share", "Source"]);
  assert.deepEqual(rowMenuItems(pkg, { queue: true, newest: "1.0" })[0].job, { op: "install", id: "com.x", version: "1.0" });
  assert.deepEqual(labels({ queue: true, installed: "0.9", newest: "1.0" }), ["Upgrade", "Share", "Source"]);
  assert.deepEqual(rowMenuItems(pkg, { queue: true, installed: "0.9", newest: "1.0" })[0].job, { op: "install", id: "com.x", version: "1.0" });
  assert.deepEqual(labels({ queue: true, installed: "1.0", newest: "1.0" }), ["Remove", "Share", "Source"]);
  assert.deepEqual(labels({ queue: true, installed: "1.0", newest: null }), ["Remove", "Share", "Source"]);
  assert.deepEqual(rowMenuItems(pkg, { queue: true, installed: "1.0" })[0].job, { op: "remove", id: "com.x" });
  assert.deepEqual(labels({ queue: true, installed: "1.0", queued: true }), ["Cancel", "Share", "Source"]);
  // No queue (the website, the sideload build), nothing a source can download, a paid package, an AltStore app.
  assert.deepEqual(labels({ queue: false, newest: "1.0" }), ["Share", "Source"]);
  assert.deepEqual(labels({ queue: true, newest: null }), ["Share", "Source"]);
  assert.deepEqual(rowMenuItems({ ...pkg, paid: true }, { queue: true, newest: "1.0" }).map((i) => i.label), ["Share", "Source"]);
  assert.deepEqual(rowMenuItems({ ...pkg, paid: true }, { queue: true, installed: "1.0", newest: "1.0" }).map((i) => i.label), ["Remove", "Share", "Source"]);
  assert.deepEqual(rowMenuItems({ ...pkg, kind: "ipa" }, { queue: true, newest: "1.0" }).map((i) => i.label), ["Share", "Source"]);
  // Already that source's list, or no source (installed only): no Source.
  assert.deepEqual(labels({ listKey: KEY }), ["Share"]);
  assert.deepEqual(rowMenuItems(pkg, {}).at(-1), { kind: "source", label: "Source", key: KEY });
  assert.deepEqual(rowMenuItems({ ...pkg, key: null }, {}).map((i) => i.label), ["Share"]);
  assert.deepEqual(rowMenuItems({}, { queue: true }), []);
});

test("a held row's Share: Copy Link to the site's package page, the managers only on a jailbroken phone's website", () => {
  const pkg = { id: "com.x y", key: KEY };
  const src = { key: KEY, uri: "https://repo.example/", dist: "./" };
  const app = packageShareItems(pkg, src, { origin: "https://ifizbox.com", mode: "jailbreak", jailbroken: true });
  assert.deepEqual(app, [{ kind: "copy", label: "Copy Link", text: "https://ifizbox.com/#/search/package%3Acom.x%20y" }]);
  assert.deepEqual(parse(app[0].text.replace(/^[^#]*/, "")), { tab: "search", path: ["package:com.x y"] });
  const site = packageShareItems(pkg, src, { origin: "https://ifizbox.com", mode: "site", jailbroken: true });
  assert.deepEqual(site.map((i) => i.label), ["Copy Link", "Cydia", "Sileo", "Zebra", "Irisin"]);
  assert.equal(site[2].url, "sileo://package/com.x%20y");
  assert.match(site[2].color, /^#[0-9a-f]{6}$/);
  assert.deepEqual(packageShareItems(pkg, src, { origin: "https://ifizbox.com", mode: "site", jailbroken: false }).map((i) => i.label), ["Copy Link"]);
  assert.deepEqual(packageShareItems({}, src, { origin: "https://ifizbox.com", mode: "site" }), []);
});

// F193: swiping a row left does F192's queue item, from the same states; the control and the undo bar's line.
import { rowSwipeAction, swipeMessage, swipeHintDue } from "./browse.js";

test("a row's swipe: green + for Install / Upgrade, red minus for Remove, grey x for Cancel, nothing without a queue item", () => {
  const pkg = { id: "com.x", name: "X", version: "1.0", key: KEY };
  assert.deepEqual(rowSwipeAction(pkg, { queue: true, newest: "1.0" }),
    { kind: "add", label: "Install", job: { op: "install", id: "com.x", version: "1.0" } });
  assert.deepEqual(rowSwipeAction(pkg, { queue: true, installed: "0.9", newest: "1.0" }),
    { kind: "add", label: "Upgrade", job: { op: "install", id: "com.x", version: "1.0" } });
  assert.deepEqual(rowSwipeAction(pkg, { queue: true, installed: "1.0", newest: "1.0" }),
    { kind: "remove", label: "Remove", job: { op: "remove", id: "com.x" } });
  assert.deepEqual(rowSwipeAction(pkg, { queue: true, installed: "1.0", queued: true }), { kind: "cancel", label: "Cancel" });
  // Share and Source stay in the hold menu: no queue, nothing downloadable, a paid or AltStore package: no swipe.
  assert.equal(rowSwipeAction(pkg, { queue: false, newest: "1.0" }), null);
  assert.equal(rowSwipeAction(pkg, { queue: true, newest: null }), null);
  assert.equal(rowSwipeAction({ ...pkg, paid: true }, { queue: true, newest: "1.0" }), null);
  assert.equal(rowSwipeAction({ ...pkg, kind: "ipa" }, { queue: true, newest: "1.0" }), null);
  assert.equal(rowSwipeAction({}, { queue: true }), null);
});

test("the undo bar's line, and when the first-run hint plays", () => {
  assert.equal(swipeMessage({ kind: "add", label: "Install" }, "X"), "Install X queued");
  assert.equal(swipeMessage({ kind: "add", label: "Upgrade" }, "X"), "Upgrade X queued");
  assert.equal(swipeMessage({ kind: "remove", label: "Remove" }, "X"), "Remove X queued");
  assert.equal(swipeMessage({ kind: "cancel", label: "Cancel" }, "X", { mode: "remove" }), "Remove X cancelled");
  assert.equal(swipeHintDue({ queue: true }), true);
  assert.equal(swipeHintDue({ queue: false }), false);           // the website: nothing to swipe to
  assert.equal(swipeHintDue({ queue: true, seen: true }), false);
  assert.equal(swipeHintDue({ queue: true, queued: 1 }), false);  // has queued something
  assert.equal(swipeHintDue({ queue: true, logs: 2 }), false);    // has run a queue before
  assert.equal(swipeHintDue({ queue: true, reduce: true }), false);
});

// F213: the sideload build queues AltStore apps from a row: the app page's job, Install / Upgrade / Cancel.
import { rowAppJob } from "./altstore.js";

const appPkg = (versions, extra = {}) => ({ key: "alt:https://s/", row: { id: "com.x.app", name: "App" },
  stanza: { kind: "ipa", ipa: { bundleIdentifier: "com.x.app", name: "App", sourceUrl: "https://s/apps.json", sourceName: "S",
    iconURL: "https://s/a.png", versions, ...extra } } });
const storeOf = (recs) => async () => ({ all: async () => recs });

test("F213: an app row's job in the sideload build: as the app page's, with the installed record", async () => {
  const p = appPkg([{ version: "2.0", downloadURL: "https://s/a2.ipa" }, { version: "1.0", downloadURL: "https://s/a1.ipa" }]);
  const fresh = await rowAppJob(p, null, { store: storeOf([]), mode: "sideload" });
  assert.equal(fresh.installed, null);
  assert.equal(fresh.newest, "2.0");
  assert.equal(fresh.job.id, "com.x.app");
  assert.equal(fresh.job.url, "https://s/a2.ipa");
  assert.equal(fresh.job.installed, null);
  const old = await rowAppJob(p, null, { store: storeOf([{ id: "com.x.app", version: "1.0" }]), mode: "sideload" });
  assert.equal(old.installed, "1.0");
  assert.equal(old.job.installed, "1.0");
  const unknown = await rowAppJob(p, null, { store: storeOf([{ id: "com.x.app", version: "" }]), mode: "sideload" });
  assert.equal(unknown.installed, "");
  // The website and the jailbreak build queue nothing from here; a source-signed link has no job.
  assert.equal(await rowAppJob(p, null, { store: storeOf([]), mode: "site" }), null);
  assert.equal(await rowAppJob(p, null, { store: storeOf([]), mode: "jailbreak" }), null);
  assert.equal(await rowAppJob({ row: { id: "t" }, stanza: { package: "t" } }, null, { store: storeOf([]), mode: "sideload" }), null);
  const itms = await rowAppJob(appPkg([{ version: "1.0", downloadURL: "itms-services://?action=download-manifest&url=https://s/m.plist" }]), null,
    { store: storeOf([]), mode: "sideload" });
  assert.equal(itms.job, null);
});

test("F213: an app row's swipe and hold menu in the sideload build: Install, Upgrade, Cancel; none on the site", () => {
  const app = { id: "com.x.app", name: "App", version: "2.0", kind: "ipa", key: "alt:https://s/" };
  const job = { id: "com.x.app", name: "App", version: "2.0", url: "https://s/a2.ipa" };
  assert.deepEqual(rowSwipeAction(app, { apps: true, job, installed: null, newest: "2.0" }), { kind: "add", label: "Install", job });
  assert.deepEqual(rowSwipeAction(app, { apps: true, job, installed: "1.0", newest: "2.0" }), { kind: "add", label: "Upgrade", job });
  assert.deepEqual(rowSwipeAction(app, { apps: true, job, installed: "1.0", newest: "2.0", queued: true }), { kind: "cancel", label: "Cancel" });
  assert.deepEqual(rowSwipeAction(app, { apps: true, job: null, queued: true }), { kind: "cancel", label: "Cancel" });
  // Up to date, installed at an unknown version, or nothing to sign: no swipe (Reinstall stays on the app page).
  assert.equal(rowSwipeAction(app, { apps: true, job, installed: "2.0", newest: "2.0" }), null);
  assert.equal(rowSwipeAction(app, { apps: true, job, installed: "", newest: "2.0" }), null);
  assert.equal(rowSwipeAction(app, { apps: true, job: null, newest: "2.0" }), null);
  // The website (no queue at all): nothing; tweaks in the sideload build: nothing; the jailbreak build's apps: nothing.
  assert.equal(rowSwipeAction(app, { newest: "2.0" }), null);
  assert.equal(rowSwipeAction({ id: "com.t", name: "T", key: KEY }, { apps: true, job, newest: "1.0" }), null);
  assert.equal(rowSwipeAction(app, { queue: true, newest: "2.0" }), null);
  // The hold menu: the same item, then Share and Source.
  assert.deepEqual(rowMenuItems(app, { apps: true, job, newest: "2.0" }).map((i) => i.label), ["Install", "Share", "Source"]);
  assert.deepEqual(rowMenuItems(app, { apps: true, job, installed: "1.0", newest: "2.0" }).map((i) => i.label), ["Upgrade", "Share", "Source"]);
  assert.deepEqual(rowMenuItems(app, { apps: true, job, queued: true }).map((i) => i.label), ["Cancel", "Share", "Source"]);
  assert.deepEqual(rowMenuItems(app, { job, newest: "2.0" }).map((i) => i.label), ["Share", "Source"]);
  assert.deepEqual(rowMenuItems({ id: "com.t", key: KEY }, { apps: true, job, newest: "1.0" }).map((i) => i.label), ["Share", "Source"]);
  // The undo bar names an app's queued mode with the app queue's labels.
  assert.equal(swipeMessage({ kind: "cancel" }, "App", { mode: "resign" }, { resign: "Re-sign" }), "Re-sign App cancelled");
});

// F375: an upgrade is out: What's New in it is Details' first card (after Source Warning), the installed version on
// the right, the depiction's newest changelog entry once its JSON comes, else the fallback line.
import { upgradeNewsSlot, NO_RELEASE_NOTES } from "./browse.js";
import { fakeDocument } from "../nav/fakedom.test-helper.js";
import { readFileSync } from "node:fs";

const withDoc = async (fn) => {
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  try { await fn(); } finally { globalThis.document = saved; }
};
const changelog = { class: "DepictionTabView", tabs: [{ tabname: "Details", views: [] }, { tabname: "Changelog", class: "DepictionStackView",
  views: [{ class: "DepictionSubheaderView", title: "2.1" }, { class: "DepictionMarkdownView", markdown: "- Fixes a stutter" },
    { class: "DepictionSubheaderView", title: "2.0" }, { class: "DepictionMarkdownView", markdown: "- older" }] }] };

test("F375: installed older: What's New in the new version, Installed: old on the right, the notes swapped in", () => withDoc(async () => {
  const slot = upgradeNewsSlot({ version: "2.1" }, { version: "2.0" }, Promise.resolve(changelog));
  assert.ok(slot);
  const head = slot.querySelector(".store-whatsnew-head");
  assert.equal(head.firstElementChild.textContent, "What’s New in 2.1");
  assert.equal(slot.querySelector(".store-whatsnew-date").textContent, "Installed: 2.0");
  assert.equal(slot.querySelector(".store-whatsnew-text").textContent, NO_RELEASE_NOTES, "drawn at once with the fallback");
  assert.equal(await slot.ready, "- Fixes a stutter");
  assert.equal(slot.querySelector(".store-whatsnew-text").textContent, "- Fixes a stutter");
  assert.match(slot.textContent, /Installed: 2\.0/);
  assert.doesNotMatch(slot.textContent, /Version History/, "Installed Package has that row");
}));

test("F375: no notes (no Sileo depiction, no changelog tab, a failed fetch): the fallback line stays", () => withDoc(async () => {
  for (const json of [Promise.resolve(null), Promise.resolve({ class: "DepictionStackView", views: [] }), Promise.reject(new Error("x"))]) {
    const slot = upgradeNewsSlot({ version: "1:3.0" }, { version: "2.9" }, json);
    assert.equal(await slot.ready, null);
    assert.equal(slot.querySelector(".store-whatsnew-text").textContent, NO_RELEASE_NOTES);
    assert.equal(slot.querySelector(".store-whatsnew-date").textContent, "Installed: 2.9");
  }
}));

test("F375: same version, newer installed or not installed: no card", () => withDoc(async () => {
  assert.equal(upgradeNewsSlot({ version: "2.0" }, { version: "2.0" }, Promise.resolve(changelog)), null);
  assert.equal(upgradeNewsSlot({ version: "2.0" }, { version: "2.1" }), null);
  assert.equal(upgradeNewsSlot({ version: "2.0" }, null), null);
  assert.equal(upgradeNewsSlot({ version: "2.0" }, { version: "" }), null);
}));

test("F375 wiring: the card goes right after Source Warning, before every other Details group", () => {
  const src = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  const at = (s) => { const i = src.indexOf(s); assert.ok(i > 0, s); return i; };
  const piracy = at("if (piracy) details.append(piracy);");
  const news = at("details.append(upgradeNews)");
  assert.ok(piracy < news && news < at("if (plan.options.length) details.append("));
  assert.ok(src.includes("upgradeNewsSlot(st, inst, sileoJson)"), "the Sileo JSON the page already fetched");
});

test("B365: an HTML depiction never opens as a white sheet: live, its own HTML with scripts off, or Open in Safari", async () => {
  const { depictionView, framingRefused, corsScripts, visibleText, openHtmlDepiction } = await import("./browse.js");
  const SITE = "https://ifizbox.com", APP = "ifizbox://app";
  const text = "<p>Aerial: Stage Manager, redesigned for iOS. Works on iOS 15 to 26.</p>";
  // Havoc's Next.js page: module scripts need CORS, which origin null never gets, so its server HTML shows instead
  const next = `<html><head><script type="module" defer src="/_next/static/chunks/a.js" crossorigin></script></head><body>${text}</body></html>`;
  assert.equal(depictionView({ html: next, origin: APP }), "static");
  assert.equal(depictionView({ html: `<script src="/a.js" crossorigin="anonymous"></script>${text}`, origin: SITE }), "static");
  // ...but an empty app shell has nothing to show without its scripts, so it loads live
  assert.equal(depictionView({ html: '<div id="root"></div><script type="module" src="/main.js"></script>' }), "live");
  // jQuery-era depictions run from their own URL (they read location)
  assert.equal(depictionView({ html: `<script src="https://code.jquery.com/jquery.min.js"></script>${text}` }), "live");
  assert.equal(depictionView({ html: text, mixed: true }), "static", "http on the https site: through the proxy");
  // hosts that refuse framing: Open in Safari
  const h = (o) => new Headers(o);
  assert.equal(depictionView({ html: text, headers: h({ "X-Frame-Options": "deny" }), origin: APP }), "refused");
  assert.equal(framingRefused(h({ "X-Frame-Options": "SAMEORIGIN" }), SITE), true);
  assert.equal(framingRefused(h({ "X-Frame-Options": "ALLOWALL" }), SITE), false);
  assert.equal(framingRefused(h({}), SITE), false);
  assert.equal(framingRefused(null, SITE), false);
  assert.equal(framingRefused({ "x-frame-options": "deny" }, SITE), true, "a plain header object");
  const fa = (v) => h({ "Content-Security-Policy": `default-src 'self'; frame-ancestors ${v}` });
  assert.equal(framingRefused(fa("cydia.saurik.com"), APP), true, "Chariz");
  assert.equal(framingRefused(fa("'none'"), SITE), true);
  assert.equal(framingRefused(fa("'self'"), SITE), true);
  assert.equal(framingRefused(fa("*"), APP), false);
  assert.equal(framingRefused(fa("https:"), SITE), false);
  assert.equal(framingRefused(fa("https:"), APP), true);
  assert.equal(framingRefused(fa("ifizbox:"), APP), false);
  assert.equal(framingRefused(fa("*.ifizbox.com"), "https://www.ifizbox.com"), false);
  assert.equal(framingRefused(fa("*.ifizbox.com"), SITE), true, "CSP: *.host leaves the bare host out");
  assert.equal(framingRefused(fa("https://ifizbox.com"), SITE), false);
  assert.equal(framingRefused(fa("http://ifizbox.com"), SITE), true);
  // frame-ancestors wins over X-Frame-Options when both are there
  assert.equal(framingRefused(h({ "X-Frame-Options": "deny", "Content-Security-Policy": "frame-ancestors *" }), SITE), false);
  assert.equal(framingRefused(h({ "Content-Security-Policy": "default-src 'none'; sandbox" }), SITE), false, "the proxy's own CSP");
  assert.equal(corsScripts('<script src="/a.js"></script>'), false);
  assert.equal(corsScripts('<script type="module">import "./a.js"</script>'), false, "inline: no src");
  assert.equal(visibleText(`<head><title>T</title></head><body><script>var a = "hidden";</script><style>p{}</style>${text}</body>`),
    "Aerial: Stage Manager, redesigned for iOS. Works on iOS 15 to 26.");
  assert.equal(corsScripts('<script src="/a.js" data-x="crossorigin-ish"></script>'), false, "a word inside another value");
  assert.equal(framingRefused(h({ "Content-Security-Policy": "frame-ancestors *, frame-ancestors 'self'" }), SITE), true,
    "every policy has to let us in");

  // The sheet, drawn on the fake DOM: each view, and the bridge rule (never allow-same-origin).
  const { fakeDocument } = await import("../nav/fakedom.test-helper.js");
  const URL_ = "https://havoc.app/depiction/aerial";
  const open = async (fetch) => {
    const saved = globalThis.document;
    const doc = fakeDocument();
    globalThis.document = doc;
    const opened = [];
    try {
      openHtmlDepiction(URL_, "Aerial", { backend: { kind: "native", fetch }, open: (u) => opened.push(u) });
      assert.match(doc.body.textContent, /Loading Depiction/);
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
      return { doc, frame: doc.querySelector("iframe"), text: doc.body.textContent, opened };
    } finally { globalThis.document = saved; }
  };
  const refused = await open(async () => new Response(text, { headers: { "X-Frame-Options": "deny" } }));
  assert.equal(refused.frame, null, "no white frame");
  assert.match(refused.text, /havoc\.app doesn't let its depiction open inside .+\./);
  assert.match(refused.text, /Open in Safari/);
  const failed = await open(async () => { throw new Error("the repo answered HTTP 404"); });
  assert.equal(failed.frame, null);
  assert.match(failed.text, /the repo answered HTTP 404/);
  assert.match(failed.text, /Open in Safari/);
  const stat = await open(async () => new Response(next));
  assert.ok(stat.frame.srcdoc.includes(text) && stat.frame.srcdoc.includes(`<base href="${URL_}"`), "Havoc's own HTML");
  assert.equal(stat.frame.getAttribute("sandbox"), "allow-popups allow-popups-to-escape-sandbox", "scripts off");
  const live = await open(async () => new Response(text));
  assert.equal(live.frame.src, URL_);
  assert.match(live.frame.getAttribute("sandbox"), /allow-scripts/);
  for (const f of [stat.frame, live.frame]) assert.doesNotMatch(f.getAttribute("sandbox"), /allow-same-origin/);
});
