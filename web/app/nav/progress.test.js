// F151: progressHUD, the HUD interface on the progress page (the sideload IPA's and the website's installs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { progressHUD, startView, openOn } from "./progress.js";

function fakePage() {
  const p = {
    calls: [], closed: false, closers: [],
    line(kind, text) { p.calls.push([kind, text]); },
    step(t) { p.line("step", t); }, error(t) { p.line("error", t); },
    status(t) { p.calls.push(["status", t]); },
    progress(n) { p.calls.push(["progress", n]); },
    finish(o) { p.calls.push(["finish", o.label, o.status]); },
    reopen() { p.calls.push(["reopen"]); },
    onClose(f) { p.closers.push(f); },
    close() { p.closed = true; p.closers.forEach((f) => f()); },
  };
  return p;
}

test("progressHUD: each label is a step, its percent moves the bar; done ends on Close (B45: not Close iFizBox)", () => {
  const page = fakePage();
  const h = progressHUD("Downloading", { open: () => page });
  h.set("Downloading 10%");
  h.set("Downloading 60%");
  h.set("Signing");
  h.done("Done");
  assert.deepEqual(page.calls.filter(([k]) => k === "step"), [["step", "Downloading"], ["step", "Signing"], ["step", "Done"]]);
  assert.deepEqual(page.calls.filter(([k]) => k === "progress"), [["progress", 10], ["progress", 60]]);
  assert.deepEqual(page.calls.at(-1), ["finish", "Return to iFizBox", "Done"]);
  h.set("Installing"); // after the end: nothing
  assert.deepEqual(page.calls.at(-1), ["finish", "Return to iFizBox", "Done"]);
  page.close();
});

test("progressHUD: fail shows the error in red; hide completes without a word of its own", () => {
  const page = fakePage();
  const h = progressHUD("Signing", { open: () => page });
  h.fail("The certificate was revoked.");
  assert.deepEqual(page.calls.slice(-2), [["error", "The certificate was revoked."], ["finish", "Return to iFizBox", "Failed"]]);
  h.hide();
  assert.equal(page.calls.filter(([k]) => k === "finish").length, 1);
  page.close();

  const p2 = fakePage();
  const h2 = progressHUD("Installing", { open: () => p2 });
  h2.set("Installed");
  h2.hide();
  assert.deepEqual(p2.calls.at(-1), ["finish", "Return to iFizBox", null]);
  p2.close();
});

test("progressHUD: the next job of a run continues on the page while it is up; a new page once it is closed", () => {
  const pages = [];
  const open = () => { const p = fakePage(); pages.push(p); return p; };
  progressHUD("Downloading", { open }).done();
  progressHUD("Downloading", { open }).done();
  assert.equal(pages.length, 1);
  assert.ok(pages[0].calls.some(([k]) => k === "reopen"));
  pages[0].close();
  progressHUD("Downloading", { open }).hide();
  assert.equal(pages.length, 2);
  pages[1].close();
});

test("progressHUD: finish ends on the caller's button (F155's Open <app>), its action handed to the page", () => {
  const page = fakePage();
  let action = null;
  page.finish = (o) => { action = o.action; page.calls.push(["finish", o.label, o.status]); };
  const h = progressHUD("Installing", { open: () => page });
  h.set("Installed");
  const go = () => false;
  h.finish({ label: "Open Delta", action: go, status: "Installed" });
  assert.deepEqual(page.calls.at(-1), ["finish", "Open Delta", "Installed"]);
  assert.equal(action, go);
  h.done("Done"); // already ended: nothing more
  assert.equal(page.calls.filter(([k]) => k === "finish").length, 1);
  page.close();
});

test("progressHUD (B27): two jobs on one page: it completes when the last one ends, on that one's button", () => {
  const page = fakePage();
  const open = () => page;
  const a = progressHUD("Downloading", { open });
  const b = progressHUD("Downloading", { open });
  b.done("Done");
  assert.equal(page.calls.filter(([k]) => k === "finish").length, 0);
  a.set("Installing 72%");
  assert.deepEqual(page.calls.at(-1), ["progress", 72]);
  a.finish({ label: "Open A", status: "Installed" });
  assert.deepEqual(page.calls.at(-1), ["finish", "Open A", "Installed"]);
  page.close();
});

test("F247: startView: one item opens on the Log, none or two or more on the rows list; openOn selects the tab", () => {
  assert.equal(startView(1), "log");
  assert.equal(startView(2), "pane");
  assert.equal(startView(5), "pane");
  assert.equal(startView(0), "pane");
  const views = [];
  const picked = [];
  const page = { view: (v) => views.push(v) };
  const seg = { select: (i) => picked.push(i) };
  assert.equal(openOn(page, seg, 1), "log");
  assert.equal(openOn(page, seg, 3), "pane");
  assert.deepEqual(views, ["log", "pane"]);
  assert.deepEqual(picked, [1, 0]);
});

