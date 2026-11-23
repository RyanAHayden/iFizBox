// B300 (user 2026-11-21: "the signing page still pops in instead of sliding"): every way into Installation & Signing
// is a push, so the page slides in (app.js slides only a push). Install's Set Up Signing from a page mounted on Home
// (Home's Install IPAs tile, #/home/~installed/myipas) used to land as a stack replace: no slide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { format, parse, createRouter, BAR_TABS, mounted, settingsRoute } from "./router.js";
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
  const router = createRouter({ win, onRoute: (r) => results.push(stacks.sync(r, { linked: router.linked() })) });
  router.start();
  // a tapped link, or signing/device.js openRoute (location.hash = "/home/settings/signing"): both set the hash
  const open = (hash) => { win.location.hash = hash; return results.at(-1); };
  return { win, open, results };
}

const SIGNING = format(settingsRoute(["signing"])); // Home's tiles, Settings' row, Why's and the guides' rows, Install
const INSTALLATION = format(settingsRoute(["installation"]));
const sub = (...path) => format(settingsRoute(path));
const shows = (hash) => mounted(parse(hash));

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
  const { win, open, results } = setup("#/home/~installed/myipas");
  assert.equal(open(format(settingsRoute())).kind, "push");
  assert.equal(win.location.hash, "#/home/~installed/myipas/~settings");
  assert.deepEqual(shows(win.location.hash), { tab: "settings", path: [] });
  // its Installation & Signing row stays in that mount, and pushes
  assert.equal(open(SIGNING).kind, "push");
  assert.equal(win.location.hash, "#/home/~installed/myipas/~settings/signing");
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home/~installed/myipas/~settings");
});

test("B300: a sign failure's Open Signing (go to the same hash) from Install IPAs on Home pushes too", () => {
  const { win, open } = setup("#/home/~installed/myipas/ipa:App.ipa");
  assert.equal(open("/home/settings/signing").kind, "push"); // signing/device.js openRoute: no leading #
  assert.equal(win.location.hash, "#/home/~installed/myipas/ipa%3AApp.ipa/~settings/signing");
});

test("B300: the Pairing page opened on another page's stack is still the Pairing page (a hashchange there doesn't end pairing)", async () => {
  const { isPairHash } = await import("./screens/installroute.js");
  assert.equal(isPairHash("#/home/settings/installation/pair"), true);
  assert.equal(isPairHash("#/home/~installed/myipas/~settings/installation/pair"), true);
  assert.equal(isPairHash("#/installed/myipas/~settings/installation/pair"), true);
  assert.equal(isPairHash("#/home/settings/installation"), false);
  assert.equal(isPairHash("#/home/~installed/myipas/~settings/signing"), false);
});

// B380 (user 2026-11-23: "Installation & Signing still teleports into This iPhone and its pages"): the merged page opens
// as settings/signing, but its This iPhone pages are settings/installation/…, a sibling branch: the stack swapped the
// page (replace) without a slide. The concept check started on settings/installation, where they slid.
const PAGES = [["installation", "iphone"], ["installation", "with"], ["installation", "server"], ["installation", "pair"],
  ["installation", "shortcuts"], ["installation", "how"], ["signing", "certificate"], ["signing", "apps"], ["signing", "help"], ["signing", "udid"]];
for (const start of ["#/home", "#/home/settings", "#/home/~installed/myipas", "#/installed/myipas", "#/sources/bigboss/com.example.app"]) {
  for (const main of [SIGNING, INSTALLATION]) {
    test(`B380: from ${start}, every page of Installation & Signing (${main}) pushes, Back returns`, () => {
      for (const page of PAGES) {
        const { win, open, results } = setup(start);
        open(main);
        const before = win.location.hash;
        const r = open(sub(...page));
        assert.equal(r.kind, "push", `${before} -> ${win.location.hash}`);
        assert.equal(r.to.pushed, true);
        assert.deepEqual(shows(win.location.hash), { tab: "settings", path: page });
        win.history.back();
        assert.equal(results.at(-1).kind, "pop");
        assert.equal(win.location.hash, before);
      }
    });
  }
}

test("B380: one page's fix row or goTo() to another (This iPhone > Pairing, Signed Apps > Shortcuts) pushes too, and Back walks each", () => {
  for (const start of ["#/home", "#/installed/myipas"]) {
    for (const [a, b] of [["iphone", "pair"], ["with", "pair"], ["iphone", "shortcuts"], ["pair", "with"]]) {
      const { win, open, results } = setup(start);
      open(SIGNING);
      const main = win.location.hash;
      open(sub("installation", a));
      const first = win.location.hash;
      assert.equal(open(sub("installation", b)).kind, "push", `${a} -> ${b}`);
      win.history.back();
      assert.equal(results.at(-1).kind, "pop");
      assert.equal(win.location.hash, first);
      win.history.back();
      assert.equal(results.at(-1).kind, "pop");
      assert.equal(win.location.hash, main);
    }
  }
});

test("B380: Installation & Signing by its other route, from one of its pages, pops to it; Back then leaves it by the stack", () => {
  const { win, open } = setup("#/home");
  open("#/home/settings");
  open(SIGNING);
  open(sub("installation", "iphone"));
  const r = open(INSTALLATION);
  assert.equal(r.kind, "pop");
  assert.equal(win.location.hash, SIGNING);
  assert.equal(r.to.pushed, false); // history's entry behind is This iPhone: Back goes by the stack, not history.back()
});

test("B380: Installation & Signing by its other route while on screen changes nothing, and Back still leaves it", () => {
  const { win, open, results } = setup("#/home");
  open(SIGNING);
  const n = results.length;
  open(INSTALLATION);
  assert.equal(results.length, n);
  assert.equal(win.location.hash, SIGNING);
  win.history.back();
  assert.equal(results.at(-1).kind, "pop");
  assert.equal(win.location.hash, "#/home");
});
