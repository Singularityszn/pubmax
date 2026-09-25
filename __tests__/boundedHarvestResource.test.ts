import { describe, expect, it, vi } from "vitest";

import {
  BoundedHarvestResourceError,
  fetchBoundedHarvestResource,
} from "@/scripts/lib/boundedHarvestResource.mjs";

const URL = "https://menus.example/menu.pdf";
const allowed = () => true;
const robotsAllowed = async () => ({ allowed: true, reason: "allowed" as const, evidence: "fixture" });

describe("bounded harvested resources", () => {
  it("requires a caller-supplied source policy before any request", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchBoundedHarvestResource({ url: URL, fetchImpl, isAllowedUrl: () => false, expectedContentTypes: ["application/pdf"], maxBytes: 100 }),
    ).rejects.toMatchObject({ code: "policy-refused" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects cross-origin redirects before requesting the destination", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://evil.example/menu.pdf" } }),
    );
    await expect(
      fetchBoundedHarvestResource({
        url: URL,
        fetchImpl,
        isAllowedUrl: allowed,
        expectedContentTypes: ["application/pdf"],
        maxBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "redirect-refused" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a response with the wrong content type", async () => {
    await expect(
      fetchBoundedHarvestResource({
        url: URL,
        fetchImpl: vi.fn().mockResolvedValue(
          new Response("not a pdf", { headers: { "content-type": "text/html" } }),
        ),
        isAllowedUrl: allowed,
        expectedContentTypes: ["application/pdf"],
        maxBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "content-type-refused" });
  });

  it("refuses an oversized declared body before reading it", async () => {
    const response = new Response("", {
      headers: { "content-type": "application/pdf", "content-length": "101" },
    });
    const body = vi.spyOn(response, "arrayBuffer");
    await expect(
      fetchBoundedHarvestResource({
        url: URL,
        fetchImpl: vi.fn().mockResolvedValue(response),
        isAllowedUrl: allowed,
        expectedContentTypes: ["application/pdf"],
        maxBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "too-large" });
    expect(body).not.toHaveBeenCalled();
  });

  it("caps streamed bodies even when content-length is absent", async () => {
    await expect(
      fetchBoundedHarvestResource({
        url: URL,
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(new Uint8Array(101), { headers: { "content-type": "application/pdf" } }),
        ),
        isAllowedUrl: allowed,
        expectedContentTypes: ["application/pdf"],
        maxBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "too-large" });
  });

  it("refuses robots denial before the resource request", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchBoundedHarvestResource({
        url: URL,
        fetchImpl,
        isAllowedUrl: allowed,
        robotsChecker: async () => ({ allowed: false, reason: "robots-disallowed" as const, evidence: "Disallow: /" }),
        expectedContentTypes: ["application/pdf"],
        maxBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "robots-refused" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not expose an override for robots refusal", async () => {
    const fetchImpl = vi.fn();
    const input = {
      url: URL,
      fetchImpl,
      isAllowedUrl: () => true,
      robotsChecker: async () => ({ allowed: false, reason: "robots-disallowed" as const, evidence: "Disallow: /" }),
      allowRobotsDenial: true,
      expectedContentTypes: ["application/pdf"],
      maxBytes: 1024,
    } as Parameters<typeof fetchBoundedHarvestResource>[0];
    await expect(
      fetchBoundedHarvestResource(input),
    ).rejects.toMatchObject({ code: "robots-refused" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("times out stalled requests", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    );
    await expect(
      fetchBoundedHarvestResource({
        url: URL,
        fetchImpl,
        isAllowedUrl: allowed,
        expectedContentTypes: ["application/pdf"],
        timeoutMs: 5,
        maxBytes: 100,
      }),
    ).rejects.toBeInstanceOf(BoundedHarvestResourceError);
  });

  it("returns a bounded allowed body and final URL", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const result = await fetchBoundedHarvestResource({
      url: URL,
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(bytes, { headers: { "content-type": "application/pdf" } }),
      ),
      isAllowedUrl: allowed,
      robotsChecker: robotsAllowed,
      expectedContentTypes: ["application/pdf"],
      maxBytes: 100,
    });
    expect([...result.bytes]).toEqual([...bytes]);
    expect(result.finalUrl).toBe(URL);
  });
});
