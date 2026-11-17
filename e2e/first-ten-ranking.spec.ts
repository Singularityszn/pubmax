import { expect, test, type Page, type Route } from "@playwright/test";
import { ACCOUNTS, accessJwt, installAuthDoubles, seedSignedIn, type AccountKey } from "./helpers/authDoubles";

// The quiet first-ten session on the owner's own profile. The ranking and
// venue-search endpoints are answered by an in-spec fixture that keeps one
// ordered list per account, the way the memory store does. Only a server
// acknowledgement moves progress, and no save asks to tell anybody.

type Band = "loved" | "fine" | "not_for_me";
type Row = { venueId: string; band: Band };

const BANDS: Band[] = ["loved", "fine", "not_for_me"];
const LONG_NAME = "The Old Royal Oak and Compasses Free House at the Top of the Long Hill by Hampstead Heath";
const VENUES: Record<string, { name: string; borough: string }> = {
  "w2-crown": { name: "The Crown", borough: "Islington" },
  "w2-lamb": { name: "The Lamb", borough: "Camden" },
  "w2-anchor": { name: "The Anchor", borough: "Southwark" },
  "w2-long": { name: LONG_NAME, borough: "Camden" },
  "w2-swan": { name: "The Swan", borough: "Hackney" },
};

function bandOf(rows: Row[], band: Band): string[] {
  return rows.filter((row) => row.band === band).map((row) => row.venueId);
}

function entries(rows: Row[]) {
  return BANDS.flatMap((band) => bandOf(rows, band).map((venueId) => ({ venueId, band })))
    .map((row, index) => ({
      venueId: row.venueId,
      venueName: VENUES[row.venueId]?.name ?? null,
      band: row.band,
      place: index + 1,
      score: 10 - index / 2,
      listedPrice: null,
    }));
}

/** Places a pub between two adjacent neighbours, or refuses a pair that no longer touches. */
function place(rows: Row[], input: { venueId: string; band: Band; aboveVenueId: string | null; belowVenueId: string | null }): Row[] | null {
  const rest = rows.filter((row) => row.venueId !== input.venueId);
  const inBand = bandOf(rest, input.band);
  const above = input.aboveVenueId === null ? -1 : inBand.indexOf(input.aboveVenueId);
  const below = input.belowVenueId === null ? inBand.length : inBand.indexOf(input.belowVenueId);
  if (above < -1 || (input.aboveVenueId !== null && above === -1) || below === -1 || below !== above + 1) return null;
  const ordered = [...inBand.slice(0, below), input.venueId, ...inBand.slice(below)];
  return [...rest.filter((row) => row.band !== input.band), ...ordered.map((venueId) => ({ venueId, band: input.band }))];
}

type Fixture = {
  rows: Record<AccountKey, Row[]>;
  posts: Array<{ account: AccountKey; body: Record<string, unknown> }>;
  writes: string[];
  /** Answers the next ranking request of this method itself, once. */
  next: Partial<Record<"GET" | "POST", (route: Route, account: AccountKey) => Promise<void>>>;
  refuse: Partial<Record<AccountKey, { status: number; code: string }>>;
};

function accountFor(header: string | undefined): AccountKey | null {
  for (const key of ["A", "B"] as const) {
    if (header === `Bearer pubmaxx-e2e-access-token-${key}` || header === `Bearer ${accessJwt(ACCOUNTS[key])}`) return key;
  }
  return null;
}

