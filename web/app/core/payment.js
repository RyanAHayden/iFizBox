// Paid packages through Sileo's Payment Provider API (F20; https://developer.getsileo.app/payment-providers).
// Pure JS, no DOM, no network of its own: the caller hands in `request`, which sends what buildRequest() describes.
//
//   isCommercial(stanza | tagString)       -> true for packages tagged cydia::commercial (the only ones asked about)
//   paymentEndpointUrl(source)             -> "<repo>/payment_endpoint"
//   parseEndpoint(text)                    -> the vendor's https base URL (with a trailing /), or null
//   buildRequest(base, action, opts)       -> { method, url, headers, body }  (body a JSON string, or null)
//       actions: info, user_info, sign_out, package_info, purchase, authorize_download
//   authenticateUrl(base, { udid, model }) -> the sign-in page (opened in an auth session, not fetched)
//   parseCallback(url)                     -> { kind: "authentication_success", token, secret }
//                                             | { kind: "payment_completed" } | null
//   isFreePrice(price)                     -> true for "FREE" / "free" (B13)
//   parseReply(status, json)               -> { ok, data, error, recoveryUrl, invalidate }
//   createPaymentClient({ base, request, device, credentials })  the vendor's calls, signed in or not
//   createCredentialStore({ storage, secure })                    token and payment secret per vendor (F309: the
//                                                                 token travels in the iFizBox Account, the secret never)
//   paidTweakDeb(st, { client, … }), PaidNeeded                   F308: a paid tweak's .deb for the sideload build
//
// Checked live on 2026-11-17 (journal/2026-11-17-f20-repo-extras): repo.chariz.com/payment_endpoint ->
// https://chariz.com/api/sileo/, havoc.app/payment_endpoint -> https://havoc.app/api/sileo/; both answer GET /info
// and POST /package/<id>/info in the spec's shape ({"price":"$1.99","purchased":false,"available":true}), and
// /authenticate?udid&model sends the browser to their own sign-in page. Neither sends CORS headers, so the page
// can't call them itself: the app sends them through the shell (net.request), the site doesn't call them at all.
//
// Sign-in: the vendor finishes at sileo://authentication_success?token=…&payment_secret=…, a scheme its server
// writes, not one iFizBox picks. The shell's auth session catches that URL (ASWebAuthenticationSession's
// callbackURLScheme "sileo" needs no registered scheme) and hands it back; a ifizbox:// link with the same path
// (ifizbox://authentication_success?… or ifizbox://payment/authentication_success?…) is read the same way, for a
// vendor that lets the client name its own callback.

const COMMERCIAL_TAG = "cydia::commercial";
const CALLBACK_SCHEMES = ["sileo:", "ifizbox:"];
const PKG = /^[a-z0-9][a-z0-9+._-]*$/i;

export function isCommercial(st) {
  const tag = typeof st === "string" ? st : st?.tag ?? st?.Tag ?? "";
  return String(tag).split(",").some((t) => t.trim().toLowerCase() === COMMERCIAL_TAG);
}

