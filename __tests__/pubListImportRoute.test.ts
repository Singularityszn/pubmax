import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  read: vi.fn(),
  readSync: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: boundary.getUser }, rpc: boundary.rpc }),
}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    promises: { ...actual.promises, readFile: boundary.read },
    readFileSync: boundary.readSync,
  };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://pub-list-import.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  boundary.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  boundary.rpc.mockImplementation(() => ({
    abortSignal: () => Promise.resolve({ data: false, error: null }),
  }));
  boundary.read.mockResolvedValue(JSON.stringify({ rows: [
    { id: "venue-harp", name: "The Harp", borough: "Westminster", lat: 51.509, lng: -0.126 },
  ] }));
  boundary.readSync.mockReturnValue(JSON.stringify({ pubs: [
    ["n2", "The Blue Bell", "York, YO1 1AA", 53.96, -1.08],
  ] }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function request(body: unknown, token: string | null = "test-token"): Request {
  return new Request("http://localhost/api/pub-list-import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": "192.0.2.1",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("pub list import HTTP entry point", () => {
  it("requires sign-in before reading a pasted list or the venue catalogue", async () => {
    const { POST } = await import("@/app/api/pub-list-import/route");
    const input = request({ text: "The Harp\nThe Blue Bell" }, null);
    const response = await POST(input);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED", retryable: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(input.bodyUsed).toBe(false);
    expect(boundary.getUser).not.toHaveBeenCalled();
    expect(boundary.read).not.toHaveBeenCalled();
    expect(boundary.readSync).not.toHaveBeenCalled();
  });

  it("returns an ordered private review with source credit and no outbound source request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed."));
    const { POST } = await import("@/app/api/pub-list-import/route");
    const response = await POST(request({
      text: "The Harp\nThe Blue Bell\nThe Invented Arms",
      sourceUrl: "https://www.tiktok.com/@pubs/video/123",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      importId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      source: { platform: "tiktok", handle: "@pubs", url: "https://www.tiktok.com/@pubs/video/123" },
      items: [
        { state: "matched", venue: { id: "venue-harp", layer: "curated" } },
        { state: "matched", venue: { id: "venue-uk-n2", layer: "national", price: null } },
        { state: "unmatched", name: "The Invented Arms" },
      ],
      truncated: false,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(boundary.getUser).toHaveBeenCalledWith("test-token");
    expect(boundary.rpc.mock.calls.map(([name, args]) => ({ name, ...args }))).toEqual([
      { name: "check_rate_limit", p_key: expect.stringMatching(/^pub-list-import:ip:[a-f0-9]{64}$/), p_limit: 30, p_window_ms: 60_000 },
      { name: "check_rate_limit", p_key: expect.stringMatching(/^pub-list-import:user:[a-f0-9]{64}$/), p_limit: 10, p_window_ms: 60_000 },
    ]);
  });

  it.each([
    [{ status: 401, code: "bad_jwt" }, 401, "UNAUTHENTICATED"],
    [{ status: 401, code: "user_not_found" }, 401, "UNAUTHENTICATED"],
    [{ status: 403, code: "user_banned" }, 401, "UNAUTHENTICATED"],
    [{ status: 503 }, 503, "AUTH_UNAVAILABLE"],
  ])("refuses an unverified account without consuming its body: %j", async (error, status, code) => {
    boundary.getUser.mockResolvedValue({ data: { user: null }, error });
    const { POST } = await import("@/app/api/pub-list-import/route");
    const input = request({ text: "The Harp" });
    const response = await POST(input);

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code, retryable: status === 503 });
    expect(input.bodyUsed).toBe(false);
    expect(boundary.read).not.toHaveBeenCalled();
    expect(boundary.rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["ip", "user"])("refuses an exhausted %s budget before reading the list", async (kind) => {
    boundary.rpc.mockImplementation((_name, args) => ({
      abortSignal: () => Promise.resolve({ data: args.p_key.includes(`:${kind}:`), error: null }),
    }));
    const { POST } = await import("@/app/api/pub-list-import/route");
    const input = request({ text: "The Harp" });
    const response = await POST(input);

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(input.bodyUsed).toBe(false);
    expect(boundary.read).not.toHaveBeenCalled();
    if (kind === "ip") expect(boundary.getUser).not.toHaveBeenCalled();
  });

  it("holds the same account budget when its address changes", async () => {
    const { POST } = await import("@/app/api/pub-list-import/route");
    const first = request({ text: "The Harp\nThe Blue Bell" });
    const second = request({ text: "The Harp\nThe Blue Bell" });
    second.headers.set("x-real-ip", "192.0.2.2");

    expect((await POST(first)).status).toBe(200);
    expect((await POST(second)).status).toBe(200);
    const keys = boundary.rpc.mock.calls.map(([, args]) => args.p_key);
    expect(keys[0]).not.toBe(keys[2]);
    expect(keys[1]).toBe(keys[3]);
  });

  it.each(["ip", "user"])("refuses an unavailable durable %s budget", async (kind) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    boundary.rpc.mockImplementation((_name, args) => ({
      abortSignal: () => Promise.resolve({
        data: false,
        error: args.p_key.includes(`:${kind}:`) ? { code: "PGRST202", message: "Missing RPC" } : null,
      }),
    }));
    const { POST } = await import("@/app/api/pub-list-import/route");
    const input = request({ text: "Private group chat" });

    expect((await POST(input)).status).toBe(429);
    expect(input.bodyUsed).toBe(false);
    expect(boundary.read).not.toHaveBeenCalled();
  });

  it.each([
    null, [], {}, { text: 123 }, { text: " \n " }, { text: "x".repeat(4001) },
    { text: "The Harp", sourceUrl: 123 },
    { text: "The Harp", sourceUrl: "x".repeat(2049) },
    { text: "The Harp", ownerId: "someone-else" },
    { text: "The Harp", sourceUrl: "https://localhost/private" },
    { text: "The Harp", sourceUrl: "http://example.com/list" },
  ])("rejects invalid input before loading venues: %#", async (body) => {
    const { POST } = await import("@/app/api/pub-list-import/route");
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST", retryable: false });
    expect(boundary.read).not.toHaveBeenCalled();
    expect(boundary.readSync).not.toHaveBeenCalled();
  });

  it("answers malformed JSON with the public error envelope", async () => {
    const { POST } = await import("@/app/api/pub-list-import/route");
    const input = new Request(request({}), { body: "{" });
    const response = await POST(input);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "MALFORMED_REQUEST", error: "Malformed request body.", retryable: false,
    });
    expect(boundary.read).not.toHaveBeenCalled();
  });

  it("bounds the streamed body without trusting a missing content length", async () => {
    const { POST } = await import("@/app/api/pub-list-import/route");
    const response = await POST(request({ text: "x".repeat(48_001) }));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE", retryable: false });
    expect(boundary.read).not.toHaveBeenCalled();
  });

  it("reports an unavailable catalogue without logging or returning private input", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    boundary.read.mockRejectedValue(new Error("Private group chat"));
    const { POST } = await import("@/app/api/pub-list-import/route");
    const response = await POST(request({ text: "Private group chat" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "IMPORT_UNAVAILABLE", error: "The import is unavailable. Try again.", retryable: true,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("matches signed-in prose through OpenRouter without fetching the source link", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("PUBMAX_ALERT_WEBHOOK_URL", "");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify({ items: [
        { name: "The Harp", areaHint: "" }, { name: "The Blue Bell", areaHint: "" },
      ] }) } }],
    }));
    const { POST } = await import("@/app/api/pub-list-import/route");

    const response = await POST(request({
      text: "Try The Harp and The Blue Bell.", sourceUrl: "https://www.tiktok.com/@pubs/video/123",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      importId: expect.any(String),
      items: [
        { state: "matched", venue: { id: "venue-harp", layer: "curated" } },
        { state: "matched", venue: { id: "venue-uk-n2", layer: "national", price: null } },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(boundary.rpc.mock.calls[2]?.[1]).toMatchObject({
      p_key: "paid-spend:pub-list-import", p_limit: 1000, p_window_ms: 86_400_000,
    });
  });

  it("keeps deterministic matches when the durable model budget cannot answer", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed."));
    boundary.rpc.mockImplementation((_name, args) => ({
      abortSignal: () => Promise.resolve({
        data: false,
        error: args.p_key === "paid-spend:pub-list-import" ? { code: "PGRST202", message: "Missing RPC" } : null,
      }),
    }));
    const { POST } = await import("@/app/api/pub-list-import/route");

    const response = await POST(request({ text: "The Harp" }));

    expect(response.status).toBe(200);
    expect((await response.json()).items).toMatchObject([{ state: "matched", venue: { id: "venue-harp" } }]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
