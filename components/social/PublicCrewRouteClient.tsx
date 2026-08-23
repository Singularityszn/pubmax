"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SiteNav from "@/components/nav/SiteNav";
import PublicCrewPreview, {
  type PublicCrewJoinState,
} from "@/components/social/PublicCrewPreview";
import CrewDetailClient from "@/app/social/crews/[crewId]/CrewDetailClient";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";
import { parseCrewRead, parsePublicCrewPreview, crewIdempotencyKey } from "@/lib/socialCrewsUi";
import type {
  SocialCrewPublicPreviewDTO,
  SocialCrewReadDTO,
} from "@/lib/socialCrew";

import "@/components/social/crews.css";

type LoadState = "idle" | "loading" | "ready" | "missing" | "error";

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav active="social" />
      <main className="crewPage" id="main-content">
        <Link className="crewPage__back" href="/social">
          Back to Social
        </Link>
        {children}
      </main>
    </>
  );
}

export default function PublicCrewRouteClient({
  crewId,
  invitationId,
}: {
  crewId: string;
  invitationId: string | null;
}) {
  const { identityResolved, session } = useAuth();
  const [publicState, setPublicState] = useState<LoadState>("idle");
  const [publicPreview, setPublicPreview] = useState<SocialCrewPublicPreviewDTO | null>(null);
  const [privateState, setPrivateState] = useState<LoadState>("idle");
  const [privateRead, setPrivateRead] = useState<SocialCrewReadDTO | null>(null);
  const [joinState, setJoinState] = useState<PublicCrewJoinState>("none");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const joinKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setPublicState("loading");
    });
    fetch(`/api/social/crews/${encodeURIComponent(crewId)}/public`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) return "missing" as const;
        if (!response.ok) throw new Error("Public crew unavailable");
        const preview = parsePublicCrewPreview(await response.json());
        if (!preview) throw new Error("Public crew malformed");
        return preview;
      })
      .then((result) => {
        if (!active) return;
        if (result === "missing") {
          setPublicPreview(null);
          setPublicState("missing");
          return;
        }
        setPublicPreview(result);
        setPublicState("ready");
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setPublicPreview(null);
        setPublicState("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [crewId]);

  useEffect(() => {
    if (!identityResolved || !session) {
      void Promise.resolve().then(() => {
        setPrivateRead(null);
        setPrivateState("idle");
      });
      return;
    }
    const controller = new AbortController();
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setPrivateState("loading");
    });
    authedActionFetch(`/api/social/crews/${encodeURIComponent(crewId)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) return "missing" as const;
        if (!response.ok) {
          discardBody(response);
          throw new Error("Protected crew unavailable");
        }
        const read = parseCrewRead(await response.json());
        if (!read) throw new Error("Protected crew malformed");
        return read;
      })
      .then((result) => {
        if (!active) return;
        if (result === "missing") {
          setPrivateRead(null);
          setPrivateState("missing");
          return;
        }
        setPrivateRead(result);
        setPrivateState("ready");
        if (result.kind === "preview") setJoinState(result.joinRequestState);
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setPrivateRead(null);
        setPrivateState("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [crewId, identityResolved, session]);

  async function askToJoin(): Promise<void> {
    if (busy || !publicPreview) return;
    setBusy(true);
    setProblem("");
    try {
      joinKey.current ??= crewIdempotencyKey("crew-public-join");
      const response = await authedActionFetch(
        `/api/social/crews/${encodeURIComponent(crewId)}/join-requests`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": joinKey.current,
          },
          body: "{}",
        },
      );
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) throw new Error(errorMessageFrom(body, "That did not go through."));
      setJoinState("pending");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That did not go through.");
    } finally {
      setBusy(false);
    }
  }

  if (privateRead?.kind === "member") {
    return <CrewDetailClient crewId={crewId} invitationId={invitationId} />;
  }

  // Preserve existing friends/private invitation behaviour when no public
  // record exists. Open public records use this smaller account-free surface.
  if (!publicPreview && privateRead && invitationId) {
    return <CrewDetailClient crewId={crewId} invitationId={invitationId} />;
  }

  if (publicPreview) {
    return (
      <Shell>
        <PublicCrewPreview
          preview={publicPreview}
          joinState={joinState}
          busy={busy}
          problem={problem}
          onAskToJoin={() => void askToJoin()}
        />
      </Shell>
    );
  }

  if (privateRead) {
    return <CrewDetailClient crewId={crewId} invitationId={invitationId} />;
  }

  if (
    publicState === "loading" ||
    (session && (privateState === "loading" || privateState === "idle"))
  ) {
    return (
      <Shell>
        <div className="crews__skeletons" aria-hidden="true">
          <span />
          <span />
        </div>
      </Shell>
    );
  }

  if (publicState === "missing" && (!session || privateState === "missing")) {
    return (
      <Shell>
        <section className="crews__notice" role="status">
          <h1>This crew is not open to you.</h1>
          <Link className="crews__button" href="/social">
            Back to Social
          </Link>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="crews__notice" role="alert">
        <h1>Could not load this crew.</h1>
        <button
          type="button"
          className="crews__button"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </section>
    </Shell>
  );
}
