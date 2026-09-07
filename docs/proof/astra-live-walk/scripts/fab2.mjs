import { chromium } from "playwright";
const b = await chromium.launch();
for(const route of ["/tonight","/","/out","/crawls","/spoons-value"]){
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
await p.goto("https://pubmaxxing.com"+route,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
console.log(route, JSON.stringify(await p.evaluate(()=>{
  const fab=document.querySelector("[class*=createFab],[class*=CreateFab]") || [...document.querySelectorAll("button,a")].find(e=>{const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return cs.position==="fixed"&&r.width>40&&r.width<70&&Math.abs(r.width-r.height)<6&&r.top>500;});
  if(!fab) return {fab:null};
  const r=fab.getBoundingClientRect();
  const clash=[...document.querySelectorAll("button,a[href]")].filter(e=>{ if(e===fab||fab.contains(e)||e.contains(fab))return false; const q=e.getBoundingClientRect(); if(q.width<4||q.height<4)return false; return !(q.right<=r.left||q.left>=r.right||q.bottom<=r.top||q.top>=r.bottom); }).map(e=>(e.innerText||e.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,36));
  return { cls:String(fab.className).slice(0,40), box:{t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width)}, label:(fab.innerText||fab.getAttribute("aria-label")||"").trim().slice(0,20), overlaps: clash };
})));
await ctx.close();
}
await b.close();
