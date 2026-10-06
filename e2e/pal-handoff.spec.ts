import { test, expect } from "@playwright/test";

// DAG L16. The acceptance handoff used to sit behind PUBMAX_PAL_HANDOFF, which
// no deployment ever set, so the "Use this venue" affordance and the locality
// line were dark. The flag is retired and the handoff is the only behaviour.
//
// Asserting the handoff affordance itself needs a deterministic `/api/pub-pal/chat`
// card answer; __tests__/palChatAccept.test.ts owns that. This spec owns that the
// page mounts and carries the handoff build's own chrome.

test("Pal chat mounts and carries the handoff way back", async ({ page }) => {
  const response = await page.goto("/pal/chat");
  expect(response?.status()).toBe(200);
  // The ask surface renders.
  await expect(page.getByRole("textbox").first()).toBeVisible();
  // The secondary way onward is the handoff build's, not the retired flag-off copy.
  await expect(page.getByRole("link", { name: "Back to your Pub Pal" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan with the Pal" })).toHaveCount(0);
});
