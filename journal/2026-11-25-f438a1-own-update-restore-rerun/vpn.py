# vpn.py ours|ts : Settings > VPN. ours: the VPN off, iFizBox VPN selected. ts: Tailscale selected and on.
import subprocess,sys,time,re
R='/home/ryha/runs/iFizBox/s1/tools/ui-15.sh'
def ui(*a): return subprocess.run([R,'F438a1',*a],capture_output=True,text=True,timeout=120).stdout
def els():
    out=[]
    for m in re.finditer(r'<XCUIElementType(Cell|Switch|Button)\b([^>]*)',ui('source')):
        a=dict(re.findall(r'(\w+)="([^"]*)"',m[2])); a['t']=m[1]; out.append(a)
    return out
def tap(a,right=False):
    x=int(a['x'])+(int(a['width'])-30 if right else int(a['width'])//2); y=int(a['y'])+int(a['height'])//2
    ui('tap',str(x*3),str(y*3))
def find(t,n):
    for e in els():
        if e['t']==t and (e.get('name')==n or e.get('name','').startswith(n+',')): return e
subprocess.run('cd ~/.local/share/ifizbox-rig; ios --udid=00008130-0018450C3661001C kill com.apple.Preferences',shell=True,capture_output=True)
ui('launch','com.apple.Preferences'); time.sleep(3)
for i in range(6):
    if find('Switch','VPN Status'): break
    b=find('Button','com.apple.settings.vpn')
    if b: tap(b)
    time.sleep(2)
else: sys.exit('no VPN page')
want=sys.argv[1]; print('Settings found:',find('Switch','VPN Status')['name'],'| selected:',[e['name'] for e in els() if e['t']=='Cell' and 'Selected' in e.get('traits','')])
def sw(): return find('Switch','VPN Status')
def sel(n): c=find('Cell',n); return c and 'Selected' in c.get('traits','')
if want=='ours':
    for i in range(6):
        if sw()['value']=='1': tap(sw()); time.sleep(3)
        elif not sel('iFizBox VPN'):
            tap({**find('Cell','iFizBox VPN'),'width':'200'}); time.sleep(3)
        else: break
    ok=sw()['value']=='0' and sel('iFizBox VPN')
else:
    for i in range(6):
        if not sel('Tailscale'): tap({**find('Cell','Tailscale'),'width':'200'}); time.sleep(3)
        elif sw()['value']!='1': tap(sw()); time.sleep(5)
        else: break
    time.sleep(2); ok=sel('Tailscale') and 'Connected' in sw()['name']
print('Settings:',want,'->',sw()['name'],'| selected:','iFizBox VPN' if sel('iFizBox VPN') else 'Tailscale' if sel('Tailscale') else '?','| ok' if ok else '| NOT OK'); sys.exit(not ok)
