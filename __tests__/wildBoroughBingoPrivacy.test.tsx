// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const values = vi.hoisted(() => ({ access: "shared" as "shared" | "full", owner: true }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "user" } }) }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: () => Promise.resolve({ ok: false }) }));
vi.mock("@/components/profile/PassportData", () => ({
  usePassportRead: (kind: string) => kind === "been" ? { access: values.access, venues: [{ venueId: "lamb", venueName: "The Lamb", lastDate: "", sources: ["been_here"] }], count: 1 } : null,
}));
vi.mock("@/components/wild/BoroughBingoGate", () => ({ default: ({ been }: { been: Array<{ venueName: string }> }) => createElement("div", { "data-private-card": "" }, been[0]?.venueName) }));
import PassportSections from "@/components/profile/PassportSections";

afterEach(() => { values.access = "shared"; values.owner = true; });

it("passes Been data to the card only for an owner with a full read", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = () => act(() => root.render(createElement(PassportSections, { handle: "karan", isOwner: values.owner })));
  render();
  expect(host.querySelector("[data-private-card]")).toBeNull();
  values.access = "full";
  render();
  expect(host.querySelector("[data-private-card]")?.textContent).toBe("The Lamb");
  values.owner = false;
  render();
  expect(host.querySelector("[data-private-card]")).toBeNull();
  act(() => root.unmount());
});
