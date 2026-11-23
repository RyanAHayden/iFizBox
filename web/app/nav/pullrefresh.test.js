// F270: pull to refresh's arm/release logic (nav/pullrefresh.js): where it arms, that a release under the trigger or
// while a refresh runs does nothing, the rubber band, the Last Updated line, and that every page with a Refresh /
// Reload nav button wires it. B209: an armed release springs straight back (nothing held open) while the hidden area
// shows the spinner (refreshing); a pull during the refresh reveals it and runs nothing; the area goes back to the
// arrow once the refresh ended (closing) and the area is out of sight (idle).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pullState, pullTracker, rubber, lastUpdatedText, titleFor, refreshEnd, TRIGGER, TEXT,
  MIN_HOLD_MS, MAX_HOLD_MS, pullHaptic } from "./pullrefresh.js";
import { createSettings } from "../core/settings.js";

test("pullState: idle at rest, pull under the trigger, armed from it on; idle while busy", () => {
  assert.equal(pullState(0), "idle");
  assert.equal(pullState(-12), "idle");
  assert.equal(pullState(1), "pull");
  assert.equal(pullState(TRIGGER - 0.5), "pull");
  assert.equal(pullState(TRIGGER), "armed");
  assert.equal(pullState(300), "armed");
  assert.equal(pullState(300, { busy: true }), "idle");
  assert.equal(TRIGGER, 60);
});

function run({ busyAtStart = false, busyAtEnd = false, pulls }) {
  let busy = busyAtStart;
  const states = [];
  let refreshed = 0;
  const t = pullTracker({ busy: () => busy, onRefresh: () => refreshed++, onState: (s) => states.push(s) });
  t.start();
  busy = busyAtEnd;
  for (const p of pulls) t.move(p);
  const went = t.end();
  return { went, refreshed, states, t };
}

test("release past the trigger runs the refresh once: refreshing, closing when it ends, idle once hidden", () => {
  const r = run({ pulls: [10, 40, 59, 61, 90] });
  assert.equal(r.went, true);
  assert.equal(r.refreshed, 1);
  assert.deepEqual(r.states, ["pull", "armed", "refreshing"]);
  assert.equal(r.t.state, "refreshing");
  assert.equal(r.t.refreshing, true);
  assert.equal(r.t.spinning, true); // the hidden area shows the spinner
  r.t.hidden(); // not before the refresh ended
  assert.equal(r.t.state, "refreshing");
  r.t.done();
  assert.equal(r.t.state, "closing"); // still "Refreshing..." while the area may be on screen
  assert.equal(r.t.spinning, true);
  r.t.hidden();
  assert.deepEqual(r.states, ["pull", "armed", "refreshing", "closing", "idle"]);
  assert.equal(r.t.refreshing, false);
  assert.equal(r.t.spinning, false);
});

test("a pull while refreshing shows the spinner, never arms, runs nothing and leaves the state alone", () => {
  let n = 0;
  const states = [];
  const t = pullTracker({ onRefresh: () => n++, onState: (s) => states.push(s) });
  t.start(); t.move(90); assert.equal(t.end(), true);
  for (const s of ["refreshing", "closing"]) {
    t.start(); t.move(120);
    assert.equal(t.blocked, true);
    assert.equal(t.spinning, true);
    assert.equal(t.state, s);
    assert.equal(t.end(), false);
    t.start(); t.cancel();
    assert.equal(t.state, s);
    t.done();
  }
  t.hidden();
  assert.equal(n, 1);
  assert.deepEqual(states, ["armed", "refreshing", "closing", "idle"]);
  t.start(); t.move(90); assert.equal(t.end(), true); // and once hidden, the next pull works again
  assert.equal(n, 2);
});

test("titles: pull, armed, Refreshing... while refreshing and until the area is out of sight", () => {
  assert.equal(titleFor("idle"), TEXT.pull);
  assert.equal(titleFor("pull"), TEXT.pull);
  assert.equal(titleFor("armed"), TEXT.armed);
  assert.equal(titleFor("refreshing"), "Refreshing...");
  assert.equal(titleFor("closing"), "Refreshing...");
});

