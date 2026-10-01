import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
}));

import { DELETE as DELETE_PAL, PATCH as PATCH_PAL, POST as CREATE_PAL } from "@/app/api/pub-pal/route";
import { GET as LIST_MEMORIES, POST as CREATE_MEMORY } from "@/app/api/pub-pal/memories/route";
import { DELETE as DELETE_MEMORY, PATCH as PATCH_MEMORY } from "@/app/api/pub-pal/memories/[memoryId]/route";
import { GET as EXPORT_MEMORIES } from "@/app/api/pub-pal/memories/export/route";
import { DEFAULT_PAL_DRAFT, type PubPalMemory } from "@/lib/pubPal";
import { __resetPubPalStore } from "@/lib/pubPalStore";

const auth = (path: string, body?: unknown, token = "pal-owner", method?: string) => new Request(`http://localhost${path}`, {
  method: method ?? (body === undefined ? "GET" : "POST"),
  headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const ctx = (memoryId: string) => ({ params: Promise.resolve({ memoryId }) });

describe("Pub Pal memory ownership HTTP contract", () => {
  beforeEach(() => __resetPubPalStore());

  async function createPal(token = "pal-owner") {
    const response = await CREATE_PAL(auth("/api/pub-pal", {
      ...DEFAULT_PAL_DRAFT,
      adultConfirmed: true,
      name: "Morrow",
      proposalPreferences: { memories: true, routes: false },
    }, token));
    expect(response.status).toBe(201);
    return (await response.json()).pal;
  }

  it("persists proposal preferences and lets the owner disable either proposal channel", async () => {
    const pal = await createPal();
    expect(pal.proposalPreferences).toEqual({ memories: true, routes: false });
    const response = await PATCH_PAL(auth("/api/pub-pal", {
      proposalPreferences: { memories: false, routes: true },
    }, "pal-owner", "PATCH"));
    expect(response.status).toBe(200);
    expect((await response.json()).pal.proposalPreferences).toEqual({ memories: false, routes: true });
  });

  it("corrects, exports, and explicitly deletes only the owner's confirmed memory", async () => {
    await createPal();
    const created = await CREATE_MEMORY(auth("/api/pub-pal/memories", { kind: "venue_preference", value: "Likes quiet corners" }));
    expect(created.status).toBe(201);
    const memory = (await created.json()).memory;

    const forbidden = await PATCH_MEMORY(auth(`/api/pub-pal/memories/${memory.id}`, { value: "Tampered" }, "other-owner", "PATCH"), ctx(memory.id));
    expect(forbidden.status).toBe(404);

    const corrected = await PATCH_MEMORY(auth(`/api/pub-pal/memories/${memory.id}`, { value: "Prefers a quiet table away from speakers" }, "pal-owner", "PATCH"), ctx(memory.id));
    expect(corrected.status).toBe(200);
    expect(await corrected.json()).toMatchObject({ memory: { id: memory.id, provenance: "user_correction", value: "Prefers a quiet table away from speakers" } });

    const exported = await EXPORT_MEMORIES(auth("/api/pub-pal/memories/export"));
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain("attachment");
    const exportBody = await exported.json();
    expect(exportBody).toMatchObject({ version: 1, pal: { name: "Morrow", species: DEFAULT_PAL_DRAFT.appearance.species }, memories: [{ id: memory.id, provenance: "user_correction" }] });
    expect(JSON.stringify(exportBody)).not.toContain("pal-owner");
    expect(JSON.stringify(exportBody)).not.toContain('"palId"');

    const deleted = await DELETE_MEMORY(auth(`/api/pub-pal/memories/${memory.id}`, undefined, "pal-owner", "DELETE"), ctx(memory.id));
    expect(deleted.status).toBe(200);
    const replay = await DELETE_MEMORY(auth(`/api/pub-pal/memories/${memory.id}`, undefined, "pal-owner", "DELETE"), ctx(memory.id));
    expect(replay.status).toBe(404);
    await expect((await LIST_MEMORIES(auth("/api/pub-pal/memories"))).json()).resolves.toMatchObject({ memories: [] });
  });

  it("deleting the Pal removes its confirmed memory context in keyless mode", async () => {
    await createPal();
    await CREATE_MEMORY(auth("/api/pub-pal/memories", { kind: "drink_preference", value: "Zero-proof first" }));
    expect((await DELETE_PAL(auth("/api/pub-pal", undefined, "pal-owner", "DELETE"))).status).toBe(200);
    await expect((await LIST_MEMORIES(auth("/api/pub-pal/memories"))).json()).resolves.toMatchObject({ memories: [] });
  });

  it("denies cross-owner corrections and deletes when both owners have Pals and confirmed memories", async () => {
    const palA = await createPal("owner-a");
    const palB = await createPal("owner-b");
    expect(palA.id).not.toBe(palB.id);

    const createdA = await CREATE_MEMORY(auth("/api/pub-pal/memories", { kind: "venue_preference", value: "Prefers quiet corners" }, "owner-a"));
    const createdB = await CREATE_MEMORY(auth("/api/pub-pal/memories", { kind: "atmosphere_preference", value: "Prefers a window table" }, "owner-b"));
    expect(createdA.status).toBe(201);
    expect(createdB.status).toBe(201);
    const memoryA: PubPalMemory = (await createdA.json()).memory;
    const memoryB: PubPalMemory = (await createdB.json()).memory;
    expect(memoryA).toMatchObject({ palId: palA.id, kind: "venue_preference", value: "Prefers quiet corners", provenance: "user_confirmed" });
    expect(memoryB).toMatchObject({ palId: palB.id, kind: "atmosphere_preference", value: "Prefers a window table", provenance: "user_confirmed" });
    expect(memoryA.id).not.toBe(memoryB.id);

    async function listMemories(token: string): Promise<PubPalMemory[]> {
      const response = await LIST_MEMORIES(auth("/api/pub-pal/memories", undefined, token));
      expect(response.status).toBe(200);
      return (await response.json()).memories;
    }

    expect(await listMemories("owner-a")).toEqual([memoryA]);
    expect(await listMemories("owner-b")).toEqual([memoryB]);

    const forbiddenPatch = await PATCH_MEMORY(auth(`/api/pub-pal/memories/${memoryA.id}`, { value: "Tampered by another owner" }, "owner-b", "PATCH"), ctx(memoryA.id));
    expect(forbiddenPatch.status).toBe(404);
    expect(await forbiddenPatch.json()).toMatchObject({ code: "PAL_MEMORY_NOT_FOUND" });
    expect(await listMemories("owner-a")).toEqual([memoryA]);
    expect(await listMemories("owner-b")).toEqual([memoryB]);

    const forbiddenDelete = await DELETE_MEMORY(auth(`/api/pub-pal/memories/${memoryA.id}`, undefined, "owner-b", "DELETE"), ctx(memoryA.id));
    expect(forbiddenDelete.status).toBe(404);
    expect(await forbiddenDelete.json()).toMatchObject({ code: "PAL_MEMORY_NOT_FOUND" });
    expect(await listMemories("owner-a")).toEqual([memoryA]);
    expect(await listMemories("owner-b")).toEqual([memoryB]);

    const ownPatch = await PATCH_MEMORY(auth(`/api/pub-pal/memories/${memoryB.id}`, { value: "Prefers a window table away from speakers" }, "owner-b", "PATCH"), ctx(memoryB.id));
    expect(ownPatch.status).toBe(200);
    const correctedB: PubPalMemory = (await ownPatch.json()).memory;
    expect(correctedB).toMatchObject({ id: memoryB.id, palId: palB.id, kind: "atmosphere_preference", value: "Prefers a window table away from speakers", provenance: "user_correction", createdAt: memoryB.createdAt });
    expect(await listMemories("owner-b")).toEqual([correctedB]);
    expect(await listMemories("owner-a")).toEqual([memoryA]);

    const ownDelete = await DELETE_MEMORY(auth(`/api/pub-pal/memories/${memoryB.id}`, undefined, "owner-b", "DELETE"), ctx(memoryB.id));
    expect(ownDelete.status).toBe(200);
    expect(await ownDelete.json()).toEqual({ deleted: true });
    expect(await listMemories("owner-b")).toEqual([]);
    expect(await listMemories("owner-a")).toEqual([memoryA]);
  });
});