export function paymentEndpointUrl(source) {
  const uri = String(source?.uri ?? "");
  if (!/^https?:\/\//i.test(uri)) return null;
  return uri.replace(/\/*$/, "/") + "payment_endpoint";
}

// The endpoint file is plain text, one URL. The spec says vendors must use HTTPS; anything else is refused, as is
// a URL with credentials or a query (requests are built by appending paths to it).
export function parseEndpoint(text) {
  const line = String(text ?? "").trim().split(/\s+/)[0] ?? "";
  let u;
  try { u = new URL(line); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !u.hostname) return null;
  return u.href.replace(/\/*$/, "/");
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

function pkgPath(id) {
  if (!PKG.test(String(id ?? ""))) throw new Error(`not a package name: ${id}`);
  return `package/${encodeURIComponent(id)}/`;
}

// The request one call sends. `opts`: { token, secret, udid, device, packageId, version, repo, architecture }.
// Like Sileo and Zebra (B10, docs/sileo-zebra.md), every POST but sign_out carries udid and device, and
// authorize_download the package's architecture, so a vendor serving rootful and rootless debs picks the right one.
// Fields the spec marks optional (token on package_info) are left out when unknown rather than sent empty.
// F318: `tokenless: true` lets authorize_download go without a token (a FREE package the vendor says is purchased
// while signed out: Chariz hands its .deb out that way).
export function buildRequest(base, action, opts = {}) {
  const b = parseEndpoint(base);
  if (!b) throw new Error(`not an https payment endpoint: ${base}`);
  const { token, secret, udid, device, packageId, version, repo, architecture, tokenless = false } = opts;
  const who = () => clean({ token, udid, device });
  let path, body = null, method = "POST";
  switch (action) {
    case "info": method = "GET"; path = "info"; break;
    case "user_info": need(token, "token"); path = "user_info"; body = who(); break;
    case "sign_out": need(token, "token"); path = "sign_out"; body = { token }; break;
    case "package_info": path = pkgPath(packageId) + "info"; body = who(); break;
    case "purchase":
      need(token, "token"); need(secret, "payment secret");
      path = pkgPath(packageId) + "purchase"; body = { ...clean({ token, udid, device }), payment_secret: String(secret) }; break;
    case "authorize_download":
      if (!tokenless) need(token, "token");
      path = pkgPath(packageId) + "authorize_download"; body = clean({ token, udid, device, version, repo, architecture }); break;
    default: throw new Error(`unknown payment action: ${action}`);
  }
  return { method, url: b + path, headers: method === "GET" ? { Accept: "application/json" } : { ...JSON_HEADERS },
    body: body && JSON.stringify(body) };
}

function need(v, what) {
  if (v == null || v === "") throw new Error(`payment: no ${what} (sign in first)`);
}

function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v != null && v !== "") out[k] = String(v);
  return out;
}

export function authenticateUrl(base, { udid = "", model = "" } = {}) {
  const b = parseEndpoint(base);
  if (!b) throw new Error(`not an https payment endpoint: ${base}`);
  return `${b}authenticate?${new URLSearchParams({ udid, model })}`;
}

// sileo://authentication_success?token=…&payment_secret=… (host form) and ifizbox://payment/authentication_success
// (path form) both parse; so does sileo://payment_completed.
export function parseCallback(url) {
  let u;
  try { u = new URL(String(url ?? "")); } catch { return null; }
  if (!CALLBACK_SCHEMES.includes(u.protocol)) return null;
  const words = [u.hostname, ...u.pathname.split("/")].filter(Boolean).map((w) => w.toLowerCase());
  const what = words.filter((w) => w !== "payment").pop();
  if (what === "authentication_success") {
    const token = u.searchParams.get("token");
    const secret = u.searchParams.get("payment_secret");
    if (!token || !secret) return null;
    return { kind: "authentication_success", token, secret };
  }
  if (what === "payment_completed") return { kind: "payment_completed" };
  return null;
}

// Spec: an `error` string (or success: false) means failure; `recovery_url` gives a More Info button; `invalidate`
// tells the client to forget its credentials. A non-2xx answer without a body is a failure too.
export function parseReply(status, json) {
  const j = json && typeof json === "object" && !Array.isArray(json) ? json : {};
  const recoveryUrl = typeof j.recovery_url === "string" && /^https?:\/\//i.test(j.recovery_url) ? j.recovery_url : null;
  const invalidate = j.invalidate === true;
  const failed = typeof j.error === "string" || j.success === false || !(status >= 200 && status < 300);
  if (failed) {
    const error = typeof j.error === "string" && j.error.trim() ? j.error.trim() : `the vendor answered HTTP ${status}`;
    return { ok: false, data: j, error, recoveryUrl, invalidate };
  }
  return { ok: true, data: j, error: null, recoveryUrl, invalidate };
}

// Typed answers.
function parseInfo(j) {
  const banner = j?.authentication_banner;
  return {
    name: typeof j?.name === "string" ? j.name : "",
    icon: typeof j?.icon === "string" && /^https?:\/\//i.test(j.icon) ? j.icon : null,
    description: typeof j?.description === "string" ? j.description : "",
    banner: banner && typeof banner.message === "string"
      ? { message: banner.message, button: typeof banner.button === "string" && banner.button ? banner.button : "Sign In" } : null,
  };
}

// B13: a commercial package the vendor gives away answers price "FREE" (Chariz, betterAlarm), and purchased: true
// even without a token, so the screen asks this rather than trusting `purchased` alone.
export function isFreePrice(price) {
  return typeof price === "string" && price.trim().toLowerCase() === "free";
}

function parsePackageInfo(j) {
  return { price: typeof j?.price === "string" ? j.price : null, purchased: j?.purchased === true,
    available: j?.available !== false };
}

// status 0 done, 1 open `url` (in a browser sheet, finishing at sileo://payment_completed), -1 or anything else failed.
export function parsePurchase(j) {
  const s = Number(j?.status);
  if (s === 0) return { status: "done" };
  if (s === 1 && typeof j?.url === "string" && /^https:\/\//i.test(j.url)) return { status: "action", url: j.url };
  return { status: "failed" };
}

export class PaymentError extends Error {
  constructor(reply) {
    super(reply.error);
    this.name = "PaymentError";
    this.recoveryUrl = reply.recoveryUrl;
    this.invalidate = reply.invalidate;
  }
}

// `request({ method, url, headers, body })` -> { status, json } (json null when the body wasn't JSON).
// `device()` -> { udid, model } (may be async; the shell knows them). `credentials`: createCredentialStore().
export function createPaymentClient({ base, request, device = () => ({}), credentials = null }) {
  const vendor = parseEndpoint(base);
  if (!vendor) throw new Error(`not an https payment endpoint: ${base}`);

  async function send(action, opts = {}) {
    const res = await request(buildRequest(vendor, action, opts));
    const reply = parseReply(res.status, res.json);
    if (!reply.ok) {
      // F309: a token the account brought that the vendor refuses (401/403: often tied to the UDID it signed in on)
      // is dropped here like an invalidate, so the screen shows Sign In instead of the same error again. Either way
      // only this device lets it go (decline): the account and the other devices keep theirs.
      const synced = opts.token && (res.status === 401 || res.status === 403) && (await credentials?.load(vendor))?.synced;
      if (reply.invalidate || synced) {
        await (credentials?.decline ?? credentials?.forget)?.call(credentials, vendor);
        reply.invalidate = true;
      }
      throw new PaymentError(reply);
    }
    return reply.data;
  }

  // B183: `lenient` (the price lookup, where udid and device are optional): a device() that fails (the shell knows
  // no UDID yet) sends the request without them instead of failing; `onDeviceError(e)` hears why.
  async function who({ lenient = false, onDeviceError = null } = {}) {
    let d;
    try { d = (await device()) ?? {}; } catch (e) {
      if (!lenient) throw e;
      d = {};
      onDeviceError?.(e);
    }
    const c = (await credentials?.load(vendor)) ?? {};
    return { udid: d.udid, device: d.model, token: c.token };
  }

  return {
    base: vendor,
    info: async () => parseInfo(await send("info")),
    async signedIn() { return Boolean((await credentials?.load(vendor))?.token); },
    async authenticateUrl() { const d = (await device()) ?? {}; return authenticateUrl(vendor, d); },
    // Keeps what the vendor's callback URL carried. Returns true when it was a sign-in for us to keep.
    async finishSignIn(callbackUrl) {
      const cb = parseCallback(callbackUrl);
      if (cb?.kind !== "authentication_success") return false;
      await credentials?.save(vendor, { token: cb.token, secret: cb.secret });
      return true;
    },
    async userInfo() {
      const d = await send("user_info", await who());
      return { items: Array.isArray(d.items) ? d.items.filter((x) => typeof x === "string") : [],
        user: { name: typeof d.user?.name === "string" ? d.user.name : "", email: typeof d.user?.email === "string" ? d.user.email : "" } };
    },
    async signOut() {
      const w = await who();
      try { if (w.token) await send("sign_out", { token: w.token }); } finally { await credentials?.forget(vendor); }
    },
    // B183: answers even when device() fails; `deviceError` (the shell's message) is then set, saying why no UDID
    // went (and why Sign In and Buy will ask for one).
    async packageInfo(packageId) {
      let deviceError = null;
      const w = await who({ lenient: true, onDeviceError: (e) => { deviceError = String(e?.message ?? e); } });
      const info = parsePackageInfo(await send("package_info", { ...w, packageId }));
      return deviceError ? { ...info, deviceError } : info;
    },
    async purchase(packageId) {
      const c = (await credentials?.load(vendor)) ?? {};
      // F309: a sign-in the account brought has no payment secret (it never leaves the iPhone that signed in):
      // Sign In again here, which brings this device's own secret.
      if (c.synced && !c.secret) {
        await credentials?.decline?.(vendor);
        throw new PaymentError({ error: "Sign in again on this iPhone to buy: your payment details stay on the iPhone you signed in on.",
          recoveryUrl: null, invalidate: true });
      }
      return parsePurchase(await send("purchase", { ...(await who()), secret: c.secret, packageId }));
    },
    // The one-time https URL the .deb downloads from (expires in a minute or two: fetch it straight away).
    // `architecture`: the package's own (its stanza's Architecture), not the device's guess.
    // F318: `tokenless` sends it signed out (no token); signed in, the token goes as usual.
    async authorizeDownload(packageId, { version, repo, architecture, tokenless = false } = {}) {
      const d = await send("authorize_download", { ...(await who()), packageId, version, repo, architecture, tokenless });
      if (typeof d.url !== "string" || !/^https:\/\//i.test(d.url)) throw new PaymentError(parseReply(502, { error: "the vendor gave no https download URL" }));
      return d.url;
    },
  };
}

// Token and payment secret per vendor base URL. The token sits in `storage`; the secret goes to `secure`
// ({ get(key), set(key, value), remove(key) }, the shell's Keychain behind the passcode or Face ID as the spec asks)
// when there is one, else beside the token. Screens say which one they got (`secureStorage`).
//
// F309: repo sign-ins travel in the iFizBox Account (core/account.js repoLogins), the token only. The record in
// `storage` is { token, synced?, declined? }: `synced` a token the account brought (no payment secret here: buying
// asks for Sign In again), `declined` one the repo turned down on this device (many vendors tie a token to the UDID
// it signed in on). A declined token reads as signed out (load() -> null) but logins() still reports it, so the
// account doesn't read its absence as a sign-out and other devices keep theirs; adopt() won't bring it back.
//   logins()               -> { vendor: token }  every token this device holds for the account, declined included
//   adopt(vendor, token)   the account's token: kept unless this device signed in there itself -> whether taken
//   drop(vendor)           a sign-out from another device: forgets the token here (no call to the vendor)
//   decline(vendor)        the vendor turned the token down here: Sign In shows, the account isn't changed
export const CREDENTIAL_PREFIX = "ifizbox.payment:";
export function createCredentialStore({ storage = globalThis.localStorage, secure = null } = {}) {
  const k = (vendor) => CREDENTIAL_PREFIX + vendor;
  const read = (vendor) => {
    try { const rec = JSON.parse(storage?.getItem(k(vendor)) || "null"); return rec?.token ? rec : null; } catch { return null; }
  };
  const write = (vendor, rec) => { try { storage?.setItem(k(vendor), JSON.stringify(rec)); } catch { /* storage full */ } };
  return {
    secureStorage: Boolean(secure),
    async load(vendor) {
      const rec = read(vendor);
      if (!rec || rec.declined) return null;
      const secret = rec.synced ? null : secure ? await secure.get(k(vendor)).catch(() => null) : rec.secret;
      return { token: rec.token, secret: secret ?? null, ...(rec.synced ? { synced: true } : {}) };
    },
    async save(vendor, { token, secret }) {
      if (secure) {
        await secure.set(k(vendor), secret);
        storage?.setItem(k(vendor), JSON.stringify({ token }));
      } else storage?.setItem(k(vendor), JSON.stringify({ token, secret }));
    },
    async forget(vendor) {
      storage?.removeItem(k(vendor));
      if (secure) await secure.remove(k(vendor)).catch(() => {});
    },
    logins() {
      const out = {};
      let n = 0;
      try { n = storage?.length ?? 0; } catch { n = 0; }
      const keys = [];
      for (let i = 0; i < n; i++) { const key = storage.key(i); if (key?.startsWith(CREDENTIAL_PREFIX)) keys.push(key); }
      for (const key of keys) {
        const vendor = key.slice(CREDENTIAL_PREFIX.length);
        const rec = parseEndpoint(vendor) === vendor ? read(vendor) : null;
        if (rec) out[vendor] = rec.token;
      }
      return out;
    },
    async adopt(vendor, token) {
      if (!token || parseEndpoint(vendor) !== vendor) return false;
      const rec = read(vendor);
      if (rec?.token === token) return !rec.declined;
      if (rec && !rec.synced && !rec.declined) return false; // signed in here: this device keeps its own
      if (secure) await secure.remove(k(vendor)).catch(() => {}); // a secret belongs to the token it came with
      write(vendor, { token, synced: true });
      return true;
    },
    async drop(vendor) {
      if (read(vendor)) await this.forget(vendor);
    },
    async decline(vendor) {
      const rec = read(vendor);
      if (!rec) return;
      write(vendor, { token: rec.token, ...(rec.synced ? { synced: true } : {}), declined: true });
      if (secure) await secure.remove(k(vendor)).catch(() => {});
    },
  };
}

