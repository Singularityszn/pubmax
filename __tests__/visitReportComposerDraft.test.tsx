// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BUSYNESS_VALUES, latestVisitedAt, MAX_VISIT_NOTE } from "@/lib/visitReports";

const client = vi.hoisted(() => ({
  fetchVisitReports: vi.fn(),
  postVisitReport: vi.fn(),
  reportVisitReport: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "account-1" },
    session: { access_token: "token-1", user: { id: "account-1" } },
    rejectedContributionAuth: null,
  }),
}));
vi.mock("@/components/identity/ContributionGateDialog", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/identity/ContributionGateDialog")>(),
  useContributionGate: () => ({
    requestContribution: async (action: (auth: { userId: string; accessToken: string }) => unknown) =>
      action({ userId: "account-1", accessToken: "token-1" }),
    contributionGateDialog: null,
  }),
}));
vi.mock("@/components/visits/visitReportsClient", () => client);

import VisitReportPanel from "@/components/visits/VisitReportPanel";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  client.fetchVisitReports.mockResolvedValue({ status: "ok", reports: [] });
  client.postVisitReport.mockResolvedValue({ ok: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function button(name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === name);
  if (!found) throw new Error(`No ${name} button`);
  return found;
}

it("opens an empty dated draft and posts exactly the fields the reader chose", async () => {
  await act(async () => {
    root.render(createElement(VisitReportPanel, { venueId: "venue-1", venueName: "The Crown" }));
  });
  await act(async () => { button("Write yours").click(); });

  const date = container.querySelector<HTMLInputElement>('input[type="date"]');
  const note = container.querySelector<HTMLTextAreaElement>("textarea");
  expect(date?.value).toBe(latestVisitedAt(new Date()));
  expect(note?.value).toBe("");
  expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
  expect(container.textContent).toContain(`${MAX_VISIT_NOTE} characters left`);

  // An untouched draft is refused before any write.
  await act(async () => { button("Add visit account").click(); });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Add one thing you found on the visit.");
  expect(client.postVisitReport).not.toHaveBeenCalled();

  const firstBusyness = container.querySelector<HTMLButtonElement>(".visitReportChoiceGroup .visitChip");
  await act(async () => { firstBusyness?.click(); });
  expect(firstBusyness?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(note, "  Quiet corner by the fire  ");
    note?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain(`${MAX_VISIT_NOTE - "  Quiet corner by the fire  ".length} characters left`);

  await act(async () => { button("Add visit account").click(); });
  expect(client.postVisitReport).toHaveBeenCalledWith({
    venueId: "venue-1",
    visitedAt: latestVisitedAt(new Date()),
    busyness: BUSYNESS_VALUES[0],
    noise: null,
    seating: null,
    serviceWait: null,
    note: "Quiet corner by the fire",
  }, { userId: "account-1", accessToken: "token-1" });
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Saved. Your visit is on this pub's page.");
});
