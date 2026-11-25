// The one search bar every list page uses (Search, Sources, Changes, Installed, My IPAs): the kit's grey search bar
// (packages.css .search-bar) with iOS 6's Cancel, shown while the field is focused or holds text; Cancel empties the
// field, tells the page and puts the keyboard away. Only the placeholder changes from page to page.
//
//   const bar = searchBar({ placeholder: "Search Sources", ariaLabel, value, onQuery(text), delay, onSubmit, onFocus });
//   bar.input                       // the field
//   pinned(body, bar, scope?)       // the .search-root layout: returns the scroller the page's list goes in
//
// onQuery gets the field's text as typed (untrimmed) after `delay` ms of quiet (0: at once), and at once on Search
// (the keyboard's key) and Cancel. onSubmit runs after onQuery on Search (Search's Recent list saves the query there).

export function searchBar({ placeholder = "Search", ariaLabel = placeholder, value = "", onQuery = () => {}, delay = 0,
  onSubmit = null, onFocus = null, className = "" } = {}) {
  const bar = document.createElement("form");
  bar.className = "search-bar" + (className ? " " + className : "");
  bar.setAttribute("role", "search");
  bar.dataset.searchBar = ""; // built here (searchbar.test.js checks every screen's bar is)
  const field = document.createElement("label");
  field.className = "search-field";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", ariaLabel);
  input.enterKeyHint = "search";
  input.value = value ?? "";
  field.append(input);
  // iOS 6's search bar Cancel: shown while editing or holding text (packages.css). pointerdown keeps the focus, or
  // the blur would hide it before the click lands.
  const cancel = document.createElement("button");
  cancel.className = "search-cancel";
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("pointerdown", (e) => e.preventDefault());
  bar.append(field, cancel);

  let timer = 0;
  const now = () => { clearTimeout(timer); onQuery(input.value); };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    if (delay > 0) timer = setTimeout(() => onQuery(input.value), delay);
    else onQuery(input.value);
  });
  input.addEventListener("search", () => { if (!input.value) now(); }); // the field's own clear, where a browser draws one
  if (onFocus) input.addEventListener("focus", onFocus);
  cancel.addEventListener("click", () => { input.value = ""; now(); input.blur(); });
  bar.addEventListener("submit", (e) => { e.preventDefault(); now(); onSubmit?.(input.value); input.blur(); });
  bar.input = input;
  bar.cancel = cancel;
  // Puts text in the field from code (Search's Recent rows): a query still waiting on `delay` is dropped.
  bar.set = (text) => { clearTimeout(timer); input.value = text ?? ""; };
  return bar;
}

// The search fields' clear button (packages.css .search-field::after), for app.js's captured click: a tap at the field's
// right end, while it has text, empties it and searches again (the field's own input listener), keeping the keyboard
// up. Under iOS 26 the input runs beneath the x, so the click may land on the label or on the input.
export function clearTap(e) {
  const field = e.target?.closest?.(".search-field");
  const input = field?.querySelector("input");
  if (!input?.value || e.clientX < field.getBoundingClientRect().right - 32) return;
  e.preventDefault();
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

// Search's layout (packages.css .search-root): the bar and any scope row stay put under the nav bar, as Cydia's
// search bar does on the 4S; only the scroller returned (.search-results) scrolls, and bounces, under them. `head`
// are the pinned nodes in order (anything a page shows above its bar too). The scroller is the page's list's
// (browse.packageList, nav/vlist.js, the A–Z index) and the iOS 6 indicator follows it (data-scroller).
export function pinned(body, ...head) {
  const results = document.createElement("div");
  results.className = "search-results";
  results.setAttribute("data-scroller", "");
  body.classList.add("search-root");
  body.append(...head.filter(Boolean), results);
  return results;
}

// The scroller a page's list scrolls in: its .search-results when the page is pinned, else the page body itself.
// For the tab bar's second tap (scroll to the top) and the status bar's.
export function scrollerOf(body) {
  return body?.classList?.contains("search-root") ? body.querySelector(":scope > .search-results") ?? body : body;
}
