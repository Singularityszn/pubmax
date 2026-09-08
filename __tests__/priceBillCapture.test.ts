import { readFile } from "node:fs/promises";
import type { Page, Request as PlaywrightRequest } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BILL_FIXTURE, installPriceUploadCapture } from "../e2e/helpers/priceBill";

async function capture() {
  const submissions: Request[] = [];
  class BrowserRequest extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "https://example.test") : input, init);
      submissions.push(this);
    }
  }
  const fetch = vi.fn(async (_request: Request) => new Response(null, { status: 201 }));
  const browser: Record<string, unknown> = { fetch, Request: BrowserRequest };
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
  return { readUpload, body, fetch, submissions };
}

// Chromium can omit receipt bytes. Event headers still identify the actual Request.
function networkRequest(request: Request): PlaywrightRequest {
  return {
    url: () => request.url,
    headers: () => Object.fromEntries(request.headers),
    postDataBuffer: () => Buffer.from("incomplete multipart event"),
  } as unknown as PlaywrightRequest;
}

afterEach(() => vi.unstubAllGlobals());

describe("price fixture multipart capture", () => {
  it("keeps half and price fields and forwards the original File unchanged", async () => {
    const { readUpload, body, fetch, submissions } = await capture();
    await window.fetch("/api/price-submit", { method: "POST", body });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(submissions).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toBe(submissions[0]);
    const forwarded = await submissions[0].clone().formData();
    expect(forwarded.get("measure")).toBe("half");
    expect(Buffer.from(await (forwarded.get("receipt_photo") as File).arrayBuffer()))
      .toEqual(await readFile(BILL_FIXTURE));
    expect(await readUpload(networkRequest(fetch.mock.calls[0][0]))).toEqual({
      venueId: "venue-one", measure: "half", priceGbp: "2.6",
    });
  });

  it("refuses altered receipt bytes even when the wire metadata matches", async () => {
    const { readUpload, body, fetch } = await capture();
    body.set("receipt_photo", new File(["corrupt"], "bill.jpg", { type: "image/jpeg" }));
    await window.fetch("/api/price-submit", { method: "POST", body });
    await expect(readUpload(networkRequest(fetch.mock.calls[0][0]))).rejects.toThrow();
  });

  it("refuses a missing bill instead of treating a multipart envelope as evidence", async () => {
    const { readUpload, body, fetch } = await capture();
    body.delete("receipt_photo");
    await window.fetch("/api/price-submit", { method: "POST", body });
    await expect(readUpload(networkRequest(fetch.mock.calls[0][0]))).rejects.toThrow();
  });

  it("refuses a different submission with its own multipart boundary", async () => {
    const { readUpload, body, fetch } = await capture();
    await window.fetch("/api/price-submit", { method: "POST", body });
    const differentBody = new FormData();
    body.forEach((value, key) => differentBody.set(key, value));
    differentBody.set("measure", "pint");
    const unrelated = new Request(fetch.mock.calls[0][0].url, { method: "POST", body: differentBody });
    await expect(readUpload(networkRequest(unrelated))).rejects.toThrow(/boundary/);
    expect(await readUpload(networkRequest(fetch.mock.calls[0][0])))
      .toMatchObject({ measure: "half" });
  });

  it("snapshots fields and receipt before call-time FormData mutations", async () => {
    const { readUpload, body, fetch } = await capture();
    const pending = window.fetch("/api/price-submit", { method: "POST", body });
    body.set("measure", "pint");
    body.set("receipt_photo", new File(["replacement"], "bill.jpg", { type: "image/jpeg" }));
    await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0][0];
    const forwarded = await request.clone().formData();
    expect(forwarded.get("measure")).toBe("half");
    expect(Buffer.from(await (forwarded.get("receipt_photo") as File).arrayBuffer()))
      .toEqual(await readFile(BILL_FIXTURE));
    expect(await readUpload(networkRequest(request))).toEqual({
      venueId: "venue-one", measure: "half", priceGbp: "2.6",
    });
  });
});
