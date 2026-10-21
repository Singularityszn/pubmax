// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/historic", useRouter: () => navigation }));
import HistoricFilters from "@/app/historic/HistoricFilters";

it("keeps a quick borough, sort and listing selection before the first navigation finishes", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(HistoricFilters, {
      boroughs: ["Camden", "Westminster"], filters: { borough: null, sort: "oldest", listedOnly: false, hasDate: false, page: 1 },
    })));
    const borough = host.querySelector<HTMLSelectElement>("#historic-borough")!;
    const sort = host.querySelector<HTMLSelectElement>("#historic-sort")!;
    await act(async () => { borough.value = "Camden"; borough.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { sort.value = "az"; sort.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>("button")?.click(); });
    expect(navigation.push).toHaveBeenLastCalledWith("/historic?borough=Camden&listed=1&sort=az");
  } finally { act(() => root.unmount()); host.remove(); }
});
