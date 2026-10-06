import { expect, test, type Page } from "@playwright/test";

import { describeFirstQuery, describeFirstSubmit } from "../helpers/planDescribeFirst";
import { untilNoFirewallDeny, untilNot429 } from "./firewall";
import { asReturningVisitor, evidence, watchFirewall, watchPageErrors } from "./smokeSession";

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
  let firewall: ReturnType<typeof watchFirewall>;
  // What this run created, so afterAll can undo it even when a journey fails.
  const created: { plan?: { id: string; memberToken: string }; saved?: boolean } = {};

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await asReturningVisitor(context);
    firewall = watchFirewall(context);
    page = await context.newPage();
    assertNoPageErrors = watchPageErrors(page);
  });

  test.afterAll(async () => {
    // Each undo runs on its own, so one that fails still leaves the other to run.
    const failures: unknown[] = [];
    const undos = [
      async () => {
        if (created.plan) await abandonPlan(page, created.plan);
      },
      async () => {
        if (created.saved && (await hasSave(page))) await toggleSave(page);
      },
    ];
    for (const undo of undos) {
      try {
        await undo();
      } catch (error) {
        failures.push(error);
      }
    }
    await page.context().close();
    if (failures.length) throw failures[0];
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

  test("Pub Pal answers a message typed on its home page", async () => {
    // The welcome paints before the account's Pal is read, so only the read's
    // answer says whether this account has a Pal yet.
    const [palRead] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "GET" && new URL(response.url()).pathname === "/api/pub-pal",
      ),
      page.goto("/pal"),
    ]);
    expect(palRead.ok(), "read the account's Pal").toBe(true);
    const { pal } = (await palRead.json()) as { pal: unknown };
    // A new account meets the five-step setup first. That is the journey a new
    // user takes, so the smoke account walks it on its first run and keeps the
    // Pal it made for every run after.
    if (!pal) await createPal(page);
    const message = page.getByRole("textbox", { name: "Message your Pub Pal" });
    // With no live voice session, the box hands the message to the written Pal.
    await message.fill("Two quiet pubs near Borough Market");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page).toHaveURL(/\/pal\/chat\?ask=/);
    await expect(page.locator(".palChatRow--user").last()).toHaveText("Two quiet pubs near Borough Market");
    const reply = page.locator(".palChatRow--pal").last();
    await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, { timeout: 90_000 });
    await expect(page.locator(".palChatBubble--error")).toHaveCount(0);
    await expect(reply.locator(".palChatBubble")).not.toBeEmpty();
    await evidence(page, "pub-pal-home");
  });

  test("creates a Plan and locks it in", async () => {
    await page.goto("/plan");
    await expect(describeFirstQuery(page)).toBeEditable();
    // Retry the tap only until it sends the request: once it lands, "Sort it"
    // gives way to the route, so a slow answer must be waited for, not re-tapped.
    await expect(async () => {
      await describeFirstQuery(page).fill("Quiet in Clapham for 4, not pricey");
      await Promise.all([
        page.waitForRequest(
          (request) =>
            request.method() === "POST" && new URL(request.url()).pathname === "/api/plans/generate",
          { timeout: 2_000 },
        ),
        describeFirstSubmit(page).click({ timeout: 2_000 }),
      ]);
    }).toPass({ timeout: 60_000 });
    await expect(
      page.getByText("3 stops we can stand behind, shaped by the outing you set below."),
    ).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Your name").fill("Smoke test");
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" && new URL(response.url()).pathname === "/api/plans",
        { timeout: 60_000 },
      ),
      page.getByRole("button", { name: "Lock it in" }).click(),
    ]);
    expect(response.status()).toBe(201);
    const body = (await response.json()) as { plan: { plan: { id: string } }; memberToken: string };
    created.plan = { id: body.plan.plan.id, memberToken: body.memberToken };
    await expect(page).toHaveURL(new RegExp(`/plan/${created.plan.id}(?:#share)?$`));
    await expect(page.getByRole("heading", { name: /Who.s in/ })).toBeVisible();
    await expect(page.getByText("Smoke test", { exact: true }).first()).toBeVisible();
    await evidence(page, "plan-locked");
  });

  test("saves a venue to a list", async () => {
    // A run that died before its cleanup leaves the save behind, and the
    // control toggles, so remove that save before this run saves again.
    if (await hasSave(page)) await toggleSave(page);
    created.saved = true;
    await toggleSave(page);
    // POST /api/saved-pubs answers 200 even when the write fails, so read the
    // list back to prove the save landed.
    expect(await hasSave(page), "the save is on the list").toBe(true);
    await page.goto(`/u/${HANDLE}/lists/${encodeURIComponent(SAVE_LIST)}`);
    await expect(page.locator(".listDetailItem", { hasText: SAVE_VENUE.name })).toBeVisible();
    await evidence(page, "saved-list");
  });

  test("the owner's profile shows their save", async () => {
    // This suite found the owner's own /u/<handle> showing "No saved venues
    // yet." after a full load, on 5 Oct 2026 (fixed in #2004). The test before
    // proves the save landed, so this one holds the profile to showing it.
    await page.goto(`/u/${HANDLE}#saved-pubs`);
    await expect(savedRow(page)).toBeVisible();
  });

  test("removes the save", async () => {
    // Undo here, while the session is still signed in: afterAll runs after
    // sign-out, when the save control can no longer write.
    await toggleSave(page);
    expect(await hasSave(page), "the save is removed").toBe(false);
    created.saved = false;
  });

  test("signs out", async () => {
    // The Plan is abandoned while the session still holds its capability.
    if (created.plan) {
      await abandonPlan(page, created.plan);
      created.plan = undefined;
    }
    // Sign out from the account card on /login. A return to /map reopens the
    // venue sheet the save journeys left open, and an open sheet makes the
    // site nav inert, so its account menu cannot be reached from there.
    await page.goto("/login");
    const account = page.getByRole("region", { name: "Signed-in account" });
    await account.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(account).toBeHidden();
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

  /**
   * Whether the smoke venue is on the owner's list, read from the same API
   * the profile loads, so the answer never depends on a half-loaded page.
   */
  async function hasSave(target: Page): Promise<boolean> {
    const response = await untilNot429(
      () => target.request.get(`/api/saved-pubs?handle=${encodeURIComponent(HANDLE)}`),
      (answer) => ({ status: answer.status(), headers: answer.headers(), url: answer.url() }),
    );
    expect(response.ok(), "read the saved list").toBe(true);
    const body = (await response.json()) as { saved: { venueId: string; listType: string }[] };
    return body.saved.some((row) => row.venueId === SAVE_VENUE.id && row.listType === SAVE_LIST);
  }

  /**
   * Tap the list chip once from the venue sheet. The tap is repeated whole when
   * the edge firewall denied a response during it: a deny never reached the app,
   * so the save did not happen, and a second tap is the first one done properly.
   */
  function toggleSave(target: Page) {
    return untilNoFirewallDeny(() => tapSaveChip(target), firewall.denies, undefined, undefined, "the save journey");
  }

  async function tapSaveChip(target: Page) {
    await target.goto(`/map?sel=${SAVE_VENUE.id}`);
    const sheet = target.getByRole("dialog", { name: "Pub detail" });
    await expect(sheet.getByRole("heading", { name: SAVE_VENUE.name })).toBeInViewport();
    await sheet.getByRole("button", { name: `Save ${SAVE_VENUE.name} to a list` }).click();
    const [saved] = await Promise.all([
      target.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/saved-pubs",
      ),
      sheet
        .getByRole("region", { name: "Save this venue to a list" })
        .getByRole("button", { name: SAVE_LIST, exact: true })
        .click(),
    ]);
    expect(saved.ok()).toBe(true);
  }
});

