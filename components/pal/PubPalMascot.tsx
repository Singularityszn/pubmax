import type { PubPalSpecies } from "@/lib/pubPal";
import {
  DEFAULT_MASCOT_SPECIES,
  PUB_PAL_MASCOT_ALT,
  pubPalMascotFallbackSize,
  pubPalMascotSlugFor,
  pubPalMascotSrc,
  pubPalMascotSrcSet,
  pubPalMascotTalkSrc,
  pubPalMascotTalkSrcSet,
  type PubPalMascotKind,
} from "@/lib/pubPalMascot";

export function PubPalMascot({
  species = DEFAULT_MASCOT_SPECIES,
  size = 32,
  sizes,
  priority = false,
  circular = true,
  lazy = false,
  decorative = false,
  className,
}: {
  /** Defaults to Circuit Robin, the assistant face. */
  species?: PubPalSpecies;
  size?: number;
  /**
   * The box the CSS really renders this mascot in, as a `sizes` list.
   *
   * `size` is the intrinsic width and height attribute pair, and on the surface
   * that stretches the mascot to fill its own box those two are not the same
   * number: the /pal meeting portrait draws it at about 403 CSS px on a desktop
   * while asking for 192, so the declaration under-stated the box by half.
   * A caller whose CSS sets the width states it here; everything else keeps the
   * square `size` it draws at.
   */
  sizes?: string;
  /**
   * Marks this mascot as the page's LCP candidate.
   *
   * A `<picture>` is found by the preload scanner, so the bytes are asked for
   * early either way; `fetchpriority` is what stops the request being queued
   * behind the document's other Low-priority images before layout has run.
   * Only a surface where the mascot IS the largest element may claim it.
   */
  priority?: boolean;
  circular?: boolean;
  lazy?: boolean;
  /** When true, the image is hidden from assistive tech because a parent names the portrait. */
  decorative?: boolean;
  className?: string;
}) {
  const slug = pubPalMascotSlugFor(species);
  // A species without a master has no renditions to request.
  if (!slug) return null;
  const kind: PubPalMascotKind = circular ? "avatar" : "square";
  const renderedSizes = sizes ?? `${size}px`;
  return (
    <picture className={className}>
      <source type="image/webp" srcSet={pubPalMascotSrcSet(slug, kind, "webp")} sizes={renderedSizes} />
      <img
        src={pubPalMascotSrc(slug, kind, pubPalMascotFallbackSize(size), "png")}
        srcSet={pubPalMascotSrcSet(slug, kind, "png")}
        sizes={renderedSizes}
        alt={decorative ? "" : PUB_PAL_MASCOT_ALT}
        aria-hidden={decorative ? true : undefined}
        width={size}
        height={size}
        decoding="async"
        loading={lazy ? "lazy" : "eager"}
        fetchPriority={priority ? "high" : undefined}
      />
    </picture>
  );
}

/**
 * The same photograph with only the mouth open, laid exactly over the still.
 * Its opacity is `--pal-mouth`, which the head loop (usePalHead3D) sets from the
 * Pal's own voice level while it speaks, so the mouth moves on the words and
 * rests closed otherwise. Decorative: the still below it carries the name.
 * A caller mounts it only while voice is live, so a page view never fetches it.
 */
export function PubPalMascotMouth({
  species = DEFAULT_MASCOT_SPECIES,
  size = 32,
  sizes,
  circular = true,
  className,
}: {
  species?: PubPalSpecies;
  size?: number;
  sizes?: string;
  circular?: boolean;
  className?: string;
}) {
  const slug = pubPalMascotSlugFor(species);
  if (!slug) return null;
  const kind: PubPalMascotKind = circular ? "avatar" : "square";
  return (
    <picture className={className ? `palMascotMouth ${className}` : "palMascotMouth"}>
      <img
        src={pubPalMascotTalkSrc(slug, kind, pubPalMascotFallbackSize(size))}
        srcSet={pubPalMascotTalkSrcSet(slug, kind)}
        sizes={sizes ?? `${size}px`}
        alt=""
        width={size}
        height={size}
        decoding="async"
      />
    </picture>
  );
}
