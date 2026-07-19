"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSyncExternalStore } from "react";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import { readPreferredCity, subscribePreferredCity } from "@/lib/cityPreference";
import { DEFAULT_CITY_ID } from "@/lib/cities";

import NearMeNow from "./NearMeNow";
import "./nearPage.css";

export default function NearPageClient() {
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const cityId = preferredCity ?? DEFAULT_CITY_ID;

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
        <NearMeNow cityId={cityId} autoLocate />
      </main>
    </div>
  );
}
