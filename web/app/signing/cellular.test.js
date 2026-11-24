// F417: the popup on cellular: one for a run, gone by itself off cellular, its answer for every app of the run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellularAsk } from "./cellular.js";
import { openPrepared } from "./queue.js";
import { forgetRoute } from "./route.js";
import { showAlert } from "../nav/alert.js";
import { phoneLanes } from "../screens/apprun.js";
import { appRows, createAppRun } from "../core/apprun.js";
import { fakeDocument } from "../nav/fakedom.test-helper.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
// alerts shown, each with its options and `tap(index)`; an abort answers -1
function popups() {
  const shown = [];
  const alert = (o) => new Promise((resolve) => {
    shown.push({ o, tap: (index) => resolve({ index }) });
    o.signal.addEventListener("abort", () => resolve({ index: -1 }));
  });
  return { shown, alert };
}

test("one popup while any install waits; it goes by itself when none does", async () => {
  const { shown, alert } = popups();
  const cell = cellularAsk({ alert, choice: () => "ask" });
  const stops = [];
  const a = cell.watch(() => stops.push("a")), b = cell.watch(() => stops.push("b"));
  a.phase("airplane"); b.phase("airplane"); await tick();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].o.title, "You're on Cellular");
  a.phase("appWait"); a.phase("connecting"); b.phase("appWait"); b.phase("connecting"); a.phase("offCellular"); await tick();
  assert.equal(shown[0].o.signal.aborted, false, "b still waits");
  b.phase("offCellular"); await tick();
  assert.equal(shown[0].o.signal.aborted, true);
  assert.deepEqual([cell.answer, a.end(), stops], [null, null, []]);
  a.phase("airplane"); await tick();
  assert.equal(shown.length, 2, "cellular came back: asked again");
  assert.equal(a.end(), null);
  assert.equal(shown[1].o.signal.aborted, true, "a Stop or a failure takes it too");
});

test("an answer stops every waiting install, and holds for later ones", async () => {
  const { shown, alert } = popups();
  let server = 0;
  const cell = cellularAsk({ alert, choice: () => "ask", onServer: () => server++ });
  const stops = [];
  const a = cell.watch(() => stops.push("a")), b = cell.watch(() => stops.push("b")), c = cell.watch(() => stops.push("c"));
  a.phase("airplane"); b.phase("airplane"); await tick();
  shown[0].tap(0); await tick();
  assert.deepEqual([stops, a.end(), b.end(), server], [["a", "b"], "server", "server", 1]);
  c.phase("airplane"); await tick();
  assert.deepEqual([stops, c.end(), shown.length, server], [["a", "b", "c"], "server", 1, 1]);
});

test("Use Signing Server chosen: no popup when the phone turns out to be on cellular; Cancel, then asked anew", async () => {
  const { shown, alert } = popups();
  const chosen = cellularAsk({ alert, choice: () => "server" });
  const a = chosen.watch(() => {});
  a.phase("airplane"); await tick();
  assert.deepEqual([shown.length, a.end()], [0, "server"]);
  const cell = cellularAsk({ alert, choice: () => "ask" });
  const b = cell.watch(() => {});
  b.phase("airplane"); await tick();
  shown[0].tap(1); await tick();
  assert.equal(b.end(), "cancel");
  cell.forget();
  const c = cell.watch(() => {});
  c.phase("airplane"); await tick();
  assert.equal(shown.length, 2);
  c.end();
});

// The Shortcut: run() answers `codes` in turn, and on null the waiting installs go off cellular first.
function shortcutOf(codes, { added = false, add = [], off = () => {} } = {}) {
  const did = [];
  return { did, added, add: async () => { did.push("add"); return add.length ? add.shift() : true; },
    run: async () => { did.push("run"); await tick(); const c = codes.shift() ?? null; if (c === null) off(); return c; } };
}
function asking(sc, choice = "ask", w = () => {}) {
  const p = popups();
  const kept = { choice };
  const cell = cellularAsk({ alert: p.alert, choice: () => kept.choice, setChoice: (v) => { kept.choice = v; }, shortcut: () => sc, onServer: w });
  return { ...p, kept, cell };
}
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

