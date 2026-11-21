// The website's /add?url=… link (app.js, F8) lands like the app's own source links (incoming.js addFromLink): the
// Sources tab at its root, Add Source's alert over it, and the add runs with fromLink so the Sources tab loads the new
// source with its own ctx (manage.js addSource), not on a Manage page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { format, parse } from "./router.js";
import { SOURCES_ROOT } from "./incoming.js";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const start = app.indexOf("const addFrom = isAddPath(");
const block = app.slice(start, app.indexOf("\n}", start) + 2);

test("/add replaces the address with the Sources tab root", () => {
  assert.ok(start > 0, "app.js reads the /add link");
  assert.match(block, /format\(\{ tab: "sources" \}\)/);
  assert.doesNotMatch(block, /manage/);
  assert.equal(format({ tab: "sources" }), SOURCES_ROOT);
  assert.deepEqual(parse(SOURCES_ROOT), { tab: "sources", path: [] });
});

test("/add's Add Source runs from the link (fromLink), not with a screen's ctx", () => {
  const call = app.slice(app.indexOf("if (addFrom)"), app.indexOf("\n", app.indexOf("if (addFrom)")));
  assert.match(call, /addSource\(\{ showHUD: ctx\.showHUD, fromLink: true \}, addFrom\)/);
});
