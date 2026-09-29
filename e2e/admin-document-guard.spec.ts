import { expect, test } from "@playwright/test";

const ADMIN_TOKEN = process.env.PW_E2E_ADMIN_TOKEN ?? "pubmax-e2e-admin-token";

test("anonymous GET /admin is a 401, and the moderator console never paints", async ({
  page,
  request,
}) => {
  // The credential answer itself: a refusal status, and no redirect to the
  // drinker door. Next serves the unauthorized boundary as a 401 document
  // whose body hydrates the token form, so the status is asserted over HTTP
  // and the surface is asserted in the browser below.
  const res = await request.get("/admin", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(res.headers()["location"]).toBeUndefined();

  const navigation = await page.goto("/admin");
  expect(navigation?.status()).toBe(401);
  await expect(
    page.getByRole("heading", { name: "Moderator sign-in", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Admin token")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open console" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Admin sections" })).toHaveCount(
    0,
  );
});

test("a moderator session cookie opens /admin", async ({
  baseURL,
  page,
  request,
}) => {
  const login = await request.post("/api/admin/session", {
    data: { token: ADMIN_TOKEN },
  });
  expect(login.ok()).toBeTruthy();
  // The cookie is Secure under `next start` while the baseURL is http, so the
  // request context's jar may drop it. Replay it by hand: the point is the
  // cookie lane, not Playwright's storage rules.
  const setCookie = login
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair))
    .join("; ");
  expect(setCookie).toContain("pubmax_admin_session=");
  const res = await request.get("/admin", { headers: { cookie: setCookie } });
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("admin-tabs");
  expect(body).not.toContain("Moderator sign-in");

  const [name, value] = setCookie.split("=");
  await page.context().addCookies([
    {
      name: name ?? "pubmax_admin_session",
      value: value ?? "",
      url: baseURL ?? "http://localhost:3100",
    },
  ]);
  const navigation = await page.goto("/admin");
  expect(navigation?.status()).toBe(200);
  await expect(
    page.getByRole("tablist", { name: "Admin sections" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Moderator sign-in" }),
  ).toHaveCount(0);
});

test("token entry reloads /admin through the document guard", async ({ page }) => {
  const firstDocument = await page.goto("/admin");
  expect(firstDocument?.status()).toBe(401);
  await page.getByLabel("Admin token").fill(ADMIN_TOKEN);

  const [nextDocument] = await Promise.all([
    page.waitForNavigation(),
    page.getByRole("button", { name: "Open console" }).click(),
  ]);

  expect(nextDocument?.status()).toBe(200);
  await expect(page.getByRole("tablist", { name: "Admin sections" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Moderator sign-in" })).toHaveCount(0);
});

test("reported and hidden Pint Drop cards keep their evidence and distinct decisions", async ({
  page,
}) => {
  const baseDrop = {
    venueId: "venue-xjf3n0",
    handle: "Queue tester",
    drink: "pint",
    priceGbp: 5.5,
    passedDownNote: "Menu price checked",
    era: "tonight",
    pintPhotoUrl: null,
    venuePhotoUrl: null,
    reportReason: "Wrong price",
    reportCount: 2,
    reportedAt: "2026-09-28T18:00:00.000Z",
  };
  const decisions: unknown[] = [];
  await page.route("**/api/pint-drops**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      decisions.push(request.postDataJSON());
      await route.fulfill({ json: { ok: true } });
      return;
    }
    const status = new URL(request.url()).searchParams.get("status");
    const drop =
      status === "reported"
        ? { ...baseDrop, id: "reported-drop", status: "reported" }
        : { ...baseDrop, id: "hidden-drop", status: "hidden" };
    await route.fulfill({ json: { drops: [drop] } });
  });

  await page.goto("/admin");
  await page.getByLabel("Admin token").fill(ADMIN_TOKEN);
  await page.getByRole("button", { name: "Open console" }).click();
  await expect(
    page.getByRole("tablist", { name: "Admin sections" }),
  ).toBeVisible();
  await expect(async () => {
    await page.getByRole("button", { name: "Load reported drops" }).click();
    await expect(
      page.getByRole("heading", { name: "Reported Pint Drops" }),
    ).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  const reported = page
    .getByRole("heading", { name: "Reported Pint Drops" })
    .locator("xpath=following-sibling::div[1]");
  const hidden = page
    .getByRole("heading", { name: "Hidden Pint Drops" })
    .locator("xpath=following-sibling::div[1]");
  for (const queue of [reported, hidden]) {
    await expect(queue).toContainText("Arnos Arms");
    await expect(queue).toContainText("Menu price checked");
    await expect(queue).toContainText("Reason: Wrong price");
    await expect(queue).toContainText("Verified reports: 2");
    await expect(queue).toContainText("Report evidence received");
  }
  await expect(
    reported.getByRole("button", { name: "Keep visible" }),
  ).toBeVisible();
  await expect(
    reported.getByRole("button", { name: "Hide", exact: true }),
  ).toBeVisible();
  await expect(hidden.getByRole("button", { name: "Restore" })).toBeVisible();
  await expect(
    hidden.getByRole("button", { name: "Keep hidden" }),
  ).toBeVisible();

  await reported.getByRole("button", { name: "Hide", exact: true }).click();
  await hidden.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.getByRole("heading", { name: "Reported Pint Drops" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Hidden Pint Drops" }),
  ).toHaveCount(0);
  expect(decisions).toEqual([
    { action: "keep_hidden", id: "reported-drop" },
    { action: "restore", id: "hidden-drop" },
  ]);
});
