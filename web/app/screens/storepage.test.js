// F181: the package page as the iOS 6 App Store's (screens/storepage.js), over a small fake DOM: the header with and
// without a rating, the Details / Reviews / Related tabs, the info tiles (Works On above all), the ratings card, and
// that Install / Modify stays the nav bar's right button (no install button in the header).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument } from "../fakes.test-helper.js";

// browse.js first, with no document (some screens style themselves at load when there is one).
const browseMod = await import("./browse.js");

globalThis.document = fakeDocument();

const all = (n, out = []) => { out.push(n); (n.children ?? []).forEach((c) => all(c, out)); return out; };
const byClass = (n, c) => all(n).filter((x) => x._cls?.has(c));
const one = (n, c) => byClass(n, c)[0];

const sp = await import("./storepage.js");

test("F181: the header without a rating: name, author, Version · size · price, and a placeholder stars row", () => {
  const art = document.createElement("span");
  const h = sp.storeHeader({ art, name: "Velvet", author: "Sample Dev", authorHref: "#/sources/x/author%3ASample%20Dev",
    line: sp.headerLine({ version: "2.1.3", size: "412 kB", price: "Free" }) });
  assert.equal(one(h.head, "store-head-name").textContent, "Velvet");
  const author = one(h.head, "store-head-author");
  assert.equal(author.textContent, "Sample Dev");
  assert.equal(author.tagName, "A");
  assert.equal(one(h.head, "store-head-line").textContent, "Version 2.1.3 · 412 kB · Free");
  // F206: the stars row is there from the first paint, grey empty stars, and filled in place.
  const row = one(h.head, "store-head-rating");
  assert.equal(row.hidden, false, "the row's place is kept while the reviews load");
  assert.equal(row.dataset.state, "pending");
  assert.equal(one(row, "store-stars-fill").style.width, "0%", "grey empty stars");
  assert.equal(byClass(row, "store-head-count").length, 0);
  assert.ok(one(h.head, "store-icon").children.includes(art), "the icon in the glossy frame");
  assert.ok(one(h.head, "store-icon-gloss"), "with its gloss");
  // A count alone is not a rating: "No Ratings", the row kept.
  h.setRating({ average: null, count: 12 });
  assert.equal(one(h.head, "store-head-rating"), row);
  assert.equal(row.hidden, false);
  assert.equal(row.dataset.state, "none");
  assert.equal(one(row, "store-head-count").textContent, "No Ratings");
  assert.equal(one(row, "store-stars-fill").style.width, "0%");
});

test("F206: the header's stars row: placeholder, then filled in the same element; no ratings never removes it", () => {
  const h = sp.storeHeader({ name: "Delta", line: "Version 1.6" });
  const text = one(h.head, "store-head-text");
  const before = text.children.map((c) => c.className);
  const row = one(h.head, "store-head-rating");
  h.setRating({ average: 5, count: 1 });
  assert.deepEqual(text.children.map((c) => c.className), before, "nothing added or moved: filled in place");
  assert.equal(one(h.head, "store-head-rating"), row);
  assert.equal(row.dataset.state, "rated");
  assert.equal(one(row, "store-head-count").textContent, "(1)");
  h.setRating(null);
  assert.deepEqual(text.children.map((c) => c.className), before);
  assert.equal(one(row, "store-head-count").textContent, "No Ratings");
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  assert.match(css, /\.store-head-rating \{[^}]*height: 15px/s, "one height for every state");
});

test("F181: the header with a rating: stars filled to it and the count; a lookup without a count shows no (0)", () => {
  const h = sp.storeHeader({ name: "Delta", line: sp.headerLine({ version: "1.6" }) });
  assert.equal(one(h.head, "store-head-line").textContent, "Version 1.6", "missing size and price are left out");
  assert.equal(byClass(h.head, "store-head-author").length, 0, "no author, no line for one");
  h.setRating({ average: 4.3, count: 212, noun: "Ratings" });
  const row = one(h.head, "store-head-rating");
  assert.equal(row.hidden, false);
  assert.equal(byClass(row, "store-stars").length, 1, "the placeholder's stars replaced, not added to");
  assert.equal(one(row, "store-stars").attrs["aria-label"], "4.3 out of 5 stars");
  assert.equal(one(row, "store-stars-fill").style.width, "86%");
  assert.equal(one(row, "store-head-count").textContent, "(212)");
  h.setRating({ average: 5, count: null });
  assert.equal(byClass(h.head, "store-head-count").length, 0);
  h.setAuthor("Riley");
  assert.equal(one(h.head, "store-head-author").textContent, "Riley", "the App Store's developer, filled in later");
  assert.equal(one(h.head, "store-head-author").tagName, "SPAN");
});

