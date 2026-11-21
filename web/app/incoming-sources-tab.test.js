// B306: a source from a link (another sideloader's altstore://source…, ifizbox://add) lands on the Sources tab's list,
// Add Source's alert over it, not on Sources > Manage > Sources: the hash is the Sources tab's root, the tab bar
// selects Sources (a plain tab switch, wherever the app was), and once added the new source shows in that list
// loading, under the Sources tab's own reload bar (the link's add brings no screen ctx: fromLink). The real router,
// stacks and sources.js with a fake backend; no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleIncoming, SOURCES_ROOT } from "./incoming.js";
import { TABS, createRouter, parse, format } from "./router.js";
import { createStacks } from "./nav/stack.js";
import { useContext, isLoading } from "./screens/sources.js";
import { sourcesChanged } from "./screens/manage.js";
import { getBackend } from "./backend.js";

globalThis.document ??= { querySelectorAll: () => [], querySelector: () => null };
globalThis.CSS ??= { escape: (s) => String(s) };

const SRC = "https://repo.example.com/apps.json";

// The router and stacks as app.js drives them: the tab bar selects the stacks' active tab (app.js showRoute).
function app(hash) {
  const listeners = new Set();
  const location = {
    _hash: hash,
    get hash() { return this._hash; },
    set hash(h) { const n = h.startsWith("#") ? h : "#" + h; if (n !== this._hash) { this._hash = n; listeners.forEach((f) => f()); } },
  };
  const win = {
    location,
    history: { replaceState(_s, _t, url) { location._hash = url; } },
    addEventListener(type, f) { if (type === "hashchange") listeners.add(f); },
    removeEventListener(type, f) { if (type === "hashchange") listeners.delete(f); },
  };
  const stacks = createStacks({ tabs: TABS, create: (tab, path) => ({ tab, path }) });
  const router = createRouter({ win, onRoute: (r) => stacks.sync(r) });
  router.start();
  return { win, router, selected: () => stacks.activeTab(), open: (h) => { location.hash = h; } };
}

const until = async (cond, what) => {
  const end = Date.now() + 10000;
  while (!cond()) {
    if (Date.now() > end) throw new Error(what);
    await new Promise((r) => setTimeout(r, 5));
  }
};

for (const start of ["#/home", "#/home/settings/sideloading", "#/installed/myipas", "#/sources/manage/sources", "#/search"]) {
  test(`an other app's source link from ${start}: the Sources tab's root, Sources selected, Add Source filled in`, async () => {
    const a = app(start);
    const adds = [];
    const r = await handleIncoming(`altstore://source?url=${encodeURIComponent(SRC)}`, {
      on: () => true, hud: () => () => {}, open: a.open, add: async (ctx, prefill) => { adds.push({ ctx, prefill }); },
    });
    assert.equal(r, "other-source");
    assert.equal(a.win.location.hash, SOURCES_ROOT);
    assert.deepEqual(parse(SOURCES_ROOT), { tab: "sources", path: [] });
    assert.equal(a.selected(), "sources");
    assert.deepEqual(adds.map((x) => x.prefill), [{ url: SRC }]);
    assert.equal(adds[0].ctx.fromLink, true, "the Sources tab loads the new source with its own ctx");
  });
}

test("ifizbox://add: the Sources tab's root too, Sources selected", async () => {
  const a = app("#/changes");
  const adds = [];
  await handleIncoming("ifizbox://add?url=https://repo.example.com/", { hud: () => () => {}, open: a.open, add: async (ctx, prefill) => { adds.push({ ctx, prefill }); } });
  assert.equal(a.win.location.hash, SOURCES_ROOT);
  assert.equal(a.selected(), "sources");
  assert.deepEqual(adds.map((x) => x.prefill), [{ url: "https://repo.example.com/" }]);
  assert.equal(adds[0].ctx.fromLink, true);
});

test("Manage's pages, opened from the Sources tab, keep Sources selected", () => {
  const a = app("#/sources");
  for (const path of [["manage"], ["manage", "sources"], ["manage", "hidden"], ["manage", "recommended"]]) {
    a.router.go({ tab: "sources", path });
    assert.equal(a.selected(), "sources", format({ tab: "sources", path }));
  }
  a.router.selectTab("home");
  a.router.selectTab("sources"); // back where it was left: Manage, Sources selected
  assert.equal(a.win.location.hash, "#/sources/manage/recommended");
  assert.equal(a.selected(), "sources");
});

test("the source the link added shows in the Sources list, loading under the tab's reload bar", async () => {
  const list = [];
  const asked = [];
  Object.assign(getBackend(), {
    sources: async () => list.map((s) => ({ ...s })),
    async addSource(input) {
      const rec = { key: `alt:${input}`, kind: "altstore", uri: input, name: null, count: null, updated: null, error: null };
      list.push(rec);
      return rec;
    },
    async refreshSources(onEach, { filter } = {}) {
      const keys = list.filter((s) => filter?.(s)).map((s) => s.key);
      asked.push(keys);
      await new Promise((r) => setTimeout(r, 5));
      for (const k of keys) {
        const i = list.findIndex((s) => s.key === k);
        list[i] = { ...list[i], name: "Example", updated: Date.now(), count: 1 };
        onEach?.(list[i]);
      }
      return keys.map((k) => list.find((s) => s.key === k));
    },
  });
  const bars = [];
  const badges = [];
  const tabCtx = { // the app's ctx, which app.js hands the Sources tab (useContext)
    setBadge: (tab, n) => badges.push([tab, n]),
    reloadBar(text) { const bar = { text, hidden: false, set(t) { this.text = t; }, hide() { this.hidden = true; } }; bars.push(bar); return bar; },
    loadData: async () => {},
  };
  useContext(tabCtx);
  const a = app("#/home");
  // Add Source's last steps (screens/manage.js addSource): the backend saves it, then the change notice; a link's
  // ctx (fromLink) hands no ctx of its own to it.
  const add = async (ctx, prefill) => {
    await getBackend().addSource(prefill.url);
    sourcesChanged(ctx.fromLink ? undefined : ctx);
  };
  await handleIncoming(`altstore://source?url=${encodeURIComponent(SRC)}`, { on: () => true, hud: () => () => {}, open: a.open, add });
  assert.equal(a.win.location.hash, SOURCES_ROOT);
  await until(() => asked.length, "the new source never started loading");
  assert.deepEqual(asked[0], [`alt:${SRC}`], "the new source loads at once");
  assert.equal(bars.length, 1, "under the Sources tab's reload bar");
  assert.ok(badges.some(([tab, n]) => tab === "sources" && n === "spinner"), "the Sources badge spins while it loads");
  await until(() => !isLoading(), "the load never ended");
  assert.equal((await getBackend().sources()).find((s) => s.key === `alt:${SRC}`)?.name, "Example");
});
