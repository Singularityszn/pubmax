import type { Metadata } from "next";

import SiteNav from "@/components/nav/SiteNav";
import { sharedInputFromRecord, sharedPasteFrom } from "@/lib/nativeShareTarget";

import ShareToWanted from "./ShareToWanted";
import "./share.css";

// The share target (public/manifest.webmanifest `share_target`, and the native
// shells through `pubmaxx://share`). Another app hands us `title`, `text` and
// `url`; this page turns them into one paste and opens the Wanted paste flow
// with it. The shared URL is TEXT here: this page never fetches it, and the
// Wanted resolver behind the Find button matches names and never fetches it
// either (lib/nativeShareTarget.ts).

export const metadata: Metadata = {
  title: "Save a pub to try",
  description: "Save a pub someone shared with you to your pubs to try.",
  robots: { index: false, follow: false },
};

type SharePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SharePage({ searchParams }: SharePageProps) {
  const sharedPaste = sharedPasteFrom(sharedInputFromRecord(await searchParams));
  return (
    <div className="lp sharePage">
      <SiteNav />
      <main id="main" className="container sharePageMain">
        <ShareToWanted sharedPaste={sharedPaste} />
      </main>
    </div>
  );
}
