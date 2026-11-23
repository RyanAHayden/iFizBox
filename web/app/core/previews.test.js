// F122: an app's or package's links, and every kind of preview picture a source offers, into one gallery.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage as memStore } from "../fakes.test-helper.js";
import {
  githubRepoOf, githubOf, appLinks, appGithub, packageLinks, packageGithub, sileoLinks,
  altShots, rawAltShots, aptShots, sileoShots, htmlShots, readmeShots, releaseShots, dedupeShots, isScreenshotUrl,
  loadPreviews, clearPreviewMemory, githubShots, PREVIEW_TTL,
} from "./previews.js";
import { parseAltSource, appStanza } from "./altstore.js";
import { parseIpaSource } from "./sources/ipa.js";

const urls = (list) => list.map((s) => s.url);

test("AltStore 1.x: screenshotURLs", () => {
  const src = parseAltSource({ apps: [{ bundleIdentifier: "a.b", name: "A", version: "1", downloadURL: "https://x.dev/a.ipa",
    screenshotURLs: ["https://x.dev/1.png", "javascript:alert(1)", "https://x.dev/2.png"] }] });
  assert.deepEqual(urls(altShots(src.apps[0])), ["https://x.dev/1.png", "https://x.dev/2.png"]);
  assert.ok(altShots(src.apps[0]).every((s) => s.from === "altstore"));
});

test("AltStore 2.0: strings, {imageURL,width,height}, and the iphone/ipad split", () => {
  const src = parseAltSource({ apps: [
    { bundleIdentifier: "s", name: "S", versions: [{ version: "1", downloadURL: "https://x.dev/s.ipa" }], screenshots: ["https://x.dev/s1.png"] },
    { bundleIdentifier: "o", name: "O", versions: [{ version: "1", downloadURL: "https://x.dev/o.ipa" }],
      screenshots: [{ imageURL: "https://x.dev/o1.png", width: 1179, height: 2556 }, { imageURL: "https://x.dev/o2.png" }] },
    { bundleIdentifier: "d", name: "D", versions: [{ version: "1", downloadURL: "https://x.dev/d.ipa" }],
      screenshots: { iphone: ["https://x.dev/p.png", { imageURL: "https://x.dev/p2.png", width: 9, height: 19 }], ipad: [{ imageURL: "https://x.dev/pad.png", width: 2048, height: 1536 }] } },
  ] });
  const [s, o, d] = src.apps;
  assert.deepEqual(urls(altShots(s)), ["https://x.dev/s1.png"]);
  assert.deepEqual(altShots(o).map((x) => [x.url, x.width, x.height]), [["https://x.dev/o1.png", 1179, 2556], ["https://x.dev/o2.png", null, null]]);
  assert.deepEqual(altShots(d).map((x) => [x.url, x.device]), [["https://x.dev/p.png", "iphone"], ["https://x.dev/p2.png", "iphone"], ["https://x.dev/pad.png", "ipad"]]);
  // The raw forms read the same without core/altstore.js's parse.
  assert.deepEqual(urls(rawAltShots({ screenshots: { iphone: ["https://x.dev/p.png"], ipad: [{ imageURL: "https://x.dev/pad.png" }] } })),
    ["https://x.dev/p.png", "https://x.dev/pad.png"]);
});

const SILEO = {
  class: "DepictionTabView", minVersion: "0.1", headerImage: "https://x.dev/header.png",
  tabs: [
    { tabname: "Details", class: "DepictionStackView", views: [
      { class: "DepictionScreenshotsView", itemSize: "{160, 346}", itemCornerRadius: 8, screenshots: [
        { url: "https://x.dev/sh1.png", accessibilityText: "One" },
        { url: "https://x.dev/clip.mp4", video: true },
        { url: "https://x.dev/sh2.jpg" },
      ] },
      { class: "DepictionMarkdownView", markdown: "hello" },
      { class: "DepictionTableButtonView", title: "Source Code", action: "https://github.com/dev/Tweak" },
      { class: "DepictionTableButtonView", title: "Changelog", action: "depiction-https://x.dev/changes.json" },
      { class: "DepictionButtonView", text: "Twitter", action: "https://twitter.com/dev" },
    ] },
    { tabname: "More", class: "DepictionStackView", views: [{ class: "DepictionScreenshotsView", screenshots: [{ url: "https://x.dev/sh3.png" }] }] },
  ],
};

