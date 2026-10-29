import { expect, type Page, type TestInfo, type Request } from "@playwright/test";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { DEFAULT_PAL_DRAFT } from "../../lib/pubPal";
import { ACCOUNTS, accessJwt, installAuthDoubles, readDeviceIdentity, readDeviceAccounts, seedSignedIn } from "./authDoubles";

export const ROBIN = { species: "robin", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id, name: "Robin", sha: "c69915c4a4df2bd44e52a91d9d4f301182d0d45e612215ad88a726e2ba87f327", file: "circuit-robin-c69915c4a4df.glb" } as const;
export const FOX = { species: "fox", id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ownerId: ACCOUNTS.B.id, name: "Fox", sha: "80d07a250094238a5bae7a0b5d7ccaa5cc31e06203dc9518a0e9d341d64771ba", file: "circuit-fox-80d07a250094.glb" } as const;
export type Character = typeof ROBIN | typeof FOX;
const modelPath = (url: string) => /\/brand\/pals\/[^/]+\.glb$/.test(new URL(url).pathname);
export const portrait = (page: Page) => page.locator(".palHomePortrait");
export const host = (page: Page) => portrait(page).locator("[data-pal-model-host]");
export const canvas = (page: Page) => portrait(page).locator("canvas");

export async function fixture(page: Page, baseURL: string, twoOwners = false) {
  const boundary: unknown[] = [], ownerReads: string[] = [];
  await page.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin) {
      boundary.push({ method: route.request().method(), url: url.origin + url.pathname });
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
  await page.context().routeWebSocket(/.*/, socket => { boundary.push({ socket: new URL(socket.url()).origin }); socket.close({ code: 1008, reason: "No provider sockets" }); });
  await page.route(/\/api\/(?:ask|pub-pal\/(?:chat|tool-turn|tools|voice-session|signed-url))(?:[/?]|$)/, async route => { boundary.push({ action: new URL(route.request().url()).pathname }); await route.abort("blockedbyclient"); });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  if (twoOwners) {
    await page.goto("/social");
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
    await auth.signedInAs("B");
    await page.goto("/social");
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
    await expect.poll(async () => (await readDeviceAccounts(page)).length).toBe(2);
    await auth.signedInAs("A");
    await page.goto("/social");
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  }
  let holdB = false;
  let releaseB!: () => void;
  const waitingB = new Promise<void>(resolve => { releaseB = resolve; });
  await page.route("**/api/pub-pal", async route => {
    const bearer = route.request().headers().authorization;
    const isB = bearer === `Bearer ${accessJwt(ACCOUNTS.B)}` || bearer === "Bearer pubmaxx-e2e-access-token-B";
    const isA = bearer === `Bearer ${accessJwt(ACCOUNTS.A)}` || bearer === "Bearer pubmaxx-e2e-access-token-A";
    if (!isA && !isB) { await route.fulfill({ status: 401, json: { error: "No fixture owner" } }); return; }
    const character = isB ? FOX : ROBIN;
    ownerReads.push(character.ownerId);
    if (isB && holdB) await waitingB;
    const timestamp = "2026-10-04T12:00:00.000Z";
    await route.fulfill({ json: { adultOnFile: true, pal: { id: character.id, ownerId: character.ownerId, name: character.name, adultAttestedAt: timestamp, appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: character.species }, personality: DEFAULT_PAL_DRAFT.personality, voice: DEFAULT_PAL_DRAFT.voice, muted: false, hidden: false, proposalPreferences: { memories: true, routes: true }, masteryPoints: 0, createdAt: timestamp, updatedAt: timestamp } } });
  });
  await page.route("**/api/pub-pal/memories", route => route.fulfill({ json: { memories: [] } }));
  await page.route("**/api/pub-pal/voice-token", route => route.fulfill({ json: { available: false } }));
  return { boundary, ownerReads, holdB: () => { holdB = true; }, releaseB };
}

