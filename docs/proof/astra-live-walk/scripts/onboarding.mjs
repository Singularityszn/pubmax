import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
p.on("framenavigated", f => { if (f === p.mainFrame()) console.log("NAV", Date.now()%100000, f.url()); });
await p.goto("https://pubmaxxing.com/onboarding", { waitUntil:"domcontentloaded" });
console.log("t0 h1:", await p.evaluate(()=>document.querySelector("h1")?.innerText));
for (const ms of [500,1000,2000,4000,7000]) {
  await p.waitForTimeout(ms===500?500:ms - (ms===1000?500:ms===2000?1000:ms===4000?2000:4000));
  console.log(ms+"ms url="+p.url()+" h1="+JSON.stringify(await p.evaluate(()=>document.querySelector("h1")?.innerText?.slice(0,60))));
}
await p.screenshot({ path:"/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk/shots/onboarding-390-final.png" });
console.log("body:", (await p.evaluate(()=>document.body.innerText)).slice(0,500).replace(/\n/g," / "));
await b.close();
