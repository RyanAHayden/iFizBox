#!/usr/bin/env python3
"""Remote-control a test phone from a browser over Tailscale: a live screen (small JPEGs, Pillow), tap or drag on it,
Home, and what else that phone's script does (the 15: type into the focused field, Wake). For a person helping an agent
past a login: actions borrow whoever holds the phone's lock (the agent waiting on them), or take it as USER when it is
free (and give it back after 5 idle min).
  tools/remote-15.py [15|7|4s] [PORT]     serves http://<this machine's Tailscale IP>:PORT
15 (the default): iPhone 15 Pro, ui-15.sh, port 8098. 7: iPhone 7, ui-7.sh, 8099. 4s: iPhone 4S, ui-4s.sh, 8101 (8100 is WDA's).
The 15's and 7's screens need no lock. The 4S's comes from Veency (tools/veency.py), which prompts on the phone, so it
starts with "Show screen", under the lock like an action; it keeps no shot on the phone (only Veency's arrow tip, bottom right).
While a task holds the phone, actions are refused until the person presses "Use it anyway" for that holder (a new holder asks again).
SIGTERM (the Tools page's Stop) frees the lock only when it is held as USER, then exits 0. Started while already serving, it says so and exits 0.
Bound to the Tailscale IP only: anyone on the tailnet can drive the phone while it runs. Ctrl-C to stop."""
import base64, io, json, os, signal, subprocess, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from veency import ACCEPT, Veency, VeencyError, wake  # noqa: E402

# size is what the script's tap and swipe take: screenshot pixels, on the 4S points
PHONES = {
    "15": {"name": "iPhone 15", "port": 8098, "size": (1179, 2556), "cmds": ("tap", "swipe", "home", "lock-button", "type", "wake")},
    "7": {"name": "iPhone 7", "port": 8099, "size": (750, 1334), "cmds": ("tap", "swipe", "home", "lock-button")},
    "4s": {"name": "iPhone 4S", "port": 8101, "size": (320, 480), "cmds": ("tap", "swipe", "home", "lock-button", "screen")},
}
PHONE, UI, LOCK = "", "", ""


def use(phone):  # the env names are for test_remote_15.py
    global PHONE, UI, LOCK
    PHONE = phone
    UI = os.environ.get("IFIZBOX_UI_SCRIPT") or os.path.join(HERE, f"ui-{phone}.sh")
    LOCK = os.environ.get("IFIZBOX_UI_LOCK") or os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/tmp"), f"ifizbox-{phone}-ui.lock")


use("15")
WDA = "http://127.0.0.1:8100"
ME = "USER"
last_action = [0.0]
allowed = [None]  # the task holder the person pressed "Use it anyway" for

