import type { RobotsChecker } from "../../lib/harvest/robots.ts";

export class BoundedHarvestResourceError extends Error {
  code: string;
}

export function fetchBoundedHarvestResource(input: {
  url: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  isAllowedUrl: (url: string) => boolean;
  robotsChecker?: RobotsChecker;
  expectedContentTypes: readonly string[];
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}): Promise<{ bytes: Uint8Array; finalUrl: string; contentType: string }>;
