import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveVenuePermalinkSlug = vi.fn();

vi.mock("@/lib/venueIndex", () => ({
  resolveVenuePermalinkSlug: (...args: unknown[]) =>
    resolveVenuePermalinkSlug(...args),
  venueMapUrl: (id: string) => `/map?sel=${encodeURIComponent(id)}`,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    const error = new Error("NEXT_NOT_FOUND");
    (error as { digest?: string }).digest = "NEXT_NOT_FOUND";
    throw error;
  },
}));

describe("venue permalink redirect routes", () => {
  beforeEach(() => {
    resolveVenuePermalinkSlug.mockReset();
  });

  it("redirects a resolved /venue slug to the map selection deep link", async () => {
    resolveVenuePermalinkSlug.mockResolvedValue("venue-806vol");
    const { GET } = await import("@/app/venue/[slug]/route");
    const response = await GET(new Request("http://localhost/venue/the-ship-w1"), {
      params: Promise.resolve({ slug: "the-ship-w1" }),
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://localhost/map?sel=venue-806vol",
    );
  });

  it("redirects a resolved /pub slug the same way", async () => {
    resolveVenuePermalinkSlug.mockResolvedValue("venue-806vol");
    const { GET } = await import("@/app/pub/[slug]/route");
    const response = await GET(new Request("http://localhost/pub/the-ship-w1"), {
      params: Promise.resolve({ slug: "the-ship-w1" }),
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://localhost/map?sel=venue-806vol",
    );
  });

  it.each(["venue", "pub"])("returns a usable 404 for an unknown /%s slug", async (route) => {
    resolveVenuePermalinkSlug.mockResolvedValue(null);
    const { venuePermalinkRedirect } = await import("@/lib/venuePermalinkRedirect");
    const response = await venuePermalinkRedirect(new Request(`http://localhost/${route}/no-such-pub`), {
      params: Promise.resolve({ slug: "no-such-pub" }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("<main");
    expect(html).toContain('href="/map"');
    expect(html).toContain('href="/pubs"');
  });
});