async function installRankingFixture(page: Page, fixture: Fixture): Promise<void> {
  await page.route((url) => url.pathname === "/api/social/venues", async (route) => {
    const query = (new URL(route.request().url()).searchParams.get("q") ?? "").toLowerCase();
    const venues = Object.entries(VENUES)
      .filter(([, venue]) => venue.name.toLowerCase().includes(query))
      .map(([id, venue]) => ({ id, ...venue }));
    await route.fulfill({ json: { venues } });
  });
  await page.route((url) => url.pathname === "/api/social/rankings", async (route) => {
    const request = route.request();
    const method = request.method() as "GET" | "POST";
    const account = accountFor(request.headers().authorization);
    if (!account) return route.fulfill({ status: 401, json: { code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." } });
    const refused = fixture.refuse[account];
    if (refused) return route.fulfill({ status: refused.status, json: { code: refused.code, error: "Refused." } });
    if (method === "POST") fixture.posts.push({ account, body: request.postDataJSON() as Record<string, unknown> });
    const override = fixture.next[method];
    if (override) {
      delete fixture.next[method];
      return override(route, account);
    }
    if (method === "GET") return route.fulfill({ json: { entries: entries(fixture.rows[account]) } });
    const placed = place(fixture.rows[account], request.postDataJSON());
    if (!placed) return route.fulfill({ status: 409, json: { code: "STALE_RANKING", error: "Your list changed." } });
    fixture.rows[account] = placed;
    return route.fulfill({ json: { entries: entries(placed) } });
  });
  // Every other write the page makes, so the spec can prove a save stays quiet.
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" && url.pathname.startsWith("/api/") && url.pathname !== "/api/social/rankings" &&
      !url.pathname.startsWith("/api/auth/") && !url.pathname.startsWith("/api/identity/") && !url.pathname.startsWith("/api/telemetry")) {
      fixture.writes.push(`${request.method()} ${url.pathname}`);
    }
  });
}

/** Commits the save on the fixture server, then loses the answer on the wire. */
function commitThenDrop(fixture: Fixture) {
  return async (route: Route, account: AccountKey) => {
    const placed = place(fixture.rows[account], route.request().postDataJSON());
    if (placed) fixture.rows[account] = placed;
    await route.abort("failed");
  };
}

function newFixture(rows: Partial<Record<AccountKey, Row[]>> = {}): Fixture {
  return { rows: { A: rows.A ?? [], B: rows.B ?? [] }, posts: [], writes: [], next: {}, refuse: {} };
}

async function openProfile(page: Page, fixture: Fixture, account: AccountKey = "A"): Promise<void> {
  await installAuthDoubles(page);
  await installRankingFixture(page, fixture);
  await seedSignedIn(page, account);
  await page.goto(`/u/${ACCOUNTS[account].handle}`);
}

function card(page: Page) {
  return page.getByRole("group", { name: "Rank your first ten" });
}

function dialog(page: Page) {
  return page.getByRole("dialog");
}

async function startSession(page: Page): Promise<void> {
  await card(page).getByRole("button", { name: /ranking/ }).click();
  await expect(dialog(page)).toBeVisible();
}

async function pickPub(page: Page, search: string, name: string): Promise<void> {
  await dialog(page).getByLabel("Which pub?").fill(search);
  await dialog(page).getByRole("button", { name: new RegExp(name) }).click();
}

/** Prefers the new pub over each named opponent in turn, waiting for each question. */
async function preferNew(page: Page, name: string, opponents: string[]): Promise<void> {
  for (const opponent of opponents) {
    await expect(dialog(page).getByRole("button", { name: new RegExp(opponent) })).toBeVisible();
    await dialog(page).getByRole("button", { name: new RegExp(`^New ${name}`) }).click();
  }
}

function expectQuiet(fixture: Fixture): void {
  expect(fixture.writes).toEqual([]);
  for (const post of fixture.posts) expect(post.body).not.toHaveProperty("shareToLot");
}