// ---- F308: a paid tweak's .deb for the sideload build (screens/tweaks.js) -------------------------------------------
//
//   await paidTweakDeb(st, { client, repo, architecture, cached, download })  -> Uint8Array
//       the .deb the vendor hands this account: `cached(st)` first (the shell's copy, kept per package and version),
//       else package_info, then authorize_download and `download(url, st)` (the shell fetches the one-time URL and
//       keeps the file). Throws PaidNeeded when the account has to act first: not signed in, not bought, not for sale.
//   PaidNeeded { need: "signin" | "purchase" | "unavailable", price, packageId }
//
// Not bought or signed out is not an error for the screen: it offers Sign In or Buy (screens/tweaks.js offerPaid).
// A token the vendor no longer takes (invalidate: the store forgets it) asks for Sign In again.
// F318: signed out, a FREE package the vendor already calls purchased (Chariz's betterAlarm) is first asked for
// without a token (Chariz's authorize_download hands it out, checked live 2026-11-20); any refusal there asks for
// Sign In as before.
export class PaidNeeded extends Error {
  constructor(need, { price = null, packageId = "" } = {}) {
    super(need === "signin" ? "Sign in to its seller to download this tweak."
      : need === "purchase" ? `Buy this tweak${price ? ` (${isFreePrice(price) ? "free" : price})` : ""} to download it.`
        : "Its seller doesn't sell this tweak right now.");
    this.name = "PaidNeeded";
    this.need = need;
    this.price = price;
    this.packageId = packageId;
  }
}

