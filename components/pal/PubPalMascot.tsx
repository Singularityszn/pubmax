import {
  PUB_PAL_MASCOT_ALT,
  pubPalMascotFallbackSize,
  pubPalMascotSrc,
  pubPalMascotSrcSet,
  type PubPalMascotKind,
} from "@/lib/pubPalMascot";

export function PubPalMascot({
  size = 32,
  circular = true,
  lazy = false,
  decorative = false,
  className,
}: {
  size?: number;
  circular?: boolean;
  lazy?: boolean;
  /** When true, the image is hidden from assistive tech because a parent names the portrait. */
  decorative?: boolean;
  className?: string;
}) {
  const kind: PubPalMascotKind = circular ? "avatar" : "square";
  return (
    <picture className={className}>
      <source type="image/webp" srcSet={pubPalMascotSrcSet(kind, "webp")} sizes={`${size}px`} />
      <img
        src={pubPalMascotSrc(kind, pubPalMascotFallbackSize(size), "png")}
        srcSet={pubPalMascotSrcSet(kind, "png")}
        sizes={`${size}px`}
        alt={decorative ? "" : PUB_PAL_MASCOT_ALT}
        aria-hidden={decorative ? true : undefined}
        width={size}
        height={size}
        decoding="async"
        loading={lazy ? "lazy" : "eager"}
      />
    </picture>
  );
}
