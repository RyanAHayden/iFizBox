// A virtualised plain table for long package lists (30k rows at 120 Hz): only the rows on screen, plus a margin,
// exist in the DOM. They are absolutely placed inside one tall spacer and moved by transform, so scrolling stays
// on the compositor; a scroll only re-binds the few rows that entered the window. Section headers ("A", "B", …)
// are rows too, and one copy (CSS sticky, so the compositor holds it in place) shows the current section and is
// pushed up by the next, as in UITableView. Styles: packages.css (.vlist).
//
//   const list = createVList(scroller, {
//     items,                       // [{ header: "A" } | row data], in order
//     rowHeight: 58, headerHeight: 23,
//     createRow() -> Element,      // an empty row; made once per pooled node
//     bindRow(el, item, index),    // fills a row for an item (text only: no layout reads)
//     idle(el, item),              // after scrolling stops, for the rows on screen (load icons here)
//   });
//   list.el                        // put it in the scroller
//   list.setItems(items)  list.destroy()

const OVERSCAN = 600; // px drawn above and below the window: one fast frame at 120 Hz never reaches blank space

export function createVList(scroller, { items = [], rowHeight = 58, headerHeight = 23, createRow, bindRow, idle = null }) {
  const el = document.createElement("div");
  el.className = "vlist";
  el.setAttribute("role", "list");
  const sticky = document.createElement("div");
  sticky.className = "section-header vlist-sticky";
  sticky.setAttribute("aria-hidden", "true");
  el.append(sticky);

  let tops = new Float64Array(0); // each item's y
  let headers = [];               // indexes of header items
  let total = 0;
  const live = new Map();         // item index -> node
  const rowPool = [];
  const headPool = [];
  let frame = 0;
  let idleTimer = 0;
  let viewH = 0;
  let stickyText = null;
  let stickyY = null;

  function layout(list) {
    items = list;
    tops = new Float64Array(items.length);
    headers = [];
    let y = 0;
    for (let i = 0; i < items.length; i++) {
      tops[i] = y;
      if (items[i].header != null) { headers.push(i); y += headerHeight; } else y += rowHeight;
    }
    total = y;
    el.style.height = `${total}px`;
  }

  const heightOf = (i) => (items[i].header != null ? headerHeight : rowHeight);

  // The first item whose bottom is below y.
  function indexAt(y) {
    let lo = 0, hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] + heightOf(mid) <= y) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function take(i) {
    const isHead = items[i].header != null;
    let node = (isHead ? headPool : rowPool).pop();
    if (!node) {
      if (isHead) {
        node = document.createElement("div");
        node.className = "section-header vlist-header";
      } else {
        node = createRow();
        node.classList.add("vlist-row");
      }
      el.append(node);
    } else node.hidden = false;
    if (isHead) node.textContent = items[i].header;
    else bindRow(node, items[i], i);
    node.style.transform = `translateY(${tops[i]}px)`;
    return node;
  }

  function release(i, node) {
    node.hidden = true; // stays in the DOM: re-showing is cheaper than re-inserting
    (node.classList.contains("vlist-header") ? headPool : rowPool).push(node);
  }

  // The scrollTop at which the list's top meets the top of the window. The window starts below the scroller's padding
  // (a page's is its nav bar, and the sticky header sits under that), which offsetTop counts in.
  const listTop = () => el.offsetTop - (parseFloat(globalThis.getComputedStyle?.(scroller).paddingTop) || 0);

  function update() {
    frame = 0;
    if (!items.length) {
      for (const [i, n] of live) release(i, n);
      live.clear();
      sticky.hidden = true;
      return;
    }
    // Where the list starts (listTop), cached: reading offsetTop right after moving rows forced a full layout
    // every frame of a fling. Re-read only when sizes change (onResize) or the items do.
    offset ??= listTop();
    const top = scroller.scrollTop - offset;
    viewH ||= scroller.clientHeight;
    const first = indexAt(Math.max(0, top - OVERSCAN));
    const last = indexAt(Math.min(total - 1, top + viewH + OVERSCAN));
    for (const [i, n] of live) if (i < first || i > last) { release(i, n); live.delete(i); }
    for (let i = first; i <= last; i++) if (!live.has(i)) live.set(i, take(i));
    placeSticky(top);
  }

  // The header of the section at the top of the window, pushed up when the next header meets it.
  function placeSticky(top) {
    if (!headers.length || top < 0) { sticky.hidden = true; return; }
    let h = -1;
    let lo = 0, hi = headers.length - 1;
    while (lo <= hi) { // last header at or above top
      const mid = (lo + hi) >> 1;
      if (tops[headers[mid]] <= top) { h = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (h < 0) { sticky.hidden = true; return; }
    sticky.hidden = false;
    const text = items[headers[h]].header;
    if (text !== stickyText) { sticky.textContent = text; stickyText = text; }
    const next = headers[h + 1];
    const push = next === undefined ? 0 : Math.min(0, tops[next] - top - headerHeight);
    const y = push; // CSS sticky keeps it at the top; only the push is ours
    if (y !== stickyY) { sticky.style.transform = `translateY(${y}px)`; stickyY = y; }
  }

  function settle() {
    idleTimer = 0;
    if (!idle) return;
    offset ??= listTop();
    const top = scroller.scrollTop - offset;
    for (const [i, n] of live) {
      if (items[i].header == null && tops[i] + rowHeight > top && tops[i] < top + viewH) idle(n, items[i]);
    }
  }

  // Rows are placed in the scroll event itself, not a frame later: the browser sends one scroll event per frame,
  // and waiting for the next frame left the rows a frame behind, so dragging the scroll bar (thousands of px a
  // move) mostly showed the placeholder rows.
  function onScroll() {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    update();
    if (idle) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(settle, 120);
    }
  }
  let offset = null; // see update()
  const onResize = () => { viewH = scroller.clientHeight; offset = null; onScroll(); };

  scroller.addEventListener("scroll", onScroll, { passive: true });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  ro?.observe(scroller);
  ro?.observe(el); // the list moved or resized: re-read its offset

  function setItems(list) {
    offset = null;
    for (const [i, n] of live) release(i, n);
    live.clear();
    stickyText = null;
    stickyY = null;
    layout(list);
    // Bind on the next frame, once the list is in the document and the scroller has its size.
    if (!frame) frame = requestAnimationFrame(update);
    if (idle) { clearTimeout(idleTimer); idleTimer = setTimeout(settle, 120); }
  }

  layout(items);
  if (items.length) frame = requestAnimationFrame(update);
  if (idle && items.length) idleTimer = setTimeout(settle, 120);

  return {
    el,
    setItems,
    refresh: () => { for (const [i, n] of live) if (items[i].header == null) bindRow(n, items[i], i); },
    // Each header's text and the scrollTop that puts it at the top of the window (the section index jumps there).
    // Measured now and kept, so the rows and the sticky header are placed from the same offset after the jump, also
    // when the jump ends where the list already is and no scroll event comes.
    headerTops: () => {
      const was = offset;
      offset = listTop();
      if (was !== null && was !== offset) update();
      return headers.map((i) => ({ text: items[i].header, top: offset + tops[i] }));
    },
    destroy() {
      scroller.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(idleTimer);
    },
  };
}

// Cydia's name-sorted list: a header before each new first letter. `letter(item)` gives it.
export function withLetterHeaders(rows, letter) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    const l = letter(r);
    if (l !== cur) { out.push({ header: l }); cur = l; }
    out.push(r);
  }
  return out;
}
