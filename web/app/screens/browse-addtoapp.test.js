// B296: the package page's nav bar Add to App (sideload build) follows the Add to an App group's tweak check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addToAppFollowsCheck, ADD_TO_APP } from "./browse.js";

const fake = (label = ADD_TO_APP) => ({ textContent: label, hidden: false });

test("Can't Go into an App, or a library: Add to App is hidden", () => {
  const b = fake();
  assert.equal(addToAppFollowsCheck({}, { ok: false, why: "Its filter names com.apple.mobiletimer." }, { button: () => b }), true);
  assert.equal(b.hidden, true);
  const lib = fake();
  addToAppFollowsCheck({}, { ok: false, library: true }, { button: () => lib });
  assert.equal(lib.hidden, true);
});

test("a tweak that goes into an app, or a check that couldn't finish, keeps Add to App", () => {
  const ok = fake();
  assert.equal(addToAppFollowsCheck({}, { ok: true, apps: [] }, { button: () => ok }), false);
  assert.equal(ok.hidden, false);
  const unknown = fake();
  addToAppFollowsCheck({}, null, { button: () => unknown });
  assert.equal(unknown.hidden, false);
});

test("another label (Install, Modify) or no button: nothing changes", () => {
  const inst = fake("Install");
  assert.equal(addToAppFollowsCheck({}, { ok: false }, { button: () => inst }), false);
  assert.equal(inst.hidden, false);
  assert.equal(addToAppFollowsCheck({}, { ok: false }, { button: () => null }), false);
});

test("wiring: the package page passes worksInGroup's check to the nav bar button", () => {
  const src = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  assert.match(src, /works\.ready\.then\(\(info\) => addToAppFollowsCheck\(body, info\)/);
});
