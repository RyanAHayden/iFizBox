use super::*;
use std::collections::VecDeque;

fn brand() -> Brand {
    Brand { name: "Boxy".into(), domain: "boxy.example".into() }
}

fn argv(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}

fn run_args(a: &[&str]) -> Args {
    match parse_args(&argv(a), &brand()).unwrap() {
        Cmd::Run(a) => a,
        c => panic!("{c:?}"),
    }
}

#[test]
fn args() {
    let a = run_args(&[]);
    assert_eq!(a, Args { code: None, server: "https://boxy.example".into(), udid: None, keep_ipa: false, wait_secs: 120 });
    let a = run_args(&["abcd-2345", "--udid", "00008030-X", "--keep-ipa", "--wait=5"]);
    assert_eq!(a.code.as_deref(), Some("abcd-2345"));
    assert_eq!(a.udid.as_deref(), Some("00008030-X"));
    assert!(a.keep_ipa);
    assert_eq!(a.wait_secs, 5);
    assert_eq!(run_args(&["--server", "https://preview.boxy.example/"]).server, "https://preview.boxy.example");
    assert_eq!(run_args(&["--server=http://127.0.0.1:8787"]).server, "http://127.0.0.1:8787");
    assert_eq!(parse_args(&argv(&["x", "-h"]), &brand()), Ok(Cmd::Help));
    assert_eq!(parse_args(&argv(&["--version"]), &brand()), Ok(Cmd::Version));
    for bad in [&["--udid"][..], &["--server", "http://evil.example"], &["--server", "https://a/b"], &["--wait", "x"],
        &["--nope"], &["A", "B"], &["--udid="]] {
        assert!(parse_args(&argv(bad), &brand()).is_err(), "{bad:?}");
    }
    let u = usage(&brand(), "boxy-setup");
    assert!(u.contains("Usage: boxy-setup [CODE]") && u.contains("never asks for your Apple ID"));
}

#[test]
fn codes() {
    assert_eq!(normal_code(" abcd-2345\n").as_deref(), Some("ABCD2345"));
    assert_eq!(normal_code("ABCD 2345").as_deref(), Some("ABCD2345"));
    assert_eq!(normal_code("ABCD-234"), None);
    assert_eq!(normal_code("ABCD-23O5"), None); // O isn't used
    assert_eq!(normal_code("ABCD-2345-6"), None);
    assert_eq!(normal_code("ÄBCD2345"), None);
    assert_eq!(show_code("ABCD2345"), "ABCD-2345");
    assert_eq!(CODE_ALPHABET.len(), 31);
}

#[test]
fn paths_and_versions() {
    assert_eq!(container_path("Documents/pairingFile.plist"), Some("Documents/pairingFile.plist"));
    for bad in ["", "/etc/x", "a/../b", "a//b", "./a", "a\\b", "a\nb"] {
        assert_eq!(container_path(bad), None, "{bad:?}");
    }
    assert_eq!(parent_dirs("Documents/a/b.plist"), vec!["Documents", "Documents/a"]);
    assert!(parent_dirs("p.plist").is_empty());
    assert_eq!(ios_major("17.4.1"), Some(17));
    assert_eq!(ios_major("27.0"), Some(27));
    assert_eq!(ios_major("x"), None);
    assert!(no_service_hint(Os::Windows).contains("Apple Devices app"));
    assert!(no_service_hint(Os::Linux).contains("usbmuxd"));
}

fn lookup() -> Lookup {
    Lookup {
        ipa: format!("https://boxy.example/sign/up/{}/app.ipa", "c".repeat(48)),
        size: 6,
        sha256: Some("ab".repeat(32)),
        bundle_id: "com.kdt.livecontainer.TEAM".into(),
        name: "LiveContainer".into(),
        version: "3.4".into(),
        pairing: Some(PairingTarget { bundle_id: "com.kdt.livecontainer.TEAM".into(), path: "Documents/pairingFile.plist".into() }),
        expires_in: 500,
    }
}

#[test]
fn lookup_checks() {
    let s = "https://boxy.example";
    assert_eq!(check_lookup(&lookup(), s), Ok(()));
    let mut l = lookup();
    l.ipa = "https://evil.example/sign/up/x/app.ipa".into();
    assert!(check_lookup(&l, s).is_err());
    let mut l = lookup();
    l.size = 0;
    assert!(check_lookup(&l, s).is_err());
    let mut l = lookup();
    l.sha256 = Some("zz".into());
    assert!(check_lookup(&l, s).is_err());
    let mut l = lookup();
    l.bundle_id = "a/b".into();
    assert!(check_lookup(&l, s).is_err());
    let mut l = lookup();
    l.pairing.as_mut().unwrap().path = "../../x".into();
    assert!(check_lookup(&l, s).is_err());
    let mut l = lookup();
    l.pairing = None;
    l.sha256 = None;
    assert_eq!(check_lookup(&l, s), Ok(()));
}

