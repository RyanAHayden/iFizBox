// node prep-ext.mjs <extension executable>: adds the probe's load command (journal tool, B425)
import { readFileSync, writeFileSync } from "node:fs";
import { injectInto } from "../../web/app/core/tweaks.js";
const f = process.argv[2];
writeFileSync(f, injectInto(new Uint8Array(readFileSync(f)), ["@rpath/ryspy.dylib"], { rpath: "@executable_path/../../Frameworks" }));
