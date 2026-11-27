// F456: the reload bar's failure line (nav/reloadbar.js showReloadFailure), what fills it (core/refreshfailures.js)
// and the log its Show Info opens (screens/apprun.js openFailureLog).
import { test } from "node:test";
import assert from "node:assert/strict";
import { showReloadBar, showReloadFailure, FAILED_TEXT, INFO_LABEL, FAILED_MS } from "./reloadbar.js";
import { fakeDocument } from "./fakedom.test-helper.js";
import { refreshFailures } from "../core/refreshfailures.js";
import { loadFailures } from "../catalog.js";
import { openFailureLog } from "../screens/apprun.js";

// The shared fake DOM, with innerHTML's <span class="…"> turned into children as the bar needs.
function fakeDoc() {
  const doc = fakeDocument();
  const make = doc.createElement;
  doc.createElement = (t) => {
    const el = make(t);
    Object.defineProperty(el, "innerHTML", { configurable: true, get: () => "", set(html) {
      el.replaceChildren();
      for (const m of String(html).matchAll(/<span[^>]*class="([^"]+)"/g)) el.append(Object.assign(make("span"), { className: m[1] }));
    } });
    return el;
  };
  return doc;
}
function fakeClock() {
  let t = 1000, seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (f, ms) => { const id = ++seq; timers.set(id, { at: t + ms, f }); return id; },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].f();
      }
      t = end;
    },
  };
}
const words = (bar) => bar.el.querySelector(".reload-text").textContent;
const button = (bar) => bar.el.children.find((k) => k.classList.contains("reload-cancel"));
const up = (doc) => doc.documentElement.classList.contains("has-reload");
const A = { title: "Repo A", detail: "HTTP 404" };
const B = { title: "Repo B", detail: "timed out" };

test("a run that failed turns its own bar into the failure line, then it hides itself", () => {
  const doc = fakeDoc(), clock = fakeClock();
  let cancelled = 0;
  const bar = showReloadBar("Updating Sources", { doc, clock, onCancel: () => cancelled++ });
  clock.advance(1000);
  bar.add([A]);
  assert.equal(words(bar), "Updating Sources", "not before the run ends");
  bar.hide();
  assert.equal(words(bar), FAILED_TEXT);
  assert.equal(button(bar).textContent, INFO_LABEL);
  assert.equal(bar.el.querySelector(".reload-spinner"), null);
  clock.advance(FAILED_MS - 1);
  assert.ok(up(doc));
  clock.advance(1);
  assert.ok(!up(doc));
  assert.equal(cancelled, 0);
});

test("Show Info hands the log every failure and the run's steps", () => {
  const doc = fakeDoc(), clock = fakeClock();
  const got = [];
  const bar = showReloadBar("Updating Sources", { doc, clock, minMs: 0, onCancel: () => assert.fail("not a cancel") });
  bar.set("Downloading Packages");
  clock.advance(10);
  bar.add([A], { onInfo: (f, s) => got.push(f, s) });
  bar.hide();
  clock.advance(10);
  showReloadFailure([A, B], { doc, clock });
  button(bar).click();
  assert.deepEqual(got, [[A, B], ["Updating Sources", "Downloading Packages"]]);
  assert.ok(!up(doc));
});

test("a failure with no run under way brings the bar up as the failure line; a running one waits for its end", () => {
  const doc = fakeDoc(), clock = fakeClock();
  assert.equal(showReloadFailure([], { doc, clock }), null);
  const alone = showReloadFailure([A], { doc, clock, text: "Icons couldn't be loaded." });
  assert.equal(words(alone), "Icons couldn't be loaded.");
  alone.dismiss();
  const run = showReloadBar("Updating Sources", { doc, clock });
  assert.equal(showReloadFailure([B], { doc, clock }), run);
  assert.equal(words(run), "Updating Sources");
  run.hide();
  clock.advance(1000);
  assert.equal(words(run), FAILED_TEXT);
  run.dismiss();
});

test("Cancel drops what the run had failed on; a run starting at once keeps a line not yet read", () => {
  const doc = fakeDoc(), clock = fakeClock();
  const one = showReloadBar("Updating Sources", { doc, clock });
  one.add([A]);
  button(one).click();
  assert.ok(!up(doc));
  const first = showReloadFailure([A], { doc, clock });
  const next = showReloadBar("Updating Sources", { doc, clock }); // runAgain, straight after
  assert.notEqual(next, first);
  next.hide();
  clock.advance(1000);
  assert.equal(words(next), FAILED_TEXT);
  clock.advance(1000); // read by now: a later Refresh starts clean
  const later = showReloadBar("Updating Sources", { doc, clock });
  later.hide();
  clock.advance(1000);
  assert.ok(!up(doc));
});

test("refreshFailures: each failed record, and apt's failures no record carries", () => {
  const rows = Object.assign([{ key: "a", name: "Repo A", error: "HTTP 404" }, { key: "b", name: "Repo B", error: null }, null],
    { failed: [{ key: "a", name: "Repo A", message: "apt: 404" }, { key: null, uri: "https://dead.example/", name: null, message: "no route" }] });
  assert.deepEqual(refreshFailures(rows), [A, { title: "https://dead.example/", detail: "no route" }]);
  assert.deepEqual(refreshFailures(null), []);
});

test("loadFailures: a refreshed repo that didn't parse, not one the refresh already reports or has yet to try", () => {
  const loaded = new Map(["a", "b", "c", "d"].map((k) => [k, { error: k === "d" ? null : "bad Packages" }]));
  const sources = [{ key: "a", name: "Repo A", updated: 1 }, { key: "b", name: "B", updated: 1, error: "HTTP 404" },
    { key: "c", name: "C" }, { key: "d", name: "D", updated: 1 }];
  assert.deepEqual(loadFailures(sources, loaded), [{ title: "Repo A", detail: "bad Packages" }]);
});

test("the log: the steps, then each source and its error in red, finished with Return", () => {
  const out = [];
  openFailureLog([A], ["Updating Sources"], { open: ({ title }) => ({
    step: (t) => out.push(["step", t]), error: (t) => out.push(["error", t]), finish: (o) => out.push(["finish", title, o.title]),
  }) });
  assert.deepEqual(out, [["step", "Updating Sources"], ["error", "Repo A: HTTP 404"], ["finish", "Log", "Log"]]);
});
