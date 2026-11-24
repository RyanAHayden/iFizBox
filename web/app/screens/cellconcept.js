// Concept only: On Cellular (This iPhone's page), its popup and simulated installs on the real run page.
import { el } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { runAppRun } from "./apprun.js";
import { rowIcon } from "../icons/rowicons.js";
import { NAME } from "../brand.js";

export const cell = { mode: "ask", added: false };
const SHORTCUT = "Cellular Installs";
const OPTIONS = [
  { value: "ask", label: "Ask Each Time", subtitle: "Airplane Mode, Shortcut or server.", icon: "help" },
  { value: "shortcut", label: "Use Shortcut", subtitle: "Cellular data goes off for a moment.", icon: "cellular" },
  { value: "server", label: "Use Signing Server", subtitle: "Data stays on. iOS asks you to install.", icon: "websiteApps" },
];
const FOOT = {
  ask: "iOS can't install straight onto this iPhone while it's on cellular data.",
  shortcut: "Shortcuts opens for a moment and turns cellular data back on by itself.",
  server: "On Wi-Fi, apps still go straight onto this iPhone.",
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function cellGroups(repaint) {
  const pick = async (v) => {
    if (v === "shortcut" && !cell.added && !(await addShortcut())) return;
    cell.mode = v;
    repaint();
  };
  const groups = [{ key: "cell", header: "On Cellular", footer: FOOT[cell.mode],
    rows: OPTIONS.map((o) => ({ label: o.label, subtitle: o.subtitle, cls: "route-row", icon: rowIcon(o.icon), checked: cell.mode === o.value, onClick: () => pick(o.value) })) }];
  if (cell.mode === "shortcut") groups.push({ key: "cellsc", rows: [{ label: "Add Shortcut Again", cls: "sign-import", onClick: () => addShortcut() }], footer: "Only if you deleted it from Shortcuts." });
  groups.push({ key: "try", header: "Concept: Try an Install", rows: [
    { label: "Install an App", onClick: () => demo({}) },
    { label: "Install 3 Apps", onClick: () => demo({ n: 3 }) },
    { label: "Turn On Airplane Mode After 5 s", onClick: () => demo({ airplane: true }) },
    { label: "Shortcut Was Deleted", onClick: () => demo({ missing: true }) },
  ], footer: "Simulated, all on cellular. The last two are easiest to see with Ask Each Time and Use Shortcut." });
  return groups;
}

// What iOS and Shortcuts show: a plain stand-in over the app.
async function standIn(title, lines, ms, buttons = null) {
  const o = el("div");
  o.style.cssText = "position:fixed;inset:0;z-index:99999;background:#f2f2f7;color:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;font:17px/1.35 'Helvetica Neue',Helvetica,sans-serif;text-align:center";
  const small = el("div", "", "Stand-in for the Shortcuts app"); small.style.cssText = "font-size:13px;color:#666";
  const h = el("div", "", title); h.style.cssText = "font-size:22px;font-weight:bold";
  const list = el("div"); list.style.cssText = "display:grid;gap:8px;text-align:left";
  o.append(small, h, list);
  const rows = lines.map((t, i) => { const d = el("div", "", `${i + 1}. ${t}`); list.append(d); return d; });
  document.body.append(o);
  let out = true;
  if (buttons) out = await new Promise((res) => buttons.forEach((b, i) => {
    const x = el("button", "", b); x.type = "button";
    x.style.cssText = "font:inherit;min-height:48px;width:240px;border:0;border-radius:12px;" + (i ? "background:#ddd;color:#111" : "background:#0a60ff;color:#fff");
    x.addEventListener("click", () => res(i === 0)); o.append(x);
  }));
  else { rows.slice(2).forEach((d) => { d.style.color = "#999"; }); await wait(ms); }
  o.remove();
  return out;
}
const STEPS = ["Turn cellular data off", `Open ${NAME}`, "Wait until the apps are connected", "Turn cellular data on"];
async function addShortcut() {
  const ok = await standIn(`Add “${SHORTCUT}”?`, STEPS, 0, ["Add Shortcut", "Cancel"]);
  if (ok) cell.added = true;
  return ok;
}

// The popup: goes by itself once the phone is off cellular (`off`), else the button's answer.
async function ask({ off, failed = false }) {
  const ctl = new AbortController();
  off.then(() => ctl.abort());
  const r = await showAlert({
    title: failed ? "Shortcut Didn't Run" : "You're on Cellular",
    message: failed ? `“${SHORTCUT}” wasn't found. Turn on Airplane Mode, join Wi-Fi, or choose:` : "Turn on Airplane Mode or join Wi-Fi and the install goes on by itself. Or choose:",
    buttons: [cell.added && !failed ? "Use Shortcut" : failed ? "Add Shortcut Again" : "Set Up Shortcut", "Use Signing Server", "Cancel"], cancel: 2, signal: ctl.signal, onTap: () => {},
  });
  return r.index < 0 ? "off" : ["shortcut", "server", "cancel"][r.index];
}

async function demo({ n = 1, airplane = false, missing = false }) {
  const names = ["Delta", "Provenance", "UTM"].slice(0, n);
  const jobs = names.map((x) => ({ id: x, name: x, mode: "install", size: 4e7 }));
  let how = null; // one answer for the whole run
  let deleted = missing;
  const runShortcut = async () => {
    if (deleted) { await standIn("Could not find the shortcut", [`“${SHORTCUT}”`], 900); return false; }
    await standIn(SHORTCUT, STEPS, 1700);
    return true;
  };
  const decide = async (progress) => {
    if (cell.mode === "server") return "server";
    if (cell.mode === "shortcut" && await runShortcut()) return "shortcut";
    let failed = cell.mode === "shortcut";
    progress("airplane");
    const off = new Promise((r) => { if (airplane) setTimeout(r, 5000); });
    while (true) {
      const a = await ask({ off, failed });
      if (a === "off" || a === "server" || a === "cancel") return a;
      if ((failed || !cell.added) && !(await addShortcut())) continue;
      cell.mode = "shortcut"; // set up from the popup: used from now on
      deleted = false; failed = false;
      if (await runShortcut()) return "shortcut";
      failed = true;
    }
  };
  const steps = async (signal, f, ms) => { for (let i = 1; i <= 10; i++) { if (signal.aborted) return; await wait(ms / 10); f(i / 10); } };
  let page = null;
  await runAppRun(jobs, {
    queue: { clear() {}, list: () => jobs }, record: async () => {}, isInstalled: async () => ({}), keepAwake: () => {},
    lanes: {
      local: () => how !== "server",
      sign: async (r, { signal, progress }) => {
        await steps(signal, (p) => progress("downloading", p), 900);
        await steps(signal, (p) => progress("signing", p, "sign"), 600);
        return { token: r.id, bundleId: `com.example.${r.id}` };
      },
      install: async (r, { signal, progress, allSigned }) => {
        await allSigned?.();
        if (!how) how = page ??= decide(progress);
        const a = await how;
        how = a;
        if (a === "cancel") throw new Error("not installed, still on cellular");
        if (a === "server") {
          progress("asking");
          const q = await showAlert({ title: "Stand-In for iOS", message: `“sign” would like to install “${r.name}”.`, buttons: ["Cancel", "Install"], onTap: () => {} });
          if (q.index !== 1) return { installed: false, dismissed: true };
          progress("installing", 0.01);
          await steps(signal, (p) => progress("installing", p), 1500);
          return { installed: true };
        }
        progress("connecting");
        await wait(700);
        if (a === "off") { progress("airplaneOff"); await wait(1600); }
        await steps(signal, (p) => progress("copying", p), 1300);
        await steps(signal, (p) => progress("installing", p), 900);
        return { installed: true };
      },
      discard() {},
    },
  });
}
