// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, className, onClick }: {
    children: React.ReactNode;
    href: string;
    className?: string;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  }) => createElement("a", {
    href,
    className,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      event.preventDefault();
    },
  }, children),
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/supabase", () => ({ clientIp: () => "203.0.113.45", hashIp: (ip: string) => ip, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false }));
vi.mock("@/lib/planningIntent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/planningIntent")>()),
  writePlanningIntent: vi.fn(),
}));

import { AnswerCard } from "@/components/pal/PalChat";
import { refineRoutedAskQuery, resolveAskLocality } from "@/lib/ask/router";
import type { PalCard } from "@/lib/palChat";
import { palLocalityLine, resolvePalLocality } from "@/lib/palLocality";
import { writePlanningIntent } from "@/lib/planningIntent";

afterEach(() => {
  vi.mocked(writePlanningIntent).mockClear();
  document.body.replaceChildren();
});

it.each([
  ["Find four pubs in Camden, not in Soho", /camden/i, /soho/i],
  ["Find four pubs not in Camden but in Soho", /soho/i, /camden/i],
])("labels and accepts the positive area of %s", async (query, wanted, excluded) => {
  const routed = refineRoutedAskQuery(query, undefined, []);
  const asked = resolveAskLocality(routed);
  expect(asked.kind).toBe("supported");
  expect("area" in asked ? asked.area : "").toMatch(wanted);
  const locality = resolvePalLocality(routed, null);
  expect(locality.scope).toBe("query");
  expect(palLocalityLine(locality)).toMatch(wanted);
  expect(palLocalityLine(locality)).not.toMatch(excluded);

  const card = {
    key: "accept-1", venueId: "venue-accept-1", title: "Test Arms", place: "", note: "", price: null,
    provenance: { label: "On record", kind: "directory" },
  } as unknown as PalCard;
  const host = document.createElement("ul");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AnswerCard, { card, onOpen: vi.fn(), locality })));
    const accept = host.querySelector<HTMLAnchorElement>("a.palChatCardAccept");
    expect(accept?.textContent).toBe("Use this pub");
    await act(async () => { accept!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    const intent = vi.mocked(writePlanningIntent).mock.calls.at(-1)?.[0];
    expect(intent?.acceptedVenueId).toBe("venue-accept-1");
    expect(intent?.acceptedArea).toEqual(locality.area);
    expect(JSON.stringify(intent?.acceptedArea)).toMatch(wanted);
    expect(JSON.stringify(intent?.acceptedArea)).not.toMatch(excluded);
  } finally {
    await act(async () => root.unmount());
  }
});
