//! Phone Setup's device side (F465; the steps are ../../core/src/phone.rs): this command running inside the Open
//! Minis app (an emulated aarch64 Linux) on the iPhone it installs on. iOS 27 only.
//!
//! - Open Minis's commands, each printing one JSON line with --compact: `minis-bonjour advertise` publishes the
//!   pairable host and forwards each connection to a port in the shell; `apple-speak` at volume 0 keeps Minis running
//!   while the person is in Settings; `apple-notification` shows the code over Settings.
//!   (Interfaces as BariStore, MIT, drives them: github.com/barismd/BariStore src/minis.rs.)
//! - Pairing: idevice's PairableHost, the phone dialing in (native/sideload/idevice does the same with Apple's Bonjour).
//! - Installing: LocalDevVPN loops 10.7.0.1 back to the phone's own RemotePairing service; an RPPairing tunnel, RSD,
//!   then AFC and installation_proxy, as idevice's FFI `tunnel_create_rppairing` does.

use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use idevice::house_arrest::HouseArrestClient;
use idevice::remote_pairing::{
    connect_tls_psk_tunnel_native, PairableHost, PairableHostInfo, RemotePairingClient, RpPairingFile, RpPairingSocket,
    PAIRABLE_HOST_SERVICE_TYPE,
};
use idevice::rsd::RsdHandshake;
use idevice::tcp::{adapter::Adapter, handle::AdapterHandle};
use idevice::RsdService;
use ifizbox_setup_core::phone::Phone;
use ifizbox_setup_core::Ui;
use serde_json::Value;
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;

use crate::NAME;

/// Where LocalDevVPN puts this iPhone.
const LOOPBACK: [u8; 4] = [10, 7, 0, 1];
/// RemotePairing usually gets the first dynamic port, but not always (native/sideload/idevice/README.md).
const USUAL_PORT: u16 = 49152;
const WAIT_FOR_DEVICE: Duration = Duration::from_secs(10 * 60);
const TRIES: u32 = 3;
/// Open Minis runs on older iOS too, which has no "Pair with" row, and the shell can't tell the iOS version.
const OLDER_IOS: &str = "This needs iOS 27 or later: with no \"Pair with\" row, use a computer instead.";
/// Spoken at volume 0 and the slowest rate, about a minute each time.
const QUIET: &str = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen \
    seventeen eighteen nineteen twenty";

/// Whether this is Open Minis.
pub fn inside() -> bool {
    std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| d.join("minis-bonjour").is_file()))
}

/// The envelope's data, or why not: {"ok":true,"data":…} / {"ok":false,"error":{"code","message"}}, on the last line
/// that is JSON.
fn envelope(tool: &str, out: &str) -> Result<Value, String> {
    let v: Value = out
        .lines()
        .rev()
        .find_map(|l| serde_json::from_str(l.trim()).ok())
        .ok_or_else(|| format!("{tool} printed no answer"))?;
    if v.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(v.get("data").cloned().unwrap_or(Value::Null));
    }
    let why = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("refused");
    Err(format!("{tool}: {why}"))
}

async fn call(tool: &str, args: &[&str]) -> Result<Value, String> {
    let child = Command::new(tool).args(args).arg("--compact").stdin(Stdio::null()).kill_on_drop(true).output();
    let out = tokio::time::timeout(Duration::from_secs(80), child)
        .await
        .map_err(|_| format!("{tool} didn't answer"))?
        .map_err(|e| format!("{tool}: {e}"))?;
    envelope(tool, &String::from_utf8_lossy(&out.stdout))
}

/// Runs and waits, for cleanup paths (drop).
fn call_now(tool: &str, args: &[&str]) {
    let _ = std::process::Command::new(tool).args(args).arg("--compact").stdin(Stdio::null()).stdout(Stdio::null())
        .stderr(Stdio::null()).status();
}

