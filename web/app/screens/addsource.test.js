// Sources' Add in the app (screens/sources.js addFromClipboard with a native bridge): Enter APT URL opens at once,
// inside the tap (F105). B171: Add never reads the clipboard (no iOS Allow Paste): it asks clipboard.peek whether a
// URL was copied and shows the alert's Paste button only then; the read happens when Paste is tapped (nav/alert.js).
// Never the website's navigator.clipboard, never the blue Type state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addFromClipboard, addSourceNow, nav } from "./sources.js";
import { addSource as manageAddSource } from "./manage.js";
import { showAlert } from "../nav/alert.js";
import { nativeHasUrl } from "../nav/menu.js";

function fakeButton() {
  const parent = { removed: 0, insertBefore() {} };
  const classes = new Set(["is-pressed", "done"]);
  return {
    textContent: "Type", parentNode: parent, nextSibling: null, isConnected: true,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    remove() { parent.removed++; },
  };
}

// A bridge answering clipboard.peek with `answer` (a function, so it can throw), and an `open` that builds the
// alert's field and Paste button the way showAlert does, synchronously, before its first await.
async function run(answer) {
  const field = { value: "", isConnected: true, addEventListener() {} };
  const attrs = {};
  const paste = { style: {}, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
  const saved = { document: globalThis.document, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator") };
  let readText = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { readText: async () => { readText++; return "https://web.test/"; } } } });
  let opened = 0;
  globalThis.document = { querySelectorAll: (sel) => (!opened ? [] : sel === ".alert-field" ? [field] : sel === ".alert-paste" ? [paste] : []) };
  const calls = [];
  let hiddenDuringPeek = null;
  const native = {
    call: async (method, params) => {
      calls.push([method, params]);
      hiddenDuringPeek = paste.style.opacity === "0" && paste.style.pointerEvents === "none" && attrs["aria-hidden"] === "true";
      return answer();
    },
  };
  const button = fakeButton();
  let openedBeforePeek = null;
  const open = (ctx, prefill) => { opened++; openedBeforePeek = calls.length === 0; assert.equal(prefill, null); field.value = "https://"; return Promise.resolve("shown"); };
  try {
    const r = await addFromClipboard({}, button, { native, open });
    const shown = paste.style.opacity === "" && paste.style.pointerEvents === "" && !("aria-hidden" in attrs);
    return { r, field, calls, readText, opened, openedBeforePeek, hiddenDuringPeek, shown, button };
  } finally {
    globalThis.document = saved.document;
    if (saved.navigator) Object.defineProperty(globalThis, "navigator", saved.navigator);
  }
}

test("B171: a copied URL: the alert opens first (inside the tap), Paste shows, nothing is read", async () => {
  const { r, field, calls, readText, opened, openedBeforePeek, hiddenDuringPeek, shown, button } = await run(() => ({ url: true }));
  assert.equal(r, "shown");
  assert.equal(opened, 1);
  assert.equal(openedBeforePeek, true, "the alert opens before the bridge round trip");
  assert.deepEqual(calls, [["clipboard.peek", {}]], "only the no-prompt peek: no clipboard.read on Add");
  assert.equal(hiddenDuringPeek, true, "Paste waits, hidden, while the peek is out");
  assert.equal(shown, true, "then Paste is offered");
  assert.equal(field.value, "https://", "the field isn't filled until Paste is tapped");
  assert.equal(readText, 0, "no navigator.clipboard: no WebKit Paste bubble");
  assert.equal(button.textContent, "Add");
  assert.equal(button.classList.contains("done"), false, "no blue Type left over");
  assert.equal(button.classList.contains("is-pressed"), false, "not left pressed");
  assert.equal(button.parentNode.removed, 1, "re-inserted to leave WebKit's :active chain");
});

test("B171: no URL copied: no Paste offered, the field stays https:// to type in", async () => {
  const none = await run(() => ({ url: false }));
  assert.equal(none.shown, false);
  assert.equal(none.field.value, "https://");
  assert.equal(none.opened, 1);
  assert.deepEqual(none.calls.map((c) => c[0]), ["clipboard.peek"]);
});

