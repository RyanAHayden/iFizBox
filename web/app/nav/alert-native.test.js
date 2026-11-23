// F345b: showAlert goes through the shell's ui.alert (a UIAlertController, native/Sources/NativeAlerts.swift) only in
// the app under the iOS 26 style; countdown alerts, a shell without ui.alert, the site and every other style
// get the CSS alert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { showAlert, wantsNativeAlert } from "./alert.js";
import { fakeDocument } from "./fakedom.test-helper.js";

// Runs fn with a fake document (data-controls as given) and the bridge (or none); returns what fn returned plus the
// elements the CSS alert made.
async function withPage({ controls = "ios26", native = null }, fn) {
  const document = fakeDocument();
  const made = [];
  const make = document.createElement;
  document.createElement = (tag) => { const e = make(tag); made.push(e); return e; };
  if (controls) document.documentElement.setAttribute("data-style", controls);
  const saved = { document: globalThis.document, native: globalThis.ifizboxNative };
  globalThis.document = document;
  if (native) globalThis.ifizboxNative = native; else delete globalThis.ifizboxNative;
  try {
    return { out: await fn(), made };
  } finally {
    globalThis.document = saved.document;
    if (saved.native === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved.native;
  }
}

const shell = (answer) => {
  const calls = [];
  return { calls, call: async (m, p) => { calls.push([m, p]); if (m !== "ui.alert") throw new Error(`unknown method ${m}`); return answer(p); } };
};

test("F345b: in the app under the native hook, showAlert sends ui.alert and resolves {index, value} from its answer", async () => {
  const native = shell(() => ({ index: 1, value: "https://repo.test/" }));
  const { out, made } = await withPage({ native }, () => showAlert({
    title: "Enter APT URL", message: "Type it", input: { placeholder: "https://", value: "https://", type: "url", paste: (t) => t },
    buttons: ["Cancel", "Add Source"], cancel: 0, colors: { 1: "green", 0: "red", 5: "red", 2: "blue" },
  }));
  assert.deepEqual(out, { index: 1, value: "https://repo.test/" });
  assert.deepEqual(native.calls, [["ui.alert", {
    title: "Enter APT URL", message: "Type it", buttons: ["Cancel", "Add Source"], cancel: 0,
    colors: { 0: "red", 1: "green" }, // only known colours on real buttons
    input: { placeholder: "https://", value: "https://", type: "url" }, // paste is dropped
  }]]);
  assert.equal(made.length, 0, "no CSS alert drawn");
});

test("F345b: one button has no cancel action; no input sends none and resolves value undefined", async () => {
  const native = shell(() => ({ index: 0 }));
  const { out } = await withPage({ native }, () => showAlert({ title: "Done", message: "Saved." }));
  assert.deepEqual(out, { index: 0, value: undefined });
  const [[, p]] = native.calls;
  assert.equal(p.cancel, -1);
  assert.deepEqual(p.buttons, ["OK"]);
  assert.equal("input" in p, false);
});

test("F345b: an answer out of range counts as the cancel button", async () => {
  const native = shell(() => ({ index: 9 }));
  const { out } = await withPage({ native }, () => showAlert({ title: "Remove?", buttons: ["Cancel", "Remove"], cancel: 0 }));
  assert.equal(out.index, 0);
});

test("F345b: countdown alerts, the site, other styles and old shells keep the CSS alert", async () => {
  const native = shell(() => ({ index: 0 }));
  assert.equal(wantsNativeAlert({ countdown: { button: 1, seconds: 5 } }, native, { documentElement: { getAttribute: () => "ios26" } }), false);
  assert.equal(wantsNativeAlert({}, native, { documentElement: { getAttribute: () => null } }), false, "no native hook");
  assert.equal(wantsNativeAlert({}, undefined, { documentElement: { getAttribute: () => "ios26" } }), false, "the site");
  assert.equal(wantsNativeAlert({}, native, { documentElement: { getAttribute: () => "ios26" } }), true);

  for (const [name, page, opts] of [
    ["countdown", { native }, { countdown: { button: 1, seconds: 5 } }],
    // onTap opens a link or window, which WebKit allows only inside the tap: the bridge answers after it
    ["onTap", { native }, { onTap: () => {} }],
    ["no hook (iOS 6, 7, 13, or iOS 26 on old WebKit)", { native, controls: null }, {}],
    ["the site", { native: null }, {}],
  ]) {
    native.calls.length = 0;
    const { made } = await withPage(page, () => { showAlert({ title: "T", buttons: ["Cancel", "Go"], ...opts }); });
    assert.equal(native.calls.length, 0, `${name}: no bridge call`);
    assert.ok(made.some((e) => e.className === "alert"), `${name}: CSS alert drawn`);
  }
});

test("F345b: a shell without ui.alert falls back to the CSS alert", async () => {
  const old = { call: async (m) => { throw new Error(`unknown method ${m}`); } };
  const { made } = await withPage({ native: old }, async () => {
    showAlert({ title: "T", buttons: ["Cancel", "Go"] });
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.ok(made.some((e) => e.className === "alert"), "CSS alert drawn after the refusal");
});

test("F345b: the shell answers ui.alert with a UIAlertController: cancel, destructive, preferredAction, one text field", () => {
  const swift = readFileSync(new URL("../../../native/Sources/NativeAlerts.swift", import.meta.url), "utf8");
  assert.match(swift, /b\.on\("ui\.alert"\)/);
  assert.match(swift, /preferredStyle: \.alert/);
  assert.match(swift, /addTextField/);
  assert.match(swift, /i == cancel \? \.cancel : color == "red" \? \.destructive/);
  assert.match(swift, /preferredAction = preferred/);
  const bridge = readFileSync(new URL("../../../native/Sources/Bridge.swift", import.meta.url), "utf8");
  assert.match(bridge, /NativeAlerts\.register\(self\)/);
});

const pasteOpts = (extra = {}) => ({
  title: "Enter APT URL", buttons: ["Cancel", "Add Source"], cancel: 0,
  input: { placeholder: "https://", value: "https://", type: "url", paste: (t) => (/\.[a-z]{2,}/.test(t) ? t.trim() : ""), pasteSubmits: 1, ...extra },
});

test("F377: pasteSubmits goes to ui.alert; a paste answer resolves the button with input.paste's value", async () => {
  const native = shell(() => ({ index: 1, value: " repo.test/x ", pasted: true }));
  const { out, made } = await withPage({ native }, () => showAlert(pasteOpts()));
  assert.deepEqual(native.calls[0][1].input, { placeholder: "https://", value: "https://", type: "url", pasteSubmits: 1 });
  assert.deepEqual(out, { index: 1, value: "repo.test/x" });
  assert.equal(made.length, 0, "no CSS alert drawn");
});

test("F377: pasteSubmits off the buttons is not sent; a typed answer keeps its value as it is", async () => {
  const native = shell(() => ({ index: 1, value: " typed " }));
  const { out } = await withPage({ native }, () => showAlert(pasteOpts({ pasteSubmits: 5 })));
  assert.equal("pasteSubmits" in native.calls[0][1].input, false);
  assert.deepEqual(out, { index: 1, value: " typed " });
});

test("F377: a paste input.paste can't use opens the alert again with the text in the field", async () => {
  const answers = [{ index: 1, value: "hello", pasted: true }, { index: 0, value: "hello" }];
  const native = shell(() => answers.shift());
  const { out } = await withPage({ native }, () => showAlert(pasteOpts()));
  assert.equal(native.calls.length, 2);
  assert.equal(native.calls[1][1].input.value, "hello");
  assert.equal(native.calls[1][1].input.pasteSubmits, 1);
  assert.deepEqual(out, { index: 0, value: "hello" });
});

test("F377: the shell's field takes a paste delegate that answers for the pasteSubmits button", () => {
  const swift = readFileSync(new URL("../../../native/Sources/NativeAlerts.swift", import.meta.url), "utf8");
  assert.match(swift, /input\["pasteSubmits"\]/);
  assert.match(swift, /f\.pasteDelegate = d/);
  assert.match(swift, /class PasteSubmits: NSObject, UITextPasteDelegate/);
  assert.match(swift, /performPasteOf/);
  assert.match(swift, /out\["pasted"\] = true/);
});
