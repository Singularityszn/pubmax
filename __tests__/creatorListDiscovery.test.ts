import { describe, expect, it, vi } from "vitest";

import { parsePlanDescribeFromSearch } from "@/lib/planOccasion";

type Subject = typeof import("@/lib/creatorListDiscovery.server");

async function loadSubject(): Promise<Subject> {
  const subject = await import("@/lib/creatorListDiscovery.server").catch(
    () => null,
  );
  expect(subject, "creator-list discovery module must exist").not.toBeNull();
  return subject as Subject;
}

describe("creator-list discovery", () => {
  it("reads examined creators through one batched saved-list read", async () => {
    const { discoverCreatorLists } = await loadSubject();
    const listSavedByHandles = vi.fn(async ({ handles }: { handles: readonly string[] }) =>
      new Map(
        handles.map((handle) => [
          handle,
          handle === "alice"
            ? [
                {
                  venueId: "venue-1",
                  venueName: "The Fox",
                  venueMapUrl: "/map?sel=venue-1" as const,
                  listType: "Sunday roasts",
                  savedAt: "2026-08-24T12:00:00.000Z",
                },
              ]
            : [],
        ]),
      ),
    );

    const result = await discoverCreatorLists(
      { limit: 2 },
      {
        withdrawnHandles: async () => new Set<string>(),
        listProfiles: async () => [{ handle: "alice" }, { handle: "bob" }],
        listSavedByHandles,
      },
    );

    expect(result.lists.map((list) => list.ownerHandle)).toEqual(["alice"]);
    expect(listSavedByHandles).toHaveBeenCalledTimes(1);
    expect(listSavedByHandles).toHaveBeenCalledWith({ handles: ["alice", "bob"] });
  });

  it("groups public saves into creator lists without exposing notes", async () => {
    const { discoverCreatorLists } = await loadSubject();
    const savedForHandle = (handle: string) =>
      handle === "alice"
        ? [
            {
              venueId: "venue-1",
              venueName: "The Fox",
              venueMapUrl: "/map?sel=venue-1" as const,
              listType: "Sunday roasts",
              note: "Meet me at my flat first",
              savedAt: "2026-08-24T12:00:00.000Z",
            },
            {
              venueId: "venue-2",
              venueName: "The Crown",
              venueMapUrl: "/map?sel=venue-2" as const,
              listType: "Late pints",
              note: "Private note",
              savedAt: "2026-08-23T12:00:00.000Z",
            },
            {
              venueId: "venue-3",
              venueName: "The Ship",
              venueMapUrl: "/map?sel=venue-3" as const,
              listType: "Sunday roasts",
              savedAt: "2026-08-22T12:00:00.000Z",
            },
            {
              venueId: "venue-4",
              venueName: "The Rose",
              venueMapUrl: "/map?sel=venue-4" as const,
              listType: "Sunday roasts",
              savedAt: "2026-08-21T12:00:00.000Z",
            },
            {
              venueId: "venue-5",
              venueName: "The Stag",
              venueMapUrl: "/map?sel=venue-5" as const,
              listType: "Sunday roasts",
              savedAt: "2026-08-20T12:00:00.000Z",
            },
          ]
        : [];
    const listSavedByHandles = vi.fn(async ({ handles }: { handles: readonly string[] }) =>
      new Map(handles.map((handle) => [handle, savedForHandle(handle)])),
    );

    const result = await discoverCreatorLists(
      { limit: 2 },
      {
        withdrawnHandles: async () => new Set<string>(),
        listProfiles: async () => [
          {
            handle: "alice",
            displayName: "Alice",
            avatarUrl: "https://images.example/alice.jpg",
          },
          { handle: "bob" },
        ],
        listSavedByHandles,
      },
    );

    expect(result).toEqual({
      status: "ready",
      lists: [
        {
          ownerHandle: "alice",
          ownerDisplayName: "Alice",
          ownerAvatarUrl: "https://images.example/alice.jpg",
          listType: "Sunday roasts",
          listUrl: "/u/alice/lists/Sunday%20roasts",
          mapUrl:
            "/map?mode=build&pubs=venue-1%2Cvenue-3%2Cvenue-4%2Cvenue-5&sel=venue-1",
          planUrl: "/plan?query=Plan+Sunday+roasts+by+%40alice",
          savedCount: 4,
          updatedAt: "2026-08-24T12:00:00.000Z",
          previewVenues: [
            {
              venueId: "venue-1",
              venueName: "The Fox",
              venueMapUrl: "/map?sel=venue-1" as const,
            },
            {
              venueId: "venue-3",
              venueName: "The Ship",
              venueMapUrl: "/map?sel=venue-3" as const,
            },
            {
              venueId: "venue-4",
              venueName: "The Rose",
              venueMapUrl: "/map?sel=venue-4" as const,
            },
          ],
        },
        {
          ownerHandle: "alice",
          ownerDisplayName: "Alice",
          ownerAvatarUrl: "https://images.example/alice.jpg",
          listType: "Late pints",
          listUrl: "/u/alice/lists/Late%20pints",
          mapUrl: "/map?mode=build&pubs=venue-2&sel=venue-2",
          planUrl: "/plan?query=Plan+Late+pints+by+%40alice",
          savedCount: 1,
          updatedAt: "2026-08-23T12:00:00.000Z",
          previewVenues: [
            {
              venueId: "venue-2",
              venueName: "The Crown",
              venueMapUrl: "/map?sel=venue-2" as const,
            },
          ],
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(result)).not.toContain("Private note");
    expect(parsePlanDescribeFromSearch(result.lists[0]!.planUrl.split("?")[1] ?? ""))
      .toBe("Plan Sunday roasts by @alice");
    expect(listSavedByHandles).toHaveBeenCalledTimes(1);
    expect(listSavedByHandles).toHaveBeenCalledWith({ handles: ["alice", "bob"] });
  });

  it("pages by examined creator even when that creator has no saved pubs", async () => {
    const { discoverCreatorLists } = await loadSubject();
    const result = await discoverCreatorLists(
      { limit: 1, afterHandle: "before" },
      {
        withdrawnHandles: async () => new Set<string>(),
        listProfiles: async (input) => {
          expect(input).toEqual({ limit: 2, afterHandle: "before" });
          return [{ handle: "empty" }, { handle: "next" }];
        },
        listSavedByHandles: async ({ handles }) => new Map(handles.map((handle) => [handle, []])),
      },
    );

    expect(result).toEqual({ status: "ready", lists: [], nextCursor: "empty" });
  });

  it("hides a withdrawn owner but still pages past the window it examined", async () => {
    const { discoverCreatorLists } = await loadSubject();
    const listSavedByHandles = vi.fn(async ({ handles }: { handles: readonly string[] }) =>
      new Map(handles.map((handle) => [handle, []])),
    );
    const result = await discoverCreatorLists(
      { limit: 2 },
      {
        withdrawnHandles: async () => new Set(["bob"]),
        listProfiles: async () => [{ handle: "alice" }, { handle: "bob" }, { handle: "cara" }],
        listSavedByHandles,
      },
    );

    expect(result.nextCursor).toBe("bob");
    expect(listSavedByHandles).toHaveBeenCalledWith({ handles: ["alice"] });
  });

  it("does not report a failed saved-list read as an empty market", async () => {
    const { discoverCreatorLists } = await loadSubject();
    const result = await discoverCreatorLists(
      { limit: 1 },
      {
        withdrawnHandles: async () => new Set<string>(),
        listProfiles: async () => [{ handle: "alice" }],
        listSavedByHandles: async ({ handles }) =>
          new Map(handles.map((handle) => [handle, { status: "unavailable" as const }])),
      },
    );

    expect(result.status).toBe("degraded");
    expect(result.lists).toEqual([]);
  });

  it("keeps lists from owners it could read when another owner is unavailable", async () => {
    const { discoverCreatorLists } = await loadSubject();
    const result = await discoverCreatorLists(
      { limit: 2 },
      {
        withdrawnHandles: async () => new Set<string>(),
        listProfiles: async () => [{ handle: "alice" }, { handle: "bob" }],
        listSavedByHandles: async ({ handles }) =>
          new Map(
            handles.map((handle) => [
              handle,
              handle === "alice"
                ? [
                    {
                      venueId: "venue-1",
                      venueName: "The Fox",
                      venueMapUrl: "/map?sel=venue-1" as const,
                      listType: "Sunday roasts",
                      savedAt: "2026-08-24T12:00:00.000Z",
                    },
                  ]
                : { status: "unavailable" as const },
            ]),
          ),
      },
    );

    expect(result.status).toBe("degraded");
    expect(result.lists.map((list) => list.ownerHandle)).toEqual(["alice"]);
  });
});
