// The product's name and identity, in one place (F170, user 2026-11-18: "should those references not all be hardcoded
// but have a ref to the name so a future change would be easier"). The frontend and worker/ import this; native/ and
// the Python tools read the same values from native/brand.env (native/test_brand.py keeps the two equal). Change the
// name here and in brand.env, then run `python3 native/brand.py sync` for the files that can't import it
// (native/sign/Brand.swift, index.html, manifest.json, source.json).
//
// F170 wired NAME everywhere a person reads it; F171 moved the IDs, package name, storage keys and paths to the
// lowercase name (com.ryha.ifizbox, ifizbox.*, IFIZBOX_*; native/test_brand.py: every com.ryha ID is BUNDLE_ID or a
// suffix of it, and no file says the old name). The domain and GitHub repo move in F172.

export const NAME = "iFizBox";
export const DOMAIN = "ifizbox.com";
export const SIGN_HOST = `sign.${DOMAIN}`;
export const BUNDLE_ID = "com.ryha.ifizbox";
export const PACKAGE = BUNDLE_ID; // the .deb's package name
export const GITHUB_REPO = "RyanAHayden/iFizBox";
export const KOFI_URL = "https://ko-fi.com/fizlo"; // F464: the Donate page's link
