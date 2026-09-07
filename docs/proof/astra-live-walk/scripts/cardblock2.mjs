import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",locale:"en-GB",timezoneId:"Europe/London"});
const p=await ctx.newPage();
await p.goto("https://pubmaxxing.com/map",{waitUntil:"domcontentloaded"});
await p.waitForTimeout(12000);
// what covers the viewport bands?
console.log("bands:", JSON.stringify(await p.evaluate(()=>{
  const out={}; for(const y of [120,220,320,420,520,600,660,700,760]){ const e=document.elementFromPoint(195,y); out[y]= e?(e.tagName+"."+String(e.className).split(" ")[0]).slice(0,44):null; }
  return out;})));
// tap a map point in the clear upper band and see if a pin opens
for (const y of [200,300,400,500]) {
  const before=p.url();
  await p.touchscreen.tap(195,y); await p.waitForTimeout(2200);
  console.log("tap 195,"+y+" -> "+p.url()+(p.url()!==before?"  [CHANGED]":""));
  if(p.url().includes("sel=")) break;
}
console.log("probe with card up:", await p.evaluate(()=>window.__pubmaxPaintedMapTapPoints?window.__pubmaxPaintedMapTapPoints().length:0));
await b.close();
