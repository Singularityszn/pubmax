import { expect, test, type Page } from "@playwright/test";

import { describeFirstQuery, describeFirstSubmit } from "../helpers/planDescribeFirst";
import { asReturningVisitor, evidence, watchPageErrors } from "./smokeSession";

// The signed-in half of the production smoke suite: one session for the
// dedicated smoke account, walked through sign in, Pub Pal, a Plan, a saved
// list and sign out. e2e/prod-smoke/README.md says how the account is made.
// Every write here is undone before the run ends, and the account holds no
// one else's data, so nothing a real person owns is ever touched.
const SIGNED_IN = Boolean(process.env.SMOKE_USER_HANDLE && process.env.SMOKE_USER_PASSWORD);
const HANDLE = process.env.SMOKE_USER_HANDLE ?? "";
const PASSWORD = process.env.SMOKE_USER_PASSWORD ?? "";

const SAVE_VENUE = { id: "venue-xjf3n0", name: "Arnos Arms" };
const SAVE_LIST = "Want to Visit";

test.describe.configure({ mode: "serial" });

test.describe("signed-in journeys", () => {
  test.skip(!SIGNED_IN, "Read-only run: SMOKE_USER_HANDLE and SMOKE_USER_PASSWORD are not set.");

  let page: Page;
  let assertNoPageErrors: () => void;
  // What this run created, so afterAll can undo it even when a journey fails.
  const created: { plan?: { id: string; memberToken: string }; saved?: boolean } = {};

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await asReturningVisitor(context);
    page = await context.newPage();
    assertNoPageErrors = watchPageErrors(page);
  });

  test.afterAll(async () => {
    try {
      if (created.plan) await abandonPlan(page, created.plan);
      if (created.saved) await toggleSave(page);
    } finally {
      await page.context().close();
    }
  });

  test("signs in with the smoke account", async () => {
    await page.goto("/login");
    await page.getByTestId("e2e-login-toggle").click();
    await page.getByTestId("e2e-login-handle").fill(HANDLE);
    await page.getByTestId("e2e-login-password").fill(PASSWORD);
    await page.getByTestId("e2e-login-submit").click();
    await expect(page.getByRole("heading", { name: "You are signed in" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Signed-in account" })).toBeVisible();
    await evidence(page, "signed-in");
  });

  test("Pub Pal answers a text request with a plan and venue cards", async () => {
    await page.goto("/pal/chat");
    const input = page.getByRole("textbox", { name: "Describe the outing" });
    const ask = page.getByRole("button", { name: "Ask" });
    // The composer is painted on the server. Retry the tap until React owns it
    // (e2e/AGENTS.md: a lone click is not a wait for hydration).
    await expect(async () => {
      await input.fill("A pub crawl in Soho for three, not pricey");
      await ask.click({ timeout: 2_000 });
      await expect(input).toHaveValue("", { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    const reply = page.locator(".palChatRow--pal").last();
    await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, { timeout: 90_000 });
    await expect(page.locator(".palChatBubble--error")).toHaveCount(0);
    await expect(reply.locator(".palChatBubble")).not.toBeEmpty();
    await expect(reply.locator(".palChatCard").first()).toBeVisible();
    await expect(
      reply.getByRole("list", { name: "Suggested actions" }).getByRole("link", { name: "Open in Plan" }),
    ).toBeVisible();
    await evidence(page, "pub-pal");
  });

  test("creates a Plan and locks it in", async () => {
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/api/plans",
      { timeout: 60_000 },
    );
    await page.goto("/plan");
    await expect(describeFirstQuery(page)).toBeEditable();
    await expect(async () => {
      await describeFirstQuery(page).fill("Quiet in Clapham for 4, not pricey");
      await describeFirstSubmit(page).click({ timeout: 2_000 });
      await expect(
        page.getByText("3 stops we can stand behind, shaped by the outing you set below."),
      ).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByLabel("Your name").fill("Smoke test");
    await page.getByRole("button", { name: "Lock it in" }).click();
    const response = await createdResponse;
    expect(response.status()).toBe(201);
    const body = (await response.json()) as { plan: { plan: { id: string } }; memberToken: string };
    created.plan = { id: body.plan.plan.id, memberToken: body.memberToken };
    await expect(page).toHaveURL(new RegExp(`/plan/${created.plan.id}(?:#share)?$`));
    await expect(page.getByRole("heading", { name: /Who.s in/ })).toBeVisible();
    await expect(page.getByText("Smoke test", { exact: true }).first()).toBeVisible();
    await evidence(page, "plan-locked");
  });

  test("a saved list is visible to its owner", async () => {
    // A run that died before its cleanup leaves the save behind, and the
    // control toggles, so start from an empty list rather than unsaving it.
    if (await savedRow(page).count()) await toggleSave(page);
    await toggleSave(page);
    created.saved = true;
    await expect(savedRow(page)).toBeVisible();
    await evidence(page, "saved-list");
    await toggleSave(page);
    created.saved = false;
    await expect(savedRow(page)).toHaveCount(0);
  });

  test("signs out", async () => {
    // The Plan is abandoned while the session still holds its capability.
    if (created.plan) {
      await abandonPlan(page, created.plan);
      created.plan = undefined;
    }
    await page.goto("/map");
    await page.getByRole("button", { name: /Account options/ }).first().click();
    await page.locator(".authAccountMenu").getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign in", exact: true }).first()).toBeVisible();
    await page.goto("/login");
    await expect(page.getByTestId("e2e-login-toggle")).toBeVisible();
    await evidence(page, "signed-out");
    assertNoPageErrors();
  });

  /** The owner's saved row for the smoke venue, read from their own profile. */
  function savedRow(target: Page) {
    return target
      .locator("#saved-pubs .savedList")
      .filter({ has: target.locator(".savedListName", { hasText: SAVE_LIST }) })
      .locator(".savedItem", { hasText: SAVE_VENUE.name });
  }

  /** Tap the list chip once from the venue sheet, then reload the profile. */
  async function toggleSave(target: Page) {
    await target.goto(`/map?sel=${SAVE_VENUE.id}`);
    const sheet = target.getByRole("dialog", { name: "Pub detail" });
    await expect(sheet.getByRole("heading", { name: SAVE_VENUE.name })).toBeInViewport();
    await sheet.getByRole("button", { name: `Save ${SAVE_VENUE.name} to a list` }).click();
    const saved = target.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/saved-pubs",
    );
    await sheet
      .getByRole("region", { name: "Save this venue to a list" })
      .getByRole("button", { name: SAVE_LIST, exact: true })
      .click();
    expect((await saved).ok()).toBe(true);
    await target.goto(`/u/${HANDLE}#saved-pubs`);
    await expect(target.locator("#saved-pubs")).toBeVisible();
  }
});

/** Plans have no delete: abandoning is the end state a host can choose. */
async function abandonPlan(page: Page, plan: { id: string; memberToken: string }) {
  const status = await page.evaluate(async ({ id, memberToken }) => {
    const response = await fetch(`/api/plans/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "abandoned", memberToken }),
    });
    return response.status;
  }, plan);
  expect(status, `abandon Plan ${plan.id}`).toBe(200);
}
