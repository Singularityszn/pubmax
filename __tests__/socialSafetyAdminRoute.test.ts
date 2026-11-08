import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level proof for app/api/admin/social-safety/route.ts (launch plan P0
// item 6). The moderator door is the real token compare with ADMIN_TOKEN SET,
// never the open dev gate (supabase/AGENTS.md: a moderator cell is never tested
// with ADMIN_TOKEN unset). The database is the second door and is proved by
// socialSafetyModerationMigrationEffective; here the RPC is the seam.

vi.mock("server-only", () => ({}));

const TOKEN = "safety-admin-token";
const STAFF_ROLE = "5afe0000-0000-4000-8000-000000000001";
const PROFILE = "5afe0000-0000-4000-8000-000000000002";
const REPORT = "5afe0000-0000-4000-8000-000000000003";
const MESSAGE = "5afe0000-0000-4000-8000-000000000004";

const rpc = vi.hoisted(() => vi.fn());
const sign = vi.hoisted(() => vi.fn());
const limited = vi.hoisted(() => ({ value: false }));

vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => limited.value }));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  requireSupabaseAdmin: () => ({ rpc, storage: { from: () => ({ createSignedUrl: sign }) } }),
}));

import { GET, POST } from "@/app/api/admin/social-safety/route";

const URL = "https://pubmaxxing.com/api/admin/social-safety";
const MOD = { "x-admin-token": TOKEN };

function post(body: unknown, headers: Record<string, string> = MOD): Promise<Response> {
  return POST(new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
}

const REPORT_ROW = {
  reportId: REPORT,
  kind: "profile",
  contentId: PROFILE,
  reason: "threat",
  state: "queued",
  createdAt: "2026-11-07T18:00:00.000000Z",
  reporterHandle: "reporter",
  targetProfileId: PROFILE,
  targetHandle: "targetted",
  targetAccountState: "active",
  excerpt: null,
};

const MESSAGE_ROW = {
  messageId: MESSAGE,
  conversationId: REPORT,
  body: "You will regret coming tonight",
  hasAttachment: false,
  senderHandle: "targetted",
  senderProfileId: PROFILE,
  senderAccountState: "active",
  flaggedBy: "reporter",
  flaggedAt: "2026-11-07T18:00:00.000000Z",
  sentAt: "2026-11-07T17:59:00.000000Z",
};

beforeEach(() => {
  rpc.mockReset();
  sign.mockReset();
  limited.value = false;
  vi.stubEnv("ADMIN_TOKEN", TOKEN);
  vi.stubEnv("SOCIAL_MODERATOR_STAFF_ROLE_ID", STAFF_ROLE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/admin/social-safety", () => {
  it("refuses a request without the moderator token and reads nothing", async () => {
    const response = await GET(new Request(URL, { headers: { "x-admin-token": "wrong" } }));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 503 when no staff role is configured", async () => {
    vi.stubEnv("SOCIAL_MODERATOR_STAFF_ROLE_ID", "");
    const response = await GET(new Request(URL, { headers: MOD }));
    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads both queues under the configured staff role, privately", async () => {
    rpc.mockImplementation(async (name: string) => ({
      data: name === "read_social_report_queue_admin" ? [REPORT_ROW] : [MESSAGE_ROW],
      error: null,
    }));
    const response = await GET(new Request(URL, { headers: MOD }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.reports).toEqual([expect.objectContaining({ reportId: REPORT, targetHandle: "targetted" })]);
    expect(body.flaggedMessages).toEqual([expect.objectContaining({ messageId: MESSAGE, flaggedBy: "reporter" })]);
    expect(rpc).toHaveBeenCalledWith("read_social_report_queue_admin", { p_staff_role_id: STAFF_ROLE, p_limit: 50 });
    expect(rpc).toHaveBeenCalledWith("read_flagged_messages_admin", { p_staff_role_id: STAFF_ROLE, p_limit: 50 });
  });

  it("answers 503 rather than a half queue when the database refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "staff required" } });
    const response = await GET(new Request(URL, { headers: MOD }));
    expect(response.status).toBe(503);
  });
});

describe("POST /api/admin/social-safety", () => {
  it("refuses a request without the moderator token and changes nothing", async () => {
    const response = await post({ action: "suspend", profileId: PROFILE, reason: "Threats", reportId: null }, {});
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is rate limited before it checks anything else", async () => {
    limited.value = true;
    const response = await post({ action: "resolve_report", reportId: REPORT });
    expect(response.status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown action", { action: "ban", profileId: PROFILE }],
    ["a suspend with no reason", { action: "suspend", profileId: PROFILE, reason: "  ", reportId: null }],
    ["a suspend with an extra field", { action: "suspend", profileId: PROFILE, reason: "Threats", reportId: null, until: "never" }],
    ["a resolve with a bad id", { action: "resolve_report", reportId: "nope" }],
  ])("refuses %s as malformed", async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("suspends through the audited function with the trimmed reason", async () => {
    rpc.mockResolvedValue({ data: { ok: true, code: "suspended", state: "suspended", auditId: REPORT }, error: null });
    const response = await post({ action: "suspend", profileId: PROFILE, reason: "  Threats in DMs  ", reportId: REPORT });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, code: "suspended", state: "suspended" });
    expect(rpc).toHaveBeenCalledWith("set_social_account_suspension_admin", {
      p_staff_role_id: STAFF_ROLE,
      p_profile_id: PROFILE,
      p_action: "suspend",
      p_reason: "Threats in DMs",
      p_report_id: REPORT,
    });
  });

  it.each([
    ["not_found", 404],
    ["gone", 409],
    ["invalid", 400],
  ])("maps a %s suspension answer to %i", async (code, status) => {
    rpc.mockResolvedValue({ data: { ok: false, code }, error: null });
    const response = await post({ action: "reinstate", profileId: PROFILE, reason: "Appeal upheld", reportId: null });
    expect(response.status).toBe(status);
  });

  it("closes a report and marks a DM reviewed", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await (await post({ action: "resolve_report", reportId: REPORT })).json()).toEqual({ ok: true, changed: true });
    expect(await (await post({ action: "review_message", messageId: MESSAGE })).json()).toEqual({ ok: true, changed: true });
    expect(rpc).toHaveBeenCalledWith("resolve_social_report_admin", { p_staff_role_id: STAFF_ROLE, p_report_id: REPORT });
    expect(rpc).toHaveBeenCalledWith("review_flagged_message_admin", { p_staff_role_id: STAFF_ROLE, p_message_id: MESSAGE });
  });
});

