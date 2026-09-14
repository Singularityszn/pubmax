import { expect, test, type Page } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles } from "./helpers/authDoubles";
import { attachSpillBill } from "./helpers/priceBill";

/**
 * The second drinker's door, at 390 (Fable51Fix section 1, 5 Sept 2026).
 *
 * The Hatton Overview prints "Logged once, needs a second drinker" over a lone
 * public £4.50 by handle `tester`. This spec drives the path that line now
 * offers: the "Still £4.50?" action opens the pub's Pint Drop composer with
 * £4.50 already in the price field, a DIFFERENT signed-in drinker logs it, and
 * the Overview flips from logged-once to Confirmed.
 *
 * The Pint Drop write is answered by a boundary double, in the shape the route
 * tests pin (__tests__/pintDrops.test.ts, __tests__/priceSubmitRoute.test.ts):
 * the e2e server runs keyless, so no bearer can verify and no priced drop can
 * earn an authority key there. Independence itself is decided on the server
 * and is pinned at that seam; what this proves is the door, the seed, the
 * post and the re-read that turns the answer into the sheet's standing.
 * Nothing here touches a durable store.
 */
test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  viewport: { width: 390, height: 844 },
});

const VENUE_ID = "venue-1vle947";
const DAY_MS = 24 * 60 * 60 * 1000;
const LOGGED_ONCE_LINE = "Logged once, needs a second drinker";

type DropRow = {
  id: string;
  venueId: string;
  handle: string;
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  era: string;
  provenance: "contributor";
  status: "visible";
  visibility: "public";
  createdAt: string;
  pintPhotoUrl: null;
  venuePhotoUrl: null;
  authorityKey?: string;
  confirmation?: {
    confirmationId: string;
    confirmedAt: string;
    basis: "second_reporter";
    confirmingDropId: string;
  };
};

function firstReport(): DropRow {
  return {
    id: "drop-hatton-tester",
    venueId: VENUE_ID,
    handle: "tester",
    drink: "Lager",
    priceGbp: 4.5,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date(Date.now() - 3 * DAY_MS).toISOString(),
    pintPhotoUrl: null,
    venuePhotoUrl: null,
  };
}

/** The Pint Drop lane as a double: one logged-once row until a second drinker posts. */
async function installPintDropLane(page: Page): Promise<{ posts: URLSearchParams[] }> {
  const rows: DropRow[] = [firstReport()];
  const posts: URLSearchParams[] = [];
  await page.route("**/api/pint-drops**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const url = new URL(request.url());
      const forVenue = url.searchParams.get("venueId");
      const drops = forVenue ? rows.filter((row) => row.venueId === forVenue) : rows;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ drops }),
      });
      return;
    }
    // The composer sends multipart; only the fields matter here.
    const raw = request.postData() ?? "";
    const fields = new URLSearchParams();
    for (const match of raw.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)) {
      fields.set(match[1], match[2]);
    }
    posts.push(fields);
    const priceGbp = Number(fields.get("priceGbp"));
    const drop: DropRow = {
      ...firstReport(),
      id: `drop-second-${posts.length}`,
      handle: ACCOUNTS.B.handle,
      priceGbp,
      createdAt: new Date().toISOString(),
      authorityKey: "key-second",
    };
    const confirmation = {
      confirmationId: "conf-e2e-1",
      confirmedAt: new Date().toISOString(),
      basis: "second_reporter" as const,
      confirmingDropId: drop.id,
    };
    drop.confirmation = confirmation;
    rows[0] = { ...rows[0], confirmation };
    rows.unshift(drop);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        drop,
        confirmation,
        confirmationOutcome: {
          status: "confirmed",
          confirmation,
          dropIds: [rows[1].id, drop.id],
        },
      }),
    });
  });
  return { posts };
}

async function openVenueSheet(page: Page) {
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible({ timeout: 30_000 });
  const inspector = venueSheet.locator(".venueInspector");
  const expand = venueSheet.getByRole("button", { name: "Expand sheet" });
  await expect
    .poll(async () => (await inspector.isVisible()) || (await expand.isVisible()))
    .toBe(true);
  if (!(await inspector.isVisible()) && (await expand.isVisible())) await expand.click();
  await expect(inspector).toBeVisible();
  return venueSheet;
}

