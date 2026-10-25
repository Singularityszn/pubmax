// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const chatServer = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
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
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null }),
}));
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Navigation"),
}));
vi.mock("@/components/pal/PubPalMascot", () => ({
  PubPalMascot: () => createElement("span", null, "Pal"),
}));
vi.mock("@/components/map/useWhatsOnTonight", () => ({
  useWhatsOnTonight: () => ({ rows: [], status: "idle" }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenuesForCity: vi.fn(async () => []),
  loadSlimVenuesForCityResult: vi.fn(async () => ({ status: "ready", rows: [] })),
}));
vi.mock("@/lib/activePlan", () => ({
  readActivePlan: () => null,
  isPlanActiveNow: () => false,
}));
vi.mock("@/components/plan/usePlanMemberRead", () => ({
  readPlanMemberProjection: vi.fn(async () => null),
}));
vi.mock("@/lib/authedFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authedFetch")>()),
  authedActionFetch: chatServer,
}));
vi.mock("@/lib/planningIntent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/planningIntent")>()),
  writePlanningIntent: vi.fn(),
}));

import PalChat from "@/components/pal/PalChat";
import { writePlanningIntent } from "@/lib/planningIntent";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

const SOHO = "Find four pubs in Soho";
const SOHO_AREA = { kind: "night-patch", id: "soho" };
const CAMDEN_AREAS = [{ kind: "night-patch", id: "camden" }, { kind: "borough", name: "Camden" }];

let container: HTMLDivElement;
let root: Root | null = null;
let served: string[] = [];

async function serve(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (String(input) !== "/api/pub-pal/chat" || init.method !== "POST") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const { query } = JSON.parse(String(init.body)) as { query: string };
  served.push(query);
  const index = served.length;
  return Response.json({
    answer: `One listed pub for ${query}.`,
    conversationId: "conv_acceptlocality01",
    toolsUsed: ["search_venues"],
    cards: [{
      key: `venue-${index}`,
      venueId: `venue-${index}`,
      title: `Answer Arms ${index}`,
      place: "London",
      note: "Listed pint on record.",
      price: 5.2,
      provenance: { label: "Recorded price", kind: "directory", url: "https://example.com/menu" },
    }],
    proposals: [],
  });
}

beforeEach(async () => {
  clearSurfaceCache();
  window.localStorage.clear();
  window.sessionStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  served = [];
  vi.mocked(writePlanningIntent).mockClear();
  chatServer.mockReset().mockImplementation(serve);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(PalChat));
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearSurfaceCache();
});

