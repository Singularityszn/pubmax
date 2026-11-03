// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ id: "account-a", resolveIndex: null as null | ((value: unknown) => void) }));
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenuesForCityResult: () => new Promise((resolve) => { auth.resolveIndex = resolve; }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: auth.id } }) }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: (path: string) => {
  if (path.endsWith("/been") && auth.id === "account-a") return Promise.resolve({ ok: true, json: async () => ({ access: "full", status: "ready", count: 1, venues: [{ venueId: "lamb", venueName: "The Lamb", lastDate: "", sources: ["been_here"] }] }) });
  if (path.endsWith("/been")) return new Promise(() => {});
  return Promise.resolve({ ok: false });
} }));
vi.mock("@/components/wild/BoroughBingoGate", async () => ({ default: (await import("@/components/wild/BoroughBingo")).default }));
import PassportSections from "@/components/profile/PassportSections";

it("clears the old owner's card immediately on account switch", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => { root.render(createElement(PassportSections, { handle: "karan", isOwner: true })); });
  expect(host.textContent).toContain("Loading London boroughs");
  auth.id = "account-b";
  act(() => root.render(createElement(PassportSections, { handle: "karan", isOwner: true })));
  expect(host.textContent).not.toContain("Loading London boroughs");
  await act(async () => { auth.resolveIndex?.({ status: "ready", rows: [{ id: "lamb", borough: "Camden" }] }); });
  expect(host.textContent).not.toContain("The Lamb");
  expect(host.textContent).not.toContain("Borough Bingo");
  act(() => root.unmount());
  auth.id = "account-a";
});
