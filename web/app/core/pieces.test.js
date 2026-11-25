// F265: a file in pieces (core/pieces.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { piecedBytes, joinPieces, pieceBuffers } from "./pieces.js";

test("any part of the pieces, as the whole would give it", () => {
  const whole = Uint8Array.from({ length: 10 }, (_, i) => i);
  const list = [whole.subarray(0, 3), whole.subarray(3, 3), whole.slice(3, 4), whole.subarray(4)];
  const p = piecedBytes(list);
  assert.equal(p.length, 10);
  for (let a = 0; a <= 10; a++) for (let b = a; b <= 12; b++) assert.deepEqual(p.subarray(a, b), whole.slice(a, b), `${a}..${b}`);
  assert.deepEqual(joinPieces(list), whole);
  assert.equal(p.subarray(4, 9).buffer, whole.buffer, "inside one piece: no copy");
});

test("one array is one piece; each buffer once; nothing at all", () => {
  const b = new Uint8Array([1, 2]);
  assert.deepEqual(piecedBytes(b.buffer).subarray(0, 2), b);
  assert.equal(joinPieces(b).buffer, b.buffer);
  assert.deepEqual(pieceBuffers([b, b.subarray(1), new Uint8Array(1)]).length, 2);
  assert.equal(piecedBytes([]).length, 0);
  assert.equal(piecedBytes([]).subarray(0, 5).length, 0);
});
