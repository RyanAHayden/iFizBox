// F401: Add Tweaks opened from an app's page works on that app and its queue (the sideload build).
//
//   target   the app: { bundleId, name, id, key } (a catalog app's page) or { bundleId, name, file } (an IPA's in
//            My IPAs): browse.js addTweaksContext
//   queueHooks(target)            addTweakButton's `queue`: { add(stanza), remove(row) }, Confirm stays closed
//   await queueTweak(target, tweak)     the app's queued job takes the tweak { id, name }; not queued: a re-sign when
//                                 this phone signed it, else the install its page would queue
//                                 -> { job } | { running } (its job is in the run going on now) | {} (nothing to queue)
//   await unqueueTweak(target, row)     takes it out of the job; the job goes when it was there only for its tweaks
//   await addToThisApp(stanza, target)  the tweak page's Add to App: no picker, then Confirm
// SPDX-License-Identifier: GPL-3.0-or-later
import { appQueue } from "../app-queue.js";
import { resignJob } from "../core/appqueue.js";
import { debOf } from "../core/tweaks.js";
import { showAlert } from "../nav/alert.js";
import { addToApp, addDebTo, debName, savedTweaks, saveTweaks, signedRecordFor, tweakStore } from "./tweaks.js";
import { queueApp, openAppConfirm, appQueueRunning } from "./queue.js";
import { appPageJob, forgetHeld } from "./altstore.js";
import { displayName } from "../core/sources.js";

// The install the target's own page would queue, or null.
async function pageJob(target) {
  if (target.file) return (await import("./myipas.js")).libraryInstallJob(target.file);
  if (!target.id) return null;
  const [{ catalog }, { getBackend }] = await Promise.all([import("../catalog.js"), import("../backend.js")]);
  await catalog.ensure();
  const [pkg, sources] = await Promise.all([catalog.package(target.id, target.key), getBackend().sources()]);
  return appPageJob(pkg, sources.find((s) => s.key === pkg?.key) ?? null);
}

// One app's queue changes, one after another: several ADDs side by side make one job.
const last = new Map();
function inTurn(bundleId, f) {
  const p = (last.get(bundleId) ?? Promise.resolve()).then(f, f);
  last.set(bundleId, p);
  p.catch(() => {}).then(() => { if (last.get(bundleId) === p) last.delete(bundleId); });
  return p;
}

const recordFor = (target, records) => (forgetHeld(target.bundleId) ? null : signedRecordFor(target.bundleId, records));

const jobOf = (queue, target, rec) => queue.get(target.bundleId) ?? (rec ? queue.get(rec.bundleId) : null)
  ?? queue.list().find((j) => j.tweaksOf === target.bundleId || (target.file && j.library === target.file)) ?? null;

const tweakOf = (st) => ({ id: st.package, name: st.name || st.package });

// A re-sign reads the tweaks kept under the ID the app was signed from: an app whose page has another ID keeps it there too.
const otherId = (target, rec) => {
  const id = rec?.originalBundleId || rec?.bundleId;
  return id && id !== target.bundleId ? id : null;
};

export function queueTweak(target, tweak, { queue = appQueue, records, install = pageJob, add = queueApp, running = appQueueRunning,
  data = null, store = tweakStore } = {}) {
  return inTurn(target.bundleId, async () => {
    const rec = await recordFor(target, records);
    const other = otherId(target, rec);
    if (other && data) await addDebTo(other, data.st, data.deb, { store });
    const take = (job) => {
      // the run may have signed it already: the kept tweak goes in the next time
      if (running()) return { running: true };
      const has = (job.tweaks ?? []).filter((t) => t.id !== tweak.id);
      queue.setTweaks(job.id, { tweaks: [...has, tweak], tweaksOf: rec ? other ?? target.bundleId : target.bundleId });
      return { job };
    };
    const queued = jobOf(queue, target, rec);
    if (queued) return take(queued);
    const job = rec ? resignJob(rec) : await install(target);
    if (!job) return {};
    const now = jobOf(queue, target, rec) ?? queue.get(job.id); // queued elsewhere while its page's questions were up
    if (now) return take(now);
    return { job: add({ ...job, tweaks: [tweak], tweaksOf: rec ? other ?? target.bundleId : target.bundleId, forTweaks: true }, { queue, open: () => {} }) };
  });
}

export function unqueueTweak(target, row, { queue = appQueue, records, running = appQueueRunning, store = tweakStore } = {}) {
  return inTurn(target.bundleId, async () => {
    const rec = await recordFor(target, records);
    const gone = (x) => (row.file ? x.name === row.file : debOf(x.name)?.package === row.id);
    const other = otherId(target, rec);
    if (other) await saveTweaks(other, (await savedTweaks(other, { store })).filter((x) => !gone(x)), { store });
    const job = jobOf(queue, target, rec);
    if (!job || running()) return;
    const tweaks = (job.tweaks ?? []).filter((t) => t.id !== row.id);
    if (job.forTweaks && !tweaks.length) { queue.clear(job.id); return; }
    const of = other ?? target.bundleId;
    queue.setTweaks(job.id, { tweaks, tweaksOf: of, noTweaks: !(await savedTweaks(of, { store })).length });
  });
}

export function queueHooks(target, opts = {}) {
  return {
    add: async (st, deb = null) => queueTweak(target, tweakOf(st), { ...opts, ...(deb ? { data: { st, deb } } : {}) }),
    remove: (row) => unqueueTweak(target, row, opts),
  };
}

// The tweak page's Add to App, opened from this app's Add Tweaks. Already added: nothing is added again, and what is
// left to queue opens in Confirm; the tweak signed in already, or nothing to queue: Added.
export async function addToThisApp(st, target, { queue = appQueue, records, install = pageJob, add = queueApp, open = openAppConfirm,
  running = appQueueRunning, alert = showAlert, store = tweakStore, addTo = addToApp, ...rest } = {}) {
  const opts = { queue, records, install, add, running, store };
  const name = st.name || st.package;
  const file = debName(st);
  const says = (title, message) => alert({ title, message, buttons: ["OK"] });
  const put = async (deb = null) => {
    const r = await queueTweak(target, tweakOf(st), { ...opts, ...(deb ? { data: { st, deb } } : {}) }).catch(() => ({}));
    if (r.job && !running()) open(queue);
    return r;
  };
  const kept = (await savedTweaks(target.bundleId, { store })).find((x) => x.name === file);
  if (kept) {
    const rec = await recordFor(target, records);
    const signedIn = Boolean(rec?.tweaks?.includes(file));
    if (signedIn) {
      if (!running() && jobOf(queue, target, rec)) open(queue);
      else await says("Added", `${name} is in ${target.name}.`);
      return true;
    }
    const r = await put(kept.data);
    if (!r.job) await says("Added", `${name} goes in when ${target.name} is installed or re-signed.`);
    return true;
  }
  return addTo(st, { ...rest, alert, store, ...(records ? { records } : {}), app: { bundleId: target.bundleId, name: target.name },
    put: async (app, s, deb) => Boolean((await put(deb)).job) });
}
