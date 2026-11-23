// F163: the row that opened a page stays blue on the page below, and fades out as that page comes back, the way
// UITableView's deselectRowAtIndexPath:animated: rides the pop's transitionCoordinator: fully blue when the pop
// starts, gone when the page below is back in place. The edge swipe drives it from the finger (a cancelled swipe
// brings it back to full), Back fades it over the pop slide.
//
// Opacity only, so the compositor runs it at 120 Hz: the blue look is a copy of the row ("ghost", the row with the
// app's own .is-pressed look) laid over it, and only the copy's opacity changes. The row itself goes back to normal
// at once, under the copy.

// Highlight opacity at navigation progress p (nav/transition.js: 1 the opened page in place, 0 the page below back).
export function selectionOpacity(p) {
  if (!(p > 0)) return 0; // NaN too
  return p >= 1 ? 1 : p;
}

// Lay a blue copy over `row` (a .cell-inner). Returns { el, remove() }; el is the element a pop fades, or null.
export function selectRow(row, win = globalThis) {
  const li = row?.parentElement;
  if (!li || !row.isConnected) return null;
  const ghost = row.cloneNode(true);
  for (const n of [ghost, ...ghost.querySelectorAll("[id]")]) n.removeAttribute?.("id");
  ghost.removeAttribute("href");
  ghost.classList.add("is-pressed", "sel-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  // The copy covers the row exactly: the row's cell is its containing block (a vlist row is absolute already).
  let restore = null;
  if (win.getComputedStyle?.(li).position === "static") {
    li.style.position = "relative";
    restore = () => { li.style.position = ""; };
  }
  li.append(ghost);
  return {
    el: ghost,
    remove() {
      ghost.remove();
      if (restore) restore();
      restore = null;
    },
  };
}

// Lists re-render while their page is hidden (Sources redraws its counts), which takes the copy away with the old
// row. So the opened row is also remembered by what it opens (its href) or, for a button row, its label, and found
// again in the page when the pop starts.
export function rowKey(row) {
  const href = row?.getAttribute?.("href");
  if (href) return { href };
  const label = row?.querySelector?.(".cell-label")?.textContent || row?.textContent || "";
  return label.trim() ? { label: label.trim() } : null;
}

export function findRow(root, key) {
  if (!root || !key) return null;
  for (const row of root.querySelectorAll(".cell-inner:not(.sel-ghost)")) {
    if (key.href ? row.getAttribute("href") === key.href : rowKey(row)?.label === key.label) return row;
  }
  return null;
}

// The selection of a page below: { key, mark } (mark: selectRow's result, or null). ghostFor() returns the copy to
// fade, laying a new one over the row as it is now when the old copy went with a re-render.
export function keepRow(row, win = globalThis) {
  const key = rowKey(row);
  return key ? { key, mark: selectRow(row, win) } : null;
}

export function ghostFor(sel, root, win = globalThis) {
  if (!sel) return null;
  if (sel.mark?.el.isConnected) return sel.mark.el;
  sel.mark?.remove();
  sel.mark = selectRow(findRow(root, sel.key), win);
  return sel.mark?.el ?? null;
}

// C12: the Select / Deselect bar button of a list in manage mode (Installed > Apps, My IPAs). With something picked
// it deselects everything (no sheet); otherwise an action sheet of presets ("All", "Expiring Soon", ...) replaces
// the selection with the chosen preset's rows. The screen passes in its own parts:
//   selecting   true when the button reads Select (nothing picked)
//   options()   [{ label, preset }] for the sheet
//   apply(p)    select preset p's rows;  clear()  deselect everything
// Resolves with the preset picked, "none" after a deselect, or null when the sheet is cancelled.
// B370: one sheet at a time. A tap while it is still open (the glass bar's button sits above the page, so it can
// still be tapped; the shell's own sheet too) does nothing and resolves null, so fast repeat taps never stack a second
// sheet or act on the selection the first one is about to change.
let presetOpen = false;
export async function selectPreset({ selecting, options, apply, clear, sheet }) {
  if (presetOpen) return null;
  if (!selecting) { clear(); return "none"; }
  const opts = options();
  presetOpen = true;
  let i;
  try { i = await sheet({ buttons: opts.map((o) => o.label) }); } finally { presetOpen = false; }
  if (!(i >= 0) || !opts[i]) return null;
  apply(opts[i].preset);
  return opts[i].preset;
}
