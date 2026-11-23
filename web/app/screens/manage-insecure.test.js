// F220: Add Source and http:// sources. An http URL is tried over https first and added that way without a word;
// with no https twin, an iOS 6 alert ("This Source Is Not Secure", Cancel / Add) asks first. https sources never
// see the alert. The source page's footer note marks http sources only (BigBoss among them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSecure, INSECURE_ALERT } from "./manage.js";
import { loadTweakSources } from "../core/sources.js";

const DEFAULT_SOURCES = await loadTweakSources(); // web/app/tweak-sources.json
import { httpsInput, insecureNote, isInsecureSource, INSECURE_NOTE } from "../core/sources.js";

// A backend that adds only the URLs in `works`, and an alert that answers `tap` (a button index).
function rig({ works = [], tap = 1 } = {}) {
  const added = [], tried = [], alerts = [], huds = [];
  const backend = {
    async addSource(input) {
      const uri = typeof input === "string" ? input : input.uri;
      tried.push(uri);
      if (!works.includes(uri)) throw Object.assign(new Error("Could not reach " + uri), { title: "Verification Error" });
      const rec = { key: "deb:" + uri, uri };
      added.push(rec);
      return rec;
    },
  };
  const showHUD = (t) => { huds.push(t); return () => huds.push("hide"); };
  const alert = async (a) => { alerts.push(a); return { index: tap }; };
  return { backend, showHUD, alert, added, tried, alerts, huds };
}

test("F220: http with a working https twin: the https one is added, no alert", async () => {
  const r = rig({ works: ["https://repo.test/"] });
  const rec = await addSecure("http://repo.test/", r);
  assert.equal(rec.uri, "https://repo.test/");
  assert.deepEqual(r.added.map((s) => s.uri), ["https://repo.test/"]);
  assert.deepEqual(r.tried, ["https://repo.test/"], "the http one is never fetched");
  assert.equal(r.alerts.length, 0);
  assert.deepEqual(r.huds, ["Verifying URL", "hide"]);
});

test("F220: http only: the Not Secure alert, Cancel adds nothing", async () => {
  const r = rig({ works: ["http://repo.test/"], tap: 0 });
  assert.equal(await addSecure("http://repo.test/", r), null);
  assert.equal(r.added.length, 0);
  assert.deepEqual(r.tried, ["https://repo.test/"]);
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0], INSECURE_ALERT);
  assert.equal(r.huds.at(-1), "hide", "no HUD left up behind the alert");
});

test("F220: http only: Add adds the http source", async () => {
  const r = rig({ works: ["http://repo.test/"], tap: 1 });
  const rec = await addSecure("http://repo.test/", r);
  assert.equal(rec.uri, "http://repo.test/");
  assert.deepEqual(r.added.map((s) => s.uri), ["http://repo.test/"]);
  assert.equal(r.alerts.length, 1);
});

test("F220: http only, Add, and the http one fails too: the backend's error comes through", async () => {
  const r = rig({ works: [], tap: 1 });
  await assert.rejects(addSecure("http://gone.test/", r), /Could not reach http:\/\/gone\.test\//);
  assert.equal(r.huds.at(-1), "hide");
});

test("F220: https: no alert, added once", async () => {
  const r = rig({ works: ["https://repo.test/"] });
  await addSecure("https://repo.test/", r);
  assert.deepEqual(r.tried, ["https://repo.test/"]);
  assert.equal(r.alerts.length, 0);
});

test("F220: a dist repo over http keeps its suite and components on the https try", async () => {
  const r = rig({ works: ["https://repo.test/"] });
  const input = { uri: "http://repo.test/", dist: "stable", components: ["main"] };
  assert.deepEqual(httpsInput(input), { uri: "https://repo.test/", dist: "stable", components: ["main"] });
  await addSecure(input, r);
  assert.equal(r.alerts.length, 0);
  assert.deepEqual(r.tried, ["https://repo.test/"]);
});

test("F220: the alert's words and buttons: Cancel (the darker cancel button) / Add", () => {
  assert.equal(INSECURE_ALERT.title, "This Source Is Not Secure");
  assert.match(INSECURE_ALERT.message, /without encryption/);
  assert.deepEqual(INSECURE_ALERT.buttons, ["Cancel", "Add"]);
  assert.equal(INSECURE_ALERT.cancel, 0);
});

test("F220: the Not Secure mark goes on http sources only, BigBoss included", () => {
  assert.equal(insecureNote({ uri: "http://repo.test/" }), INSECURE_NOTE);
  assert.equal(insecureNote({ uri: "HTTP://repo.test/" }), INSECURE_NOTE);
  assert.equal(insecureNote({ uri: "https://repo.test/" }), null);
  assert.equal(insecureNote({ key: "alt:https://x.test/s.json", uri: "https://x.test/s.json" }), null);
  assert.equal(insecureNote({}), null);
  assert.equal(isInsecureSource("http://a.test/"), true);
  assert.equal(httpsInput("https://a.test/"), null);
  assert.equal(insecureNote({ name: "BigBoss", uri: "http://apt.thebigboss.org/repofiles/cydia/", dist: "stable" }), INSECURE_NOTE);});
