// UIAlertView as iOS 6 draws it ("Alert diaglog" in the kit; styles in sources.css): a translucent navy box with
// a gloss, bold title, message, an optional text field and one or two buttons side by side (three or more
// stack). Pops in with the iOS bounce, by transform/opacity only.
//
//   const { index, value } = await showAlert({ title, message, input: { placeholder, value, type, paste? },
//                                              buttons: ["Cancel", "Add Source"], cancel: 0 });
//
// Resolves with the tapped button's index and the field's text. Return in the field taps the last button,
// Escape taps `cancel`. All text goes in through textContent. `stacked` stacks two buttons whose titles don't fit
// side by side, as UIAlertView does (F63's Keep My Old Copy / Accept the New Copy).
// F96: `countdown: { button, seconds }` greys that button out for `seconds`, its title counting down ("I Understand
// (5)"), before it can be tapped.
// `colors`: { [button index]: "green" | "red" } (sources.css .alert-button.green/.red): the way to go, and the one to avoid.
// `onTap(index)` runs inside the tap's own click (before the promise resolves), for what Safari only allows from a
// user gesture, such as opening an itms-services link.
// A one-button (OK) alert: title, message. `alert` swaps in another showAlert (tests pass a fake).
//
// F345b: in the app under the native controls hook (<html data-controls="native">, native-controls.js) the alert is
// the shell's own UIAlertController (bridge call ui.alert, native/Sources/NativeAlerts.swift): same options, same
// {index, value} answer. A countdown alert stays the CSS one (UIAlertAction titles can't count down), so does one
// with `onTap` (the bridge's answer comes after the tap, outside the user gesture its window.open or link needs), `input.paste`
// is dropped (the native field has Paste in its own menu), and a shell without ui.alert, the site and every other
// style get the CSS alert.
import { nativeBridge, hasNativeCall } from "../native.js";

export const alertOK = (title, message, alert = showAlert) => alert({ title, message, buttons: ["OK"] });

export function showAlert(opts = {}) {
  const native = nativeBridge();
  if (!wantsNativeAlert(opts, native)) return cssAlert(opts);
  const { title = "", message = "", input = null, buttons = ["OK"], cancel = 0, colors = {} } = opts;
  const params = { title: String(title ?? ""), message: String(message ?? ""), buttons: buttons.map((b) => String(b)),
    cancel: buttons.length > 1 && Number.isInteger(cancel) ? cancel : -1, colors: nativeColors(colors, buttons.length) };
  if (input) params.input = { placeholder: String(input.placeholder ?? ""), value: String(input.value ?? ""), type: String(input.type || "text") };
  return native.call("ui.alert", params).then((r) => {
    const index = Number.isInteger(r?.index) && r.index >= 0 && r.index < buttons.length ? r.index : (params.cancel >= 0 ? params.cancel : 0);
    const value = input ? String(r?.value ?? "") : undefined;
    return { index, value };
  }, () => cssAlert(opts)); // an older shell ("unknown method ui.alert") or no window to show it in
}

// The native alert only in the app (the bridge takes calls), under the native controls hook, and never for a countdown
// or an `onTap` (it must run inside the tap itself).
export function wantsNativeAlert({ countdown = null, onTap = null } = {}, native = nativeBridge(), doc = globalThis.document) {
  return hasNativeCall(native) && !countdown && !onTap && doc?.documentElement?.getAttribute?.("data-controls") === "native";
}

// {index: "red" | "green"} as the shell takes it: string keys, known colours, indexes inside the buttons.
function nativeColors(colors, count) {
  const out = {};
  for (const [k, v] of Object.entries(colors || {})) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < count && (v === "red" || v === "green")) out[String(i)] = v;
  }
  return out;
}

