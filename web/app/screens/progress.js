// The progress page's log lines (nav/progress.js), batched so selecting text in the log stays smooth while an install
// runs. Selecting text there had lagged and Select All's Copy callout took long to show: every new line re-laid the
// log out under the selection, and the install server's byte lines come many times a second.
//
//   const log = createLogBuffer({ container, make, fragment, raf, caf, held, max })
//   log.push({ kind, text, pkg })   queued; at most one requestAnimationFrame, which makes one container.append
//                                   of a fragment holding the lines queued since (never the whole log rewritten);
//                                   past PER_FRAME lines the rest go on the next frames
//   log.flush()                     appends what waits now (finish, filter, show) unless a selection holds it
//   log.release()                   the selection ended: what waited goes out on the next frame
//   log.cancel()                    drops the frame (the page closed)
//   log.pending                     lines waiting
//
// A raw line that repeats the one before it with only its numbers changed ("Sent bytes 0-65535; 65536 of
// 40000000 bytes sent to iOS","Downloading 45%") replaces it: in the queue if it hasn't gone out, else the line on screen gets
// the new text (one text node, on the frame). While held() is true (a selection in the log: selectionIn) nothing is
// appended or changed; release() sends it all in one go once the selection ends. No layout reads here.
// SPDX-License-Identifier: GPL-3.0-or-later

// Lines one frame appends at most: what a selection held goes out over a few frames, none of them a long task.
export const PER_FRAME = 400;

// The line with its numbers masked: two raw lines with the same shape are one line updating.
export function lineShape(entry) {
  const t = String(entry?.text ?? "");
  if (entry?.kind !== "raw" || !/\d/.test(t)) return null;
  return `${entry.pkg ?? ""}\u0000${t.replace(/\d+(?:[.,]\d+)*/g, "#")}`;
}

// True when the document's selection is in `node` (a range not collapsed, touching it). doc: the document (tests).
export function selectionIn(node, doc = globalThis.document) {
  const s = doc?.getSelection?.();
  if (!node || !s || !s.rangeCount || s.isCollapsed) return false;
  const inside = (n) => Boolean(n) && (n === node || Boolean(node.contains?.(n)));
  if (inside(s.anchorNode) || inside(s.focusNode)) return true;
  try { return Boolean(s.getRangeAt(0).intersectsNode?.(node)); } catch { return false; }
}

export function createLogBuffer({
  container, make, fragment = () => globalThis.document.createDocumentFragment(),
  raf = (f) => globalThis.requestAnimationFrame(f), caf = (id) => globalThis.cancelAnimationFrame?.(id),
  held = () => false, max = Infinity, perFrame = PER_FRAME, onFlush = () => {},
} = {}) {
  let queue = [];     // entries not on screen yet
  let tail = null;    // the last line on screen: { shape, node }
  let retext = null;  // { node, text }: the last line on screen gets this text on the frame
  let frame = 0;

  const schedule = () => { if (!frame && !held()) frame = raf(run); };
  const run = () => { frame = 0; flush(perFrame); };

  // `most`: lines this call appends at most (the frame's PER_FRAME; an explicit flush, all of them)
  const flush = (most = Infinity) => {
    if (frame) { caf(frame); frame = 0; }
    if (held() || (!queue.length && !retext)) return false;
    if (retext) { retext.node.textContent = retext.text; retext = null; }
    if (queue.length) {
      const frag = fragment();
      let last = null;
      const batch = queue.length > most ? queue.splice(0, most) : queue.splice(0);
      for (const e of batch) { last = make(e); frag.append(last); }
      container.append(frag);
      tail = { shape: lineShape(batch.at(-1)), node: last };
    }
    onFlush();
    if (queue.length) schedule(); // a long queue (lines held by a selection) goes out over the next frames
    return true;
  };

  return {
    push(entry) {
      const shape = lineShape(entry);
      const before = queue.at(-1);
      if (shape && before && lineShape(before) === shape) queue[queue.length - 1] = entry;
      else if (shape && !before && tail?.shape === shape && tail.node?.parentNode) retext = { node: tail.node, text: entry.text };
      else {
        queue.push(entry);
        if (queue.length > max) queue.splice(0, queue.length - max);
      }
      schedule();
    },
    flush: () => flush(),
    release() { schedule(); },
    cancel() { if (frame) caf(frame); frame = 0; queue = []; retext = null; },
    get pending() { return queue.length + (retext ? 1 : 0); },
  };
}
