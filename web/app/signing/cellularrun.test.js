import test from "node:test";
import assert from "node:assert/strict";
import { runCellular, sayPutBackAtLaunch } from "./cellularrun.js";

const shell = (answers) => ({ call: async (name) => answers[name] });
async function said(f, answers) {
  const titles = [];
  const r = await f(shell(answers), (title) => { titles.push(title); });
  return { r, titles };
}

test("a run's put-back is said, and its answer passed on", async () => {
  for (const [putBack, titles] of [[null, []], ["on", ["Cellular Data Is Back On"]], ["failed", ["Check Cellular Data"]]]) {
    const run = { ok: !putBack, error: putBack && "no_end", putBack };
    assert.deepEqual(await said(runCellular, { "cellular.run": run }), { r: run, titles });
  }
});
test("a closed app's put-back is said at launch", async () => {
  assert.deepEqual((await said(sayPutBackAtLaunch, { "cellular.putBack": { putBack: "on" } })).titles, ["Cellular Data Is Back On"]);
  assert.deepEqual((await said(sayPutBackAtLaunch, { "cellular.putBack": { putBack: null } })).titles, []);
});