// ---- run() with fakes ----

#[derive(Default)]
struct FakeUi {
    typed: VecDeque<String>,
    said: Vec<String>,
    asked: usize,
}
impl Ui for FakeUi {
    fn say(&mut self, line: &str) {
        self.said.push(line.to_string());
    }
    fn ask(&mut self, _prompt: &str) -> Option<String> {
        self.asked += 1;
        self.typed.pop_front()
    }
    fn progress(&mut self, _: &str, _: u64, _: u64) {}
}
impl FakeUi {
    fn typing(lines: &[&str]) -> Self {
        FakeUi { typed: lines.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }
    fn all(&self) -> String {
        self.said.join("\n")
    }
}

struct FakeNet {
    answers: VecDeque<Result<Lookup, NetError>>,
    looked: Vec<String>,
    got: Option<Result<Downloaded, String>>,
    log: Vec<String>,
}
impl FakeNet {
    fn ok() -> Self {
        FakeNet {
            answers: VecDeque::from([Ok(lookup())]),
            looked: vec![],
            got: Some(Ok(Downloaded { path: "/tmp/x.ipa".into(), size: 6, sha256: "AB".repeat(32) })),
            log: vec![],
        }
    }
}
impl Net for FakeNet {
    fn lookup(&mut self, server: &str, code: &str) -> Result<Lookup, NetError> {
        assert_eq!(server, "https://boxy.example");
        self.looked.push(code.to_string());
        self.answers.pop_front().unwrap_or(Err(NetError::Gone("no more".into())))
    }
    fn discard(&mut self, path: &Path) {
        self.log.push(format!("discard {}", path.display()));
    }
    fn download(&mut self, l: &Lookup, _ui: &mut dyn Ui) -> Result<Downloaded, String> {
        self.log.push(format!("download {}", l.ipa));
        self.got.take().unwrap()
    }
}

struct FakeDev {
    found: Option<Result<DeviceInfo, DevError>>,
    paired: Option<Result<Vec<u8>, PairError>>,
    install: Result<(), String>,
    write: Result<(), String>,
    dev_mode: Option<bool>,
    log: Vec<String>,
}
impl FakeDev {
    fn ok(ios: &str) -> Self {
        FakeDev {
            found: Some(Ok(DeviceInfo { udid: "U1".into(), name: "Phone".into(), ios: ios.into() })),
            paired: Some(Ok(b"<plist/>".to_vec())),
            install: Ok(()),
            write: Ok(()),
            dev_mode: Some(true),
            log: vec![],
        }
    }
}
impl Device for FakeDev {
    fn find(&mut self, udid: Option<&str>, wait: u64, _ui: &mut dyn Ui) -> Result<DeviceInfo, DevError> {
        self.log.push(format!("find {udid:?} {wait}"));
        self.found.take().unwrap()
    }
    fn pairing(&mut self, _ui: &mut dyn Ui) -> Result<Vec<u8>, PairError> {
        self.log.push("pair".into());
        self.paired.take().unwrap()
    }
    fn install(&mut self, ipa: &Path, _ui: &mut dyn Ui) -> Result<(), String> {
        self.log.push(format!("install {}", ipa.display()));
        self.install.clone()
    }
    fn write_file(&mut self, b: &str, dirs: &[String], p: &str, bytes: &[u8]) -> Result<(), String> {
        self.log.push(format!("write {b} {dirs:?} {p} {}", String::from_utf8_lossy(bytes)));
        self.write.clone()
    }
    fn trusted(&mut self) -> bool {
        self.log.push("trusted?".into());
        matches!(self.paired, Some(Ok(_)))
    }
    fn developer_mode(&mut self) -> Option<bool> {
        self.log.push("devmode?".into());
        self.dev_mode
    }
    fn reveal_developer_mode(&mut self) -> Result<(), String> {
        self.log.push("reveal".into());
        Ok(())
    }
}

fn go(a: &[&str], ui: &mut FakeUi, net: &mut FakeNet, dev: &mut FakeDev) -> Result<(), Failure> {
    run(&run_args(a), &brand(), Os::Linux, ui, net, dev)
}

#[test]
fn whole_run_in_order() {
    let (mut ui, mut net, mut dev) = (FakeUi::typing(&["abcd 2345"]), FakeNet::ok(), FakeDev::ok("17.4"));
    go(&[], &mut ui, &mut net, &mut dev).unwrap();
    assert_eq!(net.looked, vec!["ABCD2345"]);
    assert_eq!(dev.log, vec![
        "find None 120".to_string(),
        "pair".into(),
        "install /tmp/x.ipa".into(),
        "write com.kdt.livecontainer.TEAM [\"Documents\"] Documents/pairingFile.plist <plist/>".into(),
        "devmode?".into(),
    ]);
    assert_eq!(ui.asked, 1);
    let all = ui.all();
    assert!(all.contains("sign in on boxy.example"), "{all}");
    assert!(all.contains("Installed LiveContainer."));
    assert!(all.contains("Put a pairing file in LiveContainer"), "{all}");
    assert!(!all.contains("Developer Mode")); // already on
    assert!(!all.to_lowercase().contains("password"));
}

#[test]
fn code_on_the_command_line_isnt_asked() {
    let (mut ui, mut net, mut dev) = (FakeUi::default(), FakeNet::ok(), FakeDev::ok("15.8"));
    go(&["ABCD-2345", "--udid", "U1", "--wait", "9"], &mut ui, &mut net, &mut dev).unwrap();
    assert_eq!(ui.asked, 0);
    assert_eq!(dev.log[0], "find Some(\"U1\") 9");
    assert!(!dev.log.contains(&"devmode?".to_string())); // iOS 15 has no Developer Mode
}

#[test]
fn bad_and_expired_codes_ask_again() {
    let mut net = FakeNet::ok();
    net.answers = VecDeque::from([Err(NetError::Gone("That code has expired".into())), Ok(lookup())]);
    let (mut ui, mut dev) = (FakeUi::typing(&["nope", "ZZZZ-ZZZZ", "ABCD-2345"]), FakeDev::ok("17.0"));
    go(&[], &mut ui, &mut net, &mut dev).unwrap();
    assert_eq!(net.looked, vec!["ZZZZZZZZ", "ABCD2345"]); // "nope" never reached the server
    assert!(ui.all().contains("\"nope\" isn't a code"));
    assert!(ui.all().contains("ZZZZ-ZZZZ: That code has expired"));
}

#[test]
fn gives_up_after_three_codes() {
    let mut net = FakeNet::ok();
    net.answers = VecDeque::new();
    let (mut ui, mut dev) = (FakeUi::typing(&["x", "y", "z", "ABCD-2345"]), FakeDev::ok("17.0"));
    let e = go(&[], &mut ui, &mut net, &mut dev).unwrap_err();
    assert_eq!(e.exit, EXIT_CODE);
    assert!(net.looked.is_empty());
    assert!(!dev.log.iter().any(|l| l.starts_with("install")));
    // end of input
    let (mut ui, mut net, mut dev) = (FakeUi::default(), FakeNet::ok(), FakeDev::ok("17.0"));
    assert_eq!(go(&[], &mut ui, &mut net, &mut dev).unwrap_err().message, "No code typed.");
    // the server can't be reached: no retry
    let mut net = FakeNet::ok();
    net.answers = VecDeque::from([Err(NetError::Other("timed out".into()))]);
    let (mut ui, mut dev) = (FakeUi::typing(&["ABCD-2345", "ABCD-2345"]), FakeDev::ok("17.0"));
    let e = go(&[], &mut ui, &mut net, &mut dev).unwrap_err();
    assert!(e.message.contains("Couldn't reach https://boxy.example: timed out"), "{}", e.message);
    assert_eq!(ui.asked, 1);
}

#[test]
fn a_lookup_pointing_elsewhere_is_refused() {
    let mut net = FakeNet::ok();
    let mut l = lookup();
    l.ipa = "https://evil.example/sign/up/x/app.ipa".into();
    net.answers = VecDeque::from([Ok(l)]);
    let (mut ui, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeDev::ok("17.0"));
    let e = go(&[], &mut ui, &mut net, &mut dev).unwrap_err();
    assert_eq!(e.exit, EXIT_CODE);
    assert!(net.log.is_empty()); // nothing downloaded
}

#[test]
fn device_problems_stop_before_the_code() {
    let cases: Vec<(DevError, &str, i32)> = vec![
        (DevError::NoService("connection refused".into()), "usbmuxd", EXIT_DEVICE),
        (DevError::NoDevice, "No iPhone over USB after 120 s", EXIT_DEVICE),
        (DevError::NotFound("U9".into()), "No iPhone with UDID U9", EXIT_DEVICE),
        (DevError::Several(vec![
            DeviceInfo { udid: "U1".into(), name: "A".into(), ios: "17.0".into() },
            DeviceInfo { udid: "U2".into(), name: "B".into(), ios: "18.1".into() },
        ]), "U2  B (iOS 18.1)", EXIT_USAGE),
    ];
    for (err, text, exit) in cases {
        let (mut ui, mut net, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeNet::ok(), FakeDev::ok("17.0"));
        dev.found = Some(Err(err));
        let e = go(&[], &mut ui, &mut net, &mut dev).unwrap_err();
        assert!(e.message.contains(text), "{}", e.message);
        assert_eq!(e.exit, exit);
        assert_eq!(ui.asked, 0);
        assert!(net.looked.is_empty());
    }
    // Windows: the hint names Apple's driver
    let (mut ui, mut net, mut dev) = (FakeUi::default(), FakeNet::ok(), FakeDev::ok("17.0"));
    dev.found = Some(Err(DevError::NoService("127.0.0.1:27015 refused".into())));
    let e = run(&run_args(&[]), &brand(), Os::Windows, &mut ui, &mut net, &mut dev).unwrap_err();
    assert!(e.message.contains("Apple Devices app"), "{}", e.message);
}

#[test]
fn pairing_problems() {
    for (err, text) in [(PairError::Denied, "Don't Trust"), (PairError::Locked, "Unlock the iPhone"), (PairError::Other("x".into()), "Couldn't pair")] {
        let (mut ui, mut net, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeNet::ok(), FakeDev::ok("17.0"));
        dev.paired = Some(Err(err));
        let e = go(&[], &mut ui, &mut net, &mut dev).unwrap_err();
        assert!(e.message.contains(text), "{}", e.message);
        assert_eq!(e.exit, EXIT_PAIRING);
        assert_eq!(ui.asked, 0);
    }
}

#[test]
fn download_checks() {
    // wrong size
    let mut net = FakeNet::ok();
    net.got = Some(Ok(Downloaded { path: "/tmp/x.ipa".into(), size: 5, sha256: "ab".repeat(32) }));
    let (mut ui, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeDev::ok("17.0"));
    let e = go(&[], &mut ui, &mut net, &mut dev).unwrap_err();
    assert_eq!(e.exit, EXIT_DOWNLOAD);
    assert!(!dev.log.iter().any(|l| l.starts_with("install")));
    // wrong hash
    let mut net = FakeNet::ok();
    net.got = Some(Ok(Downloaded { path: "/tmp/x.ipa".into(), size: 6, sha256: "cd".repeat(32) }));
    let (mut ui, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeDev::ok("17.0"));
    assert!(go(&[], &mut ui, &mut net, &mut dev).unwrap_err().message.contains("SHA-256"));
    assert_eq!(net.log.last().map(String::as_str), Some("discard /tmp/x.ipa"));
    // no hash from the server: size only
    let mut net = FakeNet::ok();
    let mut l = lookup();
    l.sha256 = None;
    net.answers = VecDeque::from([Ok(l)]);
    net.got = Some(Ok(Downloaded { path: "/tmp/x.ipa".into(), size: 6, sha256: "cd".repeat(32) }));
    let (mut ui, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeDev::ok("17.0"));
    go(&[], &mut ui, &mut net, &mut dev).unwrap();
    // failed download
    let mut net = FakeNet::ok();
    net.got = Some(Err("HTTP 404".into()));
    let (mut ui, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeDev::ok("17.0"));
    assert_eq!(go(&[], &mut ui, &mut net, &mut dev).unwrap_err().message, "Download failed: HTTP 404");
}

#[test]
fn install_and_handoff_failures() {
    let (mut ui, mut net, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeNet::ok(), FakeDev::ok("17.0"));
    dev.install = Err("ApplicationVerificationFailed".into());
    let e = go(&[], &mut ui, &mut net, &mut dev).unwrap_err();
    assert_eq!(e.exit, EXIT_INSTALL);
    assert!(!dev.log.iter().any(|l| l.starts_with("write")));
    let (mut ui, mut net, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeNet::ok(), FakeDev::ok("17.0"));
    dev.write = Err("permission denied".into());
    let e = go(&[], &mut ui, &mut net, &mut dev).unwrap_err();
    assert_eq!(e.exit, EXIT_PAIRING);
    assert!(e.message.starts_with("Installed, but"));
}

#[test]
fn no_pairing_file_when_the_site_asks_for_none() {
    let mut net = FakeNet::ok();
    let mut l = lookup();
    l.pairing = None;
    net.answers = VecDeque::from([Ok(l)]);
    let (mut ui, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeDev::ok("27.0"));
    go(&[], &mut ui, &mut net, &mut dev).unwrap();
    assert!(!dev.log.iter().any(|l| l.starts_with("write")));
    assert!(!ui.all().contains("pairing file"));
}

#[test]
fn before_ios_27_the_pairing_file_is_written_and_has_to_be_picked_in_the_app() {
    let (mut ui, mut net, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeNet::ok(), FakeDev::ok("26.5"));
    go(&[], &mut ui, &mut net, &mut dev).unwrap();
    assert!(dev.log.iter().any(|l| l.starts_with("write") && l.contains("Documents/pairingFile.plist")));
    let all = ui.all();
    assert!(all.contains("doesn't read by itself"), "{all}");
    assert!(all.contains("Settings > Installation & Signing > This iPhone, tap Pair This iPhone, then Import Pairing File"), "{all}");
    assert!(all.contains("pick pairingFile.plist (On My iPhone > LiveContainer)"), "{all}");
}

#[test]
fn from_ios_27_no_pairing_file_is_written() {
    for ios in ["27.0", "28.1"] {
        let (mut ui, mut net, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeNet::ok(), FakeDev::ok(ios));
        dev.write = Err("must not be called".into());
        go(&[], &mut ui, &mut net, &mut dev).unwrap();
        assert!(dev.log.contains(&"pair".to_string())); // the computer still has to be trusted to install
        assert!(!dev.log.iter().any(|l| l.starts_with("write")), "{:?}", dev.log);
        assert!(!ui.all().to_lowercase().contains("pairing file"), "{}", ui.all());
    }
}

#[test]
fn developer_mode_off_is_revealed_and_explained() {
    let (mut ui, mut net, mut dev) = (FakeUi::typing(&["ABCD-2345"]), FakeNet::ok(), FakeDev::ok("16.2"));
    dev.dev_mode = Some(false);
    go(&[], &mut ui, &mut net, &mut dev).unwrap();
    assert!(dev.log.contains(&"reveal".to_string()));
    assert!(ui.all().contains("Settings > Privacy & Security > Developer Mode"));
}

#[test]
fn check_only_reads() {
    assert!(matches!(parse_args(&argv(&["--check"]), &brand()), Ok(Cmd::Check(_))));
    let (mut ui, mut dev) = (FakeUi::default(), FakeDev::ok("17.0"));
    check(&run_args(&[]), Os::Mac, &mut ui, &mut dev).unwrap();
    assert_eq!(dev.log, vec!["find None 120", "trusted?", "devmode?"]);
    assert!(ui.all().contains("This computer is trusted.") && ui.all().contains("Developer Mode is on."));
    // not trusted: nothing else asked, exit says so
    let (mut ui, mut dev) = (FakeUi::default(), FakeDev::ok("17.0"));
    dev.paired = Some(Err(PairError::Denied));
    assert_eq!(check(&run_args(&[]), Os::Mac, &mut ui, &mut dev).unwrap_err().exit, EXIT_PAIRING);
    assert_eq!(dev.log, vec!["find None 120", "trusted?"]);
    assert_eq!(ui.asked, 0);
}

#[test]
fn download_only_needs_no_iphone() {
    let a = match parse_args(&argv(&["--download-only", "ABCD-2345"]), &brand()).unwrap() {
        Cmd::Download(a) => a,
        c => panic!("{c:?}"),
    };
    assert!(a.keep_ipa);
    assert!(parse_args(&argv(&["--download-only", "--check"]), &brand()).is_err());
    let (mut ui, mut net) = (FakeUi::default(), FakeNet::ok());
    download_only(&a, &brand(), &mut ui, &mut net).unwrap();
    assert_eq!(net.looked, vec!["ABCD2345"]);
    assert!(ui.all().contains("Saved LiveContainer 3.4 as /tmp/x.ipa"), "{}", ui.all());
    let mut net = FakeNet::ok();
    net.got = Some(Ok(Downloaded { path: "/tmp/x.ipa".into(), size: 6, sha256: "cd".repeat(32) }));
    assert_eq!(download_only(&a, &brand(), &mut FakeUi::default(), &mut net).unwrap_err().exit, EXIT_DOWNLOAD);
}
