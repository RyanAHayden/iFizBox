// The Cellular Installs Shortcut, in the sideload app (native/sideload/vpn/App/CellularShortcutBridge.swift).

// {available, bundled, added}
export const shortcutStatus = (native) => native.call("cellular.status");
// The share sheet, where Shortcuts opens Add Shortcut: {opened}. Only a check says it was added.
export const addShortcut = (native) => native.call("cellular.add");
// {ok, error, text, status}; touches no cellular data.
export const checkShortcut = (native) => native.call("cellular.check");
// While installs wait on cellular; answers once the Shortcut ended: {ok, error, text, putBack}. A page runs it through
// signing/cellularrun.js, which says what a failed run put back.
export const runShortcut = (native) => native.call("cellular.run");
// What the app put back at launch, after it was closed during a run; told once.
export const putBackAtLaunch = (native) => native.call("cellular.putBack").then((r) => r?.putBack ?? null);

// What the app says after a put-back ("on" or "failed"); null: there was nothing to put back.
export function putBackAlert(putBack, name) {
  if (putBack === "on") return { title: "Cellular Data Is Back On", message: `The Cellular Installs shortcut didn't finish, so ${name} turned cellular data back on.` };
  if (putBack === "failed") return { title: "Check Cellular Data", message: `The Cellular Installs shortcut didn't finish and ${name} couldn't turn cellular data back on. Turn it on in Settings > Cellular.` };
  return null;
}
