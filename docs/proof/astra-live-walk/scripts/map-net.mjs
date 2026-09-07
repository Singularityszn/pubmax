import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1440,height:900}, locale:"en-GB", timezoneId:"Europe/London" });
const p = await ctx.newPage();
const bad=[]; const all=[];
p.on("response", async r => { all.push({s:r.status(), u:r.url()}); if(r.status()>=400) bad.push({s:r.status(), u:r.url(), body:(await r.text().catch(()=>"")).slice(0,300)}); });
await p.goto("https://pubmaxxing.com/map",{waitUntil:"domcontentloaded"});
await p.waitForTimeout(15000);
console.log("BAD:", JSON.stringify(bad,null,1));
const own = all.filter(x=>x.u.includes("pubmaxxing.com"));
const third = all.filter(x=>!x.u.includes("pubmaxxing.com"));
console.log("total", all.length, "own", own.length, "third", third.length);
const hosts={}; for(const t of third){ const h=new URL(t.u).host; hosts[h]=(hosts[h]||0)+1; }
console.log("third-party hosts:", JSON.stringify(hosts));
const api = own.filter(x=>x.u.includes("/api/")||x.u.includes("/data/"));
console.log("api/data calls:", JSON.stringify(api.map(x=>x.s+" "+x.u.replace("https://pubmaxxing.com","")).slice(0,60),null,0));
await b.close();
