// F313: modules the app loads when it needs them, not at startup. app.js draws Home with only what it imports
// statically (module-graph.test.js keeps that set small); the modules named here load:
//   - before a route that draws with them shows (router.js lazyFor; app.js waits for them, so a push still slides
//     in with its page drawn),
//   - on a press that may open such a route (app.js, at pointerdown, ahead of the click),
//   - and all of them in the background once the first page is up (app.js), so a later tap never waits.
// Code on the startup path reaches them with mod(name) where it draws (a page's nav and render: loaded by then) and
// with load(name) everywhere else (handlers, launch work). A page drawn before its module is in (a link the map
// doesn't know) gets NotLoaded from mod(); app.js draws it again once the module is there.
//
// Under node (the unit tests import screens without app.js), mod() loads a module synchronously (require of an ES
// module), so tests draw any page straight away. Browsers have no `process` and never take that path.
export const LAZY = {
  // the tabs other than Home (and Settings, whose pages live on Home's stack)
  sources: "./screens/sources.js",
  changes: "./screens/changes.js",
  installed: "./screens/installed.js",
  search: "./screens/search.js",
  manage: "./screens/manage.js",
  // Home's pushed pages: Browse and its package pages, Tweak Roulette, the featured lists
  browse: "./screens/browse.js",
  roulette: "./screens/roulette.js",
  extras: "./screens/extras.js",
  // C32: the User Guides (Home's root lists them from screens/guide-index.js)
  guides: "./screens/guides.js",
  // F464: the Donate page, with its counts (core/devstats.js)
  donate: "./screens/donate.js",
  // Settings' parts that only its pages draw
  account: "./screens/account.js",
  devaccount: "./screens/devaccount.js",
  freeAppleId: "./screens/free-apple-id.js",
  importlink: "./screens/importlink.js",
  signedApps: "./screens/signed-apps.js",
  websiteSettings: "./screens/website-settings.js",
  pushSettings: "./screens/push-settings.js",
  queue: "./screens/queue.js",
  ipaInstall: "./screens/ipa-install.js",
};
export const LAZY_NAMES = Object.keys(LAZY);

const ready = new Map(); // name -> module namespace
const pending = new Map(); // name -> promise of it

export class NotLoaded extends Error {
  constructor(name) {
    super(`${name} is not loaded yet`);
    this.name = "NotLoaded";
    this.module = name;
  }
}

const nodeRequire = (() => {
  try {
    const m = globalThis.process?.getBuiltinModule?.("node:module");
    return m ? m.createRequire(import.meta.url) : null;
  } catch { return null; }
})();

function known(name) {
  if (!LAZY[name]) throw new Error(`unknown lazy module ${name}`);
}

// The module if it is in, else null (under node: loaded on the spot).
export function loaded(name) {
  known(name);
  if (ready.has(name)) return ready.get(name);
  if (nodeRequire) {
    const m = nodeRequire(LAZY[name]);
    ready.set(name, m);
    return m;
  }
  return null;
}

// The module, for code that draws: throws NotLoaded when it isn't in yet.
export function mod(name) {
  const m = loaded(name);
  if (!m) throw new NotLoaded(name);
  return m;
}

// A stand-in for `import * as x`: each property read is mod(name)'s, so `x.render(…)` reads as before.
export const lazyNs = (name) => new Proxy({}, {
  get: (_, key) => mod(name)[key],
  has: (_, key) => key in mod(name),
});

// The module, loading it first if needed. A failed load can be tried again.
export function load(name) {
  known(name);
  if (ready.has(name)) return Promise.resolve(ready.get(name));
  if (!pending.has(name)) {
    const p = import(LAZY[name]).then((m) => { ready.set(name, m); pending.delete(name); return m; },
      (e) => { pending.delete(name); throw e; });
    pending.set(name, p);
  }
  return pending.get(name);
}

export const isLoaded = (name) => (known(name), ready.has(name));
// The names of `names` still to load.
export const missing = (names) => names.filter((n) => !isLoaded(n));
// Load several; resolves once all are in (a failure rejects; the others keep loading).
export const loadAll = (names = LAZY_NAMES) => Promise.all(names.map(load));
