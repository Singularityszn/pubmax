import { chromium } from "playwright";
const b = await chromium.launch();
for(let run=0;run<3;run++){
const ctx = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",locale:"en-GB",timezoneId:"Europe/London"});
const p=await ctx.newPage();
await p.goto("https://pubmaxxing.com/map",{waitUntil:"domcontentloaded"});
await p.waitForTimeout(12000);
const r = await p.evaluate(()=>{
  const card=[...document.querySelectorAll("*")].find(e=>/FIRST VISIT/.test(e.textContent||"")&&e.getBoundingClientRect().height>60&&e.getBoundingClientRect().height<420);
  const cr=card?card.getBoundingClientRect():null;
  const probe=window.__pubmaxPaintedMapTapPoints?window.__pubmaxPaintedMapTapPoints():[];
  return { cardBox: cr?{t:Math.round(cr.top),b:Math.round(cr.bottom),l:Math.round(cr.left),r:Math.round(cr.right),coversPct:Math.round((cr.height*cr.width)/(innerWidth*innerHeight)*100)}:null, probePins: probe.length };
});
console.log("run"+run, JSON.stringify(r));
// dismiss then re-probe
const close=p.getByRole("button",{name:/^Close$/}).first();
if(await close.count()){ await close.tap().catch(()=>{}); await p.waitForTimeout(1500); }
console.log("  after dismiss probePins=", await p.evaluate(()=>window.__pubmaxPaintedMapTapPoints?window.__pubmaxPaintedMapTapPoints().length:0));
await ctx.close();
}
await b.close();
