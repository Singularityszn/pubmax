import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPublicMapHttpServer } from "./server.mjs";

// Real MCP result and real widget, with a controlled host bridge. This does
// not prove an authenticated ChatGPT connection or its iframe CSP policy.
const output = fileURLToPath(new URL("../../artifacts/chatgpt-map/", import.meta.url));
await mkdir(output, { recursive: true });
const server = await createPublicMapHttpServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const client = new Client({ name: "pubmaxx-browser-proof", version: "1.0.0" });
let host;
let browser;
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const result = await client.callTool({ name: "pubmaxx_venues_in_area", arguments: { area: "Camden", limit: 3 } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.venues.length, 3);
  const nextResult = await client.callTool({ name: "pubmaxx_venues_in_area", arguments: { area: "Camden", limit: 2 } });
  assert.equal(nextResult.structuredContent.venues.length, 2);
  const encoded = JSON.stringify(result).replaceAll("<", "\\u003c");
  const nextEncoded = JSON.stringify(nextResult).replaceAll("<", "\\u003c");
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{display:block;border:0;width:100%;height:100vh}</style><iframe title="PUBMAXX public map" src="${base}/widget"></iframe><script>
    const frame=document.querySelector('iframe');
    window.sendPublicVenues=(next=false)=>frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:next?${nextEncoded}:${encoded}},'${base}');
    addEventListener('message',event=>{
      if(event.source!==frame.contentWindow||event.data?.jsonrpc!=='2.0')return;
      if(event.data.method==='ui/initialize')frame.contentWindow.postMessage({jsonrpc:'2.0',id:event.data.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'controlled-proof-host',version:'1.0.0'},hostCapabilities:{}}},'${base}');
      if(event.data.method==='ui/notifications/size-changed'&&Number.isFinite(event.data.params?.height))frame.style.height=event.data.params.height+'px';
      if(event.data.method==='ui/notifications/initialized'&&!new URLSearchParams(location.search).has('manual'))window.sendPublicVenues();
    });
  </script>`;
  host = createServer((_req, res) => res.writeHead(200, { "Content-Type": "text/html" }).end(html));
  await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
  const checks = [];
  const failureChecks = [];
  for (const order of ["failure-before-results", "results-before-failure"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const moduleFailure = order === "failure-before-results";
    await context.route(moduleFailure ? "**/maplibre-gl.mjs" : "https://tiles.openfreemap.org/**", (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${host.address().port}${moduleFailure ? "?manual=1" : ""}`);
    const widget = page.frameLocator('iframe[title="PUBMAXX public map"]');
    const message = moduleFailure ? "Map could not load" : "Streets could not load";
    if (!moduleFailure) await widget.locator("#venues > li").nth(2).waitFor();
    await widget.locator("#status").filter({ hasText: message }).waitFor();
    await page.evaluate((next) => window.sendPublicVenues(next), !moduleFailure);
    const expectedPubs = moduleFailure ? 3 : 2;
    await widget.locator("#venues > li").nth(expectedPubs - 1).waitFor();
    assert.equal(await widget.locator("#venues > li").count(), expectedPubs);
    const status = await widget.locator("#status").textContent();
    await page.screenshot({ path: `${output}${order}.png`, fullPage: true });
    assert.ok(status.includes(message), `${order}: map failure disappeared after real MCP result: ${status}`);
    failureChecks.push({ order, pubs: expectedPubs, status });
    await context.close();
  }
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${host.address().port}`, { waitUntil: "networkidle" });
    const widget = page.frameLocator('iframe[title="PUBMAXX public map"]');
    await widget.getByRole("heading", { name: "Pubs in Camden" }).waitFor();
    await widget.locator("#venues > li").last().waitFor();
    assert.equal(await widget.locator("#venues > li").count(), 3);
    await widget.locator(".maplibregl-canvas").waitFor();
    await widget.locator(".pin").last().click();
    await widget.locator(".maplibregl-popup").waitFor();
    assert.equal(await widget.locator(".maplibregl-popup").getByRole("link", { name: "Open pub in PUBMAXX" }).count(), 1);
    await page.waitForTimeout(100);
    const frame = page.frames().find((candidate) => candidate.url() === `${base}/widget`);
    assert.ok(frame);
    const layout = await frame.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(layout.scrollWidth <= layout.width, `Horizontal overflow at ${viewport.width}px`);
    const popupLink = await widget.locator(".maplibregl-popup").getByRole("link", { name: "Open pub in PUBMAXX" }).boundingBox();
    const attribution = await widget.locator(".maplibregl-ctrl-attrib").boundingBox();
    assert.ok(popupLink && attribution && popupLink.y + popupLink.height < attribution.y, "Popup link overlaps map attribution");
    assert.deepEqual(errors, []);
    const status = await widget.locator("#status").textContent();
    assert.equal(status, "3 listed pubs.");
    await page.screenshot({ path: `${output}${viewport.width}.png`, fullPage: true });
    checks.push({ viewport, pubs: 3, popup: true, horizontalOverflow: false, status });
    await context.close();
  }
  const proof = { checkedAt: new Date().toISOString(), host: "controlled local MCP Apps bridge", authentication: "No ChatGPT account connection", checks, failureChecks };
  await writeFile(`${output}result.json`, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof));
} finally {
  await browser?.close();
  await client.close();
  if (host) await new Promise((resolve) => host.close(resolve));
  await new Promise((resolve) => server.close(resolve));
}
