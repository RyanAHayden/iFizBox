// F451: /app?id=… links (Share iFizBox link on an app's page) and the source's /add link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appLink, parseAppLink, isAppPath, addLink, parseAddLink, isAddPath } from "./handoff.js";

test("an app link round-trips its id", () => {
  const l = appLink("com.x.y z".replace(" ", "+"), "https://ifizbox.com/");
  assert.equal(l, "https://ifizbox.com/app?id=com.x.y%2Bz");
  assert.equal(parseAppLink(new URL(l).search), "com.x.y+z");
});
test("app links refuse empty, spaced or slashed ids", () => {
  assert.equal(appLink("", "https://a"), null);
  assert.equal(appLink("a/b", "https://a"), null);
  assert.equal(parseAppLink("?id=a%20b"), null);
  assert.equal(parseAppLink(""), null);
});
test("paths", () => {
  assert.ok(isAppPath("/app") && isAppPath("/x/app/") && !isAppPath("/add") && !isAppPath("/apps"));
  assert.ok(isAddPath("/add"));
});
test("a source's share link is its add link and parses back", () => {
  const l = addLink({ key: "deb:https://r.example/:./", uri: "https://r.example/", dist: "./" }, "https://ifizbox.com");
  assert.deepEqual(parseAddLink(new URL(l).search), { url: "https://r.example/" });
});
