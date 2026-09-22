import type { RobotsChecker } from "../../lib/harvest/robots.ts";

export function fetchLocalPlaywrightMenuPage(
  url: string,
  options: {
    sourceId: string;
    associatedHosts?: readonly string[];
    robotsChecker?: RobotsChecker;
    fetchImpl?: typeof fetch;
    browserType?: { launch(options: { headless: boolean }): Promise<unknown> };
    timeoutMs?: number;
    maxHtmlBytes?: number;
    followMenuLink?: boolean;
  },
): Promise<{ markdown: string; links: string[]; html: string; finalUrl: string }>;
