import {
  LANDING_SKYLINE_HERO_AVIF_SRCSET,
  LANDING_SKYLINE_HERO_SIZES,
} from "@/lib/landingSkylineHero";

/** Head-discoverable preload for the landing LCP image. Rendered from the server page only. */
export default function LandingSkylinePreload() {
  return (
    <link
      rel="preload"
      as="image"
      type="image/avif"
      imageSrcSet={LANDING_SKYLINE_HERO_AVIF_SRCSET}
      imageSizes={LANDING_SKYLINE_HERO_SIZES}
      fetchPriority="high"
    />
  );
}
