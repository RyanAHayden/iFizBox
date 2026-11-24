// F245: the website's real signing job on an R26-style test IPA with a real .p12 and profile, its extension removal
// off (PlugIns kept), with or without the app's profile copied into each appex first.
// Usage: node signtest.mjs REPO IPA P12 PASSWORDFILE PROFILE OUT [prof]   (run against the job as it was before F245)
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [repo, ipa, p12, pw, profile, out, prof = ""] = process.argv.slice(2);
const { runSignJob } = await import(pathToFileURL(`${repo}/web/app/websign-job.js`));
const { default: real } = await import(pathToFileURL(`${repo}/web/app/vendor/zsign/zsign.js`));
const rd = (n) => new Uint8Array(readFileSync(n));
const createZsign = async (o) => {
  const zs = await real(o), { FS } = zs, { rmdir, unlink } = FS, main = zs.callMain;
  const kept = (p) => /\/(PlugIns|Extensions)(\/|$)/.test(p);
  FS.rmdir = (p) => (kept(p) ? undefined : rmdir.call(FS, p));
  FS.unlink = (p) => (kept(p) ? undefined : unlink.call(FS, p));
  zs.callMain = (args) => {
    FS.rmdir = rmdir; FS.unlink = unlink;
    const dir = `${args[args.length - 1]}/PlugIns`;
    for (const e of FS.readdir(dir).filter((n) => n.endsWith(".appex"))) {
      const at = `${dir}/${e}/embedded.mobileprovision`;
      try { FS.unlink(at); } catch { /* none */ }
      if (prof) FS.writeFile(at, FS.readFile("/w/app.mobileprovision"));
    }
    return main(args);
  };
  return zs;
};
const r = await runSignJob(createZsign, { ipa: rd(ipa), p12: rd(p12), password: readFileSync(pw, "utf8").trim(), profile: rd(profile), keepBundleId: true });
writeFileSync(out, r.ipa);
console.log(out, r.bundleId);
