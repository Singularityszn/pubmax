import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = new URL(process.env.PUBMAX_MCP_BASE_URL ?? "http://127.0.0.1:38761");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Use your own local production server");
const output = fileURLToPath(new URL("../../artifacts/chatgpt-night-architect/", import.meta.url));
await mkdir(output, { recursive: true });
const client = new Client({ name: "pubmaxx-night-proof", version: "1" });
let host;
let browser;
try {
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", base)));
  const started = performance.now();
  const search = await client.callTool({ name: "pubmaxx_search_venues", arguments: { query: "Soho", limit: 3 } });
  assert.ok(!search.isError, JSON.stringify(search));
  assert.equal(search.structuredContent.venues.length, 3);
  const plan = await client.callTool({ name: "pubmaxx_plan_evening", arguments: { request: "Three pubs in Soho", includeHistory: true } });
  assert.ok(!plan.isError, JSON.stringify(plan));
  assert.equal(plan.structuredContent.venues.length, 3);
  assert.equal(plan.structuredContent.budget.guaranteed, false);
  const alternatives = await client.callTool({ name: "pubmaxx_search_venues", arguments: { query: "Soho", limit: 8 } });
  const alternative = alternatives.structuredContent.venues.find((pub) => !plan.structuredContent.venueIds.includes(pub.id));
  assert.ok(alternative, "Search must provide an unused alternative for the replacement proof");
  const replaced = await client.callTool({ name: "pubmaxx_replace_stop", arguments: {
    venueIds: plan.structuredContent.venueIds, position: 2,
    replacementVenueId: alternative.id,
    drinkCategory: plan.structuredContent.drinkCategory, zeroProof: plan.structuredContent.zeroProof,
  } });
  assert.ok(!replaced.isError, JSON.stringify(replaced));
  assert.equal(replaced.structuredContent.routeChanged, true);
  assert.equal(replaced.structuredContent.venueIds[1], alternative.id);
  const resource = await client.readResource({ uri: "ui://pubmaxx/night-architect/v1.html" });
  const widget = resource.contents[0].text;
  const csp = resource.contents[0]._meta.ui.csp;
  const policy = ["default-src 'none'", `script-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(" ")}`, `connect-src 'self' ${csp.connectDomains.join(" ")}`,
    `img-src 'self' data: ${csp.resourceDomains.join(" ")}`, `font-src 'self' ${csp.resourceDomains.join(" ")}`, "frame-src 'none'"].join("; ");
  const encoded = JSON.stringify(plan).replaceAll("<", "\\u003c");
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style><iframe title="Night Architect" src="/widget" sandbox="allow-scripts allow-same-origin"></iframe><script>
    const frame=document.querySelector('iframe');window.links=[];window.requests=[];window.deny=false;
    const send=m=>frame.contentWindow.postMessage({jsonrpc:'2.0',...m},location.origin);
    window.sendResult=result=>send({method:'ui/notifications/tool-result',params:result});
    addEventListener('message',event=>{
      if(event.source!==frame.contentWindow||event.data?.jsonrpc!=='2.0')return;
      const m=event.data;
      if(m.method==='ui/initialize')send({id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'controlled-local-host',version:'1'},hostCapabilities:{openLinks:{}},hostContext:{displayMode:'inline',theme:'light'}}});
      if(m.method==='ui/notifications/initialized')send({method:'ui/notifications/tool-result',params:${encoded}});
      if(m.method==='ui/notifications/size-changed')frame.style.height=m.params.height+'px';
      if(m.method==='ui/open-link'){window.links.push(m.params.url);send({id:m.id,result:{isError:window.deny}});}
      if(m.method==='ui/message'){window.requests.push(m.params);send({id:m.id,result:{isError:false}});}
    });</script>`;
  host = createServer((req, res) => {
    if (req.url === "/widget") res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": policy }).end(widget);
    else res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
  });
  await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ channel: process.env.PUBMAX_BROWSER_CHANNEL || undefined, headless: true, args: ["--enable-unsafe-swiftshader"] });
  const checks = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const page = await browser.newPage({ viewport });
    const moduleUrl = "https://unpkg.com/maplibre-gl@6.13.0/dist/maplibre-gl.mjs";
    const actualModule = `${moduleUrl}?night-proof=1`;
    await page.route((url) => url.href === moduleUrl, (route) => route.fulfill({
      contentType: "text/javascript", headers: { "access-control-allow-origin": "*" },
      body: `export * from "${actualModule}";import {Map as ActualMap} from "${actualModule}";export class Map extends ActualMap{constructor(options){super(options);window.proofMap=this;window.proofLoads=0;this.on("load",()=>window.proofLoads++);}}`,
    }));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${host.address().port}`);
    const frame = page.frameLocator('iframe[title="Night Architect"]');
    await frame.locator("#venues > li").nth(2).waitFor();
    await frame.locator('#map[data-state="ready"], #map[data-state="degraded"]').waitFor({ timeout: 45_000 });
    assert.equal(await frame.getByRole("heading", { level: 1 }).textContent(), "Your pub evening");
    assert.equal(await frame.locator("#evening").isVisible(), true);
    for (const [index, pub] of plan.structuredContent.venues.entries()) {
      const item = frame.locator("#venues > li").nth(index);
      assert.equal(await item.getByRole("heading", { level: 2 }).textContent(), `${index + 1}. ${pub.name}`);
      for (const price of pub.prices) {
        if (!price.observedAt || !Number.isFinite(Date.parse(price.observedAt))) continue;
        const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" }).format(new Date(price.observedAt));
        const stamps = item.locator("time").filter({ hasText: date });
        assert.ok(await stamps.evaluateAll((nodes, raw) => nodes.some((node) => node.getAttribute("datetime") === raw), price.observedAt));
      }
      const button = await item.getByRole("button", { name: `Find another pub for stop ${index + 1}`, exact: true }).boundingBox();
      const link = await item.getByRole("link", { name: "Open pub in PUBMAXX" }).boundingBox();
      assert.ok(button && link && link.y >= button.y + button.height + 8, "Replacement and venue link must have separate space");
    }
    assert.match(await frame.locator("#evening").textContent(), /not a guaranteed bill/);
    assert.equal(await frame.locator("#map").getAttribute("data-state"), "ready");
    const activatePins = async (result) => {
      await page.screenshot({ path: `${output}pins-${viewport.width}-${result.structuredContent.routeChanged ? "replacement" : "original"}.png`, fullPage: true });
      const pins = await frame.locator(".pin").all();
      assert.equal(pins.length, 3);
      const boxes = await Promise.all(pins.map((pin) => pin.boundingBox()));
      const mapBox = await frame.locator("#map").boundingBox();
      const controls = await frame.locator(".maplibregl-ctrl").all();
      const controlBoxes = await Promise.all(controls.map((control) => control.boundingBox()));
      const separate = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      for (const box of boxes) {
        assert.ok(box && mapBox && box.x >= mapBox.x && box.y >= mapBox.y && box.x + box.width <= mapBox.x + mapBox.width && box.y + box.height <= mapBox.y + mapBox.height, "Route pin must stay inside the map");
        for (const control of controlBoxes) if (control) assert.ok(separate(box, control), `Route pin ${JSON.stringify(box)} must clear control ${JSON.stringify(control)}`);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        assert.ok(separate(boxes[i], boxes[j]), `Route pins ${JSON.stringify(boxes[i])} and ${JSON.stringify(boxes[j])} must not overlap`);
      }
      for (const pub of result.structuredContent.venues) {
        await frame.getByRole("button", { name: pub.name, exact: true }).click();
        await frame.locator(".popup-card").getByRole("heading", { name: pub.name, exact: true }).waitFor();
        await frame.getByRole("button", { name: "Close popup" }).click();
      }
    };
    await activatePins(plan);
    await frame.getByRole("button", { name: "Find another pub for stop 2", exact: true }).click();
    await frame.locator("#status").filter({ hasText: "Alternative requested" }).waitFor();
    assert.equal(await page.evaluate(() => window.requests.length), 1);
    const pubLink = frame.locator("#venues > li").first().getByRole("link", { name: "Open pub in PUBMAXX" });
    await pubLink.click();
    await page.waitForFunction(() => window.links.length === 1);
    assert.equal(await page.evaluate(() => window.links.length), 1);
    await page.evaluate(() => { window.deny = true; });
    await pubLink.click();
    await page.waitForFunction(() => window.links.length === 2);
    await frame.locator("#status").filter({ hasText: "Copy this address" }).waitFor();
    assert.equal(await frame.locator("body").evaluate((body) => body.scrollWidth > innerWidth), false);
    await frame.locator('#map[data-state="ready"], #map[data-state="degraded"]').waitFor({ timeout: 45_000 });
    let releaseSource;
    const sourceReleased = new Promise((resolve) => { releaseSource = resolve; });
    await page.route("**/pending-route-source.geojson", async (route) => {
      await sourceReleased;
      await route.fulfill({ json: { type: "FeatureCollection", features: [] } });
    });
    try {
      const pendingRequest = page.waitForRequest("**/pending-route-source.geojson");
      await frame.locator("#map").evaluate(() => {
        const map = window.proofMap;
        map.addSource("proof-pending", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "proof-pending", type: "circle", source: "proof-pending" });
        map.getSource("proof-pending").setData(new URL("/pending-route-source.geojson", location.href).href);
      });
      await pendingRequest;
      assert.equal(await frame.locator("#map").evaluate(() => window.proofMap.isStyleLoaded()), false);
      await page.evaluate((result) => window.sendResult(result), replaced);
      await frame.locator("#venues > li").nth(1).getByRole("heading", { name: `2. ${alternative.name}`, exact: true }).waitFor();
      assert.equal(await frame.locator("#map").getAttribute("data-state"), "loading");
      assert.deepEqual(await frame.locator("#map").evaluate(() => window.proofMap.getSource("evening-route").serialize().data.geometry.coordinates),
        replaced.structuredContent.venues.map((pub) => [pub.longitude, pub.latitude]));
      assert.equal(await frame.locator("#map").evaluate(() => window.proofLoads), 1);
    } finally { releaseSource(); }
    await page.evaluate(() => scrollTo(0, 0));
    await frame.locator('#map[data-state="ready"]').waitFor({ timeout: 45_000 });
    await activatePins(replaced);
    const recentered = frame.locator("#map").evaluate(() => new Promise((resolve) => window.proofMap.once("idle", () => resolve(true))));
    await page.evaluate((result) => window.sendResult(result), replaced);
    await recentered;
    await frame.locator('#map[data-state="ready"]').waitFor({ timeout: 45_000 });
    await page.screenshot({ path: `${output}${viewport.width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    const mapState = await frame.locator("#map").getAttribute("data-state");
    assert.equal(mapState, "ready", "Captured map must remain ready");
    checks.push({ viewport, mapState, replacementWhileSourceLoading: true, pinControlsActivated: 6, replacementMessage: true, linkRequest: true, deniedLinkFallback: true, horizontalOverflow: false });
    await page.close();
  }
  const receipt = {
    checkedAt: new Date().toISOString(), browser: browser.version(), elapsedMs: Math.round(performance.now() - started),
    boundary: "Real local MCP endpoint and dataset. Controlled iframe host. No authenticated ChatGPT or public deployment proof.",
    widgetSha256: createHash("sha256").update(widget).digest("hex"),
    sourceSha256: createHash("sha256").update(await readFile(new URL("widget.html", import.meta.url))).digest("hex"),
    checks,
  };
  await writeFile(`${output}receipt.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  await browser?.close();
  await client.close();
  if (host) await new Promise((resolve) => host.close(resolve));
}
