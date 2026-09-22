// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  accountRevision: 1,
  user: { id: "owner" },
  providerAuthState: "authenticated",
}));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => auth }));
const transport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authedFetch", () => ({ authedFetch: transport }));
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
  }: React.ImgHTMLAttributes<HTMLImageElement>) =>
    React.createElement("img", { src, alt, className }),
}));
import ProfileCoverCarousel from "@/components/profile/ProfileCoverCarousel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const COVER =
  "/api/cover/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  auth.accountRevision = 1;
  auth.user = { id: "owner" };
  auth.providerAuthState = "authenticated";
  vi.clearAllMocks();
});

afterEach(() => vi.restoreAllMocks());

it("loads cover bytes with viewer credentials and releases them on account change", async () => {
  const create = vi.fn(() => "blob:cover-1");
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: create,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revoke,
  });
  transport.mockResolvedValue(
    new Response(new Blob(["cover"], { type: "image/jpeg" })),
  );
  const el = document.createElement("div");
  const root = createRoot(el);

  await act(async () => root.render(<ProfileCoverCarousel covers={[COVER]} />));

  expect(transport).toHaveBeenCalledWith(
    expect.stringContaining(COVER),
    expect.objectContaining({ cache: "no-store", redirect: "error" }),
    { requiresIdentity: true },
  );
  expect(el.querySelector("img")?.getAttribute("src")).toBe("blob:cover-1");

  transport.mockResolvedValue(new Response(null, { status: 404 }));
  auth.accountRevision = 2;
  auth.user = { id: "stranger" };
  await act(async () => root.render(<ProfileCoverCarousel covers={[COVER]} />));

  expect(revoke).toHaveBeenCalledWith("blob:cover-1");
  expect(el.querySelector("img")).toBeNull();
  await act(async () => root.unmount());
});

it("removes a cover from the rotation when its authenticated read is refused", async () => {
  transport.mockResolvedValue(new Response(null, { status: 404 }));
  const el = document.createElement("div");
  const root = createRoot(el);

  await act(async () => root.render(<ProfileCoverCarousel covers={[COVER]} />));

  expect(el.querySelector("[data-cover-count]")).toBeNull();
  await act(async () => root.unmount());
});