// B214: the real page (C22's showSheet scaffold) takes a pane: the app run's first call after opening it threw a
// ReferenceError (`body` lost in C22), leaving a blank "Running / Preparing" page and every sideload run stuck.
test("openProgress: pane() and view() work on the real page", async () => {
  const { withDocument } = await import("../fakes.test-helper.js");
  const { openProgress } = await import("./progress.js");
  withDocument((doc) => {
    const page = openProgress({ title: "Running" });
    const node = doc.createElement("div");
    assert.equal(page.pane(node), node);
    page.view("pane");
    assert.ok(doc.querySelector(".progress-body .progress-pane"), "the pane is in the page's body");
    page.close();
  });
});

// B401: the black page covers the status bar while it is up: not while hidden, not once closed (also while hidden).
test("openProgress: the page is a dark cover from open to close, not while hidden", async () => {
  const { withDocument } = await import("../fakes.test-helper.js");
  const { openProgress } = await import("./progress.js");
  const { darkCovered } = await import("./statusbar.js");
  const anim = () => ({ finished: new Promise(() => {}), cancel() {} });
  withDocument(() => {
    assert.equal(darkCovered(), false);
    const page = openProgress();
    page.sheet.animate = anim;
    assert.equal(darkCovered(), true);
    page.hide();
    assert.equal(darkCovered(), false);
    page.show();
    assert.equal(darkCovered(), true);
    const root = globalThis.document.documentElement;
    root.setAttribute("data-sheet", "card");
    const card = openProgress();
    card.sheet.animate = anim;
    page.hide();
    card.hide(); // B408: the page behind comes forward off the black ground
    assert.equal(darkCovered(), false);
    card.show();
    assert.equal(darkCovered(), true);
    card.hide();
    card.close();
    assert.equal(darkCovered(), false);
    page.show();
    root.removeAttribute("data-sheet");
    const other = openProgress(); // two at once: until the last one goes
    page.close();
    assert.equal(darkCovered(), true);
    other.close();
    assert.equal(darkCovered(), false);
    const third = openProgress();
    third.sheet.animate = anim;
    third.hide();
    third.close();
    assert.equal(darkCovered(), false);
  });
});

// B408: in a card style (iOS 13, 26) the app behind the run page goes back on open and show, and forward on hide.
test("openProgress: hide brings the page behind a card forward, show pushes it back, close while hidden leaves it", async () => {
  const { withDocument } = await import("../fakes.test-helper.js");
  const { openProgress } = await import("./progress.js");
  const { showSheet } = await import("./sheet.js");
  const gcs = globalThis.getComputedStyle;
  await withDocument(async (doc) => {
    const root = globalThis.document.documentElement;
    root.setAttribute("data-sheet", "card");
    const moves = []; // the tab bar's
    const ends = [];
    const tabbar = { animate: (frames) => {
      moves.push(frames);
      return { finished: new Promise((r) => ends.push(r)), cancel() {} };
    } };
    const byId = doc.getElementById;
    doc.getElementById = (id) => (id === "tabbar" ? tabbar : null);
    const settle = async () => { ends.splice(0).forEach((r) => r()); await Promise.resolve(); await Promise.resolve(); };
    const last = () => moves.at(-1)[1].opacity;
    try {
      const page = openProgress();
      page.sheet.animate = () => ({ finished: new Promise(() => {}), cancel() {} });
      assert.deepEqual([moves.length, last()], [1, 0.75]);
      page.hide();
      assert.deepEqual([moves.length, last()], [2, 1]);
      const close = showSheet({ title: "Confirm" }); // a card over the app meanwhile, its own push back
      assert.deepEqual([moves.length, last()], [3, 0.75]);
      page.show();
      page.hide();
      assert.equal(moves.length, 3, "the other card keeps it back");
      close();
      assert.deepEqual([moves.length, last()], [4, 1]);
      await settle();
      page.show();
      assert.deepEqual([moves.length, moves[4][0].transform, last()], [5, "none", 0.75]);
      page.hide();
      const mid = { transform: "matrix(0.95, 0, 0, 0.95, 0, 0)", opacity: 0.9 };
      globalThis.getComputedStyle = () => ({ ...mid, getPropertyValue: () => "" });
      page.show(); // mid-way: back from where it is, to where it was
      assert.deepEqual([moves.length, moves[6][0], moves[6][1]], [7, mid, moves[4][1]]);
      page.hide();
      page.close();
      assert.deepEqual([moves.length, last()], [8, 1], "closing a hidden page moves nothing");
    } finally {
      doc.getElementById = byId;
      globalThis.getComputedStyle = gcs;
      root.removeAttribute("data-sheet");
    }
  });
});

test("openProgress: Close and the Return button end the cover", async () => {
  const { withDocument } = await import("../fakes.test-helper.js");
  const { openProgress, RETURN_LABEL } = await import("./progress.js");
  const { darkCovered } = await import("./statusbar.js");
  for (const label of ["Close", RETURN_LABEL]) {
    await withDocument(async (doc) => {
      const page = openProgress();
      page.finish();
      assert.equal(darkCovered(), true);
      const b = doc.querySelectorAll("button").find((n) => n.textContent === label);
      await (label === "Close" ? b.click() : b.onclick());
      assert.equal(darkCovered(), false, label);
    });
  }
});
