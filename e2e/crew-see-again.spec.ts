import { expect, test, type Page } from "@playwright/test";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

const CREW = "50000000-0000-4000-8000-000000000071";
const HOST = "30000000-0000-4000-8000-000000000071";
const ANA = "30000000-0000-4000-8000-000000000072";
const BEA = "30000000-0000-4000-8000-000000000073";
const path = `/social/crews/${CREW}`;
const api = `**/api/social/crews/${CREW}`;
const candidate = { memberId: BEA, handle: "bea_with_a_rather_long_handle", choice: "none", mutual: false };
const crew = {
  kind: "member", crewId: CREW, title: "Thursday table", visibility: "open", phase: "live", nightArea: "Camden",
  startsAt: "2026-11-17T20:00:00.000Z", authorityRevision: 3,
  viewer: { memberId: ANA, role: "member" }, owner: { memberId: HOST, handle: "karan" },
  members: [
    { memberId: HOST, handle: "karan", role: "owner", joinedAt: "2026-11-10T12:00:00.000Z" },
    { memberId: ANA, handle: "ana", role: "member", joinedAt: "2026-11-11T12:00:00.000Z" },
    { memberId: BEA, handle: candidate.handle, role: "member", joinedAt: "2026-11-12T12:00:00.000Z" },
  ],
  plan: { plan: { id: "60000000-0000-4000-8000-000000000071", title: "Thursday table", startTime: "2026-11-17T20:00:00.000Z",
    createdAt: "2026-11-10T12:00:00.000Z", status: "active" }, stops: [], context: null, actions: [], ending: null },
  openCrawl: null,
};
type Fixture = { open: boolean; closesAt: string; items: typeof candidate[] };
async function open(page: Page) {
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A"); await auth.signedInAs("A");
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  let data: Fixture = { open: true, closesAt: "2099-11-20T08:00:00Z", items: [candidate] };
  let failure = false;
  const writes: unknown[] = [];
  await page.route("**/api/social/access", route => route.fulfill({ json: { state: "verified", viewerHandle: "karan", draftScope: "a".repeat(43) } }));
  await page.route("**/api/profiles/*/lot", route => route.fulfill({ json: { handles: [] } }));
  await page.route(`${api}/attendance`, route => route.fulfill({ status: 404, json: { error: "Unavailable", code: "SOCIAL_CREW_NOT_FOUND" } }));
  await page.route(`${api}/see-again`, async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); writes.push(body);
      data = { ...data, items: [{ ...candidate, choice: body.action === "choose" ? "chosen" : "withdrawn", mutual: false }] };
      return route.fulfill({ json: { ok: true } });
    }
    return failure ? route.fulfill({ status: 503, json: { error: "Unavailable", code: "SOCIAL_CREW_UNAVAILABLE" } }) : route.fulfill({ json: data });
  });
  await page.route(api, route => route.fulfill({ json: crew }));
  // A private fixture must never reach an actual auth provider or external service.
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1", "pubmaxx-e2e.supabase.co"].includes(url.hostname)) return route.fallback();
    return route.abort("blockedbyclient");
  });
  await page.goto(path);
  const section = page.getByRole("region", { name: "See a mate again" });
  await expect(section).toBeVisible();
  return { section, writes, set: (next: Fixture) => { data = next; }, fail: (value: boolean) => { failure = value; } };
}

for (const width of [390, 768, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`private friendship at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await storeThemeChoice(page, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      const fixture = await open(page);
      const choose = fixture.section.getByRole("button", { name: `See @${candidate.handle} again as a mate` });
      await expect(choose).toBeDisabled();
      if (width === 390) await fixture.section.getByRole("checkbox").tap();
      else { await fixture.section.getByRole("checkbox").focus(); await page.keyboard.press("Space"); }
      await choose.click();
      await expect(fixture.section.getByRole("button", { name: `Withdraw choice for @${candidate.handle}` })).toBeVisible();
      expect(fixture.writes).toEqual([{ memberId: BEA, context: "friendship", action: "choose", consent: true }]);
      await expect(fixture.section.getByRole("link", { name: "Continue to Add mate" })).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      await fixture.section.screenshot({ path: info.outputPath(`private-${width}-${theme}.png`) });
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await expect(fixture.section.getByRole("button", { name: `Withdraw choice for @${candidate.handle}` })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await fixture.section.screenshot({ path: info.outputPath(`private-${width}-${theme}-large-text.png`) });
    });
  }
}

test("mutual read, explicit Add mate confirmation, withdrawal and offline recovery", async ({ page }) => {
  const fixture = await open(page);
  fixture.set({ open: true, closesAt: "2099-11-20T08:00:00Z", items: [{ ...candidate, choice: "chosen", mutual: true }] });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await fixture.section.getByRole("button", { name: `Add @${candidate.handle} as a mate` }).click();
  await expect(fixture.section.getByRole("link", { name: "Continue to Add mate" })).toHaveAttribute("href", `/add/${candidate.handle}`);
  expect(fixture.writes).toEqual([]);
  await fixture.section.getByRole("button", { name: "Keep this private" }).click();
  await fixture.section.getByRole("button", { name: `Dismiss reconnection with @${candidate.handle}` }).click();
  await expect(fixture.section.getByRole("button", { name: /Add @/ })).toHaveCount(0);
  fixture.fail(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const retry = page.getByRole("button", { name: "Retry reconnection" });
  await expect(retry).toBeVisible();
  fixture.fail(false);
  await retry.click();
  await expect(fixture.section).toBeVisible();
});

test("the private mutual reaches the existing Add mate confirmation without an automatic follow", async ({ page }) => {
  const fixture = await open(page);
  let follows = 0;
  await page.route(`**/api/profiles/${candidate.handle}**`, route => {
    if (route.request().method() === "POST") {
      follows++;
      return route.fulfill({ json: { following: true, counts: { followers: 1, following: 0 } } });
    }
    return route.fulfill({ json: { viewerFollowing: false, followsViewer: false } });
  });
  fixture.set({ open: true, closesAt: "2099-11-20T08:00:00Z", items: [{ ...candidate, choice: "chosen", mutual: true }] });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await fixture.section.getByRole("button", { name: `Add @${candidate.handle} as a mate` }).click();
  const destination = page.waitForResponse(response => new URL(response.url()).pathname === `/add/${candidate.handle}`);
  await fixture.section.getByRole("link", { name: "Continue to Add mate" }).click();
  await destination;
  await expect(page).toHaveURL(new RegExp(`/add/${candidate.handle}$`));
  const add = page.getByRole("button", { name: `Add @${candidate.handle}`, exact: true });
  await expect(add).toBeVisible();
  expect(follows).toBe(0);
  await add.click();
  await expect(page.locator(".confirmFollow[role=status]")).toBeVisible();
  expect(follows).toBe(1);
});


test("a visible connection remains dismissible after its own choices expire", async ({ page }) => {
  const fixture = await open(page);
  fixture.set({ open: false, closesAt: "2026-11-17T08:00:00Z", items: [{ ...candidate, choice: "none", mutual: true }] });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(fixture.section.getByRole("checkbox")).toHaveCount(0);
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/see-again") && response.request().method() === "POST"),
    fixture.section.getByRole("button", { name: `Dismiss reconnection with @${candidate.handle}` }).click(),
  ]);
  expect(fixture.writes).toEqual([{ memberId: BEA, context: "friendship", action: "withdraw", consent: false }]);
  await expect(fixture.section.getByRole("button", { name: /Add @/ })).toHaveCount(0);
});
