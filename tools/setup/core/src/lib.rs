//! The setup command's logic without a device or a network (F258): arguments, the code a person types, what the
//! Worker answers for it (worker/src/setup.js), and the order of the steps. The real USB and HTTP sides are in
//! ../cli; tests here drive `run` with fakes.
//!
//! Steps: find the iPhone over USB → make sure this computer is trusted (pair, "Trust This Computer") → ask for the
//! code the website shows → read what it points at → download the signed IPA (size and SHA-256 checked) → install
//! it (installation_proxy) → before iOS 27, write the pairing file into the app's container (house_arrest) and say
//! where to pick it → say what's left on the phone (Developer Mode). It never asks for an Apple ID.

use std::fmt;
use std::path::{Path, PathBuf};

/// The product's name and domain: from native/brand.env, put in by ../cli/build.rs, never spelled here.
#[derive(Clone, Debug)]
pub struct Brand {
    pub name: String,
    pub domain: String,
}

pub const CODE_LEN: usize = 8;
/// The Worker's alphabet (worker/src/setup.js SETUP_ALPHABET): no 0/O, 1/I/L.
pub const CODE_ALPHABET: &str = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/// How many codes a person may type before the command gives up.
pub const CODE_TRIES: usize = 3;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Args {
    pub code: Option<String>,
    pub server: String,
    pub udid: Option<String>,
    pub keep_ipa: bool,
    /// Wait this long for an iPhone to show up over USB.
    pub wait_secs: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Cmd {
    Run(Args),
    /// --check: find the iPhone and say whether this computer is trusted and Developer Mode is on; changes nothing.
    Check(Args),
    /// --download-only: the code's signed IPA into the current folder (checked), no iPhone needed.
    Download(Args),
    Help,
    Version,
}

pub fn usage(brand: &Brand, bin: &str) -> String {
    format!(
        "{name} computer setup: installs the app {name}'s website signed for your iPhone, over USB.\n\
         \n\
         Usage: {bin} [CODE] [options]\n\
         \n\
         CODE              the code {domain} shows on the iPhone after it signs the app (asked for when left out)\n\
         --udid UDID       the iPhone to use when more than one is plugged in\n\
         --server URL      another {name} server (default https://{domain})\n\
         --wait SECONDS    how long to wait for the iPhone to be plugged in (default 120)\n\
         --keep-ipa        keep the downloaded IPA in the current folder\n\
         --check           only look: is the iPhone there, does it trust this computer, is Developer Mode on\n\
         --download-only   only download the signed IPA into the current folder (for installing it another way)\n\
         -h, --help        this help\n\
         --version         the command's version\n\
         \n\
         It never asks for your Apple ID: you sign in on {domain} on the iPhone.\n",
        name = brand.name,
        domain = brand.domain,
        bin = bin
    )
}

/// The command line (without the program name).
pub fn parse_args(argv: &[String], brand: &Brand) -> Result<Cmd, String> {
    let mut a = Args {
        code: None,
        server: format!("https://{}", brand.domain),
        udid: None,
        keep_ipa: false,
        wait_secs: 120,
    };
    let (mut check, mut download) = (false, false);
    let mut it = argv.iter();
    while let Some(arg) = it.next() {
        let (flag, inline) = match arg.split_once('=') {
            Some((f, v)) if f.starts_with("--") => (f, Some(v.to_string())),
            _ => (arg.as_str(), None),
        };
        let mut value = |name: &str| -> Result<String, String> {
            match inline.clone().or_else(|| it.next().cloned()) {
                Some(v) if !v.is_empty() => Ok(v),
                _ => Err(format!("{name} needs a value")),
            }
        };
        match flag {
            "-h" | "--help" => return Ok(Cmd::Help),
            "--version" | "-V" => return Ok(Cmd::Version),
            "--keep-ipa" => a.keep_ipa = true,
            "--check" => check = true,
            "--download-only" => download = true,
            "--udid" => a.udid = Some(value("--udid")?),
            "--server" => {
                let s = value("--server")?;
                a.server = server_url(&s).ok_or_else(|| format!("--server: {s} isn't an http(s) address"))?;
            }
            "--wait" => {
                let s = value("--wait")?;
                a.wait_secs = s.parse().map_err(|_| format!("--wait: {s} isn't a number of seconds"))?;
            }
            f if f.starts_with('-') && f.len() > 1 => return Err(format!("unknown option {f} (see --help)")),
            _ => {
                if a.code.is_some() {
                    return Err(format!("one code only (got another: {arg})"));
                }
                a.code = Some(arg.clone());
            }
        }
    }
    if check && download {
        return Err("--check and --download-only don't go together".into());
    }
    if download {
        a.keep_ipa = true;
        return Ok(Cmd::Download(a));
    }
    Ok(if check { Cmd::Check(a) } else { Cmd::Run(a) })
}

/// `https://host[:port]` (or http for a test server on this computer), without a trailing slash.
pub fn server_url(s: &str) -> Option<String> {
    let s = s.trim().trim_end_matches('/');
    let rest = s.strip_prefix("https://").or_else(|| {
        let r = s.strip_prefix("http://")?;
        let host = r.split(['/', ':']).next().unwrap_or("");
        matches!(host, "localhost" | "127.0.0.1" | "[::1]").then_some(r)
    })?;
    if rest.is_empty() || rest.contains(['?', '#', '@', ' ']) || rest.contains('/') {
        return None;
    }
    Some(s.to_string())
}

/// What a person typed, as the code: case, spaces and dashes don't matter.
pub fn normal_code(raw: &str) -> Option<String> {
    let s: String = raw.chars().filter(|c| !c.is_whitespace() && *c != '-').collect::<String>().to_uppercase();
    (s.chars().count() == CODE_LEN && s.chars().all(|c| CODE_ALPHABET.contains(c))).then_some(s)
}

pub fn show_code(c: &str) -> String {
    format!("{}-{}", &c[..4], &c[4..])
}

/// What GET /sign/setup/<code> answers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lookup {
    pub ipa: String,
    pub size: u64,
    pub sha256: Option<String>,
    pub bundle_id: String,
    pub name: String,
    pub version: String,
    pub pairing: Option<PairingTarget>,
    pub expires_in: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PairingTarget {
    pub bundle_id: String,
    pub path: String,
}

/// A path inside an app's container: relative, no "..", no empty parts (the Worker checks the same).
pub fn container_path(p: &str) -> Option<&str> {
    if p.is_empty() || p.len() > 255 || p.starts_with('/') || p.chars().any(|c| c.is_control() || c == '\\') {
        return None;
    }
    p.split('/').all(|x| !x.is_empty() && x != "." && x != "..").then_some(p)
}

/// The folders to make before writing `path`: "Documents/a/b.plist" → ["Documents", "Documents/a"].
pub fn parent_dirs(path: &str) -> Vec<String> {
    let parts: Vec<&str> = path.split('/').collect();
    (1..parts.len()).map(|n| parts[..n].join("/")).collect()
}

fn bundle_ok(b: &str) -> bool {
    !b.is_empty() && b.len() <= 255 && b.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// The Worker's answer is trusted only this far: the IPA comes from the same server, the IDs and path are sane.
pub fn check_lookup(l: &Lookup, server: &str) -> Result<(), String> {
    if !l.ipa.starts_with(&format!("{server}/sign/up/")) {
        return Err(format!("the server pointed at an IPA elsewhere ({})", l.ipa));
    }
    if l.size == 0 {
        return Err("the server says the app is empty".into());
    }
    if let Some(h) = &l.sha256 {
        if h.len() != 64 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("the server sent a bad SHA-256".into());
        }
    }
    if !bundle_ok(&l.bundle_id) {
        return Err(format!("the server sent a bad bundle ID ({})", l.bundle_id));
    }
    if let Some(p) = &l.pairing {
        if !bundle_ok(&p.bundle_id) || container_path(&p.path).is_none() {
            return Err(format!("the server sent a bad place for the pairing file ({}: {})", p.bundle_id, p.path));
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Mac,
    Linux,
    Windows,
}

impl Os {
    pub fn this() -> Os {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

/// What to do when the computer's iPhone service (usbmuxd) isn't there.
pub fn no_service_hint(os: Os) -> &'static str {
    match os {
        Os::Windows => "Windows talks to an iPhone through Apple's device driver. Install the Apple Devices app from the \
                        Microsoft Store (or iTunes from apple.com/itunes on older Windows), open it once with the \
                        iPhone plugged in, then run this again.",
        Os::Mac => "macOS's usbmuxd isn't answering. Unplug the iPhone, plug it back in and run this again; if it keeps \
                    happening, restart the Mac.",
        Os::Linux => "Linux talks to an iPhone through usbmuxd. Install it (Debian/Ubuntu: sudo apt install usbmuxd; \
                      Fedora: sudo dnf install usbmuxd; Arch: sudo pacman -S usbmuxd), plug the iPhone in, then run \
                      this again.",
    }
}

/// "17.4.1" → 17.
pub fn ios_major(v: &str) -> Option<u32> {
    v.split('.').next()?.trim().parse().ok()
}

/// The first iOS where the app pairs on the iPhone itself and takes no pairing file
/// (native/sideload/idevice/IDeviceBridge.swift pairOnPhone).
pub const PAIRS_ON_PHONE: u32 = 27;

/// The app never reads the file by itself: where to pick it. `path` is in the app's container, and the Files app shows
/// its Documents folder as On My iPhone > the app.
fn import_hint(app: &str, path: &str) -> String {
    let file = path.strip_prefix("Documents/").unwrap_or(path);
    format!(
        "Put a pairing file in {app}, which {app} doesn't read by itself. To install apps on the iPhone, open {app} and go \
         to Settings > Installation & Signing > This iPhone, tap Pair This iPhone, then Import Pairing File, and pick \
         {file} (On My iPhone > {app})."
    )
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceInfo {
    pub udid: String,
    pub name: String,
    pub ios: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DevError {
    /// usbmuxd (or Apple's driver on Windows) isn't running.
    NoService(String),
    /// No iPhone showed up over USB in time.
    NoDevice,
    /// More than one, and no --udid.
    Several(Vec<DeviceInfo>),
    /// --udid names one that isn't plugged in.
    NotFound(String),
    Other(String),
}

#[derive(Debug, PartialEq, Eq)]
pub enum PairError {
    /// The person tapped Don't Trust.
    Denied,
    /// The iPhone is locked with a passcode and has never trusted this computer.
    Locked,
    Other(String),
}

#[derive(Debug, PartialEq, Eq)]
pub enum NetError {
    BadCode(String),
    Gone(String),
    Other(String),
}

pub struct Downloaded {
    pub path: PathBuf,
    pub size: u64,
    pub sha256: String,
}

/// What the person sees and types.
pub trait Ui {
    fn say(&mut self, line: &str);
    /// One line typed after `prompt`; None at end of input.
    fn ask(&mut self, prompt: &str) -> Option<String>;
    /// A step's progress; `total` 0 when unknown.
    fn progress(&mut self, label: &str, done: u64, total: u64);
}

pub trait Net {
    fn lookup(&mut self, server: &str, code: &str) -> Result<Lookup, NetError>;
    fn download(&mut self, l: &Lookup, ui: &mut dyn Ui) -> Result<Downloaded, String>;
    /// Delete a download that failed its checks.
    fn discard(&mut self, path: &Path);
}

pub trait Device {
    fn find(&mut self, udid: Option<&str>, wait_secs: u64, ui: &mut dyn Ui) -> Result<DeviceInfo, DevError>;
    /// This computer's pairing with the iPhone, made if needed (the iPhone asks "Trust This Computer?"): a
    /// pairing file (plist bytes) for the app to talk to the iPhone itself.
    fn pairing(&mut self, ui: &mut dyn Ui) -> Result<Vec<u8>, PairError>;
    /// Whether this computer already has a pairing the iPhone takes (no prompt, nothing written).
    fn trusted(&mut self) -> bool;
    fn install(&mut self, ipa: &Path, ui: &mut dyn Ui) -> Result<(), String>;
    /// Make the folders and write `bytes` at `path` in the app's container.
    fn write_file(&mut self, bundle_id: &str, dirs: &[String], path: &str, bytes: &[u8]) -> Result<(), String>;
    /// Developer Mode on (Some(true)), off (Some(false)), or not a thing on this iOS / unknown (None).
    fn developer_mode(&mut self) -> Option<bool>;
    /// Show Developer Mode in Settings (iOS hides it until a developer app is installed or a computer asks).
    fn reveal_developer_mode(&mut self) -> Result<(), String>;
}

/// Why the command stopped, and its exit code.
#[derive(Debug, PartialEq, Eq)]
pub struct Failure {
    pub message: String,
    pub exit: i32,
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(&self.message)
    }
}

fn fail(exit: i32, message: impl Into<String>) -> Failure {
    Failure { message: message.into(), exit }
}

pub const EXIT_USAGE: i32 = 2;
pub const EXIT_DEVICE: i32 = 3;
pub const EXIT_CODE: i32 = 4;
pub const EXIT_DOWNLOAD: i32 = 5;
pub const EXIT_INSTALL: i32 = 6;
pub const EXIT_PAIRING: i32 = 7;

/// The code: the one given on the command line, else asked for; each one read from the server. A bad or expired
/// code asks again, up to CODE_TRIES in all.
fn get_lookup(args: &Args, brand: &Brand, ui: &mut dyn Ui, net: &mut dyn Net) -> Result<Lookup, Failure> {
    let mut given = args.code.clone();
    for n in 0..CODE_TRIES {
        let typed = match given.take() {
            Some(c) => c,
            None => {
                if n == 0 {
                    ui.say(&format!(
                        "On the iPhone, sign in on {} and let it sign the app: it shows a code like ABCD-2345.",
                        brand.domain
                    ));
                }
                match ui.ask("Code: ") {
                    Some(c) => c,
                    None => return Err(fail(EXIT_CODE, "No code typed.")),
                }
            }
        };
        let Some(code) = normal_code(&typed) else {
            ui.say(&format!("\"{}\" isn't a code: it's {CODE_LEN} letters and digits, like ABCD-2345.", typed.trim()));
            continue;
        };
        match net.lookup(&args.server, &code) {
            Ok(l) => {
                check_lookup(&l, &args.server).map_err(|e| fail(EXIT_CODE, format!("Can't use that code: {e}.")))?;
                return Ok(l);
            }
            Err(NetError::BadCode(m)) | Err(NetError::Gone(m)) => ui.say(&format!("{}: {m}", show_code(&code))),
            Err(NetError::Other(m)) => return Err(fail(EXIT_CODE, format!("Couldn't reach {}: {m}", args.server))),
        }
    }
    Err(fail(EXIT_CODE, format!("No working code after {CODE_TRIES} tries. Make a new one on the iPhone and run this again.")))
}

fn find(args: &Args, os: Os, ui: &mut dyn Ui, dev: &mut dyn Device) -> Result<DeviceInfo, Failure> {
    let d = match dev.find(args.udid.as_deref(), args.wait_secs, ui) {
        Ok(d) => d,
        Err(DevError::NoService(m)) => return Err(fail(EXIT_DEVICE, format!("No iPhone service on this computer ({m}).\n{}", no_service_hint(os)))),
        Err(DevError::NoDevice) => {
            return Err(fail(EXIT_DEVICE, format!(
                "No iPhone over USB after {} s. Plug it in with a cable (not just charging: unlock it), then run this again.",
                args.wait_secs
            )))
        }
        Err(DevError::Several(all)) => {
            let list: Vec<String> = all.iter().map(|d| format!("  {}  {} (iOS {})", d.udid, d.name, d.ios)).collect();
            return Err(fail(EXIT_USAGE, format!("More than one iPhone is plugged in; pick one with --udid:\n{}", list.join("\n"))));
        }
        Err(DevError::NotFound(u)) => return Err(fail(EXIT_DEVICE, format!("No iPhone with UDID {u} is plugged in."))),
        Err(DevError::Other(m)) => return Err(fail(EXIT_DEVICE, format!("Couldn't talk to the iPhone: {m}"))),
    };
    ui.say(&format!("Found {} (iOS {}).", d.name, d.ios));
    Ok(d)
}

/// --check: only reads (usbmuxd's device list, lockdown values, a session with a pairing usbmuxd already has, amfi's
/// status). Exit 0 when the iPhone is there and trusted.
pub fn check(args: &Args, os: Os, ui: &mut dyn Ui, dev: &mut dyn Device) -> Result<(), Failure> {
    let d = find(args, os, ui, dev)?;
    let trusted = dev.trusted();
    ui.say(if trusted { "This computer is trusted." } else { "This computer isn't trusted yet: the setup will ask the iPhone to Trust it." });
    if ios_major(&d.ios).unwrap_or(0) >= 16 && trusted {
        ui.say(match dev.developer_mode() {
            Some(true) => "Developer Mode is on.",
            Some(false) => "Developer Mode is off: the setup shows where to turn it on.",
            None => "Developer Mode: couldn't tell.",
        });
    }
    if trusted {
        Ok(())
    } else {
        Err(fail(EXIT_PAIRING, "Not trusted yet."))
    }
}

/// The download, its size and (when the website sent one) SHA-256 checked.
fn fetch_ipa(l: &Lookup, ui: &mut dyn Ui, net: &mut dyn Net) -> Result<Downloaded, Failure> {
    let got = net.download(l, ui).map_err(|e| fail(EXIT_DOWNLOAD, format!("Download failed: {e}")))?;
    let bad = if got.size != l.size {
        Some(format!("Download failed: got {} bytes, the server said {}.", got.size, l.size))
    } else if l.sha256.as_deref().is_some_and(|want| !want.eq_ignore_ascii_case(&got.sha256)) {
        Some("Download failed: the app's SHA-256 doesn't match what the website signed.".to_string())
    } else {
        None
    };
    match bad {
        Some(m) => {
            net.discard(&got.path);
            Err(fail(EXIT_DOWNLOAD, m))
        }
        None => Ok(got),
    }
}

/// --download-only: the code, then the IPA (kept), no iPhone.
pub fn download_only(args: &Args, brand: &Brand, ui: &mut dyn Ui, net: &mut dyn Net) -> Result<(), Failure> {
    let l = get_lookup(args, brand, ui, net)?;
    let got = fetch_ipa(&l, ui, net)?;
    ui.say(&format!("Saved {} {} as {} (SHA-256 {}).", l.name, l.version, got.path.display(), got.sha256));
    Ok(())
}

pub fn run(args: &Args, brand: &Brand, os: Os, ui: &mut dyn Ui, net: &mut dyn Net, dev: &mut dyn Device) -> Result<(), Failure> {
    // 1. the iPhone
    let d = find(args, os, ui, dev)?;

    // 2. trusted: the pairing the app will use
    let pairing = match dev.pairing(ui) {
        Ok(p) => p,
        Err(PairError::Denied) => {
            return Err(fail(EXIT_PAIRING, "The iPhone said Don't Trust. Unplug it, plug it back in, run this again and tap Trust."))
        }
        Err(PairError::Locked) => return Err(fail(EXIT_PAIRING, "Unlock the iPhone (enter its passcode), then run this again.")),
        Err(PairError::Other(m)) => return Err(fail(EXIT_PAIRING, format!("Couldn't pair with the iPhone: {m}"))),
    };

    // 3. the code, and what it points at
    let l = get_lookup(args, brand, ui, net)?;
    ui.say(&format!("Code OK: {} {} ({:.1} MB).", l.name, l.version, l.size as f64 / 1e6));

    // 4. the signed app
    let got = fetch_ipa(&l, ui, net)?;

    // 5. install
    ui.say(&format!("Installing {} on {}…", l.name, d.name));
    dev.install(&got.path, ui).map_err(|e| fail(EXIT_INSTALL, format!("Install failed: {e}")))?;
    ui.say(&format!("Installed {}.", l.name));

    // 6. before iOS 27, the pairing file, for the app to reach the iPhone without a computer. It's a full lockdown
    // credential, and from iOS 27 the app pairs on the iPhone itself, so none is written there.
    let major = ios_major(&d.ios).unwrap_or(0);
    if let Some(p) = l.pairing.as_ref().filter(|_| major < PAIRS_ON_PHONE) {
        dev.write_file(&p.bundle_id, &parent_dirs(&p.path), &p.path, &pairing)
            .map_err(|e| fail(EXIT_PAIRING, format!("Installed, but couldn't put the pairing file in the app: {e}")))?;
        ui.say(&import_hint(&l.name, &p.path));
    }

    // 7. what's left on the phone
    if major >= 16 && dev.developer_mode() == Some(false) {
        let _ = dev.reveal_developer_mode();
        ui.say("Turn on Developer Mode: Settings > Privacy & Security > Developer Mode, then restart the iPhone and tap Turn On.");
    }
    ui.say(&format!(
        "Done. Unplug the iPhone and open {}. If iOS says \"Untrusted Developer\": Settings > General > VPN & Device \
         Management, tap your Apple ID, Trust.",
        l.name
    ));
    Ok(())
}

#[cfg(test)]
mod tests;
