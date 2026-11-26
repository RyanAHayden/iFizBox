// What the recording shows of the person holding the phone (capture.mjs puts this in the page): the finger as a soft
// circle, and a plain keyboard drawn here while a field is being typed in (Chromium has none). Nothing here is the
// app's: it sits on top, takes no touches, and runs on clock.js's time like the page.
(() => {
  const CSS = `
    #rec-top { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; overflow: hidden; }
    #rec-dot { position: absolute; left: -26px; top: -26px; width: 52px; height: 52px; border-radius: 50%; opacity: 0;
      background: radial-gradient(circle, rgba(120,126,138,.62) 0 52%, rgba(120,126,138,.40) 72%, rgba(120,126,138,0) 100%);
      box-shadow: 0 0 0 1.5px rgba(255,255,255,.55) inset, 0 2px 10px rgba(0,0,0,.18); }
    #rec-kb { position: absolute; left: 0; right: 0; bottom: 0; height: 300px; transform: translateY(100%);
      background: #c9ccd3; box-shadow: 0 -1px 0 rgba(0,0,0,.18); font: 400 22px "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; }
    #rec-kb.dark { background: #2b2b2d; color: #fff; }
    #rec-kb i { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-style: normal;
      border-radius: 6px; background: #fdfdfe; height: 44px; }
    #rec-kb i.f { background: #b0b4bd; font-size: 15px; }
    #rec-kb i.num { height: 48px; font-size: 26px; }
    #rec-kb i.go { background: #3b79d8; color: #fff; font-size: 15px; }
    #rec-kb.dark i { background: #66666a; } #rec-kb.dark i.f { background: #444447; }
    /* the iOS 26 style leaves the switch to WebKit, and Chromium has none: a plain one stands in for the phone's */
    html[data-style="ios26"] input[type="checkbox"][switch] { appearance: none !important; width: 64px !important; height: 28px !important; margin: 0 !important; border: 0 !important;
      border-radius: 14px !important; background: #e2e2e7 !important; position: relative; }
    html[data-style="ios26"] input[type="checkbox"][switch]:checked { background: #34c759 !important; }
    html[data-style="ios26"] input[type="checkbox"][switch]::before { content: "" !important; position: absolute; left: 2px; top: 2px; width: 39px !important; height: 24px !important;
      margin: 0 !important; border-radius: 12px !important; background: #fff !important; box-shadow: 0 1px 4px rgba(0,0,0,.18) !important; transform: none !important; }
    html[data-style="ios26"] input[type="checkbox"][switch]:checked::before { left: 23px; }
    #rec-kb i.on { background: #9ea3ad; }`;
  const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  let top, dot, kb, keys = {};
  function build() {
    if (top?.isConnected) return;
    const st = document.createElement("style"); st.textContent = CSS; document.documentElement.append(st);
    top = document.createElement("div"); top.id = "rec-top"; top.dataset.noslide = "";
    top.innerHTML = '<div id="rec-kb"></div><div id="rec-dot"></div>';
    document.documentElement.append(top);
    dot = top.querySelector("#rec-dot"); kb = top.querySelector("#rec-kb");
    const W = innerWidth, gap = 6, kw = (W - 6 - 9 * gap) / 10;
    const put = (k, label, x, y, w, cls = "") => {
      const i = document.createElement("i"); i.textContent = label; i.className = cls;
      i.style.cssText = `left:${x}px;top:${y}px;width:${w}px`; kb.append(i); keys[k] = { el: i, x: x + w / 2, y: y + 22 };
    };
    ROWS.forEach((row, r) => {
      const x0 = (W - row.length * kw - (row.length - 1) * gap) / 2;
      [...row].forEach((c, n) => put(c, c, x0 + n * (kw + gap), 12 + r * 54, kw));
    });
    put("shift", "", 3, 12 + 108, 42, "f"); put("delete", "", W - 45, 12 + 108, 42, "f");
    put("123", "123", 3, 12 + 162, 48, "f"); put("/", "/", 57, 12 + 162, 40); put(".", ".", W - 148, 12 + 162, 40);
    put(" ", "space", 103, 12 + 162, W - 103 - 154); put("return", "return", W - 102, 12 + 162, 99, "go");
    // an email field's "/" is "@" (the phone's email keyboard), and a code field's keyboard is the number pad
    keys["@"] = keys["/"];
    const pw = (W - 2 * 6 - 2 * 14) / 3;
    ["123", "456", "789", " 0 "].forEach((row, r) => [...row].forEach((c, n) => { if (c !== " ") put(c, c, 14 + n * (pw + 6), 12 + r * 54, pw, "num"); }));
    const letterDelete = keys.delete;
    put("delete", "", 14 + 2 * (pw + 6), 12 + 162, pw, "num f"); // the pad's own delete, in place of the letters'
    keys.padDelete = keys.delete; keys.delete = letterDelete;
  }
  const letters = () => kb.querySelectorAll("i:not(.num)");
  let dotAt = { x: 0, y: 0 };
  const place = (scale, o) => { dot.style.transform = `translate(${dotAt.x}px,${dotAt.y}px) scale(${scale})`; dot.style.opacity = o; };
  document.addEventListener("DOMContentLoaded", build);
  window.__finger = {
    // k: 0 (off the glass) .. 1 (pressed)
    at(x, y, k) { build(); dotAt = { x, y }; place(1.35 - 0.35 * k, k * 0.95); },
    // k: 0 hidden .. 1 up
    // kind: "" (letters), "email" (the "/" key says "@") or "tel" (the number pad)
    keyboard(k, dark = false, go = "return", kind = "") {
      build(); kb.className = dark ? "dark" : "";
      keys.return.el.textContent = go; kb.style.transform = `translateY(${(1 - k) * 100}%)`;
      for (const e of letters()) e.style.display = kind === "tel" ? "none" : "";
      for (const e of kb.querySelectorAll("i.num")) e.style.display = kind === "tel" ? "" : "none";
      keys["/"].el.textContent = kind === "email" ? "@" : "/";
    },
    key(c) { build(); const k = keys[c]; return k ? { x: k.x, y: innerHeight - 300 + k.y } : null; },
    press(c, on) { keys[c]?.el.classList.toggle("on", on); },
  };
})();
