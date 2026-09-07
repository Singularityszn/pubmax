import { chromium } from "playwright";
const b = await chromium.launch();
for(const [label,w,h,m] of [["phone",390,844,true],["desktop",1440,900,false]]){
for(let run=0;run<3;run++){
const ctx = await b.newContext({viewport:{width:w,height:h},isMobile:m,hasTouch:m,deviceScaleFactor:m?3:2,
  userAgent:m?"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1":undefined,locale:"en-GB",timezoneId:"Europe/London"});
const p=await ctx.newPage(); let n=0; p.on("request",()=>n++);
const t0=Date.now();
await p.goto("https://pubmaxxing.com/map",{waitUntil:"domcontentloaded"});
let ms=null;
for(let i=0;i<70;i++){ const c=await p.evaluate(()=>window.__pubmaxPaintedMapTapPoints?window.__pubmaxPaintedMapTapPoints().length:0).catch(()=>0); if(c){ms=Date.now()-t0;break;} await p.waitForTimeout(250); }
console.log(label,"run"+run,"pinReadyMs="+ms,"requestsAtPinReady="+n);
await ctx.close();
}}
await b.close();