test("Sileo depiction: every DepictionScreenshotsView, sized by itemSize, videos skipped", () => {
  const shots = sileoShots(SILEO);
  assert.deepEqual(urls(shots), ["https://x.dev/sh1.png", "https://x.dev/sh2.jpg", "https://x.dev/sh3.png"]);
  assert.deepEqual([shots[0].width, shots[0].height, shots[0].from], [160, 346, "sileo"]);
  assert.equal(shots[2].width, null);
  assert.deepEqual(sileoShots(null), []);
  assert.deepEqual(sileoShots({ class: "DepictionScreenshotsView", screenshots: "no" }), []);
});

test("APT fields: Screenshots: in any separator, Header: as a wide banner, Icon: left out", () => {
  const shots = aptShots({ screenshots: "https://x.dev/a.png, https://x.dev/b.png\n https://x.dev/c.png ftp://no", header: "https://x.dev/h.png", icon: "https://x.dev/i.png" });
  assert.deepEqual(urls(shots), ["https://x.dev/a.png", "https://x.dev/b.png", "https://x.dev/c.png", "https://x.dev/h.png"]);
  assert.equal(shots[3].banner, true);
  assert.ok(shots[3].width > shots[3].height);
  assert.deepEqual(aptShots({}), []);
});

const README = `# Cool App
[![Build](https://github.com/dev/cool/actions/workflows/build.yml/badge.svg)](https://github.com/dev/cool/actions)
[![Downloads](https://img.shields.io/github/downloads/dev/cool/total)](x)
<p align="center"><img src="assets/icon.png" width="128"></p>
<img src="docs/shot1.png" width="300" alt="Home screen">

![Settings](./images/shot2.jpg "Settings")
![Player][player]
![](https://github.com/dev/cool/blob/main/images/shot3.png?raw=true)
![logo](images/logo.png)
![tiny](images/small.png)
<img src="https://avatars.githubusercontent.com/u/123?v=4" width="50">

https://github.com/user-attachments/assets/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b

\`\`\`
![not a picture](inside-code.png)
\`\`\`

[player]: images/player%20view.png
`;

test("a GitHub README: relative images resolve against the repo, badges and icons are skipped", () => {
  const shots = readmeShots(README, { owner: "dev", repo: "cool", path: "README.md" });
  assert.deepEqual(urls(shots), [ // in the README's order
    "https://raw.githubusercontent.com/dev/cool/HEAD/docs/shot1.png",
    "https://raw.githubusercontent.com/dev/cool/HEAD/images/shot2.jpg",
    "https://raw.githubusercontent.com/dev/cool/HEAD/images/player%20view.png",
    "https://raw.githubusercontent.com/dev/cool/main/images/shot3.png",
    "https://raw.githubusercontent.com/dev/cool/HEAD/images/small.png",
    "https://github.com/user-attachments/assets/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
  ]);
  assert.ok(shots.every((s) => s.from === "readme"));
  // A README in docs/ resolves against docs/.
  assert.deepEqual(urls(readmeShots("![a](pic.png)", { owner: "o", repo: "r", path: "docs/README.md" })), ["https://raw.githubusercontent.com/o/r/HEAD/docs/pic.png"]);
});

test("isScreenshotUrl: badges, shields, svg, avatars, tiny pictures are not screenshots", () => {
  for (const u of ["https://img.shields.io/badge/x-y-blue", "https://x.dev/a.svg", "https://x.dev/app-icon.png", "https://x.dev/Logo.PNG",
    "https://github.com/o/r/workflows/CI/badge.svg", "https://avatars.githubusercontent.com/u/1", "https://ko-fi.com/img/button.png",
    "https://x.dev/download-on-the-app-store.png", "https://raw.githubusercontent.com/StikStore/altdirect/main/assets/png/AltSource_Blue.png",
    "https://x.dev/Download_Blue.png", "https://x.dev/add-to-altstore.png"]) assert.equal(isScreenshotUrl(u), false, u);
  assert.equal(isScreenshotUrl("https://x.dev/s.png", { width: 64 }), false);
  assert.equal(isScreenshotUrl("https://x.dev/s.png", { alt: "App icon" }), false);
  assert.equal(isScreenshotUrl("https://x.dev/screen.png", { alt: "The play button" }), true);
  assert.equal(isScreenshotUrl("https://i.imgur.com/abc"), true);
  assert.equal(isScreenshotUrl("https://x.dev/page"), false);
});

