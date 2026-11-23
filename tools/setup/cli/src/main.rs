//! The free route's one-time computer setup (F258). The steps and their words are ../core (tested there); this
//! file is the real USB side (idevice: usbmuxd, lockdown pairing, installation_proxy, house_arrest/AFC, amfi) and
//! the HTTP side (the Worker's /sign/setup/<code> and the upload's app.ipa, worker/src/setup.js).

use std::fs::File;
use std::io::{self, BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use idevice::afc::opcode::AfcFopenMode;
use idevice::amfi::AmfiClient;
use idevice::house_arrest::HouseArrestClient;
use idevice::lockdown::LockdownClient;
use idevice::provider::UsbmuxdProvider;
use idevice::usbmuxd::{Connection, UsbmuxdAddr, UsbmuxdConnection, UsbmuxdDevice};
use idevice::{IdeviceError, IdeviceService};
use ifizbox_setup_core as core;
use ifizbox_setup_core::{DevError, Device, DeviceInfo, Downloaded, Lookup, Net, NetError, PairError, PairingTarget, Ui};
use sha2::{Digest, Sha256};

const NAME: &str = env!("BRAND_NAME");
const DOMAIN: &str = env!("BRAND_DOMAIN");
const VERSION: &str = env!("CARGO_PKG_VERSION");

fn brand() -> core::Brand {
    core::Brand { name: NAME.into(), domain: DOMAIN.into() }
}

// ---- the terminal ----

struct Term {
    last_progress: Option<Instant>,
}

impl Ui for Term {
    fn say(&mut self, line: &str) {
        if self.last_progress.take().is_some() {
            eprintln!();
        }
        println!("{line}");
    }
    fn ask(&mut self, prompt: &str) -> Option<String> {
        print!("{prompt}");
        io::stdout().flush().ok();
        let mut s = String::new();
        // `curl | sh` gives the command the script as stdin: the install scripts run it with </dev/tty
        match io::stdin().lock().read_line(&mut s) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(s.trim().to_string()),
        }
    }
    fn progress(&mut self, label: &str, done: u64, total: u64) {
        let now = Instant::now();
        if matches!(self.last_progress, Some(t) if now - t < Duration::from_millis(200)) && done < total {
            return;
        }
        self.last_progress = Some(now);
        if total > 0 {
            eprint!("\r{label}: {:3}%", done * 100 / total);
        } else {
            eprint!("\r{label}: {:.1} MB", done as f64 / 1e6);
        }
        io::stderr().flush().ok();
    }
}

// ---- HTTP ----

struct Http {
    agent: ureq::Agent,
    keep_ipa: bool,
}

impl Http {
    fn new(keep_ipa: bool) -> Self {
        let agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(20)))
            .user_agent(format!("{}-setup/{VERSION}", NAME.to_lowercase()))
            .build()
            .new_agent();
        Http { agent, keep_ipa }
    }
}

