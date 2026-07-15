import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return token || null;
  },
}));

import { GET as LIST_MEMORIES, POST as CREATE_MEMORY } from "@/app/api/night-memories/route";
import { GET as LIST_MOMENTS, POST as ADD_MEMORY_MOMENT } from "@/app/api/night-memories/[id]/moments/route";
import { GET as LIST_STORIES, POST as CREATE_STORY } from "@/app/api/night-stories/route";
import { GET as GET_STORY } from "@/app/api/night-stories/[id]/route";
import { POST as PROPOSE } from "@/app/api/night-stories/[id]/publish-proposals/route";
import { POST as CONFIRM } from "@/app/api/night-stories/[id]/publish-confirmations/route";
import { __resetNightMemoryStore } from "@/lib/nightMemoryStore";

const auth = (path: string, body?: unknown, token = "host") => new Request(`http://localhost${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Night Memory HTTP contract", () => {
  beforeEach(() => __resetNightMemoryStore());

  it("requires an account and creates only a private Memory", async () => {
    const denied = await CREATE_MEMORY(new Request("http://localhost/api/night-memories", { method: "POST", body: "{}" }));
    expect(denied.status).toBe(401);

    const created = await CREATE_MEMORY(auth("/api/night-memories", { title: "Friday orbit", visibility: "public" }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ memory: { ownerId: "host", visibility: "private" } });

    const list = await LIST_MEMORIES(auth("/api/night-memories"));
    expect((await list.json()).memories).toHaveLength(1);
  });

  it("publishes via a typed proposal followed by token confirmation", async () => {
    const memoryResponse = await CREATE_MEMORY(auth("/api/night-memories", { title: "Friday orbit" }));
    const { memory } = await memoryResponse.json();
    const momentResponse = await ADD_MEMORY_MOMENT(auth(`/api/night-memories/${memory.id}/moments`, { kind: "quote", caption: "One more side quest" }), ctx(memory.id));
    const { moment } = await momentResponse.json();
    const storyResponse = await CREATE_STORY(auth("/api/night-stories", { memoryId: memory.id, title: "Friday orbit" }));
    const { story } = await storyResponse.json();

    const listedMoments = await LIST_MOMENTS(auth(`/api/night-memories/${memory.id}/moments`), ctx(memory.id));
    expect((await listedMoments.json()).moments).toEqual([expect.objectContaining({ id: moment.id, visibility: "private" })]);
    const listedStories = await LIST_STORIES(auth("/api/night-stories"));
    expect((await listedStories.json()).stories).toEqual([expect.objectContaining({ id: story.id, status: "draft" })]);

    expect((await GET_STORY(new Request(`http://localhost/api/night-stories/${story.id}`), ctx(story.id))).status).toBe(404);
    const proposalResponse = await PROPOSE(auth(`/api/night-stories/${story.id}/publish-proposals`, { momentIds: [moment.id], visibility: "public" }), ctx(story.id));
    expect(proposalResponse.status).toBe(201);
    const proposal = await proposalResponse.json();
    expect(proposal).toMatchObject({ proposal: { storyId: story.id, visibility: "public" } });

    const confirmed = await CONFIRM(auth(`/api/night-stories/${story.id}/publish-confirmations`, {
      proposalId: proposal.proposal.id,
      confirmationToken: proposal.confirmationToken,
    }), ctx(story.id));
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ story: { status: "published", visibility: "public" } });
    const publicResponse = await GET_STORY(new Request(`http://localhost/api/night-stories/${story.id}`), ctx(story.id));
    expect(publicResponse.status).toBe(200);
    const publicBody = await publicResponse.json();
    expect(publicBody.story).not.toHaveProperty("memoryId");
    expect(publicBody.story).not.toHaveProperty("hostEditorId");
  });
});
