// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, User } from "@supabase/supabase-js";

import { AuthContext, useAuth } from "@/components/auth/authContext";
import RoundRotaGate from "@/components/wild/RoundRotaGate";
import { writeWildMode } from "@/lib/wildMode";
import { writeWildNightPreview } from "@/lib/wildNightPreview";

const route = vi.hoisted(() => ({ code: "BCDFGH" }));
vi.mock("next/navigation", () => ({ useParams: () => route }));

let host: HTMLDivElement;
let root: Root;
let owner: string | null;
let loading: boolean;
let tokenOwner: string | null;

function Account({ children }: { children: ReactNode }) {
  const defaults = useAuth();
  const user: User | null = owner ? {
    id: owner, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T12:00:00Z",
  } : null;
  const session: Session | null = user ? {
    user: { ...user, id: tokenOwner ?? user.id }, access_token: "test-token", refresh_token: "test-refresh",
    expires_in: 3600, token_type: "bearer",
  } : null;
  return <AuthContext value={{ ...defaults, user, session, loading, getCurrentUserId: () => owner }}>{children}</AuthContext>;
}

async function show(ready = true, closedAt: string | null = null, roundCode = "BCDFGH") {
  await act(async () => {
    root.render(<Account><RoundRotaGate roundId="round-a" roundCode={roundCode} closedAt={closedAt} ready={ready} /></Account>);
  });
}

async function expectTracker() {
  await vi.waitFor(async () => {
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector(".roundRota input")).not.toBeNull();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/rounds/BCDFGH");
  owner = "owner-a"; tokenOwner = null; loading = false; route.code = "BCDFGH";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  writeWildMode(false);
  writeWildNightPreview(null);
  vi.unstubAllGlobals();
});

describe("the private turn preview gate", () => {
  it("requires both the master switch and the selected idea", async () => {
    await show();
    expect(host.innerHTML).toBe("");
    await act(async () => { writeWildMode(true); });
    expect(host.innerHTML).toBe("");
    await act(async () => { writeWildNightPreview("round-rota"); });
    await expectTracker();
    await act(async () => { writeWildNightPreview("pub-tarot"); });
    expect(host.innerHTML).toBe("");
  });

  it("requires a verified account, Round membership and the current route", async () => {
    writeWildMode(true); writeWildNightPreview("round-rota");
    loading = true;
    await show(); expect(host.innerHTML).toBe("");
    loading = false; owner = null;
    await show(); expect(host.innerHTML).toBe("");
    owner = "owner-b"; tokenOwner = "owner-a";
    await show(); expect(host.innerHTML).toBe("");
    tokenOwner = null;
    await show(false); expect(host.innerHTML).toBe("");
    route.code = "JKLMNP";
    await show(); expect(host.innerHTML).toBe("");
    route.code = "BCDFGH";
    await show(); await expectTracker();
  });

  it("does not reopen a closed Round after an older open response", async () => {
    writeWildMode(true); writeWildNightPreview("round-rota");
    await show(); await expectTracker();
    await show(true, "2026-11-03T20:00:00Z");
    expect(host.innerHTML).toBe("");
    await show(true, null);
    expect(host.innerHTML).toBe("");
  });
});
