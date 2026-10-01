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

// Real widget, SDK, venue result and vector tiles in a controlled local host.
// This proves neither authenticated ChatGPT nor public hosting or navigation.
const output = fileURLToPath(new URL("../../artifacts/chatgpt-map-recovery/", import.meta.url));
const sourcePaths = ["widget.html", "server.mjs", "widget-recovery-proof.mjs"];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async (name) => [name, createHash("sha256").update(await readFile(new URL(name, import.meta.url))).digest("hex")])));
const receipt = {
  checkedAt: new Date().toISOString(),
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8" }).trim(),
  scope: "Actual local widget, controlled MCP Apps host, real OpenFreeMap vector responses and rendered street features. No authenticated ChatGPT or public release proof.",
  sourceSha256: await hashes(), checks: [],
};
await mkdir(output, { recursive: true });
let server, client, host, browser;

async function waitFor(observe, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await observe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(message);
}

// Only numeric vector z/x/y URLs qualify. Style JSON, glyph ranges and images
// cannot supply a false failure or recovery receipt.
function vectorTile(address) {
  const url = new URL(address);
  if (url.origin !== "https://tiles.openfreemap.org") return null;
  const match = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)(?:\.pbf|\.mvt)?$/);
  return match ? { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) } : null;
}

function tileInView(tile, view) {
  const scale = 2 ** tile.z;
  const latitude = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI;
  const west = tile.x / scale * 360 - 180, east = (tile.x + 1) / scale * 360 - 180;
  const north = latitude(tile.y), south = latitude(tile.y + 1);
  const [[viewWest, viewSouth], [viewEast, viewNorth]] = view.bounds;
  return tile.z === Math.floor(view.zoom) && east > viewWest && west < viewEast && north > viewSouth && south < viewNorth;
}

// Native debugger reads the actual Map instance at a real host-result render.
// Served source, MapLibre and application APIs are never replaced. Subsequent
// observations call public Map APIs, including the painted-feature query.
async function inspectMap(context, page, widgetUrl, deliver) {
  const session = await context.newCDPSession(page);
  const scripts = [];
  session.on("Debugger.scriptParsed", (script) => { if (script.url === widgetUrl) scripts.push(script); });
  let breakpointId, paused = false, timer, onPaused, delivery;
  try {
    await session.send("Debugger.enable");
    let target;
    for (const script of scripts) {
      const { scriptSource } = await session.send("Debugger.getScriptSource", { scriptId: script.scriptId });
      const lines = scriptSource.split("\n");
      const line = lines.findIndex((text, index) => text.includes('element("area").textContent=data.area;') && lines[index - 1]?.includes("latestVenues=safeVenues(data.venues)"));
      if (line >= 0) {
        assert.equal(target, undefined, "Multiple actual render boundaries found");
        target = { scriptId: script.scriptId, lineNumber: script.startLine + line, columnNumber: lines[line].indexOf("element(") + (line === 0 ? script.startColumn : 0) };
      }
    }
    assert.ok(target, "Actual widget render boundary absent");
    const breakpoint = await session.send("Debugger.setBreakpoint", { location: target });
    breakpointId = breakpoint.breakpointId;
    assert.equal(breakpoint.actualLocation.lineNumber, target.lineNumber);
    const stopped = new Promise((resolve, reject) => {
      onPaused = (event) => { paused = true; resolve(event); };
      session.on("Debugger.paused", onPaused);
      timer = setTimeout(() => reject(Error("Actual widget render breakpoint timeout")), 15000);
    });
    delivery = deliver().then(() => null, (error) => error);
    const event = await stopped;
    clearTimeout(timer);
    assert.ok(event.hitBreakpoints?.includes(breakpointId));
    const renderFrame = event.callFrames.find((candidate) => candidate.functionName === "render");
    assert.ok(renderFrame, "Actual render frame absent");
    const captured = await session.send("Debugger.evaluateOnCallFrame", { callFrameId: renderFrame.callFrameId, expression: "map", silent: true, throwOnSideEffect: true, objectGroup: "streets-recovery" });
    assert.equal(Boolean(captured.exceptionDetails), false);
    assert.ok(captured.result.objectId, "Actual Map instance absent");
    await session.send("Debugger.resume"); paused = false;
    await session.send("Debugger.removeBreakpoint", { breakpointId }); breakpointId = undefined;
    const deliveryError = await delivery;
    if (deliveryError) throw deliveryError;
    return {
      async view() {
        const observed = await session.send("Runtime.callFunctionOn", {
          objectId: captured.result.objectId, returnByValue: true, silent: true,
          functionDeclaration: `function(){
            const layers=(this.getStyle()?.layers??[]).filter(layer=>layer.type==='line'&&layer['source-layer']==='transportation'&&/road|street|highway|motorway/i.test(layer.id)).map(layer=>layer.id);
            const canvas=this.getCanvas();
            const features=layers.length?this.queryRenderedFeatures([[0,0],[canvas.clientWidth,canvas.clientHeight]],{layers}):[];
            return {zoom:this.getZoom(),bounds:this.getBounds().toArray(),moving:this.isMoving(),settled:this.areTilesLoaded(),styleLoaded:this.isStyleLoaded(),streetLayers:layers,paintedStreets:features.filter(feature=>feature.geometry.type==='LineString'||feature.geometry.type==='MultiLineString').length};
          }`,
        });
        assert.equal(Boolean(observed.exceptionDetails), false, "Public Map observation failed");
        assert.ok(observed.result.value && Number.isFinite(observed.result.value.zoom));
        return observed.result.value;
      },
      async close() { await session.send("Runtime.releaseObjectGroup", { objectGroup: "streets-recovery" }); await session.detach(); },
    };
  } catch (error) {
    if (paused) await session.send("Debugger.resume");
    if (breakpointId) await session.send("Debugger.removeBreakpoint", { breakpointId });
    await session.detach();
    if (delivery) await delivery;
    throw error;
  } finally {
    clearTimeout(timer);
    if (onPaused) session.off("Debugger.paused", onPaused);
  }
}

