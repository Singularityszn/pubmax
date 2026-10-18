import {
  LANDING_SKYLINE_HERO_AVIF_SRCSET,
  LANDING_SKYLINE_HERO_SIZES,
} from "@/lib/landingSkylineHero";

/** Desktop-only preload: on a phone a pub card's own photograph owns LCP, not the Thames band. */
const LANDING_SKYLINE_PRELOAD_MEDIA = "(min-width: 960px)";

type LandingSkylinePreloadProps = {
  /** True when the answer card stands on its pub's own photograph, the phone's LCP. A text card leaves Thames the LCP on every width. */
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
