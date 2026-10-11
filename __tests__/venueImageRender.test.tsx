// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueImage from "@/components/media/VenueImage";

describe("responsive venue photographs", () => {
  it("offers AVIF for a lazy proxied photo and retains the WebP image fallback", () => {
    const html = renderToStaticMarkup(
      <VenueImage
        sources={[{ url: "https://example.com/pub.jpg", provenance: "chain" }]}
        alt="Pub frontage"
        fill
        sizes="344px"
        maxWidth={640}
        preferAvif
      />,
    );
    expect(html).toContain('<source type="image/avif"');
    expect(html).toContain("&amp;f=avif");
    const image = html.match(/<img[^>]*>/)?.[0];
    expect(image).toContain('loading="lazy"');
    expect(image).not.toContain("f=avif");
    expect(html).toContain("Photo: pub website");
  });

  it("retries an AVIF decode failure as WebP before advancing to the community photo", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previous = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => root.render(
        <VenueImage
          sources={[
            { url: "https://example.com/pub.jpg", provenance: "chain" },
            { url: "https://storage.example.com/signed.jpg", provenance: "community" },
          ]}
          alt="Pub"
          preferAvif
        />,
      ));
      const avifImage = container.querySelector("img")!;
      Object.defineProperty(avifImage, "currentSrc", {
        value: "http://localhost/api/image-proxy?src=https%3A%2F%2Fexample.com%2Fpub.jpg&w=640&f=avif",
      });
      await act(async () => avifImage.dispatchEvent(new Event("error")));
      expect(container.querySelector("source")).toBeNull();
      expect(container.querySelector("img")?.getAttribute("src")).toContain("/api/image-proxy?");
      expect(container.textContent).toContain("Photo: pub website");

      await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
      expect(container.querySelector("img")?.getAttribute("src")).toBe("https://storage.example.com/signed.jpg");
      expect(container.textContent).toContain("Photo: community");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      environment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  });

  it("keeps other surfaces, signed community photos and priority preloads on their existing path", () => {
    for (const props of [
      { sources: [{ url: "https://example.com/pub.jpg", provenance: "chain" as const }] },
      { sources: [{ url: "https://storage.example.com/signed.jpg?token=example", provenance: "community" as const }], preferAvif: true },
      { sources: [{ url: "https://example.com/pub.jpg", provenance: "chain" as const }], priority: true, preferAvif: true },
    ]) {
      const html = renderToStaticMarkup(<VenueImage {...props} alt="Pub" />);
      expect(html).not.toContain("image/avif");
      expect(html).not.toContain("f=avif");
    }
  });
});
