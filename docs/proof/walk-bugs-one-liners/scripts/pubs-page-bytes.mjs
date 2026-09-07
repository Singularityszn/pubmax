// One cold /pubs load at the walk's own phone rig, counting only what the
// image proxy served. Run it against ONE freshly started server: the proxy
// rate-limits per IP, so a second run in the same minute measures the limiter.
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://127.0.0.1:3300";
const b = await chromium.launch();
const dpr = Number(process.env.DPR ?? 3);
const width = Number(process.env.WIDTH ?? 390);
const p = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: dpr });
const images = [];
p.on("response", async (r) => {
  if (!r.url().includes("/api/image-proxy")) return;
  let bytes = 0; try { bytes = (await r.body()).byteLength; } catch {}
  images.push({ status: r.status(), bytes, type: r.headers()["content-type"] ?? "?", w: new URL(r.url()).searchParams.get("w") });
});
await p.goto(`${BASE}/pubs`, { waitUntil: "load" });
await p.waitForTimeout(1000);
await p.evaluate(() => window.scrollTo(0, 1200));
await p.waitForTimeout(5000);
const served = images.filter((i) => i.status === 200 && i.type.startsWith("image/"));
console.log(`viewport=${width} dpr=${dpr} requests=${images.length} served=${served.length} refused=${images.length - served.length}`);
console.log(`totalKB=${(served.reduce((a, i) => a + i.bytes, 0) / 1024).toFixed(1)} widths=${JSON.stringify([...new Set(served.map((i) => i.w))])} types=${JSON.stringify([...new Set(served.map((i) => i.type))])}`);
await b.close();
