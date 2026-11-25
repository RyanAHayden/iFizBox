// F265: a file in pieces (the signed IPA: mostly parts of the one that was downloaded), read without putting it
// together in memory.
//
//   piecedBytes(x) -> { length, subarray(from, to) }   x: Uint8Array pieces in order, or one Uint8Array or ArrayBuffer.
//       subarray joins only the bytes asked for
//   joinPieces(x) -> Uint8Array                        all of it
//   pieceBuffers(x) -> [ArrayBuffer]                   the buffers behind it, each once (to transfer to another thread)
// SPDX-License-Identifier: GPL-3.0-or-later
const listOf = (x) => (Array.isArray(x) ? x : [x instanceof Uint8Array ? x : new Uint8Array(x)]);

export function piecedBytes(x) {
  const list = listOf(x), starts = [];
  let length = 0;
  for (const p of list) { starts.push(length); length += p.length; }
  return {
    length,
    subarray(from = 0, to = length) {
      const a = Math.max(0, Math.min(from, length)), b = Math.max(a, Math.min(to, length));
      let lo = 0, hi = list.length - 1; // the last piece that starts at or before `a`
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= a) lo = mid; else hi = mid - 1;
      }
      if (list[lo] && b <= starts[lo] + list[lo].length) return list[lo].subarray(a - starts[lo], b - starts[lo]);
      const out = new Uint8Array(b - a);
      for (let i = lo; i < list.length && starts[i] < b; i++) {
        const p = list[i].subarray(Math.max(0, a - starts[i]), b - starts[i]);
        out.set(p, Math.max(starts[i], a) - a);
      }
      return out;
    },
  };
}

export const joinPieces = (x) => piecedBytes(x).subarray();

export const pieceBuffers = (x) => [...new Set(listOf(x).map((p) => p.buffer))];
