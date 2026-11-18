import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(), isSupabaseConfigured: () => false,
}));
vi.mock("next/og", () => ({ ImageResponse: class extends Response {
  constructor(element: ReactElement) { super(renderToStaticMarkup(element)); }
} }));

import Image from "@/app/invite/[token]/opengraph-image";
import { __resetMemoryPlans, planInviteToken, planStore } from "@/lib/planStore";

beforeEach(() => __resetMemoryPlans());

it("renders a saved classic invite without revealing its route", async () => {
  const created = await planStore().create({
    title: "Private title", creatorName: "Private organiser", startTime: "2026-07-18T19:00:00.000Z",
    stops: [{ venueId: "private-id-a", venueName: "Hidden Arms" }, { venueId: "private-id-b", venueName: "Secret Tap" }],
    context: { nightArea: "shoreditch", daypart: "evening", partyType: "friends", groupSize: 4, budget: "standard", budgetLimitPence: null, zeroProof: false, wetherspoonsPreferred: false, atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [] },
  });
  if (!created.ok) throw new Error(`Plan creation failed: ${created.error}`);
  const invite = await planInviteToken(created.plan.plan.id);
  if (!invite.ok || !invite.inviteToken) throw new Error("Invite token unavailable");
  const response = await Image({ params: Promise.resolve({ token: invite.inviteToken }) });
  const output = (await response.text()).replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
  for (const secret of ["Private title", "Private organiser", "private-id-a", "private-id-b", "Hidden Arms", "Secret Tap", "£"]) expect(output).not.toContain(secret);
  for (const visible of ["Shoreditch", "20:00", "2 stops", "Join the crew to see the route"]) expect(output).toContain(visible);
});
