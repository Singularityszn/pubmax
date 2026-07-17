import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});
const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

import { GET as listConnections } from "@/app/api/social-connections/route";
import {
  POST as connect,
  DELETE as disconnect,
} from "@/app/api/social-connections/[provider]/route";
import { GET as oauthCallback } from "@/app/api/social-connections/[provider]/callback/route";
import { __resetMemorySocialConnections } from "@/lib/socialConnectionStore";

function request(path: string, method = "GET", body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

const instagramParams = { params: Promise.resolve({ provider: "instagram" }) };

beforeEach(() => {
  authState.userId = null;
  __resetMemorySocialConnections();
});

describe("social connection APIs", () => {
  it("requires an authenticated account", async () => {
    const response = await listConnections(request("/api/social-connections"));
    expect(response.status).toBe(401);
  });

  it("connects and disconnects a manual personal Instagram link", async () => {
    authState.userId = "user-1";
    let response = await connect(
      request("/api/social-connections/instagram", "POST", {
        mode: "manual",
        accountKind: "personal",
        profileUrl: "https://instagram.com/night.owl",
      }),
      instagramParams,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      connection: {
        provider: "instagram",
        mode: "manual",
        accountKind: "personal",
        username: "night.owl",
        status: "connected",
      },
    });

    response = await listConnections(request("/api/social-connections"));
    const body = await response.json();
    expect(body.connections).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("Token");

    response = await disconnect(
      request("/api/social-connections/instagram", "DELETE"),
      instagramParams,
    );
    expect(response.status).toBe(204);
    response = await listConnections(request("/api/social-connections"));
    expect(await response.json()).toMatchObject({
      connections: [],
      providers: { instagram: { manual: true, oauth: false } },
    });
  });

  it("returns OAuth outcomes to the canonical You surface", async () => {
    const response = await oauthCallback(
      request("/api/social-connections/x/callback"),
      { params: Promise.resolve({ provider: "x" }) },
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/u/you");
    expect(location.searchParams.get("socialConnection")).toBe("x");
    expect(location.searchParams.get("status")).toBe("cancelled");
  });
});
