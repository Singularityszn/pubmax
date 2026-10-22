import { test, expect } from "@playwright/test";
const cases: [string, number][] = [
 ["cheap pints in Peckham on Rye Lane under £30 each", 200],
 ["Clapham pubs near The Wine Bar under £30 each", 200],
 ["Clapham pubs near Gin and Juice under £30 each", 200],
 ["root beer in Soho under £30 each", 422],
 ["a glass of red in Soho under £30 each", 422],
 ["I am drinking wine and my mate wants pints in Soho under £30 each", 422],
 ["pints for my mate and I am drinking wine in Soho under £30 each", 422],
];
for (const [query, expected] of cases) test(query, async ({ request }, testInfo) => {
 const response = await request.post("/api/plans/generate", { data: { query } });
 const body = await response.json();
 delete body.groundingProof;
 await testInfo.attach("response", { body: JSON.stringify({status: response.status(), body}), contentType: "application/json" });
 expect(response.status()).toBe(expected);
});
