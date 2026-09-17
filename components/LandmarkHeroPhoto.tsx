"use client";

import { useState } from "react";
import { Landmark as LandmarkIcon } from "lucide-react";

import LandmarkPhotoCredit from "@/components/LandmarkPhotoCredit";
import type { LandmarkImage } from "@/lib/landmarks";

import styles from "./landmarkHeroPhoto.module.css";

/**
 * The photo at the top of a landmark story, on the map sheet and on the
 * chapter page alike.
 *
 * A landmark photo is a remote Wikimedia file, so it can fail: the host can
 * refuse a hotlink, the file can move, or the network can be gone. A browser
 * draws a failed <img> as a broken-image glyph over the alt text, and the
 * credit bar underneath then credits a photo nobody can see. So a failed load
 * swaps the whole figure for the landmark's own brand treatment, and the
 * credit leaves with the photo, because a credit is a claim about the bytes
 * on screen and not a decoration.
 *
 * Key this on the landmark id at the call site so a new landmark starts with a
 * fresh attempt rather than inheriting the last one's failure.
 */
export default function LandmarkHeroPhoto({
  image,
  name,
  className,
  loading = "lazy",
}: {
  image: LandmarkImage | undefined;
  name: string;
  /** The caller's figure class, so each surface keeps its own geometry. */
  className: string;
  loading?: "lazy" | "eager";
}) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) {
    return (
      <div className={`${className} ${styles.landmarkHeroFallback}`} aria-hidden="true">
        <LandmarkIcon size={40} strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <figure className={className}>
      {/* Plain <img> (not next/image): a remote Wikimedia URL, so no
          remotePatterns config and no layout cost until the surface opens. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={name}
        loading={loading}
        decoding="async"
        onError={() => setFailed(true)}
      />
      <LandmarkPhotoCredit image={image} />
    </figure>
  );
}