export function capture(page: Page) {
  const requests: Request[] = [], bodies: Promise<void>[] = [];
  const events: Array<Record<string, unknown>> = [], models: Array<{ requestId: number; url: string; sha256: string }> = [];
  const errors: Array<{ requestId: number; url: string; message: string }> = [];
  const readyProofs: Array<{ requestId: number; url: string; sha256: string; readyVisibleMesh: true }> = [];
  const tracked = new Map<Request, number>();
  page.on("request", request => {
    if (request.frame() === page.mainFrame() && new URL(request.frame().url()).pathname === "/pal" && modelPath(request.url())) {
      requests.push(request); tracked.set(request, requests.length);
      events.push({ event: "request", id: requests.length, url: request.url(), document: request.frame().url() });
    }
  });
  page.on("requestfailed", request => { if (tracked.has(request)) events.push({ event: "requestfailed", id: tracked.get(request), failure: request.failure()?.errorText }); });
  page.on("requestfinished", request => { if (tracked.has(request)) events.push({ event: "requestfinished", id: tracked.get(request) }); });
  page.on("response", response => {
    const id = tracked.get(response.request());
    if (!id) return;
    events.push({ event: "response", id, status: response.status() });
    bodies.push((async () => {
      if (!response.ok()) throw Error(`Model response status ${response.status()}`);
      models.push({ requestId: id, url: response.url(), sha256: createHash("sha256").update(await response.body()).digest("hex") });
    })().catch(error => { errors.push({ requestId: id, url: response.url(), message: String(error) }); }));
  });
  return { requests, models, events, errors, readyProofs, settle: () => Promise.all(bodies) };
}
export type Capture = ReturnType<typeof capture>;

