import { expect, test } from "@playwright/test";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// The environment is the independent oracle for the emergency rollback switch.
// Run with both the default flag and PUBMAX_SOCIAL_FRIENDS_LAUNCH=0.
test("the Social launch flag controls actions and protected reads", async ({ page }, info) => {
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await auth.signedInAs("A");
  let protectedReads = 0;
  await page.route("**/api/social/access", route => route.fulfill({ json: {
    state: "verified", viewerHandle: "karan", draftScope: "a".repeat(43),
  } }));
  await page.route("**/api/social/{posts,crews,outbox,interactions}**", route => {
    protectedReads += 1;
    return route.fulfill({ json: { posts: [], items: [], nextCursor: null } });
  });
  await page.goto("/social");
  if (process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH !== "0") {
    await expect(page.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
    await expect.poll(() => protectedReads).toBeGreaterThan(0);
    return;
  }
  await expect(page.getByText("Social preview is invite-only for now. It opens more widely soon.", { exact: true })).toBeVisible();
  const post = page.getByRole("button", { name: "Post", exact: true });
  await expect(post).toBeDisabled();
  await post.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("dialog", { name: "New post", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your crews", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Find your lot", exact: true })).toHaveCount(0);
  expect(protectedReads).toBe(0);
  await page.screenshot({ path: info.outputPath("rollback-preview.png") });
});
