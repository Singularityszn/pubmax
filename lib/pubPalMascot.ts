import modelFrames from "./palOriginalModelFrames.json";
import {
  PAL_MASCOT_SIZES,
  PAL_MASCOT_TALK,
  palMascotSlug,
  type PalMascotSlug,
} from "@/lib/palMascotAssets.mjs";
import type { PubPalSpecies } from "@/lib/pubPal";

export const PUB_PAL_MASCOT_ALT = "Pub Pal";

const PUB_PAL_MASCOT_SIZES = PAL_MASCOT_SIZES;

export type PubPalMascotSize = (typeof PUB_PAL_MASCOT_SIZES)[number];

export type PubPalMascotKind = "square" | "avatar";

/** Circuit Robin is the assistant face, so a caller that names no species gets it. */
export const DEFAULT_MASCOT_SPECIES: PubPalSpecies = "robin";

/**
 * The slug for a species that ships a master (or stands in for one), or null
 * when it has none and the surface owes it a legacy icon instead. This is the
 * ONE question a surface asks: nothing may compare a species name to decide
 * which artwork to draw.
 */
export function pubPalMascotSlugFor(species: PubPalSpecies): PalMascotSlug | null {
  return palMascotSlug(species);
}

export function pubPalMascotSrc(
  slug: PalMascotSlug,
  kind: PubPalMascotKind,
  size: PubPalMascotSize,
  ext: "webp" | "png",
): string {
  if (kind === "avatar") return `/pal/${slug}-avatar-${size}.${ext}`;
  return `/pal/${slug}-${size}.${ext}`;
}

export function pubPalMascotSrcSet(
  slug: PalMascotSlug,
  kind: PubPalMascotKind,
  ext: "webp" | "png",
): string {
  return PUB_PAL_MASCOT_SIZES.map((size) => `${pubPalMascotSrc(slug, kind, size, ext)} ${size}w`).join(", ");
}

/** The open-mouth frame at one size: WebP only, an overlay over the still. */
export function pubPalMascotTalkSrc(
  slug: PalMascotSlug,
  kind: PubPalMascotKind,
  size: PubPalMascotSize,
): string {
  if (kind === "avatar") return `/pal/${slug}-${PAL_MASCOT_TALK}-avatar-${size}.webp`;
  return `/pal/${slug}-${PAL_MASCOT_TALK}-${size}.webp`;
}

export function pubPalMascotTalkSrcSet(slug: PalMascotSlug, kind: PubPalMascotKind): string {
  return PUB_PAL_MASCOT_SIZES.map((size) => `${pubPalMascotTalkSrc(slug, kind, size)} ${size}w`).join(", ");
}

export function pubPalMascotFallbackSize(px: number): PubPalMascotSize {
  return PUB_PAL_MASCOT_SIZES.find((size) => size >= px) ?? 512;
}

/** The selected original model uses the same species owner as its portrait. */
export function pubPalMascotModelSrc(species: PubPalSpecies): string | null {
  const slug = pubPalMascotSlugFor(species);
  return slug && modelFrames[slug] ? `/brand/pals/${modelFrames[slug].file}` : null;
}

/** Baseline front composition measured against the unchanged original artwork. */
export function pubPalMascotModelStyle(species: PubPalSpecies): Record<`--${string}`, string> | undefined {
  const slug = pubPalMascotSlugFor(species);
  if (!slug) return undefined;
  const frame = modelFrames[slug];
  return { "--pal-model-fit": String(frame.scale), "--pal-model-fit-x": `${frame.x}%`, "--pal-model-fit-y": `${frame.y}%` };
}
