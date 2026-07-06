import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for app/api/pint-drops/comments/route.ts. With the
// Supabase env cleared the route selects the process-memory commentsStore, so
// every case is deterministic and touches no network. The route derives an
// actor_hash from the request IP (never the client) for rate-limiting; the
// public CommentDTO exposes ONLY { id, handle, body, createdAt } — no
// actor_hash, no status — which we assert on the returned bodies.

import { GET, POST } from "@/app/api/pint-drops/comments/route";
import {
  __addMemoryCommentForTest,
  __resetMemoryComments,
} from "@/lib/commentsStore";

const URL_BASE = "http://localhost/api/pint-drops/comments";

function list(dropId?: string): Promise<Response> {
  const url = dropId ? `${URL_BASE}?dropId=${encodeURIComponent(dropId)}` : URL_BASE;
  return GET(new Request(url));
}

function post(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return POST(
    new Request(URL_BASE, { method: "POST", body: JSON.stringify(body), headers }),
  );
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryComments();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/pint-drops/comments", () => {
  it("returns an empty list when dropId is missing (never a 500)", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comments: [] });
  });

  it("returns an empty list for a drop with no comments", async () => {
    const res = await list("drop-empty");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comments: [] });
  });

  it("lists a posted comment for its drop, oldest-first", async () => {
    await post({ dropId: "drop-1", handle: "ale", body: "cheapest in years" });
    await post({ dropId: "drop-1", handle: "mild", body: "second round" });

    const res = await list("drop-1");
    expect(res.status).toBe(200);
    const { comments } = await res.json();
    expect(comments.map((c: { body: string }) => c.body)).toEqual([
      "cheapest in years",
      "second round",
    ]);
  });

  it("lists ONLY visible comments — hidden/pending never surface", async () => {
    __addMemoryCommentForTest("drop-mod", {
      handle: "spammer",
      body: "hidden note",
      actorHash: "hash-x",
      status: "hidden",
    });
    __addMemoryCommentForTest("drop-mod", {
      handle: "waiting",
      body: "pending note",
      actorHash: "hash-y",
      status: "pending",
    });
    __addMemoryCommentForTest("drop-mod", {
      handle: "ok",
      body: "visible note",
      actorHash: "hash-z",
      status: "visible",
    });

    const { comments } = await (await list("drop-mod")).json();
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("visible note");
  });
});

describe("POST /api/pint-drops/comments", () => {
  it("creates a comment and returns 201 with the public DTO shape only", async () => {
    const res = await post({ dropId: "drop-1", handle: "ale", body: "grand pint" });
    expect(res.status).toBe(201);
    const { comment } = await res.json();
    expect(Object.keys(comment).sort()).toEqual(["body", "createdAt", "handle", "id", "parentId"].sort());
    expect(comment.handle).toBe("ale");
    expect(comment.body).toBe("grand pint");
    expect(typeof comment.createdAt).toBe("string");
  });

  it("400s a missing dropId", async () => {
    const res = await post({ handle: "ale", body: "hi" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing pint drop id." });
  });

  it("400s an empty body", async () => {
    const res = await post({ dropId: "drop-1", handle: "ale", body: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Comment can't be empty.");
  });

  it("400s a body that is only strippable chars (cleans down to empty)", async () => {
    // clean() removes only the <>-delimiters (not their text) and control chars,
    // so a body of pure brackets/control chars cleans to "" and is rejected.
    const res = await post({ dropId: "drop-1", handle: "ale", body: "<<>>" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Comment can't be empty.");
  });

  it("400s a missing handle", async () => {
    const res = await post({ dropId: "drop-1", body: "hi" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Add a handle.");
  });

  it("strips inline HTML from a mixed body before storing", async () => {
    const res = await post({
      dropId: "drop-clean",
      handle: "ale",
      body: "great <b>value</b> pint",
    });
    expect(res.status).toBe(201);
    const { comment } = await res.json();
    // The <>-delimited HTML is stripped; the text survives.
    expect(comment.body).toBe("great bvalue/b pint");
    expect(comment.body).not.toContain("<");
  });

  it("400s a malformed JSON body", async () => {
    const res = await POST(new Request(URL_BASE, { method: "POST", body: "{oops" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Malformed request body." });
  });

  it("429s the 9th rapid comment on one drop from one actor", async () => {
    // Distinct IP per case keeps the durable/actor key from bleeding across
    // tests; the in-memory limiter keys on the drop id (unique below) so this
    // block is self-contained. Limit is 8 → the 9th is limited.
    const dropId = "drop-flood";
    const headers = { "x-forwarded-for": "198.51.100.9" };
    let last: Response | undefined;
    for (let i = 0; i < 9; i++) {
      last = await post({ dropId, handle: "flooder", body: `spam ${i}` }, headers);
    }
    expect(last!.status).toBe(429);
    expect(await last!.json()).toEqual({ error: "Too many comments, slow down." });
  });

  it("never leaks actor_hash/status/moderation fields in the created DTO", async () => {
    const res = await post(
      { dropId: "drop-leak", handle: "ale", body: "no secrets" },
      { "x-forwarded-for": "203.0.113.55" },
    );
    const json = await res.json();
    const blob = JSON.stringify(json);
    expect(Object.keys(json.comment).sort()).toEqual(["body", "createdAt", "handle", "id", "parentId"].sort());
    expect(blob).not.toMatch(/actor_?hash/i);
    expect(blob).not.toMatch(/"status"/);
    // The derived hash of the IP must not appear anywhere in the body.
    expect(blob).not.toContain("203.0.113.55");
  });

  it("public list never carries actor_hash/status even after a post", async () => {
    await post({ dropId: "drop-dto", handle: "ale", body: "clean read" });
    const { comments } = await (await list("drop-dto")).json();
    const blob = JSON.stringify(comments);
    expect(Object.keys(comments[0]).sort()).toEqual(["body", "createdAt", "handle", "id", "parentId"].sort());
    expect(blob).not.toMatch(/actor_?hash/i);
    expect(blob).not.toMatch(/"status"/);
  });
});
