import { chromium } from "playwright";
const b = await chromium.launch();
for (const route of ["/spoons-value","/pubs","/crawls"]){
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage(); const reqs=[];
p.on("request", r=>reqs.push(r.url()));
await p.goto("https://pubmaxxing.com"+route,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(4000);
const before = reqs.length;
for(let i=0;i<12;i++){ await p.mouse.wheel(0,900); await p.waitForTimeout(700); }
await p.waitForTimeout(4000);
const rsc = reqs.filter(u=>u.includes("_rsc="));
const mapsel = rsc.filter(u=>u.includes("/map"));
const kb = await p.evaluate(()=>{const r=performance.getEntriesByType("resource");let t=0;for(const x of r)t+=x.transferSize||0;return Math.round(t/1024);});
console.log(route, "totalReq="+reqs.length, "beforeScroll="+before, "rscPrefetch="+rsc.length, "rscToMap="+mapsel.length, "transferKB="+kb);
if(mapsel.length) console.log("   sample:", mapsel.slice(0,3).map(u=>u.replace("https://pubmaxxing.com","").slice(0,60)).join(" | "));
await ctx.close();
}
await b.close();