/// idevice names the type with its domain ("_x._tcp.local."); minis-bonjour takes it without.
fn service_type(full: &str) -> &str {
    full.trim_end_matches('.').trim_end_matches(".local")
}

/// The Bonjour advertisement, withdrawn on drop.
struct Advert(String);

impl Drop for Advert {
    fn drop(&mut self) {
        call_now("minis-bonjour", &["stop", &self.0]);
    }
}

async fn advertise(instance: &str, port: u16, txt: &[(String, String)]) -> Result<Advert, String> {
    let port = port.to_string();
    let records: Vec<String> = txt.iter().map(|(k, v)| format!("{k}={v}")).collect();
    let mut args = vec!["advertise", service_type(PAIRABLE_HOST_SERVICE_TYPE), instance, port.as_str()];
    args.extend(records.iter().map(String::as_str));
    let data = call("minis-bonjour", &args).await?;
    match (data.get("id").and_then(Value::as_str), data.get("state").and_then(Value::as_str)) {
        (_, Some("failed")) => Err(format!("Open Minis couldn't advertise: {data}")),
        (Some(id), _) => Ok(Advert(id.to_string())),
        _ => Err(format!("minis-bonjour answered without an id: {data}")),
    }
}

/// Silent speech, over and over, until dropped.
struct KeepAlive(tokio::task::JoinHandle<()>);

