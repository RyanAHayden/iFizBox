// B136: openMX's install failed (iOS got ECONNREFUSED, B128) but a record said it was installed, so its Search row's
// swipe did nothing. With a fake bridge whose apps.isInstalled says iOS doesn't have it, the row isn't shown installed
// and the swipe queues Install.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rowAppJob, appOnPhone } from "./altstore.js";
import { rowSwipeAction } from "./browse.js";
import { createAppQueue } from "../core/appqueue.js";
import { fakeNative as bridge } from "../fakes.test-helper.js";

const ID = "io.github.fizl0.openmx";
const pkg = { key: "alt:https://s/", row: { id: ID, name: "openMX" },
  stanza: { kind: "ipa", ipa: { bundleIdentifier: ID, name: "openMX", sourceUrl: "https://s/apps.json", sourceName: "S",
    versions: [{ version: "1.2", downloadURL: "https://s/openmx.ipa" }] } } };
const storeOf = (recs) => async () => ({ all: async () => recs });
const item = { id: ID, name: "openMX", version: "1.2", kind: "ipa", key: "alt:https://s/" };
// The shared bridge, apps.isInstalled answering `answer` (an Error: thrown).
const fakeNative = (answer) => bridge({ "apps.isInstalled": answer });

test("B136: a recorded app iOS doesn't have: not installed, the row's swipe queues Install", async () => {
  const native = fakeNative({ installed: { [ID]: false } });
  const store = storeOf([{ id: ID, version: "1.2" }]); // left by the failed install
  const st = await rowAppJob(pkg, null, { store, mode: "sideload", onPhone: (id) => appOnPhone(id, native) });
  assert.deepEqual(native.calls, [{ method: "apps.isInstalled", params: { bundleIds: [ID] } }]);
  assert.equal(st.installed, null);
  assert.equal(st.job.installed, null);
  const a = rowSwipeAction(item, { apps: true, ...st, id: ID });
  assert.equal(a.kind, "add");
  assert.equal(a.label, "Install");
  const q = createAppQueue();
  q.add(a.job);
  assert.equal(q.get(ID).mode, "install");
  assert.equal(q.get(ID).url, "https://s/openmx.ipa");
});

test("B136: the record stands where iOS has the app or can't be asked", async () => {
  const store = storeOf([{ id: ID, version: "1.2" }]);
  const has = await rowAppJob(pkg, null, { store, mode: "sideload", onPhone: (id) => appOnPhone(id, fakeNative({ installed: { [ID]: true } })) });
  assert.equal(has.installed, "1.2");
  assert.equal(rowSwipeAction(item, { apps: true, ...has }), null); // up to date: no swipe, as before
  const broken = await rowAppJob(pkg, null, { store, mode: "sideload", onPhone: (id) => appOnPhone(id, fakeNative(new Error("x"))) });
  assert.equal(broken.installed, "1.2");
  assert.equal(await appOnPhone(ID, null), null); // the website: no bridge
  assert.equal(await appOnPhone(ID, fakeNative({ installed: { [ID]: null } })), null);
  // no record: iOS isn't asked
  const native = fakeNative({ installed: { [ID]: true } });
  const fresh = await rowAppJob(pkg, null, { store: storeOf([]), mode: "sideload", onPhone: (id) => appOnPhone(id, native) });
  assert.equal(fresh.installed, null);
  assert.deepEqual(native.calls, []);
});

// B315: a left swipe on a My IPAs row shows Delete, and the click that ends it doesn't reach the row; a plain tap does.
import { libraryGroup } from "./myipas.js";
import { fakeDocument } from "../fakes.test-helper.js";

test("B315: a swipe arms Delete and its lift opens nothing; a tap still opens", () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = fakeDocument();
  try {
    const g = libraryGroup([{ file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.5", size: 1, signed: null }],
      { site: false, jailbreak: false });
    const li = g.cellOf("Delta.ipa");
    const b = li.querySelector(".cell-label");
    const click = () => { let stopped = false; g.ul.fire("click", { target: b, preventDefault() { stopped = true; }, stopPropagation() {} }); return !stopped; };
    // a plain tap: the list's capture lets it through to the row
    g.ul.fire("pointerdown", { target: b, clientX: 300, clientY: 10 });
    assert.ok(click(), "a tap isn't swallowed");
    // a swipe
    g.ul.fire("pointerdown", { target: b, clientX: 300, clientY: 10 });
    g.ul.fire("pointermove", { target: b, clientX: 240, clientY: 12 });
    assert.ok(li.classList.contains("armed"), "Delete shows");
    assert.ok(!click(), "the lift that ends the swipe doesn't reach the row");
  } finally {
    if (had) Object.defineProperty(globalThis, "document", had); else delete globalThis.document;
  }
});
