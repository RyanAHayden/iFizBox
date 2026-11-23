// B220: a pairing the phone no longer accepts (every RemotePairing port refused, or the pairing turned down) means
// pair again, not "couldn't connect".
import { test } from "node:test";
import assert from "node:assert/strict";

import { verifyFailure } from "./installroute.js";

const err = (message, code) => Object.assign(new Error(message), code ? { code } : {});

test("refused and turned-down pairings are unusable: Pair Again", () => {
  for (const e of [
    err("refused: this iPhone refused RemotePairing on port 49152: it no longer has this pairing. Pair again", "refused"),
    err("pairing_rejected: this iPhone didn't accept the pairing (RemotePairing(PairVerifyFailed))", "pairing_rejected"),
    err("refused: this iPhone refused RemotePairing on port 49152"), // the code read from the message
    err("connect_failed: InternalError(\"connect: Connection refused (os error 61)\") (16)", "connect_failed"),
  ]) {
    const why = verifyFailure(e);
    assert.equal(why.again, true, e.message);
    assert.equal(why.unusable, true, e.message);
    assert.equal(why.title, "Pair Again");
  }
});

test("no answer stays Couldn't Connect, not unusable", () => {
  const why = verifyFailure(err("connect_failed: timeout", "connect_failed"));
  assert.equal(why.again, false);
  assert.ok(!why.unusable);
  assert.ok(!verifyFailure(err("bad_pairing: x", "bad_pairing")).unusable);
});
