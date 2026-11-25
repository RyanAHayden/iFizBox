// Writes the capture.mjs script: Browse at 320 points in every era, with a small catalog made in the page.
const FILL = `(async()=>{setInterval(()=>document.querySelectorAll('.banner').forEach(b=>b.remove()),100);
const {catalog}=await import('/catalog.js');const {createCatalog}=await import('/core/catalog.js');const {settings}=await import('/settings-store.js');
settings.set('device','iphoneos-arm64');
const c=createCatalog();const L='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
c.load('A',Array.from({length:60},(_,i)=>'Package: x.p'+i+'\\nName: '+L[(i*7)%26]+'pack '+i+'\\nVersion: 1\\nArchitecture: iphoneos-arm64\\nDescription: A test package\\nSection: '+['Tweaks','Themes','Utilities'][i%3]+(i%2?'\\nTag: cydia::commercial':'')+'\\n').join('\\n')+'\\n');
c.load('B',Array.from({length:30},(_,i)=>'Package: x.p'+i*2+'\\nName: '+L[(i*14)%26]+'pack '+i*2+'\\nVersion: 1\\nArchitecture: iphoneos-arm64\\nSection: Tweaks\\n').join('\\n')+'\\n');
const slow=(f)=>async(...a)=>f(...a);
Object.assign(catalog,{ensure:async()=>{},popular:slow((o)=>c.popular(o)),refine:slow((r,o)=>c.refine(r,o)),fresh:async()=>c.list().slice(0,40).map((r,i)=>({...r,seen:Date.now()-i*4e6})),sections:async()=>c.sections()});
return c.popular().length})()`;
const FIT = `(()=>{const t=document.querySelector('.page.is-top');const b=t.querySelector('.browse-scope');const seg=[...b.querySelectorAll('.scope-segment,.scope-filter')];
const i=t.querySelector('.section-index'); const r=(e)=>{const x=e.getBoundingClientRect();return [x.left,x.right].map(Math.round)};
return {style:document.documentElement.dataset.style,theme:document.documentElement.dataset.theme,bar:r(b),segs:seg.map(e=>[e.textContent,...r(e),e.scrollWidth>e.clientWidth?'CUT':'ok']),index:i&&[r(i),getComputedStyle(i).visibility],scrollW:t.querySelector('.page-body').scrollWidth,top:t.querySelector('.page-body').scrollTop,rows:t.querySelector('.pkg-vlist')?.style.height,first:[...t.querySelectorAll('.pkg-row:not([hidden])')].slice(0,3).map(x=>x.textContent.slice(0,22)),note:t.querySelector('.empty')?.textContent}})()`;
const out = [{ wait: 1500 }, { eval: "localStorage.setItem('ifizbox.firstVisit','later');1" }];
const fit = { eval: FIT };
for (const style of ["ios6", "ios7", "ios13", "ios26"]) for (const look of ["light", "dark"]) {
  const n = `${style}-${look}`;
  out.push({ eval: `localStorage.setItem('ifizbox.style','${style}');localStorage.setItem('ifizbox.appearance','${look}');1` },
    { nav: "#/home", ms: 2500 }, { eval: FILL }, { go: "#/home/browse" }, { wait: 800 }, { shot: n + "-featured" },
    { tap: "text:Top 25", ms: 120 }, { shot: n + "-slide" }, { wait: 700 }, fit, { shot: n + "-top" },
    { eval: "document.querySelector('.page.is-top .page-body').scrollTop=20;1" }, { tap: ".scope-filter" }, fit, { shot: n + "-panel" },
    { drop: "Paid" }, { tap: ".scope-filter" }, fit, { shot: n + "-paid" },
    { tap: ".scope-filter" }, { drop: "Name" }, fit, { tap: ".scope-filter" }, fit, { shot: n + "-name" },
    { tap: "text:New" }, fit, { shot: n + "-new" }, { tap: "text:Featured", ms: 120 }, { shot: n + "-out" }, { wait: 600 }, fit);
}
console.log(JSON.stringify(out));