impl KeepAlive {
    fn start() -> KeepAlive {
        KeepAlive(tokio::spawn(async {
            loop {
                let a = ["speak", "--text", QUIET, "--volume", "0", "--rate", "0.05", "--voice", "en-US"];
                if call("apple-speak", &a).await.is_err() {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
            }
        }))
    }
}

impl Drop for KeepAlive {
    fn drop(&mut self) {
        self.0.abort();
        call_now("apple-speak", &["stop"]);
    }
}

async fn notify(title: &str, body: &str) {
    // The terminal says the same, so a refused notification isn't an error.
    let _ = call("apple-notification", &["schedule", "--title", title, "--body", body, "--after", "1"]).await;
}

pub fn spaced(code: &str) -> String {
    match (code.get(..3), code.get(3..)) {
        (Some(a), Some(b)) => format!("{a} {b}"),
        _ => code.to_string(),
    }
}

async fn open_port(port: u16, wait: Duration) -> Option<TcpStream> {
    let to = SocketAddr::from((LOOPBACK, port));
    tokio::time::timeout(wait, TcpStream::connect(to)).await.ok()?.ok()
}

type Tunnel = (AdapterHandle, RsdHandshake);

/// An RPPairing tunnel over `stream`, which must be the RemotePairing service (`port` only names it in errors).
async fn tunnel_over(stream: TcpStream, port: u16, pairing: &mut RpPairingFile) -> Result<Tunnel, String> {
    let step = |what: &'static str| move |e: idevice::IdeviceError| format!("port {port}, {what}: {e}");
    let mut rpc = RemotePairingClient::new(RpPairingSocket::new(stream), NAME);
    rpc.attempt_pair_verify().await.map_err(step("greeting"))?;
    rpc.validate_pairing(pairing).await.map_err(step("pairing refused"))?;
    let tunnel_port = rpc.create_tcp_listener().await.map_err(step("tunnel listener"))?;
    let stream = open_port(tunnel_port, Duration::from_secs(10)).await.ok_or("the tunnel's port didn't open")?;
    let tunnel = connect_tls_psk_tunnel_native(stream, rpc.encryption_key()).await.map_err(step("tunnel"))?;
    let ip = |s: &str| s.parse::<IpAddr>().map_err(|e| format!("tunnel address {s}: {e}"));
    let (client, server) = (ip(&tunnel.info.client_address)?, ip(&tunnel.info.server_address)?);
    let (mtu, rsd_port) = (tunnel.info.mtu as usize, tunnel.info.server_rsd_port);
    let mut adapter = Adapter::new(Box::new(tunnel.into_inner()), client, server);
    adapter.set_mss(mtu.min(8192) - 60);
    let mut adapter = adapter.to_async_handle();
    let rsd = adapter.connect(rsd_port).await.map_err(|e| format!("RSD: {e}"))?;
    let handshake = RsdHandshake::new(rsd).await.map_err(step("RSD handshake"))?;
    Ok((adapter, handshake))
}

/// The tunnel: on the usual port, else on whichever other dynamic port answers as RemotePairing.
async fn tunnel(pairing: &mut RpPairingFile) -> Result<Tunnel, String> {
    let limit = Duration::from_secs(20);
    let mut why = String::from("nothing answers on 10.7.0.1: is LocalDevVPN connected?");
    if let Some(s) = open_port(USUAL_PORT, Duration::from_secs(5)).await {
        match tokio::time::timeout(limit, tunnel_over(s, USUAL_PORT, pairing)).await {
            Ok(Ok(t)) => return Ok(t),
            Ok(Err(e)) => why = e,
            Err(_) => why = format!("port {USUAL_PORT} didn't answer"),
        }
    }
    // 64 at a time: a refused port answers at once, and Minis's emulator can't take thousands of sockets.
    println!("Looking for the iPhone's pairing service on other ports; this can take a few minutes…");
    let mut next = u32::from(USUAL_PORT) + 1;
    while next <= u32::from(u16::MAX) {
        let batch: Vec<_> = (next..(next + 64).min(u32::from(u16::MAX) + 1))
            .map(|p| p as u16)
            .filter(|p| *p != 62078)
            .map(|p| tokio::spawn(async move { open_port(p, Duration::from_secs(2)).await.map(|s| (p, s)) }))
            .collect();
        for found in batch {
            let Ok(Some((port, s))) = found.await else { continue };
            match tokio::time::timeout(limit, tunnel_over(s, port, pairing)).await {
                Ok(Ok(t)) => return Ok(t),
                Ok(Err(e)) => why = e,
                Err(_) => {}
            }
        }
        next += 64;
    }
    Err(why)
}

pub struct Minis {
    rt: tokio::runtime::Runtime,
    /// This run's pairing, never written to disk.
    pairing: Option<RpPairingFile>,
}

impl Minis {
    pub fn new() -> Self {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("tokio runtime");
        Minis { rt, pairing: None }
    }
}

async fn pair_on_phone(ui: &mut dyn Ui) -> Result<RpPairingFile, String> {
    let identity = RpPairingFile::generate(NAME);
    let info = PairableHostInfo::generate(NAME, "Mac17,7");
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let _alive = KeepAlive::start();
    let _advert = advertise(identity.identifier(), port, &info.mdns_txt_records(identity.identifier())).await?;
    // A first notification now, so iOS asks to allow them while Open Minis is in front, not over the code's page.
    notify(&format!("{NAME} setup"), "The pairing code comes as a notification.").await;
    ui.say(&format!(
        "Open Settings > Privacy & Security > Developer Mode, tap \"Pair with {NAME}\" and enter the iPhone's passcode. \
         The 6-digit code then comes as a notification (and shows here). Allow notifications if asked.\n\
         {OLDER_IOS}"
    ));
    let deadline = Instant::now() + WAIT_FOR_DEVICE;
    let mut why = String::new();
    for _ in 0..TRIES {
        let left = deadline.saturating_duration_since(Instant::now());
        let (stream, _) = tokio::time::timeout(left, listener.accept())
            .await
            .map_err(|_| format!("Settings didn't connect within 10 minutes. {OLDER_IOS}"))?
            .map_err(|e| e.to_string())?;
        let mut file = identity.clone();
        let mut host = PairableHost::new(RpPairingSocket::new_device(stream), info.clone());
        let shown = std::cell::RefCell::new(&mut *ui);
        let accept = host.accept(&mut file, |code| {
            let code = spaced(&code);
            shown.borrow_mut().say(&format!("Code to type in Settings: {code}"));
            async move { notify(&format!("Pairing code {code}"), &format!("Type {code} in Settings.")).await }
        });
        match tokio::time::timeout(Duration::from_secs(5 * 60), accept).await {
            Ok(Ok(_)) => {
                notify("Paired", "Go back to Open Minis.").await;
                return Ok(file);
            }
            Ok(Err(e)) => why = format!("{e}"),
            Err(_) => why = "no code was typed within 5 minutes".into(),
        }
        ui.say(&format!("That try didn't work ({why}). Tap \"Pair with {NAME}\" again."));
    }
    Err(why)
}

impl Phone for Minis {
    fn ready(&mut self) -> Result<(), String> {
        let up = self.rt.block_on(async {
            // Through the VPN, 10.7.0.1 accepts or refuses at once; without it, nothing answers.
            let to = SocketAddr::from((LOOPBACK, USUAL_PORT));
            match tokio::time::timeout(Duration::from_secs(4), TcpStream::connect(to)).await {
                Ok(Ok(_)) => true,
                Ok(Err(e)) => e.kind() == std::io::ErrorKind::ConnectionRefused,
                Err(_) => false,
            }
        });
        if up {
            Ok(())
        } else {
            Err("Open LocalDevVPN (free on the App Store), tap Connect, then run this again. Wi-Fi must be on.".into())
        }
    }