test.describe("first ten ranking", () => {
  test("counts existing rankings, saves quietly, and keeps saved pubs through a reload", async ({ page }) => {
    const fixture = newFixture({ A: [{ venueId: "w2-crown", band: "loved" }, { venueId: "w2-lamb", band: "fine" }] });
    await openProfile(page, fixture);
    await expect(card(page)).toContainText("2 of 10 ranked");
    await startSession(page);
    await pickPub(page, "anch", "The Anchor");
    await dialog(page).getByRole("button", { name: "Loved it" }).click();
    await expect(dialog(page).getByRole("heading", { name: "Which did you prefer?" })).toBeVisible();
    await preferNew(page, "The Anchor", ["The Crown"]);
    await expect(dialog(page).getByRole("heading", { name: "The Anchor is in" })).toBeVisible();
    await expect(dialog(page)).toContainText("3 of 10 ranked");
    await dialog(page).getByRole("button", { name: "Rank another" }).click();
    await pickPub(page, "royal", "The Old Royal Oak");
    await dialog(page).getByRole("button", { name: "Not for me" }).click();
    await expect(dialog(page).getByRole("heading", { name: `${LONG_NAME} is in` })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Done" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(card(page)).toContainText("4 of 10 ranked");
    await expect(page.getByRole("link", { name: "The Anchor" })).toBeVisible();

    // Stopping below ten is a normal end. A reload keeps what the server holds.
    await page.reload();
    await expect(card(page)).toContainText("4 of 10 ranked");
    await expect(page.getByRole("link", { name: LONG_NAME })).toBeVisible();
    expect(fixture.posts).toHaveLength(2);
    expectQuiet(fixture);
  });

  test("a reload mid-question restarts the comparison and saves nothing", async ({ page }) => {
    const fixture = newFixture({ A: [{ venueId: "w2-crown", band: "loved" }] });
    await openProfile(page, fixture);
    await startSession(page);
    await pickPub(page, "lamb", "The Lamb");
    await dialog(page).getByRole("button", { name: "Loved it" }).click();
    await expect(dialog(page).getByRole("heading", { name: "Which did you prefer?" })).toBeVisible();
    await page.reload();
    await expect(card(page)).toContainText("1 of 10 ranked");
    await expect(dialog(page)).toHaveCount(0);
    expect(fixture.posts).toHaveLength(0);
  });

  test("finishing ten says so and the offer leaves", async ({ page }) => {
    const nine = Array.from({ length: 9 }, (_, index) => `w2-extra-${index}`);
    for (const id of nine) VENUES[id] = { name: `Extra ${id}`, borough: "Camden" };
    const fixture = newFixture({ A: nine.map((venueId) => ({ venueId, band: "not_for_me" as const })) });
    await openProfile(page, fixture);
    await expect(card(page)).toContainText("9 of 10 ranked");
    await startSession(page);
    await pickPub(page, "swan", "The Swan");
    await dialog(page).getByRole("button", { name: "Loved it" }).click();
    await expect(dialog(page)).toContainText("Your first ten are in.");
    await dialog(page).getByRole("button", { name: "Done" }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your pubs, ranked" })).toBeFocused();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your pubs, ranked" })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });

  test("a lost save answer is checked against the list before anything else happens", async ({ page }) => {
    const fixture = newFixture({ A: [{ venueId: "w2-crown", band: "loved" }] });
    await openProfile(page, fixture);
    await startSession(page);
    await pickPub(page, "lamb", "The Lamb");
    fixture.next.POST = commitThenDrop(fixture);
    // The reread fails too, as it would with the connection gone.
    fixture.next.GET = (route) => route.abort("internetdisconnected");
    await dialog(page).getByRole("button", { name: "It was fine" }).click();
    await expect(dialog(page).getByRole("heading", { name: "We lost the answer" })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "It was fine" })).toHaveCount(0);
    await expect(card(page)).toContainText("1 of 10 ranked");

    // Back online: the next read answers, and it shows the save landed.
    await dialog(page).getByRole("button", { name: "Check again" }).click();
    await expect(dialog(page).getByRole("heading", { name: "The Lamb is in" })).toBeVisible();
    await expect(dialog(page)).toContainText("2 of 10 ranked");
    expect(fixture.posts).toHaveLength(1);
    expectQuiet(fixture);
  });

  test("a save the server never made is asked again from the fresh list", async ({ page }) => {
    const fixture = newFixture({ A: [{ venueId: "w2-crown", band: "loved" }] });
    await openProfile(page, fixture);
    await startSession(page);
    await pickPub(page, "lamb", "The Lamb");
    fixture.next.POST = (route) => route.abort("failed");
    await dialog(page).getByRole("button", { name: "It was fine" }).click();
    await expect(dialog(page).getByRole("heading", { name: "How was The Lamb?" })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "It was fine" })).toBeVisible();
    await dialog(page).getByRole("button", { name: "It was fine" }).click();
    await expect(dialog(page).getByRole("heading", { name: "The Lamb is in" })).toBeVisible();
    expect(fixture.posts).toHaveLength(2);
  });

  test("closing an unconfirmed save keeps ranking locked until a fresh read succeeds", async ({ page }) => {
    const fixture = newFixture({ A: [{ venueId: "w2-crown", band: "loved" }] });
    await openProfile(page, fixture);
    await startSession(page);
    await pickPub(page, "lamb", "The Lamb");
    fixture.next.POST = commitThenDrop(fixture);
    fixture.next.GET = (route) => route.abort("internetdisconnected");
    await dialog(page).getByRole("button", { name: "It was fine" }).click();
    await expect(dialog(page).getByRole("heading", { name: "We lost the answer" })).toBeVisible();
    fixture.next.GET = (route) => route.abort("internetdisconnected");
    await dialog(page).getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Keep ranking" })).toBeDisabled();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(card(page)).toContainText("2 of 10 ranked");
    await expect(card(page).getByRole("button", { name: "Keep ranking" })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Your pubs, ranked" })).toBeFocused();
    expect(fixture.posts).toHaveLength(1);
  });

  test("closing during a save waits for it before reading the next checkpoint", async ({ page }) => {
    const fixture = newFixture({ A: [{ venueId: "w2-crown", band: "loved" }] });
    let finish!: () => Promise<void>;
    fixture.next.POST = async (route, account) => {
      await new Promise<void>((resolve) => {
        finish = async () => {
          const placed = place(fixture.rows[account], route.request().postDataJSON())!;
          fixture.rows[account] = placed;
          await route.fulfill({ json: { entries: entries(placed) } });
          resolve();
        };
      });
    };
    await openProfile(page, fixture);
    await startSession(page);
    await pickPub(page, "lamb", "The Lamb");
    await dialog(page).getByRole("button", { name: "It was fine" }).click();
    await expect(dialog(page).getByRole("status").filter({ hasText: "Saving your ranking…" })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(card(page).getByRole("button", { name: "Keep ranking" })).toBeDisabled();
    await expect(card(page).getByRole("button", { name: "Keep ranking" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toHaveCount(0);
    await finish();
    await expect(card(page)).toContainText("2 of 10 ranked");
    await expect(card(page).getByRole("button", { name: "Keep ranking" })).toBeEnabled();
    expect(fixture.posts).toHaveLength(1);
  });

  test("a list changed in another tab restarts the questions only after a fresh read", async ({ page, context }) => {
    const fixture = newFixture({ A: [{ venueId: "w2-crown", band: "loved" }, { venueId: "w2-lamb", band: "loved" }] });
    await openProfile(page, fixture);
    await startSession(page);
    await pickPub(page, "anch", "The Anchor");
    await dialog(page).getByRole("button", { name: "Loved it" }).click();
    await expect(dialog(page).getByRole("heading", { name: "Which did you prefer?" })).toBeVisible();

    // A second tab of the same account ranks The Swan into the same band.
    const other = await context.newPage();
    await installAuthDoubles(other);
    await installRankingFixture(other, fixture);
    await other.goto(`/u/${ACCOUNTS.A.handle}`);
    await startSession(other);
    await pickPub(other, "swan", "The Swan");
    await dialog(other).getByRole("button", { name: "Loved it" }).click();
    await preferNew(other, "The Swan", ["The Lamb", "The Crown"]);
    await expect(dialog(other).getByRole("heading", { name: "The Swan is in" })).toBeVisible();
    await other.close();

    // This tab's answer now names a stale pair. The refresh fails first.
    fixture.next.GET = (route) => route.fulfill({ status: 503, json: { code: "RANKING_UNAVAILABLE", error: "Your ranking is unavailable right now." } });
    await preferNew(page, "The Anchor", ["The Lamb", "The Crown"]);
    await expect(dialog(page).getByRole("heading", { name: "Your list changed" })).toBeVisible();
    await expect(dialog(page).getByRole("heading", { name: "Which did you prefer?" })).toHaveCount(0);

    await dialog(page).getByRole("button", { name: "Check again" }).click();
    await expect(dialog(page)).toContainText("Your list changed in another tab.");
    await preferNew(page, "The Anchor", ["The Crown", "The Swan"]);
    await expect(dialog(page).getByRole("heading", { name: "The Anchor is in" })).toBeVisible();
    await expect(dialog(page)).toContainText("4 of 10 ranked");
    expect(fixture.rows.A.map((row) => row.venueId)).toEqual(["w2-anchor", "w2-swan", "w2-crown", "w2-lamb"]);
    expect(fixture.posts.filter((post) => post.body.venueId === "w2-anchor")).toHaveLength(2);
    expectQuiet(fixture);
  });

  test("an account Social refuses sees no offer and no empty list", async ({ page }) => {
    const fixture = newFixture();
    fixture.refuse.A = { status: 403, code: "SOCIAL_ADULT_VERIFICATION_REQUIRED" };
    await openProfile(page, fixture);
    await expect(page.getByRole("heading", { name: "Your pubs, ranked" })).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByText("0 of 10 ranked")).toHaveCount(0);
  });

  test("an unavailable first read is not shown as an empty list", async ({ page }) => {
    const fixture = newFixture();
    fixture.next.GET = (route) => route.fulfill({ status: 503, json: { code: "RANKING_UNAVAILABLE", error: "Unavailable." } });
    await openProfile(page, fixture);
    await expect(page.getByRole("heading", { name: "Your pubs, ranked" })).toBeVisible();
    await expect(page.locator("#passport-ranked").getByText("Your ranking is unavailable right now.")).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(card(page)).toContainText("0 of 10 ranked");
  });

  test("the pub page's Rank it keeps its flow and saves quietly", async ({ page }) => {
    const fixture = newFixture({ A: [{ venueId: "w2-crown", band: "loved" }] });
    await installAuthDoubles(page);
    await installRankingFixture(page, fixture);
    await seedSignedIn(page, "A");
    // A tap before the session is known reads as signed out on this door.
    const identity = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/identity/handle/current" && response.ok());
    await page.goto("/pubs/venue-7qifhm");
    await identity;
    await expect(async () => {
      await page.getByRole("button", { name: "Rank it" }).click();
      await expect(dialog(page)).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await dialog(page).getByRole("button", { name: "Not for me" }).click();
    await expect(dialog(page).getByRole("heading", { name: / is in$/ })).toBeVisible();
    await expect(dialog(page)).not.toContainText("of 10 ranked");
    await dialog(page).getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: "Ranked #2" })).toBeVisible();
    expect(fixture.posts.map((post) => post.body.venueId)).toEqual(["venue-7qifhm"]);
    expectQuiet(fixture);
  });
});

test("a failed retry keeps focus", async ({ page }) => {
  const fixture = newFixture();
  fixture.next.GET = (route) => route.fulfill({ status: 503, json: { code: "RANKING_UNAVAILABLE", retryable: true } });
  await openProfile(page, fixture);
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeVisible();
  fixture.next.GET = (route) => route.fulfill({ status: 503, json: { code: "RANKING_UNAVAILABLE", retryable: true } });
  await retry.click();
  await expect(retry).toBeEnabled();
  await expect(retry).toBeFocused();
});

test("a reread completes ten and restores focus", async ({ page }) => {
  const nine = Array.from({ length: 9 }, (_, index) => `w2-recover-${index}`);
  for (const id of nine) VENUES[id] = { name: `Extra ${id}`, borough: "Camden" };
  const fixture = newFixture({ A: nine.map((venueId) => ({ venueId, band: "not_for_me" as const })) });
  await openProfile(page, fixture);
  await expect(card(page)).toContainText("9 of 10 ranked");
  await startSession(page);
  await pickPub(page, "swan", "The Swan");
  fixture.next.POST = commitThenDrop(fixture);
  fixture.next.GET = (route) => route.abort("internetdisconnected");
  await dialog(page).getByRole("button", { name: "Loved it" }).click();
  await expect(dialog(page).getByRole("heading", { name: "We lost the answer" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your pubs, ranked" })).toBeFocused();
});
