// The iOS 6 switch (ios6.css .switch), for settings rows (screens/settings.js makeSwitch) and anything else (F24's
// Section Visibility): `checked` is where it starts, `onToggle(on)` hears every change.
// F345a: under the native controls hook (<html data-controls="native">, native-controls.js) it is WebKit's own
// switch instead, an <input type=checkbox switch> (nativeSwitch below). Either kind is a `.switch` whose state is its
// aria-checked: callers read it, and set it to put the switch back without hearing onToggle.
const made = new WeakMap(); // switch -> how it was made, so redrawSwitches can draw it again in the other kind

const nativeHook = () => globalThis.document?.documentElement?.getAttribute?.("data-controls") === "native";

export function createSwitch({ label, checked = false, onToggle = () => {} }) {
  const sw = nativeHook() ? nativeSwitch({ label, checked, onToggle }) : artSwitch({ label, checked, onToggle });
  made.set(sw, { label, onToggle });
  return sw;
}

// WebKit's switch (iOS 26's shape on WebKit 26+; ios26.css sizes it through --sw-w / --sw-h and leaves its paint to
// WebKit). Its drag and tap are WebKit's; `change` tells onToggle. aria-checked mirrors `checked` both ways.
function nativeSwitch({ label, checked, onToggle }) {
  const i = document.createElement("input");
  i.type = "checkbox";
  i.setAttribute("switch", "");
  i.className = "switch is-native";
  i.setAttribute("aria-label", label);
  const set = i.setAttribute.bind(i);
  i.setAttribute = (k, v) => { set(k, v); if (k === "aria-checked") i.checked = String(v) === "true"; };
  i.setAttribute("aria-checked", String(Boolean(checked)));
  i.addEventListener("change", () => { set("aria-checked", String(i.checked)); onToggle(i.checked); });
  return i;
}

// Draws every switch createSwitch made under `doc` again in the kind the hook now asks for (native-controls.js, when
// Theme > Style or the app's answer turns the hook on or off after a page was drawn). State, data-* and the
// listener carry over; a caller still holding the old node sets a detached one, so the next redraw of its page fixes it.
export function redrawSwitches(doc = globalThis.document) {
  const native = nativeHook();
  for (const old of doc?.querySelectorAll?.(".switch") ?? []) {
    const how = made.get(old);
    if (!how || old.classList.contains("is-native") === native) continue;
    const next = createSwitch({ ...how, checked: old.getAttribute("aria-checked") === "true" });
    Object.assign(next.dataset, old.dataset);
    old.replaceWith(next);
  }
}

function artSwitch({ label, checked, onToggle }) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "switch";
  b.setAttribute("role", "switch");
  b.setAttribute("aria-label", label);
  b.innerHTML = '<span class="sw-track"></span><span class="sw-knob"></span>';
  // px the knob moves: style.css's --sw-travel hook (iOS 6: 50, the kit's 77px track less its 27px knob; an era sets
  // its own), read when a drag starts so a style change applies to switches already drawn
  let TRAVEL = 50;
  const travel = () => parseFloat(globalThis.getComputedStyle?.(b).getPropertyValue("--sw-travel")) || 50;
  const isOn = () => b.getAttribute("aria-checked") === "true";
  const set = (on) => {
    b.style.removeProperty("--x");
    const was = isOn();
    b.setAttribute("aria-checked", String(on));
    if (was !== on) onToggle(on);
  };
  b.setAttribute("aria-checked", String(Boolean(checked)));
  // Hold, drag and tap like iOS: the knob darkens while held and follows the finger; letting go settles it on the
  // side it's nearer, or flips it if it hardly moved. Keyboard and VoiceOver activation come through click.
  let drag = null;
  b.addEventListener("pointerdown", (e) => {
    const on = isOn();
    TRAVEL = travel();
    drag = { id: e.pointerId, x0: e.clientX, start: on ? TRAVEL : 0, x: on ? TRAVEL : 0, moved: false };
    b.setPointerCapture?.(e.pointerId);
    b.classList.add("is-held");
  });
  b.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < 4) return;
    drag.moved = true;
    drag.x = Math.max(0, Math.min(TRAVEL, drag.start + dx));
    b.classList.add("is-dragging");
    b.style.setProperty("--x", drag.x + "px");
  });
  const end = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, x, start } = drag;
    drag = null;
    b.classList.remove("is-held", "is-dragging");
    if (cancelled) { set(isOn()); return; }
    set(moved ? x > TRAVEL / 2 : start === 0);
    b.dataset.handled = "1"; // the click that follows this pointerup is already done
  };
  b.addEventListener("pointerup", (e) => end(e, false));
  b.addEventListener("pointercancel", (e) => end(e, true));
  b.addEventListener("click", () => {
    if (b.dataset.handled) { delete b.dataset.handled; return; }
    set(!isOn());
  });
  return b;
}