    fn pair(&mut self, ui: &mut dyn Ui) -> Result<Vec<u8>, String> {
        let file = self.rt.block_on(pair_on_phone(ui))?;
        let bytes = file.to_bytes();
        self.pairing = Some(file);
        Ok(bytes)
    }

    fn install(&mut self, ipa: &Path, ui: &mut dyn Ui) -> Result<(), String> {
        let pairing = self.pairing.as_mut().ok_or("not paired")?;
        let ui = std::cell::RefCell::new(ui);
        self.rt.block_on(async {
            let _alive = KeepAlive::start();
            let (mut adapter, mut handshake) = tunnel(pairing).await?;
            idevice::utils::installation::install_package_with_callback_rsd(
                &mut adapter,
                &mut handshake,
                ipa,
                None,
                |(pct, _): (u64, ())| {
                    ui.borrow_mut().progress("Installing", pct, 100);
                    async {}
                },
                (),
            )
            .await
            .map_err(|e| format!("{e}"))
        })
    }

    fn write_file(&mut self, bundle_id: &str, dirs: &[String], path: &str, bytes: &[u8]) -> Result<(), String> {
        let pairing = self.pairing.as_mut().ok_or("not paired")?;
        self.rt.block_on(async {
            let err = |e: idevice::IdeviceError| format!("{e}");
            let (mut adapter, mut handshake) = tunnel(pairing).await?;
            let ha = HouseArrestClient::connect_rsd(&mut adapter, &mut handshake).await.map_err(err)?;
            let mut afc = ha.vend_container(bundle_id).await.map_err(err)?;
            for d in dirs {
                afc.mk_dir(d.clone()).await.map_err(err)?;
            }
            let mut f = afc.open(path, idevice::afc::opcode::AfcFopenMode::WrOnly).await.map_err(err)?;
            f.write_entire(bytes).await.map_err(err)?;
            f.close().await.map_err(err)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_open_minis_answers() {
        let ok = envelope("t", "noise\n{\"ok\":true,\"data\":{\"id\":\"7\"}}\n").unwrap();
        assert_eq!(ok.get("id").and_then(Value::as_str), Some("7"));
        assert_eq!(envelope("t", r#"{"ok":false,"error":{"code":"x","message":"no"}}"#), Err("t: no".into()));
        assert!(envelope("t", "boom").is_err());
        assert_eq!(spaced("482913"), "482 913");
        assert_eq!(service_type(PAIRABLE_HOST_SERVICE_TYPE), "_remotepairing-pairable-host._tcp");
    }
}
