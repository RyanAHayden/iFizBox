// F77: My IPAs' routes (screens/myipas.js) and the link another app's .ipa opens (incoming.js).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pageOf, nav } from "./myipas.js";
import { myIpasPath, handleIncoming } from "../incoming.js";

const r = (...path) => ({ tab: "installed", path });
const saved = globalThis.ifizboxNative;
afterEach(() => { if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved; });

test("My IPAs' pages", () => {
  globalThis.ifizboxNative = { mode: "sideload", call: async () => null };
  assert.equal(pageOf(r()), null);
  assert.equal(pageOf(r("package:x")), null);
  assert.deepEqual(pageOf(r("myipas")), { page: "list" });
  assert.deepEqual(pageOf(r("myipas", "ipa:A b.ipa")), { page: "ipa", file: "A b.ipa" });
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa", "options")), { page: "options", file: "A.ipa" });
  assert.deepEqual(pageOf(r("myipas", "junk")), { page: "missing" });
  assert.equal(nav(r("myipas")).right.label, "Manage"); // F224: Manage only; Add is the page's own group
  assert.equal(nav(r("myipas", "ipa:A b.ipa")).title, "Details"); // B361: the app page's Details, for a file
  assert.equal(nav(r("myipas", "ipa:A b.ipa")).right.label, "Install");
  assert.equal(nav(r("myipas", "ipa:A.ipa", "options")).title, "Sign Options");
  // B361: its Add Tweaks page and the tweak pages it opens are browse.js's, as under an app's page
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa", "addtweaks:com.x.a")), { page: "browse" });
  assert.equal(nav(r("myipas", "ipa:A.ipa", "addtweaks:com.x.a")).title, "Add Tweaks");
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa", "addtweaks:com.x.a", "package:com.t.yt@k1")), { page: "browse" });
  assert.equal(nav(r("myipas", "ipa:A.ipa", "addtweaks:com.x.a", "package:com.t.yt@k1")).title, "Details");
});

test("the website has no Sign Options page (the Signing Server signs as the IPA is)", () => {
  delete globalThis.ifizboxNative;
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa", "options")), { page: "missing" });
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa")), { page: "ipa", file: "A.ipa" });
});

test("an .ipa another app sent opens its page in My IPAs", async () => {
  assert.deepEqual(myIpasPath("ifizbox://myipas?file=My%20App.ipa"), ["myipas", "ipa:My App.ipa"]);
  assert.deepEqual(myIpasPath("ifizbox://myipas?file=..%2Fx.ipa"), ["myipas"]);
  assert.deepEqual(myIpasPath("ifizbox://myipas?file=notes.txt"), ["myipas"]);
  assert.deepEqual(myIpasPath("ifizbox://myipas"), ["myipas"]);
  assert.equal(await handleIncoming("ifizbox://myipas?file=A.ipa"), "myipas");
});

// F79: My IPAs became Install IPAs. F224: only the user's IPAs on the page; F79's Browse pages stay for older links.
test("Install IPAs: the page's title, Manage, and the older Browse pages below it", async () => {
  const { PAGE_TITLE } = await import("./myipas.js");
  globalThis.ifizboxNative = { mode: "sideload", call: async () => null };
  assert.equal(PAGE_TITLE, "Install IPAs");
  assert.equal(nav(r("myipas")).title, "Install IPAs");
  assert.equal(nav(r("myipas")).right.label, "Manage");
  assert.deepEqual(pageOf(r("myipas", "search")), { page: "search" });
  assert.deepEqual(pageOf(r("myipas", "apps")), { page: "apps" });
  assert.deepEqual(pageOf(r("myipas", "category:Games")), { page: "category", value: "Games" });
  assert.deepEqual(pageOf(r("myipas", "category:Games", "package:com.a")), { page: "browse" });
  assert.deepEqual(pageOf(r("myipas", "search", "package:com.a")), { page: "browse" });
  assert.equal(nav(r("myipas", "search")).title, "Search Apps");
  assert.equal(nav(r("myipas", "apps")).title, "All Apps");
  assert.equal(nav(r("myipas", "category:Photo & Video")).title, "Photo & Video");
  assert.equal(nav(r("myipas", "apps", "package:com.a")).right.label, "Install"); // browse.js's app page
  // an IPA's own pages are unchanged
  assert.deepEqual(pageOf(r("myipas", "ipa:A.ipa")), { page: "ipa", file: "A.ipa" });
  // the website has the same Browse
  delete globalThis.ifizboxNative;
  assert.equal(nav(r("myipas")).title, "Install IPAs");
  assert.deepEqual(pageOf(r("myipas", "search")), { page: "search" });
});

test("F224: no Browse on the page; Add an IPA has Files and a download (the website's Choose File)", async () => {
  const mod = await import("./myipas.js");
  assert.equal(mod.browseGroups, undefined);
  assert.deepEqual(mod.appsOf([{ id: "a", kind: "ipa" }, { id: "d" }]).map((x) => x.id), ["a"]); // the older pages' filter
  const [app] = mod.addGroups(false);
  assert.equal(app.header, "Add an IPA");
  assert.deepEqual(app.rows.map((x) => x.label), ["Choose from Files", "Download from URL"]);
  assert.deepEqual(mod.addGroups(true)[0].rows.map((x) => x.label), ["Choose File", "Download from URL"]);
  assert.match(mod.libraryFooterText(false), /share an \.ipa to iFizBox from Files, Safari or Mail/);
  assert.match(mod.libraryEmptyText(false), /On My iPhone > iFizBox/);
  assert.doesNotMatch(mod.libraryEmptyText(true), /AltStore|SideStore|Feather/);
});

test("Install IPAs: a list's search bar matches name, description, developer or ID", async () => {
  const { matchApp } = await import("./myipas.js");
  const r = { id: "com.x.delta", name: "Delta", short: "Game emulator", author: "Riley" };
  assert.ok(matchApp(r, "delt") && matchApp(r, "EMUL") && matchApp(r, "riley") && matchApp(r, "com.x"));
  assert.equal(matchApp(r, "utm"), false);
});