fn str_of(v: &serde_json::Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

pub fn parse_lookup(v: &serde_json::Value) -> Result<Lookup, String> {
    let size = v.get("size").and_then(|x| x.as_u64()).ok_or("no size in the server's answer")?;
    let pairing = match v.get("pairing") {
        Some(p) if p.is_object() => Some(PairingTarget { bundle_id: str_of(p, "bundleId"), path: str_of(p, "path") }),
        _ => None,
    };
    Ok(Lookup {
        ipa: str_of(v, "ipa"),
        size,
        sha256: v.get("sha256").and_then(|x| x.as_str()).map(|s| s.to_string()),
        bundle_id: str_of(v, "bundleId"),
        name: str_of(v, "name"),
        version: str_of(v, "version"),
        pairing,
        expires_in: v.get("expiresIn").and_then(|x| x.as_u64()).unwrap_or(0),
    })
}

impl Net for Http {
    fn lookup(&mut self, server: &str, code: &str) -> Result<Lookup, NetError> {
        let url = format!("{server}/sign/setup/{code}");
        let mut r = self.agent.get(&url).call().map_err(|e| NetError::Other(e.to_string()))?;
        let status = r.status().as_u16();
        let body = r.body_mut().read_to_string().map_err(|e| NetError::Other(e.to_string()))?;
        let v: serde_json::Value = serde_json::from_str(&body).map_err(|_| NetError::Other(format!("HTTP {status}, not JSON")))?;
        match (status, v.get("code").and_then(|c| c.as_str())) {
            (200, _) => parse_lookup(&v).map_err(NetError::Other),
            (_, Some("gone")) => Err(NetError::Gone(str_of(&v, "error"))),
            (_, Some("bad_code")) => Err(NetError::BadCode(str_of(&v, "error"))),
            _ => Err(NetError::Other(format!("HTTP {status}: {}", str_of(&v, "error")))),
        }
    }

    fn discard(&mut self, path: &Path) {
        let _ = std::fs::remove_file(path);
    }

    fn download(&mut self, l: &Lookup, ui: &mut dyn Ui) -> Result<Downloaded, String> {
        let path = if self.keep_ipa {
            PathBuf::from(format!("{}.ipa", l.name.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', "_")))
        } else {
            std::env::temp_dir().join(format!("{}-setup-{}.ipa", NAME.to_lowercase(), std::process::id()))
        };
        let mut r = self.agent.get(&l.ipa).call().map_err(|e| e.to_string())?;
        if r.status() != 200 {
            return Err(format!("HTTP {} (the code may have just expired: make a new one)", r.status().as_u16()));
        }
        let mut body = r.body_mut().with_config().limit(l.size + 1).reader();
        let mut out = File::create(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let (mut n, mut h, mut buf) = (0u64, Sha256::new(), vec![0u8; 1 << 16]);
        loop {
            let k = body.read(&mut buf).map_err(|e| e.to_string())?;
            if k == 0 {
                break;
            }
            out.write_all(&buf[..k]).map_err(|e| e.to_string())?;
            h.update(&buf[..k]);
            n += k as u64;
            ui.progress("Downloading", n, l.size);
        }
        out.flush().map_err(|e| e.to_string())?;
        let sha256 = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
        Ok(Downloaded { path, size: n, sha256 })
    }
}

// ---- USB (idevice) ----

struct Usb {
    rt: tokio::runtime::Runtime,
    addr: UsbmuxdAddr,
    dev: Option<UsbmuxdDevice>,
    provider: Option<UsbmuxdProvider>,
}

fn label() -> String {
    format!("{}-setup", NAME.to_lowercase())
}

fn err(e: IdeviceError) -> String {
    format!("{e}")
}

impl Usb {
    fn new() -> Self {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("tokio runtime");
        let addr = UsbmuxdAddr::from_env_var().unwrap_or_default();
        Usb { rt, addr, dev: None, provider: None }
    }
    fn provider(&self) -> &UsbmuxdProvider {
        self.provider.as_ref().expect("find() first")
    }
    async fn mux(&self) -> Result<UsbmuxdConnection, IdeviceError> {
        self.addr.connect(1).await
    }
    async fn info(&self, d: &UsbmuxdDevice) -> DeviceInfo {
        let p = d.to_provider(self.addr.clone(), label());
        let (mut name, mut ios) = (String::from("iPhone"), String::from("?"));
        if let Ok(mut l) = LockdownClient::connect(&p).await {
            if let Ok(v) = l.get_value(Some("DeviceName"), None).await {
                name = v.as_string().unwrap_or("iPhone").to_string();
            }
            if let Ok(v) = l.get_value(Some("ProductVersion"), None).await {
                ios = v.as_string().unwrap_or("?").to_string();
            }
        }
        DeviceInfo { udid: d.udid.clone(), name, ios }
    }
}

impl Device for Usb {
    fn find(&mut self, udid: Option<&str>, wait_secs: u64, ui: &mut dyn Ui) -> Result<DeviceInfo, DevError> {
        let deadline = Instant::now() + Duration::from_secs(wait_secs);
        let mut told = false;
        let found = self.rt.block_on(async {
            loop {
                // Linux's usbmuxd is often started by udev only once an iPhone is plugged in: keep waiting for it
                let mut mux = match self.mux().await {
                    Ok(m) => m,
                    Err(_) if cfg!(target_os = "linux") && Instant::now() < deadline => {
                        if !told {
                            ui.say("Plug the iPhone into this computer with a cable and unlock it…");
                            told = true;
                        }
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                    Err(e) => return Err(DevError::NoService(err(e))),
                };
                let all: Vec<UsbmuxdDevice> = mux
                    .get_devices()
                    .await
                    .map_err(|e| DevError::Other(err(e)))?
                    .into_iter()
                    .filter(|d| d.connection_type == Connection::Usb)
                    .collect();
                match udid {
                    Some(u) => {
                        if let Some(d) = all.into_iter().find(|d| d.udid.eq_ignore_ascii_case(u)) {
                            return Ok(d);
                        }
                    }
                    None if all.len() == 1 => return Ok(all.into_iter().next().unwrap()),
                    None if all.len() > 1 => {
                        let mut infos = vec![];
                        for d in &all {
                            infos.push(self.info(d).await);
                        }
                        return Err(DevError::Several(infos));
                    }
                    None => {}
                }
                if Instant::now() >= deadline {
                    return Err(match udid {
                        Some(u) => DevError::NotFound(u.to_string()),
                        None => DevError::NoDevice,
                    });
                }
                if !told {
                    ui.say("Plug the iPhone into this computer with a cable and unlock it…");
                    told = true;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        })?;
        let info = self.rt.block_on(self.info(&found));
        self.provider = Some(found.to_provider(self.addr.clone(), label()));
        self.dev = Some(found);
        Ok(info)
    }

    fn pairing(&mut self, ui: &mut dyn Ui) -> Result<Vec<u8>, PairError> {
        let dev = self.dev.clone().expect("find() first");
        let p = self.provider().clone();
        self.rt.block_on(async {
            let mut mux = self.mux().await.map_err(|e| PairError::Other(err(e)))?;
            // Already trusted: usbmuxd keeps the record, and a session with it works.
            if let Ok(rec) = mux.get_pair_record(&dev.udid).await {
                let mut l = LockdownClient::connect(&p).await.map_err(|e| PairError::Other(err(e)))?;
                if l.start_session(&rec).await.is_ok() {
                    let mut rec = rec;
                    rec.udid = Some(dev.udid.clone());
                    return rec.serialize().map_err(|e| PairError::Other(err(e)));
                }
            }
            // Pair: the iPhone asks "Trust This Computer?" and for its passcode.
            let buid = mux.get_buid().await.map_err(|e| PairError::Other(err(e)))?;
            let host_id = uuid::Uuid::new_v4().to_string().to_uppercase();
            let host_name = format!("{NAME} setup");
            let mut asked = false;
            let deadline = Instant::now() + Duration::from_secs(180);
            let mut rec = loop {
                let mut l = LockdownClient::connect(&p).await.map_err(|e| PairError::Other(err(e)))?;
                match l.pair_once(host_id.clone(), buid.clone(), Some(&host_name)).await {
                    Ok(r) => break r,
                    Err(IdeviceError::PairingDialogResponsePending) => {
                        if !asked {
                            ui.say("On the iPhone: tap Trust, then enter its passcode.");
                            asked = true;
                        }
                    }
                    Err(IdeviceError::PasswordProtected) => {
                        if !asked {
                            ui.say("Unlock the iPhone, then tap Trust when it asks.");
                            asked = true;
                        }
                    }
                    Err(IdeviceError::UserDeniedPairing) => return Err(PairError::Denied),
                    Err(e) => return Err(PairError::Other(err(e))),
                }
                if Instant::now() >= deadline {
                    return Err(PairError::Locked);
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            };
            rec.udid = Some(dev.udid.clone());
            let mut l = LockdownClient::connect(&p).await.map_err(|e| PairError::Other(err(e)))?;
            l.start_session(&rec).await.map_err(|e| PairError::Other(format!("the new pairing didn't work: {e}")))?;
            // Lockdown over the network (what the app does through its built-in VPN) only answers when this is on.
            let _ = l.set_value("EnableWifiConnections", true.into(), Some("com.apple.mobile.wireless_lockdown")).await;
            let bytes = rec.serialize().map_err(|e| PairError::Other(err(e)))?;
            // usbmuxd keeps it, so the services below (and the next run) use it
            mux.save_pair_record(&dev.udid, bytes.clone()).await.map_err(|e| PairError::Other(format!("usbmuxd didn't keep the pairing: {e}")))?;
            ui.say("This computer is trusted.");
            Ok(bytes)
        })
    }

    fn trusted(&mut self) -> bool {
        let dev = self.dev.clone().expect("find() first");
        let p = self.provider().clone();
        self.rt.block_on(async {
            let Ok(mut mux) = self.mux().await else { return false };
            let Ok(rec) = mux.get_pair_record(&dev.udid).await else { return false };
            let Ok(mut l) = LockdownClient::connect(&p).await else { return false };
            l.start_session(&rec).await.is_ok()
        })
    }

    fn install(&mut self, ipa: &Path, ui: &mut dyn Ui) -> Result<(), String> {
        let p = self.provider().clone();
        let ui = std::cell::RefCell::new(ui);
        let r = self.rt.block_on(idevice::utils::installation::install_package_with_callback(
            &p,
            ipa,
            None,
            |(pct, _): (u64, ())| {
                ui.borrow_mut().progress("Installing", pct, 100);
                async {}
            },
            (),
        ));
        r.map_err(err)
    }

    fn write_file(&mut self, bundle_id: &str, dirs: &[String], path: &str, bytes: &[u8]) -> Result<(), String> {
        let p = self.provider().clone();
        self.rt.block_on(async {
            let ha = HouseArrestClient::connect(&p).await.map_err(err)?;
            let mut afc = ha.vend_container(bundle_id).await.map_err(|e| format!("{bundle_id}'s container: {e}"))?;
            for d in dirs {
                afc.mk_dir(d.clone()).await.map_err(|e| format!("mkdir {d}: {e}"))?;
            }
            let mut f = afc.open(path, AfcFopenMode::WrOnly).await.map_err(|e| format!("{path}: {e}"))?;
            f.write_entire(bytes).await.map_err(|e| format!("{path}: {e}"))?;
            f.close().await.map_err(err)?;
            Ok(())
        })
    }

    fn developer_mode(&mut self) -> Option<bool> {
        let p = self.provider().clone();
        self.rt.block_on(async {
            let mut a = AmfiClient::connect(&p).await.ok()?;
            a.get_developer_mode_status().await.ok()
        })
    }

    fn reveal_developer_mode(&mut self) -> Result<(), String> {
        let p = self.provider().clone();
        self.rt.block_on(async {
            let mut a = AmfiClient::connect(&p).await.map_err(err)?;
            a.reveal_developer_mode_option_in_ui().await.map_err(err)
        })
    }
}

/// Ends a run: a pending progress line closed, the failure on stderr, its exit code.
fn finish(ui: &mut Term, r: Result<(), core::Failure>) {
    if ui.last_progress.take().is_some() {
        eprintln!();
    }
    if let Err(f) = r {
        eprintln!("{f}");
        std::process::exit(f.exit);
    }
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let bin = std::env::args().next().map(|a| Path::new(&a).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or(a))
        .unwrap_or_else(|| format!("{}-setup", NAME.to_lowercase()));
    let b = brand();
    let mut ui = Term { last_progress: None };
    match core::parse_args(&argv, &b) {
        Ok(core::Cmd::Help) => print!("{}", core::usage(&b, &bin)),
        Ok(core::Cmd::Version) => println!("{bin} {VERSION}"),
        Ok(core::Cmd::Check(a)) => {
            let r = core::check(&a, core::Os::this(), &mut ui, &mut Usb::new());
            finish(&mut ui, r);
        }
        Ok(core::Cmd::Download(a)) => {
            let r = core::download_only(&a, &b, &mut ui, &mut Http::new(true));
            finish(&mut ui, r);
        }
        Ok(core::Cmd::Run(a)) => {
            let r = core::run(&a, &b, core::Os::this(), &mut ui, &mut Http::new(a.keep_ipa), &mut Usb::new());
            if !a.keep_ipa {
                let _ = std::fs::remove_file(std::env::temp_dir().join(format!("{}-setup-{}.ipa", NAME.to_lowercase(), std::process::id())));
            }
            finish(&mut ui, r);
        }
        Err(e) => {
            eprintln!("{bin}: {e}");
            std::process::exit(core::EXIT_USAGE);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_from_json() {
        let v: serde_json::Value = serde_json::from_str(r#"{"ipa":"https://x/sign/up/t/app.ipa","size":6,"sha256":null,
            "bundleId":"com.a.b","name":"A","version":"1","pairing":{"bundleId":"com.a.b","path":"Documents/p.plist"},"expiresIn":5}"#).unwrap();
        let l = parse_lookup(&v).unwrap();
        assert_eq!(l.size, 6);
        assert_eq!(l.sha256, None);
        assert_eq!(l.pairing, Some(PairingTarget { bundle_id: "com.a.b".into(), path: "Documents/p.plist".into() }));
        let v: serde_json::Value = serde_json::from_str(r#"{"ipa":"x","size":1,"pairing":null}"#).unwrap();
        assert_eq!(parse_lookup(&v).unwrap().pairing, None);
        assert!(parse_lookup(&serde_json::json!({"ipa": "x"})).is_err());
        assert!(!NAME.is_empty() && DOMAIN.contains('.'));
    }
}
