// Writes the script F426d's capture.mjs runs: the A–Z index dragged down and back up in Top 25, New and a list
// opened from Browse; prints where the header, row and scroll disagree.
import { readFileSync } from "node:fs";
const b455 = readFileSync(new URL("../2026-11-25-b455-sort-keeps-bar/make.mjs", import.meta.url), "utf8");
const FILL = eval(b455.match(/const FILL = (`[\s\S]*?`);\n/)[1]);
// Drives the index with pointer events, one letter a frame, and reads what is drawn under the top of the window.
const DRAG = (label, fling) => `(async()=>{const t=document.querySelector('.page.is-top');const i=t.querySelector('.section-index');if(!i)return [${JSON.stringify(label)},'NO INDEX'];
const sc=i.previousElementSibling&&t.querySelector('[data-section-index]');const fr=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const list=sc.querySelector('.vlist'),st=list.querySelector('.vlist-sticky');const ls=[...i.children];
const ev=(n,s)=>{const b=s.getBoundingClientRect();i.dispatchEvent(new PointerEvent(n,{bubbles:true,cancelable:true,pointerId:1,clientX:b.left+5,clientY:b.top+b.height/2}))};
i.setPointerCapture=()=>{};
const winTop=()=>sc.getBoundingClientRect().top+(parseFloat(getComputedStyle(sc).paddingTop)||0);
const row=()=>{const y=winTop()+1;return [...list.querySelectorAll('.vlist-row,.vlist-header')].filter(e=>!e.hidden).find(e=>{const r=e.getBoundingClientRect();return r.top<=y&&r.bottom>y})};
const bad=[];let n=0;const max=()=>sc.scrollHeight-sc.clientHeight;
${fling ? "sc.scrollTo({top:max(),behavior:'smooth'});await new Promise(r=>setTimeout(r,150));" : ""}
ev('pointerdown',ls[26]);await fr();
for(const s of [...ls].reverse().concat(ls.slice(1),[...ls].reverse())){ev('pointermove',s);await fr();n++;
 const r=row();const l=r?(r.classList.contains('vlist-header')?r.textContent:r.querySelector('.cell-label')?.textContent[0]):null;const k=st.hidden?null:st.textContent;
 if(sc.scrollTop>0&&sc.scrollTop<max()-1&&l!==k)bad.push(s.textContent+': row '+l+' pinned '+k+' at '+sc.scrollTop);
 if(sc.scrollTop>0&&sc.scrollTop<max()-1&&!r?.classList.contains('vlist-header'))bad.push(s.textContent+': no header at the top');}
const top=sc.scrollTop;i.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));
return [document.documentElement.dataset.style,${JSON.stringify(label)},'jumps',n,'bad',bad.length,bad.slice(0,4),'end',top]})()`;
const out = [{ wait: 1500 }, { eval: "localStorage.setItem('ifizbox.firstVisit','later');1" }];
const name = [{ tap: ".scope-filter", ms: 900 }, { drop: "Name" }, { tap: ".scope-filter", ms: 900 }];
const drags = (l) => out.push({ eval: DRAG(l, false) }, { eval: DRAG(l + " mid-scroll", true) });
for (const style of ["ios6", "ios7", "ios13", "ios26"]) {
  out.push({ eval: `localStorage.setItem('ifizbox.style','${style}');localStorage.setItem('ifizbox.appearance','dark');1` }, { nav: "#/home", ms: 2500 }, { eval: FILL }, { go: "#/home/browse" }, { wait: 800 });
  out.push({ tap: "text:Top 25" }, ...name); drags("Top 25"); out.push({ shot: style + "-top" });
  out.push({ tap: "text:New" }, ...name); drags("New");
  out.push({ go: "#/home/browse/popular" }, { wait: 800 }, ...name); drags("list from Browse");
}
console.log(JSON.stringify(out));
