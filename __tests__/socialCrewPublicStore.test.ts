import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const supabase = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  requireSupabaseAdmin: () => ({ rpc: supabase.rpc }),
  requireDynamicSupabaseAdmin: () => ({ rpc: supabase.rpc }),
}));

import { SocialCrewStoreError, createSocialCrewStore } from "@/lib/socialCrewStore";

const CREW_ID = "50000000-0000-4000-8000-000000000001";
const SOURCE = {
  crewId: CREW_ID,
  title: "Friday in Camden",
  hostHandle: "host",
  startsAt: "2026-08-23T18:30:00.000000Z",
  stopVenueId: "venue-camden-arms",
  stopVenueName: "Camden Arms",
};

beforeEach(() => vi.clearAllMocks());

describe("Social Crew public preview store", () => {
  it("uses service RPC and returns the strict source row", async () => {
    supabase.rpc.mockResolvedValueOnce({ data: SOURCE, error: null });

    await expect(createSocialCrewStore().readPublicPreview(CREW_ID)).resolves.toEqual({
      ...SOURCE,
      startsAt: "2026-08-23T18:30:00.000Z",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("read_social_crew_public_preview", {
      p_crew_id: CREW_ID,
    });
  });

  it("fails closed on null, malformed, and extra authority fields", async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(createSocialCrewStore().readPublicPreview(CREW_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    } satisfies Partial<SocialCrewStoreError>);

    supabase.rpc.mockResolvedValueOnce({
      data: { ...SOURCE, members: [{ handle: "secret" }] },
      error: null,
    });
    await expect(createSocialCrewStore().readPublicPreview(CREW_ID)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      status: 503,
    });
  });
});

describe("Social Crew share card store (0225)", () => {
  const CARD = {
    crewId: CREW_ID,
    title: "Friday in Camden",
    hostHandle: "host",
    startsAt: "2026-08-23T18:30:00.000000Z",
    capacity: 8,
    memberCount: 3,
    meetingVenueId: "venue-camden-arms",
    meetingVenueName: "Camden Arms",
    stopVenueIds: ["venue-camden-arms", "venue-good-mixer"],
  };

  it("reads the 0225 service RPC and keeps the stop list server side", async () => {
    supabase.rpc.mockResolvedValueOnce({ data: CARD, error: null });

    await expect(createSocialCrewStore().readShareCard(CREW_ID)).resolves.toEqual({
      ...CARD,
      startsAt: "2026-08-23T18:30:00.000Z",
    });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("read_social_crew_share_card", {
      p_crew_id: CREW_ID,
    });
  });

  it("answers not found for a crew 0225 does not describe", async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    await expect(createSocialCrewStore().readShareCard(CREW_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("uses Stop 1 only when 0208 confirms there are no open crawl facts", async () => {
    supabase.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "function public.read_social_crew_share_card(uuid) does not exist" } })
      .mockResolvedValueOnce({ data: SOURCE, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(createSocialCrewStore().readShareCard(CREW_ID)).resolves.toEqual({
      crewId: CREW_ID,
      title: "Friday in Camden",
      hostHandle: "host",
      startsAt: "2026-08-23T18:30:00.000Z",
      capacity: null,
      memberCount: null,
      meetingVenueId: "venue-camden-arms",
      meetingVenueName: "Camden Arms",
      stopVenueIds: null,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, "read_social_crew_public_preview", {
      p_crew_id: CREW_ID,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(3, "read_social_crew_open_crawl", {
      p_crew_id: CREW_ID,
    });
  });

  it("keeps the host's Stop 2 meeting facts before 0225 is applied", async () => {
    supabase.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "0225 unavailable" } })
      .mockResolvedValueOnce({ data: SOURCE, error: null })
      .mockResolvedValueOnce({
        data: {
          capacity: 8,
          meetingVenueId: "venue-good-mixer",
          meetingVenueName: "The Good Mixer",
          description: "A few pubs in Camden",
        },
        error: null,
      });

    await expect(createSocialCrewStore().readShareCard(CREW_ID)).resolves.toEqual({
      crewId: CREW_ID,
      title: SOURCE.title,
      hostHandle: SOURCE.hostHandle,
      startsAt: "2026-08-23T18:30:00.000Z",
      capacity: 8,
      memberCount: null,
      meetingVenueId: "venue-good-mixer",
      meetingVenueName: "The Good Mixer",
      stopVenueIds: null,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, "read_social_crew_public_preview", {
      p_crew_id: CREW_ID,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(3, "read_social_crew_open_crawl", {
      p_crew_id: CREW_ID,
    });
  });

  it.each([
    ["a failed 0208 read", { data: null, error: { message: "0208 unavailable" } }],
    ["malformed 0208 facts", { data: { capacity: 8 }, error: null }],
  ])("refuses the card after %s instead of guessing Stop 1", async (_label, response) => {
    supabase.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "0225 unavailable" } })
      .mockResolvedValueOnce({ data: SOURCE, error: null })
      .mockResolvedValueOnce(response);

    await expect(createSocialCrewStore().readShareCard(CREW_ID)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      status: 503,
    });
  });

  it("does not read 0208 facts when the public preview refuses the crew", async () => {
    supabase.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "0225 unavailable" } })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(createSocialCrewStore().readShareCard(CREW_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a member list", { members: [{ handle: "secret" }] }],
    ["an empty stop list", { stopVenueIds: [] }],
    ["a negative seat count", { memberCount: -1 }],
    ["a blank meeting pub", { meetingVenueName: " " }],
  ])("refuses %s and answers the smaller 0115 preview", async (_label, extra) => {
    supabase.rpc
      .mockResolvedValueOnce({ data: { ...CARD, ...extra }, error: null })
      .mockResolvedValueOnce({ data: SOURCE, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const card = await createSocialCrewStore().readShareCard(CREW_ID);

    expect(card.stopVenueIds).toBeNull();
    expect(JSON.stringify(card)).not.toContain("secret");
  });
});
