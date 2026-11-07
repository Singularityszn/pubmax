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
const limited = vi.hoisted(() => ({ value: false }));

vi.mock("@/lib/adminAuth", () => ({
  isModerator: (request: Request) => request.headers.get("x-admin-token") === process.env.ADMIN_TOKEN,
  moderatorStaffRoleId: (request: Request) =>
    request.headers.get("x-admin-token") === process.env.ADMIN_TOKEN
      ? process.env.SOCIAL_MODERATOR_STAFF_ROLE_ID ?? null
      : null,
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => limited.value }));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  requireSupabaseAdmin: () => ({ rpc }),
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
  senderHandle: "targetted",
  senderProfileId: PROFILE,
  senderAccountState: "active",
  flaggedBy: "reporter",
  flaggedAt: "2026-11-07T18:00:00.000000Z",
  sentAt: "2026-11-07T17:59:00.000000Z",
};

beforeEach(() => {
  rpc.mockReset();
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
