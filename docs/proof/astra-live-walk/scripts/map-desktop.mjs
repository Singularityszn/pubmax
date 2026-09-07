import { chromium } from "playwright";
const SHOTS="/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk/shots";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1440,height:900}, deviceScaleFactor:2, locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
const log=[]; const say=(...a)=>{const s=a.join(" ");log.push(s);console.log(s);};
p.on("console", m => { if(m.type()==="error") say("CONSOLE-ERR:", m.text().slice(0,200)); });
p.on("pageerror", e => say("PAGEERROR:", String(e).slice(0,200)));

await p.goto("https://pubmaxxing.com/map", { waitUntil:"domcontentloaded" });
const t0=Date.now();
// wait for painted pins probe
let pins=null;
for(let i=0;i<60;i++){
  pins = await p.evaluate(()=> (window.__pubmaxPaintedMapTapPoints ? window.__pubmaxPaintedMapTapPoints() : null)).catch(()=>null);
  if(pins && pins.length) break;
  await p.waitForTimeout(500);
}
say("firstTappablePin_ms=", Date.now()-t0, "count=", pins?pins.length:0);
await p.screenshot({path:`${SHOTS}/map-1440-01-loaded.png`});

// Filters control
const filters = p.getByRole("button", { name: /^Filters/ });
say("Filters visible:", await filters.isVisible().catch(()=>false), "name:", await filters.getAttribute("aria-label").catch(()=>null));
await filters.click();
await p.waitForTimeout(1200);
await p.screenshot({path:`${SHOTS}/map-1440-02-filters-open.png`});
const panel = await p.evaluate(()=>{
  const els=[...document.querySelectorAll("button,[role=switch],[role=checkbox],input")].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;});
  return els.map(e=>({t:(e.innerText||e.getAttribute("aria-label")||"").trim().slice(0,40), pressed:e.getAttribute("aria-pressed"), checked:e.getAttribute("aria-checked")})).filter(x=>x.t).slice(0,50);
});
say("controls-after-filters:", JSON.stringify(panel));

// toggle one kind
const clubs = p.getByRole("button", { name: /^Bars/i }).first();
say("kind-chip-states:", JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll("button")].filter(b=>/Pints|Bars|Clubs|Food|Restaurants/.test(b.getAttribute("aria-label")||b.innerText||"")).map(b=>({t:(b.getAttribute("aria-label")||b.innerText||"").replace(/\s+/g," ").trim().slice(0,50),dis:b.getAttribute("aria-disabled"),pr:b.getAttribute("aria-pressed")})))));
if(await clubs.count() && await clubs.isEnabled().catch(()=>false)){ await clubs.click(); await p.waitForTimeout(800); say("after Clubs toggle, Filters label:", await p.evaluate(()=>{const b=[...document.querySelectorAll("button")].find(x=>/^Filters/.test(x.innerText||""));return b?b.innerText.replace(/\s+/g," "):null;})); }
await p.screenshot({path:`${SHOTS}/map-1440-03-filters-toggled.png`});
await p.keyboard.press("Escape"); await p.waitForTimeout(600);

// Layers
const layers = p.getByRole("button", { name: /^Layers/ }).first();
if(await layers.count()){ await layers.click(); await p.waitForTimeout(1000); await p.screenshot({path:`${SHOTS}/map-1440-04-layers.png`});
  say("layers-panel:", JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll("button,[role=switch]")].map(e=>(e.innerText||e.getAttribute("aria-label")||"").trim().replace(/\s+/g," ").slice(0,40)).filter(Boolean).slice(0,60))));
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
}
// Drink lens
const drink = p.getByRole("button", { name: /Drink: Pints|Drink:/ }).first();
if(await drink.count()){ await drink.click(); await p.waitForTimeout(900); await p.screenshot({path:`${SHOTS}/map-1440-05-drinklane.png`});
  say("drink-lane:", JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll("button")].map(e=>(e.innerText||"").trim().replace(/\s+/g," ").slice(0,30)).filter(Boolean).slice(0,40))));
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
}
// tap a pin
pins = await p.evaluate(()=> window.__pubmaxPaintedMapTapPoints ? window.__pubmaxPaintedMapTapPoints() : null);
say("pins-now=", pins?pins.length:0, JSON.stringify(pins?pins.slice(0,3):null));
if(pins && pins.length){
  // prefer non-cluster
  const target = pins.find(x=>x.kind==="pin") || pins[0];
  const tClick=Date.now();
  await p.mouse.click(target.x, target.y);
  await p.waitForTimeout(2500);
  say("after-pin-click url=", p.url(), " ms=", Date.now()-tClick);
  await p.screenshot({path:`${SHOTS}/map-1440-06-pin-clicked.png`});
  say("sheet-text:", (await p.evaluate(()=>{const d=document.querySelector("[class*=venueSheet],[class*=inspector],aside,[role=dialog]"); return d?d.innerText.slice(0,700):document.body.innerText.slice(0,300);})).replace(/\n/g," / "));
}
await b.close();
console.log("---END---");
