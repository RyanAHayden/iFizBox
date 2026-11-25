// Writes the script F426d's capture.mjs runs: the bars' rects under each Sort, panel open and closed, in every era.
const FILL = `(async()=>{setInterval(()=>document.querySelectorAll('.banner').forEach(b=>b.remove()),100);
const {catalog}=await import('/catalog.js');const {createCatalog}=await import('/core/catalog.js');const {settings}=await import('/settings-store.js');
settings.set('device','iphoneos-arm64');
const c=createCatalog();const L='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
c.load('A',Array.from({length:60},(_,i)=>'Package: x.p'+i+'\\nName: '+L[(i*7)%26]+'pack '+i+'\\nVersion: 1\\nArchitecture: iphoneos-arm64\\nDescription: A test package\\nSection: '+['Tweaks','Themes','Utilities'][i%3]+(i%2?'\\nTag: cydia::commercial':'')+'\\n').join('\\n')+'\\n');
c.load('B',Array.from({length:30},(_,i)=>'Package: x.p'+i*2+'\\nName: '+L[(i*14)%26]+'pack '+i*2+'\\nVersion: 1\\nArchitecture: iphoneos-arm64\\nSection: Tweaks\\n').join('\\n')+'\\n');
const slow=(f)=>async(...a)=>f(...a);
Object.assign(catalog,{ensure:async()=>{},popular:slow((o)=>c.popular(o)),refine:slow((r,o)=>c.refine(r,o)),fresh:async()=>c.list().slice(0,40).map((r,i)=>({...r,seen:Date.now()-i*4e6})),sections:async()=>c.sections()});
return c.popular().length})()`;
const M = `(()=>{const t=document.querySelector('.page.is-top');const r=(e)=>{if(!e)return null;const b=e.getBoundingClientRect();return [b.left,b.top,b.width,b.height].map(x=>Math.round(x*10)/10)};
const q=(s)=>t.querySelector(s);const i=q('.section-index');const sc=q('.search-scope');const bar=JSON.stringify([r(sc),...[...sc.querySelectorAll('.scope-segment,.scope-filter')].map(r),r(q('.search-field'))]);const cut=[...sc.querySelectorAll(".scope-segment,.scope-filter")].filter(e=>e.scrollWidth>e.clientWidth).length;
const key=location.hash;const open=!!q('.scope-filter.done');const sel=open?'panel':'closed';globalThis.__b??={};const k2=key+(globalThis.__v||'');const pairs=JSON.parse(bar);
const same=k2 in __b?__b[k2]===bar:'first';__b[k2]??=bar;
let hit=null;if(i&&!open){const b=i.getBoundingClientRect();hit=[...i.children].every(s=>{const c=s.getBoundingClientRect();return i.contains(document.elementFromPoint(c.left+c.width/2,c.top+c.height/2))})}
return [document.documentElement.dataset.style,key,globalThis.__v,sel,'SAME',same,'barBottom',r(sc)[1]+r(sc)[3],'idx',r(i),'letterH',i&&r(i.firstChild)[3],'allHit',hit,'cut',cut,bar]})()`;
const out = [{ wait: 1500 }, { eval: "localStorage.setItem('ifizbox.firstVisit','later');1" }];
const m = { eval: M };
const sorts = (n, own, other) => {
  for (const s of [own, "Name", ...other, "Name"]) out.push({ tap: ".scope-filter", ms: 900 }, { drop: s }, m, { shot: `${n}-${s}-panel` }, { tap: ".scope-filter", ms: 900 }, m, { shot: `${n}-${s}` });
};
for (const style of (process.env.STYLES || "ios6,ios7,ios13,ios26").split(",")) {
  out.push({ eval: `localStorage.setItem('ifizbox.style','${style}');localStorage.setItem('ifizbox.appearance','dark');1` }, { nav: "#/home", ms: 2500 }, { eval: FILL }, { go: "#/home/browse" }, { wait: 800 });
  out.push({ tap: "text:Top 25" }, { eval: "__v='top'" }); sorts(style + "-top", "Most Sources", ["Newest"]);
  out.push({ tap: "text:New" }, { eval: "__v='new'" }); sorts(style + "-new", "Newest", ["Most Sources"]);
  out.push({ eval: "document.querySelector('.page.is-top .page-body').scrollTop=300;1" }, { wait: 300 }, { eval: M.replace("const key=", "globalThis.__v='scrolled';const key=") }, { shot: style + "-scrolled" },
    { eval: "document.body.classList.add('qr-stripped');document.querySelector('.page.is-top .page-body').scrollTop=0;__v='strip'" }, m, { eval: "document.body.classList.remove('qr-stripped');1" });
  out.push({ go: "#/home/browse/popular" }, { wait: 800 }, { eval: "__v='list'" }); sorts(style + "-list", "Most Sources", ["Newest"]);
}
console.log(JSON.stringify(out));
