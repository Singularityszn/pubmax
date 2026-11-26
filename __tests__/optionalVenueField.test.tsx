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
  const save = vi.fn();
  function Form() {
    const [venue, setVenue] = useState<{ id: string; name: string; area: string } | null>(null);
    return <form onSubmit={(event) => { event.preventDefault(); save(new FormData(event.currentTarget).get("venueId")); }}><OptionalVenueField venueId={venue?.id ?? ""} venueName={venue?.name} onChange={setVenue} /><input name="venueId" value={venue?.id ?? ""} readOnly /><button type="submit">Save</button></form>;
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
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => input.dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(true);
  expect(save).not.toHaveBeenCalled();
  await act(async () => choice!.click());
  expect(host.textContent).toContain("The Blackfriar");
  expect(new FormData(host.querySelector("form")!).get("venueId")).toBe("venue-123");
  const change = [...host.querySelectorAll("button")].find((button) => button.textContent === "Change pub")!;
  await act(async () => change.click());
  const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  const changeEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => search.dispatchEvent(changeEnter));
  expect(changeEnter.defaultPrevented).toBe(true);
  expect(save).not.toHaveBeenCalled();
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => search.dispatchEvent(escape));
  expect(host.querySelector('input[type="search"]')).toBeNull();
  const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const saveEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => submit.dispatchEvent(saveEnter));
  expect(saveEnter.defaultPrevented).toBe(false);
  await act(async () => submit.click());
  expect(save).toHaveBeenCalledExactlyOnceWith("venue-123");
  await act(async () => root.unmount());
  host.remove();
});
