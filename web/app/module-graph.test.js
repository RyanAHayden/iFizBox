// F313: what the app loads before its first page. app.js's static import closure (every module reached through
// `import … from` / `export … from`, never through import()) is parsed and run before Home draws, so it stays small:
// the other tabs, Browse and Settings' parts load at their routes or in the background (lazy.js, router.js lazyFor).
// A new static import that pulls one of those back into startup fails here; reach it through lazy.js instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { LAZY, LAZY_NAMES } from "./lazy.js";
import { lazyFor, LAZY_TABS, SETTINGS_PARTS, BROWSE_PARTS, TAB_TITLES, TABS, settingsRoute, rootOn } from "./router.js";

const root = dirname(fileURLToPath(import.meta.url));
// The bound F313 set (169 modules, 2.74 MB before; 104 after). Raise it only with a reason in the commit.
// C28 split signing-client.js into signing/ (14 files for 1, the same code): 119, so 124.
// C32: core/tweaks.js + core/unpack.js, the website's signer (signing/browser.js and its parts) and screens/guides.js
// left startup (1.55 MB -> 1.34 MB): 114, so 117.
// F382: core/sourcefilters.js, which the worker's catalog and the settings store both need at startup: 118.
const MAX_MODULES = 118;

// Static imports only: `import x from "…"`, `import "…"`, `export … from "…"` at the start of a line (multi-line
// lists included). import() calls are not matched.
const STATIC = /^[ \t]*(?:import|export)\s+(?:[^'"`;()]*?\s+from\s+)?["']([^"']+)["']/gm;
function staticClosure(entry) {
  const seen = new Map(); // file -> the file that first imported it
  const queue = [[entry, null]];
  while (queue.length) {
    const [file, from] = queue.shift();
    if (seen.has(file)) continue;
    seen.set(file, from);
    for (const m of readFileSync(file, "utf8").matchAll(STATIC)) {
      if (m[1].startsWith(".")) queue.push([resolve(dirname(file), m[1]), file]);
    }
  }
  return seen;
}
const chain = (seen, file) => {
  const out = [];
  for (let f = file; f; f = seen.get(f)) out.push(relative(root, f));
  return out.join(" <- ");
};

const closure = staticClosure(join(root, "app.js"));

test(`app.js's static import closure stays under ${MAX_MODULES} modules`, () => {
  assert.ok(closure.size < MAX_MODULES, `${closure.size} modules load at startup`);
});

test("no lazily loaded module is in the startup closure", () => {
  const leaks = LAZY_NAMES.map((n) => resolve(root, LAZY[n])).filter((f) => closure.has(f));
  assert.deepEqual(leaks.map((f) => chain(closure, f)), []);
});

test("the heavy screens stay out of startup", () => {
  for (const f of ["screens/browse.js", "screens/altstore.js", "screens/myipas.js", "screens/devaccount.js",
    "screens/free-apple-id.js", "screens/tweaks.js", "core/gsa.js", "core/asc.js",
    // C32
    "core/tweaks.js", "core/unpack.js", "signing/browser.js", "signing/early.js", "signing/toobig.js",
    "signing/watch.js", "signing/prompt.js", "screens/guides.js"]) {
    assert.ok(!closure.has(join(root, f)), `${f} loads at startup: ${chain(closure, join(root, f))}`);
  }
});

test("lazy.js names files that exist, and router.js asks only for names lazy.js has", () => {
  for (const n of LAZY_NAMES) assert.ok(existsSync(resolve(root, LAZY[n])), `${n}: ${LAZY[n]}`);
  for (const n of [...LAZY_TABS, ...SETTINGS_PARTS, ...BROWSE_PARTS]) assert.ok(LAZY[n], n);
});

test("the tab bar's titles are the screens' own", async () => {
  for (const tab of TABS) {
    const screen = await import(`./screens/${tab}.js`);
    assert.equal(TAB_TITLES[tab], screen.title, tab);
  }
});

test("lazyFor: what each route waits for", () => {
  assert.deepEqual(lazyFor({ tab: "home", path: [] }), []);
  assert.deepEqual(lazyFor({ tab: "home", path: ["guides"] }), ["guides"]);
  assert.deepEqual(lazyFor({ tab: "home", path: ["guides", "faq", "app"] }), ["guides"]);
  assert.deepEqual(lazyFor({ tab: "installed", path: [] }), ["installed"]);
  assert.deepEqual(lazyFor({ tab: "sources", path: ["manage", "sources"] }), ["sources"]);
  assert.deepEqual(lazyFor(settingsRoute()), SETTINGS_PARTS);
  assert.deepEqual(lazyFor(settingsRoute(["signing", "help"])), SETTINGS_PARTS);
  assert.deepEqual(lazyFor({ tab: "home", path: ["browse"] }), BROWSE_PARTS);
  assert.deepEqual(lazyFor({ tab: "home", path: ["wishlist", "com.example"] }), BROWSE_PARTS);
  // another tab's pages pushed on Home's stack wait for that tab's screen
  assert.deepEqual(lazyFor({ tab: "home", path: ["~installed", "myipas"] }), ["installed"]);
  assert.deepEqual(lazyFor(rootOn("changes")), ["changes"]);
});
