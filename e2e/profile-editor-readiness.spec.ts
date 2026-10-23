import { expect, test } from "@playwright/test";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

for (const width of [390, 1440]) {
  test(`${width}px: a delayed profile read cannot become an empty saved profile`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    let release!: () => void;
    const readable = new Promise<void>((resolve) => { release = resolve; });
    const writes: Record<string, unknown>[] = [];
    const profile = {
      id: ACCOUNTS.A.id, handle: ACCOUNTS.A.handle, displayName: "Existing Name",
      bio: "My existing bio", favouriteDrink: "Gin and beer", visibility: "private",
      createdAt: "2026-06-01T12:00:00.000Z", updatedAt: "2026-10-13T09:00:00.000Z",
    };
    await page.route("**/api/profiles/karan**", async (route) => {
      if (new URL(route.request().url()).pathname !== "/api/profiles/karan") return route.fallback();
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        writes.push(body);
        return route.fulfill({ json: { profile: { ...profile, ...body } } });
      }
      await readable;
      await route.fulfill({ json: { profile, projection: "full", socialLinks: [], counts: { followers: 0, following: 0 } } });
    });
    try {
      await page.goto("/u/karan?edit=1");
      const editor = page.getByRole("region", { name: "Editing your profile", exact: true });
      await expect(editor).toContainText("Loading your profile");
      await expect(editor.getByRole("button", { name: "Save profile", exact: true })).toHaveCount(0);
      expect(writes).toEqual([]);
      release();
      await expect(editor.getByLabel("Display name", { exact: true })).toHaveValue("Existing Name");
      await expect(editor.getByLabel("Bio", { exact: true })).toHaveValue("My existing bio");
      await expect(editor.getByLabel("Favourite drink", { exact: true })).toHaveValue("Gin and beer");
      await editor.getByLabel("Bio", { exact: true }).fill("My edited bio");
      await editor.getByRole("button", { name: "Save profile", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ displayName: "Existing Name", bio: "My edited bio", favouriteDrink: "Gin and beer", visibility: "private" });
    } finally {
      release();
    }
  });
}
