"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import sprite from "@/components/map/canvas/mapIconSprite.json";
import { PubPalMascot } from "@/components/pal/PubPalMascot";
import {
  palPassportLandmark,
  palPassportPages,
  palPassportPose,
  readPalQuestStamps,
  type PalPassportLandmark,
  type PalQuestStamp as Stamp,
} from "@/lib/palQuest";
import type { PubPal } from "@/lib/pubPal";

import PalQuestStamp from "./PalQuestStamp";
import "./palQuest.css";

/** A landmark drawn at this many CSS px, from the map's own 2x sprite. */
const MARK_PX = 40;

// One landmark from the map's sprite (components/map/canvas/mapIconSprite.json,
// drawn by `npm run build:map-icon-sprites`): the same pictogram the map wears,
// in the theme's own colours, so no second drawing of a landmark exists.
function PassportLandmark({ landmark }: { landmark: PalPassportLandmark }) {
  const icon = (sprite.icons as Record<string, { x: number; y: number; width: number; height: number }>)[`lm:${landmark}`];
  if (!icon) return null;
  const unit = MARK_PX / icon.width;
  return (
    <span
      className="palPassportMark"
      aria-hidden="true"
      style={
        {
          "--mark-light": `url(${sprite.themes.light.url})`,
          "--mark-dark": `url(${sprite.themes.dark.url})`,
          backgroundSize: `${sprite.width * unit}px ${sprite.height * unit}px`,
          backgroundPosition: `${-icon.x * unit}px ${-icon.y * unit}px`,
        } as React.CSSProperties
      }
    />
  );
}

// The Pal's price passport on /pal: the stamp book as one page per London
// area, newest page first. Each page wears its area's landmark and the Pal in
// a pose of its own for that area (lib/palQuest.ts). It reads this device's
// book only and shows no total, because a stamp is a mark, not a score.
export default function PalQuestStamps({ pal, print }: { pal: Pick<PubPal, "name" | "appearance">; print: readonly boolean[] }) {
  const [stamps, setStamps] = useState<Stamp[] | null>(null);
  useEffect(() => {
    const read = () => setStamps(readPalQuestStamps());
    queueMicrotask(read);
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);
  if (stamps === null) return null;
  const pages = palPassportPages(stamps);
  return (
    <section className="palStampBook" aria-labelledby="pal-stamp-book-title" data-testid="pal-stamp-book">
      <h2 id="pal-stamp-book-title">Price passport</h2>
      {pages.length === 0 ? (
        <p className="palStampBookEmpty">
          {pal.name} hands out one price quest a day. Each one you answer stamps a page for that part of London.{" "}
          <Link href="/near" prefetch={false}>
            Find today&apos;s quest
          </Link>
        </p>
      ) : (
        <ol className="palPassportPages">
          {pages.map((page) => {
            const pose = palPassportPose(page.area);
            const headingId = `pal-passport-${page.area.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
            return (
              <li key={page.area} className="palPassportPage" aria-labelledby={headingId}>
                <div className="palPassportHead">
                  <PassportLandmark landmark={palPassportLandmark(page.area)} />
                  <h3 id={headingId}>{page.area}</h3>
                  <span
                    className="palPassportPal"
                    aria-hidden="true"
                    style={
                      {
                        "--pose-tilt": `${pose.tiltDeg}deg`,
                        "--pose-flip": String(pose.flip),
                        "--pose-hop": `${-pose.hopPx}px`,
                      } as React.CSSProperties
                    }
                  >
                    <PubPalMascot species={pal.appearance.species} size={36} circular decorative />
                  </span>
                </div>
                <ul className="palStampBookList">
                  {page.stamps.map((stamp) => (
                    <li key={stamp.day}>
                      <PalQuestStamp stamp={stamp} print={print} />
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
