// F464: Donate. Home and Credits each have a Donate row to one page: the Ko-fi row, then what it took to build the app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { count, day, donateSections } from "./donate.js";
import { homeLinks, nav, openWhileLocked, DONATE_ROW } from "./home.js";
import { format, lazyFor } from "../router.js";
import { DEV_STATS } from "../core/devstats.js";

const STATS = { prompts: 1910, tokens: 8767364993, sessions: 2808, commits: 6397, since: "2026-11-17", updated: "2026-11-27" };

test("the Donate page: the Ko-fi row, then Prompts, Tokens, Sessions and Commits with their dates, no Cost", () => {
  const [kofi, took] = donateSections(STATS);
  assert.deepEqual(kofi.rows.map((r) => r.label), ["Chip in on Ko-fi"]);
  assert.match(kofi.footer, /no paid features/);
  assert.equal(took.header, "What It Took So Far");
  assert.deepEqual(took.rows.map((r) => [r.label, r.detail]),
    [["Prompts", "1,910"], ["Tokens", "8.8 billion"], ["Sessions", "2,808"], ["Commits", "6,397"]]);
  assert.equal(took.footer, "Since 17 Nov 2026, counted 27 Nov 2026.");
  assert.equal(count(1500000), "1.5 million");
  assert.equal(day("2026-12-01"), "1 Dec 2026");
});

test("the Ko-fi row opens ko-fi.com/fizlo", () => {
  const saved = globalThis.window;
  const opened = [];
  globalThis.window = { open: (...a) => opened.push(a) };
  try {
    donateSections(STATS)[0].rows[0].onClick();
  } finally {
    globalThis.window = saved;
  }
  assert.deepEqual(opened, [["https://ko-fi.com/fizlo", "_blank", "noopener"]]);
});

test("Home's row sits under Credits / Thank You, Credits has one too, and both open the page unlocked", () => {
  assert.deepEqual(homeLinks().at(-1).rows.map((r) => r.label), ["Credits / Thank You", "Donate"]);
  assert.equal(DONATE_ROW.href, format({ tab: "home", path: ["donate"] }));
  assert.deepEqual(lazyFor({ tab: "home", path: ["donate"] }), ["donate"]);
  assert.equal(openWhileLocked(DONATE_ROW.href), true);
  assert.equal(nav({ tab: "home", path: ["donate"] }).title, "Donate");
  const js = readFileSync(new URL("./home.js", import.meta.url), "utf8");
  assert.match(js.slice(js.indexOf("function renderCredits"), js.indexOf("...softwareSections()")), /rows: \[DONATE_ROW\]/);
});

test("the committed counts are whole numbers with dates", () => {
  for (const k of ["prompts", "tokens", "sessions", "commits"]) assert.ok(Number.isInteger(DEV_STATS[k]) && DEV_STATS[k] > 0, k);
  for (const k of ["since", "updated"]) assert.match(DEV_STATS[k], /^\d{4}-\d\d-\d\d$/);
});
