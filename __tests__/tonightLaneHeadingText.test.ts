// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ComponentType } from "react";
import type { MusicTonightLaneProps } from "@/components/discovery/MusicTonightLane";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import MusicTonightLane from "@/components/discovery/MusicTonightLane";
import type { WhatsOnRow } from "@/lib/whatsOn";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const musicRow: WhatsOnRow = {
  id: "music-1",
  placeName: "The Example",
  kind: "music",
  title: "Acoustic set",
  source: { label: "Example", url: "https://example.com/" },
  observedAt: "2026-09-24T12:00:00.000Z",
  confidence: "listed",
};

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("tonight lane headings", () => {
  it("prints Live music tonight without a leading space", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(MusicTonightLane as ComponentType<MusicTonightLaneProps>, {
          rows: [musicRow],
          asOf: null,
        }),
      );
    });
    const heading = container.querySelector("#music-tonight-title");
    expect(heading?.textContent).toBe("Live music tonight");
  });

  it("wraps sibling lane titles so icon markup cannot inject whitespace", () => {
    for (const file of [
      "components/discovery/DealsTonightLane.tsx",
      "components/discovery/TonightMapPointer.tsx",
      "app/tonight/TonightOnTonightSummary.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toMatch(/<span>[^<]+<\/span>/);
      expect(source).not.toMatch(/aria-hidden="true"\s\/>\s+[A-Z]/);
    }
  });
});
