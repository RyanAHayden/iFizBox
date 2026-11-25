// The Filter panel on its own (screens/filterpanel.js): each page's filters stay its own, one panel at a time, and it
// goes away when its page is left. Search's use of it: screens/search.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument, memStorage, tick } from "../fakes.test-helper.js";

globalThis.localStorage ??= memStorage();
globalThis.document = fakeDocument();
const listening = new Set(); // the hashchange listeners
globalThis.addEventListener = (type, f) => { if (type === "hashchange") listening.add(f); };
globalThis.removeEventListener = (type, f) => listening.delete(f);
const go = () => { for (const f of [...listening]) f(); };
const { openFilterPanel, emptyFilters, searchFilters } = await import("./filterpanel.js");

const anchor = { getBoundingClientRect: () => ({ bottom: 100.4 }) };
function page(over = {}) {
  const p = { filters: emptyFilters(), open: true, changed: 0, closed: 0 };
  p.show = () => openFilterPanel({ filters: p.filters, anchor, alive: () => p.open,
    changed: () => p.changed++, closed: () => p.closed++, ...over });
  return p;
}
const panels = () => document.body.querySelectorAll(".filter-drop");
// A row of the panel opened last, by its label.
const rows = () => panels().at(-1).querySelectorAll(".cell-inner");
const row = (label) => rows().find((n) => n.textContent.startsWith(label));
const tap = (label) => row(label).click();

test("F426a: two pages' filters stay separate", async () => {
  const a = page(), b = page();
  const first = a.show();
  assert.equal(panels()[0].style.top, "100px", "under its anchor");
  assert.equal(row("Clear Filters"), undefined, "nothing set yet");
  await tap("Not Installed");
  await tap("All Themes");
  assert.deepEqual(searchFilters(a.filters), { section: "group:Themes", installed: "not" });
  assert.equal(a.changed, 2);
  assert.ok(row("Clear Filters"));
  first.close();
  await tick();
  assert.equal(a.closed, 1);
  assert.equal(panels().length, 0);

  b.show();
  assert.equal(searchFilters(b.filters), undefined, "the second page starts clean");
  assert.equal(row("Clear Filters"), undefined);
  await tap("Paid");
  assert.deepEqual(searchFilters(b.filters), { price: "paid" });
  assert.deepEqual(searchFilters(a.filters), { section: "group:Themes", installed: "not" });
  await tap("Clear Filters");
  assert.equal(searchFilters(b.filters), undefined);
  assert.deepEqual(searchFilters(a.filters), { section: "group:Themes", installed: "not" }, "clearing one leaves the other");
  assert.deepEqual([a.changed, b.changed], [2, 2]);

  a.show();
  await tick();
  assert.equal(b.closed, 1, "one panel at a time");
  assert.equal(panels().length, 1);
  a.open = false;
  go();
  await tick();
  assert.equal(panels().length, 0);
});

test("F426a: it closes once its page is left, and only then", async () => {
  const p = page();
  const panel = p.show();
  go();
  assert.equal(p.closed, 0, "its page is still the open one");
  p.open = false;
  go();
  await tick();
  assert.equal(p.closed, 1);
  assert.equal(panels().length, 0);
  assert.equal(listening.size, 0, "nothing listens on");
  panel.close();
  assert.equal(p.closed, 1, "closed once");
});

test("F426a: each page's filters are its own object", () => {
  assert.notEqual(emptyFilters(), emptyFilters());
});
