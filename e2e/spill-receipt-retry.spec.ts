import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installAuthDoubles } from "./helpers/authDoubles";
import { attachSpillBill, BILL_FIXTURE } from "./helpers/priceBill";

type CapturedUpload = { price: FormDataEntryValue | null; receipt_photo: number[]; pint_photo: number[] };

test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  trace: "off",
});
test.setTimeout(120_000);

test("a failed full composer keeps the bill and price until the retry lands", async ({ page }) => {
  // Every write is answered locally. This test never submits to a live store.
  await page.route("**/*", async (route) => {
    if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.fallback();
    await route.fulfill({ status: 503, json: { error: "Unexpected test write" } });
  });
  const auth = await installAuthDoubles(page);
  await page.goto("/api/version");
  await auth.signedInAs("A");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    const captured: CapturedUpload[] = [];
    Object.assign(window, { receiptRetryUploads: captured });
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      if (String(input) === "/api/pint-drops" && init?.method === "POST" && init.body instanceof FormData) {
        // Chromium's network event omits multipart file bytes. Read the actual
        // Files passed to fetch, while the route below still intercepts writes.
        const body = init.body;
        const bytes = async (name: string) => Array.from(new Uint8Array(await (body.get(name) as File).arrayBuffer()));
        captured.push({ price: body.get("priceGbp"), receipt_photo: await bytes("receipt_photo"), pint_photo: await bytes("pint_photo") });
      }
      return originalFetch(input, init);
    };
  });
  const requests: FormData[] = [];
  await page.route("**/api/pint-drops", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    const body = await new Response(Uint8Array.from(request.postDataBuffer() ?? []), {
      headers: { "content-type": request.headers()["content-type"] },
    }).formData();
    requests.push(body);
    if (requests.length === 1) {
      await route.fulfill({ status: 503, json: { error: "Temporary storage outage", retryable: true } });
      return;
    }
    await route.fulfill({ status: 201, json: { drop: {
      id: "retry-kept", venueId: body.get("venueId"), handle: "karan",
      priceGbp: Number(body.get("priceGbp")), drink: body.get("drink"),
      measure: body.get("measure"), passedDownNote: "", era: "",
      provenance: "contributor", status: "visible", visibility: "public",
      createdAt: new Date().toISOString(), pintPhotoUrl: null, venuePhotoUrl: null,
      receiptPhotoUrl: "/e2e/receipt-kept.jpg",
    } } });
  });
  await page.goto("/map?sel=venue-1vle947");
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(sheet).toBeVisible();
  await sheet.getByRole("tab", { name: "Stories", exact: true }).click();
  await sheet.getByRole("button", { name: /log a pint drop/i }).click();
  const form = page.locator("form.dropComposer");
  await expect(form).toBeVisible();
  await form.getByRole("group", { name: /quick-add price/i }).getByRole("button").first().click();
  await form.getByLabel("Drink", { exact: true }).fill("Pale ale");
  await attachSpillBill(form);
  await form.getByRole("button", { name: "Add a photo or story" }).click();
  await form.getByLabel(/Snap the pour: snap or upload/i).setInputFiles(BILL_FIXTURE);
  await form.getByRole("button", { name: "Log it", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(form).toBeVisible();
  await expect(sheet).toContainText("Temporary storage outage");
  await expect(form.locator('[data-testid="spill-receipt-step"] img')).toBeVisible();
  await expect.poll(() => form.locator('[data-testid="spill-receipt-step"] img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await form.getByRole("button", { name: "Log it", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  const original = await readFile(BILL_FIXTURE);
  const uploads = await page.evaluate(() => (window as Window & { receiptRetryUploads?: CapturedUpload[] }).receiptRetryUploads!);
  expect(uploads).toHaveLength(2);
  for (const body of uploads) {
    for (const field of ["receipt_photo", "pint_photo"] as const) {
      expect(Buffer.from(body[field])).toEqual(original);
    }
    expect(body.price).toBe(requests[0].get("priceGbp"));
  }
  await expect(form).toBeHidden();
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem("pubmax:optimistic-spill-posts:v1") ?? "[]"));
  expect(records).toHaveLength(1);
  expect(records[0].retry).toBeUndefined();
});
