#!/usr/bin/env python3
"""Write and check iFizBox's sideload IPA (task I2) with the stdlib only.

    mkipa.py plist <Info.plist> <overlay.plist> <out>   Info.plist with the overlay's keys added (Info-sideload.plist)
    mkipa.py build <iFizBox.app> <out.ipa>               zip the app as Payload/iFizBox.app, reproducibly
    mkipa.py check <file.ipa>                           exit 1 and list every problem if the IPA is not right

The IPA is the same Swift shell as the .deb, without the root helper and with sideload entitlements. It is ad hoc
signed (or unsigned past lld's ad hoc signature): the user signs it with their own tool (Feather, AltStore,
SideStore, TrollStore), as with Feather's own IPA (docs/sideload.md, "What I2 needs").
"""
import os
import plistlib
import struct
import sys
import time
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mkdeb import macho_info  # noqa: E402
import launch_check  # noqa: E402
import carfile  # noqa: E402
from brand import NAME  # noqa: E402  (F180: native/brand.env)

APP = "Payload/%s.app/" % NAME
# Entitlements only a jailbreak (or TrollStore) build may carry; a sideload signer would refuse or strip them.
PRIVATE = ("platform-application", "com.apple.private.")


# ---------- writing ----------

def merge_plist(base, overlay, out):
    with open(base, "rb") as f:
        info = plistlib.load(f)
    with open(overlay, "rb") as f:
        extra = plistlib.load(f)
    for key in extra.pop("IFIZBOX_REMOVE_KEYS", []):  # B203: base keys the IPA drops (its launch storyboard)
        info.pop(key, None)
    info.update(extra)
    with open(out, "wb") as f:
        plistlib.dump(info, f, sort_keys=True)


def build(app, out, mtime=None):
    """Zip app (a iFizBox.app directory) as Payload/iFizBox.app/, sorted and with one timestamp: same input, same bytes."""
    if mtime is None:
        mtime = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))
    stamp = time.gmtime(max(mtime, 315532800))[:6]  # zip can't go before 1980
    entries = []
    for dirpath, dirnames, filenames in os.walk(app):
        dirnames.sort()
        rel = os.path.relpath(dirpath, app)
        base = APP if rel == "." else APP + rel.replace(os.sep, "/") + "/"
        entries.append((base, None, 0o755))
        for name in sorted(filenames):
            p = os.path.join(dirpath, name)
            entries.append((base + name, p, 0o755 if os.stat(p).st_mode & 0o111 else 0o644))
    tmp = out + ".tmp"
    with zipfile.ZipFile(tmp, "w") as z:
        z.writestr(_info("Payload/", stamp, 0o755, True), b"")
        for name, path, mode in sorted(entries):
            if path is None:
                z.writestr(_info(name, stamp, mode, True), b"")
            else:
                with open(path, "rb") as f:
                    z.writestr(_info(name, stamp, mode, False), f.read(), zipfile.ZIP_DEFLATED)
    os.replace(tmp, out)


def _info(name, stamp, mode, is_dir):
    i = zipfile.ZipInfo(name, stamp)
    i.create_system = 3  # Unix, so the mode bits below count (the executable must stay executable)
    i.external_attr = ((0o040000 if is_dir else 0o100000) | mode) << 16 | (0x10 if is_dir else 0)
    return i


# ---------- checking ----------

def macho_entitlements(data):
    """The entitlements dict embedded in a thin 64-bit Mach-O's code signature, or None when it has none."""
    _, _, _, ncmds, _ = struct.unpack_from("<iiIII", data, 4)
    off = 32
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", data, off)
        if cmd == 0x1D:  # LC_CODE_SIGNATURE: the SuperBlob, big-endian
            dataoff, datasize = struct.unpack_from("<II", data, off + 8)
            if not datasize:
                return None
            magic, _, count = struct.unpack_from(">III", data, dataoff)
            if magic != 0xFADE0CC0:
                raise ValueError("code signature magic %#x" % magic)
            for k in range(count):
                slot, boff = struct.unpack_from(">II", data, dataoff + 12 + 8 * k)
                if slot == 5:  # CSSLOT_ENTITLEMENTS
                    bmagic, blen = struct.unpack_from(">II", data, dataoff + boff)
                    if bmagic != 0xFADE7171:
                        raise ValueError("entitlements blob magic %#x" % bmagic)
                    return plistlib.loads(data[dataoff + boff + 8:dataoff + boff + blen])
            return None
        off += size
    return None