export async function decoded(page: Page, visible = false) {
  const image = portrait(page).locator('img[alt="Pub Pal"]');
  await expect(image).toHaveCount(1);
  await expect.poll(() => image.evaluate(n => (n as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  if (visible) await expect(image).toBeVisible();
}
export async function ready(page: Page, seen: Capture, character: Character = ROBIN) {
  await expect(page.getByRole("heading", { name: character.name, exact: true })).toBeVisible();
  await expect(host(page)).toHaveAttribute("data-model-state", "ready");
  await expect(canvas(page)).toBeVisible();
  await expect(portrait(page).locator(".palPortrait")).toHaveAttribute("data-head-3d", "mesh");
  await expect.poll(async () => { await seen.settle(); return seen.models.filter(x => x.url.endsWith(character.file)).map(x => x.sha256); }).toContain(character.sha);
  await decoded(page);
  // This proof is recorded only after the real ready/visible/exact-asset assertions.
  for (const model of seen.models.filter(item => item.url.endsWith(character.file) && item.sha256 === character.sha)) {
    seen.readyProofs.push({ ...model, readyVisibleMesh: true });
  }
}
export async function shot(page: Page, info: TestInfo, name: string) {
  const bytes = await canvas(page).screenshot({ path: info.outputPath(name + ".png") });
  const { data, info: pixels } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let foreground = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    if (data[i + 3]! > 0 && Math.max(r, g, b) - Math.min(r, g, b) > 40 && Math.max(r, g, b) > 60) foreground++;
  }
  expect(foreground, "A nonempty coloured model region must paint inside the captured canvas").toBeGreaterThan(100);
  expect(foreground).toBeLessThan(pixels.width * pixels.height);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mask = await portrait(page).locator(".palPortraitCore").boundingBox();
  const frame = await portrait(page).locator(".palPortrait").boundingBox();
  expect(mask).not.toBeNull(); expect(frame).not.toBeNull();
  expect(mask!.x).toBeGreaterThanOrEqual(frame!.x - 1);
  expect(mask!.x + mask!.width).toBeLessThanOrEqual(frame!.x + frame!.width + 1);
  return bytes;
}
export async function observeDisposal(page: Page) {
  const retained = await canvas(page).elementHandle();
  if (!retained) throw Error("Ready canvas is absent");
  await retained.evaluate(node => {
    const canvas = node as HTMLCanvasElement & { acceptanceContextLost?: boolean };
    canvas.acceptanceContextLost = false;
    canvas.addEventListener("webglcontextlost", () => { canvas.acceptanceContextLost = true; });
  });
  return retained;
}

// Test-only observation. These passive listeners never dispatch or cancel input.
export async function observeInput(page: Page, resolved: { hasTouch: boolean; isMobile: boolean; viewport: { width: number; height: number } | null }) {
  await page.evaluate(options => {
    type Observation = { events: Record<string, unknown>[]; points: Record<string, unknown>[]; dropped: number; currentGesture: string; capabilities: Record<string, unknown> };
    const state: Observation = { events: [], points: [], dropped: 0, currentGesture: "", capabilities: {
      resolved: options, maxTouchPoints: navigator.maxTouchPoints, userAgent: navigator.userAgent,
      coarsePointer: matchMedia("(pointer: coarse)").matches, hoverNone: matchMedia("(hover: none)").matches,
      viewport: { width: innerWidth, height: innerHeight }, documentClientWidth: document.documentElement.clientWidth,
      metaViewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
      devicePixelRatio, scrollX, scrollY,
    } };
    (window as typeof window & { originalMeshInputObservation?: Observation }).originalMeshInputObservation = state;
    const describe = (target: EventTarget | null) => target instanceof Element ? { tag: target.tagName, id: target.id, classes: target.className } : null;
    const record = (event: Event) => {
      if (state.events.length >= 160) { state.dropped++; return; }
      const pointer = event as PointerEvent; const touch = event as TouchEvent;
      const owned = document.querySelector<HTMLCanvasElement>(".palHomePortrait canvas");
      state.events.push({ type: event.type, gesture: state.currentGesture, target: describe(event.target),
        ownedCanvasTarget: event.target === owned, pointerType: pointer.pointerType ?? null, pointerId: pointer.pointerId ?? null,
        clientX: pointer.clientX ?? null, clientY: pointer.clientY ?? null, touches: touch.touches?.length ?? null,
        changedTouches: touch.changedTouches ? Array.from(touch.changedTouches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY })) : null,
        captured: owned && typeof pointer.pointerId === "number" ? owned.hasPointerCapture(pointer.pointerId) : null,
        defaultPrevented: event.defaultPrevented, cancelable: event.cancelable, scrollX, scrollY, at: performance.now() });
    };
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture", "touchstart", "touchmove", "touchend", "touchcancel"]) {
      document.addEventListener(type, record, { capture: true, passive: true });
    }
    window.addEventListener("scroll", record, { capture: true, passive: true });
  }, resolved);
}
export async function recordHitPoint(page: Page, x: number, y: number, gesture: string) {
  const point = await page.evaluate(({ x, y, gesture }) => {
    const state = (window as typeof window & { originalMeshInputObservation?: { currentGesture: string; points: unknown[] } }).originalMeshInputObservation;
    if (!state) throw Error("Input observation was not installed"); state.currentGesture = gesture;
    const canvas = document.querySelector<HTMLCanvasElement>(".palHomePortrait canvas");
    const hit = document.elementFromPoint(x, y);
    const describe = (node: Element) => ({ tag: node.tagName, id: node.id, classes: node.className,
      touchAction: getComputedStyle(node).touchAction, pointerEvents: getComputedStyle(node).pointerEvents,
      box: node.getBoundingClientRect().toJSON() });
    const value = { gesture, x, y, scrollX, scrollY, ownedCanvasHit: !!canvas && hit === canvas,
      canvas: canvas ? describe(canvas) : null, stack: document.elementsFromPoint(x, y).slice(0, 8).map(describe) };
    if (state.points.length < 8) state.points.push(value);
    return value;
  }, { x, y, gesture });
  expect(point.ownedCanvasHit, "Injected start point must actually hit the owned canvas").toBe(true);
}
export async function requireDeliveredInput(page: Page, pointerType: string, gesture: string) {
  const events = await page.evaluate(() => (window as typeof window & { originalMeshInputObservation?: { events: Record<string, unknown>[] } }).originalMeshInputObservation?.events ?? []);
  expect(events.some(e => e.gesture === gesture && e.type === "pointerdown" && e.pointerType === pointerType && e.ownedCanvasTarget === true), "The canvas received this gesture's actual pointerdown").toBe(true);
  expect(events.some(e => e.gesture === gesture && e.type === "pointermove" && e.pointerType === pointerType && e.ownedCanvasTarget === true), "The canvas received this gesture's actual pointermove").toBe(true);
}


