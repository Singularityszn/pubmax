import { chromium } from "playwright";
const SHOTS="/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk/shots";
const b = await chromium.launch();
const mk = async () => { const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" }); return c; };
const probe = async (p) => p.evaluate(()=>{
  const el=[...document.querySelectorAll("*")].find(e=>/No thanks/.test(e.textContent||"")&&e.querySelector("button")&&e.getBoundingClientRect().height<400&&e.getBoundingClientRect().height>30);
  if(!el) return null; const r=el.getBoundingClientRect();
  const tab=document.querySelector("[class*=mobileTabBar]"); const tr=tab?tab.getBoundingClientRect():null;
  const cs=getComputedStyle(el);
  return { top:Math.round(r.top), bottom:Math.round(r.bottom), h:Math.round(r.height), left:Math.round(r.left), right:Math.round(r.right), vw:innerWidth, vh:innerHeight, tabTop: tr?Math.round(tr.top):null, radius:cs.borderRadius, shadow:cs.boxShadow.slice(0,40), backdrop:cs.backdropFilter, text:(el.innerText||"").replace(/\n/g," / ").slice(0,160) };
});

// A: arrive on / and wait
let c = await mk(); let p = await c.newPage();
await p.goto("https://pubmaxxing.com/", {waitUntil:"domcontentloaded"});
for(const t of [1000,3000,6000,10000]){ await p.waitForTimeout(t===1000?1000:t===3000?2000:t===6000?3000:4000);
  console.log("A / after "+t+"ms consent="+JSON.stringify(await probe(p))); }
await p.screenshot({path:`${SHOTS}/consent-390-A-home-firstvisit.png`});
// then go to a second route via tab bar
const mapTab = p.getByRole("link", { name: /^Map$/ }).first();
if(await mapTab.count()) { await mapTab.click(); await p.waitForTimeout(6000); }
console.log("A after 2nd route ("+p.url()+") consent="+JSON.stringify(await probe(p)));
await p.screenshot({path:`${SHOTS}/consent-390-B-second-route.png`});
await c.close();

// B: fresh, straight to /tonight then /today
c = await mk(); p = await c.newPage();
await p.goto("https://pubmaxxing.com/tonight",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
console.log("B /tonight consent="+JSON.stringify(await probe(p)));
await p.goto("https://pubmaxxing.com/today",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
console.log("B /today (hard nav 2nd route) consent="+JSON.stringify(await probe(p)));
await p.screenshot({path:`${SHOTS}/consent-390-C-today.png`});
await c.close();
await b.close();
