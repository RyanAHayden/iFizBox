// Adding, checking and running Cellular Installs from the page (core/cellularshortcut.js): On Cellular's rows, Check
// Connection (screens/installroute.js) and the popup on cellular (signing/cellular.js), which reach this with import().
import { addShortcut, checkShortcut, shortcutStatus } from "../core/cellularshortcut.js";
import { ADD_AGAIN, SHORTCUT_FAILED, needsAdding, setShortcutRan, shortcutRan, shortcutWhy } from "../core/cellular.js";
import { runCellular } from "./cellularrun.js";
import { alertOK, showAlert } from "../nav/alert.js";

// {available, added}, or null: no Shortcut here (an older shell, the website).
export async function readShortcut(native) {
  try {
    const s = await shortcutStatus(native);
    return s?.available && s.bundled ? { available: true, added: Boolean(s.added) || shortcutRan() } : { available: false, added: false };
  } catch { return null; }
}

// Resolves once the user is back in the app: the page went hidden (Shortcuts in front) and visible again. A page that
// doesn't go hidden within `leaveMs` (the share sheet sent the file elsewhere) resolves then; false after `limit` away.
export function backInApp(doc = globalThis.document, { leaveMs = 4000, limit = 15 * 60 * 1000 } = {}) {
  return new Promise((done) => {
    let left = Boolean(doc?.hidden), t = 0;
    const end = (v) => { clearTimeout(t); doc?.removeEventListener?.("visibilitychange", seen); done(v); };
    const away = () => { clearTimeout(t); t = setTimeout(() => end(false), limit); };
    const seen = () => {
      if (doc.hidden) { left = true; away(); } else if (left) end(true);
    };
    doc?.addEventListener?.("visibilitychange", seen);
    if (left) away(); else t = setTimeout(() => end(true), leaveMs);
  });
}

// The share sheet, then back in the app. Whether it was added only a check or a run says.
async function add(native, { alert, whenBack = backInApp }) {
  let o;
  try { o = await addShortcut(native); } catch (e) {
    await alertOK("Couldn't Add Shortcut", String(e?.message ?? e), alert);
    return false;
  }
  return Boolean(o?.opened) && await whenBack() !== false;
}
// null: it passed; else the code.
export async function checkFailed(native) {
  let r;
  try { r = await checkShortcut(native); } catch { r = { ok: false, error: "not_opened" }; }
  if (r?.ok) return null;
  const code = r?.error || "not_run";
  if (needsAdding(code)) setShortcutRan(false);
  return code;
}
// A failed check says so, with its fix; true once a check passes. `lead`: said first.
export async function repairShortcut(native, code, opts = {}, lead = "") {
  const { alert = showAlert } = opts;
  const adding = needsAdding(code);
  const r = await alert({ title: SHORTCUT_FAILED, message: `${lead}${shortcutWhy(code)}`, buttons: ["Not Now", adding ? ADD_AGAIN : "Try Again"], cancel: 0 });
  if (r?.index !== 1) return false;
  if (adding && !(await add(native, { ...opts, alert }))) return false;
  const next = await checkFailed(native);
  return next ? repairShortcut(native, next, opts) : true;
}
// Adds it and checks it, which also has iOS ask its Allow before an install needs it. True once a check passes.
export async function setUpShortcut(native, opts = {}) {
  if (!(await add(native, { alert: showAlert, ...opts }))) return false;
  const code = await checkFailed(native);
  return code ? repairShortcut(native, code, opts) : true;
}

// What the popup uses: null when it can't run here. run(): null once it passed, else the code.
export async function popupShortcut(native, { alert = showAlert, whenBack = backInApp } = {}) {
  const s = await readShortcut(native);
  if (!s?.available) return null;
  return {
    added: s.added,
    add: () => add(native, { alert, whenBack }),
    async run() {
      let r;
      try { r = await runCellular(native, (title, message) => alertOK(title, message, alert)); } catch { return "not_opened"; }
      if (r?.ok) { setShortcutRan(true); return null; }
      const code = r?.error || "not_run";
      if (needsAdding(code)) setShortcutRan(false);
      return code;
    },
  };
}
