import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" });
const p = await c.newPage();
await p.goto("https://pubmaxxing.com/tonight",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(4000);
await p.goto("https://pubmaxxing.com/today",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const btn=[...document.querySelectorAll("button")].find(b=>/No thanks/.test(b.innerText||""));
  let card=btn; for(let i=0;i<6&&card;i++){ const r=card.getBoundingClientRect(); if(r.width>=innerWidth-1) break; card=card.parentElement; }
  const cr=card.getBoundingClientRect(); const cs=getComputedStyle(card);
  const tab=document.querySelector("nav[class*=mobileTabBar], [class*=mobileTabBar]");
  const tr=tab?tab.getBoundingClientRect():null; const ts=tab?getComputedStyle(tab):null;
  const allow=[...document.querySelectorAll("button")].find(b=>/^Allow$/.test((b.innerText||"").trim()));
  const ar=allow?allow.getBoundingClientRect():null;
  return { cardClass: card.className, cardRect:{t:Math.round(cr.top),b:Math.round(cr.bottom),l:cr.left,w:cr.width}, cardStyle:{pos:cs.position, radius:cs.borderRadius, bg:cs.backgroundColor, bt:cs.borderTopWidth, bottom:cs.bottom, pb:cs.paddingBottom, z:cs.zIndex},
    tab: tr?{t:Math.round(tr.top),b:Math.round(tr.bottom),pos:ts.position,z:ts.zIndex}:null,
    gapPx: tr? Math.round(tr.top - cr.bottom): null,
    allowBtn: ar?{w:Math.round(ar.width),h:Math.round(ar.height)}:null,
    docHeight: document.documentElement.scrollHeight, scrollY: window.scrollY };
}),null,1));
await p.screenshot({path:"/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk/shots/consent-390-dock-detail.png"});
await b.close();