// Two page loads of the map plus a sheet, a composer and a re-read: the
// default 30 s is spent on a loaded box before the assertions get their turn.
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

test("a second drinker confirms £4.50 and the Overview flips from logged-once to Confirmed", async ({
  page,
}) => {
  const stub = await installAuthDoubles(page);
  const lane = await installPintDropLane(page);
  await page.goto("/");
  await stub.signedInAs("B");

  await page.goto(`/map?sel=${VENUE_ID}`);
  const sheet = await openVenueSheet(page);

  // The logged-once state, as production prints it, and its one door.
  // The peek chip prints the same line, so the Overview's own is the one asked.
  const loggedOnce = sheet.locator(".communityPriceStanding", { hasText: LOGGED_ONCE_LINE });
  await expect(loggedOnce).toBeVisible({ timeout: 20_000 });
  const door = sheet.getByTestId("confirm-pint-cta");
  await expect(door).toBeVisible();
  await expect(door).toHaveText("Still £4.50?");
  const box = await door.boundingBox();
  expect(box?.height ?? 0, "the door is a thumb target").toBeGreaterThanOrEqual(44);

  // The tap lands on the composer's price step with the figure already in it.
  const priceStep = page.getByTestId("spill-price-step");
  await expect(async () => {
    await door.click();
    await expect(priceStep).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 25_000 });
  const priceInput = priceStep.locator("input").first();
  await expect(priceInput).toHaveValue("4.50");
  await expect(priceInput).toBeInViewport();

  // The kept action, as the second drinker.
  // The door opens the Pint Drop composer, so the bill goes on its own picker.
  await attachSpillBill(page);
  await page.getByRole("button", { name: "Log it" }).click();
  await expect
    .poll(() => lane.posts.length, { timeout: 15_000 })
    .toBe(1);
  expect(lane.posts[0].get("priceGbp")).toBe("4.50");
  expect(lane.posts[0].get("venueId")).toBe(VENUE_ID);

  // The receipt names what the report did.
  await expect(sheet.getByRole("status")).toContainText("Two drinkers now agree on £4.50", {
    timeout: 15_000,
  });

  // Back on the Overview the pub reads Confirmed, and the logged-once line is gone.
  await sheet.getByRole("tab", { name: "Overview" }).click();
  const pill = sheet.locator('[data-standing="confirmed"]');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await expect(pill).toContainText("Confirmed");
  await expect(loggedOnce).toHaveCount(0);
  await expect(sheet.getByTestId("confirm-pint-cta")).toHaveCount(0);
});

test("signed out, the door still reaches the seeded composer and asks for the account at the kept action", async ({
  page,
}) => {
  const stub = await installAuthDoubles(page);
  await installPintDropLane(page);
  await page.goto("/");
  await stub.signedInAs(null);

  await page.goto(`/map?sel=${VENUE_ID}`);
  const sheet = await openVenueSheet(page);
  const door = sheet.getByTestId("confirm-pint-cta");
  await expect(door).toBeVisible({ timeout: 20_000 });

  const priceStep = page.getByTestId("spill-price-step");
  await expect(async () => {
    await door.click();
    await expect(priceStep).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 25_000 });
  await expect(priceStep.locator("input").first()).toHaveValue("4.50");

  // The gate is the sign-in link where Log it would be, and it carries the
  // door back so the account's first kept action lands on this composer.
  const signIn = page.getByRole("link", { name: "Sign in to post" });
  await expect(signIn).toBeVisible();
  const href = await signIn.getAttribute("href");
  expect(href).toContain("/login?mode=signin&from=");
  const from = new URL(href ?? "", "http://localhost").searchParams.get("from") ?? "";
  expect(from).toContain(`sel=${VENUE_ID}`);
  expect(from).toContain("log=1");
  expect(from).toContain("price=4.50");
  await expect(page.getByRole("button", { name: "Log it" })).toHaveCount(0);
});