function fakeTimers() {
  let t = 0, id = 0;
  const jobs = new Map();
  const add = (fn, ms, every) => { jobs.set(++id, { fn, at: t + ms, every }); return id; };
  return {
    now: () => t,
    setTimeout: (fn, ms) => add(fn, ms, 0),
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearTimeout: (i) => jobs.delete(i),
    clearInterval: (i) => jobs.delete(i),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [i, j] = next;
        t = j.at;
        if (j.every) j.at += j.every; else jobs.delete(i);
        j.fn();
      }
      t = end;
    },
    get pending() { return jobs.size; },
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test("refreshEnd: waits for the promise, for busy() to clear and for the minimum, then ends once", async () => {
  const timers = fakeTimers();
  const target = new EventTarget();
  let busy = true, ended = 0, settle;
  const result = new Promise((r) => { settle = r; });
  refreshEnd(result, { busy: () => busy, onEnd: () => ended++, timers, now: timers.now, target });
  timers.advance(MIN_HOLD_MS + 1000);
  await tick();
  assert.equal(ended, 0); // promise still out
  settle();
  await tick();
  assert.equal(ended, 0); // settled, but a refresh still runs (the ifizbox:refreshing count, the reload bar)
  busy = false;
  target.dispatchEvent(new Event("ifizbox:refreshing"));
  assert.equal(ended, 1);
  timers.advance(MAX_HOLD_MS);
  assert.equal(ended, 1);
  assert.equal(timers.pending, 0);
});

test("refreshEnd: a quick refresh still holds MIN_HOLD_MS; a rejected one ends too; one that never ends stops at MAX", async () => {
  const timers = fakeTimers();
  const target = new EventTarget();
  let ended = 0;
  refreshEnd(Promise.reject(new Error("x")), { onEnd: () => ended++, timers, now: timers.now, target });
  await tick();
  assert.equal(ended, 0);
  timers.advance(MIN_HOLD_MS - 1);
  assert.equal(ended, 0);
  timers.advance(1);
  assert.equal(ended, 1);
  // busy() that never clears (Home's Reload button stuck): ended at MAX_HOLD_MS anyway
  let stuck = 0;
  refreshEnd(undefined, { busy: () => true, onEnd: () => stuck++, timers, now: timers.now, target });
  await tick();
  timers.advance(MAX_HOLD_MS - 1);
  assert.equal(stuck, 0);
  timers.advance(1);
  assert.equal(stuck, 1);
  // stop() cancels it without ending
  let stopped = 0;
  const stop = refreshEnd(undefined, { onEnd: () => stopped++, timers, now: timers.now, target });
  stop();
  await tick();
  timers.advance(MAX_HOLD_MS);
  assert.equal(stopped, 0);
  assert.equal(timers.pending, 0);
});