test("Use Shortcut runs it at once, once for every waiting install", async () => {
  let a, b;
  const sc = shortcutOf([], { off: () => { a.phase("offCellular"); b.phase("offCellular"); } });
  const { shown, cell } = asking(sc, "shortcut");
  a = cell.watch(() => {}); b = cell.watch(() => {});
  a.phase("airplane"); b.phase("airplane"); await settle();
  assert.deepEqual([sc.did, shown.length, cell.answer], [["run"], 0, null]);
  a.phase("airplane"); await settle();
  assert.deepEqual(sc.did, ["run", "run"], "cellular data back as it connects again: once more");
});

test("Set Up Shortcut in the popup: added, run, and used from then on", async () => {
  let a;
  const sc = shortcutOf([], { off: () => a.phase("offCellular") });
  const { shown, cell, kept } = asking(sc);
  a = cell.watch(() => {});
  a.phase("airplane"); await settle();
  assert.equal(shown[0].o.buttons[0], "Set Up Shortcut");
  shown[0].tap(0); await settle();
  assert.deepEqual([sc.did, kept.choice, shown.length], [["add", "run"], "shortcut", 1]);
});

test("an added one is Use Shortcut; not added: the popup again, and nothing kept", async () => {
  const gone = asking(shortcutOf(["not_waiting"]));
  const w = gone.cell.watch(() => {});
  w.phase("airplane"); await settle();
  gone.shown[0].tap(0); await tick(); w.phase("offCellular"); await settle();
  assert.equal(gone.kept.choice, "shortcut", "set up, and the wait ended before it ran");
  const have = asking(shortcutOf([], { added: true }));
  have.cell.watch(() => {}).phase("airplane"); await settle();
  assert.equal(have.shown[0].o.buttons[0], "Use Shortcut");
  const sc = shortcutOf([], { add: [false] });
  const { shown, cell, kept } = asking(sc);
  cell.watch(() => {}).phase("airplane"); await settle();
  shown[0].tap(0); await settle();
  assert.deepEqual([sc.did, kept.choice, shown.length], [["add"], "ask", 2]);
});

test("a failed run asks: Shortcut Didn't Run; later installs of the run ask too", async () => {
  let a;
  const sc = shortcutOf(["not_run", null], { added: true, off: () => a.phase("offCellular") });
  const { shown, cell } = asking(sc, "shortcut");
  a = cell.watch(() => {});
  a.phase("airplane"); await settle();
  assert.deepEqual([shown[0].o.title, shown[0].o.buttons[0]], ["Shortcut Didn't Run", "Add Shortcut Again"]);
  a.phase("offCellular"); await settle();
  assert.equal(shown[0].o.signal.aborted, true, "off cellular by hand");
  a.phase("airplane"); await settle();
  assert.deepEqual([sc.did, shown.length, shown[1].o.title], [["run"], 2, "Shortcut Didn't Run"]);
  shown[1].tap(0); await settle();
  assert.deepEqual([sc.did, shown.length], [["run", "add", "run"], 2]);
});

test("a run that leaves an install waiting is run once more, then asked; one with nothing waiting isn't a failure", async () => {
  const sc = shortcutOf([null, null]);
  const { shown, cell } = asking(sc, "shortcut");
  cell.watch(() => {}).phase("airplane"); await settle(); await settle();
  assert.deepEqual([sc.did, shown.length], [["run", "run"], 1]);
  const paused = shortcutOf(["not_waiting"]);
  const p = asking(paused, "shortcut");
  const w = p.cell.watch(() => {});
  w.phase("airplane"); w.phase("appWait"); await settle();
  assert.deepEqual([paused.did, p.shown.length], [["run"], 0]);
});

test("an install that ends while the Shortcut is read or run leaves no popup", async () => {
  const sc = shortcutOf(["not_run"]);
  const { shown, cell } = asking(sc, "shortcut");
  const w = cell.watch(() => {});
  w.phase("airplane"); await tick(); w.end(); await settle();
  assert.deepEqual([sc.did.length <= 1, shown.length], [true, 0]);
});

