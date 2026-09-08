import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import VenueImage from "@/components/media/VenueImage";
import PubsGallery from "@/components/pubs/PubsGallery";

vi.mock("@/components/pubs/PubsFilters", () => ({ default: () => null }));
vi.mock("@/components/pubs/BookingClickAnalytics", () => ({ default: () => null }));

const photo = "https://example.com/pub.jpg";

function imageTag(html: string): string {
  const tag = html.match(/<img\b[^>]*>/)?.[0];
  expect(tag).toBeDefined();
  return tag!;
}

describe("decorative venue card images", () => {
  it("renders one fixed proxy URL through the real Next Image component", () => {
    const tag = imageTag(renderToStaticMarkup(
      <VenueImage sources={[{ url: photo, provenance: "chain" }]} alt="" fill variant="card" />,
    ));
    expect(tag).toContain('src="/api/image-proxy?src=https%3A%2F%2Fexample.com%2Fpub.jpg&amp;variant=card"');
    expect(tag).not.toContain("srcSet=");
    expect(tag).toContain('loading="lazy"');
  });

  it.each([
    "https://storage.example.com/photo.jpg?token=private&expires=123",
    "https://storage.example.com/api/image-proxy?src=https%3A%2F%2Fexample.com%2Fp.jpg&token=private",
  ])("leaves the community URL %s untouched when the caller requests a card", (signed) => {
    const tag = imageTag(renderToStaticMarkup(
      <VenueImage sources={[{ url: signed, provenance: "community" }]} alt="Pub" fill variant="card" />,
    ));
    expect(tag).toContain(`src="${signed.replaceAll("&", "&amp;")}"`);
    expect(tag).not.toContain("variant=card");
    expect(tag).not.toContain("srcSet=");
  });

  it("keeps responsive width selection on other surfaces", () => {
    const tag = imageTag(renderToStaticMarkup(
      <VenueImage sources={[{ url: photo, provenance: "chain" }]} alt="Pub" fill maxWidth={640} />,
    ));
    expect(tag).toContain("srcSet=");
    expect(tag).toContain("&amp;w=640");
    expect(tag).not.toContain("variant=card");
  });

  it("selects the fixed preset from the real gallery", () => {
    const html = renderToStaticMarkup(
      <PubsGallery
        pubs={[{ id: "test", name: "The Pub", borough: "Westminster", source: "other", sourceLabel: "Other", photoUrl: photo, drinkAccent: "beer", drinkShelf: ["wine", "gin"], cheapestPrice: null, zone: 1 }]}
        matchingPubs={1} filter="all" zone="all"
        counts={{ all: 1, "nicholsonspubs.co.uk": 0, "greene-king.co.uk": 0, "youngs.co.uk": 0, other: 1 }}
        zonesPresent={[1]} page={1} totalPages={1} complete
      />,
    );
    const tag = imageTag(html);
    expect(tag).toContain("&amp;variant=card");
    expect(tag).not.toContain("srcSet=");
    expect(html).not.toContain('class="pubsCardGlyphHero"');
    expect(html).not.toContain('class="pubsCardShelf"');
    expect(html).toContain('class="pubsCardArtLabel">Beer</span>');
    expect(html).toContain('class="venueImage__provenance"');
    expect(html).toContain('class="pubsCardMeta"');
    expect(html).toContain('class="pubsBorough">Westminster</span>');
  });

  it("preserves the drink glyph and label on a card without a photo", () => {
    const html = renderToStaticMarkup(
      <PubsGallery
        pubs={[{ id: "no-photo", name: "The Pub", borough: "Westminster", source: "other", sourceLabel: "Other", drinkAccent: "beer", drinkShelf: ["wine"], cheapestPrice: null, zone: 1 }]}
        matchingPubs={1} filter="all" zone="all"
        counts={{ all: 1, "nicholsonspubs.co.uk": 0, "greene-king.co.uk": 0, "youngs.co.uk": 0, other: 1 }}
        zonesPresent={[1]} page={1} totalPages={1} complete
      />,
    );
    expect(html).toContain('class="pubsCard pubsCard--no-art"');
    expect(html).toMatch(/class="pubsCardDrink"><svg\b.*?<span>Beer<\/span><\/p>/);
    expect(html).not.toContain('class="pubsCardArt"');
    expect(html).not.toContain("<img");
  });
});
