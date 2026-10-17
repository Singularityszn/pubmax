// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VisitReportPanel from "@/components/visits/VisitReportPanel";
import type { VisitReportDTO } from "@/lib/visitReports";

// "Could you hear each other?" read back from the venue's own Visit Reports.
// The panel mounts through its real loader (fetchVisitReports) against a
// stubbed /api/visit-reports, so every assertion is what a reader sees.

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null }),
}));

const NOTE_SELECTOR = '[role="note"][aria-label="Could you hear each other?"]';
const LIMITS =
  "Each is one person's account of that day, not a live reading, and it doesn't say what time they were there.";

function report(
  id: string,
  visitedAt: string,
  fields: Partial<VisitReportDTO>,
): VisitReportDTO {
  return {
    id,
    venueId: "venue-1",
    handle: `drinker-${id}`,
    visitedAt,
    createdAt: `${visitedAt}T23:00:00.000Z`,
    busyness: null,
    noise: null,
    seating: null,
    serviceWait: null,
    note: "",
    ...fields,
  };
}

// Newest first, as the public read returns them. One row carries no noise
// answer and must be neither counted nor dated in the noise line.
const MIXED: VisitReportDTO[] = [
  report("a", "2026-10-10", { noise: "loud", note: "Band on from nine." }),
  report("b", "2026-10-09", { noise: "easy-to-talk", busyness: "quiet" }),
  report("c", "2026-10-07", { busyness: "steady", note: "Quiz night." }),
  report("d", "2026-10-01", { noise: "had-to-shout", seating: "standing" }),
];

let host: HTMLElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function serve(response: () => Response): void {
  fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
}

function ready(reports: VisitReportDTO[]): () => Response {
  return () =>
    new Response(JSON.stringify({ status: "ready", reports }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

async function mountPanel(mode: "full" | "peek" = "full"): Promise<void> {
  await act(async () => {
    root.render(
      createElement(VisitReportPanel, {
        venueId: "venue-1",
        venueName: "The Crown",
        mode,
        onOpenFull: mode === "peek" ? () => {} : undefined,
      }),
    );
  });
  // The read resolves through a microtask chain after mount; one macrotask
  // lets it land before anything is asserted.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function noiseNote(): HTMLElement | null {
  return host.querySelector<HTMLElement>(NOTE_SELECTOR);
}

function datedNoise(note: HTMLElement): Array<[string, string]> {
  return Array.from(note.querySelectorAll("time")).map((time) => [
    time.getAttribute("datetime") ?? "",
    time.textContent ?? "",
  ]);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Could you hear each other, from the visits shown", () => {
  it("counts only the shown accounts that answered the noise question, with their visit days", async () => {
    serve(ready(MIXED));
    await mountPanel();

    expect(fetchMock).toHaveBeenCalledWith("/api/visit-reports?venueId=venue-1");
    const note = noiseNote();
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain(
      "3 of the visit accounts shown here mention noise.",
    );
    // Real visit days, weekday derived from the date itself. The row with no
    // noise answer (7 Oct) is neither counted nor dated.
    expect(datedNoise(note!)).toEqual([
      ["2026-10-10", "Sat 10 Oct 2026"],
      ["2026-10-09", "Fri 9 Oct 2026"],
      ["2026-10-01", "Thu 1 Oct 2026"],
    ]);
    expect(note!.textContent).toContain(LIMITS);
  });

  it("never turns the count into a verdict, a live reading or a time of night", async () => {
    serve(ready(MIXED));
    await mountPanel();

    const note = noiseNote();
    expect(note).not.toBeNull();
    const text = note!.textContent ?? "";
    // The observations stay on each account; the line above them only counts.
    expect(text).not.toMatch(/easy to talk|had to shout|\bloud\b|quiet|noisy/i);
    expect(text).not.toMatch(/score|rating|out of|verified|usually|typically|average|mostly/i);
    expect(text).not.toMatch(/right now|tonight|at the moment|currently/i);
    expect(text).not.toMatch(/\b\d{1,2}(:\d{2})?\s?(am|pm)\b|weekends?|weeknights?|evenings?/i);
  });

  it("keeps every dated, attributed account and its own observations", async () => {
    serve(ready(MIXED));
    await mountPanel();

    const rows = Array.from(host.querySelectorAll("article"));
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.querySelector("time")?.getAttribute("datetime"))).toEqual([
      "2026-10-10",
      "2026-10-09",
      "2026-10-07",
      "2026-10-01",
    ]);
    const [first, second, third, fourth] = rows;
    if (!first || !second || !third || !fourth) {
      throw new Error("expected four rendered visit accounts");
    }
    expect(first.textContent).toContain("@drinker-a");
    expect(first.textContent).toContain("Visited 10 Oct 2026");
    expect(first.textContent).toContain("Band on from nine.");
    expect(first.textContent).toContain("Noise: loud");
    expect(second.textContent).toContain("@drinker-b");
    expect(second.textContent).toContain("Noise: easy to talk");
    expect(second.textContent).toContain("Crowd: quiet");
    expect(third.textContent).toContain("@drinker-c");
    expect(third.textContent).toContain("Quiz night.");
    expect(third.textContent).not.toContain("Noise:");
    expect(fourth.textContent).toContain("@drinker-d");
    expect(fourth.textContent).toContain("Noise: had to shout");
    expect(fourth.textContent).toContain("Seats: standing");
    // The full lane keeps a way to report each original account.
    for (const row of rows) {
      expect(row.querySelector("button")?.textContent).toBe("Report");
    }
  });

  it("counts the peek's own two accounts, not the venue's whole lane", async () => {
    serve(ready(MIXED));
    await mountPanel("peek");

    expect(host.querySelectorAll("article")).toHaveLength(2);
    expect(host.querySelectorAll("article button")).toHaveLength(0);
    expect(host.textContent).toContain("More on Lore");
    const note = noiseNote();
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain(
      "2 of the visit accounts shown here mention noise.",
    );
    expect(datedNoise(note!)).toEqual([
      ["2026-10-10", "Sat 10 Oct 2026"],
      ["2026-10-09", "Fri 9 Oct 2026"],
    ]);
    expect(note!.textContent).toContain(LIMITS);
  });

  it("says none of the shown accounts mention noise when none answered it", async () => {
    serve(
      ready([
        report("e", "2026-10-10", { busyness: "rammed" }),
        report("f", "2026-10-08", { note: "Garden was open." }),
      ]),
    );
    await mountPanel();

    expect(host.querySelectorAll("article")).toHaveLength(2);
    const note = noiseNote();
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain(
      "None of the visit accounts shown here mention noise.",
    );
    expect(note!.querySelectorAll("time")).toHaveLength(0);
    expect(note!.textContent).not.toMatch(/\b0\b/);
    expect(note!.textContent).not.toMatch(/quiet|easy to talk/i);
  });

  it("adds no noise line to a pub nobody has written up", async () => {
    serve(ready([]));
    await mountPanel();

    expect(host.textContent).toContain("No visits have been written up here yet.");
    expect(noiseNote()).toBeNull();
    expect(host.textContent).not.toMatch(/mention noise/i);
  });

  it("keeps a failed read distinct from a pub with no noise reports", async () => {
    serve(() => new Response("{}", { status: 503 }));
    await mountPanel();

    expect(host.textContent).toContain(
      "We couldn't check the visit notes here just now.",
    );
    expect(host.textContent).not.toMatch(/no visits/i);
    expect(noiseNote()).toBeNull();
    expect(host.textContent).not.toMatch(/mention noise|none of the visit accounts/i);
  });
});
