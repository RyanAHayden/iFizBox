import {writeFileSync} from "node:fs"; const d=process.argv[2];
const t=[["glint","Glint","Shine for your status bar",1],["deck","Deck","A new dock",1],["drift","Drift","Live wallpapers",0],["betteralarm","betterAlarm","A beautiful timer and alarm screen",1],["ryd","Return YouTube Dislike","Shows dislikes",0],["rytm","Return YTM dislikes","Shows dislikes",0],["ygs","YouGroupSettings","Groups settings",0],["any","AnyFont","A font everywhere",0],["ytpaid","Tube Pro","Extras for YouTube",1],["bought","Bought","Bought and checked",1]];
writeFileSync(d+"/Packages",t.map(([i,n,s,p])=>`Package: com.c.${i}\nName: ${n}\nVersion: 1.0\nArchitecture: iphoneos-arm64\nSection: Tweaks\nDepends: mobilesubstrate, firmware (>= 15.0)\n${p?"Tag: cydia::commercial\n":""}Description: ${s}\nFilename: debs/${i}.deb\n`).join("\n"));
writeFileSync(d+"/Release","Origin: Chariz-like\nLabel: Chariz-like\nSuite: stable\nVersion: 1\nCodename: ios\nArchitectures: iphoneos-arm64\nComponents: main\n");
const png="data:image/svg+xml,x";
writeFileSync(d+"/sileo-featured.json",JSON.stringify({class:"FeaturedBannersView",itemSize:"{263, 148}",itemCornerRadius:10,banners:["glint","ryd","deck","ytpaid","betteralarm"].map(i=>({url:`http://127.0.0.1:8747/b.svg?${i}`,title:i,package:"com.c."+i,displayText:true}))}));
writeFileSync(d+"/b.svg",'<svg xmlns="http://www.w3.org/2000/svg" width="263" height="148"><rect width="263" height="148" fill="#456"/></svg>');
writeFileSync(d+"/../script.json",JSON.stringify([
 {wait:2000},{eval:"localStorage.setItem('ifizbox.firstVisit','later');localStorage.setItem('ifizbox.tweakInfo',JSON.stringify(Object.fromEntries(['ryd','rytm','ygs','any','bought'].map(x=>['com.c.'+x+'@1.0',{v:2,ok:true,bundles:[],anyApp:true}]))));'ok'"},
 {nav:"#/sources",ms:5000},{eval:"import('./backend.js').then(m=>m.getBackend().addSource('http://127.0.0.1:8747/')).then(r=>'added '+r.key, e=>'err '+e.message)"},
 {nav:"#/sources",ms:8000},{eval:"setInterval(()=>document.querySelectorAll('.banner').forEach(b=>b.remove()),200);'ok'"},
 {eval:"document.querySelector('.page.is-top')?.innerText.slice(0,900)"},
 {tap:"text:All Sources",ms:4000},{tap:"text:App Tweaks",ms:3000},{eval:"document.querySelector('.page.is-top')?.innerText.slice(0,1500)"},{shot:"app-tweaks"},
 {eval:"import('./catalog.js').then(async m=>JSON.stringify([(await m.catalog.search('glint')).length,(await m.catalog.search('dislike')).length]))"},
 {nav:"#/sources",ms:3000},{tap:"text:Chariz-like",ms:5000},{eval:"document.querySelector('.page.is-top')?.innerText.slice(0,900)"},
 {eval:"JSON.stringify([...document.querySelectorAll('.page.is-top .featured-banner')].map(b=>b.getAttribute('href')||b.textContent))"},{shot:"source-page"}]));
