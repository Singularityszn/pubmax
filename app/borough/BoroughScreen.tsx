import Link from "next/link";
import type { ReactNode } from "react";

import Screen from "@/components/ui/screen";

// The head both borough surfaces share (docs/design/LAUNCH_SCREENS.md): the
// map door is the one primary action and "Find my pint" is the quiet way
// onward. The index and a borough chapter differ only in what they name and
// where their map opens, so that difference rides as props and the action
// hierarchy is written once. The link stays bare `/near`: `?locate=1` is the
// geolocation ask and belongs to the two deliberate one-tap CTAs alone.
export default function BoroughScreen({
  kicker,
  title,
  lede,
  titleId,
  mapHref,
  mapLabel,
  children,
}: {
  kicker: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  titleId: string;
  mapHref: string;
  mapLabel: string;
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
      primary={<Link href={mapHref}>{mapLabel}</Link>}
      secondary={<Link href="/near">Find my pint</Link>}
    >
      {children}
    </Screen>
  );
}
