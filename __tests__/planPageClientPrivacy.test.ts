import { Children, isValidElement, type ReactNode } from "react";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import PlanPage from "@/app/plan/[id]/page";
import NightCrawlMode from "@/components/plan/NightCrawlMode";
import type { PlanState } from "@/lib/plan";
import { planStore } from "@/lib/planStore";
import { assertPrivateResponses } from "../e2e/helpers/privacyResponse";

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("PUBMAX_E2E_KEYLESS", "1");
});

afterEach(() => vi.unstubAllEnvs());

it("the public Plan page withholds an accepted anchor from client inputs", async () => {
  const anchorId = "venue-private-preview-anchor";
  const anchorName = "Private Preview Anchor";
  const title = "Private host outing preview fixture";
  const created = await planStore().create({
    title,
    startTime: "2026-10-02T21:00:00.000Z",
    creatorName: "Preview host",
    stops: [
      { venueId: anchorId, venueName: anchorName },
      { venueId: "venue-private-preview-second", venueName: "Private Preview Second" },
    ],
  }, {
    anchor: { venueId: anchorId, source: "map-search", outcome: "route" },
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("Synthetic anchored Plan creation failed.");
  expect(created.plan.plan.anchorVenueId).toBe(anchorId);

  // Inspect the real page's input to its client boundary. This does not render
  // Next's HTML/Flight or run the client's capability-gated upgrade fetch.
  const tree = await PlanPage({
    params: Promise.resolve({ id: created.plan.plan.id }),
    searchParams: Promise.resolve({}),
  });
  const pending: ReactNode[] = [tree];
  let clientState: Omit<PlanState, "stops" | "crew"> | undefined;
  while (pending.length) {
    const node = pending.pop();
    if (!isValidElement<{ children?: ReactNode; initialState?: Omit<PlanState, "stops" | "crew"> }>(node)) continue;
    if (node.type === NightCrawlMode) {
      clientState = node.props.initialState;
      break;
    }
    pending.push(...Children.toArray(node.props.children));
  }
  expect(clientState, "Night-crawl client input must exist for an unfinished Plan").toBeDefined();
  const clientInput = JSON.stringify(clientState);
  for (const privateValue of [anchorId, anchorName, title, created.memberToken]) {
    expect(clientInput).not.toContain(privateValue);
  }
  // The public preview contract omits private fields, even when they are empty.
  mkdirSync(join(process.cwd(), "artifacts"), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), "artifacts/plan-client-privacy-"));
  try {
    await assertPrivateResponses(directory, [clientInput], [anchorId, anchorName, title, created.memberToken]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