test("F181: headerLine", () => {
  assert.equal(sp.headerLine({ version: "1.0", size: "4.7 MB", price: "Paid" }), "Version 1.0 · 4.7 MB · Paid");
  assert.equal(sp.headerLine({}), "");
});

test("F181: Details / Reviews / Related: Details shows first; the others fill once, when first chosen", async () => {
  const calls = { reviews: 0, related: 0 };
  const tabs = sp.storeTabs({
    reviews: (pane) => { calls.reviews++; pane.append(document.createElement("p")); },
    related: async (pane) => { calls.related++; pane.append(document.createElement("p")); },
  });
  assert.deepEqual(tabs.buttons.map((b) => b.textContent), ["Details", "Reviews", "Related"]);
  assert.equal(tabs.control.attrs.role, "tablist");
  assert.equal(tabs.nodes.length, 4, "the control and three panes");
  assert.equal(tabs.selected(), "details");
  assert.equal(tabs.panes.details.hidden, false);
  assert.equal(tabs.panes.reviews.hidden, true);
  assert.equal(tabs.panes.related.hidden, true);
  assert.ok(tabs.buttons[0].classList.contains("selected"));
  assert.equal(calls.reviews + calls.related, 0, "nothing loads for a tab not opened");
  await tabs.buttons[1].click();
  assert.equal(tabs.selected(), "reviews");
  assert.equal(tabs.panes.details.hidden, true);
  assert.equal(tabs.panes.reviews.hidden, false);
  assert.ok(tabs.buttons[1].classList.contains("selected") && !tabs.buttons[0].classList.contains("selected"));
  assert.equal(tabs.buttons[1].attrs["aria-selected"], "true");
  await tabs.buttons[2].click();
  await tabs.buttons[1].click();
  await tabs.buttons[2].click();
  assert.deepEqual(calls, { reviews: 1, related: 1 }, "each fills once");
  tabs.select(7);
  assert.equal(tabs.selected(), "related", "an unknown tab changes nothing");
});

test("F181: Works On: the stated range, and a check or cross for this iPhone", () => {
  assert.deepEqual(sp.worksOnTile({ status: "works", range: "iOS 15.0 or later", need: "rootless" }),
    { label: "Works On", value: "iOS 15+", sub: "Your iPhone ✓", ok: true });
  assert.deepEqual(sp.worksOnTile({ status: "no", reason: "ios", range: "iOS 14.0 – 16.2", need: "rootless" }),
    { label: "Works On", value: "iOS 14–16.2", sub: "Not Your iPhone ✗", ok: false });
  // No iOS range: the jailbreak it's built for, else any iOS; not judged, a question rather than a tick.
  assert.deepEqual(sp.worksOnTile({ status: "no", reason: "rootful", range: null, need: "rootful" }),
    { label: "Works On", value: "Rootful", sub: "Not Your iPhone ✗", ok: false });
  // B184: a deb on a phone without a jailbreak names the jailbreak, never the iOS version.
  assert.deepEqual(sp.worksOnTile({ status: "no", reason: "jailbreak", range: "iOS 14.0 or later", need: "rootless" }),
    { label: "Works On", value: "iOS 14+", sub: "Needs Jailbreak ✗", ok: false });
  assert.deepEqual(sp.worksOnTile({ status: "unknown", range: null, need: "any" }),
    { label: "Works On", value: "Any iOS", sub: "Unknown", ok: null });
  assert.equal(sp.worksOnTile({ status: "unchecked", range: null, need: "any" }).sub, "Not Checked");
  assert.equal(sp.shortRange("iOS 15.0 to below 17.0"), "iOS 15–16");
  assert.equal(sp.shortRange("iOS 15.0 to below 16.4"), "iOS 15–<16.4");
  assert.equal(sp.shortRange("iOS below 14"), "iOS <14");
  assert.equal(sp.shortRange("iOS 16.5"), "iOS 16.5");
  assert.equal(sp.shortRange("some iOS versions"), null);
});

