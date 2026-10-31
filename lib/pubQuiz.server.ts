// The server half of the loading-screen pub quiz: it reads the committed
// listed-building pack and hands it to the pure picker in lib/pubQuiz.ts.
//
// A static import, so the pack is in the server function and never in a
// client bundle (server-only refuses a client import outright).

import "server-only";

import heritageListings from "@/public/data/heritage_listings.json";
import { pickPubQuizQuestion, type PubQuizListing, type PubQuizQuestion } from "@/lib/pubQuiz";

const LISTINGS: readonly PubQuizListing[] = Object.values(
  (heritageListings as { listings?: Record<string, PubQuizListing> }).listings ?? {},
);

export function loadingPubQuizQuestion(): PubQuizQuestion | null {
  return pickPubQuizQuestion(LISTINGS);
}
