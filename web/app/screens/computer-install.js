// F436: the free Apple ID route's one-time computer install, on its Ready page (screens/free-apple-id.js). iOS refuses
// free-profile apps from a website (error 111), so the app is signed here with the free identity, its certificate inside
// (ifizbox-identity.plist, as Install iFizBox App brings it), uploaded like any website-signed app, and a short code
// (worker/src/setup.js) tells the setup command on a computer (tools/setup) what to install. The signed IPA can be
// saved too, for other tools. docs/sideload.md "one-time computer setup".
//
//   await signForComputer(id, deps)      { data, bundleId, name, version }: the newest release's IPA, signed
//   await makeCode(signed, deps)         { code, until }: uploads it and asks for the code
//   computerSections(state, now)         pure: what the block shows: { stage: "off" | "start" | "code" | "expired", footer }
//   setupCommands()                      pure: [{ header, prompt, cmd, footer }], one per kind of computer
//   computerInstallBlock({ id, record, expired, fix, ask, save })   the block; fix: { label, onClick } renews the profile;
//                                        record: the Free Apple ID record the app takes on launch (B474, web/free-id.json)
//   resetComputerInstall()               forget the signed IPA and code (another profile, or the identity forgotten)
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, el } from "../nav/ui.js";
import { NAME, DOMAIN, BUNDLE_ID } from "../brand.js";
import { APP_IPA_URL } from "../core/appoffer.js";
import { terminal } from "./guides.js";
import { joinPieces } from "../core/pieces.js";
import { sha256Hex } from "../core/sha256.js";

export const COMPUTER_LABEL = "Download for a Computer Install";
export const COMPUTER_FOOTER = `Signs ${NAME} here and shows a code. A computer with the iPhone plugged in installs it, once.`;
export const COMPUTER_OFF_FOOTER = "A computer install needs a current 7-day profile. Get a new one first.";
export const CODE_EXPIRED_FOOTER = "The code has expired. Make a new one for the computer.";
export const CODE_MISSING_FOOTER = `${NAME} is signed, but there's no code yet. Make one for the computer.`;
export const codeFooter = (until) =>
  `The computer asks for it. It works until ${new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
export const SAVE_IPA_FOOTER = "For another tool that installs IPAs. It holds your certificate, so don't share it.";

export const setupCommands = () => [
  { header: "Mac or Linux", prompt: "$ ", cmd: `curl -fsSL https://${DOMAIN}/sign/setup.sh | sh`,
    footer: "Plug in the iPhone and run this in Terminal." },
  { header: "Windows", prompt: "PS> ", cmd: `iwr -useb https://${DOMAIN}/sign/setup.ps1 | iex`,
    footer: "Plug in the iPhone and run this in PowerShell." },
];

const state = { signed: null, code: null, until: 0 };
let busy = false, redraw = () => {}; // redraw: the block on the page now
export function resetComputerInstall() { Object.assign(state, { signed: null, code: null, until: 0 }); }

export function computerSections({ expired = false, signed = null, code = null, until = 0 } = {}, now = Date.now()) {
  if (expired) return { stage: "off", footer: COMPUTER_OFF_FOOTER };
  if (!signed) return { stage: "start", footer: COMPUTER_FOOTER };
  if (code && now < until) return { stage: "code", footer: codeFooter(until) };
  return { stage: "expired", footer: code ? CODE_EXPIRED_FOOTER : CODE_MISSING_FOOTER };
}

// The app's own bundle ID becomes the profile's (<id>.<TEAMID>, Keep Bundle IDs off): a free team can't use the app's.
export async function signForComputer(id, deps = {}) {
  const [b, c, p] = deps.download ? [] : await Promise.all([import("../signing/browser.js"), import("../signing/common.js"),
    import("../signing/prompt.js")]);
  const { download = b.downloadIpa, worker = c.runInWorker, transfer = p.websiteTransfer, set = () => {}, signal = null, record = null } = deps;
  const own = (x) => new Uint8Array(x).slice().buffer;
  const sig = signal ? { signal } : {};
  const ipa = await download(APP_IPA_URL, { onProgress: (n) => set(`Downloading ${n}%`), ...sig });
  set("Signing");
  const r = await worker({ ipa: own(ipa), p12: own(id.p12), profile: own(id.profile), password: id.password ?? "",
    bring: { identity: true, transfer: await transfer().catch(() => null), ...(record ? { freeId: JSON.stringify(record) } : {}) }, appBundleId: BUNDLE_ID, keepBundleId: false, free: true },
  { onProgress: set, ...sig });
  return { data: joinPieces(r.ipa), bundleId: r.bundleId, name: r.name, version: r.version };
}

