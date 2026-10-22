import { test, expect } from "@playwright/test";
for (const query of ["pubs in Soho serving wine under £30 each", "a night in Soho drinking cocktails under £30 each", "no frills or fuss wine night in Soho under £30 each"]) test(query, async ({ request }) => {
 const response = await request.post("/api/plans/generate", { data: { query } });
 expect(response.status()).toBe(422);
});
