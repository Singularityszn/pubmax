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

// Actual resource and installed App SDK, with a controlled local host. Host
// replies and malformed negative inputs do not prove ChatGPT or navigation.
const output = fileURLToPath(new URL("../../artifacts/chatgpt-map-lifecycle/", import.meta.url));
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const sourcePaths = ["widget.html", "server.mjs", "widget-lifecycle-proof.mjs"];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async (name) => [name, await digest(new URL(name, import.meta.url))])));
const receipt = {
  checkedAt: new Date().toISOString(),
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8" }).trim(),
  scope: "Actual widget and installed SDK in controlled local Chromium. No authenticated ChatGPT, external navigation, production hosting or release proof.",
  sourceSha256: await hashes(),
  installedSdkSha256: await digest(new URL(import.meta.resolve("@modelcontextprotocol/ext-apps/app-with-deps"))),
  checks: [],
};
await mkdir(output, { recursive: true });
let server;
let client;
let host;
let browser;
try {
  server = await createPublicMapHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  client = new Client({ name: "pubmaxx-lifecycle-proof", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const result = await client.callTool({ name: "pubmaxx_venues_in_area", arguments: { area: "Camden", limit: 2 } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.venues.length, 2);
  const resource = await client.readResource({ uri: "ui://pubmaxx/public-map/v1.html" });
  const csp = resource.contents[0]._meta.ui.csp;
  const policy = [
    "default-src 'none'", `script-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(" ")}`,
    `connect-src 'self' ${csp.connectDomains.join(" ")}`,
    `img-src 'self' data: ${csp.resourceDomains.join(" ")}`,
    `font-src 'self' ${csp.resourceDomains.join(" ")}`, "frame-src 'none'", "object-src 'none'", "base-uri 'self'",
  ].join("; ");
  const encoded = JSON.stringify(result).replaceAll("<", "\\u003c");
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{display:block;border:0;width:100%;height:100vh}</style><iframe title="PUBMAXX public map" sandbox="allow-scripts allow-same-origin" src="${base}/widget"></iframe><script>
    const frame=document.querySelector('iframe'), waiting=new Map();let nextId=1;
    const send=message=>frame.contentWindow.postMessage({jsonrpc:'2.0',...message},'${base}');
    window.pendingLinks=[];window.cancelled=[];window.sizeChanges=0;
    window.sendResult=result=>send({method:'ui/notifications/tool-result',params:result});
    window.finishPendingLink=()=>send({id:window.pendingLinks[0].id,result:{isError:true}});
    window.finishPendingInit=()=>send(window.pendingInit);
    window.ask=method=>new Promise((resolve,reject)=>{
      const id='host-'+nextId++, timer=setTimeout(()=>{waiting.delete(id);reject(Error(method+' timeout'));},3000);
      waiting.set(id,message=>{clearTimeout(timer);resolve(message)});send({id,method,params:{}});
    });
    addEventListener('message',event=>{
      if(event.source!==frame.contentWindow||event.data?.jsonrpc!=='2.0')return;
      const message=event.data;
      if(!message.method&&waiting.has(message.id)){const done=waiting.get(message.id);waiting.delete(message.id);done(message);return;}
      if(message.method==='ui/initialize'){
        window.appCapabilities=message.params.appCapabilities;
        const holdInit=new URLSearchParams(location.search).has('holdInit');
        window.pendingInit={id:message.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'controlled-lifecycle-host',version:'1.0.0'},hostCapabilities:{openLinks:{}},hostContext:{displayMode:'inline',...(holdInit?{theme:'dark'}:{})}}};
        if(!holdInit)send(window.pendingInit);
      }
      if(message.method==='ui/notifications/initialized'){window.initialized=true;window.sendResult(${encoded});}
      if(message.method==='ui/open-link'){
        window.pendingLinks.push({id:message.id,urlLength:message.params.url.length});
        if(!new URLSearchParams(location.search).has('holdLink'))send({id:message.id,result:{isError:true}});
      }
      if(message.method==='notifications/cancelled')window.cancelled.push(message.params.requestId);
      if(message.method==='ui/notifications/size-changed'&&Number.isFinite(message.params?.height)){window.sizeChanges++;frame.style.height=message.params.height+'px';}
    });</script>`;
  host = createServer((_req, res) => res.writeHead(200, { "Content-Type": "text/html" }).end(html));
  await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
  const hostUrl = `http://127.0.0.1:${host.address().port}`;
  browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });

  for (const name of ["inline-capability", "pending-link", "late-import", "worker-blob", "url-bounds", "url-boundary-fallback", "pending-initialization", "unused-id-retention", "publisher-label-retention"]) {
    const check = { name };
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
    let releaseImport = () => {};
    let importRouteCompletion;
    try {
      await context.route(`${base}/widget`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), "Content-Security-Policy": policy } });
      });
      if (name === "worker-blob") {
        await context.addInitScript(() => {
          window.proofBlobs = [];
          const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
          URL.createObjectURL = (blob) => {
            const url = create(blob), entry = { url, kind: "pending", revoked: false };
            window.proofBlobs.push(entry);
            if (blob instanceof Blob) blob.text().then((source) => { entry.kind = source.includes("/maplibre-gl-worker.mjs") ? "map-worker" : "other"; });
            return url;
          };
          URL.revokeObjectURL = (url) => {
            const entry = window.proofBlobs.find((candidate) => candidate.url === url);
            if (entry) { entry.revoked = true; entry.canvasesWhenRevoked = document.querySelectorAll(".maplibregl-canvas").length; }
            return revoke(url);
          };
        });
      } else if (name === "late-import") {
        const released = new Promise((resolve) => { releaseImport = resolve; });
        await context.route("**/maplibre-gl.mjs", (route) => {
          importRouteCompletion = (async () => { await released; await route.abort(); })();
          return importRouteCompletion;
        });
      } else if (name !== "url-bounds" && name !== "publisher-label-retention") {
        await context.route("**/maplibre-gl.mjs", (route) => route.abort());
      }
      const page = await context.newPage();
      const importRequested = name === "late-import" ? page.waitForRequest("**/maplibre-gl.mjs", { timeout: 15000 }).then(() => true, () => false) : null;
      const query = name === "pending-link" ? "?holdLink=1" : name === "pending-initialization" ? "?holdInit=1" : "";
      await page.goto(`${hostUrl}${query}`, { waitUntil: "domcontentloaded", timeout: 15000 });
      if (importRequested) assert.equal(await importRequested, true, "Deferred map module request not observed");
      await page.waitForFunction((pending) => pending ? Boolean(window.pendingInit) : window.initialized, name === "pending-initialization");
      const widget = page.frameLocator('iframe[title="PUBMAXX public map"]');
      if (name !== "pending-initialization") await widget.locator("#venues > li").nth(1).waitFor();
      const frame = page.frames().find((candidate) => candidate.url() === `${base}/widget`);
      assert.ok(frame, "Actual widget frame missing");
      if (name === "inline-capability") {
        check.modes = await page.evaluate(() => window.appCapabilities.availableDisplayModes ?? null);
        assert.deepEqual(check.modes, ["inline"], "Initialize must advertise exactly the supported inline mode");
      }
      if (name === "pending-link") {
        await widget.locator("#status").filter({ hasText: "Map could not load" }).waitFor();
        await widget.getByRole("link", { name: "Open PUBMAXX", exact: true }).click();
        await page.waitForFunction(() => window.pendingLinks.length === 1);
        check.teardown = await page.evaluate(() => window.ask("ui/resource-teardown"));
        assert.deepEqual(check.teardown.result, {}, "Teardown must ACK before transport closes");
        check.statusAtAck = await widget.locator("#status").textContent();
        await page.evaluate(() => window.finishPendingLink());
        await page.waitForTimeout(250);
        check.statusAfterLateDenial = await widget.locator("#status").textContent();
        check.requestCancelled = await page.evaluate(() => window.cancelled.includes(window.pendingLinks[0].id));
        await page.screenshot({ path: `${output}pending-link.png`, fullPage: false });
        assert.equal(check.statusAfterLateDenial, check.statusAtAck, "Late host denial changed retired widget after teardown ACK");
        assert.equal(check.requestCancelled, true, "Teardown left owned open-link request and its timer active");
      }
      if (name === "late-import") {
        assert.equal(await widget.locator(".maplibregl-canvas").count(), 0);
        check.teardown = await page.evaluate(() => window.ask("ui/resource-teardown"));
        assert.deepEqual(check.teardown.result, {});
        check.statusAtAck = await widget.locator("#status").textContent();
        const failed = page.waitForEvent("requestfailed", { predicate: (request) => request.url().endsWith("/maplibre-gl.mjs"), timeout: 15000 });
        releaseImport();
        await failed;
        await page.waitForTimeout(250);
        check.statusAfterImportFailure = await widget.locator("#status").textContent();
        assert.equal(check.statusAfterImportFailure, check.statusAtAck, "Late rejected map import changed retired widget after ACK");
        assert.equal(await widget.locator(".maplibregl-canvas").count(), 0, "Late import rebuilt retired map");
      }
      if (name === "worker-blob") {
        await widget.locator(".maplibregl-canvas").waitFor();
        await frame.waitForFunction(() => window.proofBlobs.some((entry) => entry.kind === "map-worker"));
        check.workerUrlsCreated = await frame.evaluate(() => window.proofBlobs.filter((entry) => entry.kind === "map-worker").length);
        assert.ok(check.workerUrlsCreated > 0, "No actual MapLibre worker blob observed");
        check.teardown = await page.evaluate(() => window.ask("ui/resource-teardown"));
        assert.deepEqual(check.teardown.result, {});
        check.canvasesAfterAck = await widget.locator(".maplibregl-canvas").count();
        check.workerCleanup = await frame.evaluate(() => window.proofBlobs.filter((entry) => entry.kind === "map-worker").map(({ revoked, canvasesWhenRevoked }) => ({ revoked, canvasesWhenRevoked })));
        assert.equal(check.canvasesAfterAck, 0);
        assert.ok(check.workerCleanup.every((entry) => entry.revoked && entry.canvasesWhenRevoked === 0), "Owned worker URLs must revoke after map removal and before teardown ACK");
      }
      if (name === "url-bounds") {
        await widget.locator(".maplibregl-canvas").waitFor();
        const pricedIndex = result.structuredContent.venues.findIndex((venue) => venue.prices.length > 0);
        assert.ok(pricedIndex >= 0, "Actual MCP result needs a priced venue for URL negative input");
        const siblingIndex = result.structuredContent.venues.findIndex((venue, index) => index !== pricedIndex && typeof venue.href === "string");
        assert.ok(siblingIndex >= 0, "Actual MCP result needs a valid sibling link");
        const pounds = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
        const groundedPrices = result.structuredContent.venues[pricedIndex].prices.map((price) => `${pounds.format(price.priceGbp)} · ${price.drink}`);
        const unicodeUrl = `https://publisher.example/${"é".repeat(500)}`;
        assert.ok(unicodeUrl.length <= 2048 && new URL(unicodeUrl).href.length > 2048, "Unicode fixture must cross only the normalised bound");
        check.inputs = [];
        for (const variant of ["raw-oversize", "normalised-oversize"]) {
          const malformed = structuredClone(result);
          const bad = malformed.structuredContent.venues[pricedIndex];
          const valid = malformed.structuredContent.venues[siblingIndex];
          malformed.structuredContent.venues = [bad, valid];
          bad.name = `URL bounds regression ${variant}`;
          if (variant === "raw-oversize") bad.href = `https://pubmaxxing.com/map?sel=${"x".repeat(65536)}`;
          for (const price of bad.prices) price.publisher = {
            label: "Oversized publisher", url: variant === "raw-oversize" ? `https://publisher.example/${"x".repeat(65536)}` : unicodeUrl,
          };
          await page.evaluate((next) => window.sendResult(next), malformed);
          await widget.getByRole("heading", { name: bad.name, exact: true }).waitFor();
          const list = widget.locator("#venues");
          assert.equal(await list.locator("li").count(), 2, "Rejecting one URL must retain its venue and valid sibling");
          assert.deepEqual(await list.locator("li").first().locator(".price").allTextContents(), groundedPrices, `${variant} URL rejection changed grounded list prices`);
          const sibling = list.locator("li").nth(1);
          assert.equal(await sibling.getByRole("heading").textContent(), valid.name);
          const observed = { variant, oversizedFallbackLength: 0 };
          observed.oversizedAnchors = await list.locator("a").evaluateAll((anchors) => anchors.filter((anchor) => anchor.href.length > 2048).length);
          await widget.getByRole("button", { name: bad.name, exact: true }).click();
          const popup = widget.locator(".maplibregl-popup");
          await popup.waitFor();
          assert.deepEqual(await popup.locator(".price").allTextContents(), groundedPrices, `${variant} URL rejection changed grounded popup prices`);
          observed.oversizedPopupAnchors = await popup.locator("a").evaluateAll((anchors) => anchors.filter((anchor) => anchor.href.length > 2048).length);
          await popup.locator(".maplibregl-popup-close-button").click();
          const firstBadLink = list.locator("li").first().locator("a").filter({ hasText: variant === "raw-oversize" ? "Open pub in PUBMAXX" : "Publisher: Oversized publisher" }).first();
          if (observed.oversizedAnchors && await firstBadLink.count()) {
            const beforeClick = await widget.locator("#status").textContent();
            await firstBadLink.click();
            await frame.waitForFunction((before) => document.getElementById("status").textContent !== before, beforeClick);
            observed.oversizedFallbackLength = (await widget.locator("#status").textContent()).length;
          }
          await sibling.getByRole("link", { name: "Open pub in PUBMAXX", exact: true }).click();
          await widget.locator("#status").filter({ hasText: valid.href }).waitFor();
          observed.validSiblingFallbackLength = (await widget.locator("#status").textContent()).length;
          check.inputs.push(observed);
        }
        for (const observed of check.inputs) {
          assert.equal(observed.oversizedAnchors, 0, `${observed.variant} venue/publisher URLs survived real host result validation`);
          assert.equal(observed.oversizedPopupAnchors, 0, `${observed.variant} venue/publisher URLs duplicated into real map popup`);
          assert.ok(observed.oversizedFallbackLength <= 2200 && observed.validSiblingFallbackLength <= 2200, `${observed.variant} fallback retained an unbounded URL`);
        }
      }
      if (name === "url-boundary-fallback") {
        const mapFailure = "Map could not load. Listed pubs remain below.";
        await widget.locator("#status").filter({ hasText: mapFailure }).waitFor();
        const boundary = structuredClone(result);
        const pricedIndex = boundary.structuredContent.venues.findIndex((venue) => venue.prices.length > 0 && typeof venue.href === "string");
        assert.ok(pricedIndex >= 0, "Actual MCP result needs a priced venue link for accepted URL boundary");
        const venue = boundary.structuredContent.venues[pricedIndex];
        const prefix = `${venue.href}${venue.href.includes("?") ? "&" : "?"}proofPadding=`;
        assert.ok(prefix.length < 2048, "Actual canonical link must leave room for query padding");
        venue.href = `${prefix}${"x".repeat(2048 - prefix.length)}`;
        venue.name = "URL boundary regression venue";
        assert.equal(venue.href.length, 2048);
        assert.equal(new URL(venue.href).href.length, 2048);
        assert.equal(new URL(venue.href).origin, "https://pubmaxxing.com");
        assert.equal(new URL(venue.href).pathname, "/map");
        await page.evaluate((next) => window.sendResult(next), boundary);
        const card = widget.locator("#venues > li").nth(pricedIndex);
        await card.getByRole("heading", { name: venue.name, exact: true }).waitFor();
        await card.getByRole("link", { name: "Open pub in PUBMAXX", exact: true }).click();
        await page.waitForFunction(() => window.pendingLinks.length === 1);
        await frame.waitForFunction((address) => document.getElementById("status").textContent.includes(address), venue.href);
        const status = await widget.locator("#status").textContent();
        check.hostRequestUrlLength = await page.evaluate(() => window.pendingLinks[0].urlLength);
        check.copyAddressIntact = status.includes(`Copy this address: ${venue.href}`);
        check.mapFailureRetained = status.includes(mapFailure);
        check.statusLength = status.length;
        assert.equal(check.hostRequestUrlLength, 2048, "Accepted boundary URL must reach actual host intact");
        assert.equal(check.copyAddressIntact, true, "Denied accepted boundary URL must remain copyable in full");
        assert.equal(check.mapFailureRetained, true, "Link fallback must preserve actual map failure");
        assert.ok(check.statusLength <= 2200, "Whole status exceeds 2200 characters at accepted URL boundary");
      }
      if (name === "pending-initialization") {
        await widget.locator("#status").filter({ hasText: "Map could not load" }).waitFor();
        assert.equal(await page.evaluate(() => Boolean(window.initialized)), false, "Host must actually hold initialization response");
        check.teardown = await page.evaluate(() => window.ask("ui/resource-teardown"));
        assert.deepEqual(check.teardown.result, {}, "Pending initialization teardown must ACK before transport closes");
        check.statusAtAck = await widget.locator("#status").textContent();
        const before = await frame.evaluate(() => ({ html: document.body.innerHTML, background: getComputedStyle(document.documentElement).backgroundColor, theme: document.documentElement.dataset.theme ?? null }));
        const sizeChangesAtAck = await page.evaluate(() => window.sizeChanges);
        await page.evaluate(() => window.finishPendingInit());
        await page.waitForFunction(() => window.initialized);
        await page.waitForTimeout(250);
        const after = await frame.evaluate(() => ({ html: document.body.innerHTML, background: getComputedStyle(document.documentElement).backgroundColor, theme: document.documentElement.dataset.theme ?? null }));
        check.statusAfterLateInitialization = await widget.locator("#status").textContent();
        check.retiredDomUnchanged = before.html === after.html;
        check.themeUnchanged = before.background === after.background && before.theme === after.theme;
        check.sizeChangesAfterAck = (await page.evaluate(() => window.sizeChanges)) - sizeChangesAtAck;
        check.canvasesAfterLateInitialization = await widget.locator(".maplibregl-canvas").count();
        assert.equal(check.statusAfterLateInitialization, check.statusAtAck, "Late initialization changed retired status");
        assert.equal(check.retiredDomUnchanged, true, "Late initialization rebuilt retired DOM");
        assert.equal(check.themeUnchanged, true, "Late initialization applied retired host theme");
        assert.equal(check.sizeChangesAfterAck, 0, "Late initialization installed retired size observer");
        assert.equal(check.canvasesAfterLateInitialization, 0, "Late initialization rebuilt retired map");
      }
      if (name === "unused-id-retention") {
        const pricedIndex = result.structuredContent.venues.findIndex((venue) => venue.prices.length > 0 && typeof venue.href === "string");
        assert.ok(pricedIndex >= 0, "Actual MCP result needs a priced venue for ID negative input");
        const siblingIndex = result.structuredContent.venues.findIndex((venue, index) => index !== pricedIndex && typeof venue.href === "string");
        assert.ok(siblingIndex >= 0, "Actual MCP result needs a valid sibling");
        const malformed = structuredClone(result);
        const bad = malformed.structuredContent.venues[pricedIndex];
        const valid = malformed.structuredContent.venues[siblingIndex];
        malformed.structuredContent.venues = [bad, valid];
        bad.id = "x".repeat(65536);
        bad.name = "ID retention regression venue";
        const pounds = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
        const groundedPrices = bad.prices.map((price) => `${pounds.format(price.priceGbp)} · ${price.drink}`);
        // The separate-origin widget shares this local page's renderer target.
        const session = await context.newCDPSession(page);
        const scripts = [];
        const onScript = (script) => { if (script.url === `${base}/widget`) scripts.push(script); };
        let breakpointId;
        let paused = false;
        let pauseTimer;
        let onPaused;
        let delivery;
        session.on("Debugger.scriptParsed", onScript);
        try {
          await session.send("Debugger.enable");
          let target;
          const statement = 'element("area").textContent=data.area;';
          for (const script of scripts) {
            const { scriptSource } = await session.send("Debugger.getScriptSource", { scriptId: script.scriptId });
            const lines = scriptSource.split("\n");
            const line = lines.findIndex((text, index) => text.includes(statement) && lines[index - 1]?.includes("latestVenues=safeVenues(data.venues)"));
            if (line >= 0) {
              assert.equal(target, undefined, "Multiple actual render projection statements found");
              target = { scriptId: script.scriptId, lineNumber: script.startLine + line, columnNumber: lines[line].indexOf("element(") + (line === 0 ? script.startColumn : 0) };
            }
          }
          assert.ok(target, "Actual served widget render projection statement missing");
          const breakpoint = await session.send("Debugger.setBreakpoint", { location: target });
          breakpointId = breakpoint.breakpointId;
          assert.equal(breakpoint.actualLocation.lineNumber, target.lineNumber, "Breakpoint moved away from statement after actual projection");
          const stopped = new Promise((resolve, reject) => {
            onPaused = (event) => { paused = true; resolve(event); };
            session.on("Debugger.paused", onPaused);
            pauseTimer = setTimeout(() => reject(Error("Actual render projection breakpoint timeout")), 15000);
          });
          // Keep delivery observed while the widget renderer is paused. No
          // validator or served source is replaced to expose module state.
          delivery = page.evaluate((next) => window.sendResult(next), malformed).then(() => null, (error) => error);
          const stoppedAt = await stopped;
          clearTimeout(pauseTimer);
          assert.ok(stoppedAt.hitBreakpoints?.includes(breakpointId), "Debugger paused outside owned projection breakpoint");
          const renderFrame = stoppedAt.callFrames.find((candidate) => candidate.functionName === "render");
          assert.ok(renderFrame, "Actual render call frame missing");
          const observation = await Promise.race([
            session.send("Debugger.evaluateOnCallFrame", {
              callFrameId: renderFrame.callFrameId,
              expression: '({count:latestVenues.length,hasOwnId:Object.hasOwn(latestVenues[0],"id"),idLength:typeof latestVenues[0].id==="string"?latestVenues[0].id.length:null})',
              returnByValue: true, silent: true, throwOnSideEffect: true,
            }),
            new Promise((_, reject) => { pauseTimer = setTimeout(() => reject(Error("Read-only projection metrics timeout")), 15000); }),
          ]);
          clearTimeout(pauseTimer);
          assert.equal(Boolean(observation.exceptionDetails), false, "Read-only projection metrics failed");
          check.projection = observation.result.value;
          assert.ok(check.projection && Number.isInteger(check.projection.count), "Bounded projection metrics missing");
        } finally {
          clearTimeout(pauseTimer);
          session.off("Debugger.scriptParsed", onScript);
          if (onPaused) session.off("Debugger.paused", onPaused);
          for (const clean of [
            async () => { if (paused) await session.send("Debugger.resume"); },
            async () => { if (breakpointId) await session.send("Debugger.removeBreakpoint", { breakpointId }); },
            async () => { await session.detach(); },
          ]) {
            try { await clean(); }
            catch (error) { (check.cleanupErrors ??= []).push(error.message); }
          }
          const deliveryError = await delivery;
          if (deliveryError) (check.cleanupErrors ??= []).push(deliveryError.message);
        }
        assert.equal(check.cleanupErrors?.length ?? 0, 0, "Debugger cleanup failed");
        const cards = widget.locator("#venues > li");
        await cards.first().getByRole("heading", { name: bad.name, exact: true }).waitFor();
        assert.equal(await cards.count(), 2, "Discarding unused ID must retain both venues");
        assert.deepEqual(await cards.first().locator(".price").allTextContents(), groundedPrices, "Discarding unused ID changed grounded prices");
        assert.equal(await cards.first().getByRole("link", { name: "Open pub in PUBMAXX", exact: true }).getAttribute("href"), bad.href, "Discarding unused ID changed canonical venue link");
        assert.equal(await cards.nth(1).getByRole("heading").textContent(), valid.name, "Discarding unused ID changed valid sibling");
        assert.equal(await cards.nth(1).getByRole("link", { name: "Open pub in PUBMAXX", exact: true }).getAttribute("href"), valid.href, "Discarding unused ID changed sibling canonical link");
        assert.equal(check.projection.count, 2);
        assert.equal(check.projection.hasOwnId, false, "Unused oversized ID survived actual widget projection");
        assert.equal(check.projection.idLength, null, "Actual widget retained unused ID string");
      }
      if (name === "publisher-label-retention") {
        await widget.locator(".maplibregl-canvas").waitFor();
        const priced = result.structuredContent.venues.flatMap((venue, index) => venue.prices.map((price) => ({ price, index }))).find(({ price }) => {
          const publisher = price.publisher;
          if (!publisher || typeof publisher.label !== "string" || !publisher.label.trim() || publisher.label.length > 160 || typeof publisher.url !== "string" || publisher.url.length > 2048) return false;
          try { const url = new URL(publisher.url); return url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2048; }
          catch { return false; }
        });
        assert.ok(priced, "Actual MCP result needs a grounded price with a recorded safe publisher");
        const { price, index: pricedIndex } = priced;
        const siblingIndex = result.structuredContent.venues.findIndex((venue, index) => index !== pricedIndex && typeof venue.href === "string");
        assert.ok(siblingIndex >= 0, "Actual MCP result needs a valid sibling canonical link");
        const label = price.publisher.label.trim();
        const pounds = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
        const groundedPrices = [`${pounds.format(price.priceGbp)} · ${price.drink}`];
        const unicodeUrl = `https://publisher.example/${"é".repeat(500)}`;
        assert.ok(unicodeUrl.length <= 2048 && new URL(unicodeUrl).href.length > 2048, "Publisher fixture must cross only the normalised URL bound");
        const variants = [
          { name: "http", url: "http://publisher.example/recorded-price" },
          { name: "credentials", url: "https://fixture-user:fixture-password@publisher.example/recorded-price" },
          { name: "raw-oversize", url: `https://publisher.example/${"x".repeat(65536)}` },
          { name: "normalised-oversize", url: unicodeUrl },
          { name: "absent", url: null },
          { name: "safe", url: price.publisher.url },
        ];
        check.inputs = [];
        for (const variant of variants) {
          const supplied = structuredClone(result);
          const venue = supplied.structuredContent.venues[pricedIndex];
          const sibling = supplied.structuredContent.venues[siblingIndex];
          supplied.structuredContent.venues = [venue, sibling];
          venue.name = `Publisher label regression ${variant.name}`;
          // Grounded amount/drink and recorded label come from the actual MCP
          // result. Only the negative URL and control metadata are changed.
          venue.prices = [structuredClone(price)];
          venue.prices[0].publisher = variant.name === "absent" ? null : { label, url: variant.url };
          await page.evaluate((next) => window.sendResult(next), supplied);
          const cards = widget.locator("#venues > li");
          await cards.first().getByRole("heading", { name: venue.name, exact: true }).waitFor();
          const observe = (surface) => surface.evaluate((node, expected) => {
            const paragraphs = Array.from(node.querySelectorAll("p"), (item) => item.textContent);
            const prices = Array.from(node.querySelectorAll(".price"), (item) => item.textContent);
            const publisherAnchors = Array.from(node.querySelectorAll("a")).filter((anchor) => anchor.textContent.startsWith("Publisher:"));
            return {
              pricesIntact: JSON.stringify(prices) === JSON.stringify(expected.prices),
              recordedLabelRetained: paragraphs.includes(`Publisher: ${expected.label}. Link unavailable.`) || publisherAnchors.some((anchor) => anchor.textContent === `Publisher: ${expected.label}`),
              linkUnavailable: paragraphs.includes(`Publisher: ${expected.label}. Link unavailable.`),
              publisherNotRecorded: paragraphs.includes("Publisher not recorded"),
              publisherAnchorCount: publisherAnchors.length,
              safePublisherHrefIntact: publisherAnchors.length === 1 && publisherAnchors[0].href === expected.safeHref,
              canonicalIntact: Array.from(node.querySelectorAll("a")).some((anchor) => anchor.textContent === "Open pub in PUBMAXX" && anchor.href === expected.canonical),
              textLength: node.textContent.length,
            };
          }, { label, prices: groundedPrices, safeHref: new URL(price.publisher.url).href, canonical: venue.href });
          const observed = {
            variant: variant.name,
            venueCount: await cards.count(),
            list: await observe(cards.first()),
            siblingNameIntact: await cards.nth(1).getByRole("heading").textContent() === sibling.name,
            siblingCanonicalIntact: await cards.nth(1).getByRole("link", { name: "Open pub in PUBMAXX", exact: true }).getAttribute("href") === sibling.href,
          };
          await widget.getByRole("button", { name: venue.name, exact: true }).click();
          const popup = widget.locator(".maplibregl-popup");
          await popup.waitFor();
          observed.popup = await observe(popup);
          await page.screenshot({ path: `${output}publisher-label-${variant.name}.png`, fullPage: false });
          await popup.locator(".maplibregl-popup-close-button").click();
          if (variant.name === "safe") {
            const requestsBefore = await page.evaluate(() => window.pendingLinks.length);
            await cards.first().getByRole("link", { name: `Publisher: ${label}`, exact: true }).click();
            await page.waitForFunction((count) => window.pendingLinks.length > count, requestsBefore);
            await frame.waitForFunction((address) => document.getElementById("status").textContent.includes(`Copy this address: ${address}`), new URL(price.publisher.url).href);
            observed.safePublisherClicked = true;
            observed.hostRequestUrlLength = await page.evaluate(() => window.pendingLinks.at(-1).urlLength);
          }
          check.inputs.push(observed);
        }
        // Record every variant before asserting so a RED distinguishes lost
        // attribution from refusal of unsafe anchors, without retaining URLs.
        for (const observed of check.inputs) {
          assert.equal(observed.venueCount, 2, `${observed.variant} changed venue count`);
          assert.equal(observed.siblingNameIntact && observed.siblingCanonicalIntact, true, `${observed.variant} changed valid sibling`);
          for (const surface of [observed.list, observed.popup]) {
            assert.equal(surface.pricesIntact && surface.canonicalIntact, true, `${observed.variant} changed grounded price or canonical link`);
            assert.ok(surface.textLength <= 1500, `${observed.variant} retained unbounded rendered publisher text`);
            assert.equal(surface.publisherAnchorCount, observed.variant === "safe" ? 1 : 0, `${observed.variant} publisher anchor contract violated`);
            assert.equal(surface.publisherNotRecorded, observed.variant === "absent", `${observed.variant} misreported recorded publisher`);
            if (observed.variant !== "absent") assert.equal(surface.recordedLabelRetained, true, `${observed.variant} discarded recorded publisher label`);
            assert.equal(surface.linkUnavailable, observed.variant !== "safe" && observed.variant !== "absent", `${observed.variant} missing unavailable-link disclosure`);
            if (observed.variant === "safe") assert.equal(surface.safePublisherHrefIntact, true, "Safe publisher link changed");
          }
          if (observed.variant === "safe") {
            assert.equal(observed.safePublisherClicked, true);
            assert.equal(observed.hostRequestUrlLength, new URL(price.publisher.url).href.length);
          }
        }
      }
      check.verdict = "PASS";
    } catch (error) {
      check.verdict = "FAIL";
      check.error = error.message;
    } finally {
      releaseImport();
      try { await importRouteCompletion; }
      catch (error) { (check.cleanupErrors ??= []).push(error.message); check.verdict = "FAIL"; }
      try { await context.close(); }
      catch (error) { (check.cleanupErrors ??= []).push(error.message); check.verdict = "FAIL"; }
      receipt.checks.push(check);
    }
  }
  receipt.sourceSha256After = await hashes();
  assert.deepEqual(receipt.sourceSha256After, receipt.sourceSha256, "Source changed during proof");
  receipt.verdict = receipt.checks.every((check) => check.verdict === "PASS") ? "PASS" : "FAIL";
  if (receipt.verdict === "FAIL") process.exitCode = 1;
} catch (error) {
  receipt.verdict = "FAIL";
  receipt.error = error.message;
  process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  try { await browser?.close(); } catch (error) { cleanupErrors.push(error.message); }
  try { await client?.close(); } catch (error) { cleanupErrors.push(error.message); }
  for (const httpServer of [host, server]) {
    if (!httpServer) continue;
    try {
      httpServer.closeAllConnections();
      await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    } catch (error) { cleanupErrors.push(error.message); }
  }
  if (cleanupErrors.length) { receipt.cleanupErrors = cleanupErrors; receipt.verdict = "FAIL"; process.exitCode = 1; }
  await writeFile(`${output}result.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
}
