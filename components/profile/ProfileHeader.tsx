"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import ProfileSocialLinks from "@/components/profile/ProfileSocialLinks";
import { displayHandle } from "@/lib/handleDisplay";
import { computeBadges, type Badge, type Profile, type ProfileDrop, type ProfileStats } from "@/lib/profiles";
import type { PublicSocialLink } from "@/lib/socialConnections";

type ProfileHeaderProps = {
  profile: Profile;
  stats: ProfileStats;
  socialLinks?: readonly PublicSocialLink[];
  crawls?: number;
  memories?: number;
  followers?: number;
  following?: number;
  drops?: readonly ProfileDrop[];
  actions?: ReactNode;
};

function initialOf(name: string, handle: string): string {
  const source = name.trim() || handle.trim();
  return (source.charAt(0) || "?").toUpperCase();
}

/**
 * One statistic and the surface it counts. The visible text stays the bare
 * label and figure, so the grid still scans as a grid; the accessible name
 * carries where the tap goes, because "14" read aloud on its own is not a
 * destination.
 */
function ProfileStatTile({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number | string;
  href: string;
  hint: string;
}) {
  return (
    <div className="profileStat">
      {/* data-pressable is how an anchor joins the ONE shared press-scale owner
          in globals.css; a local transform here would compound with it. */}
      <Link
        className="profileStatLink"
        data-pressable
        href={href}
        aria-label={`${label}: ${value}. ${hint}.`}
      >
        <dt>{label}</dt>
        <dd>{value}</dd>
      </Link>
    </div>
  );
}

function formatGbp(value: number | null): string {
  return value == null ? "–" : `£${value.toFixed(2)}`;
}

/**
 * The three things a person says about themselves, in the order a stranger
 * reads them: what they drink, what they are into, where they work. Each is
 * optional and prints only when its owner filled it in - an absent line says
 * nothing rather than inviting the reader to guess.
 */
function cardFacts(profile: Profile): Array<{ id: string; label: string; value: string }> {
  return [
    { id: "drink", label: "Drinks", value: profile.favouriteDrink ?? "" },
    { id: "into", label: "Into", value: profile.interests ?? "" },
    { id: "work", label: "Works at", value: profile.workplace ?? "" },
  ].filter((fact) => fact.value.trim().length > 0);
}

export default function ProfileHeader({
  profile,
  stats,
  socialLinks,
  crawls,
  memories,
  followers,
  following,
  drops,
  actions,
}: ProfileHeaderProps) {
  const { handle, displayName, homeCity, bio, avatarUrl, coverUrl } = profile;
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const showAvatar = Boolean(avatarUrl) && failedAvatarUrl !== avatarUrl;
  const showCover = Boolean(coverUrl) && failedCoverUrl !== coverUrl;
  const facts = cardFacts(profile);
  // Tiles link within this profile, so /u/you keeps its own sentinel route
  // rather than bouncing a signed-in reader to a handle they have not claimed.
  const profileBase = `/u/${encodeURIComponent(handle)}`;

  const crawlsPosted =
    typeof crawls === "number" ? crawls : stats.crawlsPosted ?? 0;
  const memoriesPosted =
    typeof memories === "number" ? memories : stats.memoriesPosted ?? 0;

  const earnedBadges: Badge[] = computeBadges(drops, stats).filter((b) => b.earned);

  return (
    <header className={`profileHeader${showCover ? " profileHeaderWithCover" : ""}`}>
      {/* The backdrop. An unfilled slot keeps the brass treatment, so an
          initials-era profile still reads as a card rather than a gap. */}
      <div className="profileCover" aria-hidden="true">
        {showCover ? (
          <Image
            className="profileCoverImage"
            src={coverUrl!}
            alt=""
            width={1600}
            height={533}
            unoptimized
            priority
            onError={() => setFailedCoverUrl(coverUrl ?? null)}
          />
        ) : null}
        <span className="profileCoverFalloff" />
      </div>

      <div className="profileIdentity">
        {showAvatar ? (
          <Image
            className="profileAvatar"
            src={avatarUrl!}
            alt=""
            width={88}
            height={88}
            unoptimized
            onError={() => setFailedAvatarUrl(avatarUrl ?? null)}
          />
        ) : (
          <div className="profileAvatar profileAvatarFallback" aria-hidden="true">
            {initialOf(displayName, handle)}
          </div>
        )}

        <div className="profileNames">
          <h1 className="profileDisplayName">{displayName}</h1>
          <p className="profileHandle">{displayHandle(handle)}</p>
          {homeCity ? (
            <p className="profileHomeCity">
              <span aria-hidden="true">📍 </span>
              {homeCity}
            </p>
          ) : null}
        </div>

        {actions ? <div className="profileActions">{actions}</div> : null}
      </div>

      {bio ? <p className="profileBio">{bio}</p> : null}

      {facts.length ? (
        <dl className="profileCardFacts">
          {facts.map((fact) => (
            <div key={fact.id} className={`profileCardFact profileCardFact--${fact.id}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <ProfileSocialLinks links={socialLinks ?? []} />

      {earnedBadges.length ? (
        <ul className="profileBadges" aria-label="Badges earned">
          {earnedBadges.map((badge) => (
            <li
              key={badge.id}
              className="profileBadge"
              title={`${badge.label}: ${badge.description}`}
            >
              <span aria-hidden="true" className="profileBadgeDot" />
              <span className="profileBadgeLabel">{badge.label}</span>
              <span className="profileBadgeDesc">{badge.description}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Every tile is a way in. A statistic that counts something the page can
          show, and does not link to it, is a dead end wearing a number: the
          reader has been told they have 14 followers and given no way to see
          one. The destinations are real surfaces, so a tile never navigates to
          a promise. */}
      <dl className="profileStats" aria-label="Profile statistics">
        <ProfileStatTile
          label="Pints logged"
          value={stats.pintsLogged}
          href={`${profileBase}#timeline`}
          hint="Open the pint timeline"
        />
        <ProfileStatTile
          label="Cheapest pint"
          value={formatGbp(stats.cheapestPintGbp)}
          href={`${profileBase}#timeline`}
          hint="Open the pint timeline"
        />
        {typeof followers === "number" ? (
          <ProfileStatTile
            label="Followers"
            value={followers}
            href={`${profileBase}/people/followers`}
            hint="See who follows this handle"
          />
        ) : null}
        {typeof following === "number" ? (
          <ProfileStatTile
            label="Following"
            value={following}
            href={`${profileBase}/people/following`}
            hint="See who this handle follows"
          />
        ) : null}
        <ProfileStatTile
          label="Crawls"
          value={crawlsPosted}
          href={`${profileBase}#crawl-stories`}
          hint="Open the published crawls"
        />
        <ProfileStatTile
          label="Memories"
          value={memoriesPosted}
          href={`${profileBase}#night-memories`}
          hint="Open night memories"
        />
      </dl>
    </header>
  );
}
