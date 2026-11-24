// On Cellular (F417, concept K9): what a This iPhone install does while the phone is on cellular data, where iOS refuses
// the connects it needs: "ask" (the popup, signing/cellular.js; the default) or "server" (the Signing Server, no popup).
// Pure: the choice, the page's group and the popup's texts. The choice is kept in this browser's storage.
export const CELLULAR_KEY = "ifizbox.onCellular";
export const ON_CELLULAR = "On Cellular";
export const CELLULAR_OPTIONS = [
  { value: "ask", label: "Ask Each Time", subtitle: "Airplane Mode or server.", icon: "help",
    footer: "iOS can't install straight onto this iPhone while it's on cellular data." },
  { value: "server", label: "Use Signing Server", subtitle: "Data stays on. iOS asks you to install.", icon: "websiteApps",
    footer: "On Wi-Fi, apps still go straight onto this iPhone." },
];
const known = (v) => CELLULAR_OPTIONS.find((o) => o.value === v) ?? CELLULAR_OPTIONS[0];
export function onCellularChoice(storage = globalThis.localStorage) {
  try { return known(storage?.getItem(CELLULAR_KEY)).value; } catch { return "ask"; }
}
export function setOnCellular(v, storage = globalThis.localStorage) {
  try { storage?.setItem(CELLULAR_KEY, known(v).value); } catch { /* storage off */ }
}
export const cellularFooter = (v) => known(v).footer;

// The popup: it closes by itself once the phone is off cellular; otherwise its button decides.
export const CELLULAR_ANSWERS = ["server", "cancel"]; // its buttons
export const cellularQuestion = () => ({ title: "You're on Cellular",
  message: "Turn on Airplane Mode or join Wi-Fi and the install goes on by itself. Or choose:",
  buttons: ["Use Signing Server", "Cancel"], cancel: 1 });
export const CELLULAR_CANCELLED = "not installed, still on cellular";