test("F181: the tile row keeps Rating, Works On, Size, Section, Updated in order, whenever each arrives", () => {
  const t = sp.tileRow();
  t.set("works", sp.worksOnTile({ status: "works", range: "iOS 15.0 or later" }));
  t.set("size", sp.sizeTile("412 kB"));
  t.set("updated", sp.updatedTile(new Date(2026, 10, 12, 9).toISOString(), new Date(2026, 10, 18, 12).getTime()));
  t.set("section", sp.sectionTile("Tweaks", "Rootless"));
  t.set("rating", sp.ratingTile({ average: 4.25, count: 3 })); // the depiction loads last
  const keys = t.row.children.map((c) => c.dataset.key);
  assert.deepEqual(keys, ["rating", "works", "size", "section", "updated"]);
  const label = (k) => t.row.children.find((c) => c.dataset.key === k);
  assert.equal(one(label("rating"), "store-tile-value").textContent, "4.3");
  assert.ok(one(label("rating"), "store-stars"));
  assert.equal(one(label("works"), "store-tile-sub").dataset.ok, "true");
  assert.equal(one(label("works"), "store-tile-sub").textContent, "Your iPhone ✓");
  assert.equal(one(label("size"), "store-tile-value").textContent, "412 kB"); // F195: the unit in the value
  assert.equal(label("size").children.find((c) => c.className === "store-tile-sub"), undefined); // no price: blank
  assert.equal(t.row.dataset.count, "5");
  assert.equal(one(label("updated"), "store-tile-value").textContent, "Nov 12");
  assert.equal(one(label("updated"), "store-tile-sub").textContent, "6 days ago");
  // Works On judged again (an IPA read): the tile is replaced in place; no rating takes the tile away.
  t.set("works", sp.worksOnTile({ status: "no", reason: "ios", range: "iOS 17.0 or later" }));
  assert.deepEqual(t.row.children.map((c) => c.dataset.key), ["rating", "works", "size", "section", "updated"]);
  assert.equal(one(label("works"), "store-tile-sub").dataset.ok, "false");
  // F206: no rating keeps the tile: a dash with "No Ratings" under it.
  t.set("rating", sp.ratingTile(null));
  assert.deepEqual(t.row.children.map((c) => c.dataset.key), ["rating", "works", "size", "section", "updated"]);
  assert.equal(one(label("rating"), "store-tile-value").textContent, "—");
  assert.equal(one(label("rating"), "store-tile-sub").textContent, "No Ratings");
  assert.equal(sp.sizeTile(null), null);
  assert.equal(sp.updatedTile(null), null);
  assert.equal(sp.sectionTile(null), null);
});

