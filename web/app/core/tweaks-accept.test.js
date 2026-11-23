// Add Tweak… picker: iOS greys out files whose extension it has no file type for (.dylib, .deb), so the accept
// string must also take any data; the name is checked after picking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareTweaks, TWEAK_ACCEPT } from "./tweaks.js";

test("accept keeps .dylib and .deb pickable on iOS", () => {
  const parts = TWEAK_ACCEPT.split(",");
  for (const ext of [".dylib", ".deb", ".zip", ".framework"]) assert.ok(parts.includes(ext), ext);
  assert.ok(parts.includes("application/octet-stream"));
});

test("a picked file with another name is refused after picking", () => {
  assert.throws(() => prepareTweaks([{ name: "notes.txt", data: new Uint8Array([1, 2, 3]) }]),
    /add a \.dylib, a \.deb or a zipped \.framework/);
});
