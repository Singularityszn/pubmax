export type StoredMutationKey = { version: 1; key: string; fingerprint: string };

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function preparePlanMutationKey(
  scope: string,
  value: unknown,
  options: { signal?: AbortSignal; boundKey?: string | null; previous?: StoredMutationKey | null } = {},
): Promise<StoredMutationKey> {
  const nextFingerprint = await fingerprint(value);
  options.signal?.throwIfAborted();
  let previous = !options.boundKey || options.previous?.key === options.boundKey ? options.previous : null;
  if (!previous) {
    try {
      const storageScope = options.boundKey ? `${scope}:${options.boundKey}` : scope;
      const parsed = JSON.parse(sessionStorage.getItem(`pubmaxx:plan-mutation:v1:${storageScope}`) ?? "null") as StoredMutationKey | null;
      if (parsed?.version === 1 && typeof parsed.key === "string" && typeof parsed.fingerprint === "string") previous = parsed;
    } catch {}
  }
  if (previous?.fingerprint === nextFingerprint && (!options.boundKey || previous.key === options.boundKey)) return previous;
  const key = options.boundKey && previous?.key !== options.boundKey
    ? options.boundKey
    : `${scope}-${crypto.randomUUID()}`.slice(0, 120);
  return { version: 1, key, fingerprint: nextFingerprint };
}

export function rememberPlanMutationKey(scope: string, attempt: StoredMutationKey, boundKey?: string | null): void {
  const storageScope = boundKey ? `${scope}:${boundKey}` : scope;
  try {
    sessionStorage.setItem(`pubmaxx:plan-mutation:v1:${storageScope}`, JSON.stringify(attempt));
  } catch {}
}

export async function persistentPlanMutationKey(scope: string, value: unknown, signal?: AbortSignal): Promise<string> {
  const attempt = await preparePlanMutationKey(scope, value, { signal });
  signal?.throwIfAborted();
  rememberPlanMutationKey(scope, attempt);
  return attempt.key;
}

export function clearPersistentPlanMutationKey(scope: string, key: string): void {
  const storageKey = `pubmaxx:plan-mutation:v1:${scope}`;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as StoredMutationKey | null;
    if (parsed?.version === 1 && parsed.key === key) sessionStorage.removeItem(storageKey);
  } catch { /* best effort */ }
}
