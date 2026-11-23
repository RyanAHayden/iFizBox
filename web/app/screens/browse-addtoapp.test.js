// B296: the package page's nav bar Add to App (sideload build) follows the Add to an App group's tweak check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addToAppFollowsCheck, ADD_TO_APP } from "./browse.js";

const fake = (label = ADD_TO_APP) => ({ textContent: label, hidden: false });

test("Can't Go into an App, or a library: Add to App is hidden", () => {
  const b = fake();
  assert.equal(addToAppFollowsCheck({}, { ok: false, why: "Its filter names com.apple.mobiletimer." }, { button: () => b }), true);
  assert.equal(b.hidden, true);
  const lib = fake();
  addToAppFollowsCheck({}, { ok: false, library: true }, { button: () => lib });
  assert.equal(lib.hidden, true);
});

test("a tweak that goes into an app, or a check that couldn't finish, keeps Add to App", () => {
  const ok = fake();
  assert.equal(addToAppFollowsCheck({}, { ok: true, apps: [] }, { button: () => ok }), false);
  assert.equal(ok.hidden, false);
  const unknown = fake();
  addToAppFollowsCheck({}, null, { button: () => unknown });
  assert.equal(unknown.hidden, false);
});

test("another label (Install, Modify) or no button: nothing changes", () => {
  const inst = fake("Install");
  assert.equal(addToAppFollowsCheck({}, { ok: false }, { button: () => inst }), false);
  assert.equal(inst.hidden, false);
  assert.equal(addToAppFollowsCheck({}, { ok: false }, { button: () => null }), false);
});

// A DOM just big enough for worksInGroup's rows (no document.head: loadStyle skips the stylesheet).
const fakeDom = () => {
  const node = (tag) => ({ tag, children: [], classList: { add() {} }, className: "", textContent: "", dataset: {},
    append(...k) { this.children.push(...k); }, replaceChildren(...k) { this.children = k; }, addEventListener() {} });
  return { createElement: node };
};

test("worksInGroup's onCheck hears the check (Comet: a library), so the page can hide Add to App", async () => {
  const { worksInGroup } = await import("./tweaks.js");
  const saved = globalThis.document;
  globalThis.document = fakeDom();
  try {
    const comet = { package: "com.ginsu.comet", name: "Comet", version: "2.0.1", section: "Tweaks",
      description: "A SwiftUI Prefs Framework", depends: "dev.theos.orion14", debUrl: "https://repo.chariz.com/debs/comet.deb" };
    const m = new Map();
    const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
    const heard = [];
    const b = fake();
    const g = worksInGroup(comet, { storage, apps: async () => [], fetchDeb: async () => new Uint8Array(0),
      onCheck: (info) => { heard.push(info); addToAppFollowsCheck({}, info, { button: () => b }); } });
    const info = await g.ready;
    assert.equal(info.ok, false);
    assert.deepEqual(heard, [info]);
    assert.equal(b.hidden, true);
  } finally { globalThis.document = saved; }
});

test("wiring: the package page hands every check to the nav bar button, the one after Buy too", () => {
  const browse = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  assert.ok(browse.includes("worksInGroup(st, { onCheck: (info) => addToAppFollowsCheck(body, info)"));
  const tweaks = readFileSync(new URL("./tweaks.js", import.meta.url), "utf8");
  assert.ok(tweaks.includes("await checked();"), "Sign In / Buy re-check goes through onCheck");
});
