// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import OptionalVenueField from "@/components/messages/OptionalVenueField";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("lets a person choose a named pub and submits its canonical ID", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ venues: [{ id: "venue-123", name: "The Blackfriar", area: "London" }] })));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  function Form() {
    const [venue, setVenue] = useState<{ id: string; name: string; area: string } | null>(null);
    return <form><OptionalVenueField venueId={venue?.id ?? ""} venueName={venue?.name} onChange={setVenue} /><input name="venueId" value={venue?.id ?? ""} readOnly /></form>;
  }
  await act(async () => root.render(<Form />));
  await act(async () => host.querySelector("button")!.click());
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Blackfriar");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(220);
  });
  const choice = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("The Blackfriar"));
  expect(choice).toBeDefined();
  await act(async () => choice!.click());
  expect(host.textContent).toContain("The Blackfriar");
  expect(new FormData(host.querySelector("form")!).get("venueId")).toBe("venue-123");
  await act(async () => root.unmount());
  host.remove();
});
