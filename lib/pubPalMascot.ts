export const PUB_PAL_MASCOT_ALT = "Pub Pal";

export const PUB_PAL_MASCOT_SIZES = [32, 64, 128, 512] as const;

export type PubPalMascotSize = (typeof PUB_PAL_MASCOT_SIZES)[number];

export type PubPalMascotKind = "square" | "avatar";

const PREFIX = "/pal/circuit-robin";

export function pubPalMascotSrc(kind: PubPalMascotKind, size: PubPalMascotSize, ext: "webp" | "png"): string {
  if (kind === "avatar") return `${PREFIX}-avatar-${size}.${ext}`;
  return `${PREFIX}-${size}.${ext}`;
}

export function pubPalMascotSrcSet(kind: PubPalMascotKind, ext: "webp" | "png"): string {
  return PUB_PAL_MASCOT_SIZES.map((size) => `${pubPalMascotSrc(kind, size, ext)} ${size}w`).join(", ");
}

export function pubPalMascotFallbackSize(px: number): PubPalMascotSize {
  return PUB_PAL_MASCOT_SIZES.find((size) => size >= px) ?? 512;
}
