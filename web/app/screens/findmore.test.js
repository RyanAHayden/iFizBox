// F305: Find More Sources (screens/findmore.js), Known Safe · Canister on the Sources list, and the sideload app's
// Canister flows in screens/extras.js (Other Sources · Canister, Add Source & Add to App, View Repo).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument, fakePage, tick } from "../nav/fakedom.test-helper.js";
import { createRepoCache, CANISTER_SAFE_LABEL } from "../core/canister.js";
import { PIRACY_HOSTS } from "../core/piracy-list.js";
import {
  canisterTrust, labelCanister, addRepo, findMoreOn, findMoreRow, labelOf, renderFind, renderRepo, remember, repoHref, isFind,
  searchAllRepos, NOT_CHECKED, DIRECTORY_URL,
} from "./findmore.js";
import { offerTweak, addSourceAndAddToApp, discoveryGroup, ADD_SOURCE_AND_ADD, VIEW_REPO } from "./extras.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`../core/fixtures/f305/${n}.json`, import.meta.url), "utf8"));
const rank1 = fx("ranking-1"), rank2 = fx("ranking-2"), procursus = fx("search-procursus"), dislike = fx("package-dislike");

let saved;
beforeEach(() => { saved = globalThis.document; globalThis.document = fakeDocument(); });
afterEach(() => { globalThis.document = saved; });

const memStore = () => createRepoCache({ storage: null });

test("Find More shows where APT repos are kept: jailbroken, or the sideload app", () => {
  assert.equal(findMoreOn("rootless", "site"), true);
  assert.equal(findMoreOn("none", "sideload"), true);
  assert.equal(findMoreOn("none", "site"), false, "the website while Not Jailbroken keeps no APT repos");
  assert.equal(findMoreOn("none", "jailbreak"), false);
  const row = findMoreRow();
  assert.equal(row.label, "Find More Sources");
  assert.equal(row.href, "#/sources/manage/find");
  assert.ok(isFind({ tab: "sources", path: ["manage", "find"] }));
  assert.ok(isFind({ tab: "sources", path: ["manage", "find", "chariz"] }));
  assert.ok(!isFind({ tab: "sources", path: ["manage", "recommended"] }));
});

test("Canister trust is asked once per repo, by its host, and kept", async () => {
  const asked = [];
  const store = memStore();
  const ask = async (q) => { asked.push(q); return procursus; };
  const src = { key: "deb:https://apt.procurs.us/:iphoneos-arm64-rootless/1800", uri: "https://apt.procurs.us/" };
  const r = await canisterTrust(src, { ask, store });
  assert.equal(r.tier, 1);
  assert.equal(r.bootstrap, true);
  await canisterTrust(src, { ask, store });
  assert.deepEqual(asked, ["apt.procurs.us"]);
  assert.equal(await canisterTrust({ key: "alt:https://x.example/s.json", uri: "https://x.example/s.json" }, { ask, store }), null,
    "AltStore sources aren't Canister's");
  assert.equal(await canisterTrust({ key: "deb:x", uri: `https://${PIRACY_HOSTS[0]}/` }, { ask, store }), null, "piracy repos: never");
  assert.equal(await canisterTrust({ key: "deb:y", uri: "https://down.example/" }, { ask: async () => { throw new Error("offline"); }, store }), null);
  assert.equal(store.get("https://down.example/"), undefined, "a failed ask isn't kept as a miss");
});

// A row as safety.js labelSource leaves an Unknown one: "Unknown · " then the URL.
function unknownRow() {
  const li = document.createElement("li");
  li.dataset.trust = "unknown";
  const sub = document.createElement("span");
  sub.className = "cell-subtitle";
  const word = document.createElement("span");
  word.className = "trust-word";
  word.textContent = "Unknown";
  sub.append(word, " · ", "https://repo.chariz.com/");
  // the fake DOM lacks these two
  word.replaceWith = (...n) => { const i = sub.children.indexOf(word); const rest = sub.children.splice(i); rest.shift(); sub.append(...n); sub.children.push(...rest); };
  Object.defineProperty(word, "nextSibling", { get: () => { const t = sub.children[sub.children.indexOf(word) + 1]; return t && { nodeType: 3, textContent: t._text, remove: () => sub.children.splice(sub.children.indexOf(t), 1) }; } });
  li.append(sub);
  return { li, sub };
}

