// Hand-maintained declarations for quizRefresh.mjs so the vitest suite
// (__tests__/whatsOnHarvestPermission.test.ts) type-checks under the repo's
// allowJs:false tsconfig. Keep in sync with the runtime module.

import type { QuizCard, QuizVenueDetail } from "./quizParsers.d.mts";

type Network = {
  fetchImpl?: typeof fetch;
  robots?: (url: string) => Promise<{ allowed: boolean; evidence: string }>;
  sleep?: (ms: number) => Promise<void>;
};

export declare const QUESTION_ONE_SOURCE_ID: string;
export declare const SPEEDQUIZZING_SOURCE_ID: string;

export declare function loadQuestionOne(
  fromDir: string | null,
  network?: Network,
): Promise<{ cards: QuizCard[]; detailsByUrl: Map<string, QuizVenueDetail> }>;

export declare function loadSpeedQuizzingCoverage(
  fromDir: string | null,
  network?: Network,
): Promise<{ totalEvents: number; londonEvents: number; refused?: string }>;
