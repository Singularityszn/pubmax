import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { dismissMapIntroductions } from "./helpers/mapIntroDismissal";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";

type PublicPub = { id: string; name: string; lat: number; lng: number; kind?: string };
const pubs = (JSON.parse(readFileSync("public/data/venues_slim.json", "utf8")) as { rows: PublicPub[] }).rows;
const core = new Set((JSON.parse(readFileSync("public/data/venues_slim.core.json", "utf8")) as { rows: PublicPub[] }).rows.map((row) => row.id));
const aliases = (JSON.parse(readFileSync("public/data/venue_id_aliases.json", "utf8")) as { aliases: Record<string, string> }).aliases;
const byId = new Map(pubs.map((row) => [row.id, row]));
const farIds = [
  "venue-xjf3n0", "venue-lrz4u2", "venue-1f5ygjb", "venue-3h52h",
  "venue-hvsgg4", "venue-172mx8n", "venue-6bcaho", "venue-1j5l57r",
  "venue-1w28j94", "venue-12g95oo", "venue-e8zkqn", "venue-19q5z2o", "venue-m5nemu",
];

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block", storageState: { cookies: [], origins: [] } });

function fixture(id: string): PublicPub {
  const row = byId.get(aliases[id] ?? id);
  if (!row || (row.kind && row.kind !== "pub")) throw new Error(`Shipped pub fixture unavailable: ${id}`);
  return row;
}
function href(ids: string[]) {
  return `/map?plan=1&mode=build&pubs=${ids.join(",")}`;
}
function panel(page: Page) {
  return page.locator(".routePanel:visible");
}
async function routeNames(page: Page) {
  return panel(page).locator(".routeList > li > button strong").evaluateAll((elements) => elements.map((element) =>
    Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "").join("").trim(),
  ));
}
async function expectOrderedStops(page: Page, expected: PublicPub[]) {
  await expectSoleDesktopDrawer(page, "planner");
  await expect(panel(page)).toHaveCount(1);
  const names = new Set(expected.map((row) => row.name));
  await expect.poll(async () => (await routeNames(page)).filter((name) => names.has(name)))
    .toEqual(expected.map((row) => row.name));
  for (const [index, pub] of expected.entries()) {
    const row = panel(page).locator(".routeList > li").nth(index);
    await expect.poll(async () => {
      const target = await row.getByRole("link", { name: "Directions", exact: true }).getAttribute("href");
      const destination = target ? new URL(target).searchParams.get("destination") : null;
      return destination?.split(",").map(Number) ?? null;
    }).toEqual([pub.lat, pub.lng]);
  }
}

test("shared arrival bounds missing-stop detail requests to twelve", async ({ page }, info) => {
  test.setTimeout(90_000);
  await installDeterministicMapBasemap(page);
  const pair = ["venue-lukeav", "venue-phqazo"];
  expect((await page.goto(href(pair)))?.status()).toBe(200);
  await dismissMapIntroductions(page);
  await expectOrderedStops(page, pair.map(fixture));
  await expect(panel(page).locator(".routeList > li")).toHaveCount(2);

  expect(farIds).toHaveLength(13);
  expect(new Set(farIds).size).toBe(13);
  for (const id of farIds) {
    expect(core.has(id), `${id} must remain outside opening core`).toBe(false);
    expect(aliases[id], `${id} must be canonical, not another alias`).toBeUndefined();
  }
  const targets = new Set(farIds);
  const requested = new Set<string>();
  const healthy = new Set<string>();
  const detailId = (url: string) => {
    const match = new URL(url).pathname.match(/^\/api\/venue\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  };
  page.on("request", (request) => {
    const id = detailId(request.url());
    if (id && targets.has(id)) requested.add(id);
  });
  page.on("response", (response) => {
    const id = detailId(response.url());
    if (id && targets.has(id) && response.status() === 200) healthy.add(id);
  });
  expect((await page.goto(href(farIds)))?.status()).toBe(200);
  await dismissMapIntroductions(page);
  await expectOrderedStops(page, farIds.slice(0, 12).map(fixture));
  await expect.poll(() => [...requested].every((id) => healthy.has(id))).toBe(true);
  await info.attach("target-detail-observation", {
    contentType: "application/json",
    body: JSON.stringify({ requested: [...requested], healthy: [...healthy], names: await routeNames(page) }),
  });
  // Packs may supply some stops. A zero-request fixture cannot prove this cap.
  expect(requested.size, "Fixture precondition: real missing-stop warming must be exercised").toBeGreaterThan(0);
  expect(requested.size, "Shared arrival must not warm a thirteenth missing detail").toBeLessThanOrEqual(12);
});

test("shipped aliases render canonical ordered pubs after real detail resolves", async ({ page }, info) => {
  test.setTimeout(90_000);
  await installDeterministicMapBasemap(page);
  const ids = ["venue-13yg8pf", "venue-lukeav", "venue-3xz47e"];
  expect(aliases[ids[0]]).toBe("venue-phqazo");
  expect(aliases[ids[2]]).toBe("venue-gvz1hf");
  const replies = [ids[0], ids[2]].map((id) => page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/venue/${id}` && response.status() === 200,
  ));
  expect((await page.goto(href(ids)))?.status()).toBe(200);
  await dismissMapIntroductions(page);
  const resolved = await Promise.all((await Promise.all(replies)).map((response) =>
    response.json() as Promise<{ venue: { id: string; name: string; latitude: number; longitude: number } }>,
  ));
  for (const [index, id] of [ids[0], ids[2]].entries()) {
    const expected = fixture(id);
    expect(resolved[index].venue).toMatchObject({
      id: expected.id, name: expected.name, latitude: expected.lat, longitude: expected.lng,
    });
  }
  await info.attach("shipped-alias-resolution", {
    contentType: "application/json",
    body: JSON.stringify({ requested: ids, resolved: resolved.map(({ venue }) => ({ id: venue.id, name: venue.name, latitude: venue.latitude, longitude: venue.longitude })) }),
  });
  await expectOrderedStops(page, ids.map(fixture));
  await expect(panel(page).locator(".routeList > li")).toHaveCount(3);
  // Ordered rendered identity is the contract; URL alias spelling may remain.
});
