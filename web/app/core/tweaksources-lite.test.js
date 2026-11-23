// F344a: the sideload app's Tweak Sources. Its defaults are app-tweak sources only (GitHub repos whose releases carry
// the tweak's .deb), and a Tweak Source the Tweak Index found nothing in for the user's apps is left out of the list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  injectSourcesFrom, githubDefaultsFrom, loadTweakSources, tweakSourceVerdict, tweakIndexDone, usableTweak, askTweakIndex,
  shownTweakSources, TWEAK_SOURCES_FILE,
} from "./sources.js";
import { githubTweakRecord, isGithubSource } from "./github.js";

const raw = JSON.parse(readFileSync(new URL(`../${TWEAK_SOURCES_FILE}`, import.meta.url), "utf8"));

test("Lite's defaults are GitHub tweak repos only; the jailbroken defaults never get them", async () => {
  const lite = injectSourcesFrom(raw);
  assert.ok(lite.length >= 1);
  assert.ok(lite.every(isGithubSource), "no jailbreak APT repo (BigBoss, Havoc, Chariz) is a Lite default any more");
  assert.deepEqual(lite.map((s) => `${s.github.user}/${s.github.repo}`), raw.filter((s) => s.inject).map((s) => s.github));
  const jb = await loadTweakSources();
  assert.ok(jb.length && !jb.some(isGithubSource), "the jailbroken defaults stay APT repos");
  for (const name of ["Chariz", "Havoc"]) assert.ok(jb.some((s) => s.name === name), `${name} stays a jailbroken default`);
  // The old rootful repos (BigBoss, Telesphoreo at apt.saurik.com) are no default at all.
  assert.ok(!raw.some((s) => /bigboss|saurik/i.test(`${s.name} ${s.uri ?? ""}`)), "no BigBoss or Telesphoreo default");
});

test("a seeded GitHub default has the key and shape Add Source would save for that repo", async () => {
  const [rec] = githubDefaultsFrom([{ name: "YTLite", github: "dayanch96/YTLite", inject: true }]);
  const added = await githubTweakRecord({ user: "dayanch96", repo: "YTLite" }, { info: { name: "YTLite" }, releases: [] });
  assert.equal(rec.key, added.key);
  assert.equal(rec.uri, added.uri);
  assert.deepEqual(rec.github, added.github);
  assert.equal(rec.name, "YTLite");
  assert.deepEqual(githubDefaultsFrom([{ github: "no slash" }, { github: "a/.." }, { github: "-x/y" }, { github: 7 }, null]), []);
  assert.equal(githubDefaultsFrom([{ github: "a/b" }, { github: "a/b" }]).length, 1);
});

const done = (tweaks) => ({ enabled: true, known: true, refreshed: 1700000000, pending: 0, tweaks });
const yt = { package: "a", ok: true, bundles: ["com.google.ios.youtube"], anyApp: false, systemOnly: false };
const sb = { package: "b", ok: true, bundles: ["com.apple.springboard"], anyApp: false, systemOnly: true };
const any = { package: "c", ok: true, bundles: [], anyApp: true, systemOnly: false };
const bad = { package: "d", ok: false, bundles: ["com.google.ios.youtube"], anyApp: false };

test("verdict: a source is out only when the index checked all of it and nothing works in the user's apps", () => {
  assert.equal(tweakSourceVerdict(done([yt, sb]), ["com.google.ios.YouTube"]), true, "bundle IDs compare without case");
  assert.equal(tweakSourceVerdict(done([yt, sb, bad]), ["com.burbn.instagram"]), false);
  assert.equal(tweakSourceVerdict(done([sb, any]), []), true, "an every-app tweak works in any app");
  assert.equal(tweakSourceVerdict(done([]), ["x"]), false);
  // not known: nothing is hidden
  assert.equal(tweakSourceVerdict(null, ["x"]), null);
  assert.equal(tweakSourceVerdict({ enabled: false, tweaks: [] }, ["x"]), null);
  assert.equal(tweakSourceVerdict({ ...done([]), pending: 3 }, ["x"]), null, "still being read");
  assert.equal(tweakSourceVerdict({ ...done([]), refreshed: 0 }, ["x"]), null, "Packages not read yet");
  assert.equal(tweakSourceVerdict({ ...done([]), error: "HTTP 404" }, ["x"]), null, "a failed read");
  assert.equal(tweakIndexDone(done([])), true);
  // a paid tweak's guessed app counts (unverified), but an unverified every-app guess doesn't
  assert.equal(usableTweak({ ok: true, bundles: ["x.y"], unverified: true }, new Set(["x.y"])), true);
  assert.equal(usableTweak({ ok: true, bundles: [], anyApp: true, unverified: true }, new Set()), false);
});

test("askTweakIndex asks /api/tweaks for every tweak of an APT source, never for a GitHub one", async () => {
  const asked = [];
  const get = async (u) => { asked.push(u); return { ok: true, json: async () => done([yt]) }; };
  const base = "https://x.example/api/tweaks";
  const a = await askTweakIndex({ uri: "https://havoc.app/", dist: "./", components: [] }, { get, base });
  assert.equal(a.tweaks.length, 1);
  assert.equal(asked[0], `${base}?source=https%3A%2F%2Fhavoc.app%2F&dist=.%2F`);
  assert.ok(!asked[0].includes("bundle="));
  assert.equal(await askTweakIndex(githubDefaultsFrom([{ github: "a/b" }])[0], { get, base }), null);
  assert.equal(asked.length, 1);
  assert.equal(await askTweakIndex({ uri: "https://havoc.app/", dist: "./" }, { get: async () => { throw new Error("offline"); }, base }), null);
  assert.equal(await askTweakIndex({ uri: "https://havoc.app/", dist: "./" }, { get: async () => ({ ok: false }), base }), null);
});

test("shownTweakSources leaves the hidden keys out", () => {
  const list = [{ key: "a" }, { key: "b" }];
  assert.deepEqual(shownTweakSources(list, new Set(["b"])).map((s) => s.key), ["a"]);
  assert.equal(shownTweakSources(list, null), list);
});