async function settle(): Promise<void> {
  for (let step = 0; step < 6; step += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function submit(text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(".palChatInput");
  if (!input) throw new Error("Pal chat input not found");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const form = container.querySelector<HTMLFormElement>("form");
  if (!form) throw new Error("Pal chat form not found");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function askAndAccept(query: string, venueId: string): Promise<unknown> {
  await submit(query);
  expect(served.at(-1)).toBe(query);
  const link = [...container.querySelectorAll<HTMLAnchorElement>("a.palChatCardAccept")].at(-1);
  if (!link) throw new Error("Use this pub not found");
  expect(link.textContent).toBe("Use this pub");
  await act(async () => {
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  const intent = vi.mocked(writePlanningIntent).mock.calls.at(-1)?.[0];
  expect(intent).toMatchObject({ source: "pal", acceptedVenueId: venueId });
  return (intent as { acceptedArea: unknown }).acceptedArea;
}

it.each([
  "Find four pubs in the same area, not in Soho",
  "Find four pubs around the same patch, not in Soho",
  "Find four pubs in the same area, not in Soho. Soho is too busy.",
  "Find four pubs around the same patch, not in Soho. Soho is too busy.",
  "Find four pubs in Oxford",
  "Find four pubs in Soho or Camden",
  "Find four pubs in Elephant and Castle or Soho",
  "Find four pubs in Elephant and Castle",
])("accepts no area after a Soho answer for %s", async (followUp) => {
  expect(await askAndAccept(SOHO, "venue-1")).toEqual(SOHO_AREA);
  expect(await askAndAccept(followUp, "venue-2")).toBeNull();
  expect(chatServer).toHaveBeenCalledTimes(2);
});

const EAC = "Find four pubs in Elephant and Castle";
const EAC_LINE = "In Elephant and Castle, the area you named.";

function lastLocalityLine(): string | null {
  const row = [...container.querySelectorAll(".palChatRow--pal")].at(-1);
  return row?.querySelector(".palChatLocality")?.textContent ?? null;
}

it("names Elephant and Castle as the searched area with no planning area on a direct ask", async () => {
  expect(await askAndAccept(EAC, "venue-1")).toBeNull();
  expect(lastLocalityLine()).toBe(EAC_LINE);
  const text = container.textContent ?? "";
  expect(text).not.toContain("couldn't place");
  expect(text).not.toContain("Across London");
});

it("names Elephant and Castle rather than reusing Soho", async () => {
  await askAndAccept(SOHO, "venue-1");
  expect(await askAndAccept(EAC, "venue-2")).toBeNull();
  expect(lastLocalityLine()).toBe(EAC_LINE);
  const text = container.textContent ?? "";
  expect(text).not.toContain("Around Soho, the area you last picked.");
  expect(text).not.toContain("couldn't place");
  expect(text).not.toContain("Across London");
});

it("keeps the Elephant and Castle label and no planning area for a same-area follow-up", async () => {
  expect(await askAndAccept(EAC, "venue-1")).toBeNull();
  expect(await askAndAccept("Find four pubs in the same area, not in Camden", "venue-2")).toBeNull();
  expect(lastLocalityLine()).toBe(EAC_LINE);
});

const EAC_CASINGS = [
  "find two pubs in elephant and castle",
  "Find two pubs in Elephant and castle",
  "FIND TWO PUBS IN ELEPHANT AND CASTLE",
];

it.each(EAC_CASINGS)("names the whole Elephant and Castle with no planning area on a direct ask for %s", async (query) => {
  expect(await askAndAccept(query, "venue-1")).toBeNull();
  expect(lastLocalityLine()).toBe(EAC_LINE);
  const text = container.textContent ?? "";
  expect(text).not.toContain("couldn't place");
  expect(text).not.toContain("Across London");
});

it.each(EAC_CASINGS)("names the whole Elephant and Castle after a Soho answer for %s", async (query) => {
  expect(await askAndAccept(SOHO, "venue-1")).toEqual(SOHO_AREA);
  expect(await askAndAccept(query, "venue-2")).toBeNull();
  expect(lastLocalityLine()).toBe(EAC_LINE);
  const text = container.textContent ?? "";
  expect(text).not.toContain("Around Soho, the area you last picked.");
  expect(text).not.toContain("couldn't place");
  expect(text).not.toContain("Across London");
});

it.each(EAC_CASINGS)("keeps the whole Elephant and Castle label for a same-area follow-up after %s", async (query) => {
  expect(await askAndAccept(query, "venue-1")).toBeNull();
  expect(lastLocalityLine()).toBe(EAC_LINE);
  expect(await askAndAccept("Find four pubs in the same area, not in Camden", "venue-2")).toBeNull();
  expect(lastLocalityLine()).toBe(EAC_LINE);
});

it.each([
  "Find four pubs in Elephant and Castle or Soho",
  "Find four pubs in Soho or Camden",
])("accepts no area after Elephant and Castle for the alternatives in %s", async (followUp) => {
  expect(await askAndAccept(EAC, "venue-1")).toBeNull();
  expect(await askAndAccept(followUp, "venue-2")).toBeNull();
  expect(lastLocalityLine()).not.toBe(EAC_LINE);
});

it.each([
  ["Find four pubs in the same area, not in Camden", [SOHO_AREA]],
  ["Four quiet pubs in Soho", [SOHO_AREA]],
  ["Find four pubs not in Camden but in Soho", [SOHO_AREA]],
  ["Find four pubs in Camden, not in Soho", CAMDEN_AREAS],
] as Array<[string, Array<Record<string, string>>]>)("accepts the named area after a Soho answer for %s", async (followUp, areas) => {
  expect(await askAndAccept(SOHO, "venue-1")).toEqual(SOHO_AREA);
  expect(areas).toContainEqual(await askAndAccept(followUp, "venue-2"));
});

const DALSTON_LINE = "In Dalston, the area you named.";

const DALSTON_CASINGS = [
  "Find two pubs in Dalston",
  "find two pubs in dalston",
  "FIND TWO PUBS IN DALSTON",
];

it.each(DALSTON_CASINGS)("names Dalston with no planning area on a direct ask for %s", async (query) => {
  expect(await askAndAccept(query, "venue-1")).toBeNull();
  expect(lastLocalityLine()).toBe(DALSTON_LINE);
  const text = container.textContent ?? "";
  expect(text).not.toContain("couldn't place");
  expect(text).not.toContain("Across London");
});

it.each(DALSTON_CASINGS)("names Dalston after a Soho answer for %s", async (query) => {
  expect(await askAndAccept(SOHO, "venue-1")).toEqual(SOHO_AREA);
  expect(await askAndAccept(query, "venue-2")).toBeNull();
  expect(lastLocalityLine()).toBe(DALSTON_LINE);
  const text = container.textContent ?? "";
  expect(text).not.toContain("Around Soho, the area you last picked.");
  expect(text).not.toContain("couldn't place");
  expect(text).not.toContain("Across London");
});
