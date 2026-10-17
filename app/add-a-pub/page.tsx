import type { Metadata } from "next";

import SiteNav from "@/components/nav/SiteNav";
import AddPubForm from "@/components/venueSubmission/AddPubForm";
import Screen from "@/components/ui/screen";
import { cleanText } from "@/lib/textClean";
import { VENUE_SUBMISSION_NAME_MAX } from "@/lib/venueSubmissions";

// /add-a-pub: a signed-in drinker names a pub the map does not have, with its
// menu and the prices they saw if they have them. A form screen, so the head
// paints no primary and the form's own send carries it
// (docs/design/LAUNCH_SCREENS.md). The search and Pubs to try no-match states
// link here with the typed name in `?name=`, so the reader never types it twice.
//
// It is a private form, never a landing: not indexed, and nothing on it is a
// venue until a person has checked it.

export const metadata: Metadata = {
  title: "Add a pub",
  description: "Tell PUBMAXX about a pub that isn't on the map, with its menu and prices if you have them.",
  robots: { index: false, follow: false },
};

type AddPubPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AddPubPage({ searchParams }: AddPubPageProps): Promise<React.JSX.Element> {
  const params = (await searchParams) ?? {};
  const rawName = Array.isArray(params.name) ? params.name[0] : params.name;
  const initialName = cleanText(rawName, VENUE_SUBMISSION_NAME_MAX);

  return (
    <main id="main" className="addPubShell">
      <SiteNav />

      <Screen
        as="section"
        className="addPubScreen"
        kicker="Add a pub"
        title="Know a pub we're missing?"
        titleId="add-pub-title"
        lede="Tell us where it is. Add its menu or a few prices if you have them. We check every pub before it goes on the map."
      >
        <AddPubForm initialName={initialName} primaryAction />
      </Screen>
    </main>
  );
}
