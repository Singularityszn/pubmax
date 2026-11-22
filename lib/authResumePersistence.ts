import {
  markResumePersisted,
  persistSessionForResume,
  resumeAlreadyPersisted,
  type PersistResumeOutcome,
} from "@/lib/authSessionResumeClient";

type ResumeSession = {
  access_token: string;
  refresh_token: string;
  user: { id: string };
};

export function createResumePersistence() {
  let pending: { session: ResumeSession; storage: Storage | null } | null = null;
  let inFlight: Promise<PersistResumeOutcome> | null = null;
  let refreshing = false;

  function flush(): Promise<PersistResumeOutcome> {
    if (inFlight) return inFlight;
    if (!pending) return Promise.resolve("stored");
    inFlight = (async (): Promise<PersistResumeOutcome> => {
      for (const delay of [0, 1_000, 2_000, 4_000]) {
        if (delay && pending) await new Promise<void>((resolve) => setTimeout(resolve, delay));
        const attempt: { session: ResumeSession; storage: Storage | null } | null = pending;
        if (!attempt) return "stored";
        const outcome = await persistSessionForResume(attempt.session);
        if (outcome === "stored") {
          markResumePersisted(attempt.storage, attempt.session);
          if (pending === attempt) pending = null;
        }
        if (pending === attempt && outcome === "banned") {
          pending = null;
          return outcome;
        }
        if (!pending) return "stored";
        if (pending === attempt && outcome === "unauthenticated") return outcome;
      }
      return "unavailable";
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  function remember(session: ResumeSession, storage: Storage | null): void {
    if (!pending || pending.session.access_token !== session.access_token ||
        pending.session.refresh_token !== session.refresh_token || pending.session.user.id !== session.user.id) {
      pending = { session, storage };
    }
  }

  function persist(session: ResumeSession, storage: Storage | null, skipIfRecent = false): Promise<boolean> {
    if (!pending && skipIfRecent && resumeAlreadyPersisted(storage, session)) return Promise.resolve(true);
    remember(session, storage);
    return flush().then((outcome) => outcome === "stored");
  }

  return {
    persist,
    async clear(): Promise<void> {
      pending = null;
      await inFlight;
    },
    wrapFetch(fetchImpl: typeof fetch, storage: Storage | null, activeSession = true): typeof fetch {
      return async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const refresh = url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token";
        if (!refresh) return fetchImpl(input, init);
        const unavailable = () => Response.json({ message: "Session persistence is unavailable." }, { status: 503 });
        if (refreshing) return unavailable();
        refreshing = true;
        try {
          const outcome = await flush();
          let recovery = false;
          if (activeSession && outcome === "unauthenticated" && pending) {
            const body: unknown = await new Request(input instanceof Request ? input.clone() : input, init).json().catch(() => null);
            recovery = !!body && typeof body === "object" && "refresh_token" in body &&
              body.refresh_token === pending.session.refresh_token;
          }
          if (outcome !== "stored" && outcome !== "banned" && !recovery) return unavailable();
          const response = await fetchImpl(input, init);
          if (activeSession && response.ok) {
            const session: unknown = await response.clone().json().catch(() => null);
            if (session && typeof session === "object" &&
                "access_token" in session && typeof session.access_token === "string" &&
                "refresh_token" in session && typeof session.refresh_token === "string" &&
                "user" in session && session.user && typeof session.user === "object" &&
                "id" in session.user && typeof session.user.id === "string") {
              remember({ access_token: session.access_token, refresh_token: session.refresh_token, user: { id: session.user.id } }, storage);
              if (recovery) await flush();
            }
          }
          return response;
        } finally {
          refreshing = false;
        }
      };
    },
  };
}

export const browserResumePersistence = createResumePersistence();
