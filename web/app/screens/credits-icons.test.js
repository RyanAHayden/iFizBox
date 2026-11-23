// Every Credits row shows its project's picture (icon.src), with the letter kept as the fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window ??= { open() {} };
const { softwareSections } = await import("./home.js");

test("every Credits > Software row has a picture and a letter fallback", () => {
  const rows = softwareSections().flatMap((g) => g.rows);
  assert.deepEqual(rows.map((r) => r.label), ["ElleKit", "Canister", "zsign", "OpenSSL", "zlib", "idevice"]);
  for (const r of rows) {
    assert.match(r.icon.src || "", /^https:\/\//, r.label);
    assert.equal(r.icon.text, r.label.charAt(0).toUpperCase(), r.label);
  }
});

test("Special Thanks and Artwork rows each give a picture too", () => {
  const js = readFileSync(new URL("./home.js", import.meta.url), "utf8");
  const credits = js.slice(js.indexOf("function renderCredits"), js.indexOf("...softwareSections()"));
  const icons = credits.match(/icon: \{[^}]*\}/g);
  assert.equal(icons.length, 3); // the Special Thanks map, Section Icons, Interface Wording
  for (const i of icons) assert.match(i, /src: /, i);
});
