import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// Proposed destination: e2e/pal-original-mesh-interaction.spec.ts.
// This checks the real rendered frame with real GLB/WebGL. It calls no live provider.
test("the owned original Robin paints and responds to arrows and Home", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
  await page.clock.install();
  const forbidden: string[] = [];
  const models: Array<{ url: string; sha256: string }> = [];
  const pendingBodies: Promise<void>[] = [];
  const evidenceErrors: string[] = [];
  let failure: unknown;
  // Local fixtures remain authoritative. No external provider or socket may connect.
  await page.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(testInfo.project.use.baseURL!).origin) {
      forbidden.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
  await page.context().routeWebSocket(/.*/, socket => {
    forbidden.push("WebSocket " + new URL(socket.url()).origin);
    socket.close({ code: 1008, reason: "No provider sockets in mesh regression" });
  });
  await page.route(/\/api\/(?:ask|pub-pal\/(?:chat|tool-turn|tools|voice-session|signed-url))(?:[/?]|$)/, async route => {
    forbidden.push(route.request().url());
    await route.abort("blockedbyclient");
  });
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const timestamp = "2026-10-04T12:00:00.000Z";
  await page.route("**/api/pub-pal", route => route.fulfill({ json: {
    adultOnFile: true,
    pal: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
      name: "Mesh regression", adultAttestedAt: timestamp,
      appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "robin" },
      personality: DEFAULT_PAL_DRAFT.personality, voice: DEFAULT_PAL_DRAFT.voice,
      muted: false, hidden: false, proposalPreferences: { memories: true, routes: true },
      masteryPoints: 0, createdAt: timestamp, updatedAt: timestamp,
    },
  } }));
  await page.route("**/api/pub-pal/memories", route => route.fulfill({ json: { memories: [] } }));
  await page.route("**/api/pub-pal/voice-token", route => route.fulfill({ json: { available: false } }));
  try {
    // Observe only requests started by the target Pal document, after fixture seeding.
    const palRequests = new Set<import("@playwright/test").Request>();
    page.on("request", request => {
      if (request.frame() === page.mainFrame()
        && new URL(request.frame().url()).pathname === "/pal"
        && new URL(request.url()).pathname.endsWith("/circuit-robin-c69915c4a4df.glb")) palRequests.add(request);
    });
    page.on("response", response => {
    if (palRequests.has(response.request()) && response.ok()) {
      pendingBodies.push((async () => {
        models.push({ url: response.url(), sha256: createHash("sha256").update(await response.body()).digest("hex") });
      })().catch(error => { evidenceErrors.push("GLB body: " + String(error)); }));
    }
  });
    await page.goto("/pal");
    await expect(page.getByRole("heading", { name: "Mesh regression", exact: true })).toBeVisible();
    const portrait = page.locator(".palHomePortrait");
    const model = portrait.getByRole("img", { name: /Mesh regression in 3D/ });
    // On current Main this assertion fails on actual missing rendered output, not an absent import.
    await expect(model).toBeVisible();
    const canvas = portrait.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(async () => {
      await Promise.all(pendingBodies);
      return models.map(item => item.sha256);
    }).toContain(
      "c69915c4a4df2bd44e52a91d9d4f301182d0d45e612215ad88a726e2ba87f327",
    );
    await model.focus();
    // Freeze the existing pose clock so idle motion cannot imitate a successful key interaction.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    const front = await canvas.screenshot({ path: testInfo.outputPath("robin-front.png") });
    await page.keyboard.press("ArrowRight");
    const right = await canvas.screenshot({ path: testInfo.outputPath("robin-right.png") });
    expect(right.equals(front), "ArrowRight changes the actual rendered Robin").toBe(false);
    await page.keyboard.press("Home");
    const reset = await canvas.screenshot({ path: testInfo.outputPath("robin-home.png") });
    expect(reset.equals(front), "Home restores the original yaw at the same pose time").toBe(true);
    await page.keyboard.press("ArrowLeft");
    expect((await canvas.screenshot()).equals(front), "ArrowLeft also changes the actual rendered Robin").toBe(false);
    await page.keyboard.press("Home");
    expect((await canvas.screenshot()).equals(front)).toBe(true);
    await expect(model).toBeFocused();
    expect(forbidden).toEqual([]);
  } catch (error) {
    failure = error;
  } finally {
    try { await page.clock.resume(); } catch (error) { evidenceErrors.push("Clock resume: " + String(error)); }
    try { await page.screenshot({ path: testInfo.outputPath("actual-frame.png") }); }
    catch (error) { evidenceErrors.push("Screenshot: " + String(error)); }
    await Promise.all(pendingBodies);
    let frame: unknown = null;
    try {
      frame = await page.locator(".palHomePortrait").evaluateAll(nodes => nodes.map(node => ({
        text: node.textContent, canvases: node.querySelectorAll("canvas").length,
        images: Array.from(node.querySelectorAll("img")).map(image => ({ src: image.currentSrc, complete: image.complete })),
      })));
    } catch (error) { evidenceErrors.push("Frame inventory: " + String(error)); }
    try {
      await writeFile(testInfo.outputPath("actual-frame.json"), JSON.stringify({
        models, forbidden, frame, evidenceErrors, primaryFailure: failure ? String(failure) : null,
        scope: "Real rendered original-model frame and keyboard pixels. Controlled auth and owned-Pal reads. No voice/provider/memory acceptance.",
      }, null, 2));
    } catch (error) { evidenceErrors.push("Receipt write: " + String(error)); }
  }
  if (failure) throw failure;
  expect(evidenceErrors).toEqual([]);
  expect(forbidden).toEqual([]);
});
