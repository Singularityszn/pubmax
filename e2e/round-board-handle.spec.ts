import { expect, test } from "@playwright/test";

// "Up now" on the Round board broke "@qa_scout" across two lines at 390px
// (the handle's last letter alone on the second). The handle is one unit: it
// stays on a single line, and one too long for the cell ends in an ellipsis.

type RoundState = { round: { code: string } };

async function openBoard(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  handle: string,
): Promise<void> {
  const create = await request.post("/api/rounds", {
    data: { handle, title: "Handle fit" },
  });
  expect(create.status()).toBe(201);
  const { round } = (await create.json()) as RoundState;
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto(`/rounds/${round.code}`);
  await expect(page.locator(".roundMoneyGlance")).toBeVisible();
}

function lineCount(page: import("@playwright/test").Page): Promise<number> {
  return page.locator(".roundMoneyTurn strong").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
}

for (const width of [390, 1440]) {
  test(`the up-now handle stays on one line at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await openBoard(page, request, "qa_scout");
    await expect(page.locator(".roundMoneyTurn strong")).toHaveText("@qa_scout");
    expect(await lineCount(page)).toBe(1);
  });

  test(`a long up-now handle truncates instead of stacking at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const handle = "a_very_long_handle_for_qa_9";
    await openBoard(page, request, handle);
    const strong = page.locator(".roundMoneyTurn strong");
    await expect(strong).toHaveAttribute("title", `@${handle}`);
    expect(await lineCount(page)).toBe(1);
    const fits = await strong.evaluate((el) => el.getBoundingClientRect().height < 40);
    expect(fits).toBe(true);
  });
}
