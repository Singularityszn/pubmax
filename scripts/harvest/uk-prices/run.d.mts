import type { RobotsChecker } from "../../../lib/harvest/robots.ts";

export function fetchText(
  url: string,
  options?: { fetchImpl?: typeof fetch; robots?: RobotsChecker },
): Promise<{
  ok: boolean;
  status: number;
  body: string;
  finalUrl: string;
  reason?: string;
  error?: string;
  pdf?: true;
  bytes?: Uint8Array | null;
}>;
