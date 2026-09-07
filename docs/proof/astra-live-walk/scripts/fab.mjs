import { chromium } from "playwright";
const b = await chromium.launch();
for(const route of ["/tonight","/","/today","/crawls","/out"]){
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
await p.goto("https://pubmaxxing.com"+route,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
console.log(route, JSON.stringify(await p.evaluate(()=>{
  const fab=[...document.querySelectorAll("button,a")].find(e=>/create|share a moment|^\+$/i.test((e.getAttribute("aria-label")||e.innerText||"").trim()));
  if(!fab) return {fab:null};
  const r=fab.getBoundingClientRect();
  const cx=r.left+r.width/2, cy=r.top+r.height/2;
  const hit=document.elementFromPoint(cx,cy);
  // what is UNDER the fab corners
  const under=[];
  for(const [x,y] of [[r.left-4,cy],[cx,r.top-4],[r.left+2,r.top+2]]) { const e=document.elementFromPoint(x,y); if(e) under.push((e.innerText||e.tagName).replace(/\s+/g," ").trim().slice(0,40)); }
  // any interactive element overlapping the fab box?
  const clash=[...document.querySelectorAll("button,a[href]")].filter(e=>{ if(e===fab||fab.contains(e))return false; const q=e.getBoundingClientRect(); if(q.width<4)return false; return !(q.right<r.left||q.left>r.right||q.bottom<r.top||q.top>r.bottom); }).map(e=>({t:(e.innerText||e.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,34), r:Math.round(e.getBoundingClientRect().right)}));
  return { fab:{t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)}, hitIsFab: hit===fab||fab.contains(hit), under, overlappingControls: clash };
})));
await ctx.close();
}
await b.close();
