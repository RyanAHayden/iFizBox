// Running Cellular Installs (core/cellularshortcut.js), and saying when cellular data was put back after it.
import { NAME } from "../brand.js";
import { putBackAlert, putBackAtLaunch, runShortcut } from "../core/cellularshortcut.js";
import { alertOK } from "../nav/alert.js";

async function say(putBack, alert) {
  const a = putBackAlert(putBack, NAME);
  if (a) await alert(a.title, a.message);
  return putBack;
}
// The run's answer, once any put-back was said.
export async function runCellular(native, alert = alertOK) {
  const r = await runShortcut(native);
  await say(r?.putBack ?? null, alert);
  return r;
}
// At launch: a run the app was closed during.
export const sayPutBackAtLaunch = (native, alert = alertOK) => putBackAtLaunch(native).then((p) => say(p, alert));
