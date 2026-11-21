// B300 (user 2026-11-21: "the signing page still pops in instead of sliding"): every way into Installation & Signing
// is a push, so the page slides in (app.js slides only a push). Install's Set Up Signing from a page mounted on Home
// (Home's Install IPAs tile, #/home/~installed/myipas) used to land as a stack replace: no slide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { format, createRouter, BAR_TABS, mounted, settingsRoute } from "./router.js";
import { createStacks } from "./nav/stack.js";
import { opensMerged } from "./screens/settings.js";

// A window-like stub with a browser-like history (as push-kind.test.js's): location.hash adds an entry, replaceState
// swaps the current one, back() walks to the one before. hashchange fires synchronously.
function fakeWindow(hash) {
  const listeners = new Set();
  const fire = () => listeners.forEach((f) => f());
  const entries = [{ hash, state: null }];
  let at = 0;
  return {
    location: {
      get hash() { return entries[at].hash; },
      set hash(h) {
        const n = h.startsWith("#") ? h : "#" + h;
        if (n === entries[at].hash) return;
        entries.splice(at + 1, Infinity, { hash: n, state: null });
        at++;
        fire();
      },
    },
    history: {
      get state() { return entries[at].state; },
      replaceState(state, _t, url) { entries[at] = { hash: url, state: state == null ? null : structuredClone(state) }; },
      back() { if (at > 0) { at--; fire(); } },
    },
    addEventListener(type, f) { if (type === "hashchange") listeners.add(f); },
    removeEventListener(type, f) { if (type === "hashchange") listeners.delete(f); },
  };
}

function setup(start) {
  const win = fakeWindow(start);
  const stacks = createStacks({ tabs: BAR_TABS, create: (tab, path) => ({ tab, path }) });
  const results = [];
  const router = createRouter({ win, onRoute: (r) => results.push(stacks.sync(r)) });
  router.start();
  // a tapped link, or signing/device.js openRoute (location.hash = "/home/settings/signing"): both set the hash
  const open = (hash) => { win.location.hash = hash; return results.at(-1); };
  return { win, open, results };
}

const SIGNING = format(settingsRoute(["signing"])); // Home's tiles, Settings' row, Why's and the guides' rows, Install
const INSTALLATION = format(settingsRoute(["installation"]));
const shows = (hash) => mounted(parseHash(hash));
const parseHash = (hash) => { const [tab, ...path] = hash.replace(/^#\//, "").split("/").map(decodeURIComponent); return { tab, path }; };

// Where each way in starts: Home (its certificate and Install Lite tiles), Settings (its row), Why and a guide (their
// Settings > Signing rows), and every page Install's Set Up Signing (or a sign failure) can be tapped on.
const STARTS = ["#/home", "#/home/settings", "#/home/why", "#/home/guides/faq",
  "#/home/~installed/myipas", "#/home/~installed/myipas/apps", "#/home/~sources/more", "#/installed/myipas",
  "#/sources/bigboss/com.example.app", "#/changes"];

for (const start of STARTS) {
  for (const to of [SIGNING, INSTALLATION]) {
    test(`B300: ${to} from ${start} pushes Installation & Signing (it slides in), Back returns`, () => {
      const { win, open, results } = setup(start);
      const before = win.location.hash;
      const r = open(to);
      assert.equal(r.kind, "push", `${start} -> ${win.location.hash}`);
      assert.equal(r.to.pushed, true);
      const route = shows(win.location.hash);
      assert.equal(route.tab, "settings");
      assert.equal(opensMerged(route.path), true, win.location.hash); // the merged page draws it (sideload)
      win.history.back();
      assert.equal(results.at(-1).kind, "pop");
      assert.equal(win.location.hash, before);
    });
  }
}

test("B300: Install's Set Up Signing from Home's Install IPAs mounts Settings on top, and its sub-pages stay in it", () => {
  const { win, open } = setup("#/home/~installed/myipas");
  open(SIGNING);
  assert.equal(win.location.hash, "#/home/~installed/myipas/~settings/signing");
  assert.equal(open(format(settingsRoute(["signing", "certificate"]))).kind, "push");
  assert.equal(win.location.hash, "#/home/~installed/myipas/~settings/signing/certificate");
  // B39: once ready, Signing goes back to the page Install was tapped on: a pop down the same stack
  const back = open("#/home/~installed/myipas");
  assert.equal(back.kind, "pop");
  assert.equal(win.location.hash, "#/home/~installed/myipas");
});

test("B300: Settings' root from a page mounted on Home pushes too", () => {
  const { win, open } = setup("#/home/~installed/myipas");
  assert.equal(open(format(settingsRoute())).kind, "push");
  assert.deepEqual(shows(win.location.hash), { tab: "settings", path: [] });
});

test("B300: the Pairing page opened on another page's stack is still the Pairing page (a hashchange there doesn't end pairing)", async () => {
  const { isPairHash } = await import("./screens/installroute.js");
  assert.equal(isPairHash("#/home/settings/installation/pair"), true);
  assert.equal(isPairHash("#/home/~installed/myipas/~settings/installation/pair"), true);
  assert.equal(isPairHash("#/installed/myipas/~settings/installation/pair"), true);
  assert.equal(isPairHash("#/home/settings/installation"), false);
  assert.equal(isPairHash("#/home/~installed/myipas/~settings/signing"), false);
});
