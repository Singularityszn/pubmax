import { notFound } from "next/navigation";
import type { Metadata } from "next";

import SiteNav from "@/components/nav/SiteNav";
import SavedListDetail from "@/components/profile/SavedListDetail";
import { formatSavedVenueCount } from "@/lib/savedListPresentation";
import { readPublicSavedList, savedListCover } from "@/lib/savedListShare.server";
import { savedListPath } from "@/lib/savedListUrl";
import { isSocialFriendsLaunchEnabled, SOCIAL_FRIENDS_LAUNCH_ENV } from "@/lib/socialLaunch";
import { savedListFollowsStore, type SavedPubDTO } from "@/lib/savedPubsStore";

import SavedListCover from "./SavedListCover";
import "../../profile.css";

export const dynamic = "force-dynamic";

type PageParams = {
  handle: string;
  listType: string;
};

type PageProps = {
  params: Promise<PageParams>;
};

type SavedListDisplayCounts = {
  followers: number | null;
  savedPubs: number;
};

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { handle, listType: rawListType } = await params;
  const read = await readPublicSavedList(handle, rawListType);
  // A private account's list is the same not-found as the page.
  if (read.status === "hidden") notFound();
  if (read.status === "invalid") {
    return {
      title: "Saved list",
      robots: { index: false, follow: false },
    };
  }

  const { ownerHandle, listType, venues } = read;
  const listCounts = isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])
    ? await savedListFollowsStore().counts(ownerHandle, listType)
    : null;
  const counts: SavedListDisplayCounts = {
    followers: listCounts?.followers ?? null,
    savedPubs: venues.length,
  };
  const title = `@${ownerHandle}'s ${listType}`;
  const description = `@${ownerHandle}'s ${listType} saved list on PUBMAXX. ${formatSavedVenueCount(
    counts.savedPubs,
  )}${counts.followers === null ? "." : `, ${plural(counts.followers, "follower")}.`}`;

  // The picture is the sibling opengraph-image.tsx (the list name, the count
  // and five pubs with their plaques). File-based metadata outranks this
  // object, so naming an image here as well would only be a second answer.
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: savedListPath(ownerHandle, listType),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function SavedListPage({ params }: PageProps) {
  const { handle, listType: rawListType } = await params;
  const read = await readPublicSavedList(handle, rawListType);
  if (read.status === "hidden") notFound();

  const socialFriendsLaunchEnabled = isSocialFriendsLaunchEnabled(
    process.env[SOCIAL_FRIENDS_LAUNCH_ENV],
  );
  let counts: SavedListDisplayCounts = { followers: null, savedPubs: 0 };
  let venues: SavedPubDTO[] = [];

  if (read.status === "ok") {
    venues = read.venues;
    counts = {
      followers: socialFriendsLaunchEnabled
        ? (await savedListFollowsStore().counts(read.ownerHandle, read.listType)).followers
        : null,
      savedPubs: venues.length,
    };
  }
  const cover = read.status === "ok" ? await savedListCover(venues) : null;

  return (
    <div className="lp profilePage">
      <SiteNav active="profile" />
      <main id="main" className="container profileMain">
        {read.status === "invalid" ? (
          <p className="profileEmpty">That list link is missing a handle or list name.</p>
        ) : (
          <>
            <SavedListCover cover={cover} listType={read.listType} />
            {/* The head (name, count, owner, Follow list) is SavedListDetail's,
                and its Follow list control is the existing list-follow API. */}
            <SavedListDetail
              ownerHandle={read.ownerHandle}
              listType={read.listType}
              venues={venues}
              initialCounts={counts}
            />
          </>
        )}
      </main>
    </div>
  );
}
