"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";

import { displayHandle } from "@/lib/handleDisplay";
import { computeBadges, type Badge, type Profile, type ProfileDrop, type ProfileStats } from "@/lib/profiles";

type ProfileHeaderProps = {
  profile: Profile;
  stats: ProfileStats;
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

function formatGbp(value: number | null): string {
  return value == null ? "–" : `£${value.toFixed(2)}`;
}

export default function ProfileHeader({
  profile,
  stats,
  crawls,
  memories,
  followers,
  following,
  drops,
  actions,
}: ProfileHeaderProps) {
  const { handle, displayName, homeCity, bio, avatarUrl } = profile;
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const showAvatar = Boolean(avatarUrl) && failedAvatarUrl !== avatarUrl;

  const crawlsPosted =
    typeof crawls === "number" ? crawls : stats.crawlsPosted ?? 0;
  const memoriesPosted =
    typeof memories === "number" ? memories : stats.memoriesPosted ?? 0;

  const earnedBadges: Badge[] = computeBadges(drops, stats).filter((b) => b.earned);

  return (
    <header className="profileHeader">
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

      <dl className="profileStats" aria-label="Profile statistics">
        <div className="profileStat">
          <dt>Pints logged</dt>
          <dd>{stats.pintsLogged}</dd>
        </div>
        <div className="profileStat">
          <dt>Cheapest pint</dt>
          <dd>{formatGbp(stats.cheapestPintGbp)}</dd>
        </div>
        {typeof followers === "number" ? (
          <div className="profileStat">
            <dt>Followers</dt>
            <dd>{followers}</dd>
          </div>
        ) : null}
        {typeof following === "number" ? (
          <div className="profileStat">
            <dt>Following</dt>
            <dd>{following}</dd>
          </div>
        ) : null}
        <div className="profileStat">
          <dt>Crawls</dt>
          <dd>{crawlsPosted}</dd>
        </div>
        <div className="profileStat">
          <dt>Memories</dt>
          <dd>{memoriesPosted}</dd>
        </div>
      </dl>
    </header>
  );
}
