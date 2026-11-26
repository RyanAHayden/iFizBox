// A provisioning profile's plist for the recordings, as the app reads one (core/signing.js parseProfile): made at the page's own
// "now", so it is never expired in the video. `days` is how long it lasts, `appId` what it covers.
export function profileBytes({ name, team, teamName, appId = "*", days = 365, udid = "00008130-001A2B3C4D5E6F01" }) {
  const t = (n) => new Date(Date.now() + n * 86400e3).toISOString().replace(/\.\d+Z$/, "Z");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Name</key><string>${name}</string>
<key>TeamName</key><string>${teamName}</string>
<key>TeamIdentifier</key><array><string>${team}</string></array>
<key>CreationDate</key><date>${t(-1)}</date>
<key>ExpirationDate</key><date>${t(days)}</date>
<key>ProvisionedDevices</key><array><string>${udid}</string></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>${team}.${appId}</string><key>get-task-allow</key><true/></dict>
</dict></plist>`;
  return new TextEncoder().encode(plist);
}
export const p12Bytes = async () => new Uint8Array(await (await fetch("/core/fixtures/signing/test.p12")).arrayBuffer());
