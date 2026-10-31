// @vitest-environment jsdom

// The passport sections render nothing they have nothing for: the taste card
// with no stored fact, the overlap with two empty rows.

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));

import { PassportOverlapRows, PassportTasteCard } from "@/components/profile/PassportSections";

const roots: Array<{ unmount(): void }> = [];

function render(element: React.ReactElement): HTMLDivElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(element));
  return host;
}

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PassportTasteCard", () => {
  it("renders nothing when no fact is stored", () => {
    expect(render(createElement(PassportTasteCard, { facts: [] })).innerHTML).toBe("");
  });

  it("prints each fact with its day", () => {
    const host = render(
      createElement(PassportTasteCard, {
        facts: [{ key: "drink", label: "Most logged drink", value: "Guinness, logged 2 times", date: "2026-09-30" }],
      }),
    );
    expect(host.textContent).toContain("Your taste, in facts");
    expect(host.textContent).toContain("Guinness, logged 2 times");
    expect(host.textContent).toMatch(/30 Sept? 2026/);
  });
});

describe("PassportOverlapRows", () => {
  it("renders nothing when both rows are empty", () => {
    expect(render(createElement(PassportOverlapRows, { overlap: { topFive: [], wantToTry: [] } })).innerHTML).toBe("");
  });

  it("leaves out an empty row and prints no figure", () => {
    const host = render(
      createElement(PassportOverlapRows, {
        overlap: { topFive: [], wantToTry: [{ venueId: "lamb", venueName: "The Lamb" }] },
      }),
    );
    expect(host.textContent).toContain("Pubs you both want to try");
    expect(host.textContent).not.toContain("top five");
    expect(host.textContent).not.toMatch(/\d|%/);
  });
});
