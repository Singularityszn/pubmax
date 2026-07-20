// Opaque installation epoch for push-identity ordering. This is not a user id
// and contains no delivery material. It is created before notification consent
// and persists independently of APNs/Web permission so privacy revocation does
// not depend on recovering a raw provider token.

export const PUSH_INSTALLATION_KEY = "pubmax_push_installation_v1";
export const PUSH_MUTATION_VERSION_KEY = "pubmax_push_identity_version_v1";
export const MAX_PUSH_MUTATION_VERSION = Number.MAX_SAFE_INTEGER;

let volatileInstallationId: string | null = null;
let volatileMutationVersion = 0;
let volatileInstallationDurable = false;

export function isPushInstallationId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isPushMutationVersion(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_PUSH_MUTATION_VERSION;
}

function createInstallationId(): string {
  return crypto.randomUUID();
}

function installationStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function pushInstallationId(): string {
  if (volatileInstallationId) return volatileInstallationId;
  const storage = installationStorage();
  try {
    const stored = storage?.getItem(PUSH_INSTALLATION_KEY);
    if (isPushInstallationId(stored)) {
      volatileInstallationId = stored;
      volatileInstallationDurable = true;
      return stored;
    }
  } catch {
    // Volatile fallback still gives this runtime a coherent epoch.
  }
  const created = createInstallationId();
  volatileInstallationId = created;
  try {
    storage?.setItem(PUSH_INSTALLATION_KEY, created);
    volatileInstallationDurable = storage?.getItem(PUSH_INSTALLATION_KEY) === created;
  } catch {
    // Storage-disabled environments remain safe for this runtime; logout fails
    // closed after a reload because it cannot assert the previous installation.
  }
  return created;
}

export type PushIdentityMutation = {
  installationId: string;
  mutationVersion: number;
};

export function nextPushIdentityMutation(): PushIdentityMutation {
  const installationId = pushInstallationId();
  if (!volatileInstallationDurable) {
    throw new Error("Push installation persistence is unavailable.");
  }
  let current = volatileMutationVersion;
  const storage = installationStorage();
  try {
    const stored = Number(storage?.getItem(PUSH_MUTATION_VERSION_KEY));
    if (Number.isSafeInteger(stored) && stored > current) current = stored;
  } catch {
    // use the runtime watermark
  }
  if (current >= MAX_PUSH_MUTATION_VERSION) {
    throw new Error("Push identity mutation counter exhausted.");
  }
  const mutationVersion = current + 1;
  try {
    storage?.setItem(PUSH_MUTATION_VERSION_KEY, String(mutationVersion));
    if (storage?.getItem(PUSH_MUTATION_VERSION_KEY) !== String(mutationVersion)) {
      throw new Error("Push mutation persistence is unavailable.");
    }
  } catch {
    throw new Error("Push mutation persistence is unavailable.");
  }
  volatileMutationVersion = mutationVersion;
  return { installationId, mutationVersion };
}

/** Persist a server-authoritative watermark returned by privacy revocation.
 * The caller must not report logout success when this cannot be confirmed. */
export function acceptPushIdentityMutationVersion(value: unknown): boolean {
  if (!isPushMutationVersion(value) || !volatileInstallationDurable) return false;
  const storage = installationStorage();
  try {
    const stored = Number(storage?.getItem(PUSH_MUTATION_VERSION_KEY));
    const durableVersion = isPushMutationVersion(stored) ? stored : 0;
    const next = Math.max(volatileMutationVersion, durableVersion, value);
    storage?.setItem(PUSH_MUTATION_VERSION_KEY, String(next));
    if (storage?.getItem(PUSH_MUTATION_VERSION_KEY) !== String(next)) return false;
    volatileMutationVersion = next;
  } catch {
    return false;
  }
  return true;
}

export function validatePushIdentityMutation(raw: Record<string, unknown>):
  | { ok: true; input: PushIdentityMutation }
  | { ok: false; error: string } {
  if (!isPushInstallationId(raw.installationId)) {
    return { ok: false, error: "A valid push installation is required." };
  }
  if (!isPushMutationVersion(raw.mutationVersion)) {
    return { ok: false, error: "A valid push mutation version is required." };
  }
  return {
    ok: true,
    input: { installationId: raw.installationId, mutationVersion: raw.mutationVersion },
  };
}

export function __resetPushInstallation(): void {
  volatileInstallationId = null;
  volatileMutationVersion = 0;
  volatileInstallationDurable = false;
}
