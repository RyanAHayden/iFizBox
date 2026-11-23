"""ui-same.py A.png B.png: exit 0 when two screenshots show the same screen (the phone tools' tidy step).
ui-same.py A.png: exit 0 when the screen is off (all black).
Two shots of one still screen differ a little (mean 0.5 of 255 on the iPhone 7); a switcher card over the Home
Screen differs by ~70. Without Pillow it falls back to exact bytes."""
import sys

try:
    from PIL import Image, ImageChops, ImageStat
except ImportError:
    if len(sys.argv) == 2:
        sys.exit(1)
    a, b = (open(f, "rb").read() for f in sys.argv[1:3])
    sys.exit(a != b)
if len(sys.argv) == 2:
    sys.exit(ImageStat.Stat(Image.open(sys.argv[1]).convert("L")).mean[0] >= 3)
try:
    a, b = (Image.open(f).convert("L").resize((150, 267)) for f in sys.argv[1:3])
except OSError:
    sys.exit(1)
sys.exit(ImageStat.Stat(ImageChops.difference(a, b)).mean[0] >= 5)
