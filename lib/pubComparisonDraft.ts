import { parsePubComparisonRequest, type PubComparisonRequest } from "@/lib/pubComparison";
import { safeSessionStorage } from "@/lib/safeStorage";

const KEY = "pubmax:pub-comparison:v1";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveComparisonDraft(request: PubComparisonRequest, owner: string, storage: DraftStorage | null = safeSessionStorage(), now = Date.now()): boolean {
  if (!storage || !parsePubComparisonRequest(request)) return false;
  try { storage.setItem(KEY, JSON.stringify({ version: 1, owner, expiresAt: now + MAX_AGE_MS, request })); return true; }
  catch { return false; }
}

export function readComparisonDraft(owner: string, storage: DraftStorage | null = safeSessionStorage(), now = Date.now()): PubComparisonRequest | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    if (raw.length > 12_000) { storage.removeItem(KEY); return null; }
    const draft = JSON.parse(raw);
    const request = parsePubComparisonRequest(draft?.request);
    if (draft?.version !== 1 || draft.owner !== owner || !Number.isFinite(draft.expiresAt)
      || draft.expiresAt <= now || draft.expiresAt > now + MAX_AGE_MS || !request) {
      storage.removeItem(KEY); return null;
    }
    return request;
  } catch { return null; }
}
