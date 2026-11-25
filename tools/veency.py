"""The iPhone 4S's live screen from Veency (the VNC server on it), over ssh: iOS 6 has no other capture that keeps
nothing (Activator's screenshots go in the Camera Roll). A tiny RFB client, stdlib only: 16-bit colour, zlib, full frames.
Veency asks Accept/Reject on the phone for every connection, so connect only for a person who may use the phone; accept()
presses Accept, so the phone must be awake and unlocked (wake()): a prompt behind the lock screen waits there, and
Veency answers nobody until someone presses it. Veency sends a frame only when the screen changes, about half a second each over Wi-Fi."""
import os, select, struct, subprocess, time, zlib

ACCEPT = (92, 363)  # the prompt's Accept button, 320x480 points, portrait
HIDE_CURSOR = -239  # the cursor pseudo-encoding: the server then doesn't draw its arrow into the screen


class VeencyError(Exception):
    pass


def wake(host):
    """Screen on, past the lock screen (no passcode on the 4S); the app in front stays in front."""
    subprocess.run(["ssh", "-o", "BatchMode=yes", host, "activator send libactivator.lockscreen.dismiss; sleep 2"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, check=True)


class Veency:
    def __init__(self, host):
        self.p = subprocess.Popen(["ssh", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=5", "-W", "127.0.0.1:5900", host],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)

    def close(self):
        self.p.kill()
        self.p.wait()

    def ready(self, secs):
        return bool(select.select([self.p.stdout], [], [], secs)[0])

    def read(self, n, secs=None):
        out, end = bytearray(), None if secs is None else time.time() + secs
        while len(out) < n:
            if end is not None and not self.ready(max(0, end - time.time())):
                raise VeencyError("the 4S's Veency doesn't answer")
            b = os.read(self.p.stdout.fileno(), n - len(out))
            if not b:
                raise VeencyError("Veency closed the connection (4S off, or Reject pressed)")
            out += b
        return bytes(out)

    def number(self, secs=None):
        return struct.unpack(">I", self.read(4, secs))[0]

    def send(self, fmt, *a):
        self.p.stdin.write(struct.pack(fmt, *a))

    def open(self, accept):
        """Connect; accept() presses the phone's Accept, only when Veency is waiting for it (no password set)."""
        for _ in range(3):  # no greeting: an earlier prompt is still up, and answering it lets Veency go on
            if self.ready(5):
                break
            accept()
        self.read(12, 5)
        self.send(">12s", b"RFB 003.008\n")
        if not self.ready(2):  # silent until someone answers its prompt, which takes a moment to slide in
            for _ in range(2):
                accept()
                if self.ready(5):
                    break
        types = self.read(self.read(1, 2)[0], 5)
        if 1 not in types:
            raise VeencyError("Veency has a password set (or refused); this tool only answers its Accept prompt")
        self.send(">B", 1)
        if self.number(5):
            raise VeencyError("Veency refused the connection")
        self.send(">B", 1)
        self.w, self.h = struct.unpack(">HH", self.read(4, 5))
        self.read(16, 5)
        self.read(self.number(5), 5)
        self.send(">B3xBBBBHHHBBB3x", 0, 16, 16, 0, 1, 31, 63, 31, 11, 5, 0)  # RGB565: a third of the bytes of 32-bit
        self.send(">BxHii", 2, 2, 6, HIDE_CURSOR)
        # Veency also draws an arrow on the phone itself, and leaves it there (in later screenshots too): park it, no
        # button down, in the bottom right corner, where only its tip shows
        self.send(">BBHH", 5, 0, self.w - 1, self.h - 1)

    def frames(self):
        """Yield the whole screen (RGB565, little-endian) after every update, for ever; VeencyError when it ends."""
        fb, z, w = bytearray(self.w * self.h * 2), zlib.decompressobj(), self.w
        self.send(">BBHHHH", 3, 0, 0, 0, w, self.h)
        while True:
            kind = self.read(1)[0]
            if kind == 3:  # clipboard text
                self.read(3)
                self.read(self.number())
            elif kind == 0:
                for _ in range(struct.unpack(">xH", self.read(3))[0]):
                    x, y, rw, rh, enc = struct.unpack(">HHHHi", self.read(12))
                    if enc == HIDE_CURSOR:
                        self.read(rw * rh * 2 + (rw + 7) // 8 * rh)
                        continue
                    data = z.decompress(self.read(self.number())) if enc == 6 else self.read(rw * rh * 2)
                    for row in range(rh):
                        o = ((y + row) * w + x) * 2
                        fb[o:o + rw * 2] = data[row * rw * 2:(row + 1) * rw * 2]
                yield bytes(fb)
                self.send(">BBHHHH", 3, 1, 0, 0, w, self.h)
            elif kind != 2:  # 2 is the bell
                raise VeencyError(f"unknown Veency message {kind}")
