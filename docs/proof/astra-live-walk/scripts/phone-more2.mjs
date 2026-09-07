import { chromium } from "playwright";
const SHOTS="/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk/shots";
const b = await chromium.launch();
const say=(...a)=>console.log(a.join(" "));
const mk=async()=>b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",locale:"en-GB",timezoneId:"Europe/London"});

// /tonight fold + chips
let c=await mk(); let p=await c.newPage();
await p.goto("https://pubmaxxing.com/tonight",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
await p.screenshot({path:`${SHOTS}/tonight-390-01.png`});
say("/tonight fold:", JSON.stringify(await p.evaluate(()=>{
  const tab=document.querySelector("[class*=mobileTabBar]"); const tr=tab?tab.getBoundingClientRect():null;
  const rows=[...document.querySelectorAll("li,article,[class*=Card],[class*=card]")].map(e=>({t:(e.innerText||"").replace(/\s+/g," ").trim().slice(0,60),y:Math.round(e.getBoundingClientRect().top)})).filter(x=>x.t.length>12);
  return { firstRowY: rows.length?rows[0].y:null, firstRow: rows.length?rows[0].t:null, tabTop: tr?Math.round(tr.top):null, vh:innerHeight, rowCount: rows.length };
})));
say("/tonight text:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,700));
const vibe=p.getByRole("button",{name:/Quiet pint/i}).first();
if(await vibe.count()){ const t=Date.now(); await vibe.tap().catch(()=>{}); await p.waitForTimeout(4000); say("vibe chip ->",(Date.now()-t)+"ms url="+p.url()); await p.screenshot({path:`${SHOTS}/tonight-390-02-vibe.png`}); say("after vibe:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,400)); }
await c.close();

// /out day chips
c=await mk(); p=await c.newPage();
await p.goto("https://pubmaxxing.com/out",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
await p.screenshot({path:`${SHOTS}/out-390-01.png`});
say("/out text:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,700));
for(const d of ["Tomorrow","Weekend"]){ const l=p.getByRole("link",{name:new RegExp("^"+d+"$")}).or(p.getByRole("button",{name:new RegExp("^"+d+"$")})).first();
  if(await l.count()){ const t=Date.now(); await l.tap().catch(()=>{}); await p.waitForTimeout(4000); say("/out "+d+" ->",p.url(),(Date.now()-t)+"ms", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,260)); } }
await p.screenshot({path:`${SHOTS}/out-390-02-weekend.png`});
await c.close();

// /spoons-value
c=await mk(); p=await c.newPage();
await p.goto("https://pubmaxxing.com/spoons-value",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
await p.screenshot({path:`${SHOTS}/spoons-390-01.png`});
say("/spoons text:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,600));
say("/spoons rows:", await p.evaluate(()=>document.querySelectorAll("tr,li").length));
const seeMap=p.getByRole("link",{name:/See it on the map/i}).first();
if(await seeMap.count()){ const t=Date.now(); await seeMap.tap().catch(()=>{}); await p.waitForTimeout(9000); say("spoons->map",p.url(),(Date.now()-t)+"ms"); await p.screenshot({path:`${SHOTS}/spoons-390-02-map.png`});
  say("map key:", (await p.evaluate(()=>{const k=[...document.querySelectorAll("*")].find(e=>/units|Spoons/.test(e.textContent||"")&&e.getBoundingClientRect().height<300&&e.getBoundingClientRect().height>20);return k?k.innerText.replace(/\n+/g," / ").slice(0,300):null;}))); }
await c.close();

// /crawls + /pubs
for (const route of ["/crawls","/pubs","/social"]) {
  c=await mk(); p=await c.newPage();
  await p.goto("https://pubmaxxing.com"+route,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
  await p.screenshot({path:`${SHOTS}/${route.slice(1)}-390-01.png`});
  say(route+" text:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,600));
  await c.close();
}
await b.close();
