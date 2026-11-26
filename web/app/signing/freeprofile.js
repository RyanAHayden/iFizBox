// B475: the sideload build signing with a free Apple ID's profile (the shell's signing.status profile.free).
// The shell refuses the Signing Server route itself then (signing.install / signing.open answer free_profile, worded by
// core/signing.js deviceError); this module only gives iFizBox's own update the profile's bundle ID. Loaded lazily, for
// iFizBox's own row only (signing/queue.js prepareOnDevice, signing/route.js installOnDevice).
//
//   await onFreeProfile(native)        true when signing.status says so; false when it says otherwise or can't be read
//   selfParams(params)                 iFizBox's own update's signing params on a free profile: Keep Bundle IDs off, so
//                                      it is signed as <bundle ID>.<TEAMID>, the ID the Computer Install gave it
import { freeProfile } from "../core/signing.js";
import { KEEP_KEY } from "../core/keepid.js";
import { deviceStatus } from "./device.js";

export async function onFreeProfile(native) {
  try {
    let st = await deviceStatus(native);
    if (typeof st === "string") st = JSON.parse(st);
    return freeProfile(st);
  } catch { return false; }
}

export const selfParams = (params) => ({ ...(params ?? {}), [KEEP_KEY]: false });