test("F181: the ratings card: the average, the count, and the 5-to-1 bars only when per-star counts exist", () => {
  const plain = sp.ratingsCard({ average: 4.5, count: 1200, noun: "Ratings", from: "App Store" });
  assert.equal(one(plain, "store-ratings-big").textContent, "4.5");
  assert.equal(one(plain, "store-ratings-count").textContent, "1,200 Ratings");
  // F206: the bars are always drawn; Apple's lookup gives no per-star counts and no reviews here: all zero.
  assert.deepEqual(byClass(plain, "store-bar-n").map((n) => n.textContent), ["0", "0", "0", "0", "0"]);
  assert.equal(one(plain, "store-ratings-from").textContent, "App Store. No reviews to count yet.");
  const bars = sp.ratingsCard({ average: 4.3, count: 212, histogram: [131, 42, 17, 9, 13] });
  const rows = byClass(bars, "store-bar");
  assert.equal(rows.length, 5);
  assert.equal(byClass(rows[0], "store-bar-star").length, 5);
  assert.equal(byClass(rows[3], "store-bar-star").filter((s) => s._cls.has("on")).length, 2, "2 stars dark, 3 light");
  assert.equal(one(rows[0], "store-bar-fill").style.transform, "scaleX(1)", "scaled, not resized (120 Hz)");
  assert.equal(one(rows[4], "store-bar-n").textContent, "13");
  assert.equal(one(rows[4], "store-bar-n").tagName, "B", "the count in bold");
  assert.equal(rows[0].disabled, true, "no onPick: nothing to filter");
  assert.equal(one(bars, "store-ratings-from").textContent, "Bars from 212 ratings.");
  const none = sp.ratingsCard(null);
  assert.equal(one(none, "store-ratings-count").textContent, "No Ratings", "F206: no ratings keeps the card");
  assert.equal(byClass(none, "store-bar").length, 5);
  // Counted from the reviews when there's no histogram; half stars round.
  const counted = sp.ratingsCard({ average: 4, count: 3 }, { reviews: [{ rating: 4.5 }, { rating: 4 }, { rating: null }, { stars: 1 }] });
  assert.deepEqual(byClass(counted, "store-bar-n").map((n) => n.textContent), ["1", "1", "0", "0", "1"]);
  assert.equal(one(counted, "store-ratings-from").textContent, "Bars from 3 reviews.");
  let picked = null;
  const tap = sp.ratingsCard({ average: 4, count: 1 }, { reviews: [{ rating: 4 }], onPick: (n) => { picked = n; }, selected: 2 });
  assert.equal(byClass(tap, "store-bar")[3].classList.contains("selected"), true);
  assert.equal(one(tap, "store-ratings-hint").textContent, "Showing 2-star reviews. Tap the row again for all.");
  byClass(tap, "store-bar")[1].click();
  assert.equal(picked, 4);
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  assert.match(css, /\.store-bar \{[^}]*min-height: 32px/s, "a 32pt target");
  assert.match(css, /\.store-bar \+ \.store-bar \{[^}]*border-top: 1px solid var\(--divider\)/s);
  assert.match(css, /\.store-bar\.selected[^{]*\{[^}]*var\(--select\)/s, "iOS 6 selection blue");
  assert.match(css, /\.store-bar:not\(:disabled\):active/, "a pressed state");
  assert.match(css, /\.store-bar-star\.on \{ color: #6d6d6d; \}/);
  assert.doesNotMatch(css.match(/\.store-bar-fill \{[^}]*\}/s)[0], /transition: (?!transform)/, "only transform animates");
  assert.equal(one(sp.ratingsCard({ average: 3, count: 1, noun: "Reviews" }), "store-ratings-count").textContent, "1 Review");
});

test("F181: review cells: numbered title, stars, by-line, text, a developer response", () => {
  const g = sp.reviewsGroup([
    { title: "Feels like a new phone", author: "mobileuser", rating: 5, text: "Perfect." },
    { title: "Breaks the camera swipe", author: "jbfan", rating: 2, version: "2.1.2", date: "Nov 9", text: "Lags.", response: "Fixed in 2.1.3" },
  ]);
  const cells = byClass(g, "store-review");
  assert.equal(cells.length, 2);
  assert.equal(one(cells[0], "store-review-title").textContent, "1. Feels like a new phone");
  assert.equal(one(cells[0], "store-review-by").textContent, "by mobileuser");
  assert.equal(one(cells[1], "store-review-by").textContent, "by jbfan – Version 2.1.2 – Nov 9");
  assert.equal(one(cells[1], "store-stars-fill").style.width, "40%");
  assert.match(one(cells[1], "store-review-response").textContent, /Developer Response – Fixed in 2\.1\.3/);
});

// ---- Install stays in the nav bar ------------------------------------------------------------------------------

test("F181: Install / Modify stays the nav bar's right button; the header has no install button", async () => {
  const h = sp.storeHeader({ name: "Velvet", author: "Sample Dev", line: "Version 1 · Free" });
  h.setRating({ average: 4, count: 3 });
  assert.equal(all(h.head).filter((n) => n.tagName === "BUTTON").length, 0, "nothing to press in the header");
  assert.doesNotMatch(h.head.textContent, /Install|Modify|Get|Buy/);
  const { nav, token } = browseMod;
  const right = nav({ tab: "search", path: [token("package", "com.example.velvet")] }).right;
  assert.equal(right.label, "Install");
  assert.equal(typeof right.onClick, "function");
  // Neither page builds an install button into its header: renderPackage and renderApp hand the header no button.
  for (const file of ["./browse.js", "./altstore.js", "./storepage.js"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    // F194: an app page's Share (headerShareButton) sits there; nothing that installs.
    for (const call of src.match(/storeHeader\(\{[^)]*\}\)/gs) ?? []) assert.doesNotMatch(call.replace(/headerShareButton/g, ""), /Install|bar-button|button/i, file);
  }
  const browse = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  const page = browse.slice(browse.indexOf("async function renderPackage("), browse.indexOf("// ---- Install / Modify and Version History"));
  assert.match(page, /storeHeader\(/);
  assert.match(page, /rememberPackage\(body, route/, "the nav bar button still follows what is installed");
  assert.match(page, /storeTabs\(/);
  const alt = readFileSync(new URL("./altstore.js", import.meta.url), "utf8");
  const app = alt.slice(alt.indexOf("export function renderApp("), alt.indexOf("export function storeLookup("));
  assert.match(app, /storeHeader\(/);
  assert.match(app, /storeTabs\(/);
});

test("F181: the CSS is there: the segmented control in ios6.css, the page in packages.css, both themes", () => {
  const ios6 = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const pkgs = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  assert.match(ios6, /\.store-segment\.selected \{[^}]*background-origin: border-box/s, "a gradient in a border needs border-box");
  assert.match(ios6, /html\[data-theme="dark"\] \.store-segment/);
  for (const cls of [".store-head {", ".store-icon {", "-webkit-box-reflect", ".store-icon-gloss", ".store-tiles {", ".store-tile {",
    ".shot-dots", ".shot-zoom", ".store-bar-fill", ".store-review {", 'html[data-theme="dark"] .store-head']) assert.ok(pkgs.includes(cls), cls);
  // 120 Hz: no transition or animation of anything but transform/opacity in the new rules.
  const part = pkgs.slice(pkgs.indexOf("F181: the package page"));
  assert.doesNotMatch(part, /transition\s*:\s*(?!transform|opacity)[a-z]/);
});

test("F194: storeHeader's action goes on the header's right edge, after the text", () => {
  const share = document.createElement("button");
  share.className = "bar-button bar-icon share-button store-head-share";
  const h = sp.storeHeader({ name: "Velvet", line: "Version 1 · Free", action: share });
  assert.equal(h.head.children.at(-1), share);
  assert.equal(h.head.children.length, 3, "icon, text, action");
  assert.equal(sp.storeHeader({ name: "Velvet" }).head.children.length, 2, "no action, nothing added");
});

test("F195: Size keeps its unit in the value, the price under it; the row counts its columns; ONE card in the CSS", () => {
  assert.deepEqual(sp.sizeTile("48 kB", "Free"), { label: "Size", value: "48 kB", sub: "Free" });
  assert.deepEqual(sp.sizeTile("4.7 MB"), { label: "Size", value: "4.7 MB", sub: null });
  const t = sp.tileRow({ rating: false });
  t.set("works", sp.worksOnTile({ status: "works", range: "iOS 15.0 or later" }));
  t.set("size", sp.sizeTile("48 kB", "Free"));
  assert.equal(t.row.dataset.count, "2");
  assert.equal(one(t.row.children[1], "store-tile-sub").textContent, "Free");
  t.set("size", null);
  assert.equal(t.row.dataset.count, "1");
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  const card = [...css.matchAll(/\n\.store-tiles \{[^}]*\}/gs)].join("\n"); // C46: its layout rule and its look-only rule
  for (const want of ["margin: 16px 10px 0", "var(--table)", "var(--table-edge)", "border-radius: 9.5px", "overflow-x: auto"]) assert.ok(card.includes(want), want);
  assert.match(css, /\.store-tile \{[^}]*flex: 1 1 0/s);
  assert.match(css, /\.store-tile \+ \.store-tile \{[^}]*var\(--divider\)[^}]*var\(--divider-hi\)/s);
  assert.match(css, /\.store-tiles\[data-count="5"\] \.store-tile[^{]*\{[^}]*width: 29%/s);
  assert.match(css, /\.store-tile-value \{[^}]*font-size: 15px/s);
});

test("B41/B326: a Related row's icon: the picture over its section list's fallback icon, the fallback alone when there is none or it fails", async () => {
  const { grouped } = await import("../nav/ui.js");
  const route = { tab: "search", path: ["package:com.a"] };
  const rows = [
    browseMod.relatedRow({ id: "com.b", name: "bravo", short: "B", section: "Tweaks", icon: "https://repo.example/b.png" }, route),
    // B326: BigBoss's tweaks: Icon is a PreferenceLoader path on the device, which no page can load
    browseMod.relatedRow({ id: "com.c", name: "Charlie", section: "Tweaks", icon: "file:///Library/PreferenceLoader/Preferences/C.png" }, route),
    browseMod.relatedRow({ id: "com.d", name: "", section: "Nothing Cydia Knows" }, route),
    browseMod.relatedRow({ id: "com.e", name: "Echo", section: "Themes", icon: "http://repo.example/e.png" }, route),
  ];
  assert.equal(rows[0].icon.src, "https://repo.example/b.png");
  assert.equal(rows[0].icon.cls, "store-related-icon");
  assert.equal(rows[1].icon.src, null, "a URL we can't load: no picture");
  assert.match(rows[3].icon.src, /repo\.example.*e\.png/, "http: as the section list loads it (through the proxy on the site)");
  // the section list's fallback (core/sectionicons.js packageIcon), never a letter tile
  for (const r of rows) assert.equal(r.icon.text, "", "no letter");
  assert.equal(rows[0].icon.color, 'url("icons/sections/Tweaks.png") center / cover no-repeat');
  assert.equal(rows[1].icon.color, 'url("icons/sections/Tweaks.png") center / cover no-repeat', "the tweak shows the Tweaks icon, as in its section list");
  assert.equal(rows[2].icon.color, 'url("icons/sections/unknown.png") center / cover no-repeat', "an unknown section: Cydia's unknown.png");
  assert.equal(rows[3].icon.color, 'url("icons/sections/Themes.png") center / cover no-repeat');
  const icons = byClass(grouped([{ rows }]), "store-related-icon");
  assert.equal(icons.length, 4);
  const img = icons[0].children.find((c) => c.tagName === "IMG");
  assert.ok(img, "the picture is in the tile");
  assert.equal(img.src, "https://repo.example/b.png");
  img.onerror();
  assert.equal(icons[0].children.some((c) => c.tagName === "IMG"), false, "a failed load leaves the fallback");
  assert.equal(icons[1].children.some((c) => c.tagName === "IMG"), false);
  // The CSS sizes and clips the picture to the tile and hides it until it loads (the bug: it drew at its own size).
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  assert.match(css, /\.store-related-icon \{[^}]*position: relative[^}]*overflow: hidden/s);
  assert.match(css, /\.store-related-icon img \{[^}]*position: absolute[^}]*inset: 0[^}]*width: 100%[^}]*height: 100%/s);
  assert.match(css, /\.store-related-icon img \{[^}]*opacity: 0/s); // C46: in its look-only rule
  assert.match(css, /\.store-related-icon img\.loaded \{[^}]*opacity: 1/s);
});

test("B41: the header's sides are inset like the grouped rows' contents (10px margin + 1px border + 10px padding)", () => {
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  const head = css.match(/\n\.store-head \{[^}]*\}/s)[0];
  assert.match(head, /padding: 14px 21px 30px/);
  const layout = readFileSync(new URL("../style.css", import.meta.url), "utf8"); // C44: style.css's Era hooks
  assert.match(layout, /--group-margin: 10px 10px 0;/, "the group margin the 21px is built from");
  assert.match(layout, /\.group \{ margin: var\(--group-margin\); \}/);
  assert.match(layout, /--cell-pad: 0 10px;/);
  assert.match(layout, /\.cell-inner \{[^}]*padding: var\(--cell-pad\)/s);
});

test("F206: the Rating tile holds its place from the first paint and is filled in place; the others never shift", () => {
  const t = sp.tileRow();
  assert.deepEqual(t.row.children.map((c) => c.dataset.key), ["rating"], "the placeholder before anything else");
  const pending = t.row.children[0];
  assert.equal(pending.dataset.pending, "true");
  assert.equal(one(pending, "store-tile-value").textContent, "—");
  assert.equal(one(pending, "store-stars-fill").style.width, "0%", "grey empty stars");
  t.set("works", sp.worksOnTile({ status: "works", range: "iOS 15.0 or later" }));
  t.set("size", sp.sizeTile("412 kB"));
  assert.equal(t.row.dataset.count, "3");
  const shape = (tile) => tile.children.map((c) => c.className);
  t.set("rating", sp.ratingTile({ average: 4.6, count: 9 }));
  const filled = t.row.children[0];
  assert.deepEqual(t.row.children.map((c) => c.dataset.key), ["rating", "works", "size"]);
  assert.equal(t.row.dataset.count, "3", "the count (and so the column widths) unchanged");
  assert.deepEqual(shape(filled), shape(pending), "label, value, stars: the same parts, so the same height");
  assert.equal(filled.dataset.pending, undefined);
  assert.equal(one(filled, "store-tile-value").textContent, "4.6");
  t.set("rating", sp.ratingTile(null));
  assert.equal(t.row.dataset.count, "3");
  assert.deepEqual(shape(t.row.children[0]), ["store-tile-label", "store-tile-value", "store-tile-sub"]);
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  assert.match(css, /\.store-tile-sub \{ line-height: 12px; \}/);
  assert.match(css, /\.store-tile > \.store-stars\.small \{ margin: 1px 0; \}/, "stars 10px + 2px = the sub line's 12px");
  assert.deepEqual(sp.tileRow({ rating: false }).row.children, []);
});

test("B82: the App Store's rating (nobody rated this build) is named as such on the header and the Rating tile", () => {
  const h = sp.storeHeader({ name: "YouTube" });
  h.setRating({ average: 4.6, count: 50123456, noun: "Ratings", onAppStore: true });
  const row = one(h.head, "store-head-rating");
  assert.equal(one(row, "store-head-count").textContent, "(50,123,456) on the App Store");
  assert.equal(row.dataset.from, "appstore");
  h.setRating({ average: 4.5, count: 12, noun: "Ratings" });
  assert.equal(one(row, "store-head-count").textContent, "(12)", "ours: the count alone");
  assert.equal(row.dataset.from, "build");
  h.setRating({ average: 4, count: null, onAppStore: true });
  assert.equal(one(row, "store-head-count").textContent, "on the App Store");
  assert.deepEqual(sp.ratingTile({ average: 4.64, count: 50123456, onAppStore: true }), { label: "Rating", value: "4.6", sub: "App Store" });
  assert.deepEqual(sp.ratingTile({ average: 4.5, count: 12 }), { label: "Rating", value: "4.5", stars: 4.5 });
});

test("B82: the This Build card (no header, ours only, its own lines) and the App Store card (big average, no bars, the note)", () => {
  const b = sp.ratingsCard({ average: 4.5, count: 12, noun: "Ratings", histogram: [8, 3, 1, 0, 0] }, { build: true });
  assert.equal(one(b, "group-header"), undefined);
  assert.equal(one(b, "store-ratings-from").textContent, "Rated by people using this build. Bars from 12 ratings.");
  const none = sp.ratingsCard(null, { build: true, reviews: [] });
  assert.equal(byClass(none, "store-bar").length, 5, "the empty bars stay");
  assert.equal(one(none, "store-ratings-count").textContent, "No Ratings");
  assert.equal(one(none, "store-ratings-from").textContent, "Nobody has rated this build yet. Be the first.");
  assert.equal(one(sp.ratingsCard(null, { build: true, pending: true }), "group-header"), undefined, "the skeleton has the same shape");
  assert.equal(one(sp.ratingsCard(null), "group-header").textContent, "Ratings", "a tweak page keeps its header");

  const s = sp.appStoreCard({ average: 4.64, count: 50123456 }, { name: "YouTube", seller: "Google LLC" });
  assert.equal(one(s, "store-appstore-big").textContent, "4.6");
  assert.equal(one(s, "store-stars").attrs["aria-label"], "4.6 out of 5 stars");
  assert.equal(one(s, "store-appstore-count").textContent, "50,123,456 Ratings");
  assert.equal(byClass(s, "store-bar").length, 0);
  assert.equal(one(s, "store-appstore-note").textContent, "For YouTube by Google LLC on the App Store, not this build.");
  assert.equal(one(sp.appStoreCard({ average: 5, count: 1 }, { name: "Tiny" }), "store-appstore-note").textContent, "For Tiny on the App Store, not this build.");
  assert.equal(one(sp.appStoreCard({ average: 5, count: 1 }), "store-appstore-count").textContent, "1 Rating");
  const unrated = sp.appStoreCard(null, {});
  assert.equal(one(unrated, "store-appstore-big").textContent, "—");
  assert.equal(one(unrated, "store-appstore-count").textContent, "No Ratings");
  assert.equal(one(unrated, "store-appstore-note").textContent, "For the original app on the App Store, not this build.");
  const css = readFileSync(new URL("../reviews.css", import.meta.url), "utf8");
  assert.match(css, /\.store-appstore-big \{[^}]*font-size: 28px; font-weight: bold;/, "the concept's bold 28px average");
});
