import { safeLocalStorage } from "./safeStorage";

export const WILD_NIGHT_PREVIEW_KEY = "pubmax-wild-night-preview";
export const WILD_NIGHT_PREVIEWS = ["round-rota", "borough-bingo"] as const;
export type WildNightPreview = (typeof WILD_NIGHT_PREVIEWS)[number];
const PARAM = "wildpreview";
const listeners = new Set<() => void>();
let fallback: WildNightPreview | null = null;
let useFallback = false;

function parse(value: string | null): WildNightPreview | null {
  return WILD_NIGHT_PREVIEWS.find((item) => item === value) ?? null;
}

export function readWildNightPreview(): WildNightPreview | null {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const master = params.get("wild");
    if (master === "0" || master === "off") return null;
    const value = params.get(PARAM);
    if (value !== null) return parse(value);
  }
  if (useFallback) return fallback;
  try { return parse(safeLocalStorage()?.getItem(WILD_NIGHT_PREVIEW_KEY) ?? null); }
  catch { return null; }
}

export function writeWildNightPreview(value: WildNightPreview | null): void {
  fallback = parse(value);
  try {
    const storage = safeLocalStorage();
    if (!storage) throw new Error("Storage unavailable");
    if (fallback) storage.setItem(WILD_NIGHT_PREVIEW_KEY, fallback);
    else storage.removeItem(WILD_NIGHT_PREVIEW_KEY);
    useFallback = false;
  } catch { useFallback = true; }
  for (const listener of listeners) listener();
}

function paramName(piece: string): string {
  const raw = piece.split("=", 1)[0]!.replace(/\+/g, " ");
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export function adoptWildNightPreviewFromAddress(): void {
  if (typeof window === "undefined") return;
  const { location, history } = window;
  const value = new URLSearchParams(location.search).get(PARAM);
  if (value === null) return;
  writeWildNightPreview(value === "off" ? null : parse(value));
  const pieces = location.search.slice(1).split("&").filter((piece) => paramName(piece) !== PARAM);
  const search = pieces.length ? `?${pieces.join("&")}` : "";
  try { history.replaceState(history.state, "", `${location.pathname}${search}${location.hash}`); }
  catch { /* The selection still works when the browser blocks history changes. */ }
}

export function subscribeWildNightPreview(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === WILD_NIGHT_PREVIEW_KEY || event.key === null) {
      useFallback = false;
      listener();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
