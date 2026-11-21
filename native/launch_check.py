"""The launch screen's part of mkdeb.py/mkipa.py check (docs/native.md, "Launch screen").

B180: Info.plist names a launch storyboard (UILaunchStoryboardName LaunchScreen), compiled on a Mac by
native/launch/storyboard.sh, whose bars are pinned to the safe area so the splash lines up with the page's first
frame on every screen. The storyboard names loose PNGs (native/launch/make.py) in the app's top folder at @2x and @3x.
UILaunchScreen (N10) can't do that: its bar images are stretched and its image is drawn centred at its own size.

B203: the splash never shows another theme. Both bundles carry LaunchThemes/<key>/ (make.py: each theme's images
and storyboard), which the in-app cover loads and the jailbreak build's root helper copies over the bundle's own
files on a theme change. The sideload IPA's signed bundle can't change, so its splash is neutral instead: an empty
UILaunchScreen (iOS's own background, white or black with the iPhone's appearance), no bars (lite=True).
"""

STORYBOARD = "LaunchScreen"
# Every image LaunchScreen.storyboard names (its <resources>).
IMAGES = ("LaunchStripes", "LaunchNavTop", "LaunchNavBottom", "LaunchTabGloss", "LaunchNavShadow", "LaunchTabShadow",
          "LaunchStatusStrip")
VIEW_NIB = "Lvc-00-000-view-Lrt-00-000.nib"  # the storyboard's root view, the nib make.py recolours per theme
THEMES = "LaunchThemes/"
# Every theme Settings offers (web/app/core/settings.js; native/test_launch_grounds.py keeps this in step).
THEME_KEYS = ("classic", "sepia", "solarized", "oled", "gunmetal", "midnight", "linen", "nord", "dracula",
              "leather", "felt", "wood", "legalpad", "metal",
              "white",  # B231: iOS 7's White, the iOS 7 and iOS 13 styles' light theme (STYLE_PALETTES)
              "oled7", "oled13",  # B235: iOS 7's and iOS 13's OLED Black, flat bars (STYLE_LAUNCH)
              "white13")  # B237: iOS 13's White, #f2f2f7 ground and #f9f9f9 bars (STYLE_LAUNCH)


def storyboard_problems(files, base, what):
    out = []
    sbc = base + STORYBOARD + ".storyboardc/"
    if not files.get(sbc + "Info.plist") or not files.get(sbc + VIEW_NIB):
        out.append("%s storyboard %s.storyboardc missing or not compiled (native/launch/storyboard.sh)" % (what, STORYBOARD))
    for img in IMAGES:
        for scale in ("@2x", "@3x"):
            png = files.get(base + img + scale + ".png")
            if not png or not png.startswith(b"\x89PNG"):
                out.append("%s image %s%s.png missing" % (what, img, scale))
    return out


def problems(info, files, app, lite=False):
    """Problems with info's launch screen; files maps bundle paths to bytes, app is the iFizBox.app/ prefix."""
    out = []
    name = info.get("UILaunchStoryboardName")
    if lite:
        if name is not None:
            out.append("sideload Info.plist has UILaunchStoryboardName %r: its bars show Classic whatever the theme "
                       "(B203: the IPA's splash is the neutral UILaunchScreen)" % name)
        if info.get("UILaunchScreen") != {}:
            out.append("sideload Info.plist UILaunchScreen is %r, want {} (iOS's background, no bars)"
                       % (info.get("UILaunchScreen"),))
    else:
        if name != STORYBOARD:
            out.append("Info.plist UILaunchStoryboardName is %r, want %r (without a launch screen iOS letterboxes the app)"
                       % (name, STORYBOARD))
        if "UILaunchScreen" in info:
            out.append("Info.plist has UILaunchScreen as well as the storyboard: its bars only fit screens whose size is known")
        out += storyboard_problems(files, app, "launch")
    for key in THEME_KEYS:
        out += storyboard_problems(files, app + THEMES + key + "/", "launch theme %s:" % key)
    return out
