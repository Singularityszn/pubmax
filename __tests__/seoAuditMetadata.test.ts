import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateMetadata } from "@/app/pint-index/page";
import { metadata as crawlsMetadata } from "@/app/crawls/page";
import { metadata as mapMetadata } from "@/app/map/page";
import { metadata as palMetadata } from "@/app/pal/page";
import { metadata as tonightMetadata } from "@/app/tonight/page";
import { metadata as homeMetadata } from "@/app/page";

// The committed public snapshot is a genuine empty read. A populated fixture
// is exercised by the admission tests, independently of this display wording.
describe("the public discovery metadata", () => {
  it("gives the homepage its own friends-and-planning description in the document head", () => {
    expect(homeMetadata.title).toEqual({
      absolute: "London pint prices and pub crawls with friends | PUBMAXX",
    });
    expect(homeMetadata.description).toContain("Plan a crawl and share the route with your mates");
    expect(homeMetadata.openGraph?.description).toBe(homeMetadata.description);
    expect(homeMetadata.twitter?.description).toBe(homeMetadata.description);
  });

  it("gives Tonight its own canonical and the same poster on both share cards", () => {
    expect(tonightMetadata.title).toBe("Tonight in London");
    expect(tonightMetadata.description).toBe(
      "Check sourced London pub listings for tonight on PUBMAXX, with map links when available.",
    );
    expect(tonightMetadata.alternates?.canonical).toBe("/tonight");
    expect(tonightMetadata.openGraph).toMatchObject({
      title: "Tonight in London",
      description: "Check sourced London pub listings for tonight on PUBMAXX, with map links when available.",
      url: "/tonight",
      images: [{ url: "/tonight/opengraph-image" }],
    });
    expect(tonightMetadata.twitter).toMatchObject({
      title: "Tonight in London",
      description: "Check sourced London pub listings for tonight on PUBMAXX, with map links when available.",
      images: ["/tonight/opengraph-image"],
    });
  });

  it("gives Pub Pal its own canonical and matching share cards", () => {
    expect(palMetadata.title).toBe("Plan your night with Pub Pal");
    expect(palMetadata.alternates?.canonical).toBe("/pal");
    expect(palMetadata.openGraph).toMatchObject({
      title: "Plan your night with Pub Pal",
      url: "/pal",
      images: [{ url: "/pal/circuit-robin-512.png" }],
    });
    expect(palMetadata.twitter).toMatchObject({
      title: "Plan your night with Pub Pal",
      images: ["/pal/circuit-robin-512.png"],
    });
  });

  it("gives the London map its own canonical and matching share cards", () => {
    expect(mapMetadata.title).toBe("London pub map");
    expect(mapMetadata.alternates?.canonical).toBe("/map");
    expect(mapMetadata.openGraph).toMatchObject({
      title: "London pub map",
      url: "/map",
      images: [{ url: "/api/city-map-card?city=london" }],
    });
    expect(mapMetadata.twitter).toMatchObject({
      title: "London pub map",
      images: ["/api/city-map-card?city=london"],
    });
  });

  it("names the Pint Index content without duplicating the layout's brand suffix", async () => {
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("London pint prices by borough and fare zone");
    expect(metadata.description).toContain("fare zone");
    expect(metadata.alternates?.canonical).toBe("/pint-index");
    expect(metadata.openGraph).toMatchObject({ title: metadata.title, description: metadata.description });
    expect(metadata.twitter).toMatchObject({ title: metadata.title, description: metadata.description });
  });

  it("names the existing London crawl directory and retains its canonical", () => {
    expect(crawlsMetadata.title).toBe("Free, self-guided London pub crawl routes");
    expect(crawlsMetadata.alternates?.canonical).toBe("/crawls");
    expect(crawlsMetadata.openGraph).toMatchObject({ title: "Free, self-guided London pub crawl routes", url: "/crawls" });
    expect(crawlsMetadata.twitter).toMatchObject({ title: "Free, self-guided London pub crawl routes" });
  });
});
