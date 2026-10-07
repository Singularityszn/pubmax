import Link from "next/link";
import type { ReactNode } from "react";

import Screen from "@/components/ui/screen";

// The head the live Pint Index and every dated edition share
// (docs/design/LAUNCH_SCREENS.md): the map is the one primary action and the
// CSV is the quiet way onward. The two pages differ only in the heading, the
// stamp under it and which CSV they hand over, so that rides as props and the
// action hierarchy is written once. A page with no rows to publish passes no
// `csvHref`: a download that holds only the header row reads as a broken export.
export default function PintIndexScreen({
  title,
  lede,
  csvHref,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  csvHref?: string;
  children?: ReactNode;
}) {
  return (
    <Screen
      as="section"
      className="pintIndexScreen"
      kicker="Pint Index"
      title={title}
      titleId="pintIndexHeading"
      lede={lede}
      primary={<Link prefetch={false} href="/map">Open the map</Link>}
      secondary={
        csvHref ? (
          <a href={csvHref} download>
            Download the CSV
          </a>
        ) : undefined
      }
    >
      {children}
    </Screen>
  );
}
