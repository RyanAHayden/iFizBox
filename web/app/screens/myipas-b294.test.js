// B294: the IPA page's footer under Sign Now / Save Signed IPA follows Install Apps With: This iPhone names its VPN
// and no Signing Server; the Signing Server keeps its install-manifest line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionsFooter } from "./myipas.js";

test("actionsFooter: This iPhone says the VPN, not the Signing Server's manifest", () => {
  const f = actionsFooter("iphone");
  assert.match(f, /only iFizBox VPN to this iPhone, no Signing Server/i);
  assert.doesNotMatch(f, /manifest/);
});

test("actionsFooter: the Signing Server (and anything else) keeps the manifest line", () => {
  for (const r of ["server", undefined]) {
    assert.equal(actionsFooter(r), "Signing happens on this iPhone and works offline. Installing needs a connection only for the Signing Server's install manifest.");
  }
});
