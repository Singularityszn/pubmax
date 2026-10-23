import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A message, a report or a rating written while its table is missing used to
// land in one instance's memory and answer success, even in production, so it
// was lost on the next cold start (reliability audit, 18 Oct 2026). Production
// now refuses through each store's own failure value; preview keeps memory.
const MISSING = {
  data: null,
  error: { code: "42P01", message: 'relation "public.messages" does not exist' },
};
const MISSING_RATINGS = {
  data: null,
  error: { code: "42P01", message: 'relation "public.venue_ratings" does not exist' },
};

let reply: typeof MISSING = MISSING;

function chain(): unknown {
  const target = () => undefined;
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (value: unknown) => unknown) => resolve(reply);
      }
      return () => chain();
    },
  });
}

vi.mock("@/lib/storeBackend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storeBackend")>()),
  admin: () => ({ from: () => chain(), rpc: () => chain() }),
}));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => true,
}));

import { memoryMessagesStore, supabaseMessagesStore } from "@/lib/messagesStore";
import { ratingsStore } from "@/lib/ratingsStore";

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  reply = MISSING;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a write that meets a missing table", () => {
  it("refuses a message report in production rather than holding it in memory", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const memoryReport = vi.spyOn(memoryMessagesStore, "report");
    await expect(supabaseMessagesStore.report(CONVERSATION, MESSAGE, "ripley")).resolves.toBe(false);
    expect(memoryReport).not.toHaveBeenCalled();
  });

  it("still uses memory for a message report off production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const memoryReport = vi.spyOn(memoryMessagesStore, "report");
    await supabaseMessagesStore.report(CONVERSATION, MESSAGE, "ripley");
    expect(memoryReport).toHaveBeenCalledTimes(1);
  });

  it("refuses a read receipt in production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const memoryMarkRead = vi.spyOn(memoryMessagesStore, "markRead");
    await expect(supabaseMessagesStore.markRead(CONVERSATION, "ripley")).resolves.toBe(0);
    expect(memoryMarkRead).not.toHaveBeenCalled();
  });

  it("refuses to open a conversation in production, so no memory id reaches send", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const memoryOpen = vi.spyOn(memoryMessagesStore, "openConversation");
    await expect(supabaseMessagesStore.openConversation("ripley", "fox")).resolves.toBeNull();
    expect(memoryOpen).not.toHaveBeenCalled();
  });

  it("refuses to open or leave a group in production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const memoryGroup = vi.spyOn(memoryMessagesStore, "openGroupConversation");
    const memoryLeave = vi.spyOn(memoryMessagesStore, "leaveGroupConversation");
    await expect(
      supabaseMessagesStore.openGroupConversation("ripley", ["ripley", "fox", "otter"], "Friday"),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(supabaseMessagesStore.leaveGroupConversation(CONVERSATION, "ripley")).resolves.toBe(
      "unavailable",
    );
    expect(memoryGroup).not.toHaveBeenCalled();
    expect(memoryLeave).not.toHaveBeenCalled();
  });

  it("still opens a conversation in memory off production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const memoryOpen = vi.spyOn(memoryMessagesStore, "openConversation");
    await supabaseMessagesStore.openConversation("ripley", "fox");
    expect(memoryOpen).toHaveBeenCalledTimes(1);
  });

  it("refuses a rating in production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    reply = MISSING_RATINGS;
    await expect(
      ratingsStore().rate({ kind: "venue", ref: "venue-1", handle: "ripley", rating: 5 }),
    ).rejects.toThrow(/refusing process-memory write fallback/);
  });
});
