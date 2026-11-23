// SPDX-License-Identifier: GPL-3.0-or-later
// B385: a picture that fills its icon slot (position: absolute; inset: 0) needs the slot positioned, or it fills the
// whole page: a source page's app rows draw theirs in .cell-icon.alt-app-icon.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./altstore.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const decls = (sel) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].trim() === sel).map((m) => m[2]).join(";");

for (const slot of [".alt-app-icon", ".source-head-icon"]) {
  test(`${slot} holds the picture that fills it`, () => {
    assert.match(decls(`${slot} img`), /position:\s*absolute/);
    assert.match(decls(slot), /position:\s*relative/);
  });
}
