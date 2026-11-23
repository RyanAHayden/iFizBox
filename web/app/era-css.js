// C69: the era stylesheets (iOS 7, iOS 13, iOS 26) are the two apps' only; the website is iOS 6 and never fetches
// them. A classic script in <head>, right after palettes.css so the eras keep their place in the cascade: where the
// shell's bridge is there (before any page script runs), it writes the three links in; on the website it does nothing.
// (Theme > Style can switch era while the app runs, so the apps get all three up front.)
(function () {
  if (!window.ifizboxNative) return;
  ["ios7.css", "ios13.css", "ios26.css"].forEach(function (f) {
    document.write('<link rel="stylesheet" href="' + f + '">');
  });
})();
