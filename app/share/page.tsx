import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPinned, Navigation, Route, Search, Sparkles } from "lucide-react";

import SiteNav from "@/components/nav/SiteNav";
import { resolveShareTarget, type ShareTargetParams } from "@/lib/shareTarget";

import "./share.css";

type SharePageProps = {
  searchParams?: Promise<ShareTargetParams>;
};

export const metadata: Metadata = {
  title: "Share to PUBMAXX · PUBMAXXING",
  description: "Send a pub, map link, or PUBMAXX crawl link into the mobile app.",
  robots: { index: false, follow: false },
};

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = searchParams ? await searchParams : {};
  const decision = resolveShareTarget(params);

  return (
    <main className="shareTargetPage">
      <SiteNav />
      <section className="shareTargetHero" aria-labelledby="share-target-title">
        <p className="shareTargetEyebrow">Shared to PUBMAXX</p>
        <h1 id="share-target-title">{decision.title}</h1>
        <p>{decision.body}</p>
        <div className="shareTargetActions">
          <Link className="shareTargetPrimary pressable" href={decision.primaryHref}>
            {decision.kind === "map-query" ? <Search size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
            <span>{decision.primaryLabel}</span>
          </Link>
          {decision.sourceUrl && decision.kind !== "internal" ? (
            <a className="shareTargetSecondary pressable" href={decision.sourceUrl} target="_blank" rel="noreferrer">
              Source
            </a>
          ) : null}
        </div>
      </section>

      <section className="shareTargetStack" aria-label="Quick actions">
        <Link className="shareTargetTile" href="/near">
          <span className="shareTargetTileIcon" aria-hidden="true"><Navigation size={18} /></span>
          <span><strong>Near me</strong><small>Cheapest good pints within a short walk.</small></span>
        </Link>
        <Link className="shareTargetTile" href="/plan?source=share-target">
          <span className="shareTargetTileIcon" aria-hidden="true"><Route size={18} /></span>
          <span><strong>Make it a crawl</strong><small>Sort a shared pub into a three-stop night.</small></span>
        </Link>
        <Link className="shareTargetTile" href="/tonight">
          <span className="shareTargetTileIcon" aria-hidden="true"><Sparkles size={18} /></span>
          <span><strong>Tonight</strong><small>Events, deals, and live signals before you commit.</small></span>
        </Link>
        <Link className="shareTargetTile" href="/map">
          <span className="shareTargetTileIcon" aria-hidden="true"><MapPinned size={18} /></span>
          <span><strong>Full map</strong><small>Browse the price layer from scratch.</small></span>
        </Link>
      </section>
    </main>
  );
}
