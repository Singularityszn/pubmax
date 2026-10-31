import type { Metadata } from "next";
import Link from "next/link";

import IntentLink from "@/components/nav/IntentLink";
import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { londonDayKey } from "@/lib/pintContributions";
import {
  parseYearShare,
  yearShareCardPath,
  yearShareHeading,
  yearShareLines,
  yearShareSpan,
  type YearShare,
} from "@/lib/yearInPints";
import { yearShareVenueNames } from "@/lib/yearInPints.server";

import YearGlass from "./YearGlass";
import "./yearInPints.css";

// A shared Year in Pints: /year-in-pints/[year]?to=..&n=.. (lib/yearInPints.ts).
// The page reads the link and nothing else. The link holds only the lines the
// person ticked on /pal, so this page can show nothing they did not choose:
// no handle, no account and no Pal. A pub is named from the venue dataset,
// never from the link. It is a person's own year, so it is never indexed,
// and it ends on the door to the reader's own year, which is free forever.
// When the nights line was ticked, the pint glass of days stands above the
// lines (YearGlass.tsx), drawn from that count and nothing else.

type Search = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ year: string }>; searchParams: Promise<Search> };

const DESCRIPTION = "A year of nights out, read back on PUBMAXX.";

function firstValues(search: Search): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") params.set(key, first);
  }
  return params;
}

async function readShare({ params, searchParams }: Props): Promise<YearShare | null> {
  const [{ year }, search] = await Promise.all([params, searchParams]);
  return parseYearShare(year, firstValues(search), londonDayKey(new Date()));
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const share = await readShare(props);
  const title = share ? yearShareHeading(share) : "A Year in Pints";
  const image = share ? yearShareCardPath(share) : "/api/year-card";
  return {
    title,
    description: DESCRIPTION,
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description: DESCRIPTION,
      type: "article",
      images: [{ url: image, width: 1200, height: 630, alt: `${title}, a Year in Pints card` }],
    },
    twitter: { card: "summary_large_image", title, description: DESCRIPTION, images: [image] },
  };
}

export default async function YearInPintsPage(props: Props) {
  const share = await readShare(props);
  const lines = share ? yearShareLines(share, await yearShareVenueNames(share)) : [];

  return (
    <main id="main" className="yipPage">
      <SiteNav />
      <Screen
        className="yipScreen"
        kicker="Year in Pints"
        title={share ? yearShareHeading(share) : "A Year in Pints"}
        titleId="yip-title"
        lede={share ? yearShareSpan(share) : "This link holds no year we can read."}
        actionsAfterContent
        primary={<IntentLink href="/pal">Read your own year</IntentLink>}
        secondary={<Link href="/">Find a pint tonight</Link>}
      >
        {lines.length > 0 ? (
          <>
            {share?.nights !== undefined ? (
              <YearGlass year={share.year} through={share.through} nights={share.nights} />
            ) : null}
            <ol className="yipLines" data-testid="year-share-lines">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            <p className="yipNote">They chose these lines. Nothing else came with the link.</p>
          </>
        ) : (
          <p className="yipNote">
            Your Pub Pal reads your year back: the nights you kept, the stops you walked and the prices you mapped. Free, always.
          </p>
        )}
      </Screen>
    </main>
  );
}
