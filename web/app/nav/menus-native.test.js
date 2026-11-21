// F345c: showActionSheet and showMenu go through the shell's ui.actionSheet (UIAlertController .actionSheet) and
// ui.menu (a UIMenu at the anchor's rect, native/Sources/NativeMenus.swift) only in the app under the native controls
// hook; a shell without them, the site and every other style get the CSS sheet and callout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { showActionSheet, wantsNativeControls, tapRect, watchTaps } from "./actionsheet.js";
import { showMenu, copyText } from "./menu.js";
import { fakeDocument, tick } from "./fakedom.test-helper.js";

async function withPage({ controls = "native", native = null }, fn) {
  const document = fakeDocument();
  if (controls) document.documentElement.setAttribute("data-controls", controls);
  const saved = { document: globalThis.document, native: globalThis.ifizboxNative };
  globalThis.document = document;
  if (native) globalThis.ifizboxNative = native; else delete globalThis.ifizboxNative;
  try {
    return await fn(document);
  } finally {
    globalThis.document = saved.document;
    if (saved.native === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved.native;
  }
}

const shell = (methods) => {
  const calls = [];
  return { calls, call: async (m, p) => { calls.push([m, p]); if (!methods[m]) throw new Error(`unknown method ${m}`); return methods[m](p); } };
};

const placed = (el, r = { left: 10.4, top: 300, width: 320, height: 44 }) =>
  Object.assign(el, { getBoundingClientRect: () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height }) });

test("F345c: under the native hook, showActionSheet sends ui.actionSheet with the anchor's rect and answers its index", async () => {
  const native = shell({ "ui.actionSheet": () => ({ index: 1 }) });
  await withPage({ native }, async (document) => {
    const anchor = placed(document.createElement("button"));
    document.body.append(anchor);
    const i = await showActionSheet({ title: "Modify", buttons: ["Reinstall", "Remove"], destructive: [1, 7], anchor });
    assert.equal(i, 1);
    assert.deepEqual(native.calls, [["ui.actionSheet", {
      title: "Modify", buttons: ["Reinstall", "Remove"], cancel: "Cancel", destructive: [1], // only real buttons
      rect: { x: 10, y: 300, width: 320, height: 44 },
    }]]);
    assert.equal(document.body.querySelector(".action-scrim"), null, "no CSS sheet drawn");
  });
});

test("F345c: Cancel, an answer out of range and no cancel button", async () => {
  const native = shell({ "ui.actionSheet": (p) => ({ index: p.buttons.length ? 9 : -1 }) });
  await withPage({ native }, async () => {
    assert.equal(await showActionSheet({ buttons: ["One"] }), -1);
    assert.equal(await showActionSheet({ buttons: [], cancel: "" }), -1);
    assert.equal(native.calls[1][1].cancel, "");
    assert.equal("rect" in native.calls[0][1], false, "no tap seen, no rect: the shell points at the bottom");
  });
});

test("F345c: with no anchor the rect is the button the last touch went down on", async () => {
  await withPage({}, async (document) => {
    const listeners = {};
    document.addEventListener = (t, f) => { listeners[t] = f; };
    watchTaps(document);
    const row = placed(document.createElement("button"), { left: 0, top: 100, width: 200, height: 44 });
    const label = document.createElement("span");
    row.append(label);
    document.body.append(row);
    listeners.pointerdown({ target: label });
    assert.deepEqual(tapRect(), { x: 0, y: 100, width: 200, height: 44 });
    row.remove();
    assert.equal(tapRect(), null, "an element gone from the page has no rect");
  });
});

test("F345c: the site, other styles and old shells keep the CSS sheet", async () => {
  const native = shell({});
  assert.equal(wantsNativeControls(native, { documentElement: { getAttribute: () => null } }), false, "no native hook");
  assert.equal(wantsNativeControls(undefined, { documentElement: { getAttribute: () => "native" } }), false, "the site");
  assert.equal(wantsNativeControls(native, { documentElement: { getAttribute: () => "native" } }), true);
  for (const [name, page] of [["no hook", { native, controls: null }], ["the site", { native: null }], ["old shell", { native }]]) {
    await withPage(page, async (document) => {
      showActionSheet({ buttons: ["One"] });
      await tick();
      assert.ok(document.body.querySelector(".action-scrim"), `${name}: CSS sheet drawn`);
    });
  }
});