PAGE = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>@NAME@ remote</title><style>
body{margin:0;background:#111;color:#ddd;font:15px -apple-system,Helvetica,sans-serif;text-align:center}
[data-cmd=type]{display:flex;gap:6px;flex:1}[hidden]{display:none!important}#bar{position:sticky;top:0;background:#222;padding:8px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
input{flex:1;min-width:120px;font-size:16px;padding:6px}button{font-size:15px;padding:6px 10px}
img{max-width:100%;max-height:calc(100vh - 90px);touch-action:none;user-select:none;-webkit-user-select:none}
#st{font-size:12px;color:#999;width:100%}</style>
<div id=bar><span data-cmd=type><input id=t placeholder="text to type" autocomplete=off autocapitalize=off>
<button onclick="go({cmd:'type',text:t.value+(nl.checked?'\\n':'')}).then(()=>t.value='')">Type</button>
<label><input type=checkbox id=nl style="flex:0;min-width:0">⏎</label></span>
<button onclick="go({cmd:'home'})">Home</button><button data-cmd=lock-button onclick="go({cmd:'lock-button'})">Lock</button><button data-cmd=wake onclick="go({cmd:'wake'})">Wake</button>
<button data-cmd=screen onclick="go({cmd:'screen'})">Show screen</button>
<span id=who></span><button id=ua hidden onclick="go({cmd:'allow'})">Use it anyway</button>
<div id=st></div><div id=no></div></div><img id=s draggable=false>
<script>
const s=document.getElementById('s'),st=document.getElementById('st'),no=document.getElementById('no');let down=null;
const W=@W@,H=@H@,CMDS=@CMDS@; // the script's own coordinates; the stream is scaled, so map to these
for(const e of document.querySelectorAll('[data-cmd]'))e.hidden=!CMDS.includes(e.dataset.cmd);
function px(e){const r=s.getBoundingClientRect();return[Math.round((e.clientX-r.left)*W/r.width),Math.round((e.clientY-r.top)*H/r.height)]}
async function go(a){st.textContent='…';const r=await fetch('act',{method:'POST',body:JSON.stringify(a)});st.textContent=await r.text();who()}
async function who(){try{const j=await (await fetch('who')).json();
 document.getElementById('who').textContent=j.holder?(j.holder==='USER'?'You hold the phone':j.holder+' holds the phone'+(j.allowed?' (allowed)':'')):'Phone is free';
 document.getElementById('ua').hidden=!(j.holder&&j.holder!=='USER'&&!j.allowed)}catch(e){}}
who();setInterval(who,3000);
s.onpointerdown=e=>{down=[px(e),Date.now()];e.preventDefault()};
s.onpointerup=e=>{if(!down)return;const[a,t0]=down,b=px(e);down=null;
 if(Math.hypot(b[0]-a[0],b[1]-a[1])<30*W/1179)go({cmd:'tap',x:a[0],y:a[1]});
 else go({cmd:'swipe',x1:a[0],y1:a[1],x2:b[0],y2:b[1],secs:Math.max(.1,(Date.now()-t0)/1000)})};
let n=-1; // long poll /frame: each answer is the next screen; Safari's MJPEG held frames back
async function loop(){for(;;){if(document.hidden){await new Promise(r=>setTimeout(r,500));continue}
 try{const r=await fetch('frame?after='+n+'&t='+Date.now());
  if(r.ok){n=+r.headers.get('X-Frame');const u=URL.createObjectURL(await r.blob());s.onload=()=>URL.revokeObjectURL(u);s.src=u;s.style.opacity=1;no.textContent=''}
  else{no.textContent=await r.text();s.style.opacity=.3;n=-1;await new Promise(r=>setTimeout(r,2000))}}catch(e){await new Promise(r=>setTimeout(r,2000))}}}
loop();
</script>"""


def holder():
    try:
        return open(os.path.join(LOCK, "owner")).read().strip()
    except OSError:
        return None


def is_allowed(who):
    """Free or ours: yes. A task's lock: only after "Use it anyway" for that same holder."""
    return who in (None, ME) or allowed[0] == who


def allow():
    who = holder()
    if who and who != ME:
        allowed[0] = who
    return f"ok using the phone anyway (held by {who})" if who else "ok the phone is free"


def borrow():
    """The holder to act as (USER, taking a free lock), or None and why not."""
    who = holder()
    if not is_allowed(who):
        allowed[0] = None
        return None, f"refused: {who} holds the phone; press 'Use it anyway' to use it"
    if not who:
        subprocess.run([UI, "lock", ME], check=True, capture_output=True)
        who = ME
    if who == ME:
        last_action[0] = time.time()
    return who, None


def ui(*args):
    who, why = borrow()
    if not who:
        return why
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


def publish(im):
    im = im.convert("RGB")
    im.thumbnail((390, 846))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=50)
    with frame_cv:
        frame[:] = [out.getvalue(), frame[1] + 1]
        frame_cv.notify_all()


def drop_frame():  # the screen is gone: the page says so instead of showing an old one as live
    with frame_cv:
        frame[:] = [None, frame[1] + 1]


def grabber():  # ponytail: ~5 fps of 390-px JPEGs (~30 KB) over 5G; PNG/WDA MJPEG at full size is 100+ KB a frame
    from PIL import Image
    last = None
    while True:
        png = screenshot()
        if png and png != last:
            last = png
            publish(Image.open(io.BytesIO(png)))
        time.sleep(0.2 if png else 2)


def watched(secs):
    return time.time() - viewers_seen[0] < secs


PNG_END = b"IEND\xaeB`\x82"


def pngs(pipe):
    """Split a stream of PNGs, one after the other, into each PNG."""
    buf = b""
    while True:
        b = pipe.read1(1 << 16)
        if not b:
            return
        buf += b
        while PNG_END in buf:
            png, buf = buf.split(PNG_END, 1)
            yield png + PNG_END


live = [None]  # what runs ssh for the screen now: the 7's Popen or the 4S's Veency


