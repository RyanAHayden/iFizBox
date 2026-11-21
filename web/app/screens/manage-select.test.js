// Manage > Sources picks sources like Installed's Manage: a circle per row, the grey line over the list
// ("2 selected · 3 sources · 1,204 apps · 1 not loading") and the bottom toolbar (Select All / Deselect, Delete (n)),
// counted as the Sources tab counts its badges and failed rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceSummary, sourceTally, sourceToolbar, deleteSourcesLabel, setSourceRowState } from "./manage.js";

test("the grey line: sources, apps or packages, not loading; N selected only with a pick", () => {
  const tallies = [{ count: 1000, failed: false }, { count: 204, failed: false }, { count: 0, failed: true }];
  assert.equal(sourceSummary(tallies, 0, false), "3 sources · 1,204 apps · 1 not loading");
  assert.equal(sourceSummary(tallies, 2, false), "2 selected · 3 sources · 1,204 apps · 1 not loading");
  assert.equal(sourceSummary(tallies, 1, true), "1 selected · 3 sources · 1,204 packages · 1 not loading");
  assert.equal(sourceSummary([{ count: 1, failed: false }], 0, true), "1 source · 1 package · 0 not loading");
  assert.equal(sourceSummary([], 0, false), "0 sources · 0 apps · 0 not loading");
});

test("a source counts as its Sources tab row: the refresh's count and failure first, else the stored ones", () => {
  setSourceRowState(() => null);
  assert.deepEqual(sourceTally({ key: "a", count: 12 }), { count: 12, failed: false });
  assert.deepEqual(sourceTally({ key: "a", error: "Not Responding" }), { count: 0, failed: true });
  // a refresh landed: its count; failed: the red badge even with no stored error
  assert.deepEqual(sourceTally({ key: "a", count: 12 }, { count: 30, failed: false }), { count: 30, failed: false });
  assert.deepEqual(sourceTally({ key: "a", count: 12 }, { count: null, failed: true }), { count: 12, failed: true });
  // a refresh that lands fine clears an old stored error, as the row's red goes
  assert.deepEqual(sourceTally({ key: "a", count: 5, error: "x" }, { count: 5, failed: false }), { count: 5, failed: false });
  // the hook sources.js sets is read by default
  setSourceRowState((key) => (key === "b" ? { count: 7, failed: false } : null));
  assert.deepEqual(sourceTally({ key: "b", count: 1 }), { count: 7, failed: false });
  assert.deepEqual(sourceTally({ key: "c", count: 1 }), { count: 1, failed: false });
  setSourceRowState(null);
  assert.deepEqual(sourceTally({ key: "b", count: 1 }), { count: 1, failed: false });
});

test("the toolbar: Select All until every row is picked, then Deselect; Delete (n) dimmed with nothing picked", () => {
  assert.deepEqual(sourceToolbar(3, 0), {
    select: { label: "Select All", disabled: false }, delete: { label: "Delete", disabled: true } });
  assert.deepEqual(sourceToolbar(3, 2), {
    select: { label: "Select All", disabled: false }, delete: { label: "Delete (2)", disabled: false } });
  assert.deepEqual(sourceToolbar(3, 3), {
    select: { label: "Deselect", disabled: false }, delete: { label: "Delete (3)", disabled: false } });
  // only the built-in source: nothing to pick
  assert.deepEqual(sourceToolbar(0, 0), {
    select: { label: "Select All", disabled: true }, delete: { label: "Delete", disabled: true } });
});

test("the action sheet's button names one source, or counts several", () => {
  assert.equal(deleteSourcesLabel(["BigBoss"]), "Delete BigBoss");
  assert.equal(deleteSourcesLabel(["BigBoss", "Havoc", "Chariz"]), "Delete 3 Sources");
});