test("F345c: under the native hook, showMenu sends ui.menu at the anchor and runs the chosen item", async () => {
  let answer;
  const native = shell({ "ui.menu": () => new Promise((r) => { answer = r; }) });
  await withPage({ native }, async (document) => {
    const li = placed(document.createElement("li"));
    document.body.append(li);
    const ran = [];
    showMenu(li, [{ label: "Copy URL", onClick: () => ran.push("copy") }, { label: "Trust Source", onClick: () => ran.push("trust") }], { x: 99.6 });
    assert.deepEqual(native.calls, [["ui.menu", { items: ["Copy URL", "Trust Source"], rect: { x: 10, y: 300, width: 320, height: 44 }, x: 100 }]]);
    assert.ok(li.classList.contains("is-held"), "held look while the menu is up");
    assert.equal(document.body.querySelector(".menu"), null, "no CSS callout");
    answer({ index: 1 });
    await tick();
    assert.deepEqual(ran, ["trust"]);
    assert.equal(li.classList.contains("is-held"), false);
  });
});

test("F345c: a menu put away (-1) or closed by the page runs nothing", async () => {
  const answers = [];
  const native = shell({ "ui.menu": () => new Promise((r) => answers.push(r)) });
  await withPage({ native }, async (document) => {
    const li = placed(document.createElement("li"));
    document.body.append(li);
    const ran = [];
    showMenu(li, [{ label: "Copy", onClick: () => ran.push(1) }]);
    answers[0]({ index: -1 });
    const close = showMenu(li, [{ label: "Copy", onClick: () => ran.push(2) }]);
    close();
    answers[1]({ index: 0 });
    await tick();
    assert.deepEqual(ran, []);
  });
});

test("F345c: a shell without ui.menu (or no menu shown) falls back to the CSS callout", async () => {
  const native = shell({});
  globalThis.innerWidth ??= 390;
  await withPage({ native }, async (document) => {
    const li = placed(document.createElement("li"));
    document.body.append(li);
    showMenu(li, [{ label: "Copy", onClick: () => {} }]);
    await tick();
    assert.ok(document.body.querySelector(".menu"), "CSS callout drawn after the refusal");
    await new Promise((r) => setTimeout(r, 0)); // its outside-tap listeners go on next turn, on this document
  });
});

test("F345c: copyText falls back to the shell's clipboard.write when WebKit refuses the write", async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw new Error("NotAllowedError"); } } } });
  try {
    const native = shell({ "clipboard.write": () => null });
    await copyText("https://repo.test/", native);
    assert.deepEqual(native.calls, [["clipboard.write", { text: "https://repo.test/" }]]);
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved); else delete globalThis.navigator;
  }
});

test("F345c: the shell's handlers: an .actionSheet with its popover at the rect, a UIMenu by performPrimaryAction then the edit menu", () => {
  const swift = readFileSync(new URL("../../../native/Sources/NativeMenus.swift", import.meta.url), "utf8");
  assert.match(swift, /b\.on\("ui\.actionSheet"\)/);
  assert.match(swift, /b\.on\("ui\.menu"\)/);
  assert.match(swift, /preferredStyle: \.actionSheet/);
  assert.match(swift, /pop\.sourceRect = rect\(p\["rect"\]\)/);
  assert.match(swift, /showsMenuAsPrimaryAction = true/);
  assert.match(swift, /performPrimaryAction\(\)/);
  assert.match(swift, /presentEditMenu/);
  const bridge = readFileSync(new URL("../../../native/Sources/Bridge.swift", import.meta.url), "utf8");
  assert.match(bridge, /NativeMenus\.register\(self\)/);
  assert.match(bridge, /on\("clipboard\.write"\)/);
});
