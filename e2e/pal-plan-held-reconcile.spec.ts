import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { pinLondonEvening } from "./helpers/planFirstPint";

// F31 acceptance oracle: an accepted first pub outranks a draft. A failed
// crawl must retain that pub and explain scarcity. One or two requested
// stops are complete routes, rather than reasons to discard the draft.
// Seed only the public persisted handoff contracts. The page, generator,
// venue data, grounding proof and rendered result all run without mocks.
const PUBS = [
  { id: "venue-ywzy0i", name: "The Pheonix" },
  { id: "venue-l5qye7", name: "The Bread & Roses" },
  { id: "venue-e7wfn7", name: "The Coach & Horses" },
];
const OTHER = { id: "venue-1fz0jhj", name: "The London and South Western" };
const HELD_LINE = "Your chosen first pub stays first. The draft does not replace your choice.";
type Options = { query: string; origin?: "pal" | "map"; held?: string };
type GenerationRequest = {
  anchor?: { venueId: string; venueIds?: string[]; source: string; startsAt: string | null };
  intake?: { stopCount?: number };
};

async function openHandoff(page: Page, options: Options) {
  const evening = await pinLondonEvening(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pal/chat");
  const startsAt = new Date(evening.getTime() + 60 * 60 * 1000).toISOString();
  await page.evaluate(({ options, pubs, startsAt }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    const now = Date.now();
    sessionStorage.setItem("pubmax:ask-plan-draft:v1", JSON.stringify({
      query: options.query,
      stopIds: pubs.map((pub) => pub.id),
      stopNames: pubs.map((pub) => pub.name),
      origin: options.origin ?? "pal",
      createdAt: new Date(now).toISOString(),
    }));
    if (options.held) sessionStorage.setItem("pubmax:planning-intent:v1", JSON.stringify({
      version: 1, source: "near", cityId: "london",
      acceptedVenueId: options.held,
      acceptedArea: { kind: "night-patch", id: "clapham" },
      startsAt,
      displayEvidence: { kind: "directory", observedAt: null },
      acceptedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    }));
  }, { options, pubs: PUBS, startsAt });
  const requests: GenerationRequest[] = [];
  const responses: Promise<unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plans/generate") {
      requests.push(request.postDataJSON());
    }
  });
  page.on("response", (response) => {
    if (response.request().method() === "POST" && new URL(response.url()).pathname === "/api/plans/generate") {
      responses.push(response.json().then((body) => ({
        status: response.status(), outcome: body.outcome, reason: body.reason,
        stops: body.stops, inferredContext: body.inferredContext, error: body.error,
      })));
    }
  });
  await page.goto(`/plan?query=${encodeURIComponent(options.query)}`);
  return { requests, responses, startsAt };
}

async function evidence(page: Page, info: TestInfo, run: Awaited<ReturnType<typeof openHandoff>>) {
  const status = await page.locator("#plan-route-status").innerText();
  await writeFile(info.outputPath("generation.json"), JSON.stringify({
    requests: run.requests, responses: await Promise.all(run.responses), status,
    persisted: await page.evaluate(() => JSON.parse(localStorage.getItem("pubmaxx:plan-route-draft:v1") ?? "null")),
  }, null, 2));
  await page.screenshot({ path: info.outputPath("plan.png"), fullPage: true });
}

test.use({ serviceWorkers: "block", screenshot: "only-on-failure" });
test.setTimeout(90_000);

test("a conflicting Pal draft cannot replace the accepted first pub", async ({ page }, info) => {
  const run = await openHandoff(page, { query: "3 pubs in Clapham for 4", held: OTHER.id });
  await expect(page.locator("#plan-route-status")).toContainText(HELD_LINE, { timeout: 45_000 });
  await expect(page.locator(".planStop__surface").first()).toContainText(OTHER.name);
  expect(run.requests).toHaveLength(1);
  expect(run.requests[0]?.anchor?.venueId).toBe(OTHER.id);
  expect(run.requests[0]?.anchor?.venueIds).toBeUndefined();
  await evidence(page, info, run);
});

test("a matching draft keeps the accepted pub, area and time", async ({ page }, info) => {
  const run = await openHandoff(page, { query: "3 pubs in Clapham for 4", held: PUBS[0]!.id });
  await expect(page.locator("#plan-route-status")).toContainText("Kept your Pub Pal's pubs:", { timeout: 45_000 });
  await expect(page.locator(".planStop__surface")).toHaveCount(3);
  for (const [index, pub] of PUBS.entries()) await expect(page.locator(".planStop__surface").nth(index)).toContainText(pub.name);
  expect(run.requests).toHaveLength(1);
  expect(run.requests[0]?.anchor).toMatchObject({
    venueId: PUBS[0]!.id, source: "near", acceptedArea: { kind: "night-patch", id: "clapham" }, startsAt: run.startsAt,
    venueIds: PUBS.map((pub) => pub.id),
  });
  await evidence(page, info, run);
});

for (const origin of ["pal", "map"] as const) {
  for (const count of [3, 6]) {
    test(`${origin} draft keeps the accepted pub and scarcity after a refused ${count}-stop crawl`, async ({ page }, info) => {
      const run = await openHandoff(page, {
        query: `${count} pubs in Clapham for 4 with step-free access and accessible toilets, under £5 total`,
        origin, held: PUBS[0]!.id,
      });
      const status = page.locator("#plan-route-status");
      await expect(status).toContainText(HELD_LINE, { timeout: 45_000 });
      await expect(status).toContainText("We could not build");
      await expect(status).not.toContainText("Plan built");
      await expect(page.locator("#plan-concierge-status")).toContainText("We could not build");
      await expect(page.locator("#plan-concierge-status")).not.toContainText("Plan built");
      await expect(page.locator(".planStop__surface")).toHaveCount(1);
      await expect(page.locator(".planStop__surface")).toContainText(PUBS[0]!.name);
      expect(run.requests).toHaveLength(count === 3 ? 3 : 2);
      for (const request of run.requests) {
        expect(request.anchor).toMatchObject({ venueId: PUBS[0]!.id, source: "near", startsAt: run.startsAt });
      }
      const results = await Promise.all(run.responses) as { outcome?: string }[];
      expect(results.at(-1)?.outcome).toBe("anchor-only");
      await evidence(page, info, run);
    });
  }
}

for (const count of [1, 2]) {
  test(`a requested ${count}-stop outing keeps the draft's first pub without a fallback`, async ({ page }, info) => {
    const run = await openHandoff(page, { query: `${count} pub ${count === 1 ? "meetup" : "crawl"} in Clapham for 4` });
    await expect(page.locator("#plan-route-status")).toContainText(`Plan kept ${PUBS[0]!.name}`, { timeout: 45_000 });
    await expect(page.locator(".planStop__surface")).toHaveCount(count);
    await expect(page.locator(".planStop__surface").first()).toContainText(PUBS[0]!.name);
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0]?.intake?.stopCount).toBe(count);
    const results = await Promise.all(run.responses) as { outcome?: string }[];
    expect(results[0]?.outcome).toBe("route");
    await evidence(page, info, run);
  });
}
