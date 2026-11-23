// N9: a .deb shared with iFizBox (jailbreak build): the Confirm sheet for that one file, then the console. The shell
// staged the file where ifizbox-helper takes it (native/share/App/ShareBridge.swift); share.debSimulate is
// `apt-get -s install ./file.deb` (ifizbox-helper simulate-deb), so the sheet lists every package apt would change,
// its dependencies resolved from the sources, like the install queue's (screens/queue.js); Confirm runs
// share.debInstall (install-deb) in the same console (runPaidInstall's: outside the queue, kept in Console Logs).
// Cancel removes the staged file. When apt says no, F18's sentences come first, then apt's own words.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, el, barButton } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { modal, refusedBlock, runPaidInstall } from "./queue.js";
import { catalog } from "../catalog.js";
import { MODES, MODE_LABEL, parseSimulation, changeCount } from "../core/queue.js";
import { debRefusal } from "../core/queuerefusal.js";
import { NAME } from "../brand.js";
import { nativeBridge } from "../native.js";

const call = (native, method, params, onEvent) => native.call(`share.${method}`, params, onEvent);

// { file: the staged name, name: what the user knows it as }. Resolves once the sheet (and any console) is done.
export async function openDebConfirm({ file, name = "" }, { native = nativeBridge() } = {}) {
  const cancel = barButton("Cancel");
  const ok = barButton("Confirm", "done");
  ok.hidden = true;
  const m = modal({ title: "Confirm", left: cancel, right: ok, cls: "confirm-sheet" });
  const loading = el("div", "loading");
  loading.append(el("span", "loading-spinner"), el("span", null, "Checking with apt"));
  m.scroll.append(loading);
  let decided;
  const choice = new Promise((r) => { decided = r; });
  cancel.addEventListener("click", () => decided(false));
  ok.addEventListener("click", () => decided(true));

  let r = null, err = null;
  try { r = await call(native, "debSimulate", { file }); } catch (e) { err = e; }
  m.scroll.replaceChildren();
  const plan = r ? parseSimulation(r.stdout) : null;
  if (err) {
    m.setTitle("Cannot Comply");
    m.scroll.append(refusedBlock(debRefusal(err.message || String(err), name), "Nothing was changed."));
  } else if (!r.ok || plan.essential.length) {
    m.setTitle("Cannot Comply");
    let problems = [];
    if (!r.ok) { try { problems = (await catalog.aptProblems(r.output)) ?? []; } catch { problems = []; } }
    const lines = [
      ...plan.essential.map((id) => `Installing ${name} would remove ${id}, part of the jailbreak itself (an essential package), so ${NAME} won't do it.`),
      ...problems.map((p) => p.sentence),
    ];
    if (!lines.length) lines.push(`apt refused ${name || "this package"}${r.code ? ` (exit ${r.code})` : ""}. Its own words are below.`);
    m.scroll.append(grouped([{ header: "Can't Do This Yet", rows: lines.map((label) => ({ label })) }]));
    const g = el("div", "group");
    g.append(el("h2", "group-header", "apt's Output"), el("pre", "table grouped confirm-raw", String(r.output ?? "").trim() || "(no output)"));
    m.scroll.append(g);
  } else {
    if (plan.download) m.scroll.append(grouped([{ header: "Statistics", rows: [{ label: "Downloading", detail: plan.download }] }]));
    const rows = MODES.filter((mode) => plan[`${mode}s`].length)
      .map((mode) => ({ label: MODE_LABEL[mode], detail: plan[`${mode}s`].map((e) => e.id).join("\n") }));
    const mods = grouped([{ header: "Modifications", rows: rows.length ? rows : [{ label: "Nothing to change" }],
      footer: `From ${name || "the shared file"}; anything else it needs comes from your sources.` }]);
    mods.querySelectorAll(".cell").forEach((c) => c.classList.add("confirm-mods"));
    m.scroll.append(mods);
    ok.hidden = !changeCount(plan);
  }

  const go = await choice;
  await m.close();
  if (!go) {
    try { await call(native, "discard", { file, kind: "deb" }); } catch { /* swept after a day */ }
    return { ok: false };
  }
  const run = (onEvent) => call(native, "debInstall", { file, stream: true }, onEvent);
  const pkg = r?.package ?? null;
  // The console's title: "Install <package> <version>" from apt's plan, else the file's name.
  const done = runPaidInstall({ id: pkg || name || file, version: (pkg && r?.version) || "", name: pkg || name || file, run });
  if (!done) {
    await showAlert({ title: "Busy", message: `Another install is running. Share the file with ${NAME} again when it's done.`, buttons: ["OK"] });
    try { await call(native, "discard", { file, kind: "deb" }); } catch { /* swept after a day */ }
    return { ok: false };
  }
  return done;
}
