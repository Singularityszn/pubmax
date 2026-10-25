/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ json: vi.fn(), track: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedActionJson: api.json }));
vi.mock("@/lib/analytics", () => ({ trackEvent: api.track }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import { ImportSession } from "@/components/plan/PubListImport";

let host: HTMLDivElement;
let root: Root;
const id = "53c329da-dcda-49be-abcd-337b90996c36";
const venue = (id: string, name: string, area: string) => ({ id, name, area, layer: "curated" as const });
const review = () => ({ importId: id, source: { url: "https://www.tiktok.com/@pubmate/video/123", platform: "tiktok", handle: "@pubmate" }, truncated: false, items: [
  { rawLine: "The Harp, Soho - cosy", name: "The Harp", areaHint: "Soho", state: "matched", venue: venue("harp", "The Harp", "Soho") },
  { rawLine: "The Crown", name: "The Crown", areaHint: "", state: "ambiguous", candidateCount: 2, candidates: [venue("crown-soho", "The Crown", "Soho"), venue("crown-camden", "The Crown", "Camden")] },
  { rawLine: "The Imaginary Arms", name: "The Imaginary Arms", areaHint: "", state: "unmatched" },
  { rawLine: "The Old Bell", name: "The Old Bell", areaHint: "", state: "closed", venue: { ...venue("closed", "The Old Bell", "Soho"), closed: true } },
  { rawLine: "The Blue Bell", name: "The Blue Bell", areaHint: "", state: "matched", venue: { ...venue("national", "The Blue Bell", "York"), layer: "national", price: null } },
] });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  api.json.mockReset(); api.track.mockReset();
  api.json.mockImplementation(async (_url, init) => {
    if (init.method === "GET") return { response: { ok: true }, body: { drafts: [] } };
    const body = JSON.parse(init.body);
    return { response: { ok: true }, body: body.action === "save"
      ? { draft: { id, venueIds: body.venueIds, source: null, createdAt: "2026-10-22T12:00:00Z" } }
      : review() };
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => (node.getAttribute("aria-label") ?? node.textContent?.trim()) === name)!;
async function click(name: string) { await act(async () => button(name).click()); }
async function fill(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  await act(async () => {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function open() {
  await act(async () => root.render(<ImportSession phase="signed-in" onClose={() => {}} />));
  await fill("#pub-import-text", "A private group chat\nThe Crown");
  await click("Match these pubs");
}

describe("pub list review", () => {
  it("shows every state, attribution, quoted claims and unpriced national pubs", async () => {
    await open();
    expect(document.body.textContent).toContain("We couldn't find this one");
    expect(document.body.textContent).toContain("Closed");
    expect(document.body.textContent).toContain("No price listed");
    expect(document.querySelector("blockquote")?.textContent).toContain("Quoted from @pubmate");
    expect(document.querySelector('a[href^="/add-a-pub"]')?.getAttribute("href")).toContain("Imaginary");
    expect(document.querySelector("#pub-import-text")).toBeNull();
    expect(button("Plan a crawl from these").disabled).toBe(true);
    expect(api.track).toHaveBeenCalledWith("pub_list_import_matched", { count_matched: 2, count_ambiguous: 1, count_unmatched: 1 });
  });

  it("resolves an ambiguous pub and saves only selected IDs and attribution", async () => {
    await open();
    await act(async () => {
      const field = document.querySelector<HTMLSelectElement>("select")!;
      field.value = "crown-camden"; field.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Remove line 4");
    await click("Save");
    const post = api.json.mock.calls.filter(([, init]) => init.method === "POST").at(-1)!;
    expect(JSON.parse(post[1].body)).toEqual({ action: "save", importId: id,
      venueIds: ["harp", "crown-camden", "national"], sourceUrl: "https://www.tiktok.com/@pubmate/video/123" });
    expect(document.body.textContent).toContain("Saved as a night draft with 3 matched pubs");
    expect(post[1].body).not.toContain("cosy");
    expect(post[1].body).not.toContain("Imaginary");
  });

  it("rematches an edited line and prevents saving an unchecked edit", async () => {
    await open();
    await click("Edit line 3");
    expect(button("Save").disabled).toBe(true);
    await fill("#pub-import-edit", "The Harp, Soho");
    api.json.mockResolvedValueOnce({ response: { ok: true }, body: { ...review(), items: [review().items[0]] } });
    await click("Match edited line");
    expect(document.body.textContent).not.toContain("We couldn't find this one");
    expect(button("Save").disabled).toBe(true);
  });

  it("keeps the review available after a failed save", async () => {
    await open();
    await click("Remove line 2");
    api.json.mockResolvedValueOnce({ response: { ok: false }, body: { error: "Night drafts are unavailable." } });
    await click("Save");
    expect(document.body.textContent).toContain("Night drafts are unavailable.");
    expect(button("Save").disabled).toBe(false);
    expect(document.body.textContent).toContain("The Harp");
  });

  it("requires sign-in without sending pasted text", async () => {
    await act(async () => root.render(<ImportSession phase="signed-out" onClose={() => {}} />));
    expect(document.body.textContent).toContain("Sign in to import a pub list");
    expect(api.json).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("offers no sign-in door before the live session answers", async () => {
    await act(async () => root.render(<ImportSession phase="unresolved" onClose={() => {}} />));
    expect(document.body.textContent).not.toContain("Sign in to import a pub list");
    expect(api.json).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
  });
});

it("routes only resolved London pubs and explains the remaining pubs", async () => {
  api.json.mockImplementation(async (url, init) => {
    if (init.method === "GET") return { response: { ok: true }, body: { drafts: [] } };
    const body = JSON.parse(init.body);
    if (body.action === "cluster") return { response: { ok: true }, body: { venueIds: ["harp", "crown-soho", "ship"], remainingIds: [], nightArea: "soho", distanceBasis: "street-walk" } };
    if (url === "/api/plans/generate") return { response: { ok: true }, body: { outcome: "route", grounded: true, anchored: true, anchorVenueId: "harp", anchorSource: "map-search", groundingProof: "server-proof", stops: [
      { venueId: "harp", venueName: "The Harp" }, { venueId: "crown-soho", venueName: "The Crown" }, { venueId: "ship", venueName: "The Ship" },
    ] } };
    return { response: { ok: true }, body: { ...review(), items: [...review().items,
      { rawLine: "The Ship", name: "The Ship", areaHint: "", state: "matched", venue: venue("ship", "The Ship", "Soho") }] } };
  });
  await open();
  await act(async () => {
    const field = document.querySelector<HTMLSelectElement>("select")!;
    field.value = "crown-soho"; field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("Plan a crawl from these");
  const clusterCall = api.json.mock.calls.find(([, init]) => init.body?.includes('"action":"cluster"'))!;
  expect(JSON.parse(clusterCall[1].body).venueIds).toEqual(["harp", "crown-soho", "ship"]);
  const generateCall = api.json.mock.calls.find(([url]) => url === "/api/plans/generate")!;
  expect(JSON.parse(generateCall[1].body).anchor.venueIds).toEqual(["harp", "crown-soho", "ship"]);
  expect(document.body.textContent).toContain("3 of 5 matched pubs in this crawl");
  expect(document.body.textContent).toContain("For another night");
  expect(document.body.textContent).toContain("York");
  expect(api.track).toHaveBeenCalledWith("pub_list_import_routed", { stops: 3 });
});

it("keeps an edited line credited to the user after resolving its ambiguous match", async () => {
  await open();
  await click("Edit line 3");
  await fill("#pub-import-edit", "The Crown, my own comment");
  api.json.mockResolvedValueOnce({ response: { ok: true }, body: { ...review(), items: [{ ...review().items[1], rawLine: "The Crown, my own comment" }] } });
  await click("Match edited line");
  await act(async () => {
    const field = document.querySelector<HTMLSelectElement>("#pub-import-choice-2")!;
    field.value = "crown-soho"; field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const quote = document.querySelector(".pubImport__lines > li:nth-child(3) blockquote")!;
  expect(quote.textContent).toContain("Your edited line");
  expect(quote.textContent).not.toContain("Quoted from @pubmate");
});