// The CSS alert: iOS 6's UIAlertView, restyled by each era's stylesheet.
function cssAlert({ title = "", message = "", input = null, buttons = ["OK"], cancel = 0, stacked = false, countdown = null, colors = {}, onTap = null } = {}) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "alert-scrim";
    const box = document.createElement("div");
    box.className = "alert";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    const h = Object.assign(document.createElement("h2"), { className: "alert-title", textContent: title });
    box.append(h);
    if (message) box.append(Object.assign(document.createElement("p"), { className: "alert-message", textContent: message }));
    let field = null;
    if (input) {
      field = document.createElement("input");
      field.className = "alert-field";
      field.type = input.type || "text";
      field.placeholder = input.placeholder || "";
      field.value = input.value || "";
      field.autocapitalize = "off";
      field.autocomplete = "off";
      field.spellcheck = false;
      field.setAttribute("autocorrect", "off");
      field.setAttribute("aria-label", title);
      if (input.paste) {
        // A Paste button inside the field's row: iOS asks with its own Paste bubble when it's tapped, and
        // input.paste(text) turns what was copied into the field's value ("" leaves the field as it is).
        const row = document.createElement("div");
        row.className = "alert-field-row";
        const paste = Object.assign(document.createElement("button"), { type: "button", className: "alert-paste", textContent: "Paste" });
        paste.addEventListener("click", async () => {
          // F146: the app reads UIPasteboard through the bridge (no WebKit Paste bubble); the website asks Safari.
          // (menu.js nativePaste, inline so alert.js imports only native.js.)
          const native = nativeBridge();
          let text = null;
          if (native?.call) try { text = String((await native.call("clipboard.read", {})) ?? ""); } catch { /* old shell */ }
          if (text == null) try { text = await navigator.clipboard.readText(); } catch { return; }
          // B168: `paste: true` (Sign In With Key) pastes the text as it is, trimmed; it used to throw here.
          const v = typeof input.paste === "function" ? input.paste(text) : String(text ?? "").trim();
          if (v) { field.value = v; field.focus({ preventScroll: true }); }
        });
        row.append(field, paste);
        box.append(row);
      } else box.append(field);
    }
    const row = document.createElement("div");
    row.className = "alert-buttons" + (buttons.length > 2 || stacked ? " stacked" : "");
    buttons.forEach((label, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "alert-button" + (i === cancel && buttons.length > 1 ? " cancel" : "") + (colors[i] ? ` ${colors[i]}` : "");
      b.textContent = label;
      b.addEventListener("click", () => close(i));
      row.append(b);
    });
    box.append(row);
    let tick = null;
    if (countdown && row.children[countdown.button]) {
      const b = row.children[countdown.button];
      let left = Math.max(0, Math.ceil(countdown.seconds ?? 5));
      const draw = () => {
        b.disabled = left > 0;
        b.textContent = left > 0 ? `${buttons[countdown.button]} (${left})` : buttons[countdown.button];
      };
      draw();
      if (left > 0) tick = setInterval(() => { left -= 1; draw(); if (left <= 0) { clearInterval(tick); tick = null; } }, 1000);
    }
    scrim.append(box);
    document.body.append(scrim);
    // Two buttons whose titles don't fit side by side stack, as UIAlertView does with long titles (user 2026-11-18:
    // "Complete Up…").
    if (!row.classList.contains("stacked") && [...row.children].some((b) => b.scrollWidth > b.clientWidth + 1)) {
      row.classList.add("stacked");
    }

    // Locked in place, as on iOS 6. Nothing behind it scrolls, and a tap outside the box does nothing (it would
    // otherwise drop the keyboard and scroll the page). The backdrop reaches well past the screen's edges, so
    // nothing white shows when iOS pans the page for the keyboard. Only the box moves, by `translate` (the pop-in owns
    // `transform`), to stay centred in the part of the screen still showing.
    const noScroll = (e) => { if (e.cancelable) e.preventDefault(); };
    scrim.addEventListener("touchmove", noScroll, { passive: false });
    scrim.addEventListener("wheel", noScroll, { passive: false });
    const outside = (e) => { if (e.target === scrim && e.cancelable) e.preventDefault(); };
    scrim.addEventListener("touchstart", outside, { passive: false });
    scrim.addEventListener("mousedown", outside);
    // iOS pans the whole page up to show a focused field, which shoved the bars and the list around behind the
    // alert: undo the pan at once (scroll back to 0) and move only the box into the space above the keyboard.
    const vv = globalThis.visualViewport;
    const fit = () => {
      if (scrollY || document.documentElement.scrollTop) scrollTo(0, 0);
      box.style.translate = `0 ${Math.round(vv.offsetTop + vv.height / 2 - innerHeight / 2)}px`;
    };
    if (vv) { fit(); vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); }
    if (field) field.addEventListener("focus", () => { requestAnimationFrame(fit); setTimeout(fit, 300); });

    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(cancel); }
      if (e.key === "Enter" && field && document.activeElement === field) { e.preventDefault(); close(buttons.length - 1); }
    };
    document.addEventListener("keydown", onKey);
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
    box.animate([
      { transform: "scale(1.15)", opacity: 0 },
      { transform: "scale(.95)", opacity: 1, offset: 0.55 },
      { transform: "scale(1.02)", offset: 0.8 },
      { transform: "scale(1)" },
    ], { duration: 360, easing: "ease-out" });
    (field || [...row.children].reverse().find((b) => !b.disabled) || row.lastChild).focus({ preventScroll: true });

    let done = false;
    function close(index) {
      if (done) return;
      done = true;
      if (tick) clearInterval(tick);
      document.removeEventListener("keydown", onKey);
      if (vv) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); }
      const value = field ? field.value : undefined;
      field?.blur();
      const a = scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-in", fill: "forwards" });
      a.finished.then(() => scrim.remove(), () => scrim.remove());
      onTap?.(index);
      resolve({ index, value });
    }
  });
}
