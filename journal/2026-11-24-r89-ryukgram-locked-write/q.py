# q.py list | tap LABEL : labelled elements and their points, through WDA
import json,sys,re,urllib.request
def req(p,b=None):
    r=urllib.request.Request("http://127.0.0.1:8100"+p,data=json.dumps(b).encode() if b is not None else None,headers={"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(r,timeout=60))
src=req("/source")["value"]
els=[]
import xml.etree.ElementTree as ET
for e in ET.fromstring(src.encode()).iter():
    a=e.attrib
    if a.get("label") and a.get("visible")=="true": els.append((a["type"][15:],a["label"],a.get("value"),int(a["x"])+int(a["width"])//2,int(a["y"])+int(a["height"])//2))
if sys.argv[1]=="list":
    for e in els:
        if e[0] in("Button","Cell","Switch","StaticText","Key","SecureTextField","TextField","NavigationBar"): print(e)
else:
    m=[e for e in els if e[1]==sys.argv[2] or e[1].startswith(sys.argv[2])]
    m.sort(key=lambda e:(e[1]!=sys.argv[2],e[0]!="Button"))
    if not m: sys.exit("no "+sys.argv[2])
    print("tap",m[0]); import subprocess
    subprocess.run(["tools/ui-15.sh","R89","tap",str(m[0][3]*3),str(m[0][4]*3)],check=True)
