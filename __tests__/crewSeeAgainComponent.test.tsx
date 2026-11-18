// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ data: null as unknown, fail: false, writes: [] as Record<string, unknown>[], pauseNext: null as Promise<Response> | null, actionResponse: null as Response | Promise<Response> | null }));
vi.mock("@/lib/authedFetch", () => ({
  authedFetch: async () => {
    if (fixture.pauseNext) { const pending = fixture.pauseNext; fixture.pauseNext = null; return pending; }
    return fixture.fail ? Response.json({}, { status: 503 }) : Response.json(fixture.data);
  },
  authedActionFetch: async (_path: string, options: RequestInit) => {
    fixture.writes.push(JSON.parse(options.body as string));
    fixture.data = { ...fixture.data as object, items: [row(true)] };
    return fixture.actionResponse ?? Response.json({ ok: true });
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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); fixture.fail = false; fixture.writes = []; fixture.pauseNext = null; fixture.actionResponse = null; setProviderIdentity("supabase", null); });
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

  it.each([401, 503])("releases an unread %s read body", async status => {
    const cancelled = vi.fn();
    fixture.pauseNext = Promise.resolve(new Response(new ReadableStream({ cancel: cancelled }), { status }));
    await mount();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it.each([200, 403])("releases an unread %s action body", async status => {
    await mount();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    const cancelled = vi.fn();
    fixture.actionResponse = new Response(new ReadableStream({ cancel: cancelled }), { status });
    await act(async () => button("See @bea again as a mate").click());
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("releases a late action body after the account changes", async () => {
    await mount();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    let resolve!: (response: Response) => void;
    fixture.actionResponse = new Promise<Response>(yes => { resolve = yes; });
    await act(async () => button("See @bea again as a mate").click());
    await act(async () => setProviderIdentity("supabase", "bob"));
    const cancelled = vi.fn();
    await act(async () => resolve(new Response(new ReadableStream({ cancel: cancelled }), { status: 200 })));
    expect(cancelled).toHaveBeenCalledOnce();
    expect(host.querySelector("li")).toBeNull();
  });

  it("keeps an action from taking focus back after the person moves away", async () => {
    fixture.data = { open: true, closesAt: "2099-11-20T00:00:00Z", items: [row(true)] };
    await mount();
    const control = button("Add @bea as a mate");
    control.focus();
    let resolve!: (value: Response) => void;
    fixture.pauseNext = new Promise<Response>(yes => { resolve = yes; });
    await act(async () => control.click());
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere); elsewhere.focus();
    try {
      await act(async () => resolve(Response.json(fixture.data)));
      expect(document.activeElement).toBe(elsewhere);
    } finally { elsewhere.remove(); }
  });

  it("offers a focused retry after action authorisation fails without making a write", async () => {
    await mount();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    const control = button("See @bea again as a mate");
    control.focus(); fixture.fail = true;
    await act(async () => control.click());
    expect(fixture.writes).toEqual([]);
    expect(document.activeElement).toBe(button("Retry reconnection"));
  });

  it.each(["choose", "withdraw", "add"] as const)("preserves keyboard position while authorising %s", async action => {
    if (action !== "choose") fixture.data = { open: true, closesAt: "2099-11-20T00:00:00Z", items: [row(true)] };
    await mount();
    if (action === "choose") await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    const control = button(action === "choose" ? "See @bea again as a mate"
      : action === "withdraw" ? "Dismiss reconnection with @bea" : "Add @bea as a mate");
    control.focus();
    let resolve!: (value: Response) => void;
    fixture.pauseNext = new Promise<Response>(yes => { resolve = yes; });
    await act(async () => control.click());
    expect(control.isConnected).toBe(true);
    expect(document.activeElement).toBe(control);
    await act(async () => resolve(Response.json(fixture.data)));
    if (action === "add") expect(document.activeElement).toBe(host.querySelector('a[href="/add/bea"]'));
    else expect(host.contains(document.activeElement)).toBe(true);
  });
});
