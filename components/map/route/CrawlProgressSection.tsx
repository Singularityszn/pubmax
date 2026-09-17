"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { Check, Footprints } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { CrawlProgressEntry } from "@/lib/crawlCompletion";
import btnStyles from '../addStopBtn.module.css';
import rpStyles from '@/components/map/routePanel.module.css';

type CrawlProgressSectionProps = {
  crawlProgress: CrawlProgressEntry | null;
  crawlDone: boolean;
  showCelebration: boolean;
  setShowCelebration: (show: boolean) => void;
  handleStartCrawl: () => void;
  handleMarkComplete: () => void;
  paceLabel: string;
  placeStoryBandId: string | undefined;
  dropHref: string;
  shareMapHref: string;
};

export default function CrawlProgressSection({
  crawlProgress,
  crawlDone,
  showCelebration,
  setShowCelebration,
  handleStartCrawl,
  handleMarkComplete,
  paceLabel,
  placeStoryBandId,
  dropHref,
  shareMapHref,
}: CrawlProgressSectionProps) {
  const [shareCopied, setShareCopied] = useState(false);
  const [shareCopyError, setShareCopyError] = useState("");

  async function copyShareLink() {
    const absolute =
      typeof window !== "undefined"
        ? `${window.location.origin}${shareMapHref}`
        : shareMapHref;
    setShareCopyError("");
    try {
      await navigator.clipboard.writeText(absolute);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      setShareCopyError(
        offlineOrMessage("Could not copy link. Try again.")
      );
    }
  }

  return (
    <div className={rpStyles.crawlProgressRow} data-testid="crawl-progress">
      {!crawlProgress ? (
        <button type="button" className={btnStyles.addStopBtn} onClick={handleStartCrawl}>
          <Footprints size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Start this crawl
        </button>
      ) : crawlDone ? (
        <p className={rpStyles.crawlProgressDone} role="status">
          Crawl complete: {crawlProgress.visited.length}/{crawlProgress.stopIds.length} stops
        </p>
      ) : (
        <>
          <p className={rpStyles.crawlProgressStatus} role="status">
            {paceLabel} · {crawlProgress.visited.length}/{crawlProgress.stopIds.length} stops
          </p>
          <button type="button" className={btnStyles.addStopBtn} onClick={handleMarkComplete}>
            <Check size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
            Mark complete
          </button>
        </>
      )}
      {showCelebration ? (
        <div
          className={rpStyles.crawlCelebration}
          role="status"
          data-testid="crawl-celebration"
        >
          <p className={rpStyles.crawlCelebrationTitle}>You walked it</p>
          <p className={rpStyles.crawlCelebrationCopy}>
            {placeStoryBandId
              ? "Place story complete. Drop a memory, share the route, or stamp your passport."
              : "Crawl complete. Drop a memory, share the route, or stamp your passport."}
          </p>
          <div className={rpStyles.crawlCelebrationActions}>
            <Link className={rpStyles.crawlCelebrationLink} href={dropHref}>
              Drop a pint
            </Link>
            <button
              type="button"
              className={`${rpStyles.crawlCelebrationLink} ${rpStyles.crawlCelebrationCopyBtn}`}
              onClick={() => void copyShareLink()}
              data-testid="crawl-share-copy"
            >
              {shareCopied ? "Link copied" : "Copy link"}
            </button>
            {shareCopyError ? <p role="status">{shareCopyError}</p> : null}
            <Link
              className={rpStyles.crawlCelebrationLink}
              href={shareMapHref}
              data-testid="crawl-share-open"
            >
              Open shared crawl
            </Link>
            <Link className={rpStyles.crawlCelebrationLink} href="/u/you">
              View passport
            </Link>
          </div>
          <button
            type="button"
            className={rpStyles.crawlCelebrationDismiss}
            onClick={() => setShowCelebration(false)}
          >
            Not now
          </button>
        </div>
      ) : null}
    </div>
  );
}
