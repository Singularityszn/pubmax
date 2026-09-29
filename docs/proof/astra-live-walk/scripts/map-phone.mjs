import { chromium } from "playwright";
const SHOTS="/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk/shots";
const b = await chromium.launch();
for (const mode of ["fast","slow4g"]) {
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p); await cdp.send("Network.enable");
if(mode==="slow4g"){ await cdp.send("Emulation.setCPUThrottlingRate",{rate:4}); await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:150,downloadThroughput:188743,uploadThroughput:86400,connectionType:"cellular4g"}); }
await p.addInitScript(()=>{ window.__marks=[]; const names=["pubmax:map-constructed","map-style-load","map-icons-ready","map-scene-built","pubs-source-loaded","pins-visible","pubmax:first-pins","pubmax:pin-reveal"];
  for(const n of names) window.addEventListener(n, ()=>window.__marks.push([n, Math.round(performance.now())])); });
const t0=Date.now();
await p.goto("https://pubmaxxing.com/map",{waitUntil:"domcontentloaded"});
let pins=null, tPin=null;
for(let i=0;i<80;i++){ pins = await p.evaluate(()=>window.__pubmaxPaintedMapTapPoints?window.__pubmaxPaintedMapTapPoints():null).catch(()=>null);
  if(pins&&pins.length){ tPin=Date.now()-t0; break; } await p.waitForTimeout(400); }
console.log(mode, "firstTappablePin_ms=", tPin, "pins=", pins?pins.length:0);
await p.waitForTimeout(2500);
await p.screenshot({path:`${SHOTS}/map-390-${mode}-loaded.png`});
console.log(mode, "perfmarks:", JSON.stringify(await p.evaluate(()=>performance.getEntriesByType("mark").map(m=>[m.name,Math.round(m.startTime)]).filter(m=>/pubmax|map|pin/i.test(m[0])))));
console.log(mode, "chrome:", JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll("button,a[href],[role=button]")].filter(e=>{const r=e.getBoundingClientRect();return r.width>2&&r.height>2&&r.top<844&&r.bottom>0&&r.left<390&&r.right>0;}).map(e=>((e.innerText||e.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,26))).filter(Boolean))));
if(mode==="fast" && pins&&pins.length){
  const target = pins.find(x=>x.kind==="pin")||pins[0];
  const t=Date.now(); await p.touchscreen.tap(target.x,target.y); await p.waitForTimeout(3500);
  console.log("pin tap ->", p.url(), (Date.now()-t)+"ms");
  await p.screenshot({path:`${SHOTS}/map-390-pin-sheet.png`});
  const tabs = await p.evaluate(()=>[...document.querySelectorAll("[role=tab],button")].map(e=>(e.innerText||"").trim()).filter(t=>/^(Overview|Photos|Drinks|Stories|Lore|Ask|Train|Last train)$/.test(t)));
  console.log("sheet tabs:", JSON.stringify(tabs));
  console.log("sheet text:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,900));
}
await ctx.close();
}
await b.close();
