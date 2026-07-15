"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import SignInButton from "@/components/auth/SignInButton";
import { useAuth } from "@/components/auth/AuthProvider";
import { trackEvent } from "@/lib/analytics";
import { authedFetch } from "@/lib/authedFetch";
import { emitIdentityHandleChanged } from "@/lib/identityClient";
import NightMemoryStudio from "@/components/profile/NightMemoryStudio";

type Connection = { provider: "x" | "instagram" | "tiktok"; username?: string; status: string };

export default function PubmaxxAccountHub() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [currentHandle, setCurrentHandle] = useState<string | null>(null);
  const [instagramUrl, setInstagramUrl] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void Promise.all([
      authedFetch("/api/social-connections", { signal: controller.signal }),
      authedFetch("/api/identity/handle/current", { signal: controller.signal }),
    ]).then(async ([social, identity]) => {
      if (controller.signal.aborted) return;
      if (social.ok) setConnections(((await social.json()) as { connections?: Connection[] }).connections ?? []);
      if (identity.ok) {
        const owned = ((await identity.json()) as { handle?: string | null }).handle ?? null;
        setCurrentHandle(owned);
        if (owned) setHandle(owned);
      }
    }).catch(() => {});
    return () => controller.abort();
  }, [user]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const provider = query.get("socialConnection");
    if (query.get("status") === "connected" && (provider === "x" || provider === "instagram" || provider === "tiktok")) {
      trackEvent("social_account_connected", { provider, connectionType: "oauth" });
    }
  }, []);

  async function claim(event: FormEvent) {
    event.preventDefault();
    const response = await authedFetch(currentHandle ? "/api/identity/handle/rename" : "/api/identity/handle/claim", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle }),
    });
    const body = await response.json().catch(() => ({})) as { handle?: string; error?: string };
    if (!response.ok || !body.handle) return setMessage(body.error ?? "That handle is unavailable.");
    try { localStorage.setItem("pubmax_handle", body.handle); } catch { /* account ownership still persists */ }
    emitIdentityHandleChanged(body.handle);
    if (!currentHandle) trackEvent("account_claimed", { source: "you" });
    router.push(`/u/${encodeURIComponent(body.handle)}`);
  }

  async function connectOAuth(provider: "x" | "instagram" | "tiktok") {
    const response = await authedFetch(`/api/social-connections/${provider}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "oauth" }),
    });
    const body = await response.json().catch(() => ({})) as { authorizeUrl?: string; error?: string };
    if (response.ok && body.authorizeUrl) window.location.assign(body.authorizeUrl);
    else setMessage(body.error ?? "That connection is unavailable.");
  }

  async function connectInstagram(event: FormEvent) {
    event.preventDefault();
    const response = await authedFetch("/api/social-connections/instagram", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "manual", accountKind: "personal", profileUrl: instagramUrl }),
    });
    const body = await response.json().catch(() => ({})) as { connection?: Connection; error?: string };
    if (!response.ok || !body.connection) return setMessage(body.error ?? "Could not add that profile.");
    setConnections((current) => [...current.filter((item) => item.provider !== "instagram"), body.connection!]);
    trackEvent("social_account_connected", { provider: "instagram", connectionType: "manual" });
    setInstagramUrl("");
  }

  if (loading) return <section className="accountHub" aria-busy="true"><p>Loading your account…</p></section>;
  if (!user) return <section className="accountHub"><p className="profileSectionKicker">Your PUBMAXX</p><h2>Own your nights.</h2><p>Sign in to claim a handle, connect profiles, and keep private Night Memories.</p><SignInButton /></section>;

  return (
    <section className="accountHub" aria-labelledby="account-hub-title">
      <p className="profileSectionKicker">Your PUBMAXX</p><h2 id="account-hub-title">Identity, connections and memories.</h2>
      <div className="accountHubGrid">
        <form onSubmit={claim}><h3>{currentHandle ? "Your @handle" : "Claim your @handle"}</h3><input value={handle} onChange={(event) => setHandle(event.target.value)} pattern="[A-Za-z0-9_]{3,30}" placeholder="night_owl" required /><button type="submit">{currentHandle ? "Rename handle" : "Claim handle"}</button>{currentHandle ? <small>Renames are limited to once every 30 days. Old links keep working.</small> : null}</form>
        <div><h3>Connected accounts</h3><div className="accountHubActions">{(["x", "tiktok", "instagram"] as const).map((provider) => <button type="button" key={provider} onClick={() => void connectOAuth(provider)}>Connect {provider === "x" ? "X" : provider[0].toUpperCase() + provider.slice(1)}</button>)}</div><form onSubmit={connectInstagram}><input type="url" value={instagramUrl} onChange={(event) => setInstagramUrl(event.target.value)} placeholder="Personal Instagram URL" required /><button type="submit">Add personal link</button></form><small>{connections.length} connected</small></div>
      </div>
      <NightMemoryStudio key={user.id} userId={user.id} />
      {message ? <p role="status" className="accountHubMessage">{message}</p> : null}
    </section>
  );
}
