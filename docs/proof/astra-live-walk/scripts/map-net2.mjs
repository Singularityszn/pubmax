import { chromium } from "playwright";
const runs = [{w:1440,h:900,m:false,label:"desktop"},{w:390,h:844,m:true,label:"phone"}];
const b = await chromium.launch();
for (const r of runs){
const ctx = await b.newContext({ viewport:{width:r.w,height:r.h}, isMobile:r.m, hasTouch:r.m, deviceScaleFactor:r.m?3:2,
  userAgent: r.m ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1" : undefined,
  locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
const all=[]; const bad=[];
p.on("response", r2 => { all.push({s:r2.status(), u:r2.url()}); if(r2.status()>=400) bad.push(r2.status()+" "+r2.url()); });
await p.goto("https://pubmaxxing.com/map",{waitUntil:"domcontentloaded"});
await p.waitForTimeout(18000);
const cells = all.filter(x=>x.u.includes("venues_slim.cell")).length;
const tiles = all.filter(x=>x.u.includes("tiles.openfreemap")).length;
const ukbase = all.filter(x=>x.u.includes("uk_base")).length;
const chunks = all.filter(x=>x.u.includes("/_next/static")).length;
const bytes = await p.evaluate(()=>{const rs=performance.getEntriesByType("resource");let t=0,d=0;for(const x of rs){t+=x.transferSize||0;d+=x.decodedBodySize||0;}return {t:Math.round(t/1024),d:Math.round(d/1024)};});
console.log(r.label, "requests="+all.length, "slimCells="+cells, "tiles="+tiles, "ukBase="+ukbase, "nextChunks="+chunks, "transferKB="+bytes.t, "decodedKB="+bytes.d, "bad="+JSON.stringify(bad));
await ctx.close();
}
await b.close();