try {
  server = await createPublicMapHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  client = new Client({ name: "pubmaxx-streets-recovery", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const result = await client.callTool({ name: "pubmaxx_venues_in_area", arguments: { area: "Camden", limit: 3 } });
  const next = await client.callTool({ name: "pubmaxx_venues_in_area", arguments: { area: "Camden", limit: 2 } });
  assert.equal(result.isError, undefined); assert.equal(next.isError, undefined);
  assert.equal(result.structuredContent.venues.length, 3); assert.equal(next.structuredContent.venues.length, 2);
  const resource = await client.readResource({ uri: "ui://pubmaxx/public-map/v1.html" });
  const csp = resource.contents[0]._meta.ui.csp;
  const policy = ["default-src 'none'", `script-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(" ")}`, `style-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(" ")}`, `connect-src 'self' ${csp.connectDomains.join(" ")}`, `img-src 'self' data: ${csp.resourceDomains.join(" ")}`, `font-src 'self' ${csp.resourceDomains.join(" ")}`, "frame-src 'none'", "object-src 'none'", "base-uri 'self'"].join("; ");
  const encoded = JSON.stringify(result).replaceAll("<", "\\u003c");
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{display:block;border:0;width:100%;height:100vh}</style><iframe title="PUBMAXX public map" sandbox="allow-scripts allow-same-origin" src="${base}/widget"></iframe><script>
    const frame=document.querySelector('iframe');const send=message=>frame.contentWindow.postMessage({jsonrpc:'2.0',...message},'${base}');
    window.links=[];window.sendResult=result=>send({method:'ui/notifications/tool-result',params:result});
    addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.data?.jsonrpc!=='2.0')return;const message=event.data;
      if(message.method==='ui/initialize')send({id:message.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'controlled-recovery-host',version:'1.0.0'},hostCapabilities:{openLinks:{}},hostContext:{displayMode:'inline',theme:'light'}}});
      if(message.method==='ui/notifications/initialized'){window.initialized=true;window.sendResult(${encoded});}
      if(message.method==='ui/open-link'){window.links.push(message.params.url);send({id:message.id,result:{isError:false}});}
      if(message.method==='ui/notifications/size-changed'&&Number.isFinite(message.params?.height))frame.style.height=message.params.height+'px';
    });</script>`;
  host = createServer((_request, response) => response.writeHead(200, { "Content-Type": "text/html" }).end(html));
  await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
  const executablePath = process.env.PUBMAX_MCP_CHROMIUM_EXECUTABLE;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ["--enable-unsafe-swiftshader"] });
  receipt.browser = { playwrightVersion: JSON.parse(await readFile(new URL("../../node_modules/playwright/package.json", import.meta.url), "utf8")).version, lockedDefaultExecutable: chromium.executablePath(), launchedExecutable: executablePath ?? chromium.executablePath(), launchedVersion: browser.version(), explicitCachedFallback: Boolean(executablePath) };
  for (const name of ["persistent-vector-outage", "transient-vector-recovery"]) {
    const check = { name, tiles: [] };
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
    let inspector, stage = "healthy", releaseRecovery = () => {};
    const recoveryReleased = new Promise((resolve) => { releaseRecovery = resolve; });
    const routes = new Set();
    try {
      await context.route(`${base}/widget`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), "Content-Security-Policy": policy } });
      });
      await context.route("https://tiles.openfreemap.org/**", (route) => {
        const tile = vectorTile(route.request().url());
        if (!tile) return route.continue();
        const entry = { url: route.request().url(), ...tile, stage, outcome: "pending" };
        check.tiles.push(entry);
        const completion = (async () => {
          try {
            if (entry.stage === "outage") { await route.abort("failed"); entry.outcome = "aborted"; return; }
            if (entry.stage === "held-recovery") await recoveryReleased;
            const response = await route.fetch({ timeout: 15000 });
            entry.httpStatus = response.status();
            await route.fulfill({ response });
            entry.outcome = response.ok() ? "fulfilled" : "http-error";
          } catch (error) { entry.outcome = "failed"; entry.error = error.message; await route.abort().catch(() => {}); }
        })();
        routes.add(completion); void completion.then(() => routes.delete(completion), () => routes.delete(completion));
        return completion;
      });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${host.address().port}`, { waitUntil: "domcontentloaded", timeout: 15000 });
      const widget = page.frameLocator('iframe[title="PUBMAXX public map"]');
      await widget.locator("#venues > li").nth(2).waitFor();
      await widget.locator(".maplibregl-canvas").waitFor();
      inspector = await inspectMap(context, page, `${base}/widget`, () => page.evaluate((data) => window.sendResult(data), result));
      check.before = await waitFor(async () => { const view = await inspector.view(); check.lastView = view; return !view.moving && view.settled && view.styleLoaded && view.paintedStreets > 0 ? view : null; }, "Healthy actual map never painted streets; recovery precondition failed");
      assert.equal(await widget.locator("#status").textContent(), "3 listed pubs.", "Healthy setup already has a warning");
      await page.screenshot({ path: `${output}${name}-before.png`, fullPage: true });
      stage = "outage";
      await widget.getByRole("button", { name: "Zoom out", exact: true }).click();
      await waitFor(() => check.tiles.some((tile) => tile.stage === "outage" && tile.outcome === "aborted"), "Native zoom did not request a real vector tile in the outage");
      await widget.locator("#status").filter({ hasText: "Streets could not load" }).waitFor();
      check.failedView = await waitFor(async () => { const view = await inspector.view(); return !view.moving && check.tiles.some((tile) => tile.stage === "outage" && tile.outcome === "aborted" && tileInView(tile, view)) ? view : null; }, "Failed tile is outside the current visible grid");
      await widget.locator("#venues").getByRole("link", { name: "Open pub in PUBMAXX", exact: true }).first().click();
      await page.waitForFunction(() => window.links.length === 1);
      assert.equal(await widget.locator("#venues > li").count(), 3, "Tile failure lost real pub cards");
      check.cardsRemainUsable = true;
      if (name === "persistent-vector-outage") {
        await page.evaluate((data) => window.sendResult(data), next);
        await widget.locator("#venues > li").nth(1).waitFor();
        await widget.getByRole("button", { name: "Zoom out", exact: true }).click();
        check.stillFailed = await waitFor(async () => {
          const view = await inspector.view();
          return !view.moving && view.settled && check.tiles.some((tile) => tile.stage === "outage" && tile.outcome === "aborted" && tileInView(tile, view)) ? view : null;
        }, "Persistent case never reached settled errored visible tiles");
        assert.equal(await widget.locator("#venues > li").count(), 2, "Persistent outage lost newer MCP result");
        check.status = await widget.locator("#status").textContent();
        assert.ok(check.status.includes("2 listed pubs.") && check.status.includes("Streets could not load"), `Settled errored tiles or newer results masked continuing outage: ${check.status}`);
      } else {
        const priorUrls = new Set(check.tiles.map((tile) => tile.url));
        stage = "held-recovery";
        // Errored child tiles trigger MapLibre parent fallback down to z0.
        // Zoom above the healthy grid so recovery cannot reuse those tiles.
        for (let step = 0; step < 2; step++) {
          await widget.getByRole("button", { name: "Zoom in", exact: true }).click();
          await waitFor(async () => !(await inspector.view()).moving, "Native recovery zoom never stopped moving");
        }
        await waitFor(() => check.tiles.some((tile) => tile.stage === "held-recovery" && !priorUrls.has(tile.url)), "Native recovery zoom reused old grid instead of requesting fresh visible tiles");
        check.heldView = await waitFor(async () => { const view = await inspector.view(); return !view.moving && check.tiles.some((tile) => tile.stage === "held-recovery" && !priorUrls.has(tile.url) && tileInView(tile, view)) ? view : null; }, "Held recovery tile is outside current visible grid");
        assert.ok((await widget.locator("#status").textContent()).includes("Streets could not load"), "Warning cleared before a fresh recovery vector response");
        await page.screenshot({ path: `${output}${name}-held.png`, fullPage: true });
        releaseRecovery();
        check.recoveredView = await waitFor(async () => {
          const view = await inspector.view();
          const visible = check.tiles.filter((tile) => tile.stage === "held-recovery" && tileInView(tile, view));
          return !view.moving && view.settled && view.styleLoaded && view.paintedStreets > 0 && visible.length > 0 && visible.every((tile) => tile.outcome === "fulfilled") && visible.some((tile) => !priorUrls.has(tile.url)) ? view : null;
        }, "Fresh visible vector grid did not fulfill and paint real street lines");
        const frame = page.frames().find((candidate) => candidate.url() === `${base}/widget`);
        assert.ok(frame);
        await frame.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.screenshot({ path: `${output}${name}-painted.png`, fullPage: true });
        await frame.waitForFunction(() => document.getElementById("status").textContent === "3 listed pubs.", null, { timeout: 5000 });
        check.status = await widget.locator("#status").textContent();
        assert.equal(await widget.locator("#venues > li").count(), 3, "Recovery lost real pub cards");
      }
      await page.screenshot({ path: `${output}${name}-after.png`, fullPage: true });
      check.verdict = "PASS";
    } catch (error) { check.verdict = "FAIL"; check.error = error.message; }
    finally {
      releaseRecovery();
      for (const clean of [() => Promise.allSettled([...routes]), () => inspector?.close(), () => context.close()]) {
        try { await clean(); }
        catch (error) { (check.cleanupErrors ??= []).push(error.message); check.verdict = "FAIL"; }
      }
      receipt.checks.push(check);
    }
  }
  receipt.sourceSha256After = await hashes();
  assert.deepEqual(receipt.sourceSha256After, receipt.sourceSha256, "Source changed during recovery proof");
  receipt.verdict = receipt.checks.every((check) => check.verdict === "PASS") ? "PASS" : "FAIL";
  if (receipt.verdict === "FAIL") process.exitCode = 1;
} catch (error) { receipt.verdict = "FAIL"; receipt.error = error.message; process.exitCode = 1; }
finally {
  for (const clean of [() => browser?.close(), () => client?.close(), ...[host, server].filter(Boolean).map((httpServer) => async () => { httpServer.closeAllConnections(); await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve())); })]) {
    try { await clean(); } catch (error) { (receipt.cleanupErrors ??= []).push(error.message); receipt.verdict = "FAIL"; process.exitCode = 1; }
  }
  await writeFile(`${output}result.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
}
