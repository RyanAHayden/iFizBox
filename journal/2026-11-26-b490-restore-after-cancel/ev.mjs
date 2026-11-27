// (from F438a1; PAGE=<cdp page id> picks the page) node ev.mjs '<js>' : starts async js, waits for window.__r
const js=process.argv[2];const wait=+(process.argv[3]||15);
const l=await (await fetch('http://127.0.0.1:9333/json')).json();const p=process.env.PAGE?l.find(x=>x.id===process.env.PAGE):(l.find(x=>/ifizbox/i.test(x.url||'')||/iFizBox/.test(x.title||''))||l[0]);
if(!p){console.log('no page');process.exit(1)}
const ws=new WebSocket(p.webSocketDebuggerUrl);let n=0;const w=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);w.get(m.id)?.(m)};
await new Promise(r=>ws.onopen=r);
const ev=x=>new Promise(r=>{const id=++n;w.set(id,r);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:x,returnByValue:true}}));setTimeout(()=>r(null),5000)});
await ev('window.__r=undefined;(async()=>{try{window.__r=JSON.stringify(await (async()=>{'+js+'})())||"undefined"}catch(e){window.__r="ERR "+(e.message||e)}})();1');
for(let i=0;i<wait*2;i++){const r=await ev('window.__r');const v=r?.result?.result?.value;if(v!==undefined){console.log(v);process.exit(0)}await new Promise(r=>setTimeout(r,500))}
console.log('timeout');process.exit(2)
