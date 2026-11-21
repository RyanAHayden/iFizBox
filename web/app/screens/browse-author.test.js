// The author page (#/search/author:<name>) draws: the Hide by Author group first, then the author's packages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument, fakePage, memStorage, tick } from "../fakes.test-helper.js";

globalThis.localStorage = memStorage({ "ifizbox.device": "iphoneos-arm64" });
globalThis.document = fakeDocument();
globalThis.CSS ??= { escape: (s) => String(s) };
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
globalThis.fetch = async () => { throw new Error("offline"); };
delete globalThis.ifizboxNative;
const browse = await import("./browse.js");
const { catalog } = await import("../catalog.js");

const rows = [
  { id: "com.jane.one", name: "One", short: "First", version: "1.0", section: "Tweaks", icon: null, key: "k", author: "Jane" },
  { id: "com.jane.two", name: "Two", short: "Second", version: "1.0", section: "Tweaks", icon: null, key: "k", author: "Jane" },
];

async function draw(name, found) {
  const was = { ensure: catalog.ensure, author: catalog.author };
  catalog.ensure = async () => {};
  catalog.author = async (n) => (n === name ? found : []);
  try {
    const page = fakePage();
    const route = { tab: "search", path: [`author:${name}`] };
    await browse.render(page, route, { go() {}, setBadge() {}, setTitle() {}, showHUD: () => () => {} });
    for (let i = 0; i < 5; i++) await tick();
    return page;
  } finally {
    Object.assign(catalog, was);
  }
}

test("an author page draws its Hide by Author group (marked author-hide) above the package list", async () => {
  const page = await draw("Jane", rows);
  const group = page.querySelector(".group.author-hide");
  assert.ok(group, "the Hide by Author group is drawn, the class on the .group element (not the fragment)");
  assert.equal(group.querySelector(".cell-label").textContent, "Hide Packages by Jane");
  const list = page.querySelector(".pkg-vlist");
  assert.ok(list, "the package list follows");
  const at = (n) => page.children.indexOf(n);
  assert.ok(at(group) >= 0 && at(list) > at(group), "both straight on the page, the group first");
});

test("an author with no packages still gets the group, then No packages.", async () => {
  const page = await draw("Nobody", []);
  assert.ok(page.querySelector(".group.author-hide"));
  assert.match(page.textContent, /No packages\./);
});
