// A page's title set after it opened (a package or app page opened by its id, which learns the name once it loads:
// screens/browse.js setTitle) is also the label pages above it show on their back button, unless the screen gave a
// back label of its own (nav()'s `back`). The page right above, already drawn with the old label, takes the new one
// at once. entry: app.js makePage's { item, title, back, handle }; the page above's nav item follows entry.item in
// its tab's nav stack.
export function backFollowsTitle(entry) {
  const setTitle = entry.handle.setTitle;
  entry.handle.setTitle = (text) => {
    setTitle(text);
    const old = entry.title;
    if (text === old) return;
    if (entry.back === old) {
      entry.back = text;
      const back = entry.item.nextElementSibling?.querySelector(".nav-left .bar-button.back");
      if (back && back.textContent === old) {
        back.textContent = text;
        back.setAttribute("aria-label", "Back to " + text);
      }
    }
    entry.title = text;
  };
}
