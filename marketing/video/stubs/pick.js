// The recordings' stand-in for the iOS Files picker, which the page cannot open: __pick.show() slides up the app's own picture of it
// (the walkthrough's icons/steps/select-files-light.jpg) over the page, __pick.files() puts a made-up certificate (the test
// fixture's .p12, a profile made at the page's "now" and a password file) into the Certificate group's file input, as Open does,
// and __pick.hide() slides the picture away. None of them waits for the page's clock, so the script's pauses give the time.
(() => {
  let sheet = null, dim = null;
  const slide = (el, from, to, ms) => el.animate([from, to], { duration: ms, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
  window.__pick = {
    show() {
      dim = Object.assign(document.createElement("div"), {});
      dim.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99998";
      sheet = document.createElement("div");
      sheet.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#f2f2f7;border-radius:14px 14px 0 0;overflow:hidden;padding-bottom:34px";
      sheet.innerHTML = '<img src="/icons/steps/select-files-light.jpg" style="display:block;width:100%">';
      document.body.append(dim, sheet);
      slide(dim, { opacity: 0 }, { opacity: 1 }, 300);
      slide(sheet, { transform: "translateY(100%)" }, { transform: "none" }, 420);
    },
    hide() {
      slide(dim, { opacity: 1 }, { opacity: 0 }, 250);
      slide(sheet, { transform: "none" }, { transform: "translateY(100%)" }, 300);
      const [d, s] = [dim, sheet];
      setTimeout(() => { d.remove(); s.remove(); }, 400);
    },
    async files() {
      const { profileBytes, p12Bytes } = await import("/__video/profile.js");
      const input = document.querySelector('input[type=file][accept*=".mobileprovision"]');
      const dt = new DataTransfer();
      dt.items.add(new File([await p12Bytes()], "Demo Team.p12"));
      dt.items.add(new File([profileBytes({ name: "Demo Wildcard", team: "DEMO123456", teamName: "Demo Team", days: 365 })], "Demo Wildcard.mobileprovision"));
      dt.items.add(new File(["hunter2"], "password.txt", { type: "text/plain" }));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
  };
})();