function classifyBodyErrors(seen: Capture) {
  const cancelledReplaced: Array<Record<string, unknown>> = [];
  const fatal: typeof seen.errors = [];
  for (const error of seen.errors) {
    const abortedOrdinal = seen.events.findIndex(event => event.event === "requestfailed" && event.id === error.requestId && event.failure === "net::ERR_ABORTED");
    const expectedSHA = error.url.endsWith(ROBIN.file) ? ROBIN.sha : error.url.endsWith(FOX.file) ? FOX.sha : null;
    const replacement = seen.models.find(model => model.requestId !== error.requestId && model.url === error.url && expectedSHA !== null && model.sha256 === expectedSHA
      && abortedOrdinal >= 0 && seen.events.findIndex(event => event.event === "requestfinished" && event.id === model.requestId) > abortedOrdinal
      && seen.readyProofs.some(proof => proof.requestId === model.requestId && proof.url === model.url && proof.sha256 === expectedSHA && proof.readyVisibleMesh));
    if (replacement) {
      const replacementFinishedOrdinal = seen.events.findIndex(event => event.event === "requestfinished" && event.id === replacement.requestId);
      cancelledReplaced.push({ error, recordedFailure: "net::ERR_ABORTED", abortedOrdinal, replacementFinishedOrdinal, replacement, readyVisibleMesh: true, cause: "UNKNOWN" });
    } else fatal.push(error);
  }
  return { cancelledReplaced, fatal };
}


export async function recordGestureEndCommand(page: Page, gesture: string) {
  await page.evaluate(gesture => {
    const state = (window as typeof window & { originalMeshInputObservation?: { events: Record<string, unknown>[]; dropped: number } }).originalMeshInputObservation;
    if (!state) throw Error("Input observation unavailable before end command");
    if (state.events.length >= 160) { state.dropped++; return; }
    state.events.push({ type: "end-command", observedEvent: false, gesture, scrollX, scrollY, at: performance.now() });
  }, gesture);
}

