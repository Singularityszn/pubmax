"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Suspense, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import { readPreferredCity, subscribePreferredCity } from "@/lib/cityPreference";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { resolveNightPatch } from "@/lib/nightPatches";

import NearMeNow from "./NearMeNow";
import "./nearPage.css";

function NearPageBody() {
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const cityId = preferredCity ?? DEFAULT_CITY_ID;
  const searchParams = useSearchParams();
  const patchParam = searchParams.get("patch");
  const initialPatchId = resolveNightPatch(patchParam)?.id ?? null;

  return (
    <div className="nmnPage">
      <header className="nmnPageNav">
        <div className="nmnPageNavPill">
          <Link href="/" className="nmnPageBack" aria-label="Back to home">
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
          <Link href="/" className="nmnPageBrand" aria-label="PUBMAXXING home">
            <PubmaxxWordmark />
          </Link>
        </div>
      </header>
      <main className="nmnPageBody">
        {/* Idle-first on /near so patch chips are reachable without granting
            location. Shareable ?patch= deep links answer immediately. */}
        <NearMeNow
          cityId={cityId}
          autoLocate={false}
          initialPatchId={initialPatchId}
          syncPatchToUrl
        />
      </main>
    </div>
  );
}

export default function NearPageClient() {
  return (
    <Suspense fallback={<div className="nmnPage" aria-busy="true" />}>
      <NearPageBody />
    </Suspense>
  );
}
