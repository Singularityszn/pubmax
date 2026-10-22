import { test, expect } from "@playwright/test";
for (const query of ["no red or white wine, cheap cocktails in Soho under £30 each", "no coffee or ginger beer, wine night in Soho under £30 each", "no gin or gin and tonic, wine night in Soho under £30 each"]) test(query, async ({ request }) => {
 const response = await request.post("/api/plans/generate", { data: { query } });
 expect(response.status()).toBe(422);
});
