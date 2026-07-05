"use client";

import Image from "next/image";
import Link from "next/link";
import { use, useEffect, useState } from "react";

import ProfileHeader from "@/components/profile/ProfileHeader";
import SavedPubList from "@/components/profile/SavedPubList";
import {
  deriveProfileFromDrops,
  normalizeHandle,
  profileStats,
  type ProfileDrop,
} from "@/lib/profiles";
import { savedByList, type ListType, type SavedPub } from "@/lib/savedPubs";

import "./profile.css";

// Public profile route /u/[handle]. Client/dynamic on purpose: no
// generateStaticParams, so the build never pre-renders every handle. It fetches
// the public Pint Drops feed, filters to this handle, synthesizes a demo
// profile, and renders the header, the handle's recent drops (photo-first), and
// their saved pubs (from localStorage). It NEVER crashes: a missing handle, a
// failed fetch, or an empty result all resolve to a friendly state.

// The public drop DTO — kept loose; only the fields this page reads are named.
type PublicDrop = ProfileDrop & {
  venueId: string;
  priceGbp?: number | null;
  pintPhotoUrl?: string | null;
  venuePhotoUrl?: string | null;
  passedDownNote?: string;
  drink?: string;
  era?: string;
  createdAt?: string;
};

type LoadState = "loading" | "ready" | "error";

function formatGbp(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `£${value.toFixed(2)}` : null;
}

export default function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  // Route params are a promise in the App Router; unwrap with `use`.
  const routeHandle = normalizeHandle(use(params)?.handle);

  const [drops, setDrops] = useState<PublicDrop[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  // Saved pubs live in localStorage (demo). Start empty so the server render
  // and the client's first (hydration) paint match, then fill in from storage
  // after mount. savedByList() guards `window`, so this only reads in the
  // browser.
  const [saved, setSaved] = useState<Partial<Record<ListType, SavedPub[]>>>({});

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch("/api/pint-drops", { signal: controller.signal });
        if (!res.ok) {
          setState("error");
          return;
        }
        const body: unknown = await res.json();
        const all: PublicDrop[] =
          body && typeof body === "object" && Array.isArray((body as { drops?: unknown }).drops)
            ? ((body as { drops: PublicDrop[] }).drops ?? [])
            : [];
        const mine = all.filter((d) => normalizeHandle(d.handle) === routeHandle);
        setDrops(mine);
        setState("ready");
      } catch {
        // An aborted fetch (unmount / handle change) is not an error state.
        if (controller.signal.aborted) return;
        setState("error");
      }
    }

    void load();
    return () => controller.abort();
  }, [routeHandle]);

  // Read saved pubs from localStorage once, client-side only. Done in an async
  // step (not the synchronous effect body) so hydration paints the empty server
  // state first, then swaps in the stored saves.
  useEffect(() => {
    let active = true;
    async function loadSaved() {
      const groups = savedByList();
      if (active) setSaved(groups);
    }
    void loadSaved();
    return () => {
      active = false;
    };
  }, []);

  const profile = deriveProfileFromDrops(routeHandle, drops as ProfileDrop[]);
  const stats = profileStats(drops as ProfileDrop[]);

  return (
    <div className="lp profilePage">
      <header className="profileTopbar">
        <div className="container profileTopbarInner">
          <Link className="profileWordmark lpSerif" href="/">
            PUBMAXXING
          </Link>
          <nav className="profileNav" aria-label="Primary">
            <Link href="/">Home</Link>
            <Link href="/map">Map</Link>
          </nav>
        </div>
      </header>

      <main className="container profileMain">
        {!routeHandle ? (
          <p className="profileEmpty">That profile link is missing a handle.</p>
        ) : state === "error" ? (
          <div className="profileErrorState">
            <ProfileHeader profile={profile} stats={stats} />
            <p className="profileEmpty">
              Couldn&apos;t load pints right now. Please try again in a moment.
            </p>
          </div>
        ) : (
          <>
            <ProfileHeader profile={profile} stats={stats} />

            <section className="profileDropsSection" aria-labelledby="dropsHeading">
              <h2 id="dropsHeading" className="profileSectionHeading">
                Recent Pint Drops
              </h2>

              {state === "loading" ? (
                <p className="profileEmpty">Loading pints…</p>
              ) : drops.length === 0 ? (
                <p className="profileEmpty">No pints logged under @{routeHandle} yet.</p>
              ) : (
                <ul className="profileDropsGrid">
                  {drops.map((drop, i) => {
                    const price = formatGbp(drop.priceGbp);
                    const photo = drop.pintPhotoUrl || drop.venuePhotoUrl || null;
                    const key = (drop.id as string | undefined) ?? `${drop.venueId}:${i}`;
                    return (
                      <li className="profileDropCard" key={key}>
                        {photo ? (
                          <div className="profileDropPhoto">
                            <Image
                              src={photo}
                              alt={drop.drink ? `${drop.drink} at ${drop.venueId}` : ""}
                              width={320}
                              height={220}
                              unoptimized
                            />
                          </div>
                        ) : (
                          <div className="profileDropPhoto profileDropPhotoEmpty" aria-hidden="true">
                            🍺
                          </div>
                        )}
                        <div className="profileDropBody">
                          <div className="profileDropTop">
                            <span className="profileDropVenue">{drop.venueId}</span>
                            {price ? <span className="profileDropPrice">{price}</span> : null}
                          </div>
                          {drop.passedDownNote ? (
                            <p className="profileDropNote">{drop.passedDownNote}</p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <SavedPubList groups={saved} />
          </>
        )}
      </main>
    </div>
  );
}
