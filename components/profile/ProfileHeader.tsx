"use client";

import Image from "next/image";
import type { ReactNode } from "react";

import type { Profile, ProfileStats } from "@/lib/profiles";

// Presentational header for a public profile. Prop-driven and stateless — the
// page owns all data. Renders an avatar (image or a fallback initial), the
// display name + @handle, optional home city and bio, a stats row (including
// durable follower/following counts), and an optional actions slot (the page
// drops the follow button here so the header stays purely presentational).
type ProfileHeaderProps = {
  profile: Profile;
  stats: ProfileStats;
  // Crawls are demo/0 for now — the page passes it explicitly so the header
  // stays purely presentational.
  crawls?: number;
  followers?: number;
  following?: number;
  actions?: ReactNode;
};

function initialOf(name: string, handle: string): string {
  const source = name.trim() || handle.trim();
  return (source.charAt(0) || "?").toUpperCase();
}

function formatGbp(value: number | null): string {
  return value == null ? "—" : `£${value.toFixed(2)}`;
}

export default function ProfileHeader({
  profile,
  stats,
  crawls = 0,
  followers,
  following,
  actions,
}: ProfileHeaderProps) {
  const { handle, displayName, homeCity, bio, avatarUrl } = profile;

  return (
    <header className="profileHeader">
      <div className="profileIdentity">
        {avatarUrl ? (
          <Image
            className="profileAvatar"
            src={avatarUrl}
            alt=""
            width={88}
            height={88}
            unoptimized
          />
        ) : (
          <div className="profileAvatar profileAvatarFallback" aria-hidden="true">
            {initialOf(displayName, handle)}
          </div>
        )}

        <div className="profileNames">
          <h1 className="profileDisplayName">{displayName}</h1>
          <p className="profileHandle">@{handle}</p>
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
          <dd>{crawls}</dd>
        </div>
      </dl>
    </header>
  );
}
