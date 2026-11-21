#!/usr/bin/env python3
"""Remote-control the iPhone 15 Pro from a browser over Tailscale: a live screen (small JPEGs, Pillow), tap or drag on it, type into
the focused field, Home and Wake. For a person helping an agent past a login: actions borrow whoever holds the
ui-15.sh lock (the agent waiting on them), or take it as USER when it is free (and give it back after 5 idle min).
  tools/remote-15.py [PORT]     serves http://<this machine's Tailscale IP>:PORT (default 8098)
Bound to the Tailscale IP only: anyone on the tailnet can drive the phone while it runs. Ctrl-C to stop."""
import base64, io, json, os, subprocess, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
UI = os.path.join(HERE, "ui-15.sh")
LOCK = os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/tmp"), "ifizbox-15-ui.lock")
WDA = "http://127.0.0.1:8100"
ME = "USER"
last_action = [0.0]

PAGE = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>iPhone 15 remote</title><style>
body{margin:0;background:#111;color:#ddd;font:15px -apple-system,Helvetica,sans-serif;text-align:center}
#bar{position:sticky;top:0;background:#222;padding:8px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
input{flex:1;min-width:120px;font-size:16px;padding:6px}button{font-size:15px;padding:6px 10px}
img{max-width:100%;max-height:calc(100vh - 90px);touch-action:none;user-select:none;-webkit-user-select:none}
#st{font-size:12px;color:#999;width:100%}</style>
<div id=bar><input id=t placeholder="text to type" autocomplete=off autocapitalize=off>
<button onclick="go({cmd:'type',text:t.value+(nl.checked?'\\n':'')}).then(()=>t.value='')">Type</button>
<label><input type=checkbox id=nl style="flex:0;min-width:0">⏎</label>
<button onclick="go({cmd:'home'})">Home</button><button onclick="go({cmd:'wake'})">Wake</button>
<div id=st></div></div><img id=s draggable=false>
<script>
const s=document.getElementById('s'),st=document.getElementById('st');let down=null;
const W=1179,H=2556; // ui-15.sh's screenshot pixels; the stream is scaled, so map to these
function px(e){const r=s.getBoundingClientRect();return[Math.round((e.clientX-r.left)*W/r.width),Math.round((e.clientY-r.top)*H/r.height)]}
async function go(a){st.textContent='…';const r=await fetch('act',{method:'POST',body:JSON.stringify(a)});st.textContent=await r.text()}
s.onpointerdown=e=>{down=[px(e),Date.now()];e.preventDefault()};
s.onpointerup=e=>{if(!down)return;const[a,t0]=down,b=px(e);down=null;
 if(Math.hypot(b[0]-a[0],b[1]-a[1])<30)go({cmd:'tap',x:a[0],y:a[1]});
 else go({cmd:'swipe',x1:a[0],y1:a[1],x2:b[0],y2:b[1],secs:Math.max(.1,(Date.now()-t0)/1000)})};
function live(){s.src='stream?'+Date.now()} // MJPEG: the browser keeps redrawing it
s.onerror=()=>{st.textContent='stream dropped, reconnecting…';setTimeout(live,2000)};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)live()});live();
</script>"""


def holder():
    try:
        return open(os.path.join(LOCK, "owner")).read().strip()
    except OSError:
        return None


def ui(*args):
    who = holder()
    if not who:
        subprocess.run([UI, "lock", ME], check=True, capture_output=True)
        who = ME
    if who == ME:
        last_action[0] = time.time()
    p = subprocess.run([UI, who, *map(str, args)], capture_output=True, text=True, timeout=120)
    return f"{'ok' if p.returncode == 0 else 'failed'} (as {who}) {p.stderr.strip()[-200:]}"


def idle_release():  # ponytail: 5-min idle release, so the page never strands the lock for agents
    while True:
        time.sleep(30)
        if holder() == ME and time.time() - last_action[0] > 300:
            subprocess.run([UI, "unlock", ME])


frame = [None, 0]  # latest small JPEG, its number
frame_cv = threading.Condition()
viewers_seen = [0.0]


def grabber():  # ponytail: ~5 fps of 390-px JPEGs (~30 KB) over 5G; PNG/WDA MJPEG at full size is 100+ KB a frame
    from PIL import Image
    last = None
    while True:
        png = screenshot()
        if png and png != last:
            last = png
            im = Image.open(io.BytesIO(png)).convert("RGB")
            im.thumbnail((390, 846))
            out = io.BytesIO()
            im.save(out, "JPEG", quality=50)
            with frame_cv:
                frame[:] = [out.getvalue(), frame[1] + 1]
                frame_cv.notify_all()
        time.sleep(0.2 if png else 2)


def screenshot():
    try:
        with urllib.request.urlopen(WDA + "/screenshot", timeout=10) as r:
            return base64.b64decode(json.load(r)["value"])
    except Exception:
        return None  # WDA down: the first action's `up` starts it


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/stream"):
            return self.stream()
        if self.path.startswith("/shot"):
            png = screenshot()
            return self.send(200, png, "image/png") if png else self.send(503, b"no screen yet: tap Wake", "text/plain")
        self.send(200, PAGE.encode(), "text/html; charset=utf-8")

    def stream(self):  # MJPEG of the small frames grabber() makes; a frame only when the screen changed
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=f")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        seen = -1
        try:
            while True:
                with frame_cv:
                    frame_cv.wait_for(lambda: frame[1] != seen, timeout=15)
                    jpg, seen = frame
                if jpg:
                    self.wfile.write(b"--f\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(jpg) + jpg + b"\r\n")
                    self.wfile.flush()
        except OSError:
            pass  # viewer left

    def do_POST(self):
        a = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        c = a.get("cmd")
        try:
            if c == "tap":
                out = ui("tap", int(a["x"]), int(a["y"]))
            elif c == "swipe":
                out = ui("swipe", *(int(a[k]) for k in ("x1", "y1", "x2", "y2")), float(a["secs"]))
            elif c == "type":
                out = ui("type", str(a["text"]))
            elif c in ("home", "wake"):
                out = ui(c)
            else:
                return self.send(400, b"unknown command", "text/plain")
        except Exception as e:
            out = f"failed: {e}"
        self.send(200, out.encode(), "text/plain; charset=utf-8")


if __name__ == "__main__":
    ip = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True).stdout.split()[0]
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8098
    threading.Thread(target=grabber, daemon=True).start()
    threading.Thread(target=idle_release, daemon=True).start()
    print(f"http://{ip}:{port}/", flush=True)
    ThreadingHTTPServer((ip, port), H).serve_forever()
