import json,sys
style=sys.argv[1]
src=open("journal/2026-11-23-b361-ipa-details-page/capture.mjs").read()
src=src.replace('  "apps.isInstalled": (', '''  "signing.installed": () => ({ apps: process.env.UNSIGNED ? [] : [{ bundleId: "com.me.fixture.TEAM", originalBundleId: "com.me.fixture", name: "Delta", version: "1.5", expires: "2027-06-01T00:00:00Z", tweaks: [] }] }),
  "apps.isInstalled": (''',1)
src=src.replace("const top=document.querySelector('.page.is-top')??document","const top=q.startsWith('.nav-item')?document:document.querySelector('.page.is-top')??document").replace('ios: "15.8.8", jailbreak: "rootless"','ios: process.env.IOS || "27.0", jailbreak: null').replace("CPU iPhone OS 18_1","CPU iPhone OS 26_0").replace("Version/18.1","Version/26.0")
out=sys.argv[2]
open(out+"/capture.mjs","w").write(src)
badge="'badge: ' + [...document.querySelectorAll('#tabbar .badge')].map(b=>b.textContent+(b.hidden?'(hidden)':'')).join('|') + ' | sheets: ' + document.querySelectorAll('.confirm-sheet').length + ' | ' + document.querySelector('.page.is-top')?.innerText.slice(0,260)"
confirm="'confirm: ' + document.querySelector('.confirm-sheet')?.innerText"
steps=[{"wait":1500},
{"eval":"localStorage.setItem('ifizbox.firstVisit','later'); localStorage.setItem('ifizbox.tweakInfo', JSON.stringify({'com.example.fixture@1.0': {ok: true, bundles: ['com.me.fixture']}})); import('./settings-store.js').then(m=>{ (m.settings??m.default).set('style', %s); return 'ok'},e=>'err '+e.message)"%json.dumps(style)},
{"nav":"#/sources","ms":5000},
{"eval":"import('./backend.js').then(m=>m.getBackend().addSource('http://127.0.0.1:8861/')).then(r=>'added', e=>'err '+e.message)"},
{"nav":"#/installed/myipas","ms":6000},
{"eval":"setInterval(()=>document.querySelectorAll('.banner').forEach(b=>b.remove()),200); document.documentElement.dataset.style"},
{"tap":"text:Delta","ms":3000},{"tap":"text:Add Tweaks","ms":3500},{"tap":".tw-row-add","ms":3000},
{"eval":badge},{"shot":style+"-1-added"},
{"tap":"text:Fixture Tweak","ms":3500},
{"eval":"document.querySelector('.nav-item.is-top')?.innerText + '|' + document.querySelector('.page.is-top .tweak-works')?.innerText"},
{"tap":"text:Add to App…","ms":2500},{"eval":confirm},{"shot":style+"-2-confirm"},
{"eval":"import('./app-queue.js').then(m=>JSON.stringify(m.appQueue.list()))"},
{"clicktext":"Continue Queuing","ms":1500},
{"eval":"import('./app-queue.js').then(m=>{m.appQueue.clearAll(); return import('./screens/tweaks.js')}).then(t=>t.saveTweaks('com.me.fixture',[])).then(()=>'cleared')"},
{"tap":".nav-item.is-top .nav-right .bar-button","ms":3000},{"eval":confirm},
{"clicktext":"Continue Queuing","ms":1500},
{"swipe":True,"ms":2500},{"eval":badge},{"shot":style+"-3-back"},
{"tap":".tw-row-add","ms":1500},{"eval":"document.querySelector('.action-sheet,[role=dialog]')?.innerText ?? [...document.body.children].map(e=>e.className+':'+(e.innerText??'').slice(0,80)).join(' ## ')"},{"shot":style+"-4-remove"},
{"clicktext":"Remove","ms":2500},{"eval":badge}]
json.dump(steps,open(out+"/"+style+".json","w"),indent=1)
