import { afterEach, describe, expect, it, vi } from "vitest";

// The route rate-limits per IP before anything else; the limiter's durable
// path would hit the network under the Vercel prod-env vitest run, so it is
// neutralised here (same pattern as planRoutes.test.ts) — the limiter has its
// own suite.
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

// The proxy only fetches hosts present in the app's own datasets (SSRF gate);
// tests pin behaviour with a controlled allowlist instead of the real files.
vi.mock("@/lib/venueImageHosts.server", () => ({
  allowedVenueImageHosts: () =>
    new Set([
      "www.thelamblondon.com",
      "www.oldshiphammersmith.co.uk",
      "www.jdwetherspoon.com",
      "example.com",
      "cdn.example.com",
    ]),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import { GET } from "@/app/api/image-proxy/route";
import {
  isProxiedVenueImageUrl,
  proxiedVenueImageUrl,
  proxiedVenueImageUrlAtWidth,
  VENUE_IMAGE_WIDTHS,
  venueImageLoader,
  venueImageWidthFor,
} from "@/lib/venueImages";

function req(src: string, query = ""): Request {
  return new Request(
    `http://localhost/api/image-proxy?src=${encodeURIComponent(src)}${query}`,
  );
}

/** A real JPEG, so sharp is exercised rather than stubbed. */
async function photograph(width: number, height: number): Promise<Uint8Array> {
  const out = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 90, b: 40 } },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
  return new Uint8Array(out);
}

function upstream(bytes: Uint8Array): Response {
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("proxiedVenueImageUrl", () => {
  it("routes a valid https photo through the same-origin proxy", () => {
    expect(proxiedVenueImageUrl("https://www.thelamblondon.com/p.jpg")).toBe(
      "/api/image-proxy?src=https%3A%2F%2Fwww.thelamblondon.com%2Fp.jpg",
    );
  });

  it("returns empty for blocked or invalid inputs, like the direct helper", () => {
    expect(proxiedVenueImageUrl("")).toBe("");
    expect(proxiedVenueImageUrl("https://images.app.goo.gl/x")).toBe("");
    expect(proxiedVenueImageUrl("not a url")).toBe("");
  });
});

describe("GET /api/image-proxy", () => {
  it("rejects non-https, IP-literal, and localhost sources without fetching", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    for (const bad of [
      "http://example.com/p.jpg",
      "https://127.0.0.1/p.jpg",
      "https://10.0.0.5/p.jpg",
      "https://localhost/p.jpg",
      "https://internal.local/p.jpg",
      "ftp://example.com/p.jpg",
      // Public host NOT present in the app's datasets — the SSRF gate rejects
      // it before any DNS/network activity (covers rebinding-style attacks).
      "https://attacker-controlled.example.net/p.jpg",
      "",
    ]) {
      const res = await GET(req(bad));
      expect(res.status, bad).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("streams an image response with long cache headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    const res = await GET(req("https://www.oldshiphammersmith.co.uk/p.jpg"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("returns a cacheable miss for allowed non-image content", async () => {
    const cancel = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const res = await GET(req("https://example.com/p.jpg"));

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns a cacheable miss when an allowed upstream image is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    const res = await GET(req("https://example.com/missing.jpg"));

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });

  it.each([429, 500, 502, 503])("keeps transient upstream status %s as an uncached failure", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
    const res = await GET(req("https://example.com/temporary.jpg"));

    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("returns a cacheable miss when an allowed legacy image redirects to site HTML", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://www.jdwetherspoon.com/" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

    const res = await GET(
      req("https://www.jdwetherspoon.com/~/media/images/pubs/2450/legacy.jpg"),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    expect(await res.text()).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a cacheable miss when an allowed image response has no body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    const res = await GET(req("https://example.com/empty.jpg"));

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("returns a cacheable miss for an empty readable raster body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    const res = await GET(req("https://example.com/empty-stream.jpg"));

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("refuses SVG — executable content must never be served same-origin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<svg onload=alert(1)></svg>", {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    expect((await GET(req("https://example.com/logo.svg"))).status).toBe(502);
  });

  it("follows at most one validated redirect hop", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://cdn.example.com/p.jpg" } }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([9]), { status: 200, headers: { "content-type": "image/png" } }),
      );
    const res = await GET(req("https://example.com/p.jpg"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect to a forbidden host", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://127.0.0.1/p.jpg" } }),
    );
    expect((await GET(req("https://example.com/p.jpg"))).status).toBe(502);
  });

  it("cancels a redirect body before rejecting a malformed location", async () => {
    const cancel = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        status: 302,
        headers: { location: "https://[" },
      }),
    );

    expect((await GET(req("https://example.com/p.jpg"))).status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

// Astra's live walk (7 Sep 2026, finding B8): /pubs shipped five photographs at
// their natural 1632x636 and 680x453 into a 344x168 box, 792 KB of it, and its
// load was the slowest on the site. Nothing had ever asked the source for a
// smaller picture.
describe("the proxy resizes to a width the page really draws", () => {
  it("answers a closed width as WebP, narrowed to the ask", async () => {
    const bytes = await photograph(1632, 636);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream(bytes));

    const res = await GET(req("https://example.com/p.jpg", "&w=384"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");

    const out = new Uint8Array(await res.arrayBuffer());
    expect((await sharp(out).metadata()).width).toBe(384);
    expect(out.byteLength).toBeLessThan(bytes.byteLength);
  });

  it("serves the original bytes when no width is asked for", async () => {
    const bytes = await photograph(680, 453);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream(bytes));

    const res = await GET(req("https://example.com/p.jpg"));
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBe(bytes.byteLength);
  });

  it("reads a width outside the closed set as no width at all", async () => {
    // The picture is what the caller came for. An unknown width is our
    // vocabulary problem, so it costs the reader the resize and never the photo.
    const bytes = await photograph(680, 453);
    for (const query of ["&w=345", "&w=99999", "&w=abc", "&w=-384", "&w=384.5"]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream(bytes));
      const res = await GET(req("https://example.com/p.jpg", query));
      expect(res.status, query).toBe(200);
      expect(res.headers.get("content-type"), query).toBe("image/jpeg");
    }
  });

  it("never enlarges a picture smaller than the ask", async () => {
    const bytes = await photograph(200, 120);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream(bytes));

    const res = await GET(req("https://example.com/p.jpg", "&w=1920"));
    const out = new Uint8Array(await res.arrayBuffer());
    expect((await sharp(out).metadata()).width).toBe(200);
  });

  it("falls back to the original bytes when the resize fails", async () => {
    // A failure here is about us rather than about the picture: the reader gets
    // the heavy image they got before this existed, never a broken one.
    const notAnImage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream(notAnImage));

    const res = await GET(req("https://example.com/p.jpg", "&w=384"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(notAnImage);
  });
});

describe("the width a surface asks the proxy for", () => {
  const proxied = proxiedVenueImageUrl("https://example.com/p.jpg");

  it("takes the narrowest closed width that covers the box", () => {
    expect(venueImageWidthFor(proxied, 300)).toBe(384);
    expect(venueImageWidthFor(proxied, 384)).toBe(384);
    expect(venueImageWidthFor(proxied, 385)).toBe(640);
    expect(venueImageWidthFor(proxied, 1100)).toBe(1920);
  });

  it("answers the widest it offers when nothing covers the box", () => {
    expect(venueImageWidthFor(proxied, 4000)).toBe(1920);
  });

  it("caps at the widest a surface is willing to pay for", () => {
    // Every candidate above the cap collapses onto it, which is what stops a 3x
    // phone asking for a sheet header's worth of pixels for a card background.
    expect(venueImageWidthFor(proxied, 1100, 640)).toBe(640);
    expect(venueImageWidthFor(proxied, 4000, 640)).toBe(640);
    expect(venueImageWidthFor(proxied, 300, 640)).toBe(384);
  });

  it("answers nothing for a photo that is not ours to resize", () => {
    // A community photo is a signed Storage URL. We never re-encode one.
    expect(venueImageWidthFor("https://storage.example.com/moment.jpg?token=x", 384)).toBeNull();
    expect(venueImageWidthFor("", 384)).toBeNull();
    expect(venueImageWidthFor("/api/image-proxy?src=https%3A%2F%2Fimages.app.goo.gl%2Fx", 384)).toBeNull();
    expect(isProxiedVenueImageUrl(proxied)).toBe(true);
    expect(isProxiedVenueImageUrl("https://storage.example.com/moment.jpg")).toBe(false);
  });
});

describe("the loader next/image spends", () => {
  const proxied = proxiedVenueImageUrl("https://example.com/p.jpg");

  it("builds a proxy URL at the closed width for each candidate", () => {
    const load = venueImageLoader(640);
    expect(load({ src: proxied, width: 256 })).toBe(
      proxiedVenueImageUrlAtWidth("https://example.com/p.jpg", 384),
    );
    expect(load({ src: proxied, width: 1920 })).toBe(
      proxiedVenueImageUrlAtWidth("https://example.com/p.jpg", 640),
    );
  });

  it("hands back an unresizable photo untouched", () => {
    const signed = "https://storage.example.com/moment.jpg?token=x";
    expect(venueImageLoader()({ src: signed, width: 640 })).toBe(signed);
  });

  it("offers only widths the proxy answers", () => {
    const load = venueImageLoader();
    for (const candidate of [16, 64, 384, 640, 1080, 1920, 3840]) {
      const width = Number(new URL(load({ src: proxied, width: candidate }), "https://x").searchParams.get("w"));
      expect(VENUE_IMAGE_WIDTHS, String(candidate)).toContain(width);
    }
  });
});

describe("the /pubs card asks for the box it draws", () => {
  const SOURCE = readFileSync(join(process.cwd(), "components/pubs/PubsGallery.tsx"), "utf8");

  it("passes both the box and the cap to the shared image component", () => {
    expect(SOURCE).toContain(
      'sizes="(max-width: 420px) 100vw, (max-width: 640px) 50vw, 344px"',
    );
    expect(SOURCE).toContain("maxWidth={640}");
  });
});
