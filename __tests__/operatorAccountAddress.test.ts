import { beforeEach, expect, it, vi } from "vitest";

import { operatorAccountAddress } from "@/lib/operatorAccountAddress.server";

const auth = vi.hoisted(() => ({
  configured: true,
  clientAvailable: true,
  getUserById: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => auth.configured,
  getSupabaseAdmin: () => auth.clientAvailable ? { auth: { admin: { getUserById: auth.getUserById } } } : null,
}));

beforeEach(() => {
  auth.configured = true;
  auth.clientAvailable = true;
  auth.getUserById.mockReset();
});

it.each(["error", "throw", "client"])("preserves an unavailable Auth lookup: %s", async (failure) => {
  auth.clientAvailable = failure !== "client";
  if (failure === "throw") auth.getUserById.mockRejectedValue(new Error("Auth unavailable"));
  else auth.getUserById.mockResolvedValue({ data: { user: null }, error: new Error("Auth unavailable") });
  await expect(operatorAccountAddress("operator-1")).rejects.toThrow();
});

it("returns no address when Auth confirms the operator account was deleted", async () => {
  auth.getUserById.mockResolvedValue({
    data: { user: null },
    error: { code: "user_not_found", status: 404, message: "User not found" },
  });
  await expect(operatorAccountAddress("operator-1")).resolves.toBeNull();
});

it.each(["unexpected_failure", undefined])("preserves an unconfirmed absence with error code %s", async (code) => {
  const error = { code, status: 404, message: "User not found" };
  auth.getUserById.mockResolvedValue({ data: { user: null }, error });
  await expect(operatorAccountAddress("operator-1")).rejects.toBe(error);
});

it.each([" landlord@example.com ", "", undefined])("returns the account address or confirmed absence: %s", async (email) => {
  auth.getUserById.mockResolvedValue({ data: { user: { email } }, error: null });
  expect(await operatorAccountAddress("operator-1")).toBe(email ? "landlord@example.com" : null);
});

it("returns no address when Auth is unconfigured", async () => {
  auth.configured = false;
  expect(await operatorAccountAddress("operator-1")).toBeNull();
});