export async function paidTweakDeb(st, { client, repo = "", architecture = "", cached = null, download } = {}) {
  const id = st?.package;
  const version = st?.version ?? "";
  const hit = cached ? await Promise.resolve().then(() => cached(st)).catch(() => null) : null;
  if (hit?.length) return hit;
  const [signedIn, info] = await Promise.all([client.signedIn(), client.packageInfo(id)]);
  if (!info.available) throw new PaidNeeded("unavailable", { price: info.price, packageId: id });
  const freeOpen = !signedIn && info.purchased && isFreePrice(info.price);
  if (!signedIn && !freeOpen) throw new PaidNeeded("signin", { price: info.price, packageId: id });
  if (!info.purchased) throw new PaidNeeded("purchase", { price: info.price, packageId: id });
  const ask = { version, repo, architecture: st?.architecture || architecture };
  if (freeOpen) {
    let url;
    try {
      url = await client.authorizeDownload(id, { ...ask, tokenless: true });
    } catch {
      throw new PaidNeeded("signin", { price: info.price, packageId: id });
    }
    return download(url, st);
  }
  let url;
  try {
    url = await client.authorizeDownload(id, ask);
  } catch (e) {
    if (e instanceof PaymentError && e.invalidate) throw new PaidNeeded("signin", { price: info.price, packageId: id });
    throw e;
  }
  return download(url, st);
}
