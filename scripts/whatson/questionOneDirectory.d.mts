// Hand-maintained declarations for questionOneDirectory.mjs, so the server
// refresher in lib/whatsOnRefresh.server.ts and the vitest suite type-check
// under the repo's allowJs:false tsconfig. Keep in sync with the runtime module.

import type { QuizCard, QuizVenueDetail } from "./quizParsers.d.mts";

export declare const QUESTION_ONE_SOURCE_ID: string;
export declare const QUESTION_ONE_MAX_PAGES: number;

export declare function questionOneDirectoryPageUrl(sourceUrl: string, page: number): string;

export declare function readQuestionOneDirectory(options: {
  sourceUrl: string;
  permittedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  init?: () => RequestInit;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
}): Promise<{ cards: QuizCard[]; detailsByUrl: Map<string, QuizVenueDetail>; pages: number }>;
