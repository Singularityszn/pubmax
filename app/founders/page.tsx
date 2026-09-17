// The founders wall: the first hundred claimed handles, numbered.
//
// A server read, like /contributors beside it, because the list is public and a
// reader should not have to wait for a second request to see a page that is
// nothing but a list. The projection is the public one - number, handle, name,
// approved avatar - and it comes from the same store read the public API route
// uses, so the page and the route can never disagree about who is on the wall.
//
// What is NOT here: a way in. There is no "claim yours" button, no counter
// urging a stranger to hurry, and no hint of what a number is worth, because it
// is worth nothing but the record. See `lib/foundingMembers.ts`.

import type { Metadata } from "next";
import Link from "next/link";

import FoundingMemberMark from "@/components/founding/FoundingMemberMark";
import SiteNav from "@/components/nav/SiteNav";
import HandleAvatar from "@/components/profile/HandleAvatar";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import {
  FOUNDERS_WALL_EMPTY,
  FOUNDERS_WALL_LEDE,
  FOUNDERS_WALL_TITLE,
  FOUNDERS_WALL_UNAVAILABLE,
  FOUNDING_MEMBER_CAP,
  foundingSlotsRemainingLine,
  isFoundingMemberNumber,
} from "@/lib/foundingMembers";
import { displayHandle } from "@/lib/handleDisplay";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
} from "@/lib/profileStore";

import styles from "./Founders.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "The first hundred",
  description:
    "The first hundred people to claim a PUBMAXX handle, by number. No perks, nothing gated.",
  alternates: { canonical: "/founders" },
};

type WallEntry = {
  number: number;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

type Wall =
  | { status: "ready"; members: WallEntry[] }
  | { status: "unavailable" };

async function readWall(): Promise<Wall> {
  try {
    const rows = await profileStore().listFoundingMembers();
    const members = rows
      .filter(
        (row) =>
          isFoundingMemberNumber(row.foundingMemberNumber) &&
          Boolean(row.userId) &&
          !isProfileTombstoned(row),
      )
      .map((row) => {
        const avatarUrl = publicOwnedImageUrl(row, "avatar");
        return {
          number: row.foundingMemberNumber!,
          handle: row.handle,
          ...(row.displayName ? { displayName: row.displayName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
        } satisfies WallEntry;
      })
      .sort((a, b) => a.number - b.number)
      .slice(0, FOUNDING_MEMBER_CAP);
    return { status: "ready", members };
  } catch {
    // A read that failed is not an empty wall. Saying "nobody yet" here would
    // tell a founding member their own number had gone.
    return { status: "unavailable" };
  }
}

export default async function FoundersPage(): Promise<React.JSX.Element> {
  const wall = await readWall();

  return (
    <div className={styles.foundersPage}>
      <SiteNav active="profile" />
      {/* The launch head (docs/design/LAUNCH_SCREENS.md). The one primary is
          the map, which is not a way onto the wall: the rule above holds. */}
      <Screen
        as="main"
        id="main"
        className={styles.foundersMain}
        kicker="Founding members"
        title={FOUNDERS_WALL_TITLE}
        titleId="founders-title"
        lede={FOUNDERS_WALL_LEDE}
        primary={<Link prefetch={false} href="/map">Open the map</Link>}
        secondary={<Link prefetch={false} href="/social">Find your lot</Link>}
      >
        {wall.status === "ready" && wall.members.length ? (
          <p className={styles.foundersCount}>
            {foundingSlotsRemainingLine(wall.members.length)}
          </p>
        ) : null}

        {wall.status === "unavailable" ? (
          <div role="status">
            <EmptyState title={FOUNDERS_WALL_UNAVAILABLE} />
          </div>
        ) : wall.members.length === 0 ? (
          <EmptyState title={FOUNDERS_WALL_EMPTY} />
        ) : (
          <ol className={styles.foundersList} aria-label="Founding members by number">
            {wall.members.map((member) => (
              <li key={member.number} className={styles.foundersRow}>
                <span className={styles.foundersNumber} aria-hidden="true">
                  {member.number}
                </span>
                <HandleAvatar
                  handle={member.handle}
                  avatarUrl={member.avatarUrl}
                  displayName={member.displayName}
                  className={styles.foundersAvatar}
                  imageClassName={`${styles.foundersAvatar} ${styles.foundersAvatarImage}`}
                  size={44}
                />
                <span className={styles.foundersWho}>
                  <Link
                    className={styles.foundersHandle}
                    href={`/u/${encodeURIComponent(member.handle)}`}
                  >
                    {member.displayName || displayHandle(member.handle)}
                  </Link>
                  {member.displayName ? (
                    <span className={styles.foundersSubHandle}>
                      {displayHandle(member.handle)}
                    </span>
                  ) : null}
                </span>
                <FoundingMemberMark
                  number={member.number}
                  className={`foundingMarkBare ${styles.foundersRowMark}`}
                />
              </li>
            ))}
          </ol>
        )}
      </Screen>
    </div>
  );
}
