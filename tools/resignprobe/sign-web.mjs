// Signs an IPA with the website's signer exactly as the browser does it (web/app/websign-job.js runSignJob, zsign as
// WebAssembly from web/app/vendor/zsign, the group fix from web/app/vendor/groupfix), here in Node, for the re-sign
// probe (tools/resignprobe/run.sh).
//   node tools/resignprobe/sign-web.mjs <in.ipa> <out.ipa> <cert.p12> <password> <profile.mobileprovision> [--no-groupfix]
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync, writeFileSync } from "node:fs";
import { joinPieces } from "../../web/app/core/pieces.js";
import { runSignJob } from "../../web/app/websign-job.js";

const [input, output, p12, password, profile, flag] = process.argv.slice(2);
if (!profile) {
  console.error("usage: sign-web.mjs <in.ipa> <out.ipa> <cert.p12> <password> <profile> [--no-groupfix]");
  process.exit(2);
}
const { default: createZsign } = await import(new URL("../../web/app/vendor/zsign/zsign.js", import.meta.url));
const groupFix = flag === "--no-groupfix" ? null : readFileSync(new URL("../../web/app/vendor/groupfix/ifizbox-groupfix.dylib", import.meta.url));
const r = await runSignJob(createZsign, {
  ipa: readFileSync(input), p12: readFileSync(p12), password, profile: readFileSync(profile), groupFix,
});
writeFileSync(output, joinPieces(r.ipa));
console.log(JSON.stringify({ bundleId: r.bundleId, injected: r.injected ?? [], ...(r.warnings ? { warnings: r.warnings } : {}) }));
