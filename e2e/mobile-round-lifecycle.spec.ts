import { expect, test } from "@playwright/test";

type RoundState = {
  round: { code: string; title: string };
  members: Array<{ handle: string }>;
  stops: Array<{ venueName: string; addedByHandle: string }>;
};

test("mobile Round lifecycle: join, copy code, add a pub, and host closes", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const host = `codexhost_${suffix}`;
  const mate = `codexmate_${suffix}`;

  const create = await request.post("/api/rounds", {
    data: {
      handle: host,
      title: "Codex mobile Round",
    },
  });
  expect(create.status()).toBe(201);
  const created = (await create.json()) as RoundState;
  const code = created.round.code;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((initialMate) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax_handle", initialMate);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.sessionStorage.setItem("pubmax-e2e-round-code", value);
        },
      },
    });
  }, mate);

  const response = await page.goto(`/rounds/${code}`);
  expect(response?.status()).toBe(200);

  await expect(page.locator(".roundBoard")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Codex mobile Round" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "1 out · still going" })).toBeVisible();

  await page.getByRole("button", { name: `Copy the Round code ${code}` }).click();
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("pubmax-e2e-round-code"))).toBe(code);
  await expect(page.getByRole("status").filter({ hasText: "Code copied." })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Join this Round" })).toBeVisible();
  await page.getByRole("button", { name: "I'm out too — join the Round" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 out · still going" })).toBeVisible();
  await expect(page.getByRole("link", { name: `@${mate}` })).toBeVisible();

  const addSection = page.getByRole("region", { name: "Add a pub to the Round" });
  await expect(addSection).toBeVisible();
  await addSection.getByPlaceholder("Search a pub by name…").fill("Arnos");
  const arnos = addSection.getByRole("button", { name: /Arnos Arms/i }).first();
  await expect(arnos).toBeVisible();
  await expect
    .poll(async () => Math.round((await arnos.boundingBox())?.height ?? 0))
    .toBeGreaterThanOrEqual(44);
  await arnos.click();

  const route = page.getByRole("region", { name: "The Round's route" });
  await expect(route).toBeVisible();
  await expect(route).toContainText("Arnos Arms");
  await expect(route).toContainText(`added by @${mate}`);

  const hostPage = await page.context().newPage();
  await hostPage.setViewportSize({ width: 390, height: 844 });
  await hostPage.addInitScript((hostHandle) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax_handle", hostHandle);
  }, host);

  await hostPage.goto(`/rounds/${code}`);
  await expect(hostPage.locator(".roundBoard")).toBeVisible();
  await hostPage.getByRole("button", { name: "Call the Round (close it)" }).click();
  await expect(hostPage.getByRole("status").filter({ hasText: "This Round has been called — it's closed." })).toBeVisible();
  await hostPage.close();
});
