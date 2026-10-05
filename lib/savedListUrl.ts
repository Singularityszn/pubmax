import type { Route } from "next";

export function savedListPath(ownerHandle: string, listType: string): Route {
  return `/u/${encodeURIComponent(ownerHandle)}/lists/${encodeURIComponent(listType)}` as Route;
}
