// F426d: Browse's own page: the Filter button on New and Top 25, what each asks the catalog, ranks and footer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument, memStorage, tick } from "../fakes.test-helper.js";

globalThis.localStorage ??= memStorage();
globalThis.document = fakeDocument();
const make = document.createElement;
document.createElement = (t) => Object.assign(make.call(document, t), { getBoundingClientRect: () => ({ bottom: 100 }) });
globalThis.location = { hash: "#/home/browse" };
globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }); // Reduce Motion: nothing slides
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
const { catalog } = await import("../catalog.js");
const { settings } = await import("../settings-store.js");
const browse = await import("./browse.js");
await import("./filterpanel.js");
const { newRows, topRows } = await import("./browsescope.js");

const all = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, name: `N${String(99 - i)}`, section: "Tweaks", paid: i % 2 === 1 }));
const refine = async (rows, o) => {
  let out = rows.filter((r) => !o.price || r.paid === (o.price === "paid"));
  if (o.sort === "name") out = [...out].sort((a, b) => a.name.localeCompare(b.name));
  return out;
};
const calls = [];
const popular = async ({ limit }) => { calls.push(limit); return all.slice(0, limit); };

test("Top 25: the filters first, then the first 25 in its own order, then the sort of those", async () => {
  const t = topRows({ popular, refine }, 25);
  assert.equal((await t.rows()).at(-1).id, "p24");
  assert.deepEqual(calls, [25], "every package is asked for only under a filter");
  const paid = await t.rows({ price: "paid" });
  assert.equal(paid.length, 25);
  assert.equal(paid[24].id, "p49", "past the unfiltered 25");
  assert.equal(t.total(), 60);
  const sorted = await t.rows({ price: "paid", sort: "name" });
  assert.equal(sorted[0].id, "p49", "the same 25, by name");
  await t.rows({ sort: "name" });
  assert.equal(calls.filter((n) => n > 25).length, 1, "every package once");
  assert.equal((await topRows({ popular, refine }, 25).rows({ sort: "name" }))[0].id, "p24", "sorted after the cut");
});

test("New: filters and sort over its list, asked for once", async () => {
  let n = 0;
  const v = newRows({ fresh: async () => { n++; return all; }, refine });
  assert.equal(await v.rows(), all);
  assert.equal((await v.rows({ price: "free" })).length, 30);
  assert.equal(n, 1);
  assert.equal(v.all(), all);
});

Object.assign(catalog, { ensure: async () => {}, refine, popular, fresh: async () => all.slice(0, 10), sections: async () => ({ sections: [] }) });
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const open = async () => {
  browse.setBrowseFilter("featured", null);
  const host = document.createElement("div"), body = document.createElement("div");
  body.isConnected ??= true;
  host.append(body);
  document.body.append(host);
  browse.renderBrowseHome(body, { tab: "home", path: ["browse"] }, { headers: (rows) => [{ header: "Today" }, ...rows] });
  await settle();
  return { body, host, button: () => body.querySelector(".scope-filter"), list: () => body.querySelector(".pkg-vlist"),
    h: () => Number.parseInt(body.querySelector(".pkg-vlist")?.style.height ?? "0", 10),
    show: async (id) => { browse.setBrowseFilter(id); await settle(); },
    pick: async (label) => {
      await document.body.querySelectorAll(".filter-drop").at(-1).querySelectorAll(".cell-inner").find((n) => n.textContent === label).click();
      await settle();
    } };
};

test("the Filter button: none on Featured, on New and Top 25 each with its own choice; a page pushed again starts clean", async () => {
  const p = await open();
  assert.equal(p.button(), null);
  await p.show("new");
  assert.equal(p.button().textContent, "Filter");
  assert.equal(p.body.querySelectorAll(".scope-segments").length, 1);
  assert.equal(p.h(), 10 * 58 + 23, "a day header");
  p.body.scrollTop = 40;
  p.button().click();
  assert.equal(p.body.scrollTop, 0, "the bar is in place before the panel drops");
  await settle();
  await p.pick("Paid");
  assert.equal(p.h(), 5 * 58 + 23);
  await p.pick("Name");
  assert.equal(p.h(), 5 * 58 + 23, "under N");
  assert.ok(p.host.querySelector(".section-index"));
  await p.show("top");
  assert.equal(p.button().textContent, "Filter", "the panel went with its list");
  assert.ok(!p.button().classList.contains("selected"));
  assert.equal(p.host.querySelector(".section-index"), null);
  assert.equal(p.h(), 25 * 58);
  assert.equal(p.body.querySelector(".browse-list-footer").hidden, false);
  p.button().click();
  await settle();
  const heads = document.body.querySelectorAll(".filter-drop").at(-1).querySelectorAll(".group-header").map((h) => h.textContent);
  assert.deepEqual(heads, ["Sort", "Installed", "Price", "Source", "Section"]);
  await p.pick("Name");
  assert.equal(p.body.querySelector(".browse-list-footer").hidden, true, "no ranks to explain");
  const was = settings.get("worksOnMyPhone"), asked = calls.length;
  settings.set("worksOnMyPhone", !was);
  await settle();
  settings.set("worksOnMyPhone", was);
  assert.ok(calls.length > asked, "Show Incompatible asks again");
  await p.show("featured");
  assert.equal(p.button(), null);
  await p.show("new");
  assert.ok(p.button().classList.contains("selected"), "New kept its choice");
  assert.equal(p.h(), 5 * 58 + 23);
  const q = await open();
  await q.show("new");
  assert.ok(!q.button().classList.contains("selected"));
});

test("the page stays put and its index hides under the open panel", () => {
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  assert.match(css, /\.page-body:has\(> \.browse-scope > \.scope-filter\.done\) \{ overflow-y: hidden; \}/);
  assert.match(css, /\.browse-scope > \.scope-filter\.done\) ~ \.section-index \{ visibility: hidden; \}/);
});

test("B455: a Sort never resizes Browse's bars: no rule of theirs depends on the index, which starts below them", () => {
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const sels = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => s.includes("data-section-index"));
  assert.ok(sels.length);
  for (const s of sels) assert.doesNotMatch(s, /\.browse-scope|\.search-bar|\.search-scope|\.scope-filter|\.search-field/, s);
  assert.ok(sels.some((s) => s.includes(".search-results[data-section-index]") && s.includes(".installed-scope")), "Installed keeps its own");
  const height = (sel) => {
    const at = css.indexOf(`\n${sel} {`);
    return Number(/[{;]\s*height: (\d+)px/.exec(css.slice(at, css.indexOf("}", at)))[1]);
  };
  assert.match(css, /\n\.list-scope > \.scope-filter \{ width: \d+px;/, "Filter and Done, one width");
  const scope = height(".search-scope"), search = height(".search-bar");
  const top = (sel) => css.slice(css.indexOf(`\n${sel} {`)).split("}")[0].split("{")[1].trim();
  assert.equal(top(".page-body:has(> .browse-scope) ~ .section-index"),
    `top: calc(var(--nav-h) + var(--strip-room, 0px) + ${scope}px + 6px);`);
  assert.equal(top(".search-root:has(> .list-scope) > .section-index"),
    `top: calc(var(--nav-h) + var(--strip-room, 0px) + ${search + scope}px + 6px);`);
});
