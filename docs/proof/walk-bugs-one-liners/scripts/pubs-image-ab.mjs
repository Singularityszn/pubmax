import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3300";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const seen = [];
p.on("response", async (r) => {
  if (!r.url().includes("/api/image-proxy")) return;
  let bytes = 0; try { bytes = (await r.body()).byteLength; } catch {}
  seen.push({ url: r.url(), status: r.status(), bytes, type: r.headers()["content-type"] ?? "?" });
});
await p.goto(`${BASE}/pubs`, { waitUntil: "load" });
await p.waitForTimeout(1000);
await p.evaluate(() => window.scrollTo(0, 1200));
await p.waitForTimeout(4000);

const bad = seen.filter((s) => s.status !== 200 || !s.type.startsWith("image/"));
console.log("non-image responses:", JSON.stringify(bad.map((x) => ({ status: x.status, type: x.type, url: x.url.slice(0, 110) })), null, 1));

// The natural bytes come from the ORIGIN, not from our own proxy: the proxy
// rate-limits per IP, and a measurement run would spend that budget on itself.
let withW = 0, withoutW = 0, n = 0;
for (const s of seen.filter((x) => x.status === 200 && x.type.startsWith("image/"))) {
  const source = new URL(s.url).searchParams.get("src");
  if (!source) continue;
  let originalBytes = 0;
  try {
    const original = await fetch(source, { headers: { accept: "image/*" } });
    originalBytes = (await original.arrayBuffer()).byteLength;
  } catch { continue; }
  withW += s.bytes; withoutW += originalBytes; n += 1;
  console.log(`  ${originalBytes} B natural -> ${s.bytes} B at w=688  (${source.slice(0, 62)})`);
}
console.log(`TOTAL over ${n} photographs: natural ${(withoutW / 1024).toFixed(1)} KB -> served ${(withW / 1024).toFixed(1)} KB`);
await b.close();
