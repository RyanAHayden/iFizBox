// B175: iFizBox back in front (reopened, or opened by a link or a file such as an .ipa from Files) with the app run's
// log (Apps/Log) still up: a finished run's page closes first, then the link is handled; a run still going stays up,
// and the link waits for it to end (Wait) or opens on top after the alert (Open Now).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startIncoming, clearRunPage, runningText, RUNNING_TITLE } from "./incoming.js";
import { runAppRun, runPage } from "./screens/apprun.js";
import { createAppQueue } from "./core/appqueue.js";

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// A run page as screens/apprun.js runPage() hands it out, with a log of what happened to it.
function fakeRun({ busy = false } = {}) {
  const log = [];
  let end;
  const over = new Promise((r) => { end = r; });
  const p = {
    log, busy, aside: false,
    ended: () => (p.busy ? over : Promise.resolve()),
    dismiss: async () => { log.push("dismiss"); },
    putAside: () => { p.aside = true; log.push("aside"); },
    finish: () => { p.busy = false; log.push("ended"); end(); },
  };
  return p;
}

test("a finished run's page closes before the link is handled, without asking", async () => {
  const page = fakeRun();
  const asked = [];
  const r = await clearRunPage("ifizbox://myipas?file=A.ipa", { runPage: () => page, alert: async (a) => { asked.push(a); return { index: 1 }; } });
  assert.equal(r, "closed");
  assert.deepEqual(page.log, ["dismiss"]);
  assert.equal(asked.length, 0);
});

test("no run page: nothing to do", async () => {
  assert.equal(await clearRunPage("ifizbox://home", { runPage: () => null, alert: async () => assert.fail("asked") }), "none");
});

test("a run still going: Wait opens the link only after the run ends, its page closed first", async () => {
  const page = fakeRun({ busy: true });
  const asked = [];
  let done = false;
  const p = clearRunPage("ifizbox://myipas?file=Delta.ipa", { runPage: () => page,
    alert: async (a) => { asked.push(a); return { index: 1 }; } }).then((r) => { done = true; return r; });
  await settle();
  assert.equal(asked[0].title, RUNNING_TITLE);
  assert.deepEqual(asked[0].buttons, ["Open Now", "Wait"]);
  assert.equal(asked[0].cancel, 1);
  assert.match(asked[0].message, /^Delta\.ipa opens once/);
  assert.equal(done, false); // still waiting on the run
  assert.deepEqual(page.log, []);
  page.finish();
  assert.equal(await p, "waited");
  assert.deepEqual(page.log, ["ended", "dismiss"]);
});

test("a run still going: Open Now puts the page aside and opens the link on top at once; a later link doesn't ask again", async () => {
  const page = fakeRun({ busy: true });
  let asks = 0;
  const alert = async () => { asks++; return { index: 0 }; };
  assert.equal(await clearRunPage("ifizbox://installed", { runPage: () => page, alert }), "on-top");
  assert.deepEqual(page.log, ["aside"]);
  assert.equal(await clearRunPage("ifizbox://search", { runPage: () => page, alert }), "on-top");
  assert.equal(asks, 1);
});

test("the run ends while the alert is up: either answer closes the page and goes on", async () => {
  const page = fakeRun({ busy: true });
  const r = await clearRunPage("ifizbox://home", { runPage: () => page, alert: async () => { page.finish(); return { index: 0 }; } });
  assert.equal(r, "closed");
  assert.deepEqual(page.log, ["ended", "dismiss"]);
});

test("runningText names the IPA where the link carries one", () => {
  assert.match(runningText("ifizbox://myipas?file=My%20App.ipa"), /^My App\.ipa opens/);
  assert.match(runningText("ifizbox://install?url=https%3A%2F%2Fx.test%2Fa%2FB.ipa"), /^B\.ipa opens/);
  assert.match(runningText("ifizbox://sources"), /^What you opened opens/);
});

function fakeDoc() {
  const d = { visibilityState: "visible", listeners: [],
    addEventListener(t, f) { if (t === "visibilitychange") d.listeners.push(f); },
    removeEventListener(t, f) { d.listeners = d.listeners.filter((x) => x !== f); },
    set(state) { d.visibilityState = state; for (const f of [...d.listeners]) f(); } };
  return d;
}
function events() {
  const listeners = {};
  return { listeners, addEventListener: (t, f) => { listeners[t] = f; } };
}

test("B431 reopened (no link): a finished run's page stays up, as does a running one", async () => {
  const native = { async call() { return null; } };
  const doc = fakeDoc();
  let page = fakeRun();
  await startIncoming({ native, events: events(), doc, runPage: () => page });
  doc.set("hidden");
  doc.set("visible");
  await settle();
  assert.deepEqual(page.log, []);
  page = fakeRun({ busy: true });
  doc.set("hidden");
  doc.set("visible");
  await settle();
  assert.deepEqual(page.log, []);
});