test("B171: a shell without clipboard.peek (or an odd answer) keeps Paste, and still reads nothing", async () => {
  for (const answer of [() => { throw new Error("unknown method clipboard.peek"); }, () => null, () => "https://x.test/"]) {
    const r = await run(answer);
    assert.equal(r.shown, true);
    assert.equal(r.field.value, "https://");
    assert.equal(r.readText, 0);
    assert.deepEqual(r.calls.map((c) => c[0]), ["clipboard.peek"]);
  }
});

test("B171: nativeHasUrl: true/false from the shell, null on the website or an older shell", async () => {
  assert.equal(await nativeHasUrl({ call: async (m) => (m === "clipboard.peek" ? { url: true } : null) }), true);
  assert.equal(await nativeHasUrl({ call: async () => ({ url: false }) }), false);
  assert.equal(await nativeHasUrl({ call: async () => { throw new Error("unknown method"); } }), null);
  assert.equal(await nativeHasUrl({ call: async () => "" }), null);
  assert.equal(await nativeHasUrl(undefined), null);
});

test("Sources' Add has no Type switch anywhere; the website's opens the alert and reads no clipboard", async () => {
  const add = (n) => n.right.find((b) => b.label === "Add");
  const saved = globalThis.ifizboxNative;
  try {
    delete globalThis.ifizboxNative;
    assert.equal(add(nav({ path: [] }, {})).onPress, undefined, "website: no Type switch");
    globalThis.ifizboxNative = { call: async () => "" };
    assert.equal(add(nav({ path: [] }, {})).onPress, undefined, "app: no Type switch");
  } finally { if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved; }
  const nav0 = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let reads = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { readText: async () => { reads++; return ""; } } } });
  try {
    const button = fakeButton();
    let opened = null;
    const r = await addFromClipboard({}, button, { native: null, open: (ctx, prefill) => { opened = prefill; return "shown"; } });
    assert.equal(r, "shown");
    assert.equal(opened, null);
    assert.equal(reads, 0, "Paste in the alert reads, not Add");
  } finally { if (nav0) Object.defineProperty(globalThis, "navigator", nav0); }
});

// B335: Sources' Add: Paste with a URL copied adds it at once, as if Add Source were tapped. Manage's Add (the same
// alert without the opt-in) keeps Paste filling the field only, and a copy with no URL in it leaves the alert as it was.
async function pasteInAdd(clipboard, open) {
  const { fakeDocument } = await import("../nav/fakedom.test-helper.js");
  const document = fakeDocument();
  const all = [];
  const make = document.createElement;
  document.createElement = (tag) => { const e = make(tag); all.push(e); return e; };
  const saved = { document: globalThis.document, native: globalThis.ifizboxNative,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator") };
  globalThis.document = document;
  delete globalThis.ifizboxNative;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { readText: async () => clipboard } } });
  let answer = null;
  // The real showAlert with the screen's options; its answer is kept, and the flow stops there (Cancel).
  const alert = (opts) => showAlert(opts).then((r) => { answer = r; return { index: 0, value: "" }; });
  try {
    const done = open(alert);
    const paste = all.find((e) => e.className === "alert-paste");
    const field = all.find((e) => e.className === "alert-field");
    await paste.listeners.click[0]();
    await new Promise((r) => setTimeout(r, 0));
    if (answer) await done;
    return { answer, field: field.value };
  } finally {
    globalThis.document = saved.document;
    if (saved.native === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved.native;
    if (saved.navigator) Object.defineProperty(globalThis, "navigator", saved.navigator); else delete globalThis.navigator;
  }
}

test("B335: Paste with a copied URL resolves Sources' Add alert as Add Source with that URL", async () => {
  const r = await pasteInAdd(" repo.example.test/apt ", (alert) => addFromClipboard({}, fakeButton(),
    { native: null, open: (ctx, prefill) => addSourceNow(ctx, prefill, alert) }));
  assert.deepEqual(r.answer, { index: 1, value: "https://repo.example.test/apt" });
});

test("B335: nothing usable copied: the field stays as it was and the alert stays up", async () => {
  const r = await pasteInAdd("no link here", (alert) => addSourceNow({}, null, alert));
  assert.equal(r.answer, null);
  assert.equal(r.field, "https://");
});

test("B335: Manage's Add (no opt-in) still only fills the field on Paste", async () => {
  const r = await pasteInAdd("https://repo.example.test/", (alert) => manageAddSource({}, null, null, { alert }));
  assert.equal(r.answer, null);
  assert.equal(r.field, "https://repo.example.test/");
});