// A phone on cellular whose This iPhone installs wait until cancelled; the Signing Server's are dismissed or installed.
async function run(answer, { choice = null } = {}) {
  const opens = [], cancels = [], pending = new Map(), { shown, alert } = popups();
  let up = 0, most = 0;
  const native = { call: async (m, p, on) => {
    if (m === "idevice.status") return { paired: "rp", vpn: { available: true, tested: true, cellular: true } };
    if (m === "signing.open") {
      opens.push([p.token, p.route ?? "server"]);
      if (!p.route) return { bundleId: p.token };
      on({ phase: "airplane", progress: 0 });
      return new Promise((_, no) => pending.set(p.tag, no));
    }
    if (m === "signing.progress") { most = Math.max(most, ++up); await tick(); up--; return { installed: true }; }
    if (m === "signing.cancel") { cancels.push(Boolean(p.keep)); setTimeout(() => pending.get(p.tag)?.(Object.assign(new Error("cancelled: Cancelled"), { code: "cancelled" })), 2); return {}; }
    return {};
  } };
  globalThis.localStorage = { getItem: (k) => ({ "ifizbox.installRoute": "iphone", "ifizbox.onCellular": choice }[k] ?? null), setItem() {}, removeItem() {} };
  forgetRoute();
  try {
    const sc = { prepareOnDevice: async (j) => ({ token: j.id, bundleId: j.id }), openPrepared, cellularAsk: (o) => cellularAsk({ ...o, alert }) };
    const lanes = phoneLanes(sc, { native });
    const rows = appRows(["a", "b"].map((id) => ({ id, name: id, mode: "install", url: `https://x.test/${id}.ipa` })));
    const r = createAppRun({ rows, ...lanes, local: () => !lanes.serverRoute(), parallel: 3, ahead: 9 });
    const end = r.start();
    if (answer !== null) { for (let k = 0; k < 40 && !shown.length; k++) await tick(); await tick(); shown[0].tap(answer); }
    await end;
    return { rows, opens, cancels, shown, most };
  } finally { delete globalThis.localStorage; }
}

test("a run: Use Signing Server sends the signed copies through it, one prompt at a time", async () => {
  const { rows, opens, cancels, shown, most } = await run(0);
  assert.equal(shown.length, 1);
  assert.deepEqual(rows.map((r) => r.state), ["installed", "installed"], JSON.stringify(rows.map((r) => r.error)));
  assert.ok(cancels.length && cancels.every(Boolean), "the shell keeps the signed copies");
  for (const id of ["a", "b"]) assert.equal(opens.filter((o) => o[0] === id).at(-1)[1], "server");
  assert.equal(most, 1);
});

test("a run: Cancel fails its apps, saying why", async () => {
  const { rows, cancels, opens } = await run(1);
  assert.deepEqual(rows.map((r) => r.state), ["failed", "failed"]);
  for (const r of rows) assert.match(r.error, /still on cellular/);
  assert.ok(cancels.every((k) => !k));
  assert.ok(opens.every((o) => o[1] === "idevice"));
});

test("a run with Use Signing Server chosen never starts This iPhone's way", async () => {
  const { rows, opens, shown, most } = await run(null, { choice: "server" });
  assert.deepEqual([shown.length, most, opens], [0, 1, [["a", "server"], ["b", "server"]]]);
  assert.ok(rows.every((r) => r.state === "installed"));
});

test("showAlert: `signal` closes the alert by itself, index -1, in the page and in the app", async () => {
  const saved = { document: globalThis.document, native: globalThis.ifizboxNative };
  try {
    globalThis.document = fakeDocument();
    const gone = new AbortController();
    gone.abort();
    assert.equal((await showAlert({ title: "T", signal: gone.signal })).index, -1);
    globalThis.document.documentElement.setAttribute("data-style", "ios26");
    const calls = [];
    let answer;
    globalThis.ifizboxNative = { call: (m, p) => { calls.push([m, p]); return m === "ui.alert" ? new Promise((r) => { answer = r; }) : (answer({ index: -1, closed: true }), Promise.resolve({})); } };
    const ctl = new AbortController();
    const p = showAlert({ title: "T", buttons: ["A", "B"], cancel: 1, signal: ctl.signal });
    ctl.abort();
    assert.equal((await p).index, -1);
    assert.deepEqual([calls[0][0], calls[1]], ["ui.alert", ["ui.alertClose", { id: calls[0][1].id }]]);
  } finally {
    globalThis.document = saved.document;
    if (saved.native === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved.native;
  }
});