test("an Unknown APT row Canister ranks Tier 1 turns Known Safe · Canister; a Tier 2 one stays Unknown", async () => {
  const store = memStore();
  const { li, sub } = unknownRow();
  const ok = await labelCanister(li, { key: "deb:https://repo.chariz.com/:./", uri: "https://repo.chariz.com/" }, { ask: async () => rank1, store });
  assert.equal(ok, true);
  assert.equal(li.dataset.trust, "canister");
  assert.equal(sub.textContent, `${CANISTER_SAFE_LABEL} https://repo.chariz.com/`);
  const two = unknownRow();
  const bb = await labelCanister(two.li, { key: "deb:http://apt.thebigboss.org/repofiles/cydia/:stable", uri: "http://apt.thebigboss.org/repofiles/cydia/" },
    { ask: async () => rank2, store });
  assert.equal(bb, false);
  assert.equal(two.li.dataset.trust, "unknown");
  const safe = unknownRow();
  safe.li.dataset.trust = "safe";
  assert.equal(await labelCanister(safe.li, { key: "deb:x", uri: "https://repo.chariz.com/" }, { ask: async () => rank1, store }), false,
    "a source already Known Safe by our list is left alone");
});

const chariz = () => ({ name: "Chariz", slug: "chariz", uri: "https://repo.chariz.com/", flat: true, dist: "./", components: [], key: "deb:https://repo.chariz.com/:./",
  tier: 1, bootstrap: false, count: 1295, https: true, gpg: true, added: false });
const unknownRepo = () => ({ name: "Someone", slug: "someone", uri: "https://someone.example/repo/", flat: true, dist: "./", components: [],
  key: "deb:https://someone.example/repo/:./", tier: 3, bootstrap: false, count: 23, https: true, gpg: false, added: false });

test("Add: a Known Safe · Canister repo adds at once; an Unknown one asks Unknown Source first", async () => {
  const added = [], asked = [], changed = [];
  const backend = { addSource: async (i) => { added.push(i); return { uri: typeof i === "string" ? i : i.uri }; } };
  const opts = { backend, unknown: async (u) => { asked.push(u); return null; }, changed: (c) => changed.push(c), alert: async () => ({ index: 0 }) };
  assert.equal(await addRepo(chariz(), "ctx", opts), true);
  assert.deepEqual(added, ["https://repo.chariz.com/"]);
  assert.deepEqual(asked, []);
  assert.deepEqual(changed, ["ctx"], "Sources hears of it and loads it");
  assert.equal(await addRepo(unknownRepo(), "ctx", opts), false, "Cancel on Unknown Source adds nothing");
  assert.deepEqual(asked, ["https://someone.example/repo/"]);
  assert.equal(added.length, 1);
  const bb = { ...unknownRepo(), name: "BigBoss", uri: "http://apt.thebigboss.org/repofiles/cydia/", flat: false, dist: "stable", components: ["main"] };
  assert.equal(await addRepo(bb, "ctx", opts), true, "BigBoss is on our own known-safe list: no question");
  assert.deepEqual(added[1], { uri: "http://apt.thebigboss.org/repofiles/cydia/", dist: "stable", components: ["main"] });
  assert.equal(await addRepo({ ...chariz(), uri: `https://${PIRACY_HOSTS[0]}/` }, "ctx", opts), false, "a piracy repo is never added from here");
});

test("Add: the row's button holds the spinner at once, ADDED once in, back to ADD when the add fails", async () => {
  const b = document.createElement("button");
  const states = [];
  let fail = false;
  const backend = { addSource: async () => { states.push([b.textContent, b.classList.contains("adding")]); if (fail) throw new Error("No Release file"); return {}; } };
  const alerts = [];
  const opts = { button: b, backend, changed: () => {}, alert: async (a) => { alerts.push(a.message); return { index: 0 }; } };
  await addRepo(chariz(), null, opts);
  assert.deepEqual(states[0], ["", true], "the spinner alone while it's added");
  assert.equal(b.textContent, "ADDED");
  assert.equal(b.classList.contains("added"), true);
  assert.equal(b.disabled, true);
  fail = true;
  await addRepo(chariz(), null, opts);
  assert.equal(b.textContent, "ADD");
  assert.equal(b.disabled, false);
  assert.deepEqual(alerts, ["No Release file"]);
});

