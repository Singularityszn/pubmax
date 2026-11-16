/** Cache shared by public/map-first-paint-init.js with the venue loaders. */
type MapEarlyWarmWindow = {
  json: Map<string, Promise<unknown>>;
};

declare global {
  interface Window {
    __pubmaxMapWarm?: MapEarlyWarmWindow;
  }
}

export function takeEarlyWarmJson(path: string): Promise<unknown> | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__pubmaxMapWarm?.json.get(path);
}
