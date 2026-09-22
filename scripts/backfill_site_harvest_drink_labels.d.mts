import type { RobotsChecker } from "../lib/harvest/robots";

export function fetchBody(url: string, robots: RobotsChecker): Promise<{
  ok: boolean;
  body: string;
  error?: string;
}>;