test("the latest release: attached pictures (not the icon) and its notes' images", () => {
  const shots = releaseShots({ tag_name: "v2", body: "New look:\n![new](shots/new.png)", assets: [
    { name: "Cool.ipa", content_type: "application/octet-stream", browser_download_url: "https://github.com/dev/cool/releases/download/v2/Cool.ipa" },
    { name: "screenshot-1.png", content_type: "image/png", browser_download_url: "https://github.com/dev/cool/releases/download/v2/screenshot-1.png" },
    { name: "AppIcon.png", content_type: "image/png", browser_download_url: "https://github.com/dev/cool/releases/download/v2/AppIcon.png" },
  ] }, { owner: "dev", repo: "cool", ref: "v2" });
  assert.deepEqual(urls(shots), ["https://github.com/dev/cool/releases/download/v2/screenshot-1.png", "https://raw.githubusercontent.com/dev/cool/v2/shots/new.png"]);
  assert.deepEqual(releaseShots(null), []);
});

test("a Zebra/Cydia HTML depiction: screenshot images when marked, else every real picture", () => {
  const page = `<html><head><base href="https://repo.dev/depictions/"></head><body>
    <img src="../icons/arrow.png"><img src="https://repo.dev/badge.svg">
    <div class="screenshots"><img class="screenshot" src="tweak/1.png"><img class="screenshot" src='tweak/2.png'></div>
    <img src="banner.jpg"></body></html>`;
  assert.deepEqual(urls(htmlShots(page, "https://repo.dev/d/x.html")), ["https://repo.dev/depictions/tweak/1.png", "https://repo.dev/depictions/tweak/2.png"]);
  assert.deepEqual(urls(htmlShots('<img src="/p/one.jpg" width="20"><img src="/p/two.jpg">', "https://repo.dev/d/x.html")), ["https://repo.dev/p/two.jpg"]);
  assert.deepEqual(htmlShots("", "https://repo.dev/"), []);
});

test("dedupeShots: http/https, host case, blob vs raw and ?raw=true are one picture; sizes are kept", () => {
  const out = dedupeShots([
    { url: "http://X.dev/a.png", width: null, height: null, from: "apt" },
    { url: "https://x.dev/a.png", width: 10, height: 20, from: "sileo" },
    { url: "https://github.com/o/r/blob/main/s.png?raw=true", from: "readme" },
    { url: "https://raw.githubusercontent.com/o/r/main/s.png", from: "readme" },
    { url: "", from: "x" },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].width, out[0].height], [10, 20]);
});

test("GitHub repos from URLs; the source's own repo is passed over for a release download", () => {
  assert.deepEqual(githubRepoOf("https://github.com/dev/cool/releases/download/v1/Cool.ipa"), { owner: "dev", repo: "cool" });
  assert.deepEqual(githubRepoOf("https://raw.githubusercontent.com/dev/cool/main/x"), { owner: "dev", repo: "cool" });
  assert.deepEqual(githubRepoOf("https://dev.github.io/cool/"), { owner: "dev", repo: "cool" });
  assert.equal(githubRepoOf("https://github.com/user-attachments/assets/abc"), null);
  assert.equal(githubRepoOf("https://github.com/dev"), null);
  assert.deepEqual(githubOf(["https://x.dev", "https://github.com/a/b"], { not: { owner: "A", repo: "B" } }), null);
});

