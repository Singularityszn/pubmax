import {
  LANDING_SKYLINE_HERO_AVIF_SRCSET,
  LANDING_SKYLINE_HERO_SIZES,
} from "@/lib/landingSkylineHero";

/** Desktop-only preload: on a phone the answer card owns LCP, not the Thames band. */
const LANDING_SKYLINE_PRELOAD_MEDIA = "(min-width: 960px)";

type LandingSkylinePreloadProps = {
  /** When the priced answer card renders, phone LCP is the pub photo; otherwise Thames stays LCP on every width. */
  phoneAnswerOwnsLcp: boolean;
};

/** Head-discoverable preload for the landing LCP image. Rendered from the server page only. */
export default function LandingSkylinePreload({ phoneAnswerOwnsLcp }: LandingSkylinePreloadProps) {
  return (
    <link
      rel="preload"
      as="image"
      type="image/avif"
      {...(phoneAnswerOwnsLcp ? { media: LANDING_SKYLINE_PRELOAD_MEDIA } : {})}
      imageSrcSet={LANDING_SKYLINE_HERO_AVIF_SRCSET}
      imageSizes={LANDING_SKYLINE_HERO_SIZES}
      fetchPriority="high"
    />
  );
}
