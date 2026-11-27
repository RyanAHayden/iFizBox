"""A throwaway app with a share extension, as an IPA: python3 make.py <ld64.lld>."""
import os
import plistlib
import subprocess
import sys
import zipfile

here = os.path.dirname(os.path.abspath(__file__))
home = os.path.expanduser("~/.local/share")
clang = f"{home}/swift/swift-6.4.2-RELEASE-ubuntu24.04/usr/bin/clang"
sdk = f"{home}/ios-sdk/iPhoneOS27.1.sdk"
base = [clang, "-target", "arm64-apple-ios15.0", "-isysroot", sdk, "-fobjc-arc", "-framework", "UIKit",
        "-framework", "Foundation", "-framework", "Security", "-fuse-ld=lld", f"--ld-path={sys.argv[1]}",
        "-Wl,-adhoc_codesign", os.path.join(here, "app.m")]
subprocess.run(base + ["-o", os.path.join(here, "App")], check=True)
subprocess.run(base + ["-DEXTENSION", "-fapplication-extension", "-Wl,-e,_NSExtensionMain",
                       "-o", os.path.join(here, "Share")], check=True)

ID = "com.ryha.f463c"


def info(bid, exe, name, kind, **more):
    return plistlib.dumps({"CFBundleIdentifier": bid, "CFBundleExecutable": exe, "CFBundleName": name,
                           "CFBundleDisplayName": name, "CFBundlePackageType": kind, "CFBundleVersion": "1",
                           "CFBundleShortVersionString": "1.0", "MinimumOSVersion": "15.0",
                           "CFBundleSupportedPlatforms": ["iPhoneOS"], "UIDeviceFamily": [1], **more})


scene = {"UIApplicationSupportsMultipleScenes": False, "UISceneConfigurations": {
    "UIWindowSceneSessionRoleApplication": [{"UISceneConfigurationName": "Default", "UISceneDelegateClassName": "Scene"}]}}
share = {"NSExtensionPointIdentifier": "com.apple.share-services", "NSExtensionPrincipalClass": "ShareVC",
         "NSExtensionAttributes": {"NSExtensionActivationRule": {"NSExtensionActivationSupportsText": True}}}


def add(z, name, data, mode=0o100644):
    i = zipfile.ZipInfo(name)
    i.external_attr = mode << 16
    z.writestr(i, data)


with zipfile.ZipFile(os.path.join(here, "F463c.ipa"), "w") as z:
    app = "Payload/F463c.app/"
    add(z, app + "Info.plist", info(ID, "App", "F463c", "APPL", UIApplicationSceneManifest=scene, UILaunchScreen={}))
    add(z, app + "App", open(os.path.join(here, "App"), "rb").read(), 0o100755)
    ext = app + "PlugIns/Share.appex/"
    add(z, ext + "Info.plist", info(ID + ".share", "Share", "F463c Share", "XPC!", NSExtension=share))
    add(z, ext + "Share", open(os.path.join(here, "Share"), "rb").read(), 0o100755)
