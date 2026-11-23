import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ admin: null as ReturnType<typeof createClient> | null }));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  requireSupabaseAdmin: () => {
    if (!state.admin) throw new Error("missing fixture client");
    return state.admin;
  },
}));
vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({ getByUserId: async () => ({ id: "profile-259", handle: "leaver259" }) }),
}));

import { deleteOwnAccount } from "@/lib/accountDeletion.server";

const TABLES = ["social_post_media", "social_post_media_uploads", "social_video_uploads", "social_post_extra_photos"];
const USER = "00000000-0000-4000-8000-000000000259";

beforeEach(() => {
  state.admin = null;
});

function storageFixture(table: string, failLaterPage = false) {
  const keys = Array.from({ length: 1001 }, (_, n) => table === "social_video_uploads"
    ? `social-video/${String(n).padStart(4, "0")}/video.mp4`
    : `social/${String(n).padStart(4, "0")}/image.jpg`);
  const removed = new Set<string>();
  let authDeleted = false;
  state.admin = createClient("https://deletion.example.test", "service-fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.startsWith("/rest/v1/rpc/")) return Response.json({ ok: true, crews: 0, released: 0 });
        if (url.pathname.startsWith("/rest/v1/")) {
          if (url.pathname !== `/rest/v1/${table}`) return Response.json([]);
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? 1000));
          if (failLaterPage && offset > 0) {
            return Response.json({ message: "media read unavailable" }, { status: 503 });
          }
          const ordered = url.searchParams.get("order") === "object_key.asc" ? keys : [...keys].reverse();
          return Response.json(ordered.slice(offset, offset + limit).map((object_key) => ({ object_key })));
        }
        if (url.pathname.startsWith("/auth/v1/admin/users/")) {
          authDeleted = true;
          return Response.json({ id: USER });
        }
        if (url.pathname.startsWith("/storage/v1/object/list/")) return Response.json([]);
        if (url.pathname.startsWith("/storage/v1/object/") && init?.method === "DELETE") {
          expect(authDeleted).toBe(true);
          const body = JSON.parse(String(init.body)) as { prefixes: string[] };
          for (const key of body.prefixes) removed.add(key);
          return Response.json([]);
        }
        throw new Error(`Unexpected deletion request: ${url.pathname}`);
      },
    },
  });
  return { keys, removed, authDeleted: () => authDeleted };
}

describe("account deletion with the hosted 1000-row response cap", () => {
  it.each(TABLES)("removes every object named by %s before reporting deletion", async (table) => {
    const fixture = storageFixture(table);

    expect(await deleteOwnAccount(USER)).toBe("deleted");

    const expected = fixture.keys.flatMap((key) => key.endsWith(".jpg")
      ? [key, key.replace("image.jpg", "image.staging.jpg")]
      : [key]);
    expect(fixture.removed).toEqual(new Set(expected));
  });

  it("keeps the account and its photos when a later media page fails", async () => {
    const fixture = storageFixture("social_post_media", true);

    expect(await deleteOwnAccount(USER)).toBe("unavailable");

    expect(fixture.authDeleted()).toBe(false);
    expect(fixture.removed.size).toBe(0);
  });
});