test("labels: our list first, then Canister's tier 1 / bootstrap, then the user's Trusted", () => {
  assert.equal(labelOf(chariz(), { trusted: [] }).kind, "safe", "Chariz is on our own list (Recommended) already");
  assert.equal(labelOf({ ...unknownRepo(), tier: 1 }, { trusted: [] }).kind, "canister");
  assert.equal(labelOf({ ...unknownRepo(), bootstrap: true }, { trusted: ["someone.example"] }).kind, "canister");
  assert.equal(labelOf(unknownRepo(), { trusted: [] }).kind, "unknown");
  assert.equal(labelOf(unknownRepo(), { trusted: ["someone.example"] }).kind, "trusted");
  assert.equal(labelOf({ ...unknownRepo(), uri: "https://apt.procurs.us/" }, { trusted: [] }).kind, "safe");
});

const fakeApi = (over = {}) => ({
  ranking: async (r) => (r === 1 ? rank1 : r === 2 ? rank2 : { data: [] }),
  repos: async () => rank1,
  repo: async () => ({ data: rank2.data.find((x) => x.id === "bigboss") }),
  packages: async () => ({ data: [] }),
  search: async () => dislike,
  ...over,
});

test("Find More: Popular on Canister, Add on each row, ios-repo-updates under Other Directories, Canister credited", async () => {
  const page = fakePage();
  const f = renderFind(page, null, { api: fakeApi(), sources: async () => [{ uri: "https://havoc.app/" }] });
  await f.ready;
  const text = f.el.textContent;
  assert.match(text, /Popular on Canister/);
  assert.match(text, /Chariz/);
  assert.match(text, /Other Directories/);
  assert.match(text, /ios-repo-updates\.com/);
  assert.match(text, new RegExp(NOT_CHECKED));
  assert.match(text, /canister\.me/);
  assert.match(text, /Piracy repos are never shown/);
  const rows = f.el.querySelectorAll(".find-row");
  assert.ok(rows.length > 5);
  const havoc = rows.find((li) => li.dataset.slug === "havoc");
  assert.equal(havoc.querySelector(".find-add").textContent, "ADDED", "a repo already in the list says ADDED");
  const ch = rows.find((li) => li.dataset.slug === "chariz");
  assert.equal(ch.querySelector(".find-add").textContent, "ADD");
  // B272: More Sources' ADD / ADDED (the price button), not Recommended's old blue pill
  assert.ok(ch.querySelector(".find-add").classList.contains("price-btn") && ch.querySelector(".find-add").classList.contains("rec-add"));
  assert.ok(!ch.querySelector(".rec-get"));
  assert.match(ch.textContent, /Known Safe/);
  const poom = rows.find((li) => li.dataset.slug === "poomsmart");
  assert.match(poom.textContent, /Unknown · /, "a tier 2 repo on no list is Unknown");
  assert.equal(DIRECTORY_URL, "https://ios-repo-updates.com/");
});

test("Find More: a search lists Canister's matching repos; piracy ones never", async () => {
  const page = fakePage();
  const bad = { data: [...rank1.data, { id: "bad", slug: "bad", uri: `https://${PIRACY_HOSTS[0]}/`, name: "Free Tweaks", package_count: 50, quality: 1 }] };
  const f = renderFind(page, null, { api: fakeApi({ repos: async () => bad }), sources: async () => [] });
  await f.ready;
  await f.draw("free");
  const text = f.el.textContent;
  assert.match(text, /3 Repos/);
  assert.doesNotMatch(text, /Free Tweaks/);
});

