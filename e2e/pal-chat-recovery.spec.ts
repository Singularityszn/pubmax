import { expect, test } from "@playwright/test";

test("retrying a failed question preserves a separate unsent draft", async ({ page }) => {
  const failedQuestion = "Hello. Can you help me plan a quiet night in Soho for two?";
  const nextDraft = "Show me alcohol-free choices near Bank.";
  const requests: string[] = [];
  let releaseRetry: () => void = () => {};
  const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
  await page.route("**/api/pub-pal/chat", async (route) => {
    requests.push((route.request().postDataJSON() as { query: string }).query);
    if (requests.length === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson; charset=utf-8",
        body: `${JSON.stringify({ type: "error", error: "Couldn't answer that. Try again." })}\n`,
      });
      return;
    }
    await retryGate;
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({
        type: "final",
        body: { answer: "Tell me your budget for the night.", cards: [], proposals: [], sources: [], status: "empty", toolsUsed: [] },
      })}\n`,
    });
  });
  await page.goto("/pal/chat");
  await expect(page.getByText("Hi. What kind of night are you planning?", { exact: true })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Describe the outing", exact: true });
  await composer.fill(failedQuestion);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const retry = page.getByRole("button", { name: `Ask again: ${failedQuestion}`, exact: true });
  await expect(retry).toBeVisible();
  await composer.fill(nextDraft);
  await retry.click();
  await expect.poll(() => requests).toEqual([failedQuestion, failedQuestion]);
  await expect(retry).toBeDisabled();
  try {
    await expect(composer).toHaveValue(nextDraft);
  } finally {
    releaseRetry();
  }
  await expect(page.getByText("Tell me your budget for the night.", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue(nextDraft);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect.poll(() => requests).toEqual([failedQuestion, failedQuestion, nextDraft]);
});

test("a sign-in-required response offers sign-in instead of provider retry", async ({ page }) => {
  await page.route("**/api/pub-pal/chat", async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Sign in to ask Pub Pal." }) });
  });
  await page.goto("/pal/chat");
  await page.getByRole("textbox", { name: "Describe the outing", exact: true }).fill("Quiet pubs in Soho");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Sign in to ask Pub Pal.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Ask again:/ })).toHaveCount(0);
  const signIn = page.getByRole("link", { name: "Sign in", exact: true });
  await expect(signIn).toHaveAttribute("href", "/login?mode=signin&from=/pal/chat");
  await signIn.click();
  await expect(page).toHaveURL(/\/login\?mode=signin&from=\/pal\/chat$/);
});
