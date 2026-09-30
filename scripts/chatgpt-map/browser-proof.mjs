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
  const resource = await client.readResource({ uri: "ui://pubmaxx/public-map/v1.html" });
  const csp = resource.contents[0]._meta.ui.csp;
  // Enforce the documented MCP Apps host policy from the actual resource.
  const policy = [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(" ")}`,
    `connect-src 'self' ${csp.connectDomains.join(" ")}`,
    `img-src 'self' data: ${csp.resourceDomains.join(" ")}`,
    `font-src 'self' ${csp.resourceDomains.join(" ")}`,
    `media-src 'self' data: ${csp.resourceDomains.join(" ")}`,
    "frame-src 'none'", "object-src 'none'", "base-uri 'self'",
  ].join("; ");
  async function enforceResourcePolicy(context) {
    await context.route(`${base}/widget`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), "Content-Security-Policy": policy } });
    });
  }
  const encoded = JSON.stringify(result).replaceAll("<", "\\u003c");
  const nextEncoded = JSON.stringify(nextResult).replaceAll("<", "\\u003c");
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{display:block;border:0;width:100%;height:100vh}</style><iframe title="PUBMAXX public map" sandbox="allow-scripts allow-same-origin" src="${base}/widget"></iframe><script>
    const frame=document.querySelector('iframe');
    window.openedLinks=[];
    window.denyLinks=false;
    window.sendPublicVenues=(next=false)=>frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:next?${nextEncoded}:${encoded}},'${base}');
    addEventListener('message',event=>{
      if(event.source!==frame.contentWindow||event.data?.jsonrpc!=='2.0')return;
      if(event.data.method==='ui/initialize')frame.contentWindow.postMessage({jsonrpc:'2.0',id:event.data.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'controlled-proof-host',version:'1.0.0'},hostCapabilities:new URLSearchParams(location.search).has('noLinks')?{}:{openLinks:{}}}},'${base}');
      if(event.data.method==='ui/open-link'){
        window.openedLinks.push(event.data.params.url);
        frame.contentWindow.postMessage({jsonrpc:'2.0',id:event.data.id,result:{isError:window.denyLinks}},'${base}');
      }
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
    await enforceResourcePolicy(context);
    const moduleFailure = order === "failure-before-results";
    await context.route(moduleFailure ? "**/maplibre-gl.mjs" : "https://tiles.openfreemap.org/**", (route) => route.abort());
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${host.address().port}${moduleFailure ? "?manual=1" : ""}`);
    const widget = page.frameLocator('iframe[title="PUBMAXX public map"]');
    const message = moduleFailure ? "Map could not load" : "Streets could not load";
    if (!moduleFailure) await widget.locator("#venues > li").nth(2).waitFor();
    try {
      await widget.locator("#status").filter({ hasText: message }).waitFor({ timeout: 10000 });
    } catch (error) {
      await page.screenshot({ path: `${output}${order}-unexpected-status.png`, fullPage: true });
      throw new Error(`${order}: expected ${message}; actual: ${await widget.locator("#status").textContent()}; console: ${JSON.stringify(consoleErrors.slice(0, 5))}`, { cause: error });
    }
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
    await enforceResourcePolicy(context);
    const page = await context.newPage();
    const errors = [];
    const consoleErrors = [];
    const failedRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), failure: request.failure() }));
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
    for (const key of ["Enter", "Space"]) {
      await widget.locator(".maplibregl-popup-close-button").click();
      await widget.locator(".pin").last().focus();
      await widget.locator(".pin").last().press(key);
      try {
        await widget.locator(".maplibregl-popup").waitFor({ timeout: 5000 });
      } catch (error) {
        await page.screenshot({ path: `${output}${viewport.width}-${key}-before.png`, fullPage: true });
        throw new Error(`Native ${key} left pub popup closed at ${viewport.width}px`, { cause: error });
      }
    }
    const pubLink = widget.locator(".maplibregl-popup").getByRole("link", { name: "Open pub in PUBMAXX" });
    const pubUrl = await pubLink.getAttribute("href");
    await pubLink.click();
    try {
      await page.waitForFunction((url) => window.openedLinks.includes(url), pubUrl, { timeout: 5000 });
    } catch (error) {
      await page.screenshot({ path: `${output}${viewport.width}-link-before.png`, fullPage: true });
      throw new Error(`Pub link did not reach host from sandbox at ${viewport.width}px`, { cause: error });
    }
    const publisherLink = widget.locator(".maplibregl-popup").getByRole("link", { name: /^Publisher:/ }).first();
    const publisherUrl = await publisherLink.getAttribute("href");
    await publisherLink.click();
    await page.waitForFunction((url) => window.openedLinks.includes(url), publisherUrl, { timeout: 5000 });
    assert.deepEqual(errors, []);
    const status = await widget.locator("#status").textContent();
    assert.equal(status, "3 listed pubs.", JSON.stringify({ status, consoleErrors: consoleErrors.slice(0, 10), failedRequests: failedRequests.slice(0, 5) }));
    await page.screenshot({ path: `${output}${viewport.width}.png`, fullPage: true });
    await page.evaluate(() => { window.denyLinks = true; });
    await widget.getByRole("link", { name: "Open PUBMAXX", exact: true }).click();
    await widget.locator("#status").filter({ hasText: "Link could not open. Copy this address: https://pubmaxxing.com/map" }).waitFor();
    const deniedLayout = await frame.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(deniedLayout.scrollWidth <= deniedLayout.width, "Link fallback causes horizontal overflow");
    await page.goto(`http://127.0.0.1:${host.address().port}?noLinks=1`, { waitUntil: "networkidle" });
    await widget.locator("#venues > li").last().waitFor();
    await widget.locator("#venues").getByRole("link", { name: "Open pub in PUBMAXX" }).first().click();
    await widget.locator("#status").filter({ hasText: "Link could not open. Copy this address:" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.openedLinks), []);
    const unsupportedLayout = await widget.locator("#status").evaluate((element) => ({ width: element.ownerDocument.documentElement.clientWidth, scrollWidth: element.ownerDocument.documentElement.scrollWidth }));
    assert.ok(unsupportedLayout.scrollWidth <= unsupportedLayout.width, "Unsupported link fallback causes horizontal overflow");
    checks.push({ viewport, pubs: 3, popup: true, keyboard: ["Enter", "Space"], hostLinks: [pubUrl, publisherUrl], deniedLinkFallback: true, unsupportedLinkFallback: true, horizontalOverflow: false, status });
    await context.close();
  }
  const proof = { checkedAt: new Date().toISOString(), host: "controlled local MCP Apps bridge", authentication: "No ChatGPT account connection", externalLinks: "Host request and acknowledgement only; no external destination navigation", sandbox: "allow-scripts allow-same-origin", declaredResourcePolicyEnforced: true, checks, failureChecks };
  await writeFile(`${output}result.json`, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof));
} finally {
  await browser?.close();
  await client.close();
  if (host) await new Promise((resolve) => host.close(resolve));
  await new Promise((resolve) => server.close(resolve));
}
