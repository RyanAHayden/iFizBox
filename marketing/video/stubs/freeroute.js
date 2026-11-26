// The Free Apple ID's setup, answered here for the recordings (capture.mjs "override"): the four steps in core/freeroute.js's order,
// each after the wait Apple takes, and the certificate and profile they would make (the test fixture's .p12, a 7-day profile made at the
// page's "now"). The password is the marker the fake shell's signing.import takes for a Free Apple ID's certificate.
export * from "./freeroute.js?real";
import { SETUP_STEPS } from "./freeroute.js?real";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SUMMARY = { device: "Added to the account", certificate: "Made a new certificate", appId: null, profile: null };
export async function runSetup({ teamId, bundleId, onStep = () => {} } = {}) {
  const { profileBytes, p12Bytes } = await import("/__video/profile.js");
  const appId = `${bundleId}.${teamId}`;
  const profile = profileBytes({ name: "Free Provisioning Profile", team: teamId, teamName: "Demo Person", appId: bundleId, days: 7 });
  const day = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10);
  for (const { id } of SETUP_STEPS) {
    onStep({ id, state: "running" });
    await wait(900);
    onStep({ id, state: "done", summary: SUMMARY[id] ?? (id === "appId" ? appId : `Good until ${day}`) });
  }
  return { identity: { teamId, serial: "0A1B2C3D4E5F", p12: await p12Bytes(), password: "free-apple-id", expires: new Date(Date.now() + 365 * 86400e3), made: true },
    profile: { data: profile, info: {} }, appId, steps: {} };
}
