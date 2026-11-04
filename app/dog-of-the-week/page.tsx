import type { Metadata } from "next";
import Link from "next/link";

import DogOfTheWeekBody from "@/components/drink-wall/DogOfTheWeekBody";
import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { metadataSiteName } from "@/lib/brandNaming";
import { DOG_OF_THE_WEEK_PATH, DOG_OF_THE_WEEK_TITLE } from "@/lib/dogOfTheWeek";
import { loadDogOfTheWeek } from "@/lib/dogOfTheWeek.server";

// Dog of the week (launch review F7). The photo wall's newest approved Dog
// photo, read at request time, because a photo can be approved, reported or
// deleted at any moment. Public, and indexed the way /wall is: /wall carries
// no robots rule, so neither does this. Like /wall it is user content, so the
// sitemap does not advertise it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DESCRIPTION = "The newest dog met at a London pub, from the PUBMAXX photo wall.";

export const metadata: Metadata = {
  title: DOG_OF_THE_WEEK_TITLE,
  description: DESCRIPTION,
  alternates: { canonical: DOG_OF_THE_WEEK_PATH },
  openGraph: {
    title: DOG_OF_THE_WEEK_TITLE,
    description: DESCRIPTION,
    type: "website",
    url: DOG_OF_THE_WEEK_PATH,
    siteName: metadataSiteName(),
  },
  twitter: {
    card: "summary_large_image",
    title: DOG_OF_THE_WEEK_TITLE,
    description: DESCRIPTION,
  },
};

export default async function DogOfTheWeekPage() {
  const read = await loadDogOfTheWeek();
  return (
    <div className="dogOfTheWeekPage">
      <SiteNav />
      <main id="main" className="dogOfTheWeekMain">
        <Screen
          as="section"
          kicker="Photo wall"
          title={DOG_OF_THE_WEEK_TITLE}
          titleId="dog-of-the-week-title"
          secondary={<Link href="/wall">See the photo wall</Link>}
          actionsAfterContent
        >
          <DogOfTheWeekBody read={read} />
        </Screen>
      </main>
    </div>
  );
}