def grabber_7():  # one ssh that keeps shooting (phonectl writes to stdout, nothing on the phone), only while someone watches
    from PIL import Image
    while True:
        if watched(20):
            live[0] = p = subprocess.Popen(
                ["ssh", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=5", os.environ.get("IFIZBOX_7_HOST", "7"),
                 "while /var/jb/usr/local/bin/phonectl shot -; do sleep 0.2; done"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            last = None
            try:
                for png in pngs(p.stdout):
                    if png != last:
                        last = png
                        publish(Image.open(io.BytesIO(png)))
                    if not watched(20):
                        break
            except Exception as e:
                print(f"screen: {e}", file=sys.stderr, flush=True)
            p.kill()
            p.wait()
            live[0] = None
            drop_frame()
        time.sleep(2)


screen_lock = threading.Lock()


def show_screen():
    """4S: connect to Veency under the lock rules and press its Accept; the frames then come by themselves."""
    who, why = borrow()
    if not who:
        return why
    if not screen_lock.acquire(blocking=False):
        return "ok the screen is already being connected"
    try:
        if live[0]:
            return "ok the screen is on"
        viewers_seen[0] = time.time()
        host = os.environ.get("IFIZBOX_4S_HOST", "4s")
        wake(host)
        v = Veency(host)
        live[0] = v

        def accept():
            if holder() != who:
                raise VeencyError("the phone changed hands")
            time.sleep(2)
            subprocess.run([UI, who, "tap", *map(str, ACCEPT)], capture_output=True, timeout=30)
        try:
            v.open(accept)
        except Exception:
            v.close()
            live[0] = None
            raise
        threading.Thread(target=veency_frames, args=(v,), daemon=True).start()
        threading.Thread(target=veency_watch, args=(v, who), daemon=True).start()
        return f"ok (as {who}) the screen is on"
    finally:
        screen_lock.release()


def veency_frames(v):
    try:
        from PIL import Image
        for raw in v.frames():
            publish(Image.frombytes("RGB", (v.w, v.h), raw, "raw", "BGR;16"))
    except Exception as e:
        print(f"screen: {e}", file=sys.stderr, flush=True)
    live[0] = None
    v.close()
    drop_frame()


def veency_watch(v, who):  # never keep watching over someone else's use of the phone, or for nobody
    while live[0] is v:
        if holder() != who or not watched(60):
            v.p.kill()
            return
        time.sleep(1)


def no_screen():
    if PHONE == "4s":
        return b"no screen: press Show screen"
    return b"no screen yet: tap Wake" if PHONE == "15" else b"no screen yet: the iPhone 7 isn't answering"


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
        if self.path.startswith("/who"):
            who = holder()
            return self.send(200, json.dumps({"phone": PHONE, "holder": who, "allowed": bool(who) and is_allowed(who)}).encode(), "application/json")
        if self.path.startswith("/frame"):
            return self.next_frame()
        if self.path.startswith("/shot"):
            if PHONE != "15":
                return self.send(200, frame[0], "image/jpeg") if frame[0] else self.send(503, no_screen(), "text/plain")
            png = screenshot()
            return self.send(200, png, "image/png") if png else self.send(503, no_screen(), "text/plain")
        ph = PHONES[PHONE]
        page = PAGE.replace("@NAME@", ph["name"]).replace("@CMDS@", json.dumps(ph["cmds"]))
        page = page.replace("@W@", str(ph["size"][0])).replace("@H@", str(ph["size"][1]))
        self.send(200, page.encode(), "text/html; charset=utf-8")

    def next_frame(self):  # long poll: the newest small JPEG once it is newer than ?after=N (15 s at most)
        try:
            after = int(self.path.split("after=")[1].split("&")[0])
        except (IndexError, ValueError):
            after = -1
        viewers_seen[0] = time.time()
        if PHONE == "4s" and not live[0] and not frame[0]:  # nothing will come by itself
            return self.send(503, no_screen(), "text/plain")
        with frame_cv:
            frame_cv.wait_for(lambda: frame[1] != after and frame[0], timeout=15)
            jpg, n = frame
        if not jpg:
            return self.send(503, no_screen(), "text/plain")
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("X-Frame", str(n))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(jpg)

    def do_POST(self):
        a = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        c = a.get("cmd")
        if c != "allow" and c not in PHONES[PHONE]["cmds"]:
            return self.send(400, b"unknown command", "text/plain")
        try:
            if c == "tap":
                out = ui("tap", int(a["x"]), int(a["y"]))
            elif c == "swipe":
                out = ui("swipe", *(int(a[k]) for k in ("x1", "y1", "x2", "y2")), float(a["secs"]))
            elif c == "type":
                out = ui("type", str(a["text"]))
            elif c == "allow":
                out = allow()
            elif c == "screen":
                out = show_screen()
            else:  # home, wake
                out = ui(c)
        except Exception as e:
            out = f"failed: {e}"
        self.send(200, out.encode(), "text/plain; charset=utf-8")


def stop(*_):  # SIGTERM/SIGINT: free the lock only if it is ours (USER), never a task's
    if live[0]:
        getattr(live[0], "p", live[0]).kill()
    if holder() == ME:
        subprocess.run([UI, "unlock", ME])
    os._exit(0)


def main():
    args = sys.argv[1:]
    if args and args[0] in PHONES:
        use(args.pop(0))
    ip = os.environ.get("IFIZBOX_REMOTE_IP") or subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True).stdout.split()[0]
    port = int(args[0]) if args else PHONES[PHONE]["port"]
    try:
        server = ThreadingHTTPServer((ip, port), H)
    except OSError as e:
        if e.errno in (98, 48):
            try:  # only our own page, for this phone, counts as "already serving" (one from before the 7 and 4S has no "phone")
                who = json.loads(urllib.request.urlopen(f"http://{ip}:{port}/who", timeout=5).read())
                assert "holder" in who and who.get("phone", "15") == PHONE
            except Exception:
                raise e
            print(f"already serving on http://{ip}:{port}/", flush=True)
            return 0
        raise
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    if PHONE != "4s":
        threading.Thread(target=grabber if PHONE == "15" else grabber_7, daemon=True).start()
    threading.Thread(target=idle_release, daemon=True).start()
    print(f"http://{ip}:{port}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