def ipa_type_problems(info):
    """B174: how the Lite app types .ipa, as Feather does: its own exported UTType for the extension (conforming to
    com.apple.itunes.ipa and public.data, never public.zip-archive, or Files unzips an IPA on a tap), opened by a
    document type of rank Owner, in place. -> problems (empty = good)."""
    problems = []
    decls = info.get("UTExportedTypeDeclarations", []) + info.get("UTImportedTypeDeclarations", [])
    by_ext = [t for t in decls if "ipa" in t.get("UTTypeTagSpecification", {}).get("public.filename-extension", [])]
    exported = [t for t in info.get("UTExportedTypeDeclarations", []) if t in by_ext]
    if not exported:
        problems.append("Info.plist exports no UTType for the .ipa extension")
    for t in by_ext:
        conforms = t.get("UTTypeConformsTo", [])
        if "public.zip-archive" in conforms or "public.archive" in conforms:
            problems.append("UTType %s for .ipa conforms to an archive type (Files would unzip it)" % t.get("UTTypeIdentifier"))
        if "public.data" not in conforms:
            problems.append("UTType %s for .ipa does not conform to public.data" % t.get("UTTypeIdentifier"))
    ids = {t.get("UTTypeIdentifier") for t in exported}
    owners = [d for d in info.get("CFBundleDocumentTypes", []) if ids & set(d.get("LSItemContentTypes", []))]
    if not owners or owners[0].get("LSHandlerRank") != "Owner":
        problems.append("the .ipa document type is not LSHandlerRank Owner")
    if info.get("LSSupportsOpeningDocumentsInPlace") is not True:
        problems.append("Info.plist does not open documents in place")
    return problems