describe("reported attachment evidence", () => {
  const input = { action: "view_message_evidence", messageId: MESSAGE };

  it("refuses an absent moderator credential before reading or signing", async () => {
    const response = await post(input, {});
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("requires a configured staff role before reading or signing", async () => {
    vi.stubEnv("SOCIAL_MODERATOR_STAFF_ROLE_ID", "");
    const response = await post(input);
    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("does not accept a caller's object key or conversation", async () => {
    const response = await post({ ...input, objectKey: "somebody-elses-photo.jpg", conversationId: REPORT });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("signs only the reported message photo for three minutes and returns no raw key", async () => {
    rpc.mockResolvedValue({ data: { kind: "photo", messageId: MESSAGE, conversationId: REPORT,
      objectKey: `messages/${REPORT}/${MESSAGE}.jpg` }, error: null });
    const signed = "https://storage.example/object/sign/private/photo.jpg?token=short-lived";
    sign.mockResolvedValue({ data: { signedUrl: signed }, error: null });
    const response = await post(input);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ evidence: { kind: "photo", url: signed } });
    expect(sign).toHaveBeenCalledWith(`messages/${REPORT}/${MESSAGE}.jpg`, 180);
    expect(rpc).toHaveBeenCalledWith("read_flagged_message_evidence_admin", { p_staff_role_id: STAFF_ROLE, p_message_id: MESSAGE });
  });

  it.each([
    ["an unflagged or missing message", null, null, 404],
    ["a revoked staff role", null, { message: "staff required" }, 503],
    ["a different message's photo", { kind: "photo", messageId: PROFILE, conversationId: REPORT, objectKey: `messages/${REPORT}/${PROFILE}.jpg` }, null, 503],
    ["a photo key outside the message", { kind: "photo", messageId: MESSAGE, conversationId: REPORT, objectKey: "public/other.jpg" }, null, 503],
  ])("does not sign %s", async (_label, data, error, status) => {
    rpc.mockResolvedValue({ data, error });
    const response = await post(input);
    expect(response.status).toBe(status);
    expect(await response.json()).not.toHaveProperty("evidence");
    expect(sign).not.toHaveBeenCalled();
  });

  it("refuses a failed signing operation without returning evidence", async () => {
    rpc.mockResolvedValue({ data: { kind: "photo", messageId: MESSAGE, conversationId: REPORT,
      objectKey: `messages/${REPORT}/${MESSAGE}.jpg` }, error: null });
    sign.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    const response = await post(input);
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("evidence");
  });

  it.each([
    { kind: "poll", question: "Who should we threaten?", options: ["Alice", "Bob"] },
    { kind: "venue", venueId: "pub-1" },
    { kind: "contact", handle: "alice" },
    { kind: "event", planId: PROFILE },
  ])("returns only the reported $kind attachment", async (evidence) => {
    rpc.mockResolvedValue({ data: { ...evidence, unrelatedMessage: "secret" }, error: null });
    const response = await post(input);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ evidence });
    expect(sign).not.toHaveBeenCalled();
  });
});

describe("reported content evidence", () => {
  const input = { action: "view_report_evidence", reportId: REPORT };
  const photo = `social/${PROFILE}/${MESSAGE}/image.jpg`;
  const video = `social-video/${MESSAGE}/video.mp4`;
  const body = "Reported text beyond the queue excerpt. ".repeat(20);

  it.each(["post", "comment", "quote"])("requires moderator credentials for %s evidence", async (kind) => {
    rpc.mockResolvedValue({ data: { reportId: REPORT, kind, contentId: PROFILE, body, media: [] }, error: null });
    const response = await post(input, {});
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("evidence");
    expect(rpc).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it.each(["post", "comment", "quote"])("requires a staff role for %s evidence", async (kind) => {
    rpc.mockResolvedValue({ data: { reportId: REPORT, kind, contentId: PROFILE, body, media: [] }, error: null });
    vi.stubEnv("SOCIAL_MODERATOR_STAFF_ROLE_ID", "");
    const response = await post(input);
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("evidence");
    expect(rpc).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, contentId: PROFILE },
    { ...input, kind: "comment" },
    { ...input, objectKey: photo },
    { ...input, reportId: "not-a-report-id" },
  ])("refuses caller-selected content or malformed report IDs", async (request) => {
    const response = await post(request);
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("returns full text, four carousel photos and video as short-lived signed URLs", async () => {
    const second = `social-extra/${PROFILE}/image.jpg`;
    const third = `social-extra/${MESSAGE}/image.jpg`;
    const fourth = `social-extra/${REPORT}/image.jpg`;
    rpc.mockResolvedValue({ data: { reportId: REPORT, kind: "post", contentId: PROFILE, body,
      media: [{ kind: "photo", objectKey: photo }, { kind: "photo", objectKey: second },
        { kind: "photo", objectKey: third }, { kind: "photo", objectKey: fourth },
        { kind: "video", objectKey: video }], unrelatedPost: "private" }, error: null });
    sign.mockResolvedValueOnce({ data: { signedUrl: "https://storage.example/signed?token=photo" }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: "https://storage.example/signed?token=second" }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: "https://storage.example/signed?token=third" }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: "https://storage.example/signed?token=fourth" }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: "https://storage.example/signed?token=video" }, error: null });
    const response = await post(input);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ evidence: { reportId: REPORT, kind: "post", contentId: PROFILE, body,
      media: [{ kind: "photo", url: "https://storage.example/signed?token=photo" },
        { kind: "photo", url: "https://storage.example/signed?token=second" },
        { kind: "photo", url: "https://storage.example/signed?token=third" },
        { kind: "photo", url: "https://storage.example/signed?token=fourth" },
        { kind: "video", url: "https://storage.example/signed?token=video" }] } });
    expect(sign).toHaveBeenCalledTimes(5);
    expect(sign).toHaveBeenCalledWith(photo, 180);
    expect(sign).toHaveBeenCalledWith(second, 180);
    expect(sign).toHaveBeenCalledWith(third, 180);
    expect(sign).toHaveBeenCalledWith(fourth, 180);
    expect(sign).toHaveBeenCalledWith(video, 180);
    expect(rpc).toHaveBeenCalledWith("read_reported_content_evidence_admin", { p_staff_role_id: STAFF_ROLE, p_report_id: REPORT });
  });

  it.each(["post", "comment", "quote"] as const)("returns only the reported %s text without signing", async (kind) => {
    rpc.mockResolvedValue({ data: { reportId: REPORT, kind, contentId: PROFILE, body, media: [] }, error: null });
    const response = await post(input);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ evidence: { reportId: REPORT, kind, contentId: PROFILE, body, media: [] } });
    expect(sign).not.toHaveBeenCalled();
  });

  it.each([
    [null, null, 404],
    [null, { message: "staff required" }, 503],
    [{ reportId: REPORT, kind: "profile", contentId: PROFILE, body, media: [] }, null, 503],
    [{ reportId: REPORT, kind: "comment", contentId: PROFILE, body, media: [{ kind: "photo", objectKey: photo }] }, null, 503],
    [{ reportId: REPORT, kind: "quote", contentId: PROFILE, body, media: [{ kind: "photo", objectKey: photo }] }, null, 503],
    [{ reportId: MESSAGE, kind: "post", contentId: PROFILE, body, media: [] }, null, 503],
    [{ reportId: REPORT, kind: "post", contentId: PROFILE, body, media: [{ kind: "photo", objectKey: "private/other.jpg" }] }, null, 503],
    [{ reportId: REPORT, kind: "post", contentId: PROFILE, body, media: [{ kind: "photo", objectKey: `social-extra/${MESSAGE}/other.jpg` }] }, null, 503],
    [{ reportId: REPORT, kind: "post", contentId: PROFILE, body, media: Array.from({ length: 6 }, () => ({ kind: "photo", objectKey: photo })) }, null, 503],
  ])("refuses unavailable or mismatched evidence without signing", async (data, error, status) => {
    rpc.mockResolvedValue({ data, error });
    const response = await post(input);
    expect(response.status).toBe(status);
    expect(await response.json()).not.toHaveProperty("evidence");
    expect(sign).not.toHaveBeenCalled();
  });

  it("refuses a signing failure without returning post text or media", async () => {
    rpc.mockResolvedValue({ data: { reportId: REPORT, kind: "post", contentId: PROFILE, body, media: [{ kind: "photo", objectKey: photo }] }, error: null });
    sign.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    const response = await post(input);
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("evidence");
  });
});
