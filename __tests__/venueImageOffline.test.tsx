// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import VenueImage from "@/components/media/VenueImage";

const chunk = vi.hoisted(() => Promise.withResolvers<never>());

vi.mock("@/components/wild/PubSign", async () => {
  await chunk.promise;
  return {};
});

it("keeps named photo placeholders when the sign chunk fails offline", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const view = (name: string) => (
    <VenueImage
      sources={[{ url: "https://pub.example/photo.jpg", provenance: "chain" }]}
      alt={name}
      venueName={name}
    />
  );
  try {
    await act(async () => root.render(view("Golden Lion (Soho)")));
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.querySelector("[aria-label='No photo available for Golden Lion (Soho)']")).not.toBeNull();

    await act(async () => chunk.reject(new Error("ChunkLoadError: offline")));
    expect(host.querySelector("[aria-label='No photo available for Golden Lion (Soho)']")).not.toBeNull();

    await act(async () => root.render(view("The Three Colts Tavern")));
    expect(host.querySelector("[aria-label='No photo available for The Three Colts Tavern']")).not.toBeNull();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
