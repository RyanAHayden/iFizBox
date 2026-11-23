// Concept only: a looping install run on sample apps (the real runAppRun page with stand-in lanes).
import { runAppRun } from "./screens/apprun.js";
const APPS = ["Delta", "UTM", "StikDebug", "LiveContainer", "Feather", "Provenance", "PPSSPP"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ramp(progress, phase, ms, from = 0) {
  for (let i = 0; i <= 40; i++) { progress(phase, from + (1 - from) * (i / 40)); await sleep(ms / 40); }
}
async function demo() {
  const q = new Set(APPS);
  const r = runAppRun(APPS.map((n) => ({ id: `demo.${n}`, name: n, mode: "install", size: 48e6, url: "https://example.com/a.ipa" })), {
    queue: { clear: () => {}, get: () => true },
    keepAwake: () => ({ release() {}, stop() {}, end() {} }),
    lanes: {
      local: () => true,
      sign: async (row, { progress }) => {
        const i = APPS.indexOf(row.name);
        await ramp(progress, "downloading", 500 + i * 60); await ramp(progress, "signing", 500);
        return { token: row.id, bundleId: row.id };
      },
      install: async (row, { progress }) => {
        const i = APPS.indexOf(row.name);
        const t = 12000 + i * 1500;
        await ramp(progress, "copying", t * .7); await ramp(progress, "installing", t * .3);
        return { installed: true };
      },
      discard: () => {},
    },
    parallel: 3,
    onClose: () => setTimeout(demo, 900),
    reopenConfirm: () => {},
  });
  q.clear();
  return r;
}
setTimeout(() => demo().catch((e) => console.error("demo", e)), 1200);