test("an AltStore app's links: developer website, GitHub (code field, website, or the IPA's release), source code", () => {
  const json = { name: "Src", apps: [
    { bundleIdentifier: "a", name: "A", website: "https://a.dev", sourceURL: "https://github.com/dev/A",
      versions: [{ version: "1", downloadURL: "https://cdn.dev/a.ipa" }] },
    { bundleIdentifier: "b", name: "B", versions: [{ version: "1", downloadURL: "https://github.com/dev/B/releases/download/v1/B.ipa" }] },
    { bundleIdentifier: "c", name: "C", versions: [{ version: "1", downloadURL: "https://github.com/me/apps/releases/download/v1/C.ipa" }] },
    { bundleIdentifier: "d", name: "D", sourceCodeURL: "https://gitlab.com/dev/d", versions: [{ version: "1", downloadURL: "https://cdn.dev/d.ipa" }] },
  ] };
  const parsed = parseIpaSource("altstore", json);
  const app = (i) => appStanza(parsed.apps[i], { url: "https://raw.githubusercontent.com/me/apps/main/source.json", name: "Src" }).ipa;
  assert.deepEqual(appLinks(app(0)).map((l) => [l.kind, l.label, l.detail, l.url]), [
    ["website", "Developer Website", "a.dev", "https://a.dev"],
    ["github", "GitHub", "dev/A", "https://github.com/dev/A"],
  ]);
  assert.deepEqual(appLinks(app(1)).map((l) => l.url), ["https://github.com/dev/B"]);
  assert.deepEqual(appGithub(app(1)), { owner: "dev", repo: "B" });
  assert.deepEqual(appLinks(app(2)), [], "an IPA in the source's own repo is the source's, not the app's");
  assert.deepEqual(appLinks(app(3)).map((l) => [l.label, l.url]), [["Source Code", "https://gitlab.com/dev/d"]]);
  // A one-app source in the app's own repo (Feather's app-repo.json): that repo is the app's.
  const one = parseIpaSource("altstore", { apps: [{ bundleIdentifier: "f", name: "Feather", versions: [{ version: "1", downloadURL: "https://github.com/claration/Feather/releases/download/v1/Feather.ipa" }] }] });
  assert.deepEqual(appGithub(appStanza(one.apps[0], { url: "https://raw.githubusercontent.com/claration/Feather/main/app-repo.json" }).ipa), { owner: "claration", repo: "Feather" });
  const hosted = parseIpaSource("altstore", { apps: [{ bundleIdentifier: "f", name: "Feather", versions: [{ version: "1", downloadURL: "https://cdn.dev/f.ipa" }] }] });
  assert.deepEqual(appGithub(appStanza(hosted.apps[0], { url: "https://feather.github.io/Feather/source.json" }).ipa), { owner: "feather", repo: "Feather" });
});

test("a package's links: Homepage:, GitHub from it or the depiction's buttons, the Sileo depiction's web buttons", () => {
  assert.deepEqual(sileoLinks(SILEO), [{ label: "Source Code", url: "https://github.com/dev/Tweak" }, { label: "Twitter", url: "https://twitter.com/dev" }]);
  const links = packageLinks({ homepage: "https://tweak.dev/" }, SILEO);
  assert.deepEqual(links.map((l) => [l.kind, l.label, l.url]), [
    ["website", "Developer Website", "https://tweak.dev/"],
    ["github", "GitHub", "https://github.com/dev/Tweak"],
    ["depiction", "Twitter", "https://twitter.com/dev"],
  ]);
  assert.deepEqual(packageLinks({ homepage: "https://github.com/dev/x" }).map((l) => l.label), ["GitHub"]);
  assert.deepEqual(packageGithub({ homepage: "https://github.com/dev/x" }), { owner: "dev", repo: "x" });
  assert.deepEqual(packageLinks({}), []);
});

test("loadPreviews: the source's own first; else the depiction page; else GitHub; cached per app for a day", async () => {
  clearPreviewMemory();
  const asked = [];
  const files = {
    "https://raw.githubusercontent.com/dev/cool/HEAD/README.md": README,
    "https://api.github.com/repos/dev/cool/releases/latest": JSON.stringify({ tag_name: "v2", assets: [
      { name: "shot.png", content_type: "image/png", browser_download_url: "https://github.com/dev/cool/releases/download/v2/shot.png" }] }),
    "https://repo.dev/dep.html": '<img class="screenshot" src="s.png">',
  };
  const text = async (u) => { asked.push(u); if (u in files) return files[u]; throw new Error("404"); };
  const store = memStore();

  const own = await loadPreviews("a", { shots: [{ url: "https://x.dev/1.png" }, { url: "http://x.dev/1.png" }], gh: { owner: "dev", repo: "cool" } }, { text, store });
  assert.deepEqual(urls(own), ["https://x.dev/1.png"]);
  assert.equal(asked.length, 0, "a source with screenshots fetches nothing");

  assert.deepEqual(urls(await loadPreviews("b", { html: "https://repo.dev/dep.html", gh: { owner: "dev", repo: "cool" } }, { text, store })), ["https://repo.dev/s.png"]);

  const gh = await loadPreviews("c", { gh: { owner: "dev", repo: "cool" } }, { text, store, now: 1000 });
  assert.equal(gh.at(-1).url, "https://github.com/dev/cool/releases/download/v2/shot.png");
  assert.ok(gh.some((s) => s.url.endsWith("/images/shot2.jpg")));
  const n = asked.length;
  clearPreviewMemory();
  assert.deepEqual(await loadPreviews("c", { gh: { owner: "dev", repo: "cool" } }, { text, store, now: 2000 }), gh, "from the cache");
  assert.equal(asked.length, n);
  await loadPreviews("c", { gh: { owner: "dev", repo: "cool" } }, { text, store, now: 1000 + PREVIEW_TTL + 1 });
  assert.ok(asked.length > n, "refetched after a day");

  assert.deepEqual(await loadPreviews("d", {}, { text, store }), []);
});

