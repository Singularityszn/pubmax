import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import LandingPhoto from "@/components/landing/LandingPhoto";
import Screen from "@/components/ui/screen";
import type { ResolvedLandingPhoto } from "@/lib/landingImagery";

// The head both borough surfaces share (docs/design/LAUNCH_SCREENS.md): the
// map door is the one primary action and "Find my pint" is the quiet way
// onward. The index and a borough chapter differ only in what they name and
// where their map opens, so that difference rides as props and the action
// hierarchy is written once. The link stays bare `/near`: `?locate=1` is the
// geolocation ask and belongs to the two deliberate one-tap CTAs alone.
//
// A borough CHAPTER carries a photograph of London under its head (captain
// 6 Sep 2026): its own borough where lib/landingImagery.ts holds one, else the
// city. The INDEX passes none, being a directory of 33 boroughs rather than a
// place, and its LCP ceiling (perf/route-budgets.json) is the tightest of the
// two.
export default function BoroughScreen({
  kicker,
  title,
  lede,
  titleId,
  mapHref,
  mapLabel,
  photo,
  children,
}: {
  kicker: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  titleId: string;
  mapHref: Route;
  mapLabel: string;
  /** The chapter's photograph. Absent on the index; see the note above. */
  photo?: ResolvedLandingPhoto;
  children?: ReactNode;
}) {
  return (
    <Screen
      as="section"
      className="boroughScreen"
      kicker={kicker}
      title={title}
      lede={lede}
      titleId={titleId}
      primary={<Link prefetch={false} href={mapHref}>{mapLabel}</Link>}
      secondary={<Link prefetch={false} href="/near">Find my pint</Link>}
    >
      {photo ? (
        <LandingPhoto
          resolved={photo}
          variant="band"
          sizes="(max-width: 1100px) 100vw, 1040px"
          priority
          className="boroughPhoto"
        />
      ) : null}
      {children}
    </Screen>
  );
}
