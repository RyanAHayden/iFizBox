// Setting up Restore My VPN from This iPhone's page (screens/installroute.js, with import()): the Shortcut added, then
// its store run remembering the VPN that is on (core/restoreshortcut.js; core/installroute.js has the state and texts).
import { addRestoreShortcut, rememberVPN } from "../core/restoreshortcut.js";
import { keepRestore, rememberFailed, restoreLeft } from "../core/installroute.js";
import { ADD_AGAIN } from "../core/cellular.js";
import { backInApp } from "./cellularsetup.js";
import { alertOK, showAlert } from "../nav/alert.js";

const BUSY = { tries: 6, ms: 2000 }; // a run that ended early blocks the next for 10 s (native RestoreShortcut.settle)
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// "added", "closed" (the share sheet, or never back) or "refused" (no Shortcut in this app or on this iOS).
async function add(native, { alert, whenBack }) {
  let o;
  try { o = await addRestoreShortcut(native); } catch (e) {
    await alertOK("Couldn't Add Shortcut", String(e?.message ?? e), alert);
    return ["unavailable", "missing"].includes(e?.code ?? String(e?.message ?? e).split(":")[0]) ? "refused" : "closed";
  }
  if (!o?.opened) return "closed";
  keepRestore("1"); // what it remembered before may be gone with the old one
  return await whenBack() === false ? "closed" : "added";
}

// null once the VPN is remembered, else the code.
async function remember(native, wait) {
  for (let n = 1; ; n++) {
    let r;
    try { r = await rememberVPN(native); } catch { r = { ok: false, error: "not_opened" }; }
    if (r?.ok) { keepRestore("2"); return null; }
    const code = r?.error || "not_run";
    if (code === "busy" && n < BUSY.tries) { await wait(BUSY.ms); continue; }
    // "canceled" comes while iOS's Allow is still up (F419): the Shortcut is there
    if (code === "not_run" && r?.text && r.text !== "canceled") keepRestore("0");
    return code;
  }
}

// `status()` reads idevice.status. `turnedOn`: the switch did this, so a VPN that is off isn't an error (the group's
// footer says what is left). False only when the Shortcut can't be added here.
export async function setUpRestore(native, { alert = showAlert, status, turnedOn = false, whenBack = backInApp, wait = pause } = {}) {
  const has = { alert, whenBack };
  let st = await status();
  let added = false;
  if (restoreLeft(st) === "add") {
    const a = await add(native, has);
    if (a !== "added") return a !== "refused";
    added = true;
    st = await status();
  }
  for (;;) {
    if (!st?.vpn?.restore) return true; // turned off meanwhile
    if ((turnedOn || added) && !st.vpn.otherVPN) return true;
    const code = await remember(native, wait);
    if (!code) return true;
    const f = rememberFailed(code);
    if (!f.again) { await alertOK(f.title, f.message, alert); return true; }
    const buttons = ["Not Now", "Try Again", ...(f.add ? [ADD_AGAIN] : [])];
    const pick = buttons[(await alert({ title: f.title, message: f.message, buttons, cancel: 0 }))?.index];
    if (pick === ADD_AGAIN) {
      if (await add(native, has) !== "added") return true;
      added = true;
    } else if (pick !== "Try Again") return true;
    st = await status();
  }
}
