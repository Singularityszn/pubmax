import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPublicMapHttpServer } from "./server.mjs";

// Real MCP result and real widget, with a controlled host bridge. This does
// not prove an authenticated ChatGPT connection or its iframe CSP policy.
const output = fileURLToPath(new URL("../../artifacts/chatgpt-map/", import.meta.url));
await mkdir(output, { recursive: true });
const sourceSha256 = Object.fromEntries(await Promise.all(["widget.html", "server.mjs", "browser-proof.mjs"].map(async (name) => [name, createHash("sha256").update(await readFile(new URL(name, import.meta.url))).digest("hex")])));
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
    const query=new URLSearchParams(location.search);
    const waiting=new Map();
    let nextId=1;
    window.openedLinks=[];
    window.denyLinks=false;
    window.initialized=false;
    window.sizeChanges=0;
    const send=(message)=>frame.contentWindow.postMessage({jsonrpc:'2.0',...message},'${base}');
    window.sendPublicVenues=(next=false)=>send({method:'ui/notifications/tool-result',params:next?${nextEncoded}:${encoded}});
    window.hostNotify=(method,params)=>send({method,params});
    window.hostRequest=(method,params)=>new Promise((resolve,reject)=>{
      const id='host-'+nextId++;
      const timer=setTimeout(()=>{waiting.delete(id);reject(new Error(method+' had no answer after 3000ms'));},3000);
      waiting.set(id,(message)=>{clearTimeout(timer);resolve(message);});
      send({id,method,params});
    });
    addEventListener('message',event=>{
      if(event.source!==frame.contentWindow||event.data?.jsonrpc!=='2.0')return;
      const message=event.data;
      if(!message.method&&waiting.has(message.id)){const done=waiting.get(message.id);waiting.delete(message.id);done(message);return;}
      if(message.method==='ui/initialize'){
        const theme=query.get('theme');
        send({id:message.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'controlled-proof-host',version:'1.0.0'},hostCapabilities:query.has('noLinks')?{}:{openLinks:{}},hostContext:{displayMode:'inline',...(theme?{theme}:{})}}});
      }
      if(message.method==='ui/open-link'){
        window.openedLinks.push(message.params.url);
        send({id:message.id,result:{isError:window.denyLinks}});
      }
      if(message.method==='ui/notifications/size-changed'&&Number.isFinite(message.params?.height)){window.sizeChanges++;frame.style.height=message.params.height+'px';}
      if(message.method==='ui/notifications/initialized'){window.initialized=true;if(!query.has('manual'))window.sendPublicVenues();}
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
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
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
    const attributionText = widget.locator(".maplibregl-ctrl-attrib-inner").filter({ hasText: "Pub data © OpenStreetMap contributors (ODbL)" });
    await attributionText.waitFor({ timeout: 10000 });
    assert.ok(await attributionText.isVisible(), `Pub data attribution hidden at ${viewport.width}px`);
    const renderedAttribution = (await attributionText.textContent()).trim();
    const threePriceVenue = result.structuredContent.venues.find((venue) => venue.name === "The Ice Wharf - JD Wetherspoon");
    assert.equal(threePriceVenue?.prices.length, 3, "Real Camden result must exercise three prices");
    const threePricePin = widget.getByRole("button", { name: threePriceVenue.name, exact: true });
    await threePricePin.click();
    const threePricePopup = widget.locator(".maplibregl-popup");
    await threePricePopup.waitFor();
    await page.waitForTimeout(100);
    const popupGeometry = await threePricePopup.evaluate((popup) => {
      const rect = (node) => { const { top, bottom, left, right, height } = node.getBoundingClientRect(); return { top, bottom, left, right, height }; };
      const content = popup.querySelector(".maplibregl-popup-content > div");
      return { popup: rect(popup), map: rect(document.getElementById("map")), attribution: rect(document.querySelector(".maplibregl-ctrl-attrib")), navigation: rect(document.querySelector(".maplibregl-ctrl-top-right")), contentHeight: content.clientHeight, scrollHeight: content.scrollHeight };
    });
    await page.screenshot({ path: `${output}three-price-${viewport.width}.png`, fullPage: true });
    await writeFile(`${output}three-price-${viewport.width}.json`, `${JSON.stringify({ sourceSha256, viewport, venue: threePriceVenue.name, geometry: popupGeometry }, null, 2)}\n`);
    assert.ok(popupGeometry.popup.top >= popupGeometry.map.top && popupGeometry.popup.bottom < popupGeometry.attribution.top, `Three-price popup exceeds available map space at ${viewport.width}px: ${JSON.stringify(popupGeometry)}`);
    assert.ok(popupGeometry.popup.left >= popupGeometry.map.left && popupGeometry.popup.right <= popupGeometry.map.right, "Three-price popup exceeds map width");
    assert.ok(popupGeometry.popup.right <= popupGeometry.navigation.left, "Popup must clear navigation controls");
    const popupPrices = await threePricePopup.locator(".price").allTextContents();
    assert.deepEqual(popupPrices, threePriceVenue.prices.map((price) => `${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(price.priceGbp)} · ${price.drink}`));
    if (viewport.width === 390) assert.ok(popupGeometry.scrollHeight > popupGeometry.contentHeight, "Three-price phone popup must scroll");
    for (const price of await threePricePopup.locator(".price").all()) {
      await price.scrollIntoViewIfNeeded();
      const box = await price.boundingBox();
      const contentBox = await threePricePopup.locator(".maplibregl-popup-content > div").boundingBox();
      assert.ok(box && contentBox && box.y >= contentBox.y && box.y + box.height <= contentBox.y + contentBox.height + 1, "Every price row must scroll into view");
    }
    assert.deepEqual(await threePricePopup.getByRole("link", { name: /^Publisher:/ }).allTextContents(), threePriceVenue.prices.map((price) => `Publisher: ${price.publisher.label}`));
    const expectedPopupUrls = [...threePriceVenue.prices.map((price) => price.publisher.url), threePriceVenue.href];
    assert.deepEqual(await threePricePopup.getByRole("link").evaluateAll((links) => links.map((link) => link.href)), expectedPopupUrls);
    for (let index = 0; index < expectedPopupUrls.length; index++) {
      const link = threePricePopup.getByRole("link").nth(index);
      await link.focus();
      const box = await link.boundingBox();
      const contentBox = await threePricePopup.locator(".maplibregl-popup-content > div").boundingBox();
      assert.ok(box && contentBox && box.y >= contentBox.y && box.y + box.height <= contentBox.y + contentBox.height + 1, "Focused popup link must scroll into view");
      const openedBefore = await page.evaluate(() => window.openedLinks.length);
      await link.press("Enter");
      await page.waitForFunction(({ count, url }) => window.openedLinks.length === count + 1 && window.openedLinks.at(-1) === url, { count: openedBefore, url: expectedPopupUrls[index] });
    }
    await page.screenshot({ path: `${output}three-price-${viewport.width}-scrolled.png`, fullPage: true });
    for (const key of ["Enter", "Space"]) {
      await threePricePopup.locator(".maplibregl-popup-close-button").focus();
      await threePricePopup.locator(".maplibregl-popup-close-button").press("Enter");
      await threePricePin.focus();
      await threePricePin.press(key);
      await threePricePopup.waitFor();
      assert.equal(await threePricePopup.getByRole("heading", { name: threePriceVenue.name, exact: true }).count(), 1);
    }
    await threePricePopup.locator(".maplibregl-popup-close-button").click();
    await page.reload({ waitUntil: "networkidle" });
    await widget.locator("#venues > li").last().waitFor();
    await attributionText.waitFor();
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
    const acknowledgements = await page.evaluate(async () => {
      const outcome = async (method) => {
        try { return { method, response: await window.hostRequest(method, {}) }; }
        catch (error) { return { method, error: error.message }; }
      };
      return [await outcome("ping"), await outcome("ui/resource-teardown")];
    });
    assert.deepEqual(acknowledgements.map(({ response }) => response?.result), [{}, {}], `Host requests unanswered at ${viewport.width}px: ${JSON.stringify(acknowledgements)}`);
    const closedFrame = page.frames().find((candidate) => candidate.url() === `${base}/widget`);
    assert.equal(await widget.locator(".maplibregl-canvas").count(), 0, "Teardown left the map running");
    await closedFrame.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const sizeChangesAtTeardown = await page.evaluate(() => window.sizeChanges);
    await page.evaluate(() => window.sendPublicVenues(true));
    await closedFrame.evaluate(() => document.body.append(Object.assign(document.createElement("div"), { style: "height:400px" })));
    await page.waitForTimeout(500);
    assert.equal(await widget.locator("#venues > li").count(), 3, "A tool result after teardown rebuilt the list");
    assert.equal(await widget.locator(".maplibregl-canvas").count(), 0, "A tool result after teardown rebuilt the map");
    assert.equal(await page.evaluate(() => window.sizeChanges), sizeChangesAtTeardown, "Size notifications continued after teardown");
    checks.push({ viewport, pubs: 3, attribution: renderedAttribution, threePricePopup: { venue: threePriceVenue.name, geometry: popupGeometry, prices: popupPrices, hostLinks: expectedPopupUrls, keyboard: ["Enter", "Space"] }, popup: true, keyboard: ["Enter", "Space"], hostLinks: [pubUrl, publisherUrl], deniedLinkFallback: true, unsupportedLinkFallback: true, horizontalOverflow: false, status, hostRequests: acknowledgements.map(({ method, response }) => ({ method, result: response.result })), lateResultAfterTeardownIgnored: true });
    await context.close();
  }
  const themeChecks = [];
  for (const [colorScheme, hostTheme, nextTheme] of [["light", null, null], ["dark", null, null], ["light", "dark", "light"], ["dark", "light", "dark"]]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme });
    await enforceResourcePolicy(context);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${host.address().port}?manual=1${hostTheme ? `&theme=${hostTheme}` : ""}`);
    await page.waitForFunction(() => window.initialized);
    const frame = page.frames().find((candidate) => candidate.url() === `${base}/widget`);
    const colors = () => frame.evaluate(() => { const style = getComputedStyle(document.documentElement); return { background: style.backgroundColor, ink: style.color }; });
    const initial = await colors();
    let updated = null;
    if (nextTheme) {
      await page.evaluate((theme) => window.hostNotify("ui/notifications/host-context-changed", { theme }), nextTheme);
      await frame.waitForFunction((before) => getComputedStyle(document.documentElement).backgroundColor !== before, initial.background);
      updated = await colors();
    }
    themeChecks.push({ colorScheme, hostTheme, initial, nextTheme, updated });
    await context.close();
  }
  const [osLight, osDark, hostDarkOverOsLight, hostLightOverOsDark] = themeChecks;
  assert.notDeepEqual(osLight.initial, osDark.initial, "Light and dark tokens render the same colours");
  assert.deepEqual(hostDarkOverOsLight.initial, osDark.initial, "Host dark theme did not override a light OS preference");
  assert.deepEqual(hostDarkOverOsLight.updated, osLight.initial, "Host context change to light did not apply");
  assert.deepEqual(hostLightOverOsDark.initial, osLight.initial, "Host light theme did not override a dark OS preference");
  assert.deepEqual(hostLightOverOsDark.updated, osDark.initial, "Host context change to dark did not apply");
  const proof = { checkedAt: new Date().toISOString(), head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceSha256, host: "controlled local MCP Apps bridge", authentication: "No ChatGPT account connection", externalLinks: "Host request and acknowledgement only; no external destination navigation", sandbox: "allow-scripts allow-same-origin", declaredResourcePolicyEnforced: true, checks, failureChecks, themeChecks };
  await writeFile(`${output}result.json`, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof));
} finally {
  await browser?.close();
  await client.close();
  if (host) await new Promise((resolve) => host.close(resolve));
  await new Promise((resolve) => server.close(resolve));
}