test("githubShots: a README under another name is found through the API; a failed release is no error", async () => {
  const files = {
    "https://api.github.com/repos/o/r/readme": JSON.stringify({ path: "docs/README.md", download_url: "https://raw.githubusercontent.com/o/r/main/docs/README.md" }),
    "https://raw.githubusercontent.com/o/r/main/docs/README.md": "![s](s.png)",
  };
  const shots = await githubShots({ owner: "o", repo: "r" }, async (u) => { if (u in files) return files[u]; throw new Error("404"); });
  assert.deepEqual(urls(shots), ["https://raw.githubusercontent.com/o/r/HEAD/docs/s.png"]);
});

// ---- F181: a Sileo depiction's rating, reviews and newest changelog entry ----------------------------------------
import { sileoRatings, sileoWhatsNew } from "./previews.js";

test("F181: sileoRatings: the RatingView's average, the ReviewViews as reviews, none without either", () => {
  const dep = { class: "DepictionTabView", tabs: [
    { tabname: "Details", class: "DepictionStackView", views: [{ class: "DepictionRatingView", rating: 4.5 }] },
    { tabname: "Reviews", class: "DepictionStackView", views: [
      { class: "DepictionReviewView", title: "Great", author: "Ann", rating: 5, markdown: "**Love** it" },
      { class: "DepictionReviewView", title: "Meh", author: "Bo", rating: "2", markdown: "<b>ok</b>", useRawFormat: true },
    ] },
  ] };
  assert.deepEqual(sileoRatings(dep), { average: 4.5, count: 2, noun: "Reviews", reviews: [
    { title: "Great", author: "Ann", rating: 5, text: "**Love** it", raw: false },
    { title: "Meh", author: "Bo", rating: 2, text: "<b>ok</b>", raw: true },
  ] });
  // No RatingView: the reviews' mean; a RatingView alone: no count.
  assert.equal(sileoRatings({ views: dep.tabs[1].views }).average, 3.5);
  assert.deepEqual(sileoRatings({ class: "DepictionRatingView", rating: 9 }), { average: 5, count: null, noun: "Reviews", reviews: [] });
  assert.equal(sileoRatings({ class: "DepictionStackView", views: [{ class: "DepictionMarkdownView", markdown: "hi" }] }), null);
  assert.equal(sileoRatings(null), null);
  assert.equal(sileoRatings({ class: "DepictionRatingView", rating: "junk" }), null);
});

test("F181: sileoWhatsNew: the Changelog tab's first header and its text, up to the next", () => {
  const tab = (views, tabname = "Changelog") => ({ class: "DepictionTabView", tabs: [{ tabname: "Details", views: [] }, { tabname, class: "DepictionStackView", views }] });
  assert.deepEqual(sileoWhatsNew(tab([
    { class: "DepictionSubheaderView", title: "2.1.3" },
    { class: "DepictionMarkdownView", markdown: "- Fixes a stutter" },
    { class: "DepictionLabelView", text: "New Bouncy preset" },
    { class: "DepictionSubheaderView", title: "2.1.2" },
    { class: "DepictionMarkdownView", markdown: "- older" },
  ])), { title: "2.1.3", text: "- Fixes a stutter\nNew Bouncy preset" });
  // One Markdown view holding every version under its own heading.
  assert.deepEqual(sileoWhatsNew(tab([{ class: "DepictionMarkdownView", markdown: "## 1.2\n- fix\n- more\n\n## 1.1\n- old" }], "What's New")),
    { title: "1.2", text: "- fix\n- more" });
  // Stacks inside the tab are read in order.
  assert.deepEqual(sileoWhatsNew(tab([{ class: "DepictionStackView", views: [{ class: "DepictionHeaderView", title: "v3" }, { class: "DepictionMarkdownView", markdown: "x" }] }])),
    { title: "v3", text: "x" });
  assert.equal(sileoWhatsNew(tab([{ class: "DepictionMarkdownView", markdown: "hi" }], "Screenshots")), null);
  assert.equal(sileoWhatsNew({ class: "DepictionStackView", views: [] }), null);
});

