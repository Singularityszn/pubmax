import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
await p.goto("https://pubmaxxing.com/pubs",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(9000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const imgs=[...document.querySelectorAll("img")].map(i=>({src:i.currentSrc.replace(location.origin,"").slice(0,60), nat:i.naturalWidth+"x"+i.naturalHeight, css:Math.round(i.getBoundingClientRect().width)+"x"+Math.round(i.getBoundingClientRect().height), loading:i.loading, proxied:i.currentSrc.includes("image-proxy")}));
  const proxied=imgs.filter(i=>i.proxied);
  return { total:imgs.length, proxied:proxied.length, sample:proxied.slice(0,5) };
}),null,1));
const bytes = await p.evaluate(()=>{const r=performance.getEntriesByType("resource").filter(x=>x.name.includes("image-proxy"));return {n:r.length, kb:Math.round(r.reduce((a,b)=>a+(b.transferSize||0),0)/1024)};});
console.log("image-proxy:", JSON.stringify(bytes));
await b.close();
