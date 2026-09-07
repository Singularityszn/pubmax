import { chromium } from "playwright";
const SHOTS="/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk/shots";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
const say=(...a)=>console.log(a.join(" "));
p.on("pageerror", e=>say("PAGEERROR:", String(e).slice(0,160)));
await p.goto("https://pubmaxxing.com/",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(3500);
for (const name of ["Map","Places","Out","Social","You","Now"]) {
  const l = p.locator(`[class*=mobileTabBar] a`).filter({ hasText: new RegExp("^"+name+"$") }).first();
  const t=Date.now();
  try { await l.tap({timeout:8000}); } catch(e){ say("FAIL tab",name,String(e).slice(0,80)); continue; }
  await p.waitForTimeout(3200);
  say("TAB",name,"->",p.url(),(Date.now()-t)+"ms");
  await p.screenshot({path:`${SHOTS}/journey-390-tab-${name.toLowerCase()}.png`});
  const heads = await p.evaluate(()=>{const h=document.querySelector("h1");const m=document.querySelector("main")||document.body;return {h1:h?h.innerText.trim().slice(0,70):null, first:(m.innerText||"").split("\n").filter(Boolean).slice(0,6)};});
  say("   ", JSON.stringify(heads));
  if (name==="Map") continue;
  // return home for a consistent start
}
await p.screenshot({path:`${SHOTS}/journey-390-tabs-end.png`});
await b.close();