test("a repo's page: Trust (Label, Why, HTTPS, Signed Releases) and Packages; Tweaks for Sideloaded Apps in the sideload app", async () => {
  const page = fakePage();
  const api = fakeApi({ packages: async () => ({ data: [
    { package_id: "com.a.tweak", name: "A", version: "1", architecture: "iphoneos-arm64", section: "Tweaks", repository_id: "bigboss" },
    { package_id: "com.b.theme", name: "B", version: "1", architecture: "iphoneos-arm64", section: "Themes", repository_id: "bigboss" },
  ] }) });
  const r = await renderRepo(page, "bigboss", null, { api, sources: async () => [], sideload: () => true });
  assert.equal(r.name, "BigBoss");
  const text = page.textContent;
  for (const w of ["Trust", "Label", "Why", "HTTPS", "Signed Releases", "Tweaks for Sideloaded Apps", "All Packages"]) assert.match(text, new RegExp(w));
  assert.match(text, /Known Safe/, "BigBoss is on our own list");
  assert.match(text, /HTTPSNo/);
  assert.match(text, /without encryption/);
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(page.querySelector(".find-tweaks").querySelector(".cell-detail").textContent, "1", "only the injectable tweak counts");
  const jb = fakePage();
  await renderRepo(jb, "bigboss", null, { api, sources: async () => [], sideload: () => false });
  assert.doesNotMatch(jb.textContent, /Tweaks for Sideloaded Apps/);
});

