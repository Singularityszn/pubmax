import { test, expect } from "@playwright/test";
for (const query of ["Soho on cocktails then Covent Garden under \u00a315 each", "a night on wine all the way under \u00a330 each", "Soho on wine then Borough Market under \u00a330 each"]) test(query, async ({ request }) => { const r = await request.post("/api/plans/generate", { data: { query } }); expect(r.status()).toBe(422); });
