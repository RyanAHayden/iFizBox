// F348: Cydia's tall package rows in Installed and a source's section lists; Search keeps the compact row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromLine, WIDE_ROW_HEIGHT } from "./browse.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the from line names the author and the section", () => {
  assert.equal(fromLine({ author: "ModMyi", section: "Addons" }), "from ModMyi (Addons)");
  assert.equal(fromLine({ author: "Saurik", section: "" }), "from Saurik");
  assert.equal(fromLine({ author: "", section: "Tweaks" }), "from Unknown (Tweaks)");
  assert.equal(fromLine({}), "from Unknown");
  assert.equal(fromLine({ author: "Themes", section: "Themes" }), "from Themes"); // not said twice
});

test("the wide row's CSS height is the list's row height (the virtualised list places rows by it)", () => {
  const css = read("../packages.css");
  assert.match(css, new RegExp(`\\.pkg-row\\.wide \\{ height: ${WIDE_ROW_HEIGHT}px;`));
  assert.match(css, new RegExp(`\\.pkg-vlist\\.wide \\{[^}]*height='${WIDE_ROW_HEIGHT}'`));
});

test("Installed and section lists ask for wide rows, Search does not", () => {
  assert.match(read("./installed.js"), /browse\.packageList\(results, state\.route, items, \{ letters: mode !== "recent", wide: true \}\)/);
  assert.match(read("./browse.js"), /packageList\(body, route, rows, \{ letters, wide: true \}\)/);
  assert.doesNotMatch(read("./search.js"), /wide: true/);
});