async function hashOf(data) {
  const subtle = globalThis.crypto?.subtle; // not there outside a secure context
  if (!subtle) return sha256Hex(data);
  return Array.from(new Uint8Array(await subtle.digest("SHA-256", data)), (x) => x.toString(16).padStart(2, "0")).join("");
}

// The code lives as long as its upload, so a new code is a new upload of the same signed IPA. The pairing file goes to
// the Worker's default place, in the app's own container.
export async function makeCode(signed, deps = {}) {
  const upload = deps.upload ?? (await import("../signing/browser.js")).uploadSigned;
  const { fetcher = globalThis.fetch, set = () => {}, signal = null, now = Date.now } = deps;
  const sig = signal ? { signal } : {};
  set("Uploading");
  const up = await upload(signed.data, signed, { onProgress: (n) => set(`Uploading ${n}%`), ...sig });
  const token = /\/sign\/up\/([0-9a-f]{48})\//.exec(up.manifest)?.[1];
  if (!token) throw new Error("The server didn't say where the signed app is.");
  set("Making a code");
  const q = new URLSearchParams({ token, sha256: await hashOf(signed.data) });
  let res;
  try { res = await fetcher(`/sign/setup?${q}`, { method: "POST", cache: "no-store", ...sig }); } catch {
    throw new Error("The code couldn't be made: no connection to the server.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.code) throw new Error(body?.error ?? `The server answered HTTP ${res.status}.`);
  return { code: body.code, until: now() + Number(body.expiresIn) * 1000 };
}

// One run on the progress page: sign (unless it's signed already), then upload and ask for a code. A code that failed
// leaves the signed IPA, which can still be saved.
async function run(id, ask, record = null) {
  if (busy) return;
  busy = true;
  const { progressHUD } = await import("../nav/progress.js");
  const { failed, untilCancel } = await import("../signing/common.js");
  const h = progressHUD(state.signed ? "Uploading" : "Downloading");
  const deps = { set: (t) => h.set(t), signal: h.signal, record };
  try {
    if (!state.signed) state.signed = await untilCancel(h, signForComputer(id, deps));
    Object.assign(state, { code: null, until: 0 });
    Object.assign(state, await untilCancel(h, makeCode(state.signed, deps)));
    h.finish({ label: "Show Code", status: "Ready" });
  } catch (e) {
    if (!h.cancelled) {
      const message = String(e?.message ?? e);
      failed(h, message);
      await ask({ title: "Computer Install Failed", message, buttons: ["OK"] });
    }
  } finally {
    busy = false;
    redraw();
  }
}

export function computerInstallBlock({ id, record = null, expired = false, fix, ask, save }) {
  const box = el("div", "free-computer");
  let timer = 0;
  const draw = () => {
    clearTimeout(timer);
    const s = computerSections({ ...state, expired });
    const start = (label) => ({ label, cls: "free-primary", onClick: () => run(id, ask, record) });
    const parts = [];
    if (s.stage === "off") parts.push(grouped([{ header: "Computer Install", rows: [{ ...fix, cls: "free-button" }], footer: s.footer }]));
    else if (s.stage === "start") parts.push(grouped([{ header: "Computer Install", rows: [start(COMPUTER_LABEL)], footer: s.footer }]));
    else {
      const row = s.stage === "code" ? { label: "Code", detail: state.code, cls: "free-setup-code" } : start("Make a New Code");
      parts.push(grouped([{ header: "Computer Install", rows: [row], footer: s.footer }]));
      if (s.stage === "code") {
        for (const c of setupCommands()) {
          const g = el("div", "group");
          g.append(el("h2", "group-header", c.header), terminal([{ cmd: c.cmd, prompt: c.prompt }], c.cmd), el("p", "group-footer", c.footer));
          parts.push(g);
        }
        timer = setTimeout(draw, Math.max(0, state.until - Date.now()) + 50);
        timer.unref?.();
      }
      const { data, version } = state.signed;
      parts.push(grouped([{ rows: [{ label: "Save the IPA", cls: "free-button",
        onClick: () => save(data, `${NAME}${version ? `-${version}` : ""}.ipa`, "application/octet-stream") }], footer: SAVE_IPA_FOOTER }]));
    }
    box.replaceChildren(...parts);
  };
  redraw = draw;
  draw();
  return box;
}
