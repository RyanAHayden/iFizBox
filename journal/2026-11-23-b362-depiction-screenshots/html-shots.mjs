// What htmlShots finds in saved depiction pages, beside every <img> the page has.
//   node html-shots.mjs <previews.js> <page.html> <base url> [...]
const [mod, ...rest] = process.argv.slice(2);
const { htmlShots } = await import(new URL(mod, `file://${process.cwd()}/`).href);
const { readFile } = await import("node:fs/promises");
for (let i = 0; i < rest.length; i += 2) {
  const html = await readFile(rest[i], "utf8");
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0].slice(0, 260));
  console.log(`== ${rest[i + 1]}: ${imgs.length} <img>`);
  for (const t of imgs) console.log("  img", t);
  for (const s of htmlShots(html, rest[i + 1])) console.log("  SHOT", s.url, s.width, s.height);
}