// ---- B328: an HTML depiction's description ----
import { readFileSync } from "node:fs";
import { depictionDescription, betterDescription, loadDepictionDescription } from "./previews.js";
const depictionFixture = (name) => readFileSync(new URL(`./fixtures/depictions/${name}`, import.meta.url), "utf8");

test("B328: a BigBoss depiction (Springy, saved page): fieldset#description as plain text, chrome left out", () => {
  const text = depictionDescription(depictionFixture("bigboss-springy.html"), "http://moreinfo.thebigboss.org/moreinfo/depiction.php?file=springyDp");
  assert.equal(text, [
    "Compatible with iOS 7, 8 and 9", "", "The ultimate way to customize your respring screen.", "", "Features:", "",
    "• Use an animation or custom image during resprings", "• Customize the tint of the Apple Logo",
    "• Customize the background color of the respring screen", "• Configure the FPS and loop count of the animation",
    "• Invert the colors of the respring screen", "", "Not Compatible with RespringProgress", "",
    "Configure options from Settings", "", "See larger Screenshots below..",
  ].join("\n"));
  assert.doesNotMatch(text, /[<>]|Description|View All Screenshots|Developer Website|Terms|moveChildren|gfycat/);
  // the one-line Description: field gives way to it; a longer field stays
  assert.equal(betterDescription("Respring animations & customization", text), text);
  assert.equal(betterDescription("x".repeat(text.length + 5), text), "x".repeat(text.length + 5));
  assert.equal(betterDescription("Short", ""), "Short");
});

test("B328: another repo's depiction: the article's text, links kept as text (URL), no scripts, nav, header, footer or aside", () => {
  const text = depictionDescription(depictionFixture("repo-tweak.html"), "https://repo.example.dev/depictions/glowdock.html");
  assert.equal(text, [
    "Glow Dock", "", "Adds a soft glow behind your dock that follows the wallpaper’s colours & fades as you scroll.", "",
    "Options:", "", "• Glow strength and blur radius", "• Match the wallpaper or pick a colour", "",
    "Source code on GitHub (https://github.com/example/glowdock). Report bugs at https://example.dev/issues.",
  ].join("\n"));
  assert.doesNotMatch(text, /Donate|Other Tweak|Privacy|injected|Share|dataLayer/);
  // a page with no text to speak of gives nothing; relative links resolve against the page
  assert.equal(depictionDescription("<html><body><img src=a.png><nav>Home</nav></body></html>", "https://r.dev/"), "");
  assert.equal(depictionDescription("", "https://r.dev/"), "");
  assert.equal(depictionDescription('<div class="description">Read the <a href="/guide">setup guide</a> before installing it.</div>', "https://r.dev/d/x.html"),
    "Read the setup guide (https://r.dev/guide) before installing it.");
});

test("B328: loadDepictionDescription shares loadPreviews' page fetch and is cached per URL for a day", async () => {
  clearPreviewMemory();
  const url = "https://repo.dev/dep.html";
  let asked = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const text = async (u) => { asked++; await gate; return u === url ? '<div id="description"><p>A long enough description to count.</p></div><img class="screenshot" src="s.png">' : Promise.reject(new Error("404")); };
  const store = memStore();
  const both = Promise.all([loadPreviews("k", { html: url }, { text, store }), loadDepictionDescription(url, { text, store, now: 1000 })]);
  release();
  const [shots, desc] = await both;
  assert.deepEqual(urls(shots), ["https://repo.dev/s.png"]);
  assert.equal(desc, "A long enough description to count.");
  assert.equal(asked, 1, "one fetch for both");
  clearPreviewMemory();
  assert.equal(await loadDepictionDescription(url, { text, store, now: 2000 }), desc, "from the cache");
  assert.equal(asked, 1);
  assert.equal(await loadDepictionDescription(url, { text, store, now: 1000 + PREVIEW_TTL + 1 }), desc);
  assert.equal(asked, 2, "refetched after a day");
  assert.equal(await loadDepictionDescription("https://repo.dev/gone.html", { text, store }), "", "a failed fetch is no error");
});
