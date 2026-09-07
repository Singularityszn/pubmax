import { chromium } from "playwright";
const SHOTS="/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk/shots";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
const say=(...a)=>console.log(a.join(" "));
p.on("pageerror", e=>say("PAGEERROR:", String(e).slice(0,180)));
p.on("console", m=>{ if(m.type()==="error") say("CONSOLE-ERR:", m.text().slice(0,180)); });
const tap = async (loc, label) => { const t=Date.now(); try { await loc.tap({timeout:8000}); } catch(e){ try{await loc.click({timeout:6000});}catch(e2){ say("TAP-FAIL", label, String(e2).slice(0,90)); return -1; } } await p.waitForTimeout(1400); say("TAP", label, "->", p.url(), (Date.now()-t)+"ms"); return Date.now()-t; };

// 1. Home
await p.goto("https://pubmaxxing.com/",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(4000);
await p.screenshot({path:`${SHOTS}/journey-390-01-home.png`});
say("home fold controls:", JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll("a,button")].filter(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.top<844&&r.bottom>0;}).map(e=>({t:(e.innerText||e.getAttribute("aria-label")||"").replace(/\s+/g," ").trim().slice(0,32),y:Math.round(e.getBoundingClientRect().top)})).filter(x=>x.t))));

// 2. primary action
await tap(p.locator("[data-primary-action]").first(), "primary(Still £6.50?)");
await p.waitForTimeout(3500);
await p.screenshot({path:`${SHOTS}/journey-390-02-after-primary.png`});
say("after primary body:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," / ").slice(0,400));

// 3. price chips at 390 in composer
const chipInfo = await p.evaluate(()=>{
  const chips=[...document.querySelectorAll("button")].filter(b=>/^£\d/.test((b.innerText||"").trim()));
  return chips.map(c=>{const r=c.getBoundingClientRect();return {t:c.innerText.trim(),x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};});
});
say("priceChips:", JSON.stringify(chipInfo));
const rows = {}; for(const c of chipInfo){ rows[c.y]=(rows[c.y]||0)+1; }
say("priceChip rows:", JSON.stringify(rows));

// 4. tab bar tour
for (const name of ["Map","Places","Out","Social","You","Now"]) {
  const l = p.getByRole("link",{name:new RegExp("^"+name+"$")}).first();
  await tap(l, "tab:"+name);
  await p.waitForTimeout(2200);
  await p.screenshot({path:`${SHOTS}/journey-390-tab-${name.toLowerCase()}.png`});
}
await b.close();
