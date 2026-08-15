import type { Metadata } from "next";

import { identityHandleStore } from "@/lib/identityHandleStore";
import { normalizeHandle } from "@/lib/profiles";

import ProfilePageClient from "./ProfilePageClient";

// Public profile route /u/[handle]. Server shell: it owns the page metadata
// (so a shared profile shows the handle, not the generic site title) and hands
// off to the client ProfilePageClient, which owns every fetch + localStorage
// read. The OG share card is supplied by the file-convention opengraph-image.tsx
// in this folder, so generateMetadata deliberately sets NO openGraph.images —
// Next merges the file-convention image in automatically.
//
// PRIVACY: metadata resolves only the public handle alias. It never fetches
// drops, saves, or the follow graph, so title/description cannot leak anything
// beyond the public profile identity. "you" is the viewer's own sentinel route
// (it redirects to their real handle client-side), so it is noindex - it is a
// per-viewer surface, not a public profile.

const YOU_SENTINEL = "you";

type PageProps = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const handle = normalizeHandle((await params).handle);

  // Missing / unusable handle, or the per-viewer "you" sentinel: keep it out of
  // search. Neither is a stable public profile URL worth indexing.
  if (!handle || handle === YOU_SENTINEL) {
    return {
      title: "Your profile",
      description: "Your PUBMAXX identity: your Pint Drops, saved venues, and crawls.",
      robots: { index: false, follow: false },
    };
  }

  // Handle aliases are public identity data. Resolve them before emitting
  // canonical and social URLs so a retired handle does not create a second
  // indexable profile document or share stale attribution.
  const resolution = await identityHandleStore()
    .resolve(handle)
    .catch(() => null);
  const canonicalHandle = normalizeHandle(resolution?.currentHandle) || handle;

  const title = `@${canonicalHandle}`;
  const description = `@${canonicalHandle}'s pint passport on PUBMAXX. Their Pint Drops, saved venues, and the crawls they've walked.`;
  const url = `/u/${canonicalHandle}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "profile",
      siteName: "PUBMAXX",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function ProfilePage({ params }: PageProps) {
  return <ProfilePageClient params={params} />;
}
