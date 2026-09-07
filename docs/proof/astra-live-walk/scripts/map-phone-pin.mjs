import { chromium } from "playwright";
const SHOTS="/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk/shots";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
await p.goto("https://pubmaxxing.com/map",{waitUntil:"domcontentloaded"});
for(let i=0;i<60;i++){ const x=await p.evaluate(()=>window.__pubmaxPaintedMapTapPoints?window.__pubmaxPaintedMapTapPoints().length:0); if(x) break; await p.waitForTimeout(400); }
await p.waitForTimeout(2000);
const card = await p.evaluate(()=>{const el=[...document.querySelectorAll("*")].find(e=>/FIRST VISIT/.test(e.textContent||"")&&e.getBoundingClientRect().height<400&&e.getBoundingClientRect().height>50); if(!el)return null; const r=el.getBoundingClientRect(); return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),r:Math.round(r.right),h:Math.round(r.height),vh:innerHeight,pct:Math.round(r.height/innerHeight*100)};});
console.log("firstVisitCard:", JSON.stringify(card));
let pins = await p.evaluate(()=>window.__pubmaxPaintedMapTapPoints());
console.log("pins before dismiss:", pins.length, JSON.stringify(pins.map(x=>({k:x.kind,x:Math.round(x.x),y:Math.round(x.y)}))));
// dismiss
const close = p.getByRole("button",{name:/^Close$/}).first();
if(await close.count()){ await close.tap(); await p.waitForTimeout(1500); }
pins = await p.evaluate(()=>window.__pubmaxPaintedMapTapPoints());
console.log("pins after dismiss:", pins.length);
await p.screenshot({path:`${SHOTS}/map-390-after-dismiss.png`});
const t=pins.find(x=>x.kind==="pin")||pins[0];
console.log("tapping", JSON.stringify(t));
const t0=Date.now(); await p.touchscreen.tap(t.x,t.y); await p.waitForTimeout(3500);
console.log("-> url", p.url(), (Date.now()-t0)+"ms");
await p.screenshot({path:`${SHOTS}/map-390-pin-sheet.png`});
console.log("sheet:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,900));
console.log("sheetGeom:", JSON.stringify(await p.evaluate(()=>{const s=document.querySelector("[class*=mobileSharedSheet]");if(!s)return null;const r=s.getBoundingClientRect();return {t:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height),vh:innerHeight};})));
await b.close();
