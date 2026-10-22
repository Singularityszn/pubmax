import { test, expect } from "@playwright/test";
for (const query of ["I want a shot in Soho under £30 each", "In Soho I fancy wine under £30 each", "No gin or wine, cheap cocktails in Soho under £30 each"]) test(query, async ({ request }) => {
 const response = await request.post("/api/plans/generate", { data: { query } });
 expect(response.status()).toBe(422);
});
