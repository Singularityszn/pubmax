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
  const events: Array<Record<string, unknown>> = [], models: Array<{ url: string; sha256: string }> = [], errors: string[] = [];
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
      models.push({ url: response.url(), sha256: createHash("sha256").update(await response.body()).digest("hex") });
    })().catch(error => { errors.push(`Request ${id}: ${String(error)}`); }));
  });
  return { requests, models, events, errors, settle: () => Promise.all(bodies) };
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
export async function evidence(page: Page, info: TestInfo, seen: Capture, fx: Awaited<ReturnType<typeof fixture>>, run: () => Promise<void>) {
  let primary: unknown;
  const secondary: string[] = [];
  try { await run(); } catch (error) { primary = error; }
  finally {
    fx.releaseB();
    try { await page.clock.resume(); } catch (error) { secondary.push("Clock: " + String(error)); }
    try { await page.screenshot({ path: info.outputPath("actual-frame.png") }); } catch (error) { secondary.push("Screenshot: " + String(error)); }
    await seen.settle();
    let frame: unknown;
    try { frame = await portrait(page).evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, canvases: n.querySelectorAll("canvas").length, states: Array.from(n.querySelectorAll("[data-pal-model-host]")).map(h => ({ state: (h as HTMLElement).dataset.modelState, name: h.getAttribute("aria-label"), hidden: h.getAttribute("aria-hidden") })) }))); }
    catch (error) { secondary.push("Frame: " + String(error)); }
    try { await writeFile(info.outputPath("evidence.json"), JSON.stringify({ events: seen.events, models: seen.models, bodyErrors: seen.errors, boundary: fx.boundary, ownerReads: fx.ownerReads, frame, primaryFailure: primary ? String(primary) : null, secondary, rendering: "Real WebGL through SwiftShader software rendering. No hardware-GPU or physical-device acceptance." }, null, 2)); }
    catch (error) { secondary.push("Receipt: " + String(error)); }
  }
  if (primary) throw primary;
  expect(seen.errors).toEqual([]); expect(fx.boundary).toEqual([]); expect(secondary).toEqual([]);
}
