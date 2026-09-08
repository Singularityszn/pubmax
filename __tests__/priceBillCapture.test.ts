import { readFile } from "node:fs/promises";
import type { Page, Request as PlaywrightRequest } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BILL_FIXTURE, installPriceUploadCapture } from "../e2e/helpers/priceBill";

async function capture() {
  const fetch = vi.fn(async () => new Response(null, { status: 201 }));
  const browser: Record<string, unknown> = { fetch };
  vi.stubGlobal("window", browser);
  const page = {
    exposeFunction: async (name: string, callback: unknown) => { browser[name] = callback; },
    addInitScript: async (callback: (path: string) => void, path: string) => callback(path),
  } as unknown as Page;
  const readUpload = await installPriceUploadCapture(page, "/api/price-submit");
  const bill = await readFile(BILL_FIXTURE);
  const body = new FormData();
  body.set("venueId", "venue-one");
  body.set("measure", "half");
  body.set("priceGbp", "2.6");
  body.set("receipt_photo", new File([bill], "bill.jpg", { type: "image/jpeg" }));
  return { readUpload, body, fetch };
}

// Model Chromium's network event: text survives, but receipt bytes are omitted.
async function networkRequest(body: FormData): Promise<PlaywrightRequest> {
  const wire = new FormData();
  body.forEach((value, key) => wire.set(key, typeof value === "string" ? value
    : new File([], value.name, { type: value.type })));
  const request = new Request("https://example.test/api/price-submit", { method: "POST", body: wire });
  const bytes = Buffer.from(await request.arrayBuffer());
  return {
    url: () => request.url,
    headers: () => Object.fromEntries(request.headers),
    postDataBuffer: () => bytes,
  } as unknown as PlaywrightRequest;
}

afterEach(() => vi.unstubAllGlobals());

describe("price fixture multipart capture", () => {
  it("keeps half and price fields and forwards the original File unchanged", async () => {
    const { readUpload, body, fetch } = await capture();
    await window.fetch("/api/price-submit", { method: "POST", body });
    expect(fetch.mock.calls[0]).toEqual(["/api/price-submit", { method: "POST", body }]);
    expect(await readUpload(await networkRequest(body))).toEqual({
      venueId: "venue-one", measure: "half", priceGbp: "2.6",
    });
  });

  it("refuses altered receipt bytes even when the wire metadata matches", async () => {
    const { readUpload, body } = await capture();
    body.set("receipt_photo", new File(["corrupt"], "bill.jpg", { type: "image/jpeg" }));
    await window.fetch("/api/price-submit", { method: "POST", body });
    await expect(readUpload(await networkRequest(body))).rejects.toThrow();
  });

  it("refuses a missing bill instead of treating a multipart envelope as evidence", async () => {
    const { readUpload, body } = await capture();
    body.delete("receipt_photo");
    await window.fetch("/api/price-submit", { method: "POST", body });
    await expect(readUpload(await networkRequest(body))).rejects.toThrow();
  });

  it("refuses a wire measure that differs from the captured submission", async () => {
    const { readUpload, body } = await capture();
    await window.fetch("/api/price-submit", { method: "POST", body });
    body.set("measure", "pint");
    await expect(readUpload(await networkRequest(body))).rejects.toThrow();
  });
});
