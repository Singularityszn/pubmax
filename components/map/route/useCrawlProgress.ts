"use client";

import { useCallback, useEffect, useState } from "react";

import { announcePalMoment } from "@/lib/palMoments";
import type { Venue } from "@/lib/venues";
import {
  acknowledgeCrawlCompletion,
  isComplete,
  markCrawlComplete,
  readCrawl,
  startCrawl,
  type CrawlProgressEntry,
} from "@/lib/crawlCompletion";

export type CrawlProgressState = {
  crawlProgress: CrawlProgressEntry | null;
  showCelebration: boolean;
  setShowCelebration: (show: boolean) => void;
  crawlDone: boolean;
  handleStartCrawl: () => void;
  handleMarkComplete: () => void;
};

// Loop 2 crawl-completion stickiness — localStorage only. Owns crawlProgress +
// the one-shot celebration flag (Wave G2), claimed via acknowledgeCrawlCompletion.
export function useCrawlProgress(
  progressKey: string,
  route: Venue[],
  placeStoryBandId: string | undefined,
): CrawlProgressState {
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgressEntry | null>(null);
  // Wave G2: one-shot celebration after 100% — claimed via acknowledgeCrawlCompletion.
  const [celebratingCrawlKey, setCelebratingCrawlKey] = useState<string | null>(null);
  const showCelebration = celebratingCrawlKey === progressKey;

  function setShowCelebration(show: boolean) {
    setCelebratingCrawlKey(show ? progressKey : null);
  }

  const applyCompletionAck = useCallback((entry: CrawlProgressEntry | null) => {
    setCrawlProgress(entry);
    if (!progressKey || !isComplete(entry)) {
      setCelebratingCrawlKey(null);
      return;
    }
    const ack = acknowledgeCrawlCompletion(progressKey, { placeStoryBandId });
    setCelebratingCrawlKey((current) => ack.celebrate || current === progressKey ? progressKey : null);
  }, [progressKey, placeStoryBandId]);

  useEffect(() => {
    const entry = progressKey && route.length >= 2 ? readCrawl(progressKey) : null;
    applyCompletionAck(entry);
  }, [progressKey, route.length, applyCompletionAck]);

  function handleStartCrawl() {
    if (!progressKey || route.length < 2) return;
    const entry = startCrawl(
      progressKey,
      route.map((v) => v.id),
    );
    setCrawlProgress(entry);
    setShowCelebration(false);
  }

  function handleMarkComplete() {
    if (!progressKey) return;
    // Ensure there's an entry to complete (start if the walker skipped "Start").
    if (!readCrawl(progressKey)) {
      startCrawl(
        progressKey,
        route.map((v) => v.id),
      );
    }
    const entry = markCrawlComplete(progressKey);
    applyCompletionAck(entry);
    // The person just walked it: every Pal on screen cheers (lib/palMoments.ts).
    if (isComplete(entry)) announcePalMoment({ kind: "crawl-finished", stops: entry!.stopIds.length });
  }

  const crawlDone = isComplete(crawlProgress);

  return {
    crawlProgress,
    showCelebration,
    setShowCelebration,
    crawlDone,
    handleStartCrawl,
    handleMarkComplete,
  };
}
