"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import HandleAvatar from "@/components/profile/HandleAvatar";
import { displayHandle, handleOnly } from "@/lib/handleDisplay";

/**
 * The signed-in account card in the nav.
 *
 * It names the person PUBMAXX knows: their face, their display name and their
 * @handle, then the three places they actually go. The email address is account
 * plumbing, so it sits last and quiet rather than standing in for a name. A
 * person with no claimed handle yet gets the same card pointed at /u/you, which
 * is where they claim one.
 */
export default function AccountMenu({
  id,
  menuRef,
  name,
  handle,
  email,
  avatarUrl,
  signOutDisabled,
  onSignOut,
  onNavigate,
  extraControls,
}: {
  id: string;
  menuRef?: React.Ref<HTMLDivElement>;
  name: string;
  handle: string | null;
  email?: string;
  avatarUrl?: string;
  signOutDisabled?: boolean;
  onSignOut: () => void;
  onNavigate?: () => void;
  extraControls?: ReactNode;
}): React.JSX.Element {
  const profilePath = handle ? `/u/${handleOnly(handle)}` : "/u/you";
  return (
    <div className="authMenu authAccountMenu" id={id} aria-label="Account options" ref={menuRef}>
      <div className="authAccountCard">
        <HandleAvatar
          handle={handle ?? ""}
          avatarUrl={avatarUrl}
          displayName={name}
          className="authAccountAvatar authAccountAvatarFallback"
          imageClassName="authAccountAvatar"
          size={44}
        />
        <span className="authAccountCardText">
          <span className="authAccountName">{name}</span>
          <span className="authAccountHandle">
            {handle ? displayHandle(handle) : "Claim your @handle"}
          </span>
        </span>
      </div>

      <nav className="authAccountLinks" aria-label="Your pages">
        <Link href={profilePath} onClick={onNavigate}>
          Your profile
        </Link>
        <Link href={`${profilePath}#wanted`} onClick={onNavigate}>
          Your Wanteds
        </Link>
        <Link href={`${profilePath}?edit=1`} onClick={onNavigate}>
          Edit profile
        </Link>
      </nav>

      {email ? <p className="authAccountEmail">{email}</p> : null}

      <button
        type="button"
        className="authSignOut"
        onClick={onSignOut}
        disabled={signOutDisabled}
      >
        Sign out
      </button>
      {extraControls}
    </div>
  );
}
