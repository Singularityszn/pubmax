import { expect, it } from "vitest";
import { chromium } from "playwright";
import { nightArchitectWidget } from "@/lib/chatgpt/widget.server";

const mapModule = `
export function setWorkerUrl() {}
export class Map {
  constructor() { this.events={}; this.sources={}; this.styleLoaded=true; window.testMap=this; window.mutations=[]; }
  on(name, handler) { (this.events[name]??=[]).push(handler); }
  once(name, handler) { const once=()=>{this.events[name]=this.events[name].filter(h=>h!==once);handler();};this.on(name,once); }
  emit(name) { for(const handler of [...(this.events[name]??[])])handler(); }
  change(kind) { window.mutations.push({kind,state:document.getElementById('map').dataset.state}); }
  addControl() {}
  isStyleLoaded() { return this.styleLoaded; }
  getSource(id) { return this.sources[id]; }
  addSource(id) { this.change('source');this.sources[id]={setData:()=>this.change('source')}; }
  addLayer() {}
  fitBounds() { this.change('bounds'); }
  panBy() { this.change('pan'); }
  triggerRepaint() {}
  remove() {}
}
export class NavigationControl {}
export class LngLatBounds { extend() {} }
export class Popup {
  setDOMContent(node) { this.node=node;return this; }
  on(name,handler) { if(name==='open')this.open=handler; }
  getElement() { return this.node; }
}
export class Marker {
  constructor({element}) { this.element=element; }
  setLngLat() { return this; }
  setPopup(popup) { this.popup=popup;return this; }
  addTo() { document.getElementById('map').append(this.element);this.element.onclick=()=>this.togglePopup();return this; }
  togglePopup() {
    this.popup.node.style.cssText='position:fixed;top:-200px;left:-200px;width:200px;height:300px';
    document.body.append(this.popup.node);this.popup.open();
  }
  remove() { this.element.remove();this.popup.node.remove(); }
}
`;

const host = `<!doctype html><meta charset="utf-8"><iframe title="Night Architect" src="/widget"></iframe><script>
const frame=document.querySelector('iframe');
const send=m=>frame.contentWindow.postMessage({jsonrpc:'2.0',...m},location.origin);
window.sendResult=result=>send({method:'ui/notifications/tool-result',params:result});
addEventListener('message',event=>{
  if(event.source!==frame.contentWindow||event.data?.jsonrpc!=='2.0')return;
  const m=event.data;
  if(m.method==='ui/initialize')send({id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'controlled-test-host',version:'1'},hostCapabilities:{},hostContext:{theme:'light',displayMode:'inline'}}});
  if(m.method==='ui/notifications/initialized')window.initialized=true;
});</script>`;

function evening(name: string) {
  return { structuredContent: {
    area: "Camden", venueIds: ["venue-one", "venue-two", "venue-three"],
    budget: { knownPence: 2000 },
    venues: [{
      id: "venue-one", name, latitude: 51.54, longitude: -0.14,
      href: "https://pubmaxxing.com/map?venue=venue-one", history: [],
      prices: [
        { drink: "Model pint", priceGbp: 6.73, status: "estimate", observedAt: null, computedAt: "2026-10-05T23:53:08.357Z", basis: "regional model", publisher: null },
        { drink: "Listed pint", priceGbp: 6.5, status: "recorded", observedAt: "2026-10-18T21:37:55.150Z", publisher: { label: "Menu", url: "https://pub.example/menu" } },
      ],
    }],
  } };
}

it.each([390, 1440])("updates the executable widget after idle at width %i", async (width) => {
  const widget = await nightArchitectWidget();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://unpkg.com/**", (route) => route.fulfill({
      contentType: route.request().url().endsWith(".css") ? "text/css" : "text/javascript",
      headers: { "access-control-allow-origin": "*" }, body: route.request().url().endsWith(".css") ? "" : mapModule,
    }));
    await page.route("http://pubmaxx.test/**", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8", body: route.request().url().endsWith("/widget") ? widget : host,
    }));
    await page.goto("http://pubmaxx.test/");
    await page.waitForFunction(() => (window as unknown as { initialized: boolean }).initialized);
    const frame = page.frames().find((entry) => entry.url().endsWith("/widget"))!;
    await frame.waitForFunction(() => Boolean((window as unknown as { testMap: unknown }).testMap));
    const emit = (event: string) => frame.evaluate((name) => {
      (window as unknown as { testMap: { emit(name: string): void } }).testMap.emit(name);
    }, event);
    const send = async (name: string) => {
      await page.evaluate((result) => (window as unknown as { sendResult(result: unknown): void }).sendResult(result), evening(name));
      await frame.getByRole("heading", { name: `1. ${name}`, exact: true }).waitFor();
    };
    await emit("idle");
    expect(await frame.locator("#map").getAttribute("data-state")).toBe("ready");
    await send("First evening");
    expect(await frame.locator("#map").getAttribute("data-state")).toBe("loading");
    await emit("idle");
    expect(await frame.locator("#map").getAttribute("data-state")).toBe("ready");
    await send("Changed evening");
    expect(await frame.locator("#map").getAttribute("data-state")).toBe("loading");
    expect(await frame.locator("#venues time").allTextContents()).toEqual(["Modelled 6 October 2026", "Read 18 October 2026"]);
    expect(await frame.locator("#venues time").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime"))))
      .toEqual(["2026-10-05T23:53:08.357Z", "2026-10-18T21:37:55.150Z"]);
    await emit("idle");
    await frame.getByRole("button", { name: "Changed evening", exact: true }).click();
    expect(await frame.locator("#map").getAttribute("data-state")).toBe("loading");
    expect(await frame.locator(".popup-card time").allTextContents()).toEqual(["Modelled 6 October 2026", "Read 18 October 2026"]);
    await emit("idle");
    expect(await frame.locator("#map").getAttribute("data-state")).toBe("ready");
    await frame.evaluate(() => { (window as unknown as { testMap: { styleLoaded: boolean } }).testMap.styleLoaded = false; });
    await send("Deferred route");
    expect(await frame.locator("#map").getAttribute("data-state")).toBe("loading");
    await emit("load");
    expect(await frame.locator("#map").getAttribute("data-state")).toBe("loading");
    await emit("idle");
    expect(await frame.locator("#map").getAttribute("data-state")).toBe("ready");
    await send("Failed tiles");
    await emit("error");
    expect(await frame.locator("#map").getAttribute("data-state")).toBe("degraded");
    await emit("idle");
    expect(await frame.locator("#map").getAttribute("data-state")).toBe("degraded");
    const mutations = await frame.evaluate(() => (window as unknown as { mutations: Array<{ kind: string; state: string }> }).mutations);
    expect(mutations.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["source", "bounds", "pan"]));
    expect(mutations.every((entry) => entry.state === "loading")).toBe(true);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
});
