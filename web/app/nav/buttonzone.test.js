// F392: a row's button owns the row's whole right end (nav/ui.js buttonZone): a tap there is the button's, never the
// row's link's; a disabled button takes nothing, and a row drawn again has one zone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { el, buttonZone } from "./ui.js";
import { withDocument } from "../fakes.test-helper.js";

test("a tap on the zone taps the button and stops there", () => withDocument(() => {
  const li = el("li", "cell");
  const b = el("button", "price-btn");
  let taps = 0;
  b.addEventListener("click", () => { taps++; });
  const zone = buttonZone(li, b);
  assert.ok(li.classList.contains("has-zone"));
  const seen = [];
  const tap = (z) => z.listeners.click[0]({ preventDefault: () => seen.push("prevented"), stopPropagation: () => seen.push("stopped") });
  tap(zone);
  assert.equal(taps, 1);
  assert.deepEqual(seen, ["prevented", "stopped"]);
  b.disabled = true;
  tap(zone);
  assert.equal(taps, 1);
  b.remove();
  buttonZone(li, el("button", "price-btn"));
  assert.equal(li.querySelectorAll(".tap-zone").length, 1);
}));