test("the DOM side: spinner markup, nothing held open, refreshEnd ends it through the tracker", () => {
  const js = readFileSync(new URL("./pullrefresh.js", import.meta.url), "utf8");
  assert.match(js, /<span class="pull-spinner"><\/span>/);
  assert.doesNotMatch(js, /holdOpen|setHold|bounceHold|MutationObserver/);
  assert.match(js, /refreshEnd\(result, \{ busy, onEnd: \(\) => \{ stopWatch = null; tracker\.done\(\); \} \}\)/);
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8")
    + readFileSync(new URL("../style.css", import.meta.url), "utf8"); // C45: ios6.css paints it, style.css lays it out
  assert.match(css, /\.pull-spinner \{[^}]*background: var\(--spinner-gray\) center \/ 20px no-repeat;/);
  assert.match(css, /\.pull-refresh\.refreshing \.pull-spinner \{ visibility: visible; animation: hud-spin/);
  assert.match(css, /\.pull-refresh\.refreshing \.pull-arrow \{ visibility: hidden;/);
});

test("pulled past the trigger, then back under it before letting go: springs back, nothing runs", () => {
  const r = run({ pulls: [30, 80, 50] });
  assert.equal(r.went, false);
  assert.equal(r.refreshed, 0);
  assert.deepEqual(r.states, ["pull", "armed", "pull", "idle"]);
});

test("release under the trigger runs nothing", () => {
  assert.equal(run({ pulls: [20, 59] }).refreshed, 0);
});

test("a pull while another refresh runs shows the spinner: never arms, never runs", () => {
  const r = run({ busyAtStart: true, busyAtEnd: true, pulls: [30, 120] });
  assert.equal(r.refreshed, 0);
  assert.deepEqual(r.states, []);
  assert.equal(r.t.spinning, true);
  // a refresh that ended mid-pull still doesn't make that pull count
  assert.equal(run({ busyAtStart: true, pulls: [30, 120] }).refreshed, 0);
  // one that started mid-pull (the nav button, launch) stops the release too
  assert.equal(run({ busyAtEnd: true, pulls: [30, 120] }).refreshed, 0);
});

test("a cancelled touch, or an end without a start, runs nothing", () => {
  let n = 0;
  const t = pullTracker({ onRefresh: () => n++ });
  assert.equal(t.end(), false);
  t.start(); t.move(100); t.cancel();
  assert.equal(t.end(), false);
  assert.equal(n, 0);
  assert.equal(t.state, "idle");
});

test("rubber band: follows less the farther it goes, never past its box, 0 for a push", () => {
  assert.equal(rubber(0), 0);
  assert.equal(rubber(-40), 0);
  const a = rubber(50, 600), b = rubber(100, 600), c = rubber(150, 600);
  assert.ok(a > 0 && a < 50);
  assert.ok(b - a > c - b); // damped: each 50px of finger moves it less
  assert.ok(rubber(100000, 600) < 600);
  // a pull that arms takes a real drag: well past the trigger's 60pt of finger travel
  let dy = 0;
  while (rubber(dy, 700) < TRIGGER) dy++;
  assert.ok(dy > 60 && dy < 140, `arms at ${dy}px of finger travel`);
});

test("Last Updated: today, yesterday, this year, another year, never", () => {
  const now = new Date(2026, 10, 19, 17, 30);
  assert.equal(lastUpdatedText(new Date(2026, 10, 19, 15, 14).getTime(), now), "Last Updated: Today 3:14 PM");
  assert.equal(lastUpdatedText(new Date(2026, 10, 19, 0, 5).getTime(), now), "Last Updated: Today 12:05 AM");
  assert.equal(lastUpdatedText(new Date(2026, 10, 18, 9, 5).getTime(), now), "Last Updated: Yesterday 9:05 AM");
  assert.equal(lastUpdatedText(new Date(2026, 10, 3, 12, 0).getTime(), now), "Last Updated: Nov 3 12:00 PM");
  assert.equal(lastUpdatedText(new Date(2025, 0, 2, 12, 0).getTime(), now), "Last Updated: Jan 2, 2025");
  assert.equal(lastUpdatedText(null, now), "Last Updated: Never");
  assert.equal(TEXT.pull, "Pull down to refresh...");
  assert.equal(TEXT.armed, "Release to refresh...");
});

test("settings.lastRefresh keeps the time on the device", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const s = createSettings({ storage });
  const heard = [];
  s.onChange((k, v) => heard.push([k, v]));
  assert.equal(s.lastRefresh.get(), null);
  s.lastRefresh.set(1763565240000);
  assert.equal(s.lastRefresh.get(), 1763565240000);
  assert.equal(createSettings({ storage }).lastRefresh.get(), 1763565240000);
  assert.deepEqual(heard, [["lastRefresh", 1763565240000]]);
});

test("Sources, Changes and Home pull to refresh into their nav button's own refresh", () => {
  const src = (f) => readFileSync(new URL(`../screens/${f}`, import.meta.url), "utf8");
  // C25: each copy of the page (its view) has its own list box
  assert.match(src("sources.js"), /pullToRefresh\(view\.box\.parentNode, \{ onRefresh: \(\) => refresh\(state\.ctx\)/);
  assert.match(src("changes.js"), /pullToRefresh\(view\.results, \{ onRefresh: \(\) => refresh\(ctx\)/);
  assert.match(src("home.js"), /pullToRefresh\(body, \{ onRefresh: \(\) => state\.reloadButton\?\.click\(\)/);
  assert.match(src("home.js"), /label: "Reload", onClick: .*ref: \(b\) => \{ state\.reloadButton = b; \}/);
});

test("the pull is drawn with transform and opacity only, its listeners passive", () => {
  const js = readFileSync(new URL("./pullrefresh.js", import.meta.url), "utf8");
  for (const m of js.matchAll(/addEventListener\("(touch\w+|scroll)", [^)]*?\{ passive: (\w+) \}/g)) assert.equal(m[2], "true", m[1]);
  assert.doesNotMatch(js, /\.style\.(top|height|marginTop|paddingTop) = [^;]*pull/);
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8"); // C45: the pull's layout and motion
  const block = css.slice(css.indexOf(".pull-refresh {"), css.indexOf("@media (prefers-reduced-motion: reduce) { .pull-arrow"));
  assert.ok(css.indexOf(".pull-refresh {") > 0 && /transition:/.test(block), "the pull's rules and their transitions");
  for (const t of block.matchAll(/transition: ([^;]+);/g)) assert.match(t[1], /^(transform|opacity) /);
});

test("the pull area is the list's own background in every theme, never a colour of its own", () => {
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/([^{}]*\.pull-(?:clip|refresh|inner)[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 3);
  const area = rules.find((r) => r[1].trim() === ".pull-refresh");
  assert.match(area[2], /background: var\(--plain\);/);
  for (const [, sel, body] of rules) {
    if (sel.trim() === ".pull-refresh" || sel.trim() === ".pull-clip.grouped > .pull-refresh") continue;
    assert.doesNotMatch(body, /background/, sel.trim());
  }
});

test("on a grouped page the pull area is the page's pinstripe (and linen's weave), set from the scroller's class", () => {
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const bg = (sel) => {
    const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.>]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    assert.ok(m, sel);
    return m[1].match(/background:([^;]+);/)[1].trim();
  };
  assert.equal(bg(".pull-clip.grouped > .pull-refresh"), bg(".page-body.grouped"));
  const pal = readFileSync(new URL("../palettes.css", import.meta.url), "utf8");
  assert.match(pal, /html\[data-theme="dark"\]\[data-palette="linen"\] \.pull-clip\.grouped > \.pull-refresh \{ background: var\(--weave\); \}/);
  const js = readFileSync(new URL("./pullrefresh.js", import.meta.url), "utf8");
  assert.match(js, /clip\.classList\.toggle\("grouped", scroller\.classList\.contains\("grouped"\)\)/);
});

// B197: a tick when the pull arms, the light haptic when a release starts the refresh, nothing otherwise.
function hapticRun({ busyAtEnd = false, pulls }) {
  let busy = false;
  const buzz = [];
  const t = pullTracker({ busy: () => busy, onHaptic: (k) => buzz.push(k) });
  t.start();
  busy = busyAtEnd;
  for (const p of pulls) t.move(p);
  const went = t.end();
  return { went, buzz, t };
}

test("haptics: a tick crossing the trigger, a tap when the armed release starts the refresh", () => {
  const r = hapticRun({ pulls: [10, 40, 61, 90, 120] });
  assert.equal(r.went, true);
  assert.deepEqual(r.buzz, ["tick", "tap"]); // one tick for the arm, however far it goes on
  r.t.done(); r.t.hidden();
  assert.deepEqual(r.buzz, ["tick", "tap"]); // closing and idle are silent
});

test("haptics: none on a release that runs nothing", () => {
  assert.deepEqual(hapticRun({ pulls: [10, 40, 59] }).buzz, []);            // never armed
  assert.deepEqual(hapticRun({ pulls: [30, 70, 40] }).buzz, ["tick"]);      // armed, pulled back under: no tap
  assert.deepEqual(hapticRun({ pulls: [30, 70], busyAtEnd: true }).buzz, ["tick"]); // a refresh started meanwhile
  const c = pullTracker({ onHaptic: () => assert.fail("no haptic") });
  c.start(); c.cancel(); c.end();
});

test("haptics: each re-arm ticks again; a pull while refreshing is silent", () => {
  const r = hapticRun({ pulls: [70, 40, 70] });
  assert.deepEqual(r.buzz, ["tick", "tick", "tap"]);
  const before = r.buzz.length;
  r.t.start(); r.t.move(120); r.t.end();
  assert.equal(r.buzz.length, before);
});

test("haptics: a throwing onHaptic never stops the refresh", () => {
  let n = 0;
  const t = pullTracker({ onRefresh: () => n++, onHaptic: () => { throw new Error("bridge gone"); } });
  t.start(); t.move(90);
  assert.equal(t.end(), true);
  assert.equal(n, 1);
});

test("pullHaptic: only where the app bridge plays haptics; tick -> haptic.tick, tap -> haptic.tap", async () => {
  const played = [];
  const fake = { tick: () => played.push("tick"), tap: () => played.push("tap") };
  pullHaptic("tick", { ...fake, bridge: () => false });
  pullHaptic("tap", { ...fake, bridge: () => false });
  assert.deepEqual(played, []);
  pullHaptic("tick", { ...fake, bridge: () => true });
  pullHaptic("tap", { ...fake, bridge: () => true });
  assert.deepEqual(played, ["tick", "tap"]);

  // The real calls: the bridge message each one sends.
  const sent = [];
  const saved = { webkit: globalThis.webkit, app: globalThis.ifizboxApp };
  globalThis.webkit = { messageHandlers: { ifizbox: { postMessage: (m) => { sent.push(m.method); return Promise.resolve(); } } } };
  globalThis.ifizboxApp = true;
  try {
    pullHaptic("tick");
    pullHaptic("tap");
    assert.deepEqual(sent, ["haptic.tick", "haptic.tap"]);
    globalThis.ifizboxApp = undefined; // the site: no bridge, nothing played (and nothing sent)
    pullHaptic("tick");
    pullHaptic("tap");
    assert.deepEqual(sent, ["haptic.tick", "haptic.tap"]);
  } finally {
    globalThis.webkit = saved.webkit;
    globalThis.ifizboxApp = saved.app;
  }
});

test("pullToRefresh wires the tracker's haptics through pullHaptic", () => {
  const src = readFileSync(new URL("./pullrefresh.js", import.meta.url), "utf8");
  assert.match(src, /onHaptic: \(kind\) => pullHaptic\(kind\)/);
});

// ---- B209: the DOM side, driven by touches and scroll events on a stand-in DOM -------------------------------------

function fakeEl() {
  const classes = new Set();
  const e = {
    style: {}, anims: [], textContent: "", children: [],
    classList: {
      toggle(c, on = !classes.has(c)) { if (on) classes.add(c); else classes.delete(c); return on; },
      contains: (c) => classes.has(c),
    },
    setAttribute() {},
    animate(kf) { e.anims.push(kf); return { finished: Promise.resolve() }; },
  };
  return e;
}

// A page with two rows in its scroller; `fire(type, y)` sends a touch, `scroll(top)` a scroll event at scrollTop top.
async function page(t, tag) {
  const area = fakeEl(), title = fakeEl(), time = fakeEl(), clip = fakeEl();
  area.querySelector = (s) => (s === ".pull-title" ? title : time);
  clip.querySelector = () => area;
  const on = {};
  const scroller = fakeEl();
  Object.assign(scroller, {
    scrollTop: 0, offsetTop: 0, clientHeight: 600, parentNode: {}, children: [fakeEl(), fakeEl()],
    addEventListener: (type, fn) => { on[type] = fn; },
    after(x) { x.parentNode = scroller.parentNode; x.previousSibling = scroller; },
  });
  const saved = { document: globalThis.document, gcs: globalThis.getComputedStyle };
  globalThis.document = { createElement: () => clip, documentElement: fakeEl() };
  globalThis.getComputedStyle = () => ({ paddingTop: "0px" });
  t.after(() => { globalThis.document = saved.document; globalThis.getComputedStyle = saved.gcs; });
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const mod = await import(`./pullrefresh.js?${tag}`); // a module of its own: the native/script guess starts fresh
  let refreshes = 0;
  mod.pullToRefresh(scroller, { onRefresh: () => { refreshes++; return Promise.resolve(); } });
  const fire = (type, y) => on[type]({ type, touches: y == null ? [] : [{ clientY: y }] });
  const scroll = (top) => { scroller.scrollTop = top; on.scroll(); };
  const rows = () => scroller.children.map((c) => c.style.transform || "");
  const look = () => ({ spinner: area.classList.contains("refreshing"), armed: area.classList.contains("armed"),
    title: title.textContent, shown: clip.classList.contains("on") });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  return { t, fire, scroll, rows, look, flush, scroller, area, get refreshes() { return refreshes; } };
}

test("native rubber band: an armed release lets the list spring back, the hidden area spins; a second pull shows it", async (t) => {
  const p = await page(t, "native");
  p.fire("touchstart", 100);
  for (const top of [-20, -45, -70, -90]) p.scroll(top);
  assert.deepEqual(p.look(), { spinner: false, armed: true, title: TEXT.armed, shown: true });
  assert.match(p.area.style.transform, /translateY\(-390px\)/); // the area's foot on the content's top edge
  p.fire("touchend");
  p.scroll(-60);
  // springing back, still on screen: no spinner yet (it is seen only by pulling again)
  assert.deepEqual(p.look(), { spinner: false, armed: true, title: TEXT.armed, shown: true });
  for (const top of [-30, -5, 0]) p.scroll(top); // iOS's own bounce: nothing of the list is moved by script
  t.mock.timers.tick(0);
  await p.flush();
  assert.equal(p.refreshes, 1);
  assert.deepEqual(p.rows(), ["", ""]);
  assert.deepEqual(p.look(), { spinner: true, armed: false, title: "Refreshing...", shown: false });
  // pulling again while it runs reveals the spinner; letting go springs back and runs nothing more
  p.fire("touchstart", 100);
  for (const top of [-30, -80, -120]) p.scroll(top);
  assert.deepEqual(p.look(), { spinner: true, armed: false, title: "Refreshing...", shown: true });
  p.fire("touchend");
  for (const top of [-50, 0]) p.scroll(top);
  assert.equal(p.refreshes, 1);
  assert.deepEqual(p.rows(), ["", ""]);
  // the refresh ends: back to the arrow (out of sight already)
  t.mock.timers.tick(MIN_HOLD_MS + 300);
  await p.flush();
  t.mock.timers.tick(300);
  assert.deepEqual(p.look(), { spinner: false, armed: false, title: TEXT.pull, shown: false });
});

test("script pull (no rubber band): rows follow the finger, spring back to none on release, no hold, no second refresh", async (t) => {
  const p = await page(t, "script");
  p.fire("touchstart", 100);
  p.fire("touchmove", 112); // past DECIDE: pulled by script
  const seen = [];
  for (let y = 120; y <= 400; y += 8) { p.fire("touchmove", y); seen.push(parseFloat(p.rows()[0].slice(11)) || 0); }
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1], "follows every move, never stalls or snaps");
  assert.equal(p.look().armed, true);
  p.fire("touchend");
  assert.deepEqual(p.look(), { spinner: false, armed: true, title: TEXT.armed, shown: true }); // springing away
  await p.flush();
  assert.equal(p.refreshes, 1);
  assert.deepEqual(p.rows(), ["", ""]); // straight back: nothing held at 60
  const spring = p.scroller.children[0].anims.at(-1);
  assert.deepEqual(spring.at(-1), { transform: "none" });
  assert.equal(p.look().spinner, true);
  assert.equal(p.look().shown, false); // the spring ended: out of sight
  p.fire("touchstart", 100);
  p.fire("touchmove", 112);
  p.fire("touchmove", 400); // a pull during the refresh is never stopped
  assert.notEqual(p.rows()[0], "");
  assert.deepEqual(p.look(), { spinner: true, armed: false, title: "Refreshing...", shown: true });
  p.fire("touchend");
  await p.flush();
  assert.equal(p.refreshes, 1);
  assert.deepEqual(p.rows(), ["", ""]);
  t.mock.timers.tick(MIN_HOLD_MS + 300);
  await p.flush();
  t.mock.timers.tick(300);
  assert.deepEqual(p.look(), { spinner: false, armed: false, title: TEXT.pull, shown: false });
});

test("B387: a list held by a swipe back (overflow-y hidden) is not pulled by it; the next touch pulls again", async (t) => {
  const p = await page(t, "held");
  p.fire("touchstart", 100);
  p.scroller.style.overflowY = "hidden"; // nav/swipe.js lockScroll
  for (const y of [112, 200, 400]) p.fire("touchmove", y);
  assert.deepEqual(p.rows(), ["", ""]);
  p.fire("touchend");
  assert.equal(p.scroller.style.overflowY, "hidden"); // the lock's to free
  assert.equal(p.refreshes, 0);
  p.scroller.style.overflowY = "";
  p.fire("touchstart", 100);
  p.fire("touchmove", 112);
  p.fire("touchmove", 200);
  assert.notEqual(p.rows()[0], "");
});
