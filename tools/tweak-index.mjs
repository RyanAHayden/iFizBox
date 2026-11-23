#!/usr/bin/env node
// Writes the Tweak Index file the app and the site carry (web/app/tweak-index.json; its shape: web/app/core/
// tweakindexfile.js) from the live Tweak Index: ifizbox.com's D1 database, read with wrangler. tools/publish.sh runs it
// at each release.
//
//   node tools/tweak-index.mjs [--out FILE]     IFIZBOX_WRANGLER: the wrangler npm package to run, as tools/deploy.sh
//
// A failed or empty read writes nothing and exits 1, so the last file stays. Needs wrangler logged in to the account
// that owns the Worker (tools/deploy.sh --check-auth).
// SPDX-License-Identifier: GPL-3.0-or-later
import { execFile } from "node:child_process";
import { rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { packIndexFile, parseIndexFile, FILE_NAME } from "../web/app/core/tweakindexfile.js";

const root = new URL("../", import.meta.url);
const PAGE = 1000, DB = "ifizbox-tweaks"; // worker/wrangler.ifizbox.toml, binding TWEAKS
const wrangler = process.env.IFIZBOX_WRANGLER || "wrangler@4.164.0";
const i = process.argv.indexOf("--out");
const out = i > 0 ? process.argv[i + 1] : fileURLToPath(new URL(`web/app/${FILE_NAME}`, root));

async function query(sql) {
  const run = promisify(execFile)("npx", ["--yes", wrangler, "d1", "execute", DB, "--remote", "--json",
    "-c", "wrangler.ifizbox.toml", "--command", sql], { cwd: fileURLToPath(new URL("worker/", root)), maxBuffer: 64 << 20, timeout: 120000 });
  run.child.stdin.end(); // never waits for an answer
  const { stdout } = await run;
  const rows = JSON.parse(stdout.slice(stdout.indexOf("[")))?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("wrangler gave no rows");
  return rows;
}

try {
  const sources = await query("SELECT key, refreshed, pending, error FROM tweak_sources ORDER BY added, key");
  const entries = [];
  for (let last = 0; ;) {
    const rows = await query(`SELECT rowid AS n, source, entry, checked FROM tweak_entries WHERE entry IS NOT NULL AND rowid > ${last} ORDER BY rowid LIMIT ${PAGE}`);
    entries.push(...rows);
    if (rows.length < PAGE) break;
    last = Number(rows[rows.length - 1].n);
    if (!Number.isSafeInteger(last)) throw new Error("wrangler gave no row numbers");
  }
  const file = packIndexFile(sources, entries);
  const text = `${JSON.stringify(file)}\n`;
  if (!file || !parseIndexFile(text)) throw new Error("the Tweak Index holds no verdicts");
  await writeFile(`${out}.new`, text);
  await rename(`${out}.new`, out);
  const list = Object.values(file.sources);
  console.log(`tweak-index: ${list.length} sources, ${list.reduce((n, s) => n + Object.keys(s.t).length, 0)} verdicts, ${text.length} bytes`);
} catch (e) {
  console.error(`tweak-index: nothing written: ${String(e?.stderr || e?.message || e).trim().split("\n").slice(-3).join(" ")}`);
  process.exit(1);
}
