// F394: an Install Switch from before the one-trip run keeps working, and its page offers Update.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../fakes.test-helper.js";

globalThis.document ??= fakeDocument();
const { shortcutGroups } = await import("./installroute.js");
const { switchOld } = await import("../core/installroute.js");

test("Update shows only for an added Install Switch that can't do one trip, on an app that can", () => {
  const vpn = (trips, sw, trip) => ({ trips, shortcuts: { switch: sw, trip } });
  assert.equal(switchOld(vpn(true, true, false)), true);
  for (const v of [vpn(true, true, true), vpn(true, false, false), vpn(false, true, false), null, { shortcuts: { switch: true } }]) assert.equal(switchOld(v), false);
  const added = [];
  const old = shortcutGroups(vpn(true, true, false), { add: (k) => added.push(k) });
  assert.equal(old[0].rows[0].detail, "Update");
  old[0].rows[0].onClick();
  assert.deepEqual(added, ["switch"]);
  assert.match(old[0].footer, /Replace/);
  assert.match(old[1].footer, /once each way/, "its test still runs the old way");
  const now = shortcutGroups(vpn(true, true, true));
  assert.equal(now[0].rows[0].detail, "Added");
  assert.match(now[1].footer, /^Runs it once:/);
});
