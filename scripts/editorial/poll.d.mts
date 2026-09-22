import type {
  EditorialFeed,
  EditorialItem,
} from "../../lib/editorialRss.d.mts";
import type { RobotsChecker } from "../../lib/harvest/robots";

export const EDITORIAL_LATEST_PATH: string;
export const EDITORIAL_STATE_PATH: string;

export type EditorialPollState = Record<
  string,
  {
    lastFetchedAt?: number;
    lastModified?: string;
    backoffUntil?: number;
  }
>;

export type EditorialSnapshot = {
  version: 1;
  generatedAt: string;
  status: "ready" | "degraded";
  items: EditorialItem[];
  state: EditorialPollState;
};

export function pollEditorialFeeds(input?: {
  now?: number;
  feeds?: readonly EditorialFeed[];
  previous?: Partial<EditorialSnapshot>;
  state?: EditorialPollState;
  fetchImpl?: typeof fetch;
  robots?: RobotsChecker;
  force?: boolean;
}): Promise<EditorialSnapshot>;
