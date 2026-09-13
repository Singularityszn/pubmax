"use client";

import Link from "next/link";

import { useSocialSurfaceName } from "@/lib/useSocialFriendsLaunch";

import "./firstActionsRow.css";

// The genuine missing piece on a fresh owner's own profile: real, plain links
// to the actions the page otherwise makes them go hunting for. No surface-nav
// wiring - these are ordinary <Link>s, styled to match YourContributionsCard's
// pill rhythm, placed above the tabs so a fresh owner sees them before anything
// else. Social is not a dock tab, so the signed-in You hub is its phone door,
// named for the launch state.

export default function FirstActionsRow() {
  const socialLabel = useSocialSurfaceName();
  return (
    <section className="firstActionsRow" aria-labelledby="first-actions-title">
      <p className="firstActionsKicker" id="first-actions-title">Where to start</p>
      <div className="firstActionsLinks">
        <Link className="firstActionsLink" href="/map">
          Open the map
        </Link>
        <Link className="firstActionsLink" href="/map?log=1">
          Log your first pint
        </Link>
        <Link className="firstActionsLink" href="/plan">
          Start a plan
        </Link>
        <Link className="firstActionsLink" href="/social">
          {socialLabel}
        </Link>
      </div>
    </section>
  );
}
