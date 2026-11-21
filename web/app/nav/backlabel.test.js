// A package page opened by its id learns its name later (screens/browse.js setTitle): the page pushed above it
// (Version History) shows that name on its back button, not the id, and so does every page pushed after.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

globalThis.document = fakeDocument();
const { pageHandle } = await import("./go.js");
const { backFollowsTitle } = await import("./backlabel.js");

// One tab's nav stack, with pages drawn as app.js makePage/navParts draws them.
const stack = document.createElement("div");
document.body.append(stack);

function push(info, below = null) {
  const item = document.createElement("div");
  item.className = "nav-item";
  stack.append(item);
  const entry = { item, title: info.title, back: info.back ?? info.title, handle: pageHandle(item) };
  backFollowsTitle(entry);
  const left = document.createElement("div");
  left.className = "nav-left";
  if (below) {
    const b = document.createElement("button");
    b.className = "bar-button back";
    b.textContent = below.back;
    b.setAttribute("aria-label", "Back to " + below.back);
    left.append(b);
  }
  const h1 = document.createElement("h1");
  h1.className = "nav-title";
  h1.textContent = info.title;
  item.append(left, h1);
  return entry;
}
const backOf = (entry) => entry.item.querySelector(".bar-button.back");

test("a package page named after it opened: Version History above it reads the name, not the id", () => {
  stack.replaceChildren();
  const search = push({ title: "Search" });
  const pkg = push({ title: "com.google.ios.youtube" }, search);
  const versions = push({ title: "Version History" }, pkg);
  assert.equal(backOf(versions).textContent, "com.google.ios.youtube");

  pkg.handle.setTitle("YouTube");
  assert.equal(pkg.item.querySelector(".nav-title").textContent, "YouTube");
  assert.equal(backOf(versions).textContent, "YouTube");
  assert.equal(backOf(versions).getAttribute("aria-label"), "Back to YouTube");
  assert.equal(backOf(pkg).textContent, "Search", "the page's own back button is not touched");

  // A page pushed afterwards takes the new label from entry.back.
  versions.item.remove();
  const again = push({ title: "Version History" }, pkg);
  assert.equal(backOf(again).textContent, "YouTube");
});

test("named before anything is pushed: the next page's back reads the name", () => {
  stack.replaceChildren();
  const pkg = push({ title: "com.example.tweak" });
  pkg.handle.setTitle("Tweak");
  assert.equal(pkg.back, "Tweak");
  assert.equal(backOf(push({ title: "Details" }, pkg)).textContent, "Tweak");
});

test("a back label the screen gave of its own stays", () => {
  stack.replaceChildren();
  const page = push({ title: "com.example.app", back: "Back" });
  const above = push({ title: "Version History" }, page);
  page.handle.setTitle("Example");
  assert.equal(page.back, "Back");
  assert.equal(backOf(above).textContent, "Back");
});

test("a title set twice follows each time (Section Visibility and back)", () => {
  stack.replaceChildren();
  const home = push({ title: "Home" });
  home.handle.setTitle("Section Visibility");
  home.handle.setTitle("Home");
  assert.equal(home.back, "Home");
  assert.equal(backOf(push({ title: "Settings" }, home)).textContent, "Home");
});