export async function requireEndedInput(page: Page, pointerType: string, gesture: string) {
  const read = () => page.evaluate(() => {
    const state = (window as typeof window & { originalMeshInputObservation?: { events: Record<string, unknown>[]; points: Record<string, unknown>[]; dropped: number } }).originalMeshInputObservation;
    if (!state) throw Error("Input observation unavailable at gesture end");
    return { ...state, finalScrollX: scrollX, finalScrollY: scrollY };
  });
  // Node-side polling does not advance the frozen page clock.
  await expect.poll(async () => {
    const state = await read();
    const events = state.events.filter(event => event.gesture === gesture);
    const downIndex = events.findIndex(event => event.type === "pointerdown" && event.pointerType === pointerType && event.ownedCanvasTarget === true);
    if (downIndex < 0) return false;
    const id = events[downIndex]!.pointerId;
    const commandedEnd = events.findIndex(event => event.type === "end-command");
    if (commandedEnd <= downIndex) return false;
    const up = events.some((event, index) => index > commandedEnd && event.type === "pointerup" && event.pointerType === pointerType && event.pointerId === id && event.ownedCanvasTarget === true);
    if (!up) return false;
    if (pointerType !== "touch") return true;
    const startIndex = events.findIndex(event => event.type === "touchstart" && event.ownedCanvasTarget === true);
    if (startIndex < 0) return false;
    const startTouches = events[startIndex]!.changedTouches as Array<{ id: number }> | null;
    return !!startTouches?.length && events.some((event, index) => index > commandedEnd && index > startIndex && event.type === "touchend" && event.ownedCanvasTarget === true && event.touches === 0
      && (event.changedTouches as Array<{ id: number }> | null)?.some(touch => touch.id === startTouches[0]!.id));
  }, { message: "This gesture delivered matching pointerup and, for touch, touchend before Home" }).toBe(true);
  const state = await read();
  const events = state.events.filter(event => event.gesture === gesture);
  const point = state.points.find(point => point.gesture === gesture);
  expect(point, "Gesture start geometry was retained").toBeDefined();
  expect(state.dropped, "No input observation was dropped").toBe(0);
  expect(events.some(event => event.type === "pointercancel" || event.type === "touchcancel"), "The completed gesture was not cancelled").toBe(false);
  expect(events.some(event => event.type === "scroll" || event.scrollX !== point!.scrollX || event.scrollY !== point!.scrollY), "The gesture did not cause unexpected native scrolling").toBe(false);
  expect(state.finalScrollX).toBe(point!.scrollX); expect(state.finalScrollY).toBe(point!.scrollY);
  // Close this observation interval before Home can focus or scroll the frame.
  await page.evaluate(() => {
    const state = (window as typeof window & { originalMeshInputObservation?: { currentGesture: string } }).originalMeshInputObservation;
    if (state) state.currentGesture = "after-gesture";
  });
}

export async function evidence(page: Page, info: TestInfo, seen: Capture, fx: Awaited<ReturnType<typeof fixture>>, run: () => Promise<void>) {
  let primary: unknown;
  const secondary: string[] = [];
  try { await run(); } catch (error) { primary = error; }
  finally {
    fx.releaseB();
    try { await page.clock.resume(); } catch (error) { secondary.push("Clock: " + String(error)); }
    try { await page.screenshot({ path: info.outputPath("actual-frame.png") }); } catch (error) { secondary.push("Screenshot: " + String(error)); }
    await seen.settle();
    let inputObservation: unknown = null;
    try { inputObservation = await page.evaluate(() => (window as typeof window & { originalMeshInputObservation?: unknown }).originalMeshInputObservation ?? null); }
    catch (error) { secondary.push("Input observation: " + String(error)); }
    let frame: unknown;
    try { frame = await portrait(page).evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, canvases: n.querySelectorAll("canvas").length, states: Array.from(n.querySelectorAll("[data-pal-model-host]")).map(h => ({ state: (h as HTMLElement).dataset.modelState, name: h.getAttribute("aria-label"), hidden: h.getAttribute("aria-hidden") })) }))); }
    catch (error) { secondary.push("Frame: " + String(error)); }
    try { await writeFile(info.outputPath("evidence.json"), JSON.stringify({ events: seen.events, models: seen.models, bodyErrors: seen.errors, bodyClassification: classifyBodyErrors(seen), readyProofs: seen.readyProofs, boundary: fx.boundary, ownerReads: fx.ownerReads, frame, inputObservation, primaryFailure: primary ? String(primary) : null, secondary, rendering: "Real WebGL through SwiftShader software rendering. No hardware-GPU or physical-device acceptance." }, null, 2)); }
    catch (error) { secondary.push("Receipt: " + String(error)); }
  }
  if (primary) throw primary;
  expect(classifyBodyErrors(seen).fatal).toEqual([]); expect(fx.boundary).toEqual([]); expect(secondary).toEqual([]);
}
