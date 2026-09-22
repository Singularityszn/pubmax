import { afterEach, expect, it, vi } from "vitest";
import { createRobotsChecker } from "@/lib/harvest/robots";
import { isPublicHarvestAddress } from "@/lib/harvest/sourcePolicy";

afterEach(() => vi.unstubAllGlobals());
it("robots refuses private redirects before automatic following", async () => {
  const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
  const checker = createRobotsChecker({ fetchImpl: request });
  expect((await checker("https://menu.example/menu")).allowed).toBe(false);
  expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  expect(request).toHaveBeenCalledTimes(1);
});
it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.0.2.1", "198.18.0.1", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "2001:db8::1", "2002:0808:0808::1"])("refuses nonpublic address %s", (address) => {
  expect(isPublicHarvestAddress(address)).toBe(false);
});
it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("admits public address %s", (address) => {
  expect(isPublicHarvestAddress(address)).toBe(true);
});