test("a repo's page: the head icon sits clipped in the letter's slot and shows only once it loads", async () => {
  const page = fakePage();
  await renderRepo(page, "bigboss", null, { api: fakeApi(), sources: async () => [], sideload: () => false });
  const icon = page.querySelector(".find-head")?.querySelector(".cell-icon");
  assert.ok(icon, "the head row keeps its letter slot");
  const css = readFileSync(new URL("../sources.css", import.meta.url), "utf8");
  const rule = (sel) => css.match(new RegExp(`^${sel.replace(/[.*()]/g,"\\$&")} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
  assert.match(rule(".find-head .cell-icon"), /overflow: hidden/);
  assert.match(rule(".find-head .cell-icon img"), /inset: 0; width: 100%; height: 100%/);
  assert.match(rule(".find-head .cell-icon img:not(.loaded)"), /opacity: 0/, "a failed icon leaves the letter");
});

test("B461: the pinned section header draws over the rows' ADD buttons", () => {
  const css = readFileSync(new URL("../sources.css", import.meta.url), "utf8");
  assert.match(css, /\.find-row \.find-add, \.rec-more-row \.rec-add \{ z-index: 0; \}/);
  assert.match(css, /\.section-header:has\(~ \.find-row\) \{ z-index: 2; \}/);
});

test("View Repo's link keeps the row, so the repo's page names it at once", async () => {
  const href = repoHref(chariz());
  assert.equal(href, "#/sources/manage/find/chariz");
  const { nav } = await import("./findmore.js");
  assert.equal(nav({ tab: "sources", path: ["manage", "find", "chariz"] }).title, "Chariz");
  remember({ ...chariz(), added: true });
  assert.equal(nav({ tab: "sources", path: ["manage", "find", "chariz"] }).right.label, "Added");
  assert.equal(nav({ tab: "sources", path: ["manage", "find"] }).title, "Find More");
});

// ---- extras.js: the sideload app's Search ----

const tweakRow = (repo) => ({ id: "com.x.ryd", name: "RYD Plus", version: "1", repo: { name: repo.name, uri: repo.uri, slug: repo.slug, flat: true,
  dist: "./", components: [], tier: repo.tier, bootstrap: false } });

test("a tweak from a repo not added: Add Source & Add to App and View Repo; an Unknown repo says it isn't checked", async () => {
  let seen = null;
  const sheet = async (o) => { seen = o; return -1; };
  assert.equal(await offerTweak(tweakRow(unknownRepo()), null, { sheet }), "cancel");
  assert.deepEqual(seen.buttons, [ADD_SOURCE_AND_ADD, VIEW_REPO]);
  assert.match(seen.title, /RYD Plus is in Someone, which you haven't added\. iFizBox hasn't checked this repo\./);
  await offerTweak(tweakRow(chariz()), null, { sheet });
  assert.doesNotMatch(seen.title, /hasn't checked/);
  await offerTweak(tweakRow(chariz()), null, { sheet, viewRepo: false });
  assert.deepEqual(seen.buttons, [ADD_SOURCE_AND_ADD]);
  const went = [];
  assert.equal(await offerTweak(tweakRow(chariz()), null, { sheet: async () => 1, go: (h) => went.push(h) }), "view");
  assert.deepEqual(went, ["#/sources/manage/find/chariz"]);
  assert.equal(await offerTweak(tweakRow(chariz()), null, { sheet: async () => 0, add: async () => "added" }), "added");
});

function fakeDeps({ listed = true } = {}) {
  const log = [];
  const key = "deb:https://repo.chariz.com/:./";
  return {
    log,
    deps: {
      backend: {
        addSource: async (i) => { log.push(["add", i]); return { key, uri: "https://repo.chariz.com/" }; },
        sources: async () => [{ key, uri: "https://repo.chariz.com/" }],
        refreshSources: async (_each, { filter }) => { log.push(["refresh", filter({ key })]); return [{ key }]; },
      },
      catalog: { ensure: async () => {}, package: async (id, k) => (listed ? { key: k, stanza: { package: id, name: "RYD Plus", version: "1" } } : null) },
      showHUD: (l) => { log.push(["hud", l]); return () => {}; },
      showAlert: async (a) => { log.push(["alert", a.title]); return { index: 0 }; },
      addToApp: async (st) => { log.push(["addToApp", st.package]); return null; },
      changed: () => log.push(["changed"]),
    },
  };
}

test("Add Source & Add to App: adds the repo, refreshes it alone, then the tweak's Add to App picker", async () => {
  const { log, deps } = fakeDeps();
  assert.equal(await addSourceAndAddToApp(tweakRow(chariz()), deps), "added");
  assert.deepEqual(log, [["hud", "Verifying URL"], ["add", "https://repo.chariz.com/"], ["hud", "Reloading Data"], ["refresh", true],
    ["changed"], ["addToApp", "com.x.ryd"]]);
  const miss = fakeDeps({ listed: false });
  assert.equal(await addSourceAndAddToApp(tweakRow(chariz()), miss.deps), "missing");
  assert.ok(miss.log.some(([k, v]) => k === "alert" && v === "Not Found"));
  assert.ok(!miss.log.some(([k]) => k === "addToApp"));
});

test("the sideload app's Other Sources · Canister lists only injectable tweaks, never from a piracy repo", async () => {
  const pirate = { package_id: "com.p.tweak", name: "Pirated Tweak", version: "1", architecture: "iphoneos-arm64", section: "Tweaks",
    repository: { uri: `https://${PIRACY_HOSTS[0]}/`, name: "Pirates", suite: "./" } };
  const theme = { ...dislike.data[0], package_id: "com.t.theme", name: "Some Theme", section: "Themes" };
  const g = discoveryGroup(null, { search: async () => ({ data: [...dislike.data, pirate, theme] }), sources: async () => [], wait: 0,
    tweaks: () => true, label: () => ({ kind: "unknown", label: "Unknown" }) });
  await g.search("dislike");
  const text = g.el.textContent;
  assert.match(text, /Other Sources · Canister/);
  assert.match(text, /Return YouTube Dislike/);
  assert.doesNotMatch(text, /Pirated Tweak/);
  assert.doesNotMatch(text, /Some Theme/);
  assert.match(text, /Unknown · Chariz/);
});

test("Search All Repos: Canister's packages, tweaks for sideloaded apps only, already searching the app's name", async () => {
  let asked = null;
  const s = searchAllRepos({ appName: "YouTube", api: fakeApi({ search: async (q) => { asked = q; return dislike; } }), sources: async () => [],
    sheet: () => () => {} });
  const rows = await s.ready;
  assert.equal(asked, "YouTube");
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((r) => r.section === "Tweaks"));
  assert.match(s.el.textContent, /found by Canister/);
});

test("wiring: More Sources opens Find More (F327), Manage routes find/…, Search asks in the sideload app", () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
  const sources = read("./sources.js");
  assert.match(sources, /labelCanister\(li, source\)/);
  const manage = read("./manage.js");
  assert.match(manage, /findMore\.isFind\(route\)\) return findMore\.render/);
  assert.match(read("./moresources.js"), /label: "Find Tweak Sources", subtitle: "[^"]+", href: findHref\(\)/);
  assert.match(read("./search.js"), /tweakSourcesOn\(settings\.deviceType\(\), detectMode\(\)\)\) \? q : ""/);
  assert.match(read("./home.js"), /label: "Canister"/);
});
