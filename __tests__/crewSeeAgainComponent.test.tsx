// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ data: null as unknown, fail: false, writes: [] as Record<string, unknown>[], pauseNext: null as Promise<Response> | null }));
vi.mock("@/lib/authedFetch", () => ({
  authedFetch: async () => {
    if (fixture.pauseNext) { const pending = fixture.pauseNext; fixture.pauseNext = null; return pending; }
    return fixture.fail ? Response.json({}, { status: 503 }) : Response.json(fixture.data);
  },
  authedActionFetch: async (_path: string, options: RequestInit) => {
    fixture.writes.push(JSON.parse(options.body as string));
    fixture.data = { ...fixture.data as object, items: [row(true)] };
    return Response.json({ ok: true });
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/social/ReportPerson", () => ({ default: () => null }));
import { setProviderIdentity } from "@/lib/authProviderRevision";
import CrewSeeAgain from "@/components/social/CrewSeeAgain";
const memberId = "a2500000-0000-4000-8000-000000000001";
const row = (mutual = false) => ({ memberId, handle: "bea", choice: mutual ? "chosen" : "none", mutual });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  setProviderIdentity("supabase", "alice");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fixture.data = { open: true, closesAt: "2099-11-20T00:00:00Z", items: [row()] };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); fixture.fail = false; fixture.writes = []; fixture.pauseNext = null; setProviderIdentity("supabase", null); });
async function mount(identityKey = "alice") {
  await act(async () => root.render(<CrewSeeAgain visibility="open" viewerRole="member" crewId="a2500000-0000-4000-8000-000000000002" identityKey={identityKey} />));
}
function button(label: string) {
  const result = [...host.querySelectorAll("button")].find(b => b.textContent === label);
  if (!result) throw new Error(`Action is absent: ${label}`);
  return result;
}
describe("private see-again mounted component", () => {
  it("requires explicit friendship consent, rereads after save, and never follows automatically", async () => {
    await mount();
    expect(button("See @bea again as a mate").disabled).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button("See @bea again as a mate").click());
    expect(fixture.writes).toEqual([{ memberId, context: "friendship", action: "choose", consent: true }]);
    expect(host.querySelector('a[href="/add/bea"]')).toBeNull();
    await act(async () => button("Add @bea as a mate").click());
    expect(host.querySelector('a[href="/add/bea"]')).not.toBeNull();
  });
  it("clears mutual controls when a resumed read fails and recovers through retry", async () => {
    fixture.data = { open: true, closesAt: "2099-11-20T00:00:00Z", items: [row(true)] };
    await mount();
    expect(button("Add @bea as a mate")).toBeDefined();
    fixture.fail = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector('a[href="/add/bea"]')).toBeNull();
    expect([...host.querySelectorAll("button")].some(b => b.textContent === "Add @bea as a mate")).toBe(false);
    fixture.fail = false;
    await act(async () => button("Retry reconnection").click());
    expect(button("Add @bea as a mate")).toBeDefined();
  });
  it("cannot carry an old account's choice intent across a switch during its fresh read", async () => {
    await mount();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    let resolve!: (value: Response) => void;
    fixture.pauseNext = new Promise<Response>(yes => { resolve = yes; });
    await act(async () => button("See @bea again as a mate").click());
    await act(async () => { setProviderIdentity("supabase", "bob"); });
    await act(async () => resolve(Response.json(fixture.data)));
    expect(fixture.writes).toEqual([]);
  });

  it("can dismiss a visible connection after both directional choices have expired", async () => {
    fixture.data = { open: false, closesAt: "2026-11-17T00:00:00Z", items: [{ ...row(true), choice: "none" }] };
    await mount();
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    await act(async () => button("Dismiss reconnection with @bea").click());
    expect(fixture.writes).toEqual([{ memberId, context: "friendship", action: "withdraw", consent: false }]);
  });

  it("drops prior account data when the identity changes", async () => {
    await mount();
    fixture.data = null;
    await mount("bob");
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.querySelector("li")).toBeNull();
  });
});
