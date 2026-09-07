import { chromium } from "playwright";
const SHOTS="/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk/shots";
const b = await chromium.launch();
const say=(...a)=>console.log(a.join(" "));
const mk=async(w,h,m)=>b.newContext({viewport:{width:w,height:h},isMobile:m,hasTouch:m,deviceScaleFactor:m?3:2,
  userAgent:m?"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1":undefined,locale:"en-GB",timezoneId:"Europe/London"});

// /plan at 390 - stop count chips
let c=await mk(390,844,true); let p=await c.newPage();
p.on("pageerror",e=>say("PAGEERROR /plan:",String(e).slice(0,150)));
await p.goto("https://pubmaxxing.com/plan",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
await p.screenshot({path:`${SHOTS}/plan-390-01.png`});
say("/plan h1:", await p.evaluate(()=>document.querySelector("h1")?.innerText?.slice(0,70)));
say("/plan body:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,600));
say("/plan chips:", JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll("button")].filter(b=>/^[1-8]$/.test((b.innerText||"").trim())).map(b=>{const r=b.getBoundingClientRect();return{t:b.innerText.trim(),w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.left),y:Math.round(r.top),radius:getComputedStyle(b).borderRadius,pressed:b.getAttribute("aria-pressed")};}))));
// try a describe chip
const chip = p.getByRole("button",{name:/cheap|quiet|pint/i}).first();
if(await chip.count()){ const t=Date.now(); await chip.tap().catch(()=>{}); await p.waitForTimeout(9000); say("plan chip tap ->", (Date.now()-t)+"ms url="+p.url()); await p.screenshot({path:`${SHOTS}/plan-390-02-generated.png`}); say("plan result:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,700)); }
await c.close();

// /near find my pint at 390 (deny geolocation)
c=await mk(390,844,true); p=await c.newPage();
await p.goto("https://pubmaxxing.com/near",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(4000);
await p.screenshot({path:`${SHOTS}/near-390-01.png`});
const fm=p.getByRole("button",{name:/Find my pint/i}).first();
if(await fm.count()){ await fm.tap().catch(()=>{}); await p.waitForTimeout(5000); say("/near after Find my pint (geo denied):", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,500)); await p.screenshot({path:`${SHOTS}/near-390-02-denied.png`}); }
// pick a patch
const soho=p.getByRole("button",{name:/^Soho$/}).or(p.getByRole("link",{name:/^Soho$/})).first();
if(await soho.count()){ await soho.tap().catch(()=>{}); await p.waitForTimeout(4000); say("/near Soho ->", p.url(), (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,450)); await p.screenshot({path:`${SHOTS}/near-390-03-soho.png`}); }
await c.close();

// /pal at 390
c=await mk(390,844,true); p=await c.newPage();
p.on("pageerror",e=>say("PAGEERROR /pal:",String(e).slice(0,150)));
await p.goto("https://pubmaxxing.com/pal",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(4000);
await p.screenshot({path:`${SHOTS}/pal-390-01.png`});
say("/pal body:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,500));
const meet=p.getByRole("button",{name:/Meet your Pub Pal/i}).first();
if(await meet.count()){ await meet.tap().catch(()=>{}); await p.waitForTimeout(4500); say("/pal after Meet ->", p.url()); say("/pal body2:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,700)); await p.screenshot({path:`${SHOTS}/pal-390-02.png`}); }
await c.close();

// /u/karan
c=await mk(390,844,true); p=await c.newPage();
await p.goto("https://pubmaxxing.com/u/karan",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(4500);
await p.screenshot({path:`${SHOTS}/u-karan-390.png`});
say("/u/karan:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,600));
await c.close();
await b.close();