def check(path):
    """Problems with the IPA at path (empty list = good), and a short summary."""
    problems = []
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        files = {i.filename: (i, z.read(i)) for i in infos if not i.is_dir()}
    for i in infos:
        if not i.filename.startswith("Payload/") or ".." in i.filename.split("/"):
            problems.append("not under Payload/: %s" % i.filename)
    apps = {n.split("/")[1] for n in files if n.startswith("Payload/") and n.count("/") >= 2}
    if apps != {NAME + ".app"}:
        problems.append("Payload holds %s, want just %s.app" % (sorted(apps), NAME))

    plist = files.get(APP + "Info.plist")
    if not plist:
        return problems + ["no %s.app/Info.plist" % NAME], ""
    info = plistlib.loads(plist[1])
    want = {"CFBundleExecutable": NAME, "MinimumOSVersion": "15.0", "CADisableMinimumFrameDurationOnPhone": True}
    for k, v in want.items():
        if info.get(k) != v:
            problems.append("Info.plist %s is %r, want %r" % (k, info.get(k), v))
    for k in ("CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion", "UIApplicationSceneManifest"):
        if not info.get(k):
            problems.append("Info.plist has no %s" % k)
    if any("@" in str(info.get(k, "")) for k in ("CFBundleShortVersionString", "CFBundleVersion", "MinimumOSVersion")):
        problems.append("Info.plist has an unfilled @PLACEHOLDER@")
    if "audio" not in info.get("UIBackgroundModes", []):
        problems.append("Info.plist UIBackgroundModes has no audio")
    schemes = [s for t in info.get("CFBundleURLTypes", []) for s in t.get("CFBundleURLSchemes", [])]
    if "ifizbox" not in schemes:
        problems.append("Info.plist has no ifizbox:// URL scheme")
    types = [u for d in info.get("CFBundleDocumentTypes", []) for u in d.get("LSItemContentTypes", [])]
    if "com.apple.itunes.ipa" not in types:
        problems.append("Info.plist does not open .ipa files")
    problems += ipa_type_problems(info)
    # B179: the icon at every size, loose and in Assets.car (carfile.py).
    problems += carfile.icon_problems(info, {n: d for n, (_, d) in files.items()}, APP, lite=True)
    # N10: the launch screen's keys and images (launch_check.py).
    problems += launch_check.problems(info, {n: d for n, (_, d) in files.items()}, APP, lite=True)

    # The root helper and N5's upgrade daemon and its launchd job are the .deb's alone (T5).
    jailbreak_only = ("ifizbox-helper", "ifizbox-upgrades", "com.ryha.ifizbox.upgrades.plist")
    helpers = sorted(n for n in files if n.rsplit("/", 1)[-1] in jailbreak_only or "/var/jb/" in n
                     or "/LaunchDaemons/" in n)
    if helpers:
        problems.append("jailbreak files in the IPA: %s" % ", ".join(helpers))

    summary = ""
    exe = APP + info.get("CFBundleExecutable", "?")
    if exe not in files:
        problems.append("no executable %s" % exe)
    else:
        i, data = files[exe]
        if not (i.external_attr >> 16) & 0o111:
            problems.append("executable is not executable")
        try:
            cpu, sub, ftype, platform, minos, signed = macho_info(data)
            if (cpu, sub) != (0x0100000C, 0):
                problems.append("executable is cpu %#x/%d, not arm64" % (cpu, sub))
            if ftype != 2:
                problems.append("executable filetype %d is not MH_EXECUTE" % ftype)
            if platform != 2 or minos != "15.0":
                problems.append("executable platform %s minos %s, want iOS (2) 15.0" % (platform, minos))
            if not signed:
                problems.append("executable has no code signature")
            ents = macho_entitlements(data) or {}
            bad = sorted(k for k in ents if k.startswith(PRIVATE))
            if bad:
                problems.append("jailbreak entitlements in the IPA: %s" % ", ".join(bad))
            # The "This iPhone" install route (native/sideload/idevice): idevice linked in statically, its pairable
            # host past dead_strip, IDevice.swift compiled in.
            for need in (b"ifizbox.idevice.pairing", b"_remotepairing-pairable-host._tcp"):
                if need not in data:
                    problems.append("executable lacks %s (idevice not linked in)" % need.decode())
            summary = "arm64 iOS %s, %d KB executable, entitlements %s" % (
                minos, len(data) // 1024, ", ".join(sorted(ents)) or "none")
        except (ValueError, struct.error, plistlib.InvalidFileException) as e:
            problems.append("executable: %s" % e)

    problems += intents_problems(files)
    problems += vpn_problems(files)

    if APP + "bridge.js" not in files:
        problems.append("bridge.js missing (ifizboxNative and the mode come from it)")
    web = {n[len(APP + "web/"):] for n in files if n.startswith(APP + "web/")}
    for need in ("index.html", "app.js", "style.css", "router.js"):
        if need not in web:
            problems.append("web/%s missing from the bundle" % need)
    tests = sorted(n for n in web if n.endswith((".test.js", ".test.mjs")))
    if tests:
        problems.append("tests shipped in the bundle: %s" % ", ".join(tests))
    fixtures = sorted(n for n in web if n.startswith("core/fixtures/"))
    if fixtures:
        problems.append("test fixtures shipped in the bundle (%d): %s" % (len(fixtures), ", ".join(fixtures[:5])))
    summary = "%s %s (%s): %d web files, %s" % (info.get("CFBundleIdentifier"), info.get("CFBundleShortVersionString"),
                                               info.get("CFBundleVersion"), len(web), summary)
    return problems, summary


# N8: the IPA carries the intents that work without a jailbreak (native/build.sh SIDELOAD_INTENTS), and a widget
# extension without controls (no intents of its own) and without jailbreak entitlements.
SIDELOAD_INTENTS = {"CheckForUpdatesIntent", "AddSourceIntent", "RestorePackagesIntent"}
WIDGET = APP + "PlugIns/%sWidget.appex/" % NAME


def intents_problems(files):
    import json
    problems = []
    meta = files.get(APP + "Metadata.appintents/extract.actionsdata")
    if not meta:
        return ["no Metadata.appintents/extract.actionsdata (App Intents, N8)"]
    try:
        actions = set(json.loads(meta[1]).get("actions", {}))
    except ValueError as e:
        return ["Metadata.appintents: %s" % e]
    if actions != SIDELOAD_INTENTS:
        problems.append("App Intents %s, want the both-modes %s" % (sorted(actions), sorted(SIDELOAD_INTENTS)))
    if WIDGET + "Metadata.appintents/extract.actionsdata" in files:
        problems.append("the widget extension carries intents (the controls are the .deb's)")
    exe = files.get(WIDGET + NAME + "Widget")
    if not exe or WIDGET + "Info.plist" not in files:
        problems.append("no widget extension (PlugIns/%sWidget.appex)" % NAME)
    else:
        ents = macho_entitlements(exe[1]) or {}
        bad = sorted(k for k in ents if k.startswith(PRIVATE))
        if bad:
            problems.append("jailbreak entitlements in the widget extension: %s" % ", ".join(bad))
    return problems


# F372: the built-in VPN for This iPhone installs (native/sideload/vpn): a packet tunnel extension, and the
# Network Extensions entitlement on it and on the app (the user's signer swaps in its profile's).
VPN = APP + "PlugIns/%sVPN.appex/" % NAME
NE = "com.apple.developer.networking.networkextension"


def vpn_problems(files):
    problems = []
    exe, info = files.get(VPN + NAME + "VPN"), files.get(VPN + "Info.plist")
    if not exe or not info:
        return ["no built-in VPN extension (PlugIns/%sVPN.appex)" % NAME]
    try:
        point = plistlib.loads(info[1]).get("NSExtension", {}).get("NSExtensionPointIdentifier")
    except plistlib.InvalidFileException as e:
        return ["the VPN extension's Info.plist: %s" % e]
    if point != "com.apple.networkextension.packet-tunnel":
        problems.append("the VPN extension is a %s, not a packet tunnel" % point)
    for what, data in (("the VPN extension", exe[1]), ("the app", files.get(APP + NAME, (0, b""))[1])):
        try:
            ents = macho_entitlements(data) or {}
        except (ValueError, struct.error):
            ents = {}
        if "packet-tunnel-provider" not in (ents.get(NE) or []):
            problems.append("%s lacks the %s packet-tunnel-provider entitlement" % (what, NE))
    return problems


def main(argv):
    if len(argv) == 5 and argv[1] == "plist":
        merge_plist(argv[2], argv[3], argv[4])
        return 0
    if len(argv) == 4 and argv[1] == "build":
        build(argv[2], argv[3])
        return 0
    if len(argv) == 3 and argv[1] == "check":
        problems, summary = check(argv[2])
        for p in problems:
            print("ipa: " + p, file=sys.stderr)
        if not problems:
            print(summary)
        return 1 if problems else 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