test("an .ipa from Files: the finished run's page closes, then the IPA's page opens", async () => {
  const order = [];
  const page = fakeRun();
  page.dismiss = async () => { order.push("dismiss"); };
  const kept = ["ifizbox://myipas?file=A.ipa"];
  const native = { async call(m) { return m === "app.takeURL" && kept.length ? { url: kept.shift() } : null; } };
  const saved = globalThis.location;
  const loc = {};
  let hash = "";
  Object.defineProperty(loc, "hash", { get: () => hash, set: (v) => { order.push("open"); hash = v; } });
  globalThis.location = loc;
  try {
    await startIncoming({ native, events: events(), doc: fakeDoc(), runPage: () => page });
  } finally { globalThis.location = saved; }
  assert.deepEqual(order, ["dismiss", "open"]);
  assert.match(hash, /myipas\/ipa%3AA\.ipa$/);
});

test("a link while a run goes on: Wait holds it until the run ends", async () => {
  const order = [];
  const page = fakeRun({ busy: true });
  page.dismiss = async () => { order.push("dismiss"); };
  const kept = ["ifizbox://myipas?file=A.ipa"];
  const native = { async call(m) { return m === "app.takeURL" && kept.length ? { url: kept.shift() } : null; } };
  const saved = globalThis.location;
  const loc = {};
  Object.defineProperty(loc, "hash", { get: () => "", set: () => { order.push("open"); } });
  globalThis.location = loc;
  try {
    const started = startIncoming({ native, events: events(), doc: fakeDoc(), runPage: () => page,
      alert: async () => { order.push("ask"); return { index: 1 }; } });
    await settle();
    assert.deepEqual(order, ["ask"]);
    page.finish();
    await started;
  } finally { globalThis.location = saved; }
  assert.deepEqual(order, ["ask", "dismiss", "open"]);
});

// ---- the real run page's handle (screens/apprun.js) ----

function fakePage() {
  const p = {
    lines: [], closers: [], closed: false, hidden: false, shows: 0,
    line(kind, text, id) { p.lines.push({ kind, text, id }); },
    status() {}, progress() {}, pane(n) { return n; }, view() {},
    segmented() { return { select() {} }; },
    filter() {}, bar() {}, reopen() {}, finish(f) { p.finished = f; },
    hide() { p.hidden = true; }, show() { p.hidden = false; p.shows++; },
    onClose(f) { p.closers.push(f); },
    close() { if (!p.closed) { p.closed = true; for (const f of p.closers.splice(0)) f(); } return Promise.resolve(); },
  };
  return p;
}
function fakeDomEl() {
  const make = (tag) => {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], listeners: {}, style: {}, attrs: {}, dataset: {}, parentNode: null,
      textContent: "", hidden: false, disabled: false, type: "", _cls: new Set(),
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: { add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        toggle: (c, on) => ((on ?? !e._cls.has(c)) ? e._cls.add(c) : e._cls.delete(c)), contains: (c) => e._cls.has(c) },
      setAttribute(k, v) { e.attrs[k] = String(v); },
      append(...c) { for (const x of c) { if (typeof x !== "object") continue; x.parentNode = e; e.children.push(x); } },
      remove() {},
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
    };
    return e;
  };
  return { body: make("body"), createElement: make };
}

test("runPage: busy while the run works, ended() resolves at its end, a page put aside comes back, dismiss closes and clears it", async () => {
  const saved = globalThis.document;
  globalThis.document = fakeDomEl();
  try {
    const queue = createAppQueue({ storage: null });
    queue.add({ id: "a", name: "A", url: "https://x.test/a.ipa", bundleId: "a" });
    let release;
    const lanes = {
      sign: async () => ({ token: "t", bundleId: "a" }),
      install: (r, { progress }) => new Promise((res) => { progress("asking", 0); release = () => res({ installed: true }); }),
      discard: () => {},
    };
    const page = fakePage();
    const doc = fakeDoc();
    const ran = runAppRun(queue.list(), { queue, lanes, open: () => page, doc, isInstalled: async () => ({ a: true }), keepAwake: () => {} });
    await settle();
    const h = runPage();
    assert.ok(h);
    assert.equal(h.busy, true);
    let over = false;
    h.ended().then(() => { over = true; });
    h.putAside();
    assert.equal(h.aside, true);
    for (let i = 0; i < 30 && !release; i++) await settle(1);
    release();
    await ran;
    await settle();
    assert.equal(over, true);
    assert.equal(h.busy, false);
    assert.equal(page.hidden, false); // back with its result
    assert.equal(page.shows, 1);
    assert.equal(doc.listeners.length, 1); // the hand-off follow listens while the page is up
    await h.dismiss();
    assert.equal(page.closed, true);
    assert.equal(runPage(), null);
    assert.equal(doc.listeners.length, 0); // wound down
  } finally { globalThis.document = saved; }
});
