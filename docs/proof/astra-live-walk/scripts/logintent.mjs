import { chromium } from "playwright";
const SHOTS="/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk/shots";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
await p.goto("https://pubmaxxing.com/map?sel=venue-eltcmh&log=1",{waitUntil:"domcontentloaded"});
await p.waitForTimeout(11000);
await p.screenshot({path:`${SHOTS}/logintent-390-01-composer.png`});
console.log(JSON.stringify(await p.evaluate(()=>{
  const at=(x,y)=>{const e=document.elementFromPoint(x,y);return e?(e.tagName+"."+String(e.className).split(" ").slice(0,3).join(".")).slice(0,90):null;};
  const tabs=[...document.querySelectorAll("[class*=mobileTabBar] a")].map(a=>{const r=a.getBoundingClientRect();return {t:a.innerText.trim(),cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2),hit:at(r.left+r.width/2, r.top+r.height/2)};});
  const bar=document.querySelector("[class*=mobileTabBar]");
  const bs=bar?getComputedStyle(bar):null;
  const sheet=document.querySelector("[class*=mobileSharedSheet],[class*=Sheet]");
  const sr=sheet?sheet.getBoundingClientRect():null;
  const back=[...document.querySelectorAll("button,a")].filter(e=>/back|close|dismiss/i.test((e.getAttribute("aria-label")||e.innerText||""))).map(e=>{const r=e.getBoundingClientRect();return {t:(e.getAttribute("aria-label")||e.innerText).replace(/\s+/g," ").trim().slice(0,30),vis:r.height>0,y:Math.round(r.top)};});
  return { tabs, barTransform: bs?bs.transform:null, barVisibility: bs?bs.visibility:null, barDisplay: bs?bs.display:null,
    sheetRect: sr?{t:Math.round(sr.top),b:Math.round(sr.bottom),h:Math.round(sr.height)}:null, back, vh:innerHeight };
}),null,1));
console.log("TEXT:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,1400));
await b.close();
