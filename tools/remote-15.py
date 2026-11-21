#!/usr/bin/env python3
"""Remote-control the iPhone 15 Pro from a browser over Tailscale: a live screenshot, tap or drag on it, type into
the focused field, Home and Wake. For a person helping an agent past a login: actions borrow whoever holds the
ui-15.sh lock (the agent waiting on them), or take it as USER when it is free (and give it back after 5 idle min).
  tools/remote-15.py [PORT]     serves http://<this machine's Tailscale IP>:PORT (default 8098)
Bound to the Tailscale IP only: anyone on the tailnet can drive the phone while it runs. Ctrl-C to stop."""
import base64, json, os, subprocess, sys, threading, time, urllib.request
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
function px(e){const r=s.getBoundingClientRect();return[Math.round((e.clientX-r.left)*s.naturalWidth/r.width),Math.round((e.clientY-r.top)*s.naturalHeight/r.height)]}
async function go(a){st.textContent='…';const r=await fetch('act',{method:'POST',body:JSON.stringify(a)});st.textContent=await r.text();setTimeout(shot,300)}
s.onpointerdown=e=>{down=[px(e),Date.now()];e.preventDefault()};
s.onpointerup=e=>{if(!down)return;const[a,t0]=down,b=px(e);down=null;
 if(Math.hypot(b[0]-a[0],b[1]-a[1])<30)go({cmd:'tap',x:a[0],y:a[1]});
 else go({cmd:'swipe',x1:a[0],y1:a[1],x2:b[0],y2:b[1],secs:Math.max(.1,(Date.now()-t0)/1000)})};
let busy=false;async function shot(){if(busy||document.hidden)return;busy=true;try{const r=await fetch('shot?'+Date.now());
 if(r.ok){const u=URL.createObjectURL(await r.blob());s.onload=()=>URL.revokeObjectURL(u);s.src=u}}finally{busy=false}}
setInterval(shot,1000);shot();
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
        if self.path.startswith("/shot"):
            png = screenshot()
            return self.send(200, png, "image/png") if png else self.send(503, b"no screen yet: tap Wake", "text/plain")
        self.send(200, PAGE.encode(), "text/html; charset=utf-8")

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
    threading.Thread(target=idle_release, daemon=True).start()
    print(f"http://{ip}:{port}/", flush=True)
    ThreadingHTTPServer((ip, port), H).serve_forever()
