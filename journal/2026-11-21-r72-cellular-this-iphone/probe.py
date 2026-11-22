#!/usr/bin/env python3
"""TCP connect to RemotePairing (49152), lockdownd (62078) and a control port (49153) on each host given.
Prints one line per host: open / refused / timeout with the connect's own time. Usage: probe.py HOST..."""
import socket
import sys
import time

PORTS = (49152, 62078, 49153)


def probe(host, port, timeout=5.0):
    t = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            verdict = "open"
    except ConnectionRefusedError:
        verdict = "refused"
    except socket.timeout:
        verdict = "timeout"
    except OSError as e:
        verdict = f"error({e.errno})"
    return f"{port} {verdict} {int((time.monotonic() - t) * 1000)}ms"


if __name__ == "__main__":
    stamp = time.strftime("%H:%M:%S")
    for h in sys.argv[1:]:
        print(stamp, h, " | ".join(probe(h, p) for p in PORTS), flush=True)
