import type { createRobotsChecker } from "../../../lib/harvest/robots";
export function fetchText(url: string, robots: ReturnType<typeof createRobotsChecker>, fetchImpl?: typeof fetch): Promise<{
  ok: boolean;
  status: number;
  body: string;
  finalUrl?: string;
  error?: string;
}>;
