import { readFileSync } from "node:fs";
// node havoc-paid-check.mjs <Havoc's plain Packages, curl https://havoc.app/Packages>
import { createCatalog, ALL } from "../../web/app/core/catalog.js";
const text = readFileSync(process.argv[2], "utf8");
const c = createCatalog();
c.load("havoc", text, "https://havoc.app/", "iphoneos-arm64");
c.setDevice({ ios: "16.5", jailbreak: "rootless" });
const paid = c.list(ALL, ALL).filter((r) => r.paid);
const miss = paid.filter((r) => !c.search(r.name).some((h) => h.id === r.id));
console.log("jailbreak: paid rows", paid.length, "listed; not found by name:", miss.map((r) => r.name));
const s = createCatalog();
s.setDevice({ ios: "27.0", jailbreak: "none" });
console.log("sideload loaded", s.load("havoc", text, "https://havoc.app/", "iphoneos-arm64", { tweaks: true }));
for (const q of ["aerial", "Aerial", "griddy"]) console.log("sideload", q, s.search(q).map((r) => `${r.id} ${r.version} paid=${r.paid}`));
const tw = s.list(ALL, "App Tweaks");
const missS = tw.filter((r) => !s.search(r.name).some((h) => h.id === r.id));
console.log("sideload app tweaks", tw.length, "paid", tw.filter((r) => r.paid).length, "not found by name:", missS.length);
