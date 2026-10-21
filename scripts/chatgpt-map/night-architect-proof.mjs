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
  const resource = await client.readResource({ uri: "ui://pubmaxx/night-architect/v1.html" });
  const widget = resource.contents[0].text;
  const csp = resource.contents[0]._meta.ui.csp;
  const policy = ["default-src 'none'", `script-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(" ")}`, `connect-src 'self' ${csp.connectDomains.join(" ")}`,
    `img-src 'self' data: ${csp.resourceDomains.join(" ")}`, `font-src 'self' ${csp.resourceDomains.join(" ")}`, "frame-src 'none'"].join("; ");
  const encoded = JSON.stringify(plan).replaceAll("<", "\\u003c");
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style><iframe title="Night Architect" src="/widget" sandbox="allow-scripts allow-same-origin"></iframe><script>
    const frame=document.querySelector('iframe');window.links=[];window.requests=[];window.deny=false;
    const send=m=>frame.contentWindow.postMessage({jsonrpc:'2.0',...m},location.origin);
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
    if (req.url === "/widget") res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": policy }).end(widget);
    else res.writeHead(200, { "Content-Type": "text/html" }).end(html);
  });
  await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ channel: process.env.PUBMAX_BROWSER_CHANNEL || undefined, headless: true, args: ["--enable-unsafe-swiftshader"] });
  const checks = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${host.address().port}`);
    const frame = page.frameLocator('iframe[title="Night Architect"]');
    await frame.locator("#venues > li").nth(2).waitFor();
    await frame.locator(".maplibregl-canvas").waitFor();
    assert.equal(await frame.locator("#evening").isVisible(), true);
    assert.match(await frame.locator("#evening").textContent(), /not a guaranteed bill/);
    await frame.getByRole("button", { name: "Find another pub for stop 2", exact: true }).click();
    await frame.locator("#status").filter({ hasText: "Alternative requested" }).waitFor();
    assert.equal(await page.evaluate(() => window.requests.length), 1);
    const pubLink = frame.locator("#venues > li").first().getByRole("link", { name: "Open pub in PUBMAXX" });
    await pubLink.click();
    assert.equal(await page.evaluate(() => window.links.length), 1);
    await page.evaluate(() => { window.deny = true; });
    await pubLink.click();
    await frame.locator("#status").filter({ hasText: "Copy this address" }).waitFor();
    assert.equal(await frame.locator("body").evaluate((body) => body.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}${viewport.width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    checks.push({ viewport, replacementMessage: true, linkRequest: true, deniedLinkFallback: true, horizontalOverflow: false });
    await page.close();
  }
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
  const receipt = {
    checkedAt: new Date().toISOString(), browser: browser.version(), elapsedMs: Math.round(performance.now() - started),
    boundary: "Real local production MCP endpoint and dataset. Controlled iframe host. No authenticated ChatGPT or public deployment proof.",
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