/**
 * The five-step Pub Pal setup a new account meets on /pal, with the defaults a
 * person who only wants to get going would keep. It ends on the Pal's home,
 * where the message box lives.
 */
async function createPal(page: Page) {
  await page.getByRole("button", { name: "Meet your Pub Pal" }).click();
  await page.getByRole("checkbox", { name: /I confirm I.m 18 or over/ }).check();
  const next = page.getByRole("button", { name: "Continue" });
  await next.click();
  await page.getByRole("textbox", { name: "Name" }).fill("Smoke");
  // Signal, chemistry and privacy keep their defaults.
  for (let step = 0; step < 3; step += 1) await next.click();
  await page.getByRole("button", { name: "Create my Pal" }).click();
  await expect(page.getByRole("textbox", { name: "Message your Pub Pal" })).toBeVisible();
}

/** Plans have no delete: abandoning is the end state a host can choose. */
async function abandonPlan(page: Page, plan: { id: string; memberToken: string }) {
  const answer = await untilNot429(
    () =>
      page.evaluate(async ({ id, memberToken }) => {
        const response = await fetch(`/api/plans/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "abandoned", memberToken }),
        });
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          url: response.url,
        };
      }, plan),
    (value) => value,
  );
  expect(answer.status, `abandon Plan ${plan.id}`).toBe(200);
}
