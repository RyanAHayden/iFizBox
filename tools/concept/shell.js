// The concept page's stand-in for the phone around web/app (tools/concept/build.py puts it first in the iframe's
// <head>, before any of the app runs). A classic script, no imports. SPDX-License-Identifier: GPL-3.0-or-later
//
// The app runs from one inline document (an iframe's srcdoc) with no server behind it, so this shell answers
// everything the app would ask the outside world for, from what build.py packed into window.__concept:
//
//   files      web/app's text files (CSS, JSON) by path        -> lazily linked stylesheets, fetch("x.json")
//   assets     web/app's images as data: URIs by path           -> <img src="icons/...">, srcset
//   net        sample sources by URL (tools/concept/sample.py)  -> the bridge's net.* and the site's /api/fetch
//   apt        sources.list.d files and dpkg's status           -> the jailbreak app's apt.* calls
//   mode       "jailbreak" | "sideload" | "site"                -> a fake ifizboxNative like native/bridge.js's
//   storage    localStorage's starting keys (theme, first visit) -> an in-memory localStorage
//   device     { sa: {top, right, bottom, left}, ipad }         -> env(safe-area-inset-*) (build.py rewrites them
//                                                                 to var(--sa-*)), the user agent
//
// Nothing here reaches the network: an image or fetch for anything not packed gets an empty answer instead (the
// Artifact's CSP would refuse it anyway). The frame page talks to it with postMessage only.
(function () {
  "use strict";
  var C = window.__concept;
  var post = function (msg) { try { parent.postMessage(Object.assign({ concept: true }, msg), "*"); } catch (e) { /* no parent */ } };

  // ---- localStorage: in memory, seeded by the frame page, changes reported back so a reload keeps them
  var data = Object.assign({}, C.storage || {});
  var store = {
    get length() { return Object.keys(data).length; },
    key: function (i) { return Object.keys(data)[i] ?? null; },
    getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[String(k)] = String(v); post({ type: "storage", key: String(k), value: String(v) }); },
    removeItem: function (k) { delete data[String(k)]; post({ type: "storage", key: String(k), value: null }); },
    clear: function () { data = {}; post({ type: "storage-clear" }); },
  };
  try { Object.defineProperty(window, "localStorage", { value: store, configurable: true }); } catch (e) { /* kept */ }

  // ---- IndexedDB: the browser's own where it opens. In an opaque origin (a sandboxed frame without
  // allow-same-origin, iPhone Safari's data: tab) open() throws ("IDBFactory.open() called in an invalid security
  // context" in Safari, SecurityError in Chromium), and the app's stores (sources, caches) never open: Sources
  // empty, Home's tile Add a Source. From the first refusal on, an in-memory stand-in answers instead. It covers what
  // web/app asks of IndexedDB (open with upgrades, object stores with an inline or out-of-line key, get, getAll,
  // getAllKeys, put, add, delete, clear, count, transactions that complete or abort), and starts empty with each app
  // load (a theme, device or mode change, Restart): the stores seed their defaults again.
  function memoryIndexedDB() {
    var dbs = new Map();
    var later = function (f) { setTimeout(f, 0); };
    var clone = function (v) { return v === undefined || typeof structuredClone !== "function" ? v : structuredClone(v); };
    function domError(name, msg) { try { return new DOMException(msg, name); } catch (e) { var x = new Error(msg); x.name = name; return x; } }
    function thrownLater(e) { setTimeout(function () { throw e; }, 0); } // an app handler's exception: reported, the run goes on
    // calls target.on<type>(event); true when the handler called preventDefault()
    function fire(target, type, extra) {
      var prevented = false;
      var ev = Object.assign({ type: type, target: target, currentTarget: target,
        preventDefault: function () { prevented = true; }, stopPropagation: function () {} }, extra || {});
      var f = target["on" + type];
      if (typeof f === "function") { try { f.call(target, ev); } catch (e) { thrownLater(e); } }
      return prevented;
    }
    function nameList(keys) {
      var list = Array.from(keys).sort();
      list.contains = function (n) { return list.indexOf(String(n)) >= 0; };
      list.item = function (i) { return list[i] ?? null; };
      return list;
    }
    // IndexedDB's key order: numbers, then dates, then strings (the keys web/app uses)
    function rank(k) { return typeof k === "number" ? 1 : k instanceof Date ? 2 : 3; }
    function cmp(a, b) {
      var ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 2) { a = a.getTime(); b = b.getTime(); }
      return a < b ? -1 : a > b ? 1 : 0;
    }
    function validKey(k) { return (typeof k === "number" && !isNaN(k)) || typeof k === "string" || (k instanceof Date && !isNaN(k.getTime())); }
    function sortedKeys(rows) { return Array.from(rows.keys()).sort(cmp); }
    function inRange(k, q) { return q === undefined || q === null || cmp(k, q) === 0; }

    function makeTx(rec, db, scope, mode) {
      var tx = { mode: mode, db: db, error: null, oncomplete: null, onerror: null, onabort: null,
        get objectStoreNames() { return nameList(scope || rec.stores.keys()); } };
      var pending = 0, done = false, after = [];
      // a readwrite transaction undoes its writes when it aborts
      var saved = mode === "readonly" ? null : new Map();
      function save(name) { if (saved && !saved.has(name)) saved.set(name, new Map(rec.stores.get(name).rows)); }
      function end(type) {
        if (done) return;
        done = true;
        if (type === "abort" && saved) saved.forEach(function (rows, name) { var s = rec.stores.get(name); if (s) s.rows = rows; });
        fire(tx, type);
        after.forEach(function (f) { f(type); });
      }
      function settle() { later(function () { if (!pending) end("complete"); }); }
      tx._after = function (f) { after.push(f); };
      tx.abort = function () { if (done) throw domError("InvalidStateError", "The transaction has finished."); end("abort"); };
      function request(f, write, storeName) {
        if (done) throw domError("TransactionInactiveError", "The transaction has finished.");
        if (write && mode === "readonly") throw domError("ReadOnlyError", "The transaction is read-only.");
        var r = { result: undefined, error: null, readyState: "pending", transaction: tx, onsuccess: null, onerror: null };
        pending++;
        later(function () {
          if (done) return;
          try {
            if (write) save(storeName);
            r.result = f();
            r.readyState = "done";
            fire(r, "success");
          } catch (e) {
            r.error = e;
            r.readyState = "done";
            if (!fire(r, "error")) { tx.error = e; fire(tx, "error"); end("abort"); }
          }
          pending--;
          settle();
        });
        return r;
      }
      tx.objectStore = function (name) {
        if (done) throw domError("InvalidStateError", "The transaction has finished.");
        name = String(name);
        var s = rec.stores.get(name);
        if (!s || (scope && scope.indexOf(name) < 0)) throw domError("NotFoundError", "No object store named " + name + ".");
        var keyFor = function (value, key) {
          var k = s.keyPath ? (value == null ? undefined : value[s.keyPath]) : key;
          if (s.keyPath && key !== undefined) throw domError("DataError", "The store has a key path: no key argument.");
          if (!validKey(k)) throw domError("DataError", "No valid key for " + name + ".");
          return k;
        };
        var write = function (value, key, isAdd) {
          var k = keyFor(value, key), v = clone(value); // checked and cloned at the call, as IndexedDB does
          return request(function () {
            if (isAdd && s.rows.has(k)) throw domError("ConstraintError", "A record with this key exists in " + name + ".");
            s.rows.set(k, v);
            return k;
          }, true, name);
        };
        var limit = function (list, count) { return count > 0 ? list.slice(0, count) : list; };
        return {
          name: name, keyPath: s.keyPath, transaction: tx, autoIncrement: false, indexNames: nameList([]),
          get: function (k) { return request(function () { return clone(s.rows.get(k)); }); },
          getAll: function (q, count) {
            return request(function () { return limit(sortedKeys(s.rows).filter(function (k) { return inRange(k, q); }), count).map(function (k) { return clone(s.rows.get(k)); }); });
          },
          getAllKeys: function (q, count) {
            return request(function () { return limit(sortedKeys(s.rows).filter(function (k) { return inRange(k, q); }), count); });
          },
          count: function (q) { return request(function () { return sortedKeys(s.rows).filter(function (k) { return inRange(k, q); }).length; }); },
          put: function (value, key) { return write(value, key, false); },
          add: function (value, key) { return write(value, key, true); },
          delete: function (k) { return request(function () { s.rows.delete(k); return undefined; }, true, name); },
          clear: function () { return request(function () { s.rows.clear(); return undefined; }, true, name); },
        };
      };
      settle(); // a transaction nobody asks anything of still completes
      return tx;
    }

    function makeDb(rec) {
      var db = { name: rec.name, onversionchange: null, onclose: null, onabort: null, onerror: null,
        get version() { return rec.version; },
        get objectStoreNames() { return nameList(rec.stores.keys()); } };
      db.createObjectStore = function (name, opts) {
        if (!rec.upgrade) throw domError("InvalidStateError", "Object stores are made only in onupgradeneeded.");
        name = String(name);
        if (rec.stores.has(name)) throw domError("ConstraintError", "An object store named " + name + " exists.");
        rec.stores.set(name, { keyPath: (opts && opts.keyPath) || null, rows: new Map() });
        return rec.upgrade.objectStore(name);
      };
      db.deleteObjectStore = function (name) {
        if (!rec.upgrade) throw domError("InvalidStateError", "Object stores are removed only in onupgradeneeded.");
        if (!rec.stores.delete(String(name))) throw domError("NotFoundError", "No object store named " + name + ".");
      };
      db.transaction = function (names, mode) {
        if (db._closed) throw domError("InvalidStateError", "The database connection is closed.");
        var scope = [].concat(names).map(String);
        if (!scope.length) throw domError("InvalidAccessError", "A transaction needs an object store.");
        scope.forEach(function (n) { if (!rec.stores.has(n)) throw domError("NotFoundError", "No object store named " + n + "."); });
        return makeTx(rec, db, scope, mode === "readwrite" ? "readwrite" : "readonly");
      };
      db.close = function () { db._closed = true; };
      db.addEventListener = db.removeEventListener = function () {};
      return db;
    }

    return {
      open: function (name, version) {
        if (version !== undefined && !(Number.isInteger(version) && version >= 1)) throw new TypeError("The version must be a whole number from 1.");
        name = String(name);
        var req = { result: undefined, error: null, readyState: "pending", transaction: null, source: null,
          onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
        later(function () {
          var rec = dbs.get(name), old = rec ? rec.version : 0;
          var v = version === undefined ? (old || 1) : version;
          if (v < old) {
            req.readyState = "done";
            req.error = domError("VersionError", "The database " + name + " is at version " + old + ".");
            fire(req, "error");
            return;
          }
          if (!rec) { rec = { name: name, version: 0, stores: new Map(), upgrade: null }; dbs.set(name, rec); }
          var db = makeDb(rec);
          req.result = db;
          var succeed = function () { req.readyState = "done"; req.transaction = null; fire(req, "success"); };
          if (v === old) { succeed(); return; }
          var stores = new Map(rec.stores);
          rec.version = v;
          rec.upgrade = makeTx(rec, db, null, "versionchange");
          req.transaction = rec.upgrade;
          rec.upgrade._after(function (type) {
            rec.upgrade = null;
            if (type === "complete") { succeed(); return; }
            rec.version = old; // an aborted upgrade leaves the database as it was
            rec.stores = stores;
            if (!old) dbs.delete(name);
            req.readyState = "done";
            req.error = domError("AbortError", "The upgrade was aborted.");
            req.result = undefined;
            fire(req, "error");
          });
          fire(req, "upgradeneeded", { oldVersion: old, newVersion: v });
        });
        return req;
      },
      deleteDatabase: function (name) {
        var req = { result: undefined, error: null, readyState: "pending", onsuccess: null, onerror: null, onblocked: null };
        later(function () { dbs.delete(String(name)); req.readyState = "done"; fire(req, "success", { oldVersion: 0, newVersion: null }); });
        return req;
      },
      databases: function () { return Promise.resolve(Array.from(dbs.values()).map(function (r) { return { name: r.name, version: r.version }; })); },
      cmp: function (a, b) { var c = cmp(a, b); return c < 0 ? -1 : c > 0 ? 1 : 0; },
      memory: true,
    };
  } // end memoryIndexedDB (tools/concept/idb.test.mjs runs it on its own under web/app's stores)
  (function () {
    var real = null;
    try { real = window.indexedDB || null; } catch (e) { /* refused outright: the stand-in from the start */ }
    var memory = null;
    var stand = function () { return (memory = memory || memoryIndexedDB()); };
    var refused = function (e) { return e && (e.name === "SecurityError" || /security context/i.test(String(e.message))); };
    // the real factory until it refuses; then the stand-in for every call after
    var use = function (method, args) {
      if (!memory && real) {
        try { return real[method].apply(real, args); } catch (e) { if (!refused(e)) throw e; }
      }
      return stand()[method].apply(stand(), args);
    };
    var factory = {
      open: function () { return use("open", arguments); },
      deleteDatabase: function () { return use("deleteDatabase", arguments); },
      databases: function () { return memory || !real || !real.databases ? stand().databases() : real.databases(); },
      cmp: function (a, b) { return real ? real.cmp(a, b) : stand().cmp(a, b); },
      get memory() { return Boolean(memory); }, // for tools/concept/check.mjs: true once the stand-in answers
    };
    try { Object.defineProperty(window, "indexedDB", { value: factory, configurable: true }); } catch (e) { /* kept */ }
  })();

  // ---- the device: an iPhone (or iPad) user agent, touch, safe areas
  var ua = C.device.ipad
    ? "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
    : "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  var nav = { userAgent: ua, platform: C.device.ipad ? "iPad" : "iPhone", maxTouchPoints: 5, vendor: "Apple Computer, Inc.", standalone: false };
  Object.keys(nav).forEach(function (k) {
    try { Object.defineProperty(navigator, k, { get: function () { return nav[k]; }, configurable: true }); } catch (e) { /* kept */ }
  });
  try { Object.defineProperty(window, "Worker", { value: undefined, configurable: true, writable: true }); } catch (e) { /* kept */ }
  // an opaque origin throws SecurityError on reading navigator.serviceWorker (app.js reads it): none there instead
  try { void navigator.serviceWorker; } catch (e) {
    try { Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true }); } catch (e2) { /* kept */ }
  }
  function setSafeArea(sa) {
    var s = document.documentElement.style;
    ["top", "right", "bottom", "left"].forEach(function (k) { s.setProperty("--sa-" + k, (sa[k] || 0) + "px"); });
  }
  setSafeArea(C.device.sa); // a device change loads a fresh app (frame.html load()), so this is set once

  // ---- the app's own files: concept://app/<path> (import.meta.url in the bundle) or a path relative to web/app
  function appPath(u) {
    if (u == null) return null;
    u = String(u).trim();
    if (u.indexOf("https://concept.sample/") === 0) u = "img/concept/" + u.slice(23); // concept: sample pictures
    else if (u.indexOf("concept://app/") === 0) u = u.slice(14);
    else if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.indexOf("//") === 0) return null;
    u = u.replace(/[?#].*$/, "").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
    return u;
  }
  var BLANK = "data:,"; // not an image: the <img> fails at once (error event, no request)
  function assetFor(u) {
    var s = String(u == null ? "" : u);
    if (/^(data|blob):/i.test(s) || s === "") return s;
    var p = appPath(s);
    return p != null && C.assets[p] ? C.assets[p] : BLANK;
  }
  function srcsetFor(v) {
    return String(v).split(",").map(function (part) {
      var bits = part.trim().split(/\s+/);
      if (!bits[0]) return "";
      bits[0] = assetFor(bits[0]);
      return bits.join(" ");
    }).filter(Boolean).join(", ");
  }
  function wrapSetter(proto, prop, map) {
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) { d.set.call(this, map.call(this, v)); } });
  }
  wrapSetter(HTMLImageElement.prototype, "src", assetFor);
  wrapSetter(HTMLImageElement.prototype, "srcset", srcsetFor);
  wrapSetter(HTMLSourceElement.prototype, "srcset", srcsetFor);
  // <link rel="stylesheet" href="x.css"> (nav/motion.js loadStyle): the packed CSS goes in a <style> next to it
  var linkHref = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, "href");
  Object.defineProperty(HTMLLinkElement.prototype, "href", { configurable: true, get: linkHref.get, set: function (v) {
    var p = appPath(v);
    if (p != null && /\.css$/.test(p)) { this.setAttribute("data-concept-css", p); return; }
    if (p != null || /^https?:/i.test(String(v))) return; // nothing else is reachable
    linkHref.set.call(this, v);
  } });
  // url(...) in inline styles (browse.js's section icons: style.backgroundImage = url("icons/sections/x.png"))
  function cssUrls(v) {
    return String(v).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, function (m, q, u) { return 'url("' + assetFor(u) + '")'; });
  }
  var setProp = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (name, value, prio) {
    return setProp.call(this, name, value == null ? value : cssUrls(value), prio);
  };
  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    var n = String(name).toLowerCase();
    if (this instanceof HTMLImageElement && n === "src") value = assetFor(value);
    else if ((this instanceof HTMLImageElement || this instanceof HTMLSourceElement) && n === "srcset") value = srcsetFor(value);
    else if (this instanceof HTMLLinkElement && n === "href") { this.href = value; return; }
    else if (n === "style") value = cssUrls(value);
    return setAttr.call(this, name, value);
  };
  function fixNode(el) {
    if (el.nodeType !== 1) return;
    var list = el.matches("img,source,link[data-concept-css]") ? [el] : [];
    if (el.querySelectorAll) list = list.concat([].slice.call(el.querySelectorAll("img,source,link[data-concept-css]")));
    list.forEach(function (x) {
      if (x instanceof HTMLLinkElement) {
        var p = x.getAttribute("data-concept-css");
        if (x.nextSibling && x.nextSibling.getAttribute && x.nextSibling.getAttribute("data-concept-for") === p) return;
        var st = document.createElement("style");
        st.setAttribute("data-concept-for", p);
        st.textContent = C.files[p] || "";
        x.after(st);
        setTimeout(function () { x.dispatchEvent(new Event("load")); }, 0);
        return;
      }
      var src = x.getAttribute("src");
      if (src != null && !/^(data|blob):/i.test(src)) setAttr.call(x, "src", assetFor(src));
      var ss = x.getAttribute("srcset");
      if (ss != null && !/^(data|blob):/i.test(ss)) setAttr.call(x, "srcset", srcsetFor(ss));
    });
  }
  // style.backgroundImage = ... can't be caught on the way in (Chrome keeps CSS properties on each style object), so
  // the style attribute is fixed when it changes, before the next style pass loads anything
  var RELATIVE_URL = /url\(\s*(?!["']?(?:data:|blob:|#))/;
  function fixStyle(el) {
    var st = el.getAttribute && el.getAttribute("style");
    if (st && RELATIVE_URL.test(st)) setAttr.call(el, "style", cssUrls(st));
  }
  new MutationObserver(function (records) {
    records.forEach(function (r) {
      if (r.type === "attributes") fixStyle(r.target);
      else r.addedNodes.forEach(function (n) {
        fixNode(n);
        if (n.nodeType === 1) { fixStyle(n); if (n.querySelectorAll) [].forEach.call(n.querySelectorAll("[style]"), fixStyle); }
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });

  // ---- the network: sample sources only
  function b64bytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function textB64(t) {
    var bytes = new TextEncoder().encode(t), bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  // { status, type, text } | { status, type, b64 } for url, or a made-up answer for a source the sample hasn't got
  function netAnswer(url) {
    var u;
    try { u = new URL(url); } catch (e) { return { status: 404, type: "text/plain", text: "" }; }
    u.hash = "";
    var bare = u.origin + u.pathname;
    var hit = C.net[u.href] || C.net[bare] || C.net[bare.replace(/\/$/, "")] || C.net[bare + "/"];
    if (hit) return Object.assign({ status: 200 }, hit);
    var host = u.hostname.replace(/^www\./, "");
    var known = C.names[bare] || C.names[bare.replace(/\/$/, "")] || C.names[bare + "/"] || null;
    var name = (known && known.name) || host;
    var path = u.pathname;
    if (/(^|\/)(In)?Release$/.test(path)) {
      return { status: 200, type: "text/plain", text: "Origin: " + name + "\nLabel: " + name + "\nSuite: stable\nVersion: 1.0\n" +
        "Codename: ios\nArchitectures: iphoneos-arm64\nComponents: main\nDescription: A sample source (the concept has no network)\n" };
    }
    if (/\/Packages$/.test(path)) return { status: 200, type: "text/plain", text: "" };
    if (/\.(png|jpe?g|gif|webp|ico|bz2|gz|xz|zst|lzma|ipa|deb)$/i.test(path)) return { status: 404, type: "text/plain", text: "" };
    if (known && known.jailbreak) return { status: 404, type: "text/plain", text: "" };
    return { status: 200, type: "application/json", text: JSON.stringify({ name: name, identifier: "concept.sample." + host,
      sourceURL: u.href, subtitle: "A sample source (the concept has no network)", apps: [], news: [] }) };
  }
  function responseOf(a) {
    var body = a.b64 != null ? b64bytes(a.b64) : (a.text || "");
    return new Response(a.status === 204 ? null : body, { status: a.status, headers: { "content-type": a.type || "application/octet-stream" } });
  }
  var TYPES = { css: "text/css", json: "application/json", js: "text/javascript", html: "text/html", txt: "text/plain" };
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || String(input);
    try {
      var m = /(?:^|\/)api\/fetch\?(.*)$/.exec(url);
      if (m) {
        var target = new URLSearchParams(m[1]).get("url");
        return Promise.resolve(responseOf(netAnswer(target)));
      }
      if (/(?:^|\/)(api|sign|apple)\//.test(url) && !/^https?:/i.test(url)) {
        return Promise.resolve(new Response(JSON.stringify({ error: "the concept has no server" }), { status: 503, headers: { "content-type": "application/json" } }));
      }
      if (/^https?:/i.test(url)) {
        var a = netAnswer(url);
        return Promise.resolve(responseOf(a));
      }
      var p = appPath(url);
      if (p != null && C.files[p] != null) {
        return Promise.resolve(new Response(C.files[p], { status: 200, headers: { "content-type": TYPES[p.split(".").pop()] || "text/plain" } }));
      }
      if (p != null && C.assets[p]) {
        var du = /^data:([^;,]+);base64,(.*)$/.exec(C.assets[p]);
        return Promise.resolve(responseOf({ status: 200, type: du[1], b64: du[2] }));
      }
      return Promise.resolve(new Response("", { status: 404 }));
    } catch (e) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
  };

  // ---- the router's history calls: the document is about:srcdoc, so "#/x" and "srcdoc#/x" would resolve against
  // the frame page's URL; keep every state on this document, only its fragment changing
  ["pushState", "replaceState"].forEach(function (k) {
    var orig = history[k].bind(history);
    history[k] = function (state, title, url) {
      if (url == null) return orig(state, title);
      var s = String(url), i = s.indexOf("#");
      return orig(state, title, location.href.split("#")[0] + (i >= 0 ? s.slice(i) : ""));
    };
  });
  if (C.hash) history.replaceState(null, "", C.hash); // the page the frame page was on (or the concept's start)
  // a link to "#/x" would load the frame page into the phone; one to another site leaves the phone alone
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a || e.defaultPrevented) return;
    var h = a.getAttribute("href");
    if (h.charAt(0) === "#") { e.preventDefault(); location.hash = h; }
    else if (!a.target || a.target === "_self") e.preventDefault();
  });
  addEventListener("hashchange", function () { post({ type: "hash", hash: location.hash }); });
  // the status bar's colour (the site's theme-color, as Safari paints it)
  function themeColor() {
    var m = document.querySelector('meta[name="theme-color"]:not([media])');
    post({ type: "theme-color", color: m ? m.getAttribute("content") : null, theme: document.documentElement.getAttribute("data-theme") });
  }
  new MutationObserver(themeColor).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["content", "data-theme", "data-palette"] });
  addEventListener("DOMContentLoaded", themeColor);
  addEventListener("error", function (e) { post({ type: "error", message: String(e.message || e.error || "error") }); });
  addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    post({ type: "error", message: "unhandled rejection: " + String((r && (r.stack || r.message)) || r) });
  });

  // ---- the shell's bridge (native/bridge.js's shape), for the jailbreak app and the sideload app
  if (C.mode !== "jailbreak" && C.mode !== "sideload") return;
  // native/Sources/App.swift does this at document start in both builds: ios6.css then draws the nav bar's art
  // through the status-bar strip (the website keeps it black)
  document.documentElement.setAttribute("data-shell", "app");
  function fail(code, text) { var e = new Error(text); e.code = code; return e; }
  var handlers = {
    "apt.sources": function () { return C.mode === "jailbreak" ? C.apt.sources : []; },
    "apt.list": function () { return null; },
    "apt.dpkgStatus": function () { return C.mode === "jailbreak" ? C.apt.status : null; },
    "apt.installDates": function () { return {}; },
    "apt.autoInstalled": function () { return []; },
    "malware.scan": function () { return { packages: [], files: [] }; },
    "net.fetch": function (p) {
      var a = netAnswer(p.url);
      return { status: a.status, headers: { "content-type": a.type }, body: a.b64 != null ? a.b64 : textB64(a.text || "") };
    },
    "net.request": function (p) { return handlers["net.fetch"](p); },
    "net.packages": function (p) {
      var a = netAnswer(String(p.dir) + "Packages");
      if (a.status >= 400 || a.text == null) throw fail("not_found", "no Packages index in " + p.dir);
      return { text: a.text, source: p.dir + "Packages" };
    },
    "net.icon": function () { throw fail("not_found", "the concept has no network"); },
    "app.info": function () {
      return { version: C.version || "1.0", build: "", ios: "18.1", jailbreak: C.mode === "jailbreak" ? "rootless" : null, mode: C.mode,
        machine: C.device.ipad ? "iPad14,1" : "iPhone17,1", cf: 2000, markers: [] };
    },
    "apps.isInstalled": function (p) {
      var out = {};
      (p.bundleIds || []).forEach(function (b) { out[b] = false; });
      return { installed: out };
    },
    "library.list": function () { return { identity: false, ipas: [] }; },
    "helper.run": function (p) {
      return { code: 64, stdout: "", stderr: "ifizbox-helper: " + ((p.words || [])[0] || "") + ": not run in the concept\n" };
    },
  };
  var streams = new Map(), next = 1;
  window.ifizboxApp = true;
  window.ifizboxNative = {
    call: function (method, params, onEvent) {
      var id = next++;
      if (onEvent) streams.set(id, onEvent);
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try {
            var h = handlers[method];
            var v = h ? h(params || {}) : null;
            resolve(v === undefined ? null : v);
          } catch (e) { reject(e instanceof Error ? e : fail("network", String(e))); }
          streams.delete(id);
        }, 0);
      });
    },
    emit: function (id, events) {
      var f = streams.get(id);
      if (f) (events || []).forEach(function (ev) { try { f(ev); } catch (e) { console.error(e); } });
    },
    helper: function (words, onEvent) { return this.call("helper.run", { words: [].slice.call(words).map(String), stream: Boolean(onEvent) }, onEvent); },
    dpkgStatus: function () { return this.call("apt.dpkgStatus"); },
    mode: C.mode,
  };
  if (C.mode === "jailbreak") window.ifizboxNative.jailbreak = "rootless";
})();
