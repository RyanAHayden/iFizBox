// The Free Apple ID sign-in's stand-in for the recordings (capture.mjs "override"): the app's own core/gsa.js, with the parts that talk
// to Apple answered here, after the waits Apple's servers take. Everything else (the sign-in page, its alerts) is the real app.
export * from "./gsa.js?real";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const anisetteV3 = () => ({ get: async () => ({}) });
export class AppleIdSession {
  constructor() { this.adsid = "000123-45-demo"; }
  async login() { await wait(1500); return { step: "device" }; }
  async requestDeviceCode() { await wait(500); }
  async verifyDeviceCode() { await wait(1000); return { step: "done" }; }
  async appToken() { await wait(700); return { token: "demo" }; }
  forget() {}
}
export class DevPortal {
  async listTeams() { await wait(800); return [{ teamId: "FREE123456", name: "Demo Person (Personal Team)", type: "Individual" }]; }
}
