// B409: the shared .deb's Confirm sheet when ifizbox-helper couldn't ask apt: plain words, wrapped, the right footer.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDebConfirm } from "./sharedeb.js";
import { NAME } from "../brand.js";
import { fakeDocument } from "../fakes.test-helper.js";

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function refused(title, message, check) {
  test(title, async () => {
    const saved = [globalThis.document, globalThis.requestAnimationFrame];
    const doc = globalThis.document = fakeDocument();
    globalThis.requestAnimationFrame = () => 0;
    const calls = [];
    const native = { call: async (method) => { calls.push(method); if (method === "share.debSimulate") throw new Error(message); } };
    try {
      const run = openDebConfirm({ file: "x.deb", name: "Tweak.deb" }, { native });
      await settle();
      const sheet = doc.body.querySelector(".confirm-sheet");
      const block = sheet.querySelector(".confirm-problem");
      assert.equal(sheet.querySelector("h1").textContent, "Cannot Comply");
      assert.equal(block.querySelectorAll(".cell-label").length, 0, "a wrapping block, not a one-line label");
      check(block.querySelectorAll(".pkg-description").map((e) => e.textContent), block.querySelector(".group-footer").textContent);
      sheet.querySelector(".sheet-left").children[0].click();
      assert.deepEqual(await run, { ok: false });
      assert.deepEqual(calls, ["share.debSimulate", "share.discard"]);
    } finally { [globalThis.document, globalThis.requestAnimationFrame] = saved; }
  });
}

const kept = (pattern) => ([sentence, ...more], footer) => {
  assert.match(sentence, pattern);
  assert.doesNotMatch(sentence, /ifizbox-helper|these packages|\/var\//);
  assert.deepEqual(more, []);
  assert.equal(footer, "Nothing was changed.");
};

refused("the wrong caller", "ifizbox-helper: the calling process isn't the installed app", kept(/^iOS didn't let .* run apt/));
refused("a path the helper won't take", "ifizbox-helper: bad .deb path (only /var/mobile/Library/Caches/com.ryha.ifizbox/deb/<name>.deb)",
  kept(/can't hand Tweak\.deb to apt.*Share it again/));
refused("the staged file is gone", "gone: that shared file isn't there any more; share it again", kept(/^Tweak\.deb isn't there any more\. Share it again\.$/));
refused("a file it can't take", "ifizbox-helper: the .deb isn't a plain file of the app's own (one link, not root's, at most 1 GiB)",
  kept(/Tweak\.deb to apt: it is empty, larger than 1 GiB/));
refused("a missing copy", "ifizbox-helper: can't open the .deb (missing, or a link)", kept(/its copy is missing or is a link\. Share it again\.$/));
refused("any other reason", "ifizbox-helper: prefix too long", kept(/couldn't ask apt about Tweak\.deb: prefix too long$/));
refused("a missing helper", "ifizbox-helper is not installed at /var/jb/usr/libexec/ifizbox-helper", (sentences, footer) => {
  assert.match(sentences[0], /is missing from this iPhone/);
  assert.equal(footer, `Reinstalling ${NAME} puts it back.`);
});
